import {createRunner} from './runner.js';
import {createDomRunner} from './dom-runner.js';
import {mainLanguage} from './web-files.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const MODES=[['web','HTML + CSS + JS 联动预览'],['javascript','JavaScript 控制台'],['html','HTML 效果预览'],['css','CSS 效果预览'],['project','项目环境说明']];
export function playgroundMarkup(profile={},progress={}){
  const mode=progress.runMode||profile.mode||'javascript';
  const testCode=progress.runTestCode??profile.testCode??'';
  const html=progress.previewHtml??profile.html??'<main><h1>预览区域</h1><p>修改这段 HTML，让它匹配你的 CSS 选择器。</p></main>';
  return `<section class="playground" aria-labelledby="playground-title"><div class="playground-heading"><h3 id="playground-title">运行与预览</h3><span id="run-status" role="status">尚未运行</span></div><p class="field-help">先运行检查输出或页面效果，再提交 AI 评阅。运行结果与评阅分数分别显示。</p><div class="run-controls"><label>运行方式<select id="run-mode">${MODES.map(([id,label])=>`<option value="${id}" ${id===mode?'selected':''}>${label}</option>`).join('')}</select></label><button type="button" class="button primary" id="run-code">运行代码 ▶</button><button type="button" class="button secondary" id="stop-code" disabled>停止</button><button type="button" class="text-button" id="clear-run-output">清空输出</button></div><p id="run-mode-help" class="field-help"></p>${profile.hint?`<p class="run-course-hint">本题提示：${esc(profile.hint)}</p>`:''}<details id="run-test-wrap" class="run-input-details" ${testCode?'open':''}><summary><span id="run-test-label">调用示例（可编辑，随代码提供给 AI 作参考）</span></summary><p class="field-help">函数定义本身不会显示结果；在这里调用你的函数并用 console.log 输出。示例只帮助观察，不代表通过了所有测试。</p><label for="run-test-code" class="sr-only">试运行调用代码</label><textarea id="run-test-code" spellcheck="false" maxlength="10000">${esc(testCode)}</textarea></details><details id="run-html-wrap" class="run-input-details" open><summary>预览配套的 HTML（可编辑）</summary><p class="field-help">上方编辑器写 CSS，这里放要应用样式的页面结构。</p><label for="run-html-source" class="sr-only">CSS 预览 HTML</label><textarea id="run-html-source" spellcheck="false" maxlength="30000">${esc(html)}</textarea></details><p id="run-stale" class="field-help" hidden>代码或试运行输入已修改，请重新运行以更新结果。</p><div class="preview-display-tools" id="preview-display-tools"><label>预览宽度<select id="preview-width"><option value="auto">适应窗口</option><option value="375">手机 375px</option><option value="834">iPad 竖屏 834px</option><option value="1210">iPad 横屏 1210px</option></select></label><button type="button" class="button secondary small" id="preview-expand" aria-pressed="false">放大预览</button></div><div id="run-preview-host" class="run-preview-host" hidden></div><div class="run-console"><div class="run-console-title">输出与错误 <span id="run-limits">控制台模式最多 3 秒</span></div><div class="run-console-actions"><button type="button" class="button secondary small" id="copy-run-output">复制输出</button><label><input type="checkbox" id="run-errors-only">只看错误和警告</label></div><div id="run-output" role="log" aria-label="运行输出"><p class="run-empty">点击运行后，输出和报错会显示在这里。</p></div></div></section>`;
}

