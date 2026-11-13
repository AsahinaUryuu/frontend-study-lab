// Learner JavaScript only runs in a Worker owned by an opaque-origin iframe.
// Blob workers inherit the creating document's Content Security Policy.
export const RUNNER_CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; worker-src blob:; connect-src 'none'; img-src 'none'; style-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export const PREVIEW_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; font-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export const MAX_OUTPUTS = 150;
export const MAX_OUTPUT_LENGTH = 4000;

const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// This function is stringified into the isolated Worker, with no parent scope.
export function workerBootstrap(options) {
  const send = self.postMessage.bind(self), nativeTimeout = self.setTimeout.bind(self);
  const nativeClearTimeout = self.clearTimeout.bind(self), nativeInterval = self.setInterval.bind(self);
  const nativeClearInterval = self.clearInterval.bind(self), nativeClose = self.close.bind(self);
  const timers = new Set(), intervals = new Set();
  let count = 0, finished = false, sourceFinished = false, settleTimer;
  function emit(event) {
    if (finished) return;
    if (event.type === 'log' || event.type === 'error') {
      if (count++ >= options.maxOutputs) {
        if (count === options.maxOutputs + 1) send({type:'log',level:'warn',text:'输出已达上限，后续输出已省略。'});
        return;
      }
      event.text = String(event.text ?? '').slice(0, options.maxLength);
    }
    send(event);
  }
  function format(value, seen = new Set(), depth = 0) {
    try {
      if (typeof value === 'string') return value;
      if (typeof value === 'bigint') return String(value)+'n';
      if (typeof value === 'symbol') return String(value);
      if (typeof value === 'function') return '[Function'+(value.name ? ': '+value.name : '')+']';
      if (value === null || typeof value !== 'object') return String(value);
      if (seen.has(value)) return '[Circular]';
      if (value instanceof Error) return value.name+': '+value.message;
      if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
      if (depth >= 3) return Array.isArray(value) ? '[Array]' : '[Object]';
      seen.add(value);
      let result;
      if (value instanceof Map) result='Map('+value.size+') '+format([...value.entries()],seen,depth+1);
      else if (value instanceof Set) result='Set('+value.size+') '+format([...value],seen,depth+1);
      else if (Array.isArray(value)) result='['+value.slice(0,20).map(v=>typeof v==='string'?JSON.stringify(v):format(v,seen,depth+1)).join(', ')+(value.length>20?', …':'')+']';
      else {
        const keys=Reflect.ownKeys(value), entries=keys.slice(0,20).map(key=>{
          const descriptor=Object.getOwnPropertyDescriptor(value,key);
          const content=descriptor && Object.hasOwn(descriptor,'value') ? (typeof descriptor.value==='string'?JSON.stringify(descriptor.value):format(descriptor.value,seen,depth+1)) : '[Getter/Setter]';
          return String(key)+': '+content;
        });
        result='{'+entries.join(', ')+(keys.length>20?', …':'')+'}';
      }
      seen.delete(value); return result;
    } catch { return '[无法显示的值]'; }
  }
  const logger={};
  for (const level of ['log','info','warn','error','debug','table','dir']) logger[level]=(...args)=>emit({type:'log',level:level==='table'||level==='dir'?'log':level,text:args.map(x=>format(x)).join(' ')});
  logger.assert=(condition,...args)=>{if(!condition)logger.error('Assertion failed:',...args);};
  logger.clear=()=>logger.info('—— console.clear ——');
  const clocks=new Map();
  logger.time=(label='default')=>clocks.set(label,performance.now());
  logger.timeEnd=(label='default')=>{if(clocks.has(label)){logger.log(label+': '+(performance.now()-clocks.get(label)).toFixed(2)+' ms');clocks.delete(label);}};
  self.console=logger;
  function report(error, event={}) {
    const stack=typeof error?.stack==='string'?error.stack:'';
    const found=stack.match(/learning-playground\.js:(\d+):(\d+)/);
    emit({type:'error',level:'error',text:error?.name ? error.name+': '+error.message : format(error),line:event.lineno||Number(found?.[1])||0,column:event.colno||Number(found?.[2])||0,stack:stack.slice(0,8000)});
  }
  function settle() {
    nativeClearTimeout(settleTimer);
    if (!sourceFinished || timers.size || intervals.size) return;
    // Give promise callbacks and unhandledrejection their end-of-turn delivery.
    settleTimer=nativeTimeout(()=>{
      if (finished || timers.size || intervals.size) return;
      emit({type:'status',state:'done',text:'同步代码与已登记的定时任务已结束。'});finished=true;nativeClose();
    },80);
  }
  self.setTimeout=(callback,delay=0,...args)=>{
    if(typeof callback!=='function')throw new TypeError('练习运行器的 setTimeout 需要函数作为第一个参数。');
    const id=nativeTimeout(()=>{timers.delete(id);try{callback(...args);}catch(error){report(error);}finally{settle();}},delay);
    timers.add(id);nativeClearTimeout(settleTimer);return id;
  };
  // Browsers share timer IDs; either clear API may cancel either timer kind.
  self.clearTimeout=id=>{timers.delete(id);intervals.delete(id);nativeClearTimeout(id);settle();};
  self.setInterval=(callback,delay=0,...args)=>{
    if(typeof callback!=='function')throw new TypeError('练习运行器的 setInterval 需要函数作为第一个参数。');
    const id=nativeInterval(()=>{try{callback(...args);}catch(error){report(error);}},delay);
    intervals.add(id);nativeClearTimeout(settleTimer);return id;
  };
  self.clearInterval=id=>{timers.delete(id);intervals.delete(id);nativeClearInterval(id);settle();};
  self.addEventListener('error',event=>{report(event.error||new Error(event.message),event);event.preventDefault();sourceFinished=true;settle();});
  self.addEventListener('unhandledrejection',event=>{report(event.reason);event.preventDefault();settle();});
  const blocked=()=>{throw new Error('本地练习运行器不提供网络请求或外部脚本加载。');};
  for(const name of ['fetch','XMLHttpRequest','WebSocket','EventSource','importScripts','Worker','SharedWorker']) {
    try { Object.defineProperty(self,name,{value:blocked,writable:false,configurable:false}); } catch {}
  }
  self.__learningSourceDone=()=>{sourceFinished=true;settle();};
}

