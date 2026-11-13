import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { createApp } from '../server.mjs';
import { listModels, normalizeModelsConfig } from '../lib/models.mjs';
import { normalizeConfig } from '../lib/grade.mjs';

const apiKey = 'mock-models-key-not-a-secret';
function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}
function close(server) { return new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
async function mock(t, handler) {
  const server = http.createServer(handler);
  const url = await listen(server);
  t.after(() => close(server));
  return url;
}
function json(res, value, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

test('列表无需模型名，Base URL、models 和完整生成链接保留自定义路径，并可继续评分', () => {
  for (const [provider, bases, root, grade] of [
    ['openai', ['/relay/v1/', '/relay/v1/models/', '/relay/v1/chat/completions/'], '/relay/v1', '/chat/completions'],
    ['gemini', ['/relay/v1beta/', '/relay/v1beta/models/', '/relay/v1beta/models/old:generateContent/'], '/relay/v1beta', '/models/chosen:generateContent']
  ]) {
    for (const suffix of bases) {
      const config = { provider, apiKey, baseUrl: 'https://example.test' + suffix };
      assert.equal(normalizeModelsConfig(config).endpoint, 'https://example.test' + root + '/models');
      assert.equal(normalizeConfig({ ...config, model: 'chosen' }).endpoint, 'https://example.test' + root + grade);
    }
  }
  assert.equal(normalizeModelsConfig({ provider: 'openai', apiKey }).endpoint, 'https://api.openai.com/v1/models');
  assert.equal(normalizeModelsConfig({ provider: 'gemini', apiKey }).endpoint, 'https://generativelanguage.googleapis.com/v1beta/models');
  assert.equal(normalizeModelsConfig({ provider: 'openai', apiKey, baseUrl: 'https://example.test/models' }).endpoint, 'https://example.test/models');
  for (const baseUrl of ['http://example.test/v1', 'https://name:key@example.test/v1', 'https://example.test/v1?key=secret', 'file:///models']) {
    assert.throws(() => normalizeModelsConfig({ provider: 'openai', apiKey, baseUrl }));
  }
  assert.throws(() => normalizeModelsConfig({ provider: 'openai', baseUrl: 'https://example.test/v1' }));
});

test('真实本机 OpenAI 模型列表携带 Bearer、去重排序并忽略坏数据', async t => {
  const calls = [];
  const baseUrl = await mock(t, (req, res) => {
    calls.push({ method: req.method, url: req.url, headers: req.headers });
    json(res, { data: [{ id: 'z-model' }, { id: 'a-model', name: '可读名称' }, { id: 'z-model' }, {}, null, { id: 'bad\nmodel' }] });
  });
  for (const suffix of ['/custom/v1', '/custom/v1/models', '/custom/v1/chat/completions']) {
    const result = await listModels({ config: { provider: 'openai', baseUrl: baseUrl + suffix, apiKey } });
    assert.deepEqual(result, { models: [{ id: 'a-model', name: '可读名称' }, { id: 'z-model', name: 'z-model' }], endpoint: baseUrl + '/custom/v1/models' });
  }
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.method, 'GET');
    assert.equal(call.url, '/custom/v1/models');
    assert.equal(call.headers.authorization, `Bearer ${apiKey}`);
    assert.equal(call.headers['x-goog-api-key'], undefined);
  }
});