export function mountPlayground(root,{profile={},state,onSave=()=>true,onLanguage=()=>{},readCode=()=>state.code||'',readFiles=()=>({html:'',css:'',javascript:readCode()}),runnerFactory=createRunner,domRunnerFactory=createDomRunner}={}){
  const $=selector=>root.querySelector(selector);
  const output=$('#run-output'),status=$('#run-status'),modeSelect=$('#run-mode');
  let disposed=false,hasRun=false,running=false,errors=0,lines=0,domTestStartLine=0,expanded=false;
  const playground=$('.playground'),preview=$('#run-preview-host'),widthSelect=$('#preview-width');
  try{const saved=localStorage.getItem('zhixing-preview-width');if(['auto','375','834','1210'].includes(saved))widthSelect.value=saved;}catch{}
  function sizePreview(){const width=widthSelect.value;preview.style.width=width==='auto'?'100%':width+'px';const frame=preview.querySelector('iframe');if(frame)frame.style.width=width==='auto'?'100%':width+'px';}
  function expand(value){expanded=value;playground.classList.toggle('preview-focus',value);document.body.classList.toggle('editor-is-expanded',value);$('#preview-expand').textContent=value?'退出放大':'放大预览';$('#preview-expand').setAttribute('aria-pressed',String(value));sizePreview();}
  widthSelect.onchange=()=>{sizePreview();try{localStorage.setItem('zhixing-preview-width',widthSelect.value);}catch{}};
  $('#preview-expand').onclick=()=>expand(!expanded);
  $('#run-errors-only').onchange=event=>output.classList.toggle('only-errors',event.target.checked);
  $('#copy-run-output').onclick=async()=>{const button=$('#copy-run-output'),text=[...output.querySelectorAll('.run-line')].filter(line=>!output.classList.contains('only-errors')||line.matches('.run-error,.run-warn')).map(line=>line.textContent).join('\n');try{await navigator.clipboard.writeText(text);button.textContent='已复制';}catch{button.textContent='请选择输出后复制';}setTimeout(()=>{if(!disposed)button.textContent='复制输出';},2000);};
  const escape=event=>{if(expanded&&event.key==='Escape'){event.preventDefault();expand(false);$('#preview-expand').focus();}};window.addEventListener('keydown',escape);
  const sizeObserver=new MutationObserver(sizePreview);sizeObserver.observe(preview,{childList:true});
  function addLine(text,level='log'){
    if(disposed||lines>=160)return;
    if(!lines)output.replaceChildren();
    const line=document.createElement('pre');line.className='run-line run-'+(['error','warn','info'].includes(level)?level:'log');line.textContent=String(text).slice(0,10000);output.append(line);lines++;
    output.scrollTop=output.scrollHeight;
  }
  function onEvent(event){
    if(disposed)return;
    if(event.type==='error'&&event.source==='javascript'&&modeSelect.value==='web'){if(domTestStartLine&&event.line>=domTestStartLine)event={...event,source:'test',line:event.line-domTestStartLine+1};}
    if(event.type==='log')addLine(event.text,event.level);
    if(event.type==='error'){errors++;const where=event.line?`${event.source==='test'?'调用示例':event.source==='html'?'HTML':event.source==='javascript'?'JavaScript':'实操代码'}第 ${event.line} 行${event.column?`，第 ${event.column} 列`:''}：\n`:'';addLine(where+event.text,'error');}
    if(event.type==='status'){
      running=['running','ready'].includes(event.state);$('#stop-code').disabled=!running;
      const labels={running:'正在运行…',ready:'预览运行中 · 可以点击交互',error:'运行出现错误',done:errors?'执行结束 · 有错误':'运行完成',stopped:'已停止',timeout:'已达到 3 秒上限'};
      status.textContent=labels[event.state]||event.text||'等待运行';
      status.dataset.state=errors?'error':event.state;
      if(event.state==='ready'&&!lines)addLine('页面已就绪。点击预览中的按钮或输入内容，观察页面变化和控制台输出。','info');
      if(event.state==='timeout')addLine('运行已停止：超过 3 秒。请检查是否存在无限循环或未结束的异步任务。','warn');
      if(event.state==='done'&&!lines)addLine(modeSelect.value==='javascript'?'执行完成，没有 console 输出。可以在调用示例中用 console.log(...) 查看函数结果。':'预览已更新。HTML/CSS 由浏览器容错解析，无效声明可能被忽略。','info');
    }
  }
  const runner=runnerFactory({previewHost:$('#run-preview-host'),timeoutMs:3000,onEvent});
  const domRunner=domRunnerFactory({previewHost:$('#run-preview-host'),onEvent});
  function stopAll(){runner.stop();domRunner.stop();}
  function syncMode(){
    const mode=modeSelect.value;
    if(mode==='css')$('#run-html-source').value=readFiles().html;
    $('#run-test-wrap').hidden=!['javascript','web'].includes(mode);$('#run-test-label').textContent=mode==='web'?'页面初始化与调用示例（在 JavaScript 文件之后执行）':'调用示例（可编辑，随代码提供给 AI 作参考）';$('#run-html-wrap').hidden=mode!=='css';
    $('#run-code').disabled=mode==='project';
    $('#run-code').textContent=mode==='project'?'需要项目环境':mode==='javascript'?'运行代码 ▶':mode==='web'?'运行联动页面 ▶':'更新预览 ▶';
    $('#run-preview-host').hidden=!['html','css','web'].includes(mode);$('#preview-display-tools').hidden=!['html','css','web'].includes(mode);if(!['html','css','web'].includes(mode)&&expanded)expand(false);sizePreview();
    $('#run-limits').textContent=mode==='web'?'交互预览持续运行，可点击停止':'控制台模式最多 3 秒';
    $('#run-mode-help').textContent={web:'上方三个文件一起运行：HTML 构建页面，CSS 设置样式，JavaScript 操作 DOM、处理按钮与表单事件。修改后重新运行；停止会关闭预览。外部资源与网络请求不可用。',javascript:'原生 JavaScript：支持 console 输出、Promise 和定时器；不提供 document、窗口对象、第三方包或网络请求。',html:'预览 HTML 片段和内嵌样式，可交互查看布局；脚本与外部资源不会执行或加载。',css:'将上方 CSS 应用到下方 HTML，查看布局、颜色、动画等效果。',project:'本题依赖框架、网络或构建环境，请在对应项目中验证。也可以切换运行方式，单独试验原生 JavaScript 或 DOM 联动页面。'}[mode];
    onLanguage(mode);
  }
  function dirty(){if(hasRun)$('#run-stale').hidden=false;}
  modeSelect.addEventListener('change',()=>{stopAll();state.runMode=modeSelect.value;onSave();syncMode();dirty();});
  $('#run-test-code').addEventListener('input',event=>{state.runTestCode=event.target.value;onSave();dirty();});
  $('#run-html-source').addEventListener('input',event=>{state.previewHtml=event.target.value;if(mainLanguage(profile)!=='html'){state.webFiles||={};state.webFiles.html=event.target.value;}onSave();dirty();});
  $('#run-code').addEventListener('click',()=>{
    stopAll();errors=0;lines=0;hasRun=true;output.replaceChildren();$('#run-stale').hidden=true;
    const mode=modeSelect.value;$('#run-preview-host').hidden=mode==='javascript';
    try{
      if(mode==='web'){const files=readFiles();domTestStartLine=files.javascript.split('\n').length+2;domRunner.run({...files,javascript:files.javascript+'\n;\n'+$('#run-test-code').value});}
      else if(mode==='javascript')runner.runJavaScript(readCode(),$('#run-test-code').value);
      else if(mode==='html')runner.preview({html:readCode(),css:''});
      else if(mode==='css')runner.preview({html:$('#run-html-source').value,css:readCode()});
    }catch(error){running=false;$('#stop-code').disabled=true;status.textContent='无法运行';status.dataset.state='error';addLine(error.message||'运行失败','error');}
  });
  $('#stop-code').addEventListener('click',()=>stopAll());
  $('#clear-run-output').addEventListener('click',()=>{lines=0;output.replaceChildren();addLine('输出已清空。','info');});
  syncMode();
  return {markDirty:dirty,stop(){stopAll();},destroy(){disposed=true;expand(false);sizeObserver.disconnect();window.removeEventListener('keydown',escape);runner.destroy();domRunner.destroy();}};
}