export function buildWorkerSource(code, testCode = '') {
  const prefix=`(${workerBootstrap.toString()})(${JSON.stringify({maxOutputs:MAX_OUTPUTS,maxLength:MAX_OUTPUT_LENGTH})});\n`;
  const userStartLine=prefix.split('\n').length;
  const source=String(code??'');
  const tests=String(testCode??'');
  const testStartLine=userStartLine+source.split('\n').length+1;
  return {
    source:prefix+source+'\n;\n'+tests+'\n;self.__learningSourceDone();\n//# sourceURL=learning-playground.js',
    userStartLine,testStartLine,codeLines:source.split('\n').length,testLines:tests.split('\n').length
  };
}

// Only trusted runner code is embedded in srcdoc; learner code is messaged later.
function iframeBridge(token) {
  let worker=null, blobUrl='', sent=0;
  const tell=event=>parent.postMessage({channel:'zhixing-runner',token,event},'*');
  const cleanup=()=>{worker?.terminate();worker=null;if(blobUrl)URL.revokeObjectURL(blobUrl);blobUrl='';};
  addEventListener('pagehide',cleanup);
  addEventListener('message',event=>{
    if(event.source!==parent||event.data?.channel!=='zhixing-runner'||event.data?.token!==token)return;
    if(event.data.action==='stop'){cleanup();return;}
    if(event.data.action!=='run')return;
    if(worker)return;
    try {
      blobUrl=URL.createObjectURL(new Blob([event.data.source],{type:'text/javascript'}));
      worker=new Worker(blobUrl);
      worker.onmessage=e=>{
        if(++sent>180)return;
        const value=e.data;
        if(!value||!['log','error','status'].includes(value.type))return;
        tell(value);
      };
      worker.onerror=e=>{tell({type:'error',level:'error',text:e.message||'JavaScript 语法或运行错误',line:e.lineno||0,column:e.colno||0});tell({type:'status',state:'done',text:'运行因错误结束。'});e.preventDefault();worker.terminate();URL.revokeObjectURL(blobUrl);};
    } catch(error) {tell({type:'error',text:error.name+': '+error.message});tell({type:'status',state:'done',text:'运行环境未能启动。'});}
  });
  tell({type:'ready'});
}

export function buildSandboxDocument(token) {
  const serializedToken=JSON.stringify(String(token)).replace(/</g,'\\u003c');
  const script=`(${iframeBridge.toString()})(${serializedToken});`.replace(/<\/script/gi,'<\\/script');
  return '<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="'+escapeHtml(RUNNER_CSP)+'"></head><body><script>'+script+'</script></body></html>';
}

// Template contents are inert even before sanitation: parsing cannot fetch an
// image or iframe in the parent page. Do not replace this with DOMParser, whose
// detached documents can still start some resource requests.
export function buildPreviewDocument({html='',css=''}, document=globalThis.document) {
  if(!document?.createElement)throw new Error('当前浏览器不支持 HTML 预览。');
  const template=document.createElement('template');template.innerHTML=String(html);
  const root=template.content;
  root.querySelectorAll('script,base,meta,iframe,frame,frameset,object,embed,link,portal,animate,set,animateMotion,animateTransform').forEach(el=>el.remove());
  for(const el of root.querySelectorAll('*')) {
    for(const attr of [...el.attributes]) {
      const name=attr.name.toLowerCase();
      if(name.startsWith('on')||['srcdoc','action','formaction','target','ping','download','xlink:href'].includes(name))el.removeAttribute(attr.name);
      if(name==='href'&&(['a','area'].includes(el.localName)||!attr.value.startsWith('#')))el.removeAttribute(attr.name);
    }
  }
  const safeCss=String(css).replace(/<\/style/gi,'<\\/style');
  return '<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="'+escapeHtml(PREVIEW_CSP)+'"><style>'+safeCss+'</style></head><body>'+template.innerHTML+'</body></html>';
}

