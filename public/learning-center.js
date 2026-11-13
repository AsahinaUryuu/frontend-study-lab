import {gradeQuiz} from './learning.js';
import {answeredQuestions,resumeStage} from './learning-ux.js';
import {STAGES} from './textbook.js';
import {quizPromptMarkup,quizOptionMarkup,inlineCodeMarkup} from './quiz-presentation.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text=value=>typeof value==='string'?value:'';
const stamp=value=>{const n=typeof value==='number'?value:Date.parse(value);return Number.isFinite(n)&&n>0?n:0;};
const searchable=value=>String(value??'').normalize('NFKC').toLocaleLowerCase();
const matches=(haystack,query)=>searchable(query).trim().split(/\s+/).filter(Boolean).every(part=>searchable(haystack).includes(part));
const titleOf=lesson=>lesson.tutorial?.title||lesson.title||lesson.id;
const stageTitle=id=>STAGES.find(s=>s[0]===id)?.[1]||'基础教学';
const hasOwn=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
const PAGE_SIZE=12;

/** Read-only projection. Never creates progress or changes submitted snapshots. */
export function buildLearningCenter(lessons=[],progress={},chapters=[]){
 const names=new Map(chapters.map(ch=>[ch.id,ch.name]));
 const courses=lessons.map((lesson,index)=>{
  const p=progress[lesson.id]||{},quiz=lesson.quiz||[],answers=p.answers||{};
  const reviews=(Array.isArray(p.quizReviews)?p.quizReviews:[]).filter(r=>r&&r.answers&&typeof r.answers==='object');
  const latest=reviews.reduce((chosen,r)=>!chosen||stamp(r.createdAt)>=stamp(chosen.createdAt)?r:chosen,null);
  const submitted=latest?.answers||(p.quizResult?answers:null);
  const result=submitted?gradeQuiz(quiz,submitted):null;
  const filled=answeredQuestions(quiz,answers);
  const started=!!(p.visited||p.tutorialRead||p.completed||submitted||filled.some(Boolean));
  const course={id:lesson.id,index,chapterId:lesson.chapterId,chapter:names.get(lesson.chapterId)||lesson.chapterId,title:titleOf(lesson),started,completed:p.completed===true,bookmarked:p.bookmarked===true,lastSeen:stamp(p.lastSeen),stage:resumeStage(p),notes:text(p.notes).slice(0,10000),questions:[]};
  course.questions=quiz.map((question,i)=>{
   const item=result?.items[i],changed=!!submitted&&(hasOwn(answers,question.id)!==hasOwn(submitted,question.id)||answers[question.id]!==submitted[question.id]);
   return {lessonId:lesson.id,lessonTitle:course.title,chapterId:course.chapterId,chapter:course.chapter,index:i,question,started,lastSeen:course.lastSeen,wrong:!!item&&!item.correct&&!item.unanswered,unanswered:!filled[i],pending:filled[i]&&(!submitted||changed),changed,submitted:!!submitted,submittedAnswer:submitted?.[question.id],currentAnswer:answers[question.id],reviewId:latest?.id||'',reviewAt:stamp(latest?.createdAt),reviewUnanswered:!!item?.unanswered,searchText:[course.title,course.chapter,...(lesson.tags||[]),question.prompt,question.code?.source].filter(Boolean).join(' ')};
  });
  return course;
 });
 const questions=courses.flatMap(c=>c.questions),notes=courses.filter(c=>c.notes.trim());
 return {courses,questions,notes,counts:{courses:courses.length,completed:courses.filter(c=>c.completed).length,started:courses.filter(c=>c.started).length,wrong:questions.filter(q=>q.wrong).length,unanswered:questions.filter(q=>q.started&&q.unanswered).length,notStarted:questions.filter(q=>!q.started&&q.unanswered).length,pending:questions.filter(q=>q.pending).length,notes:notes.length,bookmarked:courses.filter(c=>c.bookmarked).length}};
}

