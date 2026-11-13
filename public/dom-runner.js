import {parse} from './vendor/acorn.js';

const MAX_OUTPUTS=150, MAX_LENGTH=4000;
const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const inlineScript=value=>String(value).replace(/<\/script/gi,'<\\/script');
const serialized=value=>JSON.stringify(value).replace(/</g,'\\u003c');
export const domCsp=nonce=>`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; connect-src 'none'; font-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;

/** Insert guards at AST statement boundaries; never rewrite strings/comments.
 * No newlines are inserted, so learner line numbers remain stable. This protects
 * ordinary accidental loops/recursion, not arbitrary hostile or expensive native
 * operations. Opaque-origin sandbox/CSP form the actual isolation boundary.
 */
export function instrumentDomJavaScript(source,guardName='__learningGuard'){
  const code=String(source??'');
  let tree;
  try{tree=parse(code,{ecmaVersion:'latest',sourceType:'script',locations:true,allowHashBang:true});}
  catch(error){error.line=error.loc?.line||0;error.column=(error.loc?.column??-1)+1;throw error;}
  const inserts=[];
  const add=(at,text,priority=0)=>inserts.push({at,text,priority});
  const tick=`${guardName}();`;
  function walk(node){
    if(!node||typeof node!=='object')return;
    if(['ForStatement','ForInStatement','ForOfStatement','WhileStatement','DoWhileStatement'].includes(node.type)){
      const body=node.body;
      if(body.type==='BlockStatement')add(body.start+1,tick);
      else{add(body.start,'{'+tick,1);add(body.end,'}',-1);}
    }
    if(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(node.type)){
      if(node.body.type==='BlockStatement'){
        // Preserve directive prologues, including "use strict".
        let at=node.body.start+1;
        for(const statement of node.body.body){if(statement.type==='ExpressionStatement'&&statement.directive)at=statement.end;else break;}
        add(at,';'+tick);
      }else{
        add(node.body.start,`(${guardName}(),`,1);add(node.body.end,')',-1);
      }
    }
    for(const [key,value] of Object.entries(node)){
      if(['start','end','loc'].includes(key))continue;
      if(Array.isArray(value))for(const item of value)walk(item);
      else if(value&&typeof value==='object')walk(value);
    }
  }
  walk(tree);
  inserts.sort((a,b)=>b.at-a.at||a.priority-b.priority);
  let result=code;for(const item of inserts)result=result.slice(0,item.at)+item.text+result.slice(item.at);
  return result;
}

// Serialized into the preview realm. It does not capture app data or secrets.
export function domBootstrap(options){
  const send=parent.postMessage.bind(parent), now=performance.now.bind(performance);
  const nativeTimeout=setTimeout.bind(window), nativeClearTimeout=clearTimeout.bind(window);
  let outputCount=0,ticks=0,deadline=0,resetJob=0;
  function emit(event){
    if(event.type==='log'||event.type==='error'){
      if(outputCount++>=options.maxOutputs){
        if(outputCount===options.maxOutputs+1)send({channel:'zhixing-dom',token:options.token,event:{type:'log',level:'warn',text:'输出已达上限，后续输出已省略。重新运行可清空计数。'}},'*');
        return;
      }
      event.text=String(event.text??'').slice(0,options.maxLength);
    }
    send({channel:'zhixing-dom',token:options.token,event},'*');
  }
  function format(value,seen=new Set(),depth=0){
    try{
      if(typeof value==='string')return value;
      if(typeof value==='bigint')return String(value)+'n';
      if(value===null||typeof value!=='object')return String(value);
      if(value instanceof Error)return value.name+': '+value.message;
      if(value instanceof Element)return '<'+value.localName+(value.id?'#'+value.id:'')+'>';
      if(seen.has(value))return '[Circular]';
      if(depth>=3)return Array.isArray(value)?'[Array]':'[Object]';
      seen.add(value);
      const entries=Reflect.ownKeys(value).slice(0,20).map(key=>{
        const desc=Object.getOwnPropertyDescriptor(value,key);
        return String(key)+': '+(desc&&Object.hasOwn(desc,'value')?format(desc.value,seen,depth+1):'[Getter/Setter]');
      });
      seen.delete(value);return (Array.isArray(value)?'[':'{')+entries.join(', ')+(Array.isArray(value)?']':'}');
    }catch{return '[无法显示的值]';}
  }
  const logger={};
  for(const level of ['log','info','warn','error','debug','table','dir'])logger[level]=(...args)=>emit({type:'log',level:['table','dir'].includes(level)?'log':level,text:args.map(x=>format(x)).join(' ')});
  logger.assert=(condition,...args)=>{if(!condition)logger.error('Assertion failed:',...args);};
  logger.clear=()=>logger.info('—— console.clear ——');
  const clocks=new Map();logger.time=(label='default')=>clocks.set(label,now());
  logger.timeEnd=(label='default')=>{if(clocks.has(label)){logger.log(label+': '+(now()-clocks.get(label)).toFixed(2)+' ms');clocks.delete(label);}};
  window.console=logger;
  function guard(){
    if(!deadline){deadline=now()+800;ticks=0;resetJob=nativeTimeout(()=>{deadline=0;ticks=0;},0);}
    if(++ticks>100000||((ticks&255)===0&&now()>deadline)){
      const error=new Error('本次连续执行过久，已中断。请检查无限循环、递归或过密的事件调用。');
      error.name='ExecutionLimitError';throw error;
    }
  }
  Object.defineProperty(window,options.guardName,{value:guard,writable:false,configurable:false});
  function report(reason,event={}){
    const stack=typeof reason?.stack==='string'?reason.stack:'';
    const match=stack.match(/learning-dom-(js|html-\d+|handler-\d+)\.js:(\d+):(\d+)/);
    const filename=String(event.filename||'');
    const fileMatch=filename.match(/learning-dom-(js|html-\d+|handler-\d+)\.js/);
    const key=fileMatch?.[1]||match?.[1]||'js';
    const line=Number(event.lineno)||Number(match?.[2])||0;
    const offset=options.locations[key]||0;
    emit({type:'error',level:'error',text:reason?.name?reason.name+': '+reason.message:format(reason),source:key==='js'?'javascript':'html',line:line?Math.max(1,line+offset):0,column:Number(event.colno)||Number(match?.[3])||0});
  }
  addEventListener('error',event=>{report(event.error||new Error(event.message),event);event.preventDefault();});
  addEventListener('unhandledrejection',event=>{report(event.reason);event.preventDefault();});
  const blocked=()=>{throw new Error('联动预览不提供网络、外部脚本或新窗口；请使用本地 HTML、CSS 和 JavaScript。');};
  for(const name of ['fetch','XMLHttpRequest','WebSocket','EventSource','Worker','SharedWorker','open']){
    try{Object.defineProperty(window,name,{value:blocked,writable:false,configurable:false});}catch{}
  }
  // Keep navigational controls inside the learning surface. Form event handlers
  // still run, including preventDefault and validation; no request is submitted.
  addEventListener('submit',event=>event.preventDefault(),true);
  addEventListener('click',event=>{if(event.target?.closest?.('a,area'))event.preventDefault();},true);
  addEventListener('DOMContentLoaded',()=>emit({type:'status',state:'ready',text:'联动预览已就绪，可以点击按钮、输入表单并观察结果。'}),{once:true});
  addEventListener('pagehide',()=>nativeClearTimeout(resetJob),{once:true});
}

export function buildDomDocument({html='',css='',javascript='',token='preview',nonce='previewnonce'}={},doc=globalThis.document){
  if(!doc?.createElement)throw new Error('当前浏览器不支持联动预览。');
  const guardName='__learningGuard_'+String(token).replace(/[^a-zA-Z0-9_]/g,'');
  const locations={js:0},warnings=[];
  const template=doc.createElement('template');template.innerHTML=String(html);
  const root=template.content;
  root.querySelectorAll('base,meta,iframe,frame,frameset,object,embed,link,portal,animate,set,animateMotion,animateTransform').forEach(el=>el.remove());
  let scriptNumber=0,handlerNumber=0;
  function compile(source,key,lineOffset=0){
    locations[key]=lineOffset;
    try{return instrumentDomJavaScript(source,guardName)+'\n//# sourceURL=learning-dom-'+key+'.js';}
    catch(error){error.source=key==='js'?'javascript':'html';error.line=(error.line||0)+lineOffset;throw error;}
  }
  const original=String(html);let searchFrom=0;
  for(const script of root.querySelectorAll('script')){
    const key='html-'+(++scriptNumber),source=script.textContent;
    const index=original.indexOf(source,searchFrom);searchFrom=index<0?searchFrom:index+source.length;
    const offset=index<0?0:original.slice(0,index).split('\n').length-1;
    if(script.hasAttribute('src')||!['','text/javascript','application/javascript'].includes((script.getAttribute('type')||'').toLowerCase())){
      warnings.push('已跳过外部脚本或模块脚本；请把原生 JavaScript 放入 JavaScript 面板。');script.remove();continue;
    }
    const replacement=doc.createElement('script');replacement.setAttribute('nonce',nonce);replacement.textContent=inlineScript(compile(source,key,offset));script.replaceWith(replacement);
  }
  const handlers=[];
  for(const el of root.querySelectorAll('*')){
    for(const attr of [...el.attributes]){
      const name=attr.name.toLowerCase();
      if(name.startsWith('on')){
        el.removeAttribute(attr.name);
        const key='handler-'+(++handlerNumber);
        el.setAttribute('data-learning-handler-'+handlerNumber,'');
        const lineOffset=Math.max(0,original.slice(0,Math.max(0,original.indexOf(attr.value))).split('\n').length-1);
        // A real function preserves this/event and inline-handler return false.
        const body='document.querySelector("[data-learning-handler-'+handlerNumber+']").addEventListener('+JSON.stringify(name.slice(2))+',function(event){const result=(function(event){'+attr.value+'\n}).call(this,event);if(result===false)event.preventDefault();});';
        handlers.push(compile(body,key,lineOffset));
      }
      if(['srcdoc','action','formaction','target','ping','download','xlink:href'].includes(name))el.removeAttribute(attr.name);
      if(name==='href'&&(!attr.value.startsWith('#')||['a','area'].includes(el.localName)))el.removeAttribute(attr.name);
      if(['src','poster','background'].includes(name)&&!/^data:|^blob:/i.test(attr.value))el.removeAttribute(attr.name);
    }
  }
  const js=compile(String(javascript),'js');
  const options={token,guardName,locations,maxOutputs:MAX_OUTPUTS,maxLength:MAX_LENGTH};
  const bootstrap=inlineScript('('+domBootstrap.toString()+')('+serialized(options)+');');
  const trusted=body=>'<script nonce="'+escapeHtml(nonce)+'">'+inlineScript(body)+'</script>';
  const safeCss=String(css).replace(/<\/style/gi,'<\\/style');
  const document='<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="'+escapeHtml(domCsp(nonce))+'">'+trusted(bootstrap)+'<style>'+safeCss+'</style></head><body>'+template.innerHTML+handlers.map(trusted).join('')+trusted(js)+'</body></html>';
  return {document,warnings};
}

export function createDomRunner({previewHost,onEvent=()=>{}}={}){
  if(!previewHost?.ownerDocument)throw new TypeError('需要提供联动预览容器。');
  const doc=previewHost.ownerDocument,win=doc.defaultView;
  let frame=null,listener=null,destroyed=false,active=false,loadTimer=null;
  function cleanup(){
    if(loadTimer!==null)win.clearTimeout(loadTimer);loadTimer=null;
    if(listener)win.removeEventListener('message',listener);listener=null;
    frame?.remove();frame=null;active=false;
  }
  function stop(){const wasActive=active;cleanup();if(wasActive)onEvent({type:'status',state:'stopped',text:'联动预览已停止。'});}
  return {
    run({html='',css='',javascript=''}={}){
      if(destroyed)throw new Error('联动预览已关闭。');
      stop();
      if([html,css].some(value=>typeof value!=='string'||value.length>30000)||typeof javascript!=='string'||javascript.length>40003)throw new RangeError('HTML/CSS 各最多 30,000 字符；JavaScript 与调用示例合计最多 40,003 字符。');
      const token=win.crypto.randomUUID(),nonce=win.crypto.randomUUID().replaceAll('-','');
      let built;
      try{built=buildDomDocument({html,css,javascript,token,nonce},doc);}
      catch(error){onEvent({type:'error',level:'error',text:error.name+': '+error.message,source:error.source||'javascript',line:error.line||0,column:error.column||0});onEvent({type:'status',state:'error',text:'请修正代码后重新运行。'});return;}
      const current=doc.createElement('iframe');frame=current;current.className='runner-preview-frame';current.title='HTML、CSS 和 JavaScript 联动预览';
      current.setAttribute('sandbox','allow-scripts');current.setAttribute('referrerpolicy','no-referrer');
      let received=0;
      listener=event=>{
        if(frame!==current||event.source!==current.contentWindow||event.data?.channel!=='zhixing-dom'||event.data?.token!==token)return;
        const value=event.data.event;if(!value||typeof value!=='object')return;
        if(value.type==='status'&&value.state==='ready'){
          if(loadTimer!==null)win.clearTimeout(loadTimer);loadTimer=null;onEvent({type:'status',state:'ready',text:'联动预览已就绪，可以操作页面。'});return;
        }
        if(!['log','error'].includes(value.type)||++received>MAX_OUTPUTS+1)return;
        const clean={type:value.type,level:['log','info','warn','error','debug'].includes(value.level)?value.level:'log',text:String(value.text??'').slice(0,MAX_LENGTH)};
        if(value.type==='error')Object.assign(clean,{source:value.source==='html'?'html':'javascript',line:Math.max(0,Number(value.line)||0),column:Math.max(0,Number(value.column)||0)});
        onEvent(clean);
      };
      win.addEventListener('message',listener);active=true;
      onEvent({type:'status',state:'running',text:'正在更新联动预览…'});
      for(const warning of built.warnings)onEvent({type:'log',level:'warn',text:warning});
      current.srcdoc=built.document;previewHost.replaceChildren(current);
      loadTimer=win.setTimeout(()=>{if(frame===current)onEvent({type:'log',level:'warn',text:'预览尚未就绪。请检查脚本，或点击停止后重新运行。'});},3000);
    },
    stop,
    destroy(){if(destroyed)return;cleanup();destroyed=true;}
  };
}
