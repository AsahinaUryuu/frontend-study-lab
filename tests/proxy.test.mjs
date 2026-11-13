import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { gzipSync } from 'node:zlib';
import { gradeSubmission, normalizeConfig } from '../lib/grade.mjs';

const lesson = { title: '求和', challenge: { title: '求和', description: '累加数组', rubric: ['初始值为0'], solution: 'xs=>xs.reduce((a,b)=>a+b,0)' } };
const input = { code: 'xs=>xs.reduce((a,b)=>a+b,0)', config: { provider: 'openai', apiKey: 'test-key-only', model: 'test-model' } };
function listen(server) { return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`))); }
function close(server) { return new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }

test('代理配置只允许本机、无认证HTTP，拒绝带密钥的地址', () => {
  const c = { ...input.config, baseUrl: 'https://api.example.test/v1' };
  for (const proxyUrl of ['socks5://127.0.0.1:7897', 'https://127.0.0.1:7897', 'http://remote.example:1234',
    'http://user:password@127.0.0.1:7897', 'http://127.0.0.1:7897?key=x', 'http://127.0.0.1:7897/path']) {
    assert.throws(() => normalizeConfig({ ...c, proxyUrl }));
  }
  assert.equal(normalizeConfig({ ...c, proxyUrl: 'http://127.0.0.1:7897' }).proxyUrl, 'http://127.0.0.1:7897/');
  assert.equal(normalizeConfig({ ...c, proxyUrl: '' }).proxyUrl, '');
});

test('真实CONNECT代理完整转发两种协议，密钥不放入CONNECT头部', async t => {
  let seen, count = 0, connectHeaders;
  const sockets = new Set();
  const upstream = http.createServer(async (req, res) => {
    let content = '';
    for await (const chunk of req) content += chunk;
    seen = { method: req.method, url: req.url, headers: req.headers, body: JSON.parse(content) };
    const result = JSON.stringify({ score: 90, verdict: '结构清楚', strengths: ['正确处理空数组'], issues: [], nextSteps: [], referenceExplanation: '归约初值为0' });
    const data = req.url.includes('generateContent') ? { candidates: [{ content: { parts: [{ text: result }] } }] }
      : { choices: [{ message: { content: result } }] };
    const compressed = gzipSync(JSON.stringify(data));
    res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': compressed.length });
    res.end(compressed);
  });
  const upstreamUrl = await listen(upstream);
  const proxy = http.createServer();
  proxy.on('connect', (req, client, head) => {
    count++; connectHeaders = req.headers;
    sockets.add(client); client.on('close', () => sockets.delete(client));
    const destination = new URL('http://' + req.url);
    const remote = net.connect({ host: destination.hostname, port: Number(destination.port) }, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) remote.write(head);
      client.pipe(remote); remote.pipe(client);
    });
    sockets.add(remote); remote.on('close', () => sockets.delete(remote));
    remote.on('error', () => client.destroy()); client.on('error', () => remote.destroy());
    client.on('close', () => remote.destroy());
  });
  const proxyUrl = await listen(proxy);
  t.after(async () => { for (const socket of sockets) socket.destroy(); await close(proxy); await close(upstream); });
  for (const provider of ['openai', 'gemini']) {
    const result = await gradeSubmission({ ...input, config: { ...input.config, provider, baseUrl: upstreamUrl + '/v1', proxyUrl } }, lesson);
    assert.equal(result.score, 90);
    assert.equal(seen.method, 'POST');
    assert.equal(connectHeaders.authorization, undefined);
    assert.equal(connectHeaders['x-goog-api-key'], undefined);
    if (provider === 'openai') {
      assert.equal(seen.url, '/v1/chat/completions');
      assert.equal(seen.headers.authorization, 'Bearer test-key-only');
      assert.equal(JSON.parse(seen.body.messages[1].content).studentCode, input.code);
    } else {
      assert.equal(seen.url, '/v1/models/test-model:generateContent');
      assert.equal(seen.headers['x-goog-api-key'], 'test-key-only');
      assert.equal(JSON.parse(seen.body.contents[0].parts[0].text).studentCode, input.code);
    }
  }
  assert.equal(count, 2);
});

test('代理拒绝连接与无响应超时会正确结束，不回显Key', async t => {
  const sockets = new Set();
  let mode = 'reject';
  const proxy = http.createServer();
  proxy.on('connect', (_req, socket) => {
    sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket));
    if (mode === 'reject') socket.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
  });
  const proxyUrl = await listen(proxy);
  t.after(async () => { for (const socket of sockets) socket.destroy(); await close(proxy); });
  const submission = { ...input, config: { ...input.config, baseUrl: 'https://api.example.test/v1', proxyUrl } };
  await assert.rejects(() => gradeSubmission(submission, lesson), e => e.status === 502 && !e.message.includes(input.config.apiKey));
  mode = 'hang';
  await assert.rejects(() => gradeSubmission(submission, lesson, { timeoutMs: 25 }), e => e.status === 504);
});