export function centerState(params=new URLSearchParams()){
 const value=key=>params.get(key)||'';
 return {tab:['next','questions','notes'].includes(value('tab'))?value('tab'):'next',chapter:value('chapter').slice(0,80),query:value('q').slice(0,160),status:['needs','wrong','unanswered','pending'].includes(value('status'))?value('status'):'needs',scope:value('scope')==='all'?'all':'started',order:value('order')==='path'?'path':'recent',page:Math.max(1,Math.min(10000,Number.parseInt(value('page'),10)||1))};
}
export function centerQuery(state={}){
 const params=new URLSearchParams();
 for(const [key,value] of Object.entries({tab:state.tab,chapter:state.chapter,q:state.query,status:state.status,scope:state.scope,order:state.order,page:state.page>1?state.page:''}))if(value)params.set(key,String(value));
 return params.toString();
}
export const centerHref=state=>'#review'+(centerQuery(state)?'?'+centerQuery(state):'');
export function centerLessonHref(course,{questionId='',stage='',notes=false,returnState={}}={}){
 const params=new URLSearchParams({review:centerQuery(returnState)});
 if(stage)params.set('stage',stage);if(questionId)params.set('quiz',questionId);if(notes)params.set('notes','1');
 return '#lesson/'+encodeURIComponent(course.lessonId||course.id)+'?'+params.toString();
}
export function lessonCenterEntry(params,lesson){
 const questionId=params.get('quiz')||'',stage=params.get('stage')||'';
 return {questionId:lesson.quiz?.some(q=>q.id===questionId)?questionId:'',stage:STAGES.some(s=>s[0]===stage)?stage:'',openNotes:params.get('notes')==='1',returnHref:params.has('review')?centerHref(centerState(new URLSearchParams(params.get('review')))):''};
}
function compare(order,a,b){return order==='recent'?b.lastSeen-a.lastSeen:0;}
export function centerQuestions(model,state){
 return model.questions.filter(q=>(!state.chapter||q.chapterId===state.chapter)&&(state.scope==='all'||q.started)&&matches(q.searchText,state.query)&&(state.status==='wrong'?q.wrong:state.status==='unanswered'?q.unanswered:state.status==='pending'?q.pending:q.wrong||q.unanswered||q.pending)).sort((a,b)=>compare(state.order,a,b));
}
export function centerNotes(model,state){return model.notes.filter(c=>(!state.chapter||c.chapterId===state.chapter)&&matches([c.title,c.chapter,c.notes].join(' '),state.query)).sort((a,b)=>compare(state.order,a,b));}
export function centerSuggestions(model,state={}){
 const courses=model.courses.filter(c=>(!state.chapter||c.chapterId===state.chapter)&&matches([c.title,c.chapter].join(' '),state.query));
 const unfinished=courses.filter(c=>!c.completed),recent=unfinished.filter(c=>c.started).sort((a,b)=>b.lastSeen-a.lastSeen)[0];
 const next=recent||unfinished[0],wrong=courses.map(c=>({course:c,items:c.questions.filter(q=>q.wrong)})).filter(x=>x.items.length).sort((a,b)=>b.items.length-a.items.length||b.course.lastSeen-a.course.lastSeen)[0];
 const favorite=courses.filter(c=>c.bookmarked).sort((a,b)=>b.lastSeen-a.lastSeen)[0];
 const suggestions=[];
 if(next)suggestions.push({kind:recent?'continue':'start',course:next,stage:recent?next.stage:'textbook',title:recent?'接着上次学':'开始下一课',reason:recent?`这课尚未标记完成，上次停在「${stageTitle(next.stage)}」。`:'按课程顺序，从基础教学开始。'});
 if(wrong)suggestions.push({kind:'wrong',course:wrong.course,stage:'practice',questionId:wrong.items[0].question.id,title:'把错题弄懂',reason:`最近一次提交还有 ${wrong.items.length} 道错题；修改后重新提交，才会更新复习记录。`});
 if(favorite)suggestions.push({kind:'favorite',course:favorite,stage:'textbook',title:'回看你的收藏',reason:'这是你主动收藏的课程，可以回正文重读，再用练习检验。'});
 return suggestions;
}