test('Gemini 使用 x-goog-api-key、分页去重和能力过滤，保留显示名称', async t => {
  const calls = [];
  const token = 'next+/=&?';
  const baseUrl = await mock(t, (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    calls.push(url);
    assert.equal(req.headers['x-goog-api-key'], apiKey);
    assert.equal(req.headers.authorization, undefined);
    assert.equal(url.searchParams.get('pageSize'), '1000');
    if (!url.searchParams.has('pageToken')) {
      json(res, { models: [{ name: 'models/z-gemini', displayName: 'Z Gemini', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/embed', supportedGenerationMethods: ['embedContent'] }, { name: 'models/disabled', supportedGenerationMethods: [] }], nextPageToken: token });
    } else {
      assert.equal(url.searchParams.get('pageToken'), token);
      json(res, { models: [{ name: 'models/a-gemini', displayName: 'A Gemini' }, { name: 'models/z-gemini', displayName: 'duplicate' }] });
    }
  });
  const result = await listModels({ config: { provider: 'gemini', baseUrl: baseUrl + '/v1beta/models/old:generateContent', apiKey } });
  assert.deepEqual(result.models, [{ id: 'a-gemini', name: 'A Gemini' }, { id: 'z-gemini', name: 'Z Gemini' }]);
  assert.equal(result.endpoint, baseUrl + '/v1beta/models');
  assert.equal(result.truncated, undefined);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(url => url.pathname === '/v1beta/models' && !url.searchParams.has('key')));
});

test('合法空列表可以返回，格式错误、鉴权和404错误不回显上游正文或密钥', async t => {
  let status = 200, body = { data: [] };
  const baseUrl = await mock(t, (_req, res) => json(res, body, status));
  const config = { provider: 'openai', baseUrl, apiKey };
  assert.deepEqual((await listModels({ config })).models, []);
  body = {};
  assert.deepEqual((await listModels({ config: { ...config, provider: 'gemini' } })).models, []);
  for (const code of [200, 400, 401, 403, 404, 429, 500]) {
    status = code;
    body = { error: `upstream-debug ${apiKey}` };
    await assert.rejects(() => listModels({ config }), error => {
      assert.equal(error.status, 502);
      assert.ok(!error.message.includes(apiKey) && !error.message.includes('upstream-debug'));
      if (code === 404) assert.match(error.message, /手动填写/);
      if (code === 401) assert.match(error.message, /API Key/);
      return true;
    });
  }
});

test('本机列表超时与响应大小限制会中止请求，不回显上游内容', async t => {
  let mode = 'hang';
  const baseUrl = await mock(t, (_req, res) => {
    if (mode === 'oversize') json(res, { data: [], ignored: 'x'.repeat(1024 * 1024) });
    if (mode === 'bad-json') res.end('upstream-debug ' + apiKey);
    if (mode === 'partial') { res.writeHead(200); res.write('{"data":['); }
  });
  const input = { config: { provider: 'openai', baseUrl, apiKey } };
  await assert.rejects(() => listModels(input, { timeoutMs: 30 }), error => error.status === 504);
  mode = 'partial';
  await assert.rejects(() => listModels(input, { timeoutMs: 30 }), error => error.status === 504);
  for (mode of ['oversize', 'bad-json']) {
    await assert.rejects(() => listModels(input), error => error.status === 502 && !error.message.includes(apiKey));
  }
});

test('Gemini 重复页码、过多页与1000模型上限均明确标为截断', async t => {
  let calls = 0, mode = 'loop';
  const baseUrl = await mock(t, (_req, res) => {
    calls++;
    const models = mode === 'many' ? Array.from({ length: 1001 }, (_, i) => ({ name: 'models/g-' + i })) : [{ name: 'models/g-' + calls }];
    json(res, { models, nextPageToken: mode === 'loop' ? 'same' : 'page-' + calls });
  });
  const input = { config: { provider: 'gemini', baseUrl } };
  let result = await listModels(input);
  assert.equal(calls, 2);
  assert.equal(result.truncated, true);
  mode = 'pages'; calls = 0;
  result = await listModels(input);
  assert.equal(calls, 20);
  assert.equal(result.truncated, true);
  mode = 'many'; calls = 0;
  result = await listModels(input);
  assert.equal(calls, 1);
  assert.equal(result.models.length, 1000);
  assert.equal(result.truncated, true);
});

test('模型API只接受同源JSON POST，未授权请求不会触发上游读取', async t => {
  let calls = 0;
  const upstreamUrl = await mock(t, (_req, res) => { calls++; json(res, { data: [{ id: 'local-model' }] }); });
  const app = createApp();
  const appUrl = await listen(app);
  t.after(() => close(app));
  const body = JSON.stringify({ config: { provider: 'openai', baseUrl: upstreamUrl } });
  const post = { method: 'POST', headers: { origin: appUrl, 'content-type': 'application/json' }, body };
  assert.equal((await fetch(appUrl + '/api/models')).status, 405);
  assert.equal((await fetch(appUrl + '/api/models', { ...post, headers: { ...post.headers, origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(appUrl + '/api/models', { ...post, headers: { ...post.headers, 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await fetch(appUrl + '/api/models', { ...post, body: 'x'.repeat(102401) })).status, 413);
  assert.equal(calls, 0);
  const response = await fetch(appUrl + '/api/models', post);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await response.json()).models, [{ id: 'local-model', name: 'local-model' }]);
  assert.equal(calls, 1);
});

test('模型列表经过真实本机CONNECT代理，密钥仅发送给上游', async t => {
  const upstreamUrl = await mock(t, (req, res) => {
    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/v1/models');
    assert.equal(req.headers.authorization, `Bearer ${apiKey}`);
    json(res, { data: [{ id: 'via-proxy' }] });
  });
  const sockets = new Set();
  let connects = 0;
  const proxy = http.createServer();
  proxy.on('connect', (req, client, head) => {
    connects++;
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers['x-goog-api-key'], undefined);
    const destination = new URL('http://' + req.url);
    const remote = net.connect({ host: destination.hostname, port: Number(destination.port) }, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) remote.write(head);
      client.pipe(remote); remote.pipe(client);
    });
    for (const socket of [client, remote]) {
      sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    }
    remote.on('error', () => client.destroy()); client.on('error', () => remote.destroy());
    client.on('close', () => remote.destroy());
  });
  const proxyUrl = await listen(proxy);
  t.after(async () => { for (const socket of sockets) socket.destroy(); await close(proxy); });
  const result = await listModels({ config: { provider: 'openai', baseUrl: upstreamUrl, apiKey, proxyUrl } });
  assert.deepEqual(result.models, [{ id: 'via-proxy', name: 'via-proxy' }]);
  assert.equal(connects, 1);
});
