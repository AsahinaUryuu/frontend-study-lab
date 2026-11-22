import {reviewSnapshotMarkup} from './review-snapshot.js';
import {renderTutorMarkdown} from './tutor-markdown.js';
import {quizFeedbackCard,bindQuizFeedbackTools} from './quiz-feedback.js';
import {bindStudyCheck,studyQueueMarkup} from './study-check.js';
import {mountLearningCenter,lessonCenterEntry} from './learning-center.js';
import {installBackupManager,summarizeProgress} from './backup-manager.js';
import {collectUIPreferences,restoreUIPreferences} from './ui-preferences.js';
import {createCloudProgress} from './cloud-progress.js';
import {installTabletUX} from './tablet-ux.js';
import { gradeQuiz, validateProgress } from './learning.js';
import { resumeStage, answeredQuestions, retryIncorrect, sortCourses, applyReadingPreferences, saveReadingPreferences, focusQuizQuestion } from './learning-ux.js';
import { setupSettings } from './settings.js';
import { STAGES, stageBar, textbookMarkup } from './textbook.js';
import { quizPromptMarkup, quizOptionMarkup, inlineCodeMarkup } from './quiz-presentation.js';
import { createCodeEditor } from './editor.js';
import { WEB_LANGUAGES, mainLanguage, webFiles } from './web-files.js';
import { buildSubmission, submissionSignature, makeCodeReview, makeQuizReview, makeSummaryReview, quizAttempt, addCodeReview, addQuizReview, addSummaryReview, ensureTutorState, buildTutorContext, trimTutorHistory } from './tutor-context.js';
import { createTutorPanel } from './tutor-panel.js';
import { readLocalConfig, saveLocalConfig, clearLocalKey, resetLocalConfig } from './local-config.js';
import { playgroundMarkup, mountPlayground } from './playground.js';

const CHAPTERS = [
  { id: 'javascript', name: 'JavaScript', subtitle: '语言与运行机制', icon: 'JS', color: 'amber' },
  { id: 'vue', name: 'Vue', subtitle: '响应式与组件协作', icon: 'V', color: 'green' },
  { id: 'react', name: 'React', subtitle: '状态与渲染思维', icon: 'R', color: 'blue' },
  { id: 'performance', name: '性能优化', subtitle: '让页面更轻、更快', icon: '↗', color: 'rose' },
  { id: 'engineering', name: '前端工程化', subtitle: '从源码到交付', icon: '⌘', color: 'purple' },
  { id: 'browser', name: '浏览器', subtitle: '页面背后的工作方式', icon: '◎', color: 'blue' },
  { id: 'network', name: '计算机网络', subtitle: '一次请求的旅程', icon: '⇄', color: 'green' },
  { id: 'html', name: 'HTML', subtitle: '结构、语义与可访问性', icon: '<>', color: 'rose' },
  { id: 'css', name: 'CSS', subtitle: '布局与视觉表达', icon: '#', color: 'purple' },
];
const KEY = 'zhixing-progress-v1';
const deploymentLabel = ['localhost','127.0.0.1','::1','[::1]'].includes(location.hostname.toLowerCase()) ? '本地' : '云端';
document.getElementById('deployment-label').textContent = deploymentLabel + '学习';
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
let lessons = [], questions = [], progress = {}, currentId = '', currentChapter = '', currentView = '', currentQuestion = '', query = '', filter = 'all';
let questionQuery = '', questionChapter = '', currentStage = 'textbook', catalogOrder='path';
let wrongOnly=false;
let reading=applyReadingPreferences(document.documentElement,localStorage);
try{const catalog=JSON.parse(localStorage.getItem('zhixing-catalog-view')||'{}');if(['all','unfinished','wrong','bookmarked','recent'].includes(catalog.filter))filter=catalog.filter;if(['path','recent','title'].includes(catalog.order))catalogOrder=catalog.order;}catch{}
function saveCatalog(){try{localStorage.setItem('zhixing-catalog-view',JSON.stringify({filter,order:catalogOrder}));}catch{}}
let apiKey = '', config = { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: '', proxyUrl: '' };
let grading = new Set(), reviewingSummary = new Set();
let toastTimer, activeEditor = null, activePlayground = null;
let runExamples = {}, activeCodeFile='javascript', changingEditor=false;
let tutor=null,tutorFocus=null,cloud=null,backupManager=null,activeCenter=null,reviewReturn='',preferenceSnapshot='';
function portableProgress(){return {...progress,_preferences:collectUIPreferences(localStorage)};}
function restorePresentation(raw){
 restoreUIPreferences(localStorage,raw);reading=applyReadingPreferences(document.documentElement,localStorage);
 try{const catalog=JSON.parse(localStorage.getItem('zhixing-catalog-view')||'{}');if(['all','unfinished','wrong','bookmarked','recent'].includes(catalog.filter))filter=catalog.filter;if(['path','recent','title'].includes(catalog.order))catalogOrder=catalog.order;}catch{}
 preferenceSnapshot=JSON.stringify(collectUIPreferences(localStorage));initializeTutor();
}
function savePreferenceChanges(){const next=JSON.stringify(collectUIPreferences(localStorage));if(next!==preferenceSnapshot){preferenceSnapshot=next;cloud?.save();}}