/** The export receives only projected note fields, never the original progress/config. */
export function notesMarkdown(notes=[],{generatedAt=new Date()}={}){
 const md=value=>String(value??'').replace(/[\\`*_{}\[\]<>#|]/g,c=>'\\'+c).replace(/[\r\n]+/g,' ');
 const date=generatedAt instanceof Date&&!Number.isNaN(generatedAt.getTime())?generatedAt.toISOString().slice(0,10):'';
 return `# 知行 · 课堂笔记\n\n导出日期：${date}\n\n共 ${notes.length} 篇。正文按原文保留；不包含接口配置、评分或助教对话。\n\n`+notes.map(c=>{
  const body=text(c.notes).slice(0,10000),longest=Math.max(2,...[...body.matchAll(/`+/g)].map(m=>m[0].length)),fence='`'.repeat(longest+1);
  return `## ${md(c.title)}\n\n章节：${md(c.chapter)}\n\n课程编号：${md(c.id)}\n\n${fence}text\n${body}\n${fence}\n`;
 }).join('\n---\n\n');
}

const empty=(heading,description,extra='')=>`<div class="center-empty"><h2>${esc(heading)}</h2><p>${esc(description)}</p>${extra}</div>`;
const when=value=>value?new Date(value).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'尚无访问时间';
function answer(question,value){if(value===undefined||value===null||String(value).trim()==='')return '未作答';return question.type==='choice'?quizOptionMarkup(question,value):inlineCodeMarkup(String(value));}

export function mountLearningCenter(root,{lessons,chapters,progress,params=new URLSearchParams(),toast=()=>{},download=downloadNotes}={}){
 const model=buildLearningCenter(lessons,progress,chapters),state=centerState(params);
 if(state.chapter&&!chapters.some(c=>c.id===state.chapter))state.chapter='';
 let destroyed=false;
 const counts=model.counts;
 root.innerHTML=`<div class="page-home learning-center"><header class="page-heading"><div><div class="eyebrow">REVIEW · CONNECT · KEEP GOING</div><h1>学习回顾中心</h1><p>把分散在课程里的错题、未答题与笔记放在一起，决定下一步学什么。</p></div><button type="button" class="button secondary small" data-backup-manager>记录还原点</button></header>
 <div class="center-stats" aria-label="学习记录概览"><button type="button" data-center-stat="wrong"><b>${counts.wrong}</b><span>最近提交的错题</span></button><button type="button" data-center-stat="unanswered"><b>${counts.unanswered}</b><span>已学课程未答题</span></button><button type="button" data-center-stat="pending"><b>${counts.pending}</b><span>已填写待提交</span></button><button type="button" data-center-stat="notes"><b>${counts.notes}</b><span>课堂笔记</span></button></div>
 <p class="center-summary">已开始 ${counts.started} / ${counts.courses} 课 · 已标记完成 ${counts.completed} 课 · 收藏 ${counts.bookmarked} 课。统计来自已保存的学习记录，不估算学习时长。</p>
 <nav class="center-tabs" aria-label="回顾内容">${[['next','下一步建议'],['questions','错题与待答'],['notes','我的笔记']].map(([id,label])=>`<button type="button" data-center-tab="${id}">${label}</button>`).join('')}</nav>
 <form class="center-filters" id="center-filters"><label>知识章节<select name="chapter"><option value="">全部章节</option>${chapters.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></label><label class="center-search">搜索<input name="q" type="search" maxlength="160" placeholder="课程、题目、代码或笔记…" autocomplete="off"></label><button type="submit" class="button secondary small">查找</button><button type="button" class="text-button" data-center-clear>清除筛选</button>
 <div class="center-question-filters"><label>题目状态<select name="status"><option value="needs">所有待处理</option><option value="wrong">最近提交的错题</option><option value="unanswered">当前未答</option><option value="pending">已填写待提交</option></select></label><label>课程范围<select name="scope"><option value="started">已开始的课程</option><option value="all">全部课程（含未开始）</option></select></label></div><label class="center-order">排序<select name="order"><option value="recent">最近访问优先</option><option value="path">按课程顺序</option></select></label></form>
 <p class="center-results-status" role="status" aria-live="polite"></p><div class="center-results"></div></div>`;
 const view=root.querySelector('.learning-center'),form=view.querySelector('form'),results=view.querySelector('.center-results'),status=view.querySelector('.center-results-status');
 for(const name of ['chapter','status','scope','order'])form.elements[name].value=state[name];form.elements.q.value=state.query;
 const link=(course,options={})=>esc(centerLessonHref(course,{...options,returnState:state}));
 const persist=()=>{if(!destroyed)history.replaceState(history.state,'',centerHref(state));};
 function page(items){const total=Math.max(1,Math.ceil(items.length/PAGE_SIZE));state.page=Math.min(total,state.page);return {items:items.slice((state.page-1)*PAGE_SIZE,state.page*PAGE_SIZE),total};}
 const pager=(total)=>total>1?`<nav class="center-pagination" aria-label="回顾列表分页"><button type="button" data-center-page="${state.page-1}" ${state.page===1?'disabled':''}>← 上一页</button><span>第 ${state.page} / ${total} 页</span><button type="button" data-center-page="${state.page+1}" ${state.page===total?'disabled':''}>下一页 →</button></nav>`:'';
 function show(){
  for(const tab of view.querySelectorAll('[data-center-tab]')){const active=tab.dataset.centerTab===state.tab;tab.classList.toggle('active',active);if(active)tab.setAttribute('aria-current','page');else tab.removeAttribute('aria-current');}
  form.elements.q.placeholder=state.tab==='next'?'搜索课程标题或章节…':state.tab==='notes'?'搜索笔记全文或课程标题…':'搜索题目、代码或知识点…';
  view.querySelector('.center-question-filters').hidden=state.tab!=='questions';view.querySelector('.center-order').hidden=state.tab==='next';
  if(state.tab==='next'){
   const suggestions=centerSuggestions(model,state),favorites=model.courses.filter(c=>c.bookmarked&&(!state.chapter||c.chapterId===state.chapter)&&matches([c.title,c.chapter].join(' '),state.query));
   status.textContent=`找到 ${suggestions.length} 条下一步建议${state.chapter||state.query?'（当前筛选）':''}`;
   results.innerHTML=(suggestions.length?`<div class="center-suggestions">${suggestions.map((s,i)=>`<article class="center-card"><span class="center-kicker">${String(i+1).padStart(2,'0')} · ${esc(s.title)}</span><h2>${esc(s.course.title)}</h2><p>${esc(s.reason)}</p><small>${esc(s.course.chapter)} · ${esc(stageTitle(s.stage))}</small><a class="button primary small" href="${link(s.course,{stage:s.stage,questionId:s.questionId})}">${s.kind==='wrong'?'回到错题':'进入课程'} →</a></article>`).join('')}</div>`:empty(state.query||state.chapter?'这个范围暂时没有待办建议':'当前课程都已标记完成',state.query||state.chapter?'可以清除筛选，或切换到错题与笔记继续回顾。':'可以复习已提交的错题，或把自己的理解整理成课堂笔记。'))+
    `<section class="center-favorites"><h2>收藏的课程 <small>${favorites.length}</small></h2>${favorites.length?`<div class="center-favorite-list">${favorites.map(c=>`<a href="${link(c,{stage:'textbook'})}"><span>★ ${esc(c.title)}</span><small>${esc(c.chapter)} · ${c.completed?'已完成':'尚未完成'}</small></a>`).join('')}</div>`:'<p class="muted">在课堂点击“收藏本课”，这里就会出现回看入口。</p>'}</section>`;
  }else if(state.tab==='questions'){
   const all=centerQuestions(model,state),paged=page(all);status.textContent=`找到 ${all.length} 道题目${all.length?` · 当前显示 ${(state.page-1)*PAGE_SIZE+1}–${Math.min(state.page*PAGE_SIZE,all.length)}`:''}`;
   results.innerHTML=`<p class="center-explanation">错题按每课最近一次提交统计，与你在课堂选择查看的旧评阅无关。未答按当前草稿统计；同一道题可能既是错题又正在重做。${state.scope==='started'?`尚未开始课程还有 ${counts.notStarted} 道题，可切换“全部课程”查看。`:''}</p>`+(all.length?`<div class="center-question-list">${paged.items.map(row=>`<article class="center-card center-question"><div class="center-card-meta"><span>${esc(row.chapter)} · 第 ${row.index+1} 题 · ${row.question.type==='choice'?'单选':'填空'}</span><div class="center-tags">${row.wrong?'<span class="wrong">最近提交答错</span>':''}${row.unanswered?'<span>当前未答</span>':''}${row.pending?'<span>待提交</span>':''}${!row.started?'<span>课程未开始</span>':''}</div></div><h2>${esc(row.lessonTitle)}</h2>${quizPromptMarkup({...row.question,id:row.lessonId+'-'+row.question.id})}${row.changed?'<p class="center-draft-note">草稿已修改，最近一次提交的结果仍保留；返回练习重新提交后更新。</p>':''}<details class="center-answer"><summary>${row.submitted?'对照最近提交与解析':'查看练习提示'}</summary>${row.submitted?`<p><b>那次提交：</b>${answer(row.question,row.submittedAnswer)}</p><p><b>参考答案：</b>${row.question.type==='choice'?quizOptionMarkup(row.question,row.question.answer):inlineCodeMarkup(row.question.answer?.[0])}</p><p>${inlineCodeMarkup(row.question.explanation)}</p>${row.reviewAt?`<small>提交于 ${esc(when(row.reviewAt))}</small>`:''}`:'<p>还没有本课的已提交答案。先回到课堂作答并提交，再查看反馈。</p>'}${row.question.type==='fill'?`<p>${row.question.caseSensitive?'本题区分大小写。':'本题忽略大小写。'}${esc(row.question.caseReason||'')}</p>`:''}</details><div class="center-card-actions"><a class="button primary small" href="${link(row,{stage:'practice',questionId:row.question.id})}">回到这道题 →</a><a class="button secondary small" href="${link(row,{stage:'textbook'})}">重读基础教学</a></div></article>`).join('')}</div>${pager(paged.total)}`:empty(state.status==='wrong'?'当前范围没有错题':'当前范围没有待处理题目','试试其他题目状态、全部课程，或清除搜索条件。',`<button type="button" class="button secondary small" data-center-all-unanswered>查看全部未答题</button>`));
  }else{
   const notes=centerNotes(model,state),paged=page(notes);status.textContent=`找到 ${notes.length} 篇笔记${notes.length?` · 当前显示 ${(state.page-1)*PAGE_SIZE+1}–${Math.min(state.page*PAGE_SIZE,notes.length)}`:''}`;
   results.innerHTML=`<div class="center-export"><p>搜索覆盖笔记全文。导出按原文保留换行和代码，不包含接口配置或助教对话。</p><div><button type="button" class="button secondary small" data-center-export="filtered" ${!notes.length?'disabled':''}>导出筛选结果 · ${notes.length} 篇</button><button type="button" class="text-button" data-center-export="all" ${!model.notes.length?'disabled':''}>导出全部笔记</button></div></div>`+(notes.length?`<div class="center-note-list">${paged.items.map(c=>`<article class="center-card"><div class="center-card-meta"><span>${esc(c.chapter)}</span><span>${c.bookmarked?'★ 已收藏 · ':''}${c.notes.length.toLocaleString()} 字符</span></div><h2>${esc(c.title)}</h2><p class="center-note-preview">${esc(c.notes.slice(0,360))}${c.notes.length>360?'…':''}</p>${c.notes.length>360?`<details><summary>展开完整笔记</summary><pre class="center-note-text">${esc(c.notes)}</pre></details>`:''}<small>课程最近访问：${esc(when(c.lastSeen))}</small><div class="center-card-actions"><a class="button primary small" href="${link(c,{notes:true})}">回课堂编辑笔记</a><a class="button secondary small" href="${link(c,{stage:'textbook'})}">重读本课</a></div></article>`).join('')}</div>${pager(paged.total)}`:empty(model.notes.length?'没有匹配的笔记':'还没有课堂笔记',model.notes.length?'试试笔记里的关键词，或清除章节筛选。':'进入任意课程，展开“我的课堂笔记”记录自己的理解；内容会自动出现在这里。',model.courses[0]?`<a class="button primary small" href="${link(model.courses[0],{notes:true,stage:'textbook'})}">去写第一篇笔记 →</a>`:''));
  }
  persist();
 }
 function filters(){state.chapter=form.elements.chapter.value;state.query=form.elements.q.value.slice(0,160);state.status=form.elements.status.value;state.scope=form.elements.scope.value;state.order=form.elements.order.value;state.page=1;show();}
 const submit=event=>{event.preventDefault();filters();};
 const input=event=>{if(event.target.name==='q'&&!event.isComposing)filters();};
 const composition=event=>{if(event.target.name==='q')filters();};
 const change=event=>{if(event.target.tagName==='SELECT')filters();};
 async function click(event){
  const button=event.target.closest('button');if(!button)return;
  if(button.hasAttribute('data-center-export')){const notes=button.dataset.centerExport==='all'?model.notes:centerNotes(model,state);if(!notes.length){toast('当前没有可导出的笔记。');return;}try{await download(notesMarkdown(notes));toast(`已导出 ${notes.length} 篇课堂笔记。`);}catch{toast('笔记下载失败，请重试；原笔记仍保留在课程中。');}return;}
  if(button.hasAttribute('data-center-tab')){state.tab=button.dataset.centerTab;state.page=1;show();}
  else if(button.hasAttribute('data-center-stat')){const kind=button.dataset.centerStat;state.tab=kind==='notes'?'notes':'questions';state.status=kind==='notes'?'needs':kind;state.chapter='';state.query='';state.scope='started';state.page=1;form.elements.chapter.value='';form.elements.q.value='';form.elements.scope.value='started';form.elements.status.value=state.status;show();}
  else if(button.hasAttribute('data-center-clear')){state.chapter='';state.query='';state.scope='started';state.status='needs';state.page=1;form.elements.chapter.value='';form.elements.q.value='';form.elements.scope.value='started';form.elements.status.value='needs';show();}
  else if(button.hasAttribute('data-center-all-unanswered')){state.scope='all';state.status='unanswered';state.chapter='';state.query='';state.page=1;form.elements.scope.value='all';form.elements.status.value='unanswered';form.elements.chapter.value='';form.elements.q.value='';show();}
  else if(button.hasAttribute('data-center-page')){state.page=Math.max(1,Number(button.dataset.centerPage)||1);show();status.tabIndex=-1;status.focus({preventScroll:true});status.scrollIntoView({block:'start'});}
 }
 form.addEventListener('submit',submit);form.addEventListener('input',input);form.addEventListener('compositionend',composition);form.addEventListener('change',change);view.addEventListener('click',click);show();
 return {destroy(){destroyed=true;form.removeEventListener('submit',submit);form.removeEventListener('input',input);form.removeEventListener('compositionend',composition);form.removeEventListener('change',change);view.removeEventListener('click',click);}};
}
function downloadNotes(content){
 const url=URL.createObjectURL(new Blob([content],{type:'text/markdown;charset=utf-8'}));
 try{const a=document.createElement('a');a.href=url;a.download='知行-课堂笔记-'+new Date().toISOString().slice(0,10)+'.md';document.body.append(a);a.click();a.remove();}finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