export function mapRunnerLocation(event, metadata) {
  const raw=Number(event.line)||0;
  if(!raw)return {...event,line:0,column:Number(event.column)||0};
  if(raw>=metadata.testStartLine&&raw<metadata.testStartLine+metadata.testLines)return {...event,line:raw-metadata.testStartLine+1,source:'test'};
  if(raw>=metadata.userStartLine&&raw<metadata.userStartLine+metadata.codeLines)return {...event,line:raw-metadata.userStartLine+1,source:'code'};
  return {...event,line:0,column:0};
}

export function createRunner({previewHost,onEvent=()=>{},timeoutMs=3000}={}) {
  if(!previewHost?.ownerDocument)throw new TypeError('需要提供预览容器。');
  const doc=previewHost.ownerDocument,win=doc.defaultView;
  const duration=Math.max(200,Math.min(3000,Number(timeoutMs)||3000));
  let iframe=null,timeout=null,handler=null,destroyed=false,generation=0,running=false,activeToken='';
  const emit=event=>onEvent(event);
  const alive=()=>{if(destroyed)throw new Error('运行器已关闭。');};
  function cleanup(){
    generation++;if(timeout!==null)win.clearTimeout(timeout);timeout=null;
    if(handler)win.removeEventListener('message',handler);handler=null;
    if(iframe&&activeToken)iframe.contentWindow?.postMessage({channel:'zhixing-runner',token:activeToken,action:'stop'},'*');
    iframe?.remove();iframe=null;running=false;activeToken='';
  }
  function stop(){const wasRunning=running;cleanup();previewHost.replaceChildren();if(wasRunning)emit({type:'status',state:'stopped',text:'已停止运行。'});}
  return {
    runJavaScript(code,testCode='') {
      alive();stop();
      if(String(code).length>30000||String(testCode).length>10000)throw new RangeError('练习代码或试运行代码超过长度限制。');
      const metadata=buildWorkerSource(code,testCode), token=win.crypto.randomUUID();
      activeToken=token;
      const ownGeneration=++generation;let received=0,started=false;
      iframe=doc.createElement('iframe');iframe.hidden=true;iframe.setAttribute('sandbox','allow-scripts');iframe.setAttribute('referrerpolicy','no-referrer');iframe.title='隔离的 JavaScript 运行环境';
      const frame=iframe;
      handler=event=>{
        if(ownGeneration!==generation||event.source!==frame.contentWindow||event.data?.channel!=='zhixing-runner'||event.data?.token!==token)return;
        const payload=event.data.event;if(!payload||typeof payload!=='object')return;
        if(payload.type==='ready'){
          if(started)return;started=true;
          frame.contentWindow.postMessage({channel:'zhixing-runner',token,action:'run',source:metadata.source},'*');return;
        }
        if(!['log','error','status'].includes(payload.type)||++received>180)return;
        const clean={type:payload.type,text:String(payload.text??'').slice(0,MAX_OUTPUT_LENGTH),level:['log','info','warn','error','debug'].includes(payload.level)?payload.level:'log'};
        if(payload.type==='status'){
          if(payload.state!=='done')return;
          clean.state='done';cleanup();emit(clean);return;
        }
        if(payload.type==='error')Object.assign(clean,mapRunnerLocation({line:Number(payload.line)||0,column:Number(payload.column)||0},metadata));
        emit(clean);
      };
      win.addEventListener('message',handler);running=true;emit({type:'status',state:'running',text:'正在本机运行…'});
      timeout=win.setTimeout(()=>{if(ownGeneration!==generation)return;cleanup();emit({type:'status',state:'timeout',text:`运行达到 ${duration/1000} 秒上限，已停止。请检查死循环或尚未结束的定时任务。`});},duration);
      iframe.srcdoc=buildSandboxDocument(token);previewHost.append(iframe);
    },
    preview({html='',css=''}={}) {
      alive();stop();
      if(String(html).length>50000||String(css).length>30000)throw new RangeError('预览内容超过长度限制。');
      iframe=doc.createElement('iframe');iframe.className='runner-preview-frame';iframe.title='HTML 和 CSS 效果预览';iframe.setAttribute('sandbox','');iframe.setAttribute('referrerpolicy','no-referrer');
      iframe.srcdoc=buildPreviewDocument({html,css},doc);previewHost.append(iframe);
      emit({type:'status',state:'done',text:'预览已更新。HTML/CSS 预览不执行脚本，也不加载外部资源。'});
    },
    stop,
    destroy(){if(destroyed)return;cleanup();previewHost.replaceChildren();destroyed=true;}
  };
}