const syncBadge=document.createElement('button');syncBadge.type='button';syncBadge.className='button secondary small progress-sync';syncBadge.textContent='正在连接记录';syncBadge.setAttribute('aria-live','polite');document.querySelector('.top-actions').prepend(syncBadge);
let syncState='loading',syncMessage='',recoveryCount=0,recoveryDialog=null,recoveryBusy=false;
function syncStatus(state,message){syncState=state;syncMessage=message||'';renderSyncBadge();}
function renderSyncBadge(){syncBadge.textContent=({loading:'正在同步',saved:'记录已同步',pending:'正在保存',offline:'未同步 · 重试',conflict:'记录冲突 · 处理',recovery:'恢复副本 · 查看'})[syncState]||'同步与恢复';if(recoveryCount&&['saved','recovery'].includes(syncState))syncBadge.textContent=`恢复副本 · ${recoveryCount}`;syncBadge.title=(syncMessage||syncBadge.textContent)+'；点击查看同步状态与浏览器恢复副本';syncBadge.dataset.state=syncState;}
function downloadProgress(value,filename){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function progressExport(value){return {version:1,exportedAt:new Date().toISOString(),progress:value};}
function renderRecoveryList(){
 if(!recoveryDialog)return;const items=cloud.getRecoveryDrafts();
 recoveryDialog.querySelector('.backup-list').innerHTML=items.length?items.map(item=>{const s=summarizeProgress(item.progress);return `<article class="backup-item"><div><strong>${item.isCurrent?'本页未同步草稿':item.matchesServer?'与服务器一致的保留副本':'其他标签或已关闭标签的副本'}</strong><time>${item.updatedAt?esc(new Date(item.updatedAt).toLocaleString()):'旧版恢复副本'}</time><small>${s.lessons} 个课程记录 · ${s.messages} 条对话 · 版本 ${item.revision}${item.conflict?' · 待处理冲突':''}</small></div><button type="button" data-recovery-download="${esc(item.id)}">下载单份</button><button type="button" data-recovery-restore="${esc(item.id)}" ${item.isCurrent?'disabled':''}>恢复到本页</button></article>`;}).join(''):'<div class="backup-empty">当前浏览器没有未同步恢复副本。正常保存的记录可在「记录还原点」中查看。</div>';
 recoveryDialog.querySelector('[data-recovery-all]').disabled=!items.length||recoveryBusy;
 if(recoveryBusy)for(const button of recoveryDialog.querySelectorAll('button'))button.disabled=true;
}
function openRecoveryDialog(){
 if(!cloud)return;
 if(!recoveryDialog){
  recoveryDialog=document.createElement('dialog');recoveryDialog.className='backup-dialog';recoveryDialog.setAttribute('aria-labelledby','recovery-title');
  recoveryDialog.innerHTML='<header><div><h2 id="recovery-title">同步与恢复副本</h2><p>检查本页保存状态，找回其他标签留下的草稿</p></div><button type="button" class="backup-close" aria-label="关闭恢复副本">×</button></header><div class="backup-body"><p class="backup-help">浏览器恢复副本包含尚未同步的课程、笔记和对话。恢复只会复制到本页，来源副本仍保留；如果服务器已有新记录，会先提示冲突。单份下载的 JSON 可通过「导入记录」重新使用。</p><div class="backup-toolbar"><button type="button" data-recovery-current>下载本页记录</button><button type="button" data-recovery-retry>重试保存</button><button type="button" data-recovery-server>载入服务器版本</button><button type="button" data-recovery-all>下载全部副本合辑</button><button type="button" data-recovery-refresh>刷新列表</button><button type="button" data-recovery-history>服务器还原点</button></div><p class="backup-status" role="status" aria-live="polite"></p><div class="backup-list"></div></div>';
  document.body.append(recoveryDialog);
  const setStatus=message=>{recoveryDialog.querySelector('.backup-status').textContent=message;};
  recoveryDialog.querySelector('.backup-close').onclick=()=>{if(!recoveryBusy)recoveryDialog.close();};
  recoveryDialog.addEventListener('cancel',event=>{if(recoveryBusy)event.preventDefault();});
  recoveryDialog.addEventListener('click',async event=>{
   const button=event.target.closest('button');if(!button||button.disabled||button.classList.contains('backup-close')||recoveryBusy)return;
   try{
    if(button.hasAttribute('data-recovery-refresh')){renderRecoveryList();setStatus(syncMessage||'列表已更新。');return;}
    if(button.hasAttribute('data-recovery-current')){downloadProgress(progressExport(portableProgress()),'知行-本页学习记录.json');setStatus('本页记录已下载。');return;}
    if(button.hasAttribute('data-recovery-all')){downloadProgress({version:1,kind:'zhixing-recovery-bundle',exportedAt:new Date().toISOString(),drafts:cloud.getRecoveryDrafts()},'知行-全部浏览器恢复副本.json');setStatus('已下载全部副本合辑；需要直接导入学习记录时，请使用对应行的「下载单份」。');return;}
    if(button.dataset.recoveryDownload){const item=cloud.getRecoveryDrafts().find(x=>x.id===button.dataset.recoveryDownload);if(!item)throw new Error('这份副本已不存在，请刷新列表。');downloadProgress(progressExport(item.progress),'知行-恢复副本-'+item.id+'.json');setStatus('单份记录已下载，可通过「导入记录」使用。');return;}
    if(grading.size||tutor?.isBusy())throw new Error('请等待 AI 请求结束或先停止追问，再替换本页记录。');
    if(button.hasAttribute('data-recovery-history')){recoveryDialog.close();await backupManager?.open();return;}
    if(button.hasAttribute('data-recovery-server')){downloadProgress(progressExport(portableProgress()),'知行-载入服务器前本页记录.json');if(!confirm('已下载本页记录。现在载入服务器版本并替换本页内容？其他标签的恢复副本会保留。'))return;}
    if(button.dataset.recoveryRestore&&!confirm('将选中的恢复副本复制到本页？本页未同步内容会另存为恢复副本；如果服务器已更新，不会自动覆盖服务器。'))return;
    recoveryBusy=true;for(const b of recoveryDialog.querySelectorAll('button'))b.disabled=true;setStatus('正在处理，请稍候…');
    if(button.hasAttribute('data-recovery-retry')){await cloud.flush();const current=cloud.getState();setStatus(current.ready&&!current.dirty&&!current.conflict?'本页记录已保存。':syncMessage||'当前记录尚未保存，请先检查同步提示。');}
    else if(button.hasAttribute('data-recovery-server')){await cloud.loadLatest({discardLocal:true});route();setStatus('已载入服务器版本；其他恢复副本保持不变。');}
    else if(button.dataset.recoveryRestore){await cloud.recoverDraft(button.dataset.recoveryRestore,{discardLocal:true});route();setStatus(cloud.getState().conflict?'副本已恢复到本页；服务器已有更新，请先下载两边需要保留的内容，再选择版本。':'副本已恢复到本页，来源副本仍保留。');}
   }catch(error){setStatus(error.message||'操作失败，恢复副本仍保留。');}
   finally{recoveryBusy=false;for(const b of recoveryDialog.querySelectorAll('button'))b.disabled=false;renderRecoveryList();}
  });
 }
 renderRecoveryList();recoveryDialog.querySelector('.backup-status').textContent=syncMessage||'可查看、下载或选择恢复副本。';if(!recoveryDialog.open)recoveryDialog.showModal();
}
syncBadge.onclick=openRecoveryDialog;
function disposeEditor(){ activePlayground?.destroy(); activePlayground=null; activeEditor?.destroy(); activeEditor=null; }
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 3600); }
function save() { try { localStorage.setItem(KEY, JSON.stringify(progress)); cloud?.save(); return true; } catch { toast('浏览器无法保存记录，请立即导出备份。'); return false; } }
function state(id) { return progress[id] ||= { answers: {}, code: '', completed: false }; }
function completed() { return lessons.filter(l => progress[l.id]?.completed).length; }
function wrong(l) { const p=progress[l.id],latest=p?.quizReviews?.reduce((a,b)=>!a||Date.parse(b.createdAt)>=Date.parse(a.createdAt)?b:a,null),attempt=quizAttempt(l,latest||p);return !!attempt&&attempt.result.correct<attempt.result.total; }
function chapter(id) { return CHAPTERS.find(c => c.id === id); }
function status(l) { return progress[l.id]?.completed ? '已完成' : progress[l.id]?.visited ? '学习中' : '未开始'; }
function safeLink(url) { try { const u = new URL(url); return ['https:', 'http:'].includes(u.protocol) ? u.href : '#'; } catch { return '#'; } }
function renderSidebar() {
  const total = completed(), percent = Math.round(total / lessons.length * 100) || 0;
  $('#sidebar').innerHTML = `<button class="sidebar-close icon-button" aria-label="关闭课程目录" data-close-menu>×</button><a href="#" class="brand"><span class="brand-mark">知</span><span>知行 <small>FRONTEND LAB</small></span></a>
  <button class="sidebar-home ${!currentId && !currentChapter && !currentView ? 'selected' : ''}" data-home>◫ <span>学习总览</span><span>↗</span></button>
  <button class="sidebar-home ${currentView==='review'?'selected':''}" data-review>↻ <span>学习回顾中心</span><span>→</span></button>
  <button class="sidebar-home question-nav ${currentView==='questions'?'selected':''}" data-questions>≡ <span>知识点索引</span><small>${questions.length}</small></button>
  <div class="sidebar-label">课程目录 <span>${lessons.length} 个教学板块</span></div>
  <nav aria-label="课程目录">${CHAPTERS.map(c => { const list=lessons.filter(l=>l.chapterId===c.id); const open=currentChapter===c.id || chapter(lessons.find(l=>l.id===currentId)?.chapterId)?.id===c.id;return `<div class="chapter-group"><button class="chapter-nav ${open?'active':''}" data-chapter="${c.id}" aria-expanded="${open}"><span class="chapter-symbol ${c.color}">${esc(c.icon)}</span><span>${c.name}</span><small>${list.filter(l=>progress[l.id]?.completed).length}/${list.length}</small><span class="chevron">${open?'⌄':'›'}</span></button>${open?`<div class="lesson-nav">${list.map((l,i)=>`<button data-lesson="${l.id}" class="${currentId===l.id?'selected':''}" title="${esc(l.tutorial.title)}"><span class="lesson-dot ${progress[l.id]?.completed?'done':''}">${progress[l.id]?.completed?'✓':String(i+1).padStart(2,'0')}</span><span>${esc(l.tutorial.title)}</span></button>`).join('')}</div>`:''}</div>`; }).join('')}</nav>
  <div class="sidebar-bottom"><div class="progress-label"><span>我的学习进度</span><b>${percent}%</b></div><div class="progress-track"><i style="width:${percent}%"></i></div><p>已完成 ${total} / ${lessons.length} 个板块</p><div class="data-actions"><button data-export>导出记录</button><button data-import>导入记录</button><button data-backup-manager>记录还原点</button></div></div>`;
}
function go(id,questionId='') {
  const hash=id?`#lesson/${encodeURIComponent(id)}${questionId?'/'+encodeURIComponent(questionId):''}`:'';
  if(location.hash===hash)route();else location.hash=hash;
}
function route() {
  disposeEditor();activeCenter?.destroy();activeCenter=null;tutorFocus=null;reviewReturn='';
  const raw=location.hash.slice(1),split=raw.indexOf('?'),params=new URLSearchParams(split<0?'':raw.slice(split+1));
  let entry=null,hash='';try{hash=decodeURIComponent(split<0?raw:raw.slice(0,split));}catch{toast('课程地址无效，已返回学习总览。');}
  currentId='';currentChapter='';currentView='';currentQuestion='';
  if(hash==='review'){currentView='review';try{$('#main').innerHTML=studyQueueMarkup(lessons,progress)+'<div id="learning-center-body"></div>';activeCenter=mountLearningCenter($('#learning-center-body'),{lessons,chapters:CHAPTERS,progress,params,toast,onNotesChange:save});}catch(error){$('#main').innerHTML=`<div class="empty"><h1>回顾中心暂时无法打开</h1><p>${esc(error.message)}</p><p>原学习记录仍保留，可回到课堂继续学习。</p><button class="button secondary" data-home>返回学习总览</button><button class="button primary" data-review>重新加载回顾</button></div>`;}}
  else if(hash==='questions'){currentView='questions';renderQuestions();}
  else if(hash.startsWith('lesson/')) {
    const [,id,qid]=hash.split('/'),l=lessons.find(l=>l.id===id);
    if(l){currentId=id;currentChapter=l.chapterId;currentQuestion=l.deepDives?.some(q=>q.id===qid)?qid:'';entry=lessonCenterEntry(params,l);reviewReturn=entry.returnHref;currentStage=entry.questionId?'practice':entry.stage||resumeStage(state(id),currentQuestion);wrongOnly=false;state(id).visited=true;state(id).lastSeen=Date.now();save();renderLesson();}
    else renderHome();
  }else{currentChapter=CHAPTERS.some(c=>c.id===hash)?hash:'';renderHome();}
  renderSidebar();document.body.classList.remove('menu-open');window.scrollTo(0,0);tutor?.refresh();
  if(entry?.questionId)focusQuizQuestion($('#quiz-form'),entry.questionId);
  if(entry?.openNotes){const notes=$('#lesson-notes');if(notes){notes.closest('details').open=true;notes.scrollIntoView({block:'center'});notes.focus({preventScroll:true});}}
  if(currentQuestion){const detail=document.getElementById('source-'+currentQuestion);if(detail){detail.open=true;detail.scrollIntoView({block:'start'});}}
}
function renderQuestions() {
  const q=questionQuery.trim().toLowerCase();
  const list=questions.filter(x=>(!questionChapter||x.chapterId===questionChapter)&&(!q||[x.title,x.lessonTitle,...(x.tags||[])].join(' ').toLowerCase().includes(q)));
  $('#main').innerHTML=`<div class="page-home question-page"><div class="page-heading"><div><div class="eyebrow">FROM THE SOURCE · ONE QUESTION AT A TIME</div><h1>知识点索引</h1><p>这是复习入口，可直达课堂提问；初学请先从课程的基础教学开始。</p></div></div>
    <div class="index-intro"><div><b>${questions.length}</b><span>道课程问题</span></div><p>覆盖原书 9 个章节的编号题目，按实际出现顺序整理。重复编号也单独收录；旧版 API 与历史表述在讲解中注明适用范围。</p></div>
    <div class="question-controls"><label>知识章节<select id="question-chapter"><option value="">全部章节</option>${CHAPTERS.map(c=>`<option value="${c.id}" ${questionChapter===c.id?'selected':''}>${c.name} · ${questions.filter(x=>x.chapterId===c.id).length} 题</option>`).join('')}</select></label><label>查找问题<input id="question-search" type="search" placeholder="输入题目或知识点…" value="${esc(questionQuery)}"></label><span id="question-results-count" class="muted" role="status">找到 ${list.length} 道题目</span></div>
    <div class="source-question-list">${list.length?list.map(x=>`<button class="source-question-row" data-lesson="${esc(x.lessonId)}" data-question="${esc(x.id)}"><span class="source-question-number">${String(x.number).padStart(2,'0')}</span><div><span class="question-chapter-tag">${chapter(x.chapterId).name}</span><h2>${esc(x.title)}</h2><p>对应小课：${esc(x.lessonTitle)}</p></div><span class="question-arrow">进入讲解 →</span></button>`).join(''):'<div class="empty"><h3>没有找到对应题目</h3><p>试试更短的关键词，或切换到全部章节。</p></div>'}</div></div>`;
  $('#question-chapter').onchange=e=>{questionChapter=e.target.value;renderQuestions();};
  $('#question-search').oninput=e=>{if(e.isComposing)return;questionQuery=e.target.value;const pos=e.target.selectionStart;renderQuestions();$('#question-search').focus();try{$('#question-search').setSelectionRange(pos,pos);}catch{}};
  $('#question-search').oncompositionend=e=>e.target.dispatchEvent(new Event('input',{bubbles:true}));
}
function deepDivesMarkup(l) {
  if(!l.deepDives?.length)return '';
  return `<div class="deep-dives"><div class="deep-dives-heading"><div><span class="eyebrow">BACK TO THE QUESTIONS</span><h3>知识点逐题讲解 <small>${l.deepDives.length} 题</small></h3></div><button class="text-button" data-questions>全部题目索引 ↗</button></div><p class="muted">展开具体问题，结合本课练习检验理解。</p>${l.deepDives.map(q=>`<details class="deep-dive" id="source-${esc(q.id)}" ${q.id===currentQuestion?'open':''}><summary><span>${esc(q.title)}</span><small>展开讲解</small></summary><div class="deep-dive-body"><p>${esc(q.answer)}</p>${q.example?codeBlock(q.example,l.code.language):''}<div class="follow-up"><b>再追问一步</b><p>${esc(q.followUp)}</p></div></div></details>`).join('')}</div>`;
}
function renderHome() {
  const c=chapter(currentChapter), done=completed(), quizCount=lessons.reduce((n,l)=>n+l.quiz.length,0);
  const recent=lessons.filter(l=>progress[l.id]?.visited&&!progress[l.id]?.completed).sort((a,b)=>(progress[b.id]?.lastSeen||0)-(progress[a.id]?.lastSeen||0))[0] || lessons.find(l=>!progress[l.id]?.completed)||lessons[0];
  const list=lessons.filter(l=>(!c||l.chapterId===c.id)&&(!query||[l.tutorial.title,l.tutorial.intro,l.title,l.question,...l.tags,...(l.deepDives||[]).map(x=>x.title)].join(' ').toLowerCase().includes(query.toLowerCase()))&&(filter==='all'||(filter==='unfinished'&&!progress[l.id]?.completed)||(filter==='wrong'&&wrong(l))||(filter==='bookmarked'&&progress[l.id]?.bookmarked)||(filter==='recent'&&progress[l.id]?.visited)));
  const ordered=sortCourses(list,progress,filter==='recent'?'recent':catalogOrder);
  $('#main').innerHTML = `<div class="page-home"><div class="page-heading"><div><div class="eyebrow">LEARN. PRACTICE. UNDERSTAND.</div><h1>${c?esc(c.name)+' · '+esc(c.subtitle):'让知识，真正成为你的。'}</h1><p>${c?'从一个个具体问题出发，把这一章学扎实。':'将 182 页面试资料拆成小课，从理解到动手，每次前进一步。'}</p></div><span class="edition">循序学习 · 1.13.0 ${deploymentLabel}版</span></div>
  ${!c?`<section class="hero"><div class="hero-copy"><div class="hero-label"><span></span> 今天，从弄懂一个概念开始</div><h2>把“背过”，<br>变成<span>“会写”。</span></h2><p>先学概念和用法，跟着例子走一遍。<br>再用提问、练习与反馈，检验自己是否学会。</p><button class="button cream" data-lesson="${recent.id}">${progress[recent.id]?.visited?'继续学习':'开始第一课'} <span>→</span></button><div class="hero-next">${esc(recent.tutorial.title)} · ${esc(STAGES.find(s=>s[0]===resumeStage(progress[recent.id]))?.[1]||'基础教学')}</div></div><div class="hero-visual" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="code-card"><div class="code-top"><i></i><i></i><i></i><span>learning.js</span></div><pre><span class="code-purple">const</span> growth = {\n  understand: <span class="code-yellow">true</span>,\n  practice: <span class="code-yellow">everyDay</span>,\n  memorize: <span class="code-green">'with meaning'</span>\n};\n\n<span class="code-green">// 不止于记住答案</span>\n<span class="code-yellow">buildYourUnderstanding</span>();</pre></div><div class="floating-note"><span>✓</span><div>理解 + 练习<small>知识才能留下来</small></div></div></div></section>
  <div class="stats"><div><span class="stat-icon green">◫</span><div><b>9 <small>个</small></b><span>知识章节</span></div></div><div><span class="stat-icon amber">⌘</span><div><b>${lessons.length} <small>节</small></b><span>独立教学板块</span></div></div><div><span class="stat-icon blue">✎</span><div><b>${quizCount} <small>道</small></b><span>客观题 · 另有 ${lessons.length} 道实操</span></div></div><div><span class="stat-icon purple">✓</span><div><b>${done} <small>/ ${lessons.length}</small></b><span>已完成板块</span></div></div></div>`:''}
  <button class="question-index-banner" data-questions><span class="big-symbol green">≡</span><span><b>核心问题，一题一题学明白</b><small>${questions.length} 道课程问题 · 逐题讲解 · 按章检索</small></span><span>打开题目索引 →</span></button>
  <button class="question-index-banner" data-review><span class="big-symbol amber">↻</span><span><b>回顾错题、待答与自己的笔记</b><small>跨课程检索 · 回到具体题目 · 导出课堂笔记</small></span><span>打开学习回顾 →</span></button>
  <section class="catalog"><div class="section-heading"><div><h2>${c?'本章学习路径':'你的知识地图'}</h2><p>${c?`${lessons.filter(l=>l.chapterId===c.id).length} 个独立板块 · 每课先学教材正文，再提问、练习、评阅和总结`:'9 个章节，按问题拆解。点击章节展开课程。'}</p></div><div class="catalog-controls"><select id="filter" aria-label="筛选课程"><option value="all" ${filter==='all'?'selected':''}>全部课程</option><option value="unfinished" ${filter==='unfinished'?'selected':''}>尚未完成</option><option value="wrong" ${filter==='wrong'?'selected':''}>需要复习</option><option value="bookmarked" ${filter==='bookmarked'?'selected':''}>我的收藏</option><option value="recent" ${filter==='recent'?'selected':''}>最近学习</option></select><select id="catalog-order" aria-label="课程排序" ${filter==='recent'?'disabled':''}><option value="path" ${catalogOrder==='path'?'selected':''}>按学习路径</option><option value="recent" ${catalogOrder==='recent'?'selected':''}>最近访问优先</option><option value="title" ${catalogOrder==='title'?'selected':''}>按课程标题</option></select><input type="search" id="search" placeholder="搜索知识点…" aria-label="搜索知识点" value="${esc(query)}"><button type="button" id="clear-search" class="text-button" ${!query&&filter==='all'?'hidden':''}>清除搜索与筛选</button></div></div><p class="catalog-results" role="status">找到 ${list.length} 节课程${filter==='recent'?' · 最近访问优先':''}</p>
  ${!c&&!query&&filter==='all'&&catalogOrder==='path'?`<div class="chapter-cards">${CHAPTERS.map((x,i)=>{const a=lessons.filter(l=>l.chapterId===x.id),n=a.filter(l=>progress[l.id]?.completed).length;return `<button class="chapter-card" data-chapter="${x.id}"><div class="card-top"><span class="big-symbol ${x.color}">${esc(x.icon)}</span><span class="card-index">CHAPTER ${String(i+1).padStart(2,'0')}</span></div><h3>${x.name}<span>↗</span></h3><p>${x.subtitle}</p><div class="card-meta"><span>${a.length} 个教学板块</span><span>${n}/${a.length} 已完成</span></div><div class="progress-track"><i style="width:${n/a.length*100}%"></i></div></button>`;}).join('')}</div>`:`<div class="lesson-list">${ordered.length?ordered.map((l,i)=>`<button class="lesson-row" data-lesson="${l.id}"><span class="row-index">${String(i+1).padStart(2,'0')}</span><div><h3>${progress[l.id]?.bookmarked?'★ ':''}${esc(l.tutorial.title)}</h3><p>${esc(l.tutorial.intro)}</p><span class="muted">${chapter(l.chapterId).name} · 可分次学习 · ${l.quiz.length} 道测验 + 1 道实操</span></div><span class="status ${progress[l.id]?.completed?'finished':''}">${status(l)}</span><span>→</span></button>`).join(''):`<div class="empty"><span>⌕</span><h3>${filter==='wrong'?'暂时没有需要复习的板块':'没有找到匹配的课程'}</h3><p>${filter==='wrong'?'提交测验后，答错的板块会自动出现在这里。':'试试其他关键词，或切回全部课程。'}</p></div>`}</div>`}
  </section><div class="source-note"><span>资料说明</span><p>围绕前端常见知识点编写教学、示例与练习。涉及历史 API 和版本差异的内容在相关小课说明。</p></div></div>`;
  $('#filter')?.addEventListener('change',e=>{filter=e.target.value;saveCatalog();renderHome();});
  $('#catalog-order').onchange=e=>{catalogOrder=e.target.value;saveCatalog();renderHome();};
  $('#clear-search').onclick=()=>{query='';filter='all';saveCatalog();renderHome();$('#search').focus();};
  $('#search')?.addEventListener('input',e=>{if(e.isComposing)return;query=e.target.value;const position=e.target.selectionStart;renderHome();$('#search').focus();try{$('#search').setSelectionRange(position,position);}catch{}});
  $('#search').oncompositionend=e=>e.target.dispatchEvent(new Event('input',{bubbles:true}));
}
function quizMarkup(q,index,p) {
  const value=p.answers?.[q.id];
  return `<fieldset class="quiz-item" data-quiz-id="${esc(q.id)}" aria-labelledby="quiz-label-${esc(q.id)} quiz-prompt-${esc(q.id)}"><legend id="quiz-label-${esc(q.id)}"><span class="question-number">${String(index+1).padStart(2,'0')}</span><span class="question-type">${q.type==='choice'?'单选题':'填空题'}</span></legend>${quizPromptMarkup(q,codeBlock)}${q.type==='choice'?`<div class="choices">${q.options.map((o,i)=>`<label class="choice ${value===i?'checked':''}"><input type="radio" name="${esc(q.id)}" value="${i}" data-quiz="${esc(q.id)}" ${value===i?'checked':''}><span class="option-letter">${String.fromCharCode(65+i)}</span><span>${quizOptionMarkup(q,i)}</span></label>`).join('')}</div>`:`<label class="fill-label">你的答案 <span class="fill-rule ${q.caseSensitive?'strict':''}">${q.caseSensitive?'区分大小写':'忽略大小写'}</span><input data-quiz="${esc(q.id)}" type="text" maxlength="500" value="${esc(value??'')}" placeholder="填写空白处的答案" autocomplete="off" aria-describedby="fill-rule-${esc(q.id)}"></label><p class="fill-case-reason" id="fill-rule-${esc(q.id)}">${esc(q.caseReason||'按题目要求填写。')}</p>`}</fieldset>`;
}
function profileFor(l){const profile=runExamples[l.id]||{};return {...profile,mainLanguage:profile.mainLanguage||(['html','css'].includes(l.code.language)?l.code.language:'javascript')};}
function isWeb(l,p){return (p.runMode||runExamples[l.id]?.mode)==='web';}
function editorValue(l,p){return isWeb(l,p)?webFiles(profileFor(l),p)[activeCodeFile]:p.code;}
function saveCode(value) {
  if(changingEditor)return;
  const l=lessons.find(l=>l.id===currentId);if(!l)return;
  const p=state(l.id);
  if(isWeb(l,p)&&activeCodeFile!==mainLanguage(profileFor(l))){p.webFiles||={};p.webFiles[activeCodeFile]=value;}
  else {p.code=value;p.codeEdited=true;delete p.aiError;}
  const saved=save();
  const count=$('#code-count');if(count)count.textContent=`${value.length.toLocaleString()} / 30,000 字符 · ${saved?'已保存到本机':'自动保存失败，请导出记录'}`;
  activePlayground?.markDirty();renderFeedback(l,p);
}
function editorLanguage(l,p){if(isWeb(l,p))return activeCodeFile;const mode=p.runMode||runExamples[l.id]?.mode;return ['javascript','html','css'].includes(mode)?mode:l.code.language;}
function refreshEditorFiles(l,p){
  const web=isWeb(l,p),primary=mainLanguage(profileFor(l));
  $('#editor-files').hidden=!web;
  for(const button of $$('[data-code-file]')){const selected=button.dataset.codeFile===activeCodeFile;button.classList.toggle('selected',selected);button.setAttribute('aria-selected',String(selected));button.textContent=({html:'HTML',css:'CSS',javascript:'JavaScript'}[button.dataset.codeFile])+(button.dataset.codeFile===primary?' · 本题实现':'');}
  $('#editor-file-help').hidden=!web;
  $('#restore-code').textContent=web&&activeCodeFile!==primary?'恢复此文件初始内容':'恢复本题初始代码';
}
function selectCodeFile(language){
  const l=lessons.find(l=>l.id===currentId);if(!l)return;const p=state(l.id);
  activeCodeFile=WEB_LANGUAGES.includes(language)?language:mainLanguage(profileFor(l));
  changingEditor=true;
  try {activeEditor?.setLanguage(editorLanguage(l,p));activeEditor?.setValue(editorValue(l,p));}
  finally{changingEditor=false;}
  $('#code-editor').value=editorValue(l,p);$('#code-count').textContent=`${editorValue(l,p).length.toLocaleString()} / 30,000 字符 · 草稿保存在本机`;
  $('#editor-mode').textContent=(activeEditor?'智能编辑 · ':'纯文本编辑 · ')+editorLanguage(l,p);
  refreshEditorFiles(l,p);activeEditor?.refresh();
}
function ensureEditor() {
  if(activeEditor||!$('#code-editor-host'))return;
  const l=lessons.find(l=>l.id===currentId),p=state(l.id);
  try {
    activeEditor=createCodeEditor($('#code-editor-host'),{value:editorValue(l,p),language:editorLanguage(l,p),onChange:saveCode,maxLength:30000,onLimit:()=>toast("代码最多 30,000 字符，本次超出限制的输入未写入。")});
    $('#code-editor').hidden=true;
    $('#editor-tools').hidden=false;
    $('#editor-mode').textContent='智能编辑 · '+editorLanguage(l,p);
  } catch(error) { $('#editor-mode').textContent='纯文本编辑 · 草稿仍会自动保存'; }
}
function codeBlock(source,language) {return `<div class="code-example"><div class="code-toolbar"><span>${esc(language||'javascript')}</span><button class="copy-code" type="button">复制代码</button></div><pre><code>${esc(source)}</code></pre></div>`;}
function activateStage(id,{scroll=true}={}) {
  if(!STAGES.some(s=>s[0]===id))return;
  if(id!=='coding')activePlayground?.stop();
  if(currentStage!==id)tutorFocus=null;
  currentStage=id;
  if(currentId){state(currentId).lastStage=id;save();if(scroll){const params=new URLSearchParams(location.hash.split('?')[1]||'');params.set('stage',id);for(const key of ['check','quiz','question'])params.delete(key);history.replaceState(null,'','#lesson/'+encodeURIComponent(currentId)+'?'+params);}}
  refreshStageNavigation();
  $$('[data-stage-panel]').forEach(p=>p.hidden=p.id!==id);
  $$('[data-stage],[data-scroll]').forEach(b=>{const selected=(b.dataset.stage||b.dataset.scroll)===id;b.classList.toggle('current',selected);if(selected)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');});
  if(id==='coding'){ensureEditor();activeEditor?.refresh();}
  tutor?.refresh();
  if(scroll){const panel=document.getElementById(id);panel?.scrollIntoView({behavior:'smooth',block:'start'});const heading=panel?.querySelector('h2');heading?.setAttribute('tabindex','-1');heading?.focus({preventScroll:true});}
}
function lessonToolsMarkup(l,p){
  const index=lessons.indexOf(l),previous=lessons[index-1],next=lessons[index+1];
  return `<div class="lesson-tools">${reviewReturn?`<a class="text-button center-return" href="${esc(reviewReturn)}">← 返回学习回顾（保留筛选）</a>`:''}<div class="lesson-tools-row"><button type="button" id="bookmark-lesson" class="button secondary small" aria-pressed="${!!p.bookmarked}">${p.bookmarked?'★ 已收藏':'☆ 收藏本课'}</button><div class="stage-navigation" aria-label="相邻关卡"><button type="button" id="previous-stage" class="text-button">← 上一关</button><span id="stage-navigation-label"></span><button type="button" id="next-stage" class="text-button">下一关 →</button></div><button type="button" id="lesson-back-top" class="text-button">回到本课顶部 ↑</button></div><div class="lesson-tools-row"><details class="lesson-reading"><summary>正文阅读设置</summary><div class="reading-controls"><label>字号 <input id="lesson-font" type="range" min="14" max="22" step="1" value="${reading.font}"><output id="lesson-font-label">${reading.font}px</output></label><label>行距 <select id="lesson-line"><option value="1.7" ${reading.line===1.7?'selected':''}>紧凑</option><option value="2" ${reading.line===2?'selected':''}>标准</option><option value="2.3" ${reading.line===2.3?'selected':''}>宽松</option></select></label><button type="button" id="lesson-reading-reset" class="text-button">恢复默认</button></div></details><details class="lesson-notes"><summary>我的课堂笔记${p.notes?.trim()?' · 已记录':''}</summary><label for="lesson-notes">记下自己的理解和待解决的问题</label><textarea id="lesson-notes" maxlength="10000" rows="5" placeholder="例如：这个概念能用在哪？我还没弄懂哪一步？">${esc(p.notes||'')}</textarea><p id="lesson-notes-status" role="status">${(p.notes||'').length} / 10,000 字符 · 随学习记录导出，不自动发送给模型</p></details></div><div class="lesson-neighbours">${previous?`<button type="button" class="text-button" data-lesson="${previous.id}">← 上一课：${esc(previous.tutorial.title)}</button>`:'<span>这是第一课</span>'}${next?`<button type="button" class="text-button" data-lesson="${next.id}">下一课：${esc(next.tutorial.title)} →</button>`:'<span>已到最后一课</span>'}</div></div>`;
}
function refreshStageNavigation(){
  const index=STAGES.findIndex(stage=>stage[0]===currentStage),label=$('#stage-navigation-label');if(!label)return;
  label.textContent=`${index+1} / ${STAGES.length} · ${STAGES[index]?.[1]||''}`;
  $('#previous-stage').disabled=index<=0;$('#next-stage').disabled=index>=STAGES.length-1;
}
function mountLessonTools(l,p){
  $('#bookmark-lesson').onclick=event=>{p.bookmarked=!p.bookmarked;save();event.currentTarget.textContent=p.bookmarked?'★ 已收藏':'☆ 收藏本课';event.currentTarget.setAttribute('aria-pressed',String(p.bookmarked));toast(p.bookmarked?'已加入收藏，可在课程筛选中查看。':'已取消收藏。');};
  $('#previous-stage').onclick=()=>{const index=STAGES.findIndex(stage=>stage[0]===currentStage);if(index>0)activateStage(STAGES[index-1][0]);};
  $('#next-stage').onclick=()=>{const index=STAGES.findIndex(stage=>stage[0]===currentStage);if(index<STAGES.length-1)activateStage(STAGES[index+1][0]);};
  $('#lesson-back-top').onclick=()=>{$('.lesson-heading').scrollIntoView({behavior:'smooth',block:'start'});$('.lesson-heading h1').setAttribute('tabindex','-1');$('.lesson-heading h1').focus({preventScroll:true});};
  const apply=()=>{reading={font:Number($('#lesson-font').value),line:Number($('#lesson-line').value)};$('#lesson-font-label').textContent=reading.font+'px';if(!saveReadingPreferences(document.documentElement,localStorage,reading))toast('阅读设置暂时无法保存。');};
  $('#lesson-font').oninput=apply;$('#lesson-line').onchange=apply;
  $('#lesson-reading-reset').onclick=()=>{$('#lesson-font').value='15';$('#lesson-line').value='2';apply();};
  $('#lesson-notes').oninput=event=>{p.notes=event.target.value.slice(0,10000);const saved=save();$('#lesson-notes-status').textContent=`${p.notes.length} / 10,000 字符 · ${saved?'已保存，随学习记录导出':'保存失败，请复制备份'}`;};
  const heading=$('.deep-dives-heading');
  if(heading){const button=document.createElement('button');button.type='button';button.className='text-button';button.textContent='全部展开';let expanded=false;button.onclick=()=>{expanded=!expanded;$$('.deep-dive').forEach(detail=>detail.open=expanded);button.textContent=expanded?'全部收起':'全部展开';};heading.append(button);}
}
function refreshQuizProgress(l,p){
  const done=answeredQuestions(l.quiz,p.answers),count=done.filter(Boolean).length;
  const label=$('#quiz-progress-label');if(!label)return;
  label.textContent=`已作答 ${count} / ${l.quiz.length} 题${count===l.quiz.length?' · 可以提交':' · 还有 '+(l.quiz.length-count)+' 题待完成'}`;
  $('#quiz-next-unanswered').disabled=count===l.quiz.length;
  $('#quiz-submit-warning').hidden=true;
  $('#quiz-answer-map').innerHTML=l.quiz.map((q,i)=>`<button type="button" class="${done[i]?'answered':''}" data-question-jump="${esc(q.id)}" aria-label="第 ${i+1} 题，${done[i]?'已作答':'未作答'}">${i+1}${done[i]?' ✓':''}</button>`).join('');
}
function submitQuiz(l,p,allowPartial=false){
  const done=answeredQuestions(l.quiz,p.answers),missing=done.filter(value=>!value).length;
  if(missing&&!allowPartial){
    const warning=$('#quiz-submit-warning');warning.hidden=false;warning.innerHTML=`<b>还有 ${missing} 题未作答</b><p>可以继续完成，也可以明确提交当前答案；未答题会计入本次评分。</p><button type="button" id="finish-unanswered" class="button secondary small">继续完成未答题</button><button type="button" id="submit-partial" class="text-button">仍然提交当前答案</button>`;
    $('#finish-unanswered').onclick=()=>{warning.hidden=true;focusQuizQuestion($('#quiz-form'),l.quiz[done.findIndex(value=>!value)].id);};
    $('#submit-partial').onclick=()=>submitQuiz(l,p,true);warning.scrollIntoView({behavior:'smooth',block:'center'});$('#finish-unanswered').focus({preventScroll:true});return;
  }
  p.quizResult=gradeQuiz(l.quiz,p.answers);addQuizReview(p,makeQuizReview(l.id,p.answers,p.quizResult,l.quiz),l);wrongOnly=false;save();renderFeedback(l,p);activateStage('evaluation');
}
function submittedAnswer(question,answers){
  const value=answers?.[question.id];
  if(value===undefined||value===null||String(value).trim()==='')return '<span class="muted">未作答</span>';
  return question.type==='choice'?quizOptionMarkup(question,value):inlineCodeMarkup(String(value));
}
function renderLesson() {
  disposeEditor();
  const l=lessons.find(l=>l.id===currentId), c=chapter(l.chapterId), p=state(l.id), next=lessons[lessons.indexOf(l)+1], runProfile=profileFor(l);
  activeCodeFile=mainLanguage(runProfile);ensureTutorState(p,l);
  if(p.code===undefined||(!p.code&&!p.codeEdited))p.code=l.challenge.starter;
  $('#main').innerHTML=`<div class="lesson-page"><div class="breadcrumbs"><button data-home>学习总览</button><span>/</span><button data-chapter="${c.id}">${c.name}</button><span>/</span><span>核心问题 ${lessons.filter(x=>x.chapterId===c.id).indexOf(l)+1}</span></div>
  <div class="lesson-heading"><div><div class="eyebrow">${c.name.toUpperCase()} · ${esc(l.level)} · 教材与练习</div><h1>${esc(l.tutorial.title)}</h1><p class="lesson-sequence">先读教材正文，学会概念与用法，再进入课堂提问和习题作业。</p><div class="lesson-meta"><span>◷ 可分次学习 · 7 个关卡</span><span>✎ ${l.quiz.length} 道测验 + 代码实操</span></div></div><span class="status ${p.completed?'finished':''}">${status(l)}</span></div>
  ${stageBar()}${lessonToolsMarkup(l,p)}<div class="lesson-layout"><div class="lesson-content">${textbookMarkup(l.tutorial,p.tutorialRead,codeBlock)}
  <section class="learning-section" id="teach" data-stage-panel><div class="block-heading"><span>02</span><div><h2>用问题检查理解</h2><p>课堂提问 · 先自己想，再组织面试表达</p></div><span class="block-icon">◫</span></div><div class="classroom-question"><span class="eyebrow">先用自己的话试着回答</span><h3>${esc(l.title)}</h3><p>${esc(l.question)}</p><button class="text-button" data-stage="textbook">概念还不清楚？回到基础教学</button></div><details class="interview-answer"><summary>展开参考回答与面试表达</summary><p>${esc(l.answer)}</p></details>${l.explanation.map(e=>`<div class="explanation"><h3>${esc(e.title)}</h3><p>${esc(e.body)}</p></div>`).join('')}<h3 class="code-heading">用代码理解</h3>${codeBlock(l.code.source,l.code.language)}<p class="code-explanation">${esc(l.code.explanation)}</p>${l.pitfalls.length?`<div class="pitfall"><b>容易踩的坑</b><ul>${l.pitfalls.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:''}${deepDivesMarkup(l)}</section>
  <section class="learning-section" id="practice" data-stage-panel><div class="block-heading"><span>03</span><div><h2>先检验基础知识</h2><p>客观练习 · 选择题与填空题</p></div><span class="block-icon">✎</span></div><div class="quiz-progress-tools"><p id="quiz-progress-label" role="status"></p><button type="button" id="quiz-next-unanswered" class="button secondary small">跳到下一道未答题</button></div><nav id="quiz-answer-map" class="quiz-answer-map" aria-label="题目作答导航"></nav><div id="quiz-submit-warning" class="quiz-submit-warning" role="alert" hidden></div><div id="quiz-form">${l.quiz.map((q,i)=>quizMarkup(q,i,p)).join('')}</div><div class="quiz-footer"><button class="button primary" id="grade-quiz">提交客观题，查看解析 <span>→</span></button><span class="muted">先看本次答题反馈，再继续代码实操</span></div></section>
  <section class="learning-section" id="evaluation" data-stage-panel><div class="block-heading"><span>04</span><div><h2>看看基础掌握了多少</h2><p>答题反馈 · 逐题解析后，再进入代码实操</p></div><span class="block-icon">✓</span></div><div id="quiz-feedback"></div><div class="stage-next"><button class="button secondary" data-stage="practice">← 返回修改答案</button><button class="button primary" data-stage="coding">继续代码实操 →</button></div></section>
  <section class="learning-section coding-section" id="coding" data-stage-panel><div class="block-heading"><span>05</span><div><h2>把理解写成代码</h2><p>代码实操 · 独立完成，再提交评阅</p></div><span class="block-icon">⌘</span></div><div class="challenge-head"><span class="tag">代码实操</span><h3>${esc(l.challenge.title)}</h3><p>${esc(l.challenge.description)}</p></div><details class="hints"><summary>需要一点提示？</summary><ul>${l.challenge.hints.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></details><div class="editor-label"><b id="editor-title">你的实现</b><span>自动保存草稿 · 最多 30,000 字符</span></div><div id="editor-files" class="editor-files" role="tablist" aria-label="联动预览文件" hidden>${WEB_LANGUAGES.map(file=>`<button type="button" role="tab" data-code-file="${file}" aria-selected="false">${file}</button>`).join('')}</div><p id="editor-file-help" class="field-help" hidden>联动评阅会一起提交 HTML、CSS、JavaScript 和初始化调用，让老师结合整个页面检查交互。</p><div class="editor-wrapper"><div class="editor-header"><span id="editor-mode">实操草稿</span><button id="restore-code" type="button">恢复初始代码</button></div><div id="editor-tools" class="editor-tools" hidden><button id="indent-code" type="button" title="按当前语言重新整理行首缩进">整理缩进</button><button id="undo-code" type="button">撤销</button><button id="redo-code" type="button">重做</button><button id="search-code" type="button">查找</button><span>Tab 缩进 · Shift+Tab 退格缩进 · Ctrl+F 查找</span></div><div id="code-editor-host" aria-labelledby="editor-title"></div><textarea id="code-editor" aria-label="代码实操编辑器" spellcheck="false" maxlength="30000">${esc(p.code)}</textarea><div class="editor-status"><span id="code-count">${p.code.length.toLocaleString()} / 30,000 字符 · 草稿保存在本机</span><span>Esc 后按 Tab 可移出编辑器</span></div></div>${playgroundMarkup(runProfile,p)}<div class="practice-actions"><button class="button primary" id="grade-code" ${grading.has(l.id)?'disabled':''}>${grading.has(l.id)?'正在评阅…':'✧ AI 评阅代码'}</button><span class="muted">AI 按本题标准评阅 · 联动模式提交完整页面</span></div></section>
  <section class="learning-section" id="code-review" data-stage-panel><div class="block-heading"><span>06</span><div><h2>看看代码可以怎样改进</h2><p>代码评阅 · 按评分要点迭代你的实现</p></div><span class="block-icon">✧</span></div><div id="ai-feedback" aria-live="polite"></div><details class="reference-solution"><summary>查看当前教材的参考实现与评分要点</summary><ul>${l.challenge.rubric.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>${codeBlock(l.challenge.solution,l.code.language)}</details><div class="stage-next"><button class="button secondary" data-stage="coding">← 返回修改代码</button><button class="button primary" data-stage="conclusion">进入本课总结 →</button></div></section>
  <section class="learning-section" id="conclusion" data-stage-panel><div class="block-heading"><span>07</span><div><h2>最后，用自己的话说一遍并统一评阅</h2><p>本课总结与小节统一评阅 · 让 AI 评审「我的回忆与例子」</p></div><span class="block-icon">◎</span></div><div id="study-check-host"></div><section class="summary-review-section" id="summary-review-section" aria-label="本课总结与小节统一评阅"><div class="ai-review-heading"><h3>✧ 小节统一评阅 · AI 评审「我的回忆与例子」</h3><span class="tag">${config.provider==='gemini'?'Gemini':'OpenAI 兼容'}</span></div><p class="muted">写完上方「我的回忆与例子」后点击评审；模型会结合本课教材、你的自评以及已完成的客观题和代码评阅情况，逐项点评概念准确性、自举例子与疑问点。</p><div id="summary-review-checklist" class="summary-checklist"></div><div class="practice-actions"><button class="button primary" id="review-summary" ${reviewingSummary.has(l.id)?'disabled':''}>${reviewingSummary.has(l.id)?'正在评审…':'✧ AI 评审我的回忆与例子'}</button><span class="muted">保存本次回忆快照 · 可在右侧助教针对本次评审继续追问</span></div><div id="summary-ai-feedback" aria-live="polite"></div></section><details class="summary-reference"><summary>对照参考总结</summary><div class="summary-box professional"><span>面试版 · 专业回答</span><p>${esc(l.summary.professional)}</p></div><div class="summary-box simple"><span>白话版 · 简单理解</span><p>${esc(l.summary.simple)}</p></div></details>${l.references?.length?`<div class="references"><span>继续深入</span>${l.references.map(r=>`<a href="${esc(safeLink(r.url))}" target="_blank" rel="noopener">${esc(r.title)} ↗</a>`).join('')}</div>`:''}<div class="lesson-finish"><button class="button ${p.completed?'secondary':'primary'}" id="complete-lesson">${p.completed?'✓ 已完成 · 点击撤销':'✓ 我掌握了，标记完成'}</button>${next?`<button class="button secondary" data-lesson="${next.id}">下一课 →</button>`:`<button class="button secondary" data-home>返回知识地图 →</button>`}</div><p class="field-help">完成标记由你确认；它与测验成绩分别记录。<button type="button" id="reset-lesson" class="text-button">重置本课记录</button></p></section>
  </div><aside class="lesson-outline"><div class="outline-title">本课路线 <span>7 STEPS</span></div>${STAGES.map((x,i)=>`<button class="outline-step" data-scroll="${x[0]}"><span>${String(i+1).padStart(2,'0')}</span><div><b>${x[1]}</b><small>${x[2]}</small></div></button>`).join('')}<div class="outline-note"><span>学习小建议</span><p>读完先合上答案，试着讲给一个刚入门的朋友听。</p></div><div class="outline-tags">${l.tags.map(t=>`<span>${esc(t)}</span>`).join('')}</div></aside></div></div>`;
  for(const [index,section] of $$('.book-section').entries())section.insertAdjacentHTML('beforeend',`<button type="button" class="text-button" data-tutor-book="${index}">问 AI 这一节 →</button>`);
  for(const [id,label] of [['teach','进入客观练习'],['practice','查看已有答题反馈'],['coding','查看代码评阅与参考实现']]) {
    const next=STAGES[STAGES.findIndex(s=>s[0]===id)+1][0];
    document.getElementById(id).insertAdjacentHTML('beforeend',`<div class="stage-next"><span>你也可以通过上方关卡返回前面的内容。</span><button class="button secondary" data-stage="${next}">${label} →</button></div>`);
  }
  activePlayground=mountPlayground($('#coding'),{profile:runProfile,state:p,onSave:()=>{const saved=save();renderFeedback(l,p);return saved;},readCode:()=>p.code,readFiles:()=>webFiles(runProfile,p),onLanguage:()=>selectCodeFile(mainLanguage(runProfile))});
  for(const button of $$('[data-code-file]'))button.onclick=()=>selectCodeFile(button.dataset.codeFile);
  refreshEditorFiles(l,p);
  mountLessonTools(l,p);renderFeedback(l,p);refreshQuizProgress(l,p);activateStage(currentStage,{scroll:false});
  $$('[data-quiz]').forEach(input=>input.addEventListener('change',e=>{p.answers[e.target.dataset.quiz]=e.target.type==='radio'?Number(e.target.value):e.target.value;delete p.quizResult;save();refreshQuizProgress(l,p);if(e.target.type==='radio'){$$('label.choice',e.target.closest('fieldset')).forEach(x=>x.classList.toggle('checked',$('input',x).checked));}renderFeedback(l,p);}));
  $$('input[type=text][data-quiz]').forEach(input=>input.addEventListener('input',e=>{p.answers[e.target.dataset.quiz]=e.target.value;delete p.quizResult;save();refreshQuizProgress(l,p);renderFeedback(l,p);}));
  $('#grade-quiz').onclick=()=>submitQuiz(l,p);
  $('#quiz-next-unanswered').onclick=()=>{const i=answeredQuestions(l.quiz,p.answers).findIndex(done=>!done);if(i>=0)focusQuizQuestion($('#quiz-form'),l.quiz[i].id);};
  $('#quiz-answer-map').onclick=e=>{const b=e.target.closest('[data-question-jump]');if(b)focusQuizQuestion($('#quiz-form'),b.dataset.questionJump);};
  $('#code-editor').addEventListener('input',e=>saveCode(e.target.value));
  $('#indent-code').onclick=()=>{activeEditor?.indentAll();activeEditor?.focus();};
  $('#undo-code').onclick=()=>{activeEditor?.undo();activeEditor?.focus();};
  $('#search-code').onclick=()=>activeEditor?.search();
  $('#redo-code').onclick=()=>{activeEditor?.redo();activeEditor?.focus();};
  $('#restore-code').onclick=()=>{
    const companion=isWeb(l,p)&&activeCodeFile!==mainLanguage(runProfile);
    const initial=companion?webFiles(runProfile,{code:l.challenge.starter})[activeCodeFile]:l.challenge.starter;
    if(editorValue(l,p)!==initial&&!confirm('恢复当前文件的初始内容？此文件的草稿会被替换。'))return;
    if(companion){p.webFiles||={};p.webFiles[activeCodeFile]=initial;}
    else {p.code=initial;p.codeEdited=false;delete p.aiResult;delete p.aiError;}
    save();selectCodeFile(activeCodeFile);activePlayground?.markDirty();renderFeedback(l,p);
  };
  $('#grade-code').onclick=()=>gradeCode(l,p);
  $('#review-summary').onclick=()=>reviewSummary(l,p);
  $('#reset-lesson').onclick=async()=>{if(grading.has(l.id)||reviewingSummary.has(l.id)||tutor?.isBusy()){toast('请等待 AI 请求结束或先停止追问。');return;}if(!confirm('重置本课的草稿、答案、笔记、收藏、评测、助教对话和完成标记？执行前会先保存一个记录还原点。'))return;try{if(!backupManager)throw new Error('记录还原点尚未准备好，请稍后重试。');await backupManager.checkpoint();}catch(error){toast(error.message||'创建还原点失败，已保留本课记录。');return;}delete progress[l.id];save();if(currentId===l.id){currentStage="textbook";renderLesson();}else route();renderSidebar();toast('本课记录已重置。');};
  bindStudyCheck($('#study-check-host'),{record:p,save,goals:l.tutorial?.objectives||[],kind:'frontend',onChange:()=>{delete p.summaryAiError;renderSummaryFeedback(l,p);}});
  renderSummaryFeedback(l,p);
  if(new URLSearchParams(location.hash.split('?')[1]||'').get('check')==='1'&&currentStage==='conclusion')requestAnimationFrame(()=>$('#study-check-host')?.scrollIntoView({block:'start'}));
  $('#complete-lesson').onclick=()=>{p.completed=!p.completed;save();renderSidebar();renderLesson();toast(p.completed?'已记录，继续保持。':'已取消完成标记。');};
}
function renderFeedback(l,p) {
  if(!$('#quiz-feedback'))return;
  const quizReview=p.quizReviews?.find(item=>item.id===p.quizReviewId);
  const attempt=quizAttempt(l,quizReview||p),result=attempt?.result,questions=attempt?.questions||[],submitted=attempt?.answers||{},newQuestions=attempt?.newQuestions||[];
  const quizStale=quizReview&&JSON.stringify(quizReview.answers)!==JSON.stringify(p.answers);
  $('#quiz-feedback').innerHTML=result?`<div class="feedback-heading"><h3>客观题评测</h3><strong class="score ${!attempt.incomplete&&result.score===100?'perfect':''}">${attempt.incomplete&&Number.isFinite(attempt.originalScore)?attempt.originalScore:result.score}<small> / 100</small></strong></div><p class="muted">${attempt.incomplete?'已恢复题目当前核对：':'答对 '}${result.correct} / ${questions.length} 题${result.unanswered?` · ${result.unanswered} 题未作答`:''}。${attempt.incomplete?'以上仅核对可恢复题目，不据此判断整次掌握情况。':result.score===100?'基础概念掌握得不错，继续挑战代码题。':'查看解析后，可以修改答案再次提交。'}</p>${quizReview?`<p class="field-help">提交于 ${esc(reviewTime(quizReview.createdAt))}${quizStale?' · 当前答案已修改，下方是该次提交的反馈。':''}</p>`:''}${attempt.incomplete?`<p class="info-note">旧记录题集不完整${Number.isFinite(attempt.originalScore)?`，原分 ${attempt.originalScore} 已保留`:""}。原总题数与未答题集合无法恢复；下方仅展示已恢复答案的当前核对，不能据此重算原分。</p>`:''}${newQuestions.length?`<div class="info-note">${attempt.incomplete?`另有 ${newQuestions.length} 道未包含在旧记录中的练习。`:`本课新增 ${newQuestions.length} 道补充练习，不计入这次旧成绩。`}<button type="button" class="text-button" data-edit-question="${esc(newQuestions[0].id)}">去做新增题 →</button></div>`:''}<div class="quiz-review-tools"><label><input type="checkbox" id="quiz-wrong-only" ${wrongOnly?'checked':''}> 只看错题与未答题</label><button type="button" id="retry-wrong" class="button secondary small" ${result.correct===questions.length?'disabled':''}>仅重做错题</button><button type="button" class="text-button" data-feedback-expand>展开可见解析</button><button type="button" class="text-button" data-feedback-collapse>收起解析</button></div><p class="field-help">先对照原题与自己的提交解释理由，再打开参考答案核对。展开解析不会改动成绩。</p><p class="field-help" data-no-wrong ${wrongOnly&&result.correct===questions.length?'':'hidden'}>本次全部答对，没有错题需要重做。</p><div class="quiz-results">${result.items.map((r,i)=>quizFeedbackCard(questions.find(q=>q.id===r.id)||questions[i],r,i,submitted,{wrongOnly,codeBlock})).join('')}</div>`:`<div class="feedback-empty"><span>◌</span><div><h3>等待你的第一次测验</h3><p>在第 3 关完成选择题和填空题并提交，即可查看分数与逐题解析。</p></div></div>`;
  bindQuizFeedbackTools($('#quiz-feedback'),{onFilter:value=>wrongOnly=value});
  $('#retry-wrong')?.addEventListener('click',()=>{p.answers=retryIncorrect(questions,{...p.answers,...submitted},result);delete p.quizResult;save();currentStage='practice';renderLesson();toast('已保留这次提交的正确答案，错题可以重新作答。');});
  for(const button of $$('[data-edit-question]'))button.onclick=()=>{activateStage('practice');focusQuizQuestion($('#quiz-form'),button.dataset.editQuestion);};
  const codeReview=p.codeReviews?.find(item=>item.id===p.aiReviewId);
  const a=codeReview?.result||p.aiResult,stale=a&&(codeReview?submissionSignature(codeReview.submission)!==submissionSignature(currentSubmission(l,p)):p.gradedCode!==p.code);
  $('#ai-feedback').innerHTML=`<div class="ai-review-heading"><h3>✧ 代码实操评阅</h3><span class="tag">${config.provider==='gemini'?'Gemini':'OpenAI 兼容'}</span></div>${codeReview?`<p class="field-help">评阅于 ${esc(reviewTime(codeReview.createdAt))} · ${codeReview.legacy?'旧版主文件评阅':codeReview.submission.mode==='web'?'HTML / CSS / JavaScript 整页评阅':'代码评阅'} · 可在右侧选择这次评阅继续追问</p>`:''}${grading.has(l.id)?'<div class="info-note">正在请你的模型评阅，请稍候…</div>':''}${p.aiError?`<div class="error-note" role="alert">${esc(p.aiError)}</div>`:''}${a?`${stale?'<div class="info-note">页面代码或调用示例已修改。以下反馈对应所选的那次提交；助教会区分当时版本与当前草稿。</div>':''}${typeof a.score==='number'?`<div class="feedback-heading"><b>${esc(a.verdict)}</b><strong class="score">${a.score}<small> / 100</small></strong></div>`:'<p class="muted">模型返回了文字反馈，未提供有效结构化分数。</p>'}${a.rawFeedback?`<div class="ai-feedback-prose" id="ai-raw-feedback">${esc(a.rawFeedback)}</div>`:''}${a.strengths?.length?`<div class="feedback-column"><h4>做得好的地方</h4><ul>${a.strengths.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:''}${a.issues?.length?`<div class="feedback-column"><h4>可以改进</h4>${a.issues.map(x=>`<p><b>${esc(x.message)}</b><br>${esc(x.suggestion)}</p>`).join('')}</div>`:''}${a.nextSteps?.length?`<div class="feedback-column"><h4>下一步练习</h4><ul>${a.nextSteps.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:''}${a.referenceExplanation?`<div class="ai-feedback-prose" id="ai-reference-explanation">${esc(a.referenceExplanation)}</div>`:''}<p class="field-help">AI 反馈供学习参考。AI 评阅不会自动运行代码；你可以返回实操区，用浏览器中的运行结果对照修改。</p>`:`<p class="muted">${apiKey?'在第 5 关写好代码后点击“AI 评阅代码”，模型将按本题评分要点给出建议。':'尚未接入模型。你可以先完成全部课程与客观题，随时在右上角配置评分接口。'}</p><ul class="rubric-preview">${l.challenge.rubric.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`}`;if(codeReview)$('#ai-feedback').insertAdjacentHTML('beforeend',reviewSnapshotMarkup(codeReview,{codeBlock}));for(const [id,value] of [['ai-raw-feedback',a?.rawFeedback],['ai-reference-explanation',a?.referenceExplanation]]){if(value&&document.getElementById(id))try{renderTutorMarkdown(document.getElementById(id),value,{toast});}catch{document.getElementById(id).textContent=value;}}renderSummaryFeedback(l,p);tutor?.refresh();
}
const SUMMARY_RATINGS={relearn:'还需要重新理解',explain:'能够用自己的话解释',apply:'能够独立举例运用'};
function buildSummaryPayload(l,p){
  const reflection=String(p.studyCheck?.reflection||'').trim();
  const rating=Object.hasOwn(SUMMARY_RATINGS,p.studyCheck?.rating)?p.studyCheck.rating:'';
  const attempt=quizAttempt(l,p);
  const quizSummary=attempt?.result?{score:attempt.incomplete&&Number.isFinite(attempt.originalScore)?attempt.originalScore:attempt.result.score,correct:attempt.result.correct,total:attempt.questions.length,unanswered:attempt.result.unanswered,wrongPrompts:attempt.result.items.filter(i=>!i.correct).map(i=>attempt.questions.find(q=>q.id===i.id)?.prompt).filter(Boolean).slice(0,8)}:null;
  const codeReview=p.codeReviews?.find(item=>item.id===p.aiReviewId)||p.codeReviews?.at(-1);
  const codeSummary=codeReview?.result?{score:typeof codeReview.result.score==='number'?codeReview.result.score:null,verdict:codeReview.result.verdict||'',issues:(codeReview.result.issues||[]).map(x=>x.message).filter(Boolean).slice(0,6)}:null;
  return {reflection,rating,...(quizSummary?{quizSummary}:{}),...(codeSummary?{codeSummary}:{})};
}
function renderSummaryFeedback(l,p){
  const host=$('#summary-ai-feedback'),checklist=$('#summary-review-checklist'),button=$('#review-summary');
  if(!host)return;
  const payload=buildSummaryPayload(l,p),busy=reviewingSummary.has(l.id);
  const selected=p.summaryReviews?.find(item=>item.id===p.summaryReviewId)||p.summaryReviews?.at(-1)||null;
  const a=selected?.result,stale=selected&&selected.reflection!==payload.reflection;
  if(checklist){
    checklist.innerHTML=`<button type="button" class="summary-check-item" data-focus-reflection>${payload.reflection?'✓':'○'} 我的回忆与例子：${payload.reflection?`已填写 ${payload.reflection.length} 字${payload.rating?' · 自评「'+SUMMARY_RATINGS[payload.rating]+'」':''}`:'尚未填写（必填）'}</button><button type="button" class="summary-check-item" data-stage="evaluation">${payload.quizSummary?'✓':'○'} 客观题情况：${payload.quizSummary?`最近得分 ${payload.quizSummary.score} 分（${payload.quizSummary.correct}/${payload.quizSummary.total}，将自动附带）`:'尚未提交（可选）'}</button><button type="button" class="summary-check-item" data-stage="code-review">${payload.codeSummary?'✓':'○'} 代码实操评阅：${payload.codeSummary?`${typeof payload.codeSummary.score==='number'?payload.codeSummary.score+' 分':'已评阅'}（将自动附带）`:'尚未评阅（可选）'}</button>`;
    checklist.querySelector('[data-focus-reflection]')?.addEventListener('click',()=>{const el=$('#study-check-host [data-study-reflection]');el?.scrollIntoView({behavior:'smooth',block:'center'});el?.focus({preventScroll:true});});
  }
  if(button){button.disabled=busy;button.textContent=busy?'正在评审…':'✧ AI 评审我的回忆与例子';}
  host.innerHTML=`${selected?`<p class="field-help">评审于 ${esc(reviewTime(selected.createdAt))} · 可在右侧助教选择这次评审继续追问</p>`:''}${busy?'<div class="info-note">正在请你的模型评审「我的回忆与例子」并结合本课记录给出统一反馈，请稍候…</div>':''}${p.summaryAiError?`<div class="error-note" role="alert">${esc(p.summaryAiError)}</div>`:''}${a?`${stale?'<div class="info-note">上方「我的回忆与例子」已修改。以下反馈对应所选的那次提交快照；助教会区分原提交与当前草稿。</div>':''}${typeof a.score==='number'?`<div class="feedback-heading"><b>${esc(a.verdict)}</b><strong class="score">${a.score}<small> / 100</small></strong></div>`:'<p class="muted">模型返回了文字评审，未提供有效结构化分数。</p>'}${a.rawFeedback?`<div class="ai-feedback-prose" id="summary-raw-feedback">${esc(a.rawFeedback)}</div>`:''}${a.strengths?.length?`<div class="feedback-column"><h4>理解到位的地方</h4><ul>${a.strengths.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:''}${a.issues?.length?`<div class="feedback-column"><h4>需要修正或补充</h4>${a.issues.map(x=>`<p><b>${esc(x.message)}</b><br>${esc(x.suggestion)}</p>`).join('')}</div>`:''}${a.nextSteps?.length?`<div class="feedback-column"><h4>下一步巩固建议</h4><ul>${a.nextSteps.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:''}${a.referenceExplanation?`<div class="ai-feedback-prose" id="summary-reference-explanation">${esc(a.referenceExplanation)}</div>`:''}<div class="summary-review-actions"><button type="button" class="button secondary small" id="summary-followup">就这次评审继续追问</button>${p.summaryReviews?.length>1?`<label class="summary-history-picker">历史评审 <select id="summary-history-select">${p.summaryReviews.slice().reverse().map(r=>`<option value="${esc(r.id)}" ${r.id===selected.id?'selected':''}>${esc(reviewTime(r.createdAt))} · ${typeof r.result?.score==='number'?r.result.score+'分':'文字反馈'}</option>`).join('')}</select></label>`:''}</div><details class="review-snapshot"><summary>查看这次提交的回忆与自评快照</summary><p>以下是评审时保存的冻结内容，只读展示。之后修改上方文本框不会覆盖这份快照。</p>${selected.rating?`<p class="field-help">当时自评：${esc(SUMMARY_RATINGS[selected.rating]||selected.rating)}</p>`:''}<pre class="summary-snapshot-text">${esc(selected.reflection)}</pre></details><p class="field-help">AI 评审供学习参考，不改变客观题分数或课程完成标记。</p>`:`<p class="muted">${apiKey?'写好上方「我的回忆与例子」后点击评审，模型将从概念准确性、自举例子质量与疑问解答三个维度给出评分与建议。':'尚未接入模型。你可以先填写回忆与自评，随时在右上角配置评分接口后提交评审。'}</p>`}`;
  for(const [id,value] of [['summary-raw-feedback',a?.rawFeedback],['summary-reference-explanation',a?.referenceExplanation]]){if(value&&document.getElementById(id))try{renderTutorMarkdown(document.getElementById(id),value,{toast});}catch{document.getElementById(id).textContent=value;}}
  $('#summary-followup')?.addEventListener('click',()=>{if(selected){p.summaryReviewId=selected.id;save();tutor?.refresh();}tutor?.focus('请结合我这次提交的回忆与例子评审，进一步解释需要修正的地方。');});
  $('#summary-history-select')?.addEventListener('change',e=>{p.summaryReviewId=e.target.value;save();renderSummaryFeedback(l,p);tutor?.refresh();});
}
async function reviewSummary(l,p){
  if(reviewingSummary.has(l.id))return;
  if(!config.model||!config.baseUrl){openSettings();toast('先填写接口地址与模型名称。');return;}
  let isLocal=false;try{isLocal=['localhost','127.0.0.1','[::1]'].includes(new URL(config.baseUrl).hostname);}catch{}
  if(!apiKey&&!isLocal){openSettings();toast('请填写 API Key 并保存设置。');return;}
  const payload=buildSummaryPayload(l,p);
  if(!payload.reflection){toast('请先填写「我的回忆与例子」，再提交 AI 评审。');const el=$('#study-check-host [data-study-reflection]');el?.scrollIntoView({behavior:'smooth',block:'center'});el?.focus({preventScroll:true});return;}
  reviewingSummary.add(l.id);delete p.summaryAiError;renderSummaryFeedback(l,p);
  try{
    const response=await fetch('/api/review-summary',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config:{...config,apiKey},lessonId:l.id,...payload}),signal:AbortSignal.timeout(95000)});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'本课总结评审失败，请稍后重试。');
    addSummaryReview(p,makeSummaryReview(l.id,payload,data),l);save();
  }catch(e){p.summaryAiError=e.name==='TimeoutError'?'请求超时，请检查模型服务是否可用。':e.message;save();}
  finally{reviewingSummary.delete(l.id);if(currentId===l.id){renderSummaryFeedback(l,p);tutor?.refresh();$('#summary-ai-feedback')?.scrollIntoView({behavior:'smooth',block:'center'});}}
}
function currentSubmission(l,p){return buildSubmission(profileFor(l),p,{web:isWeb(l,p),language:l.code.language});}
function reviewTime(value){return !value||new Date(value).getTime()===0?'升级前记录':new Date(value).toLocaleString('zh-CN',{hour12:false});}
async function gradeCode(l,p) {
  if(grading.has(l.id))return;
  if(!config.model||!config.baseUrl){openSettings();toast('先填写接口地址与模型名称。');return;}
  let isLocal=false;try{isLocal=['localhost','127.0.0.1','[::1]'].includes(new URL(config.baseUrl).hostname);}catch{}
  if(!apiKey&&!isLocal){openSettings();toast('请填写 API Key 并保存设置。');return;}
  const submission=currentSubmission(l,p);
  if(submission.mode==='web'?!Object.values(submission.files).some(code=>code.trim()):!submission.code?.trim()){toast('先写一点代码，再提交评阅。');return;}
  grading.add(l.id);delete p.aiError;$('#grade-code').disabled=true;$('#grade-code').textContent='正在评阅…';renderFeedback(l,p);
  try {const response=await fetch('/api/grade',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config:{...config,apiKey},lessonId:l.id,submission}),signal:AbortSignal.timeout(95000)});const data=await response.json();if(!response.ok)throw new Error(data.error||'评阅失败，请稍后重试。');p.aiResult=data;p.gradedCode=submission.mode==='web'?submission.files[submission.mainLanguage]:submission.code;addCodeReview(p,makeCodeReview(l.id,submission,data,l.challenge),l);save();}
  catch(e){p.aiError=e.name==='TimeoutError'?'请求超时，请检查模型服务是否可用。':e.message;save();}
  finally{grading.delete(l.id);if(currentId===l.id){$('#grade-code').disabled=false;$('#grade-code').textContent='✧ AI 评阅代码';renderFeedback(l,p);activateStage('code-review',{scroll:false});$('#ai-feedback').scrollIntoView({behavior:'smooth',block:'center'});}}
}
function getTutorContext(){
  const l=lessons.find(item=>item.id===currentId);if(!l)return null;
  const p=state(l.id);ensureTutorState(p,l);
  const context=buildTutorContext({lesson:l,stage:currentStage,progress:p,profile:profileFor(l),focus:tutorFocus,question:currentStage==='teach'?l.deepDives?.find(item=>item.id===currentQuestion):null});
  let local=false;try{local=['localhost','127.0.0.1','[::1]'].includes(new URL(config.baseUrl).hostname);}catch{}
  context.configured=!!config.model&&!!config.baseUrl&&(!!apiKey||local);
  const reviews=context.kind==='code'?p.codeReviews:context.kind==='summary'?p.summaryReviews:context.kind==='quiz'&&currentStage==='evaluation'?p.quizReviews:[];
  if(reviews?.length)context.options=reviews.slice().reverse().map(review=>({key:review.id,label:`${reviewTime(review.createdAt)} · ${typeof review.result?.score==='number'?review.result.score+'分':'文字反馈'}${review.legacy?' · 旧版':''}`}));
  return context;
}
async function askTutor({context,question,history,signal}){
  let response;
  try{response=await fetch('/api/tutor',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...context.request,config:{...config,apiKey},question,history:trimTutorHistory(history)}),signal:AbortSignal.any([signal,AbortSignal.timeout(95000)])});}
  catch(error){if(error.name==='AbortError')throw error;throw new Error(error.name==='TimeoutError'?'助教响应超时，请稍后重试。':'无法连接助教服务，请检查网络连接和服务运行状态。');}
  if(response.status===404||response.status===405)throw new Error('助教服务版本尚未更新，请更新或重启学习服务后刷新页面。');
  let result;try{result=await response.json();}catch{throw new Error('助教接口返回格式异常，请稍后重试。');}
  if(!response.ok)throw new Error(result.error||'助教暂时无法回答，请稍后重试。');
  if(typeof result.reply!=='string'||!result.reply.trim())throw new Error('模型未返回有效回答。');
  if(result.contextId&&result.contextId!==context.key)throw new Error('回复的课程上下文不一致，请重新提问。');
  return result;
}
function applyLocalConfig(result){
  const {apiKey:key,...value}=result.config;config=value;apiKey=key;
  try{localStorage.setItem('zhixing-ai-config',JSON.stringify(config));}catch{}
  if(currentId)renderFeedback(lessons.find(l=>l.id===currentId),state(currentId));tutor?.refresh();
}
const settings=setupSettings({
  getConfig:()=>config,getApiKey:()=>apiKey,
  onSave:async(value,key)=>applyLocalConfig(await saveLocalConfig(value,key)),
  onClear:async()=>{const result=await clearLocalKey();if(result.saved)applyLocalConfig(result);else apiKey='';},
  onReset:async()=>applyLocalConfig(await resetLocalConfig()),toast
});
function openSettings(){settings.open();}
function initializeTutor(){tutor?.destroy();tutor=createTutorPanel({getContext:getTutorContext,onAsk:askTutor,onSave:save,onConfigure:openSettings,toast,onSelectContext:key=>{
  const l=lessons.find(item=>item.id===currentId);if(!l)return;const p=state(l.id);
  if(p.codeReviews?.some(review=>review.id===key))p.aiReviewId=key;
  else if(p.summaryReviews?.some(review=>review.id===key))p.summaryReviewId=key;
  else if(p.quizReviews?.some(review=>review.id===key))p.quizReviewId=key;
  tutorFocus=null;save();renderFeedback(l,p);tutor.refresh();
}});}
initializeTutor();

document.addEventListener('click',event=>{
  const button=event.target.closest('[data-tutor-quiz],[data-tutor-book]');if(!button)return;
  const lesson=lessons.find(item=>item.id===currentId);if(!lesson)return;
  if(button.dataset.tutorQuiz){const questions=currentStage==='evaluation'?(quizAttempt(lesson,state(lesson.id))?.questions||[]):lesson.quiz;const index=questions.findIndex(item=>item.id===button.dataset.tutorQuiz),question=questions[index];if(!question)return;tutorFocus={id:question.id,title:`第 ${index+1} 题：${question.prompt}`,text:question.prompt+(question.code?'\n'+(question.code.source||question.code):'')};tutor?.focus(`请解释第 ${index+1} 题，结合我这次的答案说明原因。`);}
  else {const index=Number(button.dataset.tutorBook),section=lesson.tutorial.sections[index];if(!section)return;tutorFocus={id:`book-section-${index}`,title:section.title,text:[...(section.paragraphs||[]),...(section.points||[])].join('\n')};tutor?.focus('请用简单的话讲解这一节，并给我一个具体例子。');}
});
$('#menu-toggle').onclick=()=>document.body.classList.toggle('menu-open');
installTabletUX({toast});
document.addEventListener('click',async e=>{if(e.target.closest('[data-close-menu]')){document.body.classList.remove('menu-open');return;}if(e.target.closest('.skip-link')){e.preventDefault();$('#main').focus();$('#main').scrollIntoView();return;}const b=e.target.closest('[data-lesson],[data-chapter],[data-home],[data-questions],[data-review],[data-export],[data-import],[data-scroll],[data-stage],[data-read-textbook],[data-book-anchor],.copy-code');if(!b)return;
  if(b.hasAttribute('data-lesson'))go(b.dataset.lesson,b.dataset.question);
  if(b.hasAttribute('data-review')){if(location.hash==='#review')route();else location.hash='review';}
  if(b.hasAttribute('data-questions')){if(location.hash==='#questions')route();else location.hash='questions';}
  if(b.hasAttribute('data-chapter')){query='';filter='all';saveCatalog();location.hash=b.dataset.chapter; if(location.hash.slice(1)===currentChapter&&!currentId)route();}
  if(b.hasAttribute('data-home')){query='';filter='all';saveCatalog();currentChapter='';go('');}
  if(b.hasAttribute('data-scroll'))activateStage(b.dataset.scroll);
  if(b.hasAttribute('data-stage'))activateStage(b.dataset.stage);
  if(b.hasAttribute('data-book-anchor'))document.getElementById(b.dataset.bookAnchor)?.scrollIntoView({behavior:'smooth'});
  if(b.hasAttribute('data-read-textbook')){state(currentId).tutorialRead=true;save();$('#textbook-read-status').textContent='✓ 已标记读完，可以随时回来复习。';activateStage('teach');}
  if(b.classList.contains('copy-code')){try{await navigator.clipboard.writeText($('code',b.closest('.code-example')).textContent);toast('代码已复制。');}catch{toast('无法自动复制，请选中代码后复制。');}}
  if(b.hasAttribute('data-export')){const blob=new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),progress:portableProgress()},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='知行-学习记录.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('学习记录已导出，不包含接口密钥。');}
  if(b.hasAttribute('data-import')){if(grading.size||reviewingSummary.size||tutor?.isBusy()){toast('AI 请求正在进行，请结束或停止后再导入学习记录。');return;}$('#import-file').click();}
});
$('#import-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(grading.size||reviewingSummary.size||tutor?.isBusy())throw new Error('请等待 AI 请求结束或停止后再导入。');if(file.size>20000000)throw new Error('记录文件过大，请选择小于 20 MB 的 JSON 文件。');const parsed=JSON.parse(await file.text());const imported=validateProgress(parsed,lessons);if(!confirm(`导入 ${Object.keys(imported).length} 个板块的学习记录？同名板块的现有记录将被覆盖。`))return;if(!backupManager)throw new Error('记录还原点尚未准备好，请稍后重试。');await backupManager.checkpoint();progress={...progress,...imported};if(parsed.progress?._preferences)restorePresentation(parsed.progress._preferences);save();route();toast('学习记录已导入。');}catch(err){toast(err.message||'无法读取记录文件。');}finally{e.target.value='';}};
window.addEventListener('hashchange',route);
try {
  const groups=await Promise.all(['/data/frameworks.json','/data/platform.json'].map(async url=>{const r=await fetch(url);if(!r.ok)throw new Error('课程文件加载失败');return r.json();}));
  lessons=groups.flat().sort((a,b)=>CHAPTERS.findIndex(c=>c.id===a.chapterId)-CHAPTERS.findIndex(c=>c.id===b.chapterId));
  const numbered={};questions=lessons.flatMap(l=>(l.deepDives||[]).map(q=>({...q,chapterId:q.chapterId||l.chapterId,lessonId:l.id,lessonTitle:l.title,tags:l.tags}))).sort((a,b)=>CHAPTERS.findIndex(c=>c.id===a.chapterId)-CHAPTERS.findIndex(c=>c.id===b.chapterId)||a.page-b.page||a.id.localeCompare(b.id,undefined,{numeric:true})).map(q=>({...q,number:numbered[q.chapterId]=(numbered[q.chapterId]||0)+1}));
  const books=Object.assign({},...await Promise.all(['basics','javascript','frameworks','platform','css'].map(async name=>{const r=await fetch('/textbook/'+name+'.json');if(!r.ok)throw new Error('教材正文加载失败，请确认升级文件完整');return r.json();})));
  const runResponse=await fetch('/run-examples.json');if(!runResponse.ok)throw new Error('运行示例加载失败');runExamples=await runResponse.json();
  for(const l of lessons){if(!books[l.id])throw new Error('缺少教材正文：'+l.title);l.tutorial=books[l.id];}
  try{const raw=JSON.parse(localStorage.getItem(KEY)||'{}');progress=validateProgress({version:1,progress:raw},lessons);}catch{progress={};}
  cloud=createCloudProgress({getProgress:portableProgress,applyProgress:raw=>{const {_preferences,...records}=raw||{};progress=validateProgress({version:1,progress:records},lessons);localStorage.setItem(KEY,JSON.stringify(progress));if(_preferences)restorePresentation(_preferences);},onStatus:syncStatus,onRecovery:items=>{recoveryCount=items.filter(item=>!item.isCurrent&&!item.matchesServer).length;renderSyncBadge();if(recoveryDialog?.open)renderRecoveryList();},onError:error=>toast(error.message)});
  try{await cloud.init();}catch(error){toast(error.message||'服务器记录暂未连接，已保留本机学习记录。');}
  backupManager=installBackupManager({prepare:async()=>{if(grading.size||tutor?.isBusy()||reviewingSummary.size)throw new Error('请等待 AI 评阅结束或先停止助教回复，再操作还原点。');await cloud.flush();const current=cloud.getState();return current.ready&&!current.dirty&&!current.conflict;},onRestored:async()=>{await cloud.loadLatest({discardLocal:true});route();}});
  preferenceSnapshot=JSON.stringify(collectUIPreferences(localStorage));
  for(const event of ['input','change','click','pointerup','keyup'])document.addEventListener(event,()=>setTimeout(savePreferenceChanges,0));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){savePreferenceChanges();void cloud.flush().catch(()=>{});}});
  window.addEventListener('pagehide',()=>{savePreferenceChanges();void cloud.flush().catch(()=>{});});
  try{const c=JSON.parse(localStorage.getItem('zhixing-ai-config'));if(c&&['openai','gemini'].includes(c.provider))config={provider:c.provider,baseUrl:String(c.baseUrl||''),model:String(c.model||''),proxyUrl:String(c.proxyUrl||'')};}catch{}
  try{const stored=await readLocalConfig();if(stored.saved)applyLocalConfig(stored);}catch(error){toast(error.message);}finally{$('#settings-open').disabled=false;}
  route();
}catch(e){$('#main').innerHTML=`<div class="empty"><h1>课程暂时无法加载</h1><p>${esc(e.message)}</p><p>请通过“启动学习.bat”运行，再刷新此页面。</p><button onclick="location.reload()" class="button primary">重新加载</button></div>`;}
