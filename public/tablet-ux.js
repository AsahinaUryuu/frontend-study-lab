export function viewportMetrics(width,height,offset=0,layoutHeight=height){
 const h=Math.max(180,Math.round(Number(height)||180));
 return {height:h,top:Math.max(0,Math.round(Number(offset)||0)),keyboard:layoutHeight-h>150,width:Math.max(280,Math.round(Number(width)||280))};
}

/** Progressive enhancements; course state continues to belong to app.js. */
export function installTabletUX({toast=()=>{}}={}){
 const doc=document,win=doc.defaultView,root=doc.documentElement,body=doc.body,sidebar=doc.querySelector('#sidebar'),toggle=doc.querySelector('#menu-toggle'),workspace=doc.querySelector('.workspace');
 const backdrop=doc.createElement('button');backdrop.className='menu-backdrop';backdrop.type='button';backdrop.setAttribute('aria-label','关闭课程目录');backdrop.hidden=true;body.append(backdrop);
 const closeMenu=()=>body.classList.remove('menu-open');backdrop.onclick=closeMenu;toggle.setAttribute('aria-controls','sidebar');
 let lastOpen=false,frame=0;
 function viewport(){
  const v=win.visualViewport,m=viewportMetrics(v?.width||win.innerWidth,v?.height||win.innerHeight,v?.offsetTop||0,win.innerHeight);
  root.style.setProperty('--visible-height',m.height+'px');root.style.setProperty('--visible-top',m.top+'px');body.classList.toggle('keyboard-visible',m.keyboard);body.classList.toggle('tutor-keyboard-visible',m.keyboard&&!!doc.activeElement?.closest('#tutor-composer,#tutor-reader-dialog'));
  if(win.innerWidth>=1280)closeMenu();syncMenu();
 }
 function syncMenu(){
  const compact=win.innerWidth<1280,open=compact&&body.classList.contains('menu-open');backdrop.hidden=!open;toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',open?'关闭课程目录':'展开课程目录');
  sidebar.inert=compact&&!open;workspace.inert=open;const tutor=doc.querySelector('#tutor-panel');if(tutor)tutor.inert=open;
  if(open&&!lastOpen){sidebar.setAttribute('role','dialog');sidebar.setAttribute('aria-modal','true');sidebar.setAttribute('aria-label','课程目录');sidebar.querySelector('.selected,[data-close-menu],button')?.focus({preventScroll:true});}
  if(!open){sidebar.removeAttribute('role');sidebar.removeAttribute('aria-modal');if(lastOpen)toggle.focus({preventScroll:true});}lastOpen=open;
 }
 new MutationObserver(syncMenu).observe(body,{attributes:true,attributeFilter:['class']});
 function enhance(){
  frame=0;
  for(const input of doc.querySelectorAll('input[data-quiz],#code-editor,#run-test-code,#run-html-source')){input.autocapitalize='off';input.spellcheck=false;input.setAttribute('autocorrect','off');}
  for(const region of doc.querySelectorAll('.code-example pre,.book-table-wrap,#run-output')){region.tabIndex=0;if(!region.getAttribute('aria-label'))region.setAttribute('aria-label',region.id==='run-output'?'代码运行输出，可滚动查看':'可横向滚动的代码或表格');}
  for(const bar of doc.querySelectorAll('.stage-bar,.editor-files')){const current=bar.querySelector('[aria-current="step"],[aria-current="true"],.active,[aria-selected="true"]');if(current&&current!==bar._lastCurrent){bar._lastCurrent=current;const left=current.offsetLeft-bar.offsetLeft-(bar.clientWidth-current.clientWidth)/2;bar.scrollTo({left:Math.max(0,left),behavior:'auto'});}}
 }
 const observer=new MutationObserver(()=>{if(!frame)frame=win.requestAnimationFrame(enhance);});observer.observe(doc.querySelector('#main'),{childList:true,subtree:true});
 doc.addEventListener('keydown',event=>{
  if(body.classList.contains('menu-open')&&win.innerWidth<1280){
   if(event.key==='Escape'){event.preventDefault();closeMenu();return;}
   if(event.key==='Tab'){const nodes=[...sidebar.querySelectorAll('a[href],button,input,select,[tabindex="0"]')].filter(el=>!el.disabled&&el.getClientRects().length),first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first?.focus();}}
  }
  if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)&&!event.shiftKey&&!event.isComposing&&event.target.closest('#coding')&&!event.target.closest('#tutor-composer')){const run=doc.querySelector('#run-code');if(run&&!run.disabled){event.preventDefault();run.click();toast('已运行当前代码');}}
  const tab=event.target.closest('[data-code-file]');if(tab&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){const tabs=[...tab.parentNode.querySelectorAll('[data-code-file]')],index=tabs.indexOf(tab),next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;event.preventDefault();tabs[next].click();tabs[next].focus();}
 });
 doc.addEventListener('focusin',viewport);doc.addEventListener('focusout',()=>win.setTimeout(viewport,0));win.addEventListener('resize',viewport);win.visualViewport?.addEventListener('resize',viewport);win.visualViewport?.addEventListener('scroll',viewport);
 viewport();enhance();
}
