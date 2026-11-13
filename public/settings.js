// Model discovery is initiated only by the user's explicit button click.
export function setupSettings({getConfig,getApiKey,onSave,onClear,onReset,toast}) {
  const $=s=>document.querySelector(s);
  let models=[], request=null, generation=0, saving=false;
  const status=(message,error=false)=>{ $('#model-status').textContent=message;$('#model-status').classList.toggle('is-error',error); };
  function resetList(message='填写接口地址与密钥，然后获取模型列表。') {
    generation++;request?.abort();request=null;models=[];
    $('#fetch-models').disabled=false;$('#fetch-models').textContent='获取模型列表';
    $('#model-picker').hidden=true;$('#model-list').replaceChildren();$('#model-search').value='';status(message);
  }
  function help(){ $('#endpoint-help').textContent=$('#provider').value==='gemini'?'Gemini 原生接口：支持 API 根地址、/models 或完整的 :generateContent 地址。':'OpenAI 兼容接口：支持 Base URL、/models 或完整的 /chat/completions 地址。'; }
  function readForm(){return {provider:$('#provider').value,baseUrl:$('#base-url').value.trim(),model:$('#model').value.trim(),proxyUrl:$('#proxy-url').value.trim()};}
  function validate(c,requireKey=false){
    let u;try{u=new URL(c.baseUrl);}catch{throw new Error('请输入完整的 API 地址。');}
    if(u.username||u.password||u.search||u.hash)throw new Error('地址中不要包含密钥或查询参数，请使用 API Key 栏。');
    const local=h=>['localhost','127.0.0.1','[::1]'].includes(h);
    if(u.protocol!=='https:'&&!(u.protocol==='http:'&&local(u.hostname)))throw new Error('远程接口请使用 HTTPS。');
    if(c.proxyUrl){let p;try{p=new URL(c.proxyUrl);}catch{throw new Error('HTTP 代理地址无效。');}if(p.protocol!=='http:'||!local(p.hostname)||p.username||p.password||p.search||p.hash||p.pathname!=='/')throw new Error('代理请填写本机无认证 HTTP 地址，例如 http://127.0.0.1:7897。');}
    if(requireKey&&!$('#api-key').value.trim()&&!local(u.hostname))throw new Error('请先填写该接口的 API Key。');
  }
  function renderModels(){
    const query=$('#model-search').value.trim().toLowerCase();
    const shown=models.filter(m=>(m.id+' '+m.name).toLowerCase().includes(query));
    const select=$('#model-list');select.replaceChildren();
    for(const m of shown){const o=document.createElement('option');o.value=m.id;o.textContent=m.name&&m.name!==m.id?`${m.id} — ${m.name}`:m.id;select.append(o);}
    select.selectedIndex=-1;$('#model-count').textContent=`显示 ${shown.length} / ${models.length} 个模型`;
  }
  async function fetchModels(){
    resetList('正在向接口获取模型列表…');
    const c=readForm();try{validate(c,true);}catch(e){status(e.message,true);return;}
    const token=generation;const controller=new AbortController();request=controller;
    const timeout=setTimeout(()=>controller.abort(),35000);
    $('#fetch-models').disabled=true;$('#fetch-models').textContent='正在获取…';
    try{
      const r=await fetch('/api/models',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config:{...c,apiKey:$('#api-key').value.trim()}}),signal:controller.signal});
      if(r.status===404||r.status===405)throw new Error('本地服务尚未更新，请关闭旧启动窗口，重新双击“启动学习.bat”后再试。');
      let data;try{data=await r.json();}catch{throw new Error('本地服务返回异常，请重启软件后再试。');}
      if(!r.ok)throw new Error(data.error||'获取模型失败。');if(token!==generation)return;
      if(!Array.isArray(data.models))throw new Error('接口未返回有效模型列表。');
      models=data.models.filter(m=>m&&typeof m.id==='string'&&m.id).map(m=>({id:m.id,name:typeof m.name==='string'?m.name:m.id}));
      if(!models.length){status('接口未返回可用模型。可以手动填写模型 ID，或检查账号权限。');return;}
      $('#model-picker').hidden=false;renderModels();
      status(`已获取 ${models.length} 个模型${data.truncated?'（列表未完整获取，也可手动填写模型 ID）':''}。点击列表中的模型填入名称。`);
    }catch(e){if(token===generation)status(e.name==='AbortError'?'获取超时，请检查网络或代理后重试。':e.message,true);}
    finally{clearTimeout(timeout);if(token===generation){request=null;$('#fetch-models').disabled=false;$('#fetch-models').textContent='重新获取模型';}}
  }
  function open(){const c=getConfig();$('#provider').value=c.provider;$('#base-url').value=c.baseUrl;$('#model').value=c.model;$('#proxy-url').value=c.proxyUrl||'';$('#api-key').value=getApiKey();resetList();help();$('#settings-dialog').showModal();}
  $('#settings-open').onclick=open;
  $('#settings-close').onclick=()=>$('#settings-dialog').close();
  $('#settings-dialog').addEventListener('close',()=>{generation++;request?.abort();request=null;});
  $('#provider').onchange=()=>{resetList();$('#base-url').value=$('#provider').value==='gemini'?'https://generativelanguage.googleapis.com/v1beta':'https://api.openai.com/v1';$('#model').value='';help();};
  for(const selector of ['#base-url','#api-key','#proxy-url'])$(selector).addEventListener('input',()=>resetList('连接信息已更改，请重新获取模型列表。'));
  $('#fetch-models').onclick=fetchModels;$('#model-search').oninput=renderModels;
  $('#model-search').onkeydown=e=>{if(e.key==='Enter')e.preventDefault();};
  $('#model-list').onchange=()=>{const id=$('#model-list').value;if(id){$('#model').value=id;status(`已选择 ${id}。保存配置后即可用于代码评阅。`);}};
  async function persist(action,message,onSuccess){
    if(saving)return;
    resetList(message);saving=true;
    const controls=[...$('#settings-form').elements],previous=controls.map(el=>el.disabled);
    controls.forEach(el=>el.disabled=true);
    try{await action();onSuccess();}
    catch(error){status(error.message||'保存失败，请检查本地服务后重试。',true);}
    finally{controls.forEach((el,index)=>el.disabled=previous[index]);saving=false;}
  }
  $('#settings-form').onsubmit=e=>{
    e.preventDefault();const c=readForm();try{validate(c);}catch(err){status(err.message,true);return;}
    const key=$('#api-key').value.trim();
    void persist(()=>onSave(c,key),'正在保存到本机 JSON 文件…',()=>{$('#settings-dialog').close();toast('配置和密钥已保存到本机，刷新后自动恢复。');});
  };
  $('#clear-key').onclick=()=>{void persist(onClear,'正在清除本机保存的密钥…',()=>{$('#api-key').value='';resetList('本机保存的密钥已清除，接口地址与模型保留。');toast('本机密钥已清除。');});};
  $('#reset-config').onclick=()=>{void persist(onReset,'正在恢复本机默认配置…',()=>{resetList();$('#settings-dialog').close();toast('本机配置已恢复默认，保存的密钥已清除。');});};
  return {open};
}
