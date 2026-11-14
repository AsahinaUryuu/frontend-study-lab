import http from 'node:http';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { GradeError, gradeSubmission } from './lib/grade.mjs';
import { listModels } from './lib/models.mjs';
import { tutorReply } from './lib/tutor.mjs';
import { createLocalConfigStore } from './lib/local-config.mjs';
import {createProgressStore,MAX_PROGRESS_BYTES} from './lib/progress.mjs';
import {handleProgressHistory} from './lib/progress-http.mjs';
import {createRemoteAccess,requireSameOrigin,privateConfig,hydrateModelRequest} from './lib/remote-access.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function json(res, status, value) {
  res.writeHead(status, { 'content-type': types['.json'], 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(value));
}

async function readBody(req, limit = 100 * 1024) {
  if (Number(req.headers['content-length']) > limit) throw new GradeError(`请求内容超过 ${Math.round(limit/1024)} KB。`, 413);
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new GradeError(`请求内容超过 ${Math.round(limit/1024)} KB。`, 413);
    chunks.push(chunk);
  }
  try {
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result;
  } catch { throw new GradeError('请求不是有效的 JSON 对象。'); }
}

async function findLesson(publicDir, id) {
  if (typeof id !== 'string' || !/^[a-z0-9-]{1,100}$/.test(id)) throw new GradeError('课程编号无效。');
  const dataDir = path.join(publicDir, 'data');
  for (const file of await readdir(dataDir)) {
    if (!file.endsWith('.json')) continue;
    const contents = JSON.parse(await readFile(path.join(dataDir, file), 'utf8'));
    if (!Array.isArray(contents)) continue;
    const lesson = contents.find(item => item.id === id && item.challenge);
    if (lesson) return lesson;
  }
  throw new GradeError('未找到该课程的代码实操题。', 404);
}

async function findTextbook(publicDir,id){
  const bookDir=path.join(publicDir,'textbook');
  let names;try{names=await readdir(bookDir);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  for(const name of names){if(!name.endsWith('.json'))continue;const books=JSON.parse(await readFile(path.join(bookDir,name),'utf8'));if(books?.[id])return books[id];}
  return null;
}

export function createApp({ publicDir = path.join(directory, 'public'), fetchImpl, timeoutMs, localConfigPath = path.join(directory,'local-config','ai-settings.json'), progressPath=path.join(directory,'local-config','study-progress.json'), publicOrigin=process.env.PUBLIC_ORIGIN||'', accessToken=process.env.ACCESS_TOKEN||'' } = {}) {
  const localConfig=createLocalConfigStore(localConfigPath),progressStore=createProgressStore(progressPath);
  const access=createRemoteAccess({publicOrigin,accessToken,appId:'frontend'});
  return http.createServer(async (req, res) => {
    try {
      if(!access.accept(req,res))return;
      const requested = decodeURIComponent((req.url || '/').split('?')[0]);
      if (requested.includes('\0') || requested.includes('\\') || requested.split('/').some(p => p === '..' || p.startsWith('.'))) {
        throw new GradeError('不可访问此路径。', 403);
      }
      if (requested === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true, service: 'frontend-academy', version:'1.11.0' });
      if(await handleProgressHistory(req,res,{requested,store:progressStore,readBody,json}))return;
      if(requested==='/api/progress'){
        if(req.method==='GET'){requireSameOrigin(req,{requireOrigin:false});return json(res,200,await progressStore.read());}
        if(req.method!=='POST')throw new GradeError('学习记录使用 GET 或 POST。',405);
        requireSameOrigin(req);
        if(!(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))throw new GradeError('请使用 JSON 提交学习记录。',415);
        return json(res,200,await progressStore.save(await readBody(req,MAX_PROGRESS_BYTES)));
      }
      if (requested === '/api/local-config') {
        if (req.method !== 'POST') return json(res, 405, { error: '请使用 POST 访问本地配置。' });
        requireSameOrigin(req);
        if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new GradeError('请使用 JSON 提交请求。', 415);
        return json(res, 200, await privateConfig(localConfig,await readBody(req),access.remote));
      }
      if (requested === '/api/grade' || requested === '/api/models' || requested === '/api/tutor') {
        if (req.method !== 'POST') return json(res, 405, { error: '请使用 POST 提交请求。' });
        requireSameOrigin(req);
        if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new GradeError('请使用 JSON 提交请求。', 415);
        const input = await hydrateModelRequest(localConfig,await readBody(req,requested==='/api/models'?100*1024:1024*1024),access.remote);
        if (requested === '/api/models') return json(res, 200, await listModels(input, { fetchImpl, timeoutMs }));
        const lesson = await findLesson(publicDir, input.lessonId);
        if(requested==='/api/tutor')return json(res,200,await tutorReply(input,lesson,await findTextbook(publicDir,lesson.id),{fetchImpl,timeoutMs}));
        if(input.submission===undefined&&typeof input.code==='string'&&input.code.length>100*1024)throw new GradeError('请求代码内容过大。',413);
        return json(res, 200, await gradeSubmission(input, lesson, { fetchImpl, timeoutMs }));
      }
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: '不支持的请求方法。' });
      const relative = requested === '/' ? '/index.html' : requested;
      const mime = types[path.extname(relative).toLowerCase()];
      if (!mime) return json(res, 404, { error: '页面不存在。' });
      const root = await realpath(publicDir);
      const target = await realpath(path.join(root, relative));
      if (!target.startsWith(root + path.sep)) throw new GradeError('不可访问此路径。', 403);
      if (!(await stat(target)).isFile()) return json(res, 404, { error: '页面不存在。' });
      const body = await readFile(target);
      res.writeHead(200, { 'content-type': mime, 'content-length': body.length,
        'cache-control': 'no-cache', 'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer', 'x-frame-options': 'SAMEORIGIN' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      if (res.headersSent) return res.end();
      if (error instanceof URIError) return json(res, 400, { error: '请求地址编码无效。' });
      if (error.code === 'ENOENT') return json(res, 404, { error: '文件不存在。' });
      json(res, error instanceof GradeError ? error.status : 500,
        { error: error instanceof GradeError ? error.message : '服务处理失败，请稍后重试。',...(error.current?{current:error.current}:{}) });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 4318);
  if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error('PORT 必须为 1 到 65535 的端口号。'); process.exit(1); }
  const server = createApp();
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用。若学习软件已启动，请直接打开浏览器；否则设置 PORT 后重试。` : '本地服务启动失败。');
    process.exitCode = 1;
  });
  server.listen(port, process.env.HOST||'127.0.0.1', () => {
    const address = `http://127.0.0.1:${port}`;
    console.log(`前端学习软件已启动：${address}\n关闭此窗口或按 Ctrl+C 可停止。`);
    if (process.argv.includes('--open') && process.platform === 'win32') {
      const child = spawn('cmd.exe', ['/d', '/c', 'start', '', address], { windowsHide: true, stdio: 'ignore' });
      child.on('error', () => console.log('请在浏览器中手动打开上面的地址。'));
    }
  });
}
