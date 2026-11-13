import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createLocalConfigStore,DEFAULT_LOCAL_CONFIG,validateLocalConfig} from '../lib/local-config.mjs';
import {createApp} from '../server.mjs';

const config={provider:'gemini',baseUrl:'https://example.test/v1beta',model:'local-test-model',proxyUrl:'http://127.0.0.1:7897',apiKey:'test-only-not-a-real-key'};
async function fixture(t){
  const dir=await mkdtemp(path.join(os.tmpdir(),'zhixing-local-config-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const target=path.join(dir,'local-config','ai-settings.json');
  return {dir,target,store:createLocalConfigStore(target)};
}

test('本机 JSON 保存后跨实例读取，清除密钥保留配置，重置清除全部配置',async t=>{
  const {dir,target,store}=await fixture(t);
  assert.deepEqual(await store.execute({action:'read'}),{saved:false,config:{...DEFAULT_LOCAL_CONFIG}});
  assert.deepEqual(await readdir(dir),[]);
  await store.execute({action:'save',config:{...config,extra:'must not persist'}});
  const stored=JSON.parse(await readFile(target,'utf8'));
  assert.deepEqual(stored,{version:1,config});
  const next=createLocalConfigStore(target);
  assert.deepEqual(await next.execute({action:'read'}),{saved:true,config});
  await next.execute({action:'clear-key'});
  assert.deepEqual((await next.execute({action:'read'})).config,{...config,apiKey:''});
  assert.ok(!(await readFile(target,'utf8')).includes(config.apiKey));
  await next.execute({action:'reset'});
  assert.deepEqual(await next.execute({action:'read'}),{saved:true,config:{...DEFAULT_LOCAL_CONFIG}});
  assert.deepEqual(await readdir(path.dirname(target)),['ai-settings.json']);
});

test('配置操作串行执行，失败不阻塞后续保存且文件始终为完整 JSON',async t=>{
  const {target,store}=await fixture(t);
  await Promise.all([
    store.execute({action:'save',config}),
    store.execute({action:'save',config:{...config,model:'second'}}),
    store.execute({action:'clear-key'}),
  ]);
  assert.deepEqual(JSON.parse(await readFile(target,'utf8')).config,{...config,model:'second',apiKey:''});
  await assert.rejects(()=>store.execute({action:'save',config:{...config,apiKey:'x'.repeat(8193)}}));
  await store.execute({action:'save',config});
  assert.equal((await store.execute({action:'read'})).config.model,config.model);
});

test('配置字段校验拒绝异常类型、不安全地址与超长密钥，错误不回显数据',()=>{
  for(const invalid of [
    null,[],{...config,provider:'bad'}, {...config,apiKey:123}, {...config,apiKey:'test-secret\nINJECT'},
    {...config,baseUrl:'https://example.test?key=test-secret'}, {...config,baseUrl:'http://example.test'},
    {...config,proxyUrl:'http://user:test-secret@127.0.0.1'}, {...config,model:'m'.repeat(201)},
  ])assert.throws(()=>validateLocalConfig(invalid),error=>!error.message.includes('test-secret'));
  assert.equal(validateLocalConfig({...config,apiKey:''}).apiKey,'');
});

test('损坏配置不会泄露正文或静默覆盖，保存可恢复有效配置',async t=>{
  const {target,store}=await fixture(t);
  await store.execute({action:'save',config});
  await writeFile(target,'broken test-secret-do-not-echo');
  await assert.rejects(()=>store.execute({action:'read'}),error=>error.status===500&&!error.message.includes('test-secret'));
  await assert.rejects(()=>store.execute({action:'clear-key'}));
  assert.equal(await readFile(target,'utf8'),'broken test-secret-do-not-echo');
  await store.execute({action:'save',config});
  assert.equal((await store.execute({action:'read'})).saved,true);
});

test('配置目录无法写入时明确失败，保留已有文件且不留下临时密钥副本',async t=>{
  const {dir}=await fixture(t);
  const blocked=path.join(dir,'blocked');
  await writeFile(blocked,'keep this existing file');
  const store=createLocalConfigStore(path.join(blocked,'ai-settings.json'));
  await assert.rejects(()=>store.execute({action:'save',config}),error=>error.status===500&&!error.message.includes(config.apiKey));
  assert.equal(await readFile(blocked,'utf8'),'keep this existing file');
  assert.deepEqual(await readdir(dir),['blocked']);
});

test('本地配置接口要求同源 JSON POST，不对跨站、预览或静态资源暴露密钥',async t=>{
  const {target}=await fixture(t);
  const server=createApp({localConfigPath:target});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(body,headers={})=>fetch(base+'/api/local-config',{method:'POST',headers:{Origin:base,'Content-Type':'application/json','Sec-Fetch-Site':'same-origin',...headers},body:JSON.stringify(body)});
  assert.equal((await fetch(base+'/api/local-config')).status,405);
  for(const headers of [{Origin:'null'},{Origin:'https://evil.test'},{Origin:''},{'Sec-Fetch-Site':'cross-site'},{'Sec-Fetch-Site':'same-site'}])assert.equal((await post({action:'read'},headers)).status,403);
  assert.equal((await post({action:'read'},{'Content-Type':'text/plain'})).status,415);
  const save=await post({action:'save',config});assert.equal(save.status,200);
  assert.equal(save.headers.get('cache-control'),'no-store');
  assert.equal(save.headers.get('access-control-allow-origin'),null);
  const read=await post({action:'read'});assert.deepEqual(await read.json(),{saved:true,config});
  for(const resource of ['/local-config/ai-settings.json','/ai-settings.json','/lib/local-config.mjs']){
    const res=await fetch(base+resource);assert.equal(res.status,404);assert.ok(!(await res.text()).includes(config.apiKey));
  }
  assert.equal((await post({action:'clear-key'})).status,200);
  assert.equal((await (await post({action:'read'})).json()).config.apiKey,'');
  assert.equal((await post({action:'reset'})).status,200);
  assert.deepEqual((await (await post({action:'read'})).json()).config,{...DEFAULT_LOCAL_CONFIG});
});
