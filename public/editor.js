import {
  EditorState, Compartment, EditorView, keymap, lineNumbers,
  highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor,
  rectangularSelection, crosshairCursor, history, historyKeymap, defaultKeymap,
  indentWithTab, undo, redo, isolateHistory, temporarilySetTabFocusMode,
  indentOnInput, indentUnit, indentRange, bracketMatching, foldGutter, foldKeymap,
  syntaxHighlighting, HighlightStyle, ensureSyntaxTree, closeBrackets,
  closeBracketsKeymap, autocompletion, completionKeymap, search, searchKeymap,
  highlightSelectionMatches, openSearchPanel, javascript, html, css, json, tags
} from './vendor/codemirror.js';

const colors=HighlightStyle.define([
  {tag:tags.keyword,color:'#c4a5f5'},
  {tag:[tags.name,tags.deleted,tags.character,tags.propertyName,tags.macroName],color:'#d8e7df'},
  {tag:[tags.function(tags.variableName),tags.labelName],color:'#8fd5e6'},
  {tag:[tags.color,tags.constant(tags.name),tags.standard(tags.name)],color:'#f0c982'},
  {tag:[tags.definition(tags.name),tags.separator],color:'#e3ece6'},
  {tag:[tags.typeName,tags.className,tags.number,tags.changed,tags.annotation,tags.modifier,tags.self,tags.namespace],color:'#f2b98c'},
  {tag:[tags.operator,tags.operatorKeyword,tags.url,tags.escape,tags.regexp,tags.link,tags.special(tags.string)],color:'#88d6bd'},
  {tag:[tags.meta,tags.comment],color:'#90a49d',fontStyle:'italic'},
  {tag:[tags.string,tags.inserted],color:'#b9dc9a'},
  {tag:tags.invalid,color:'#ff9eab'},
  {tag:tags.tagName,color:'#9fd5c2'},
  {tag:tags.attributeName,color:'#f1cd8b'},
  {tag:tags.bool,color:'#eab0df'}
]);
const phrases={
  'Find':'查找','Replace':'替换','next':'下一个','previous':'上一个','all':'全选匹配',
  'match case':'区分大小写','regexp':'正则','by word':'完整单词','replace':'替换',
  'replace all':'全部替换','close':'关闭','Go to line':'跳转到行','go':'跳转',
  'current match':'当前匹配','on line':'所在行','replaced $ matches':'已替换 $ 处匹配',
  'replaced match on line $':'已替换第 $ 行的匹配','No diagnostics':'没有诊断信息',
  'Fold line':'折叠代码','Unfold line':'展开代码'
};

export function normalizeEditorLanguage(value='javascript'){
  const name=String(value).toLowerCase().trim();
  if(name.includes('vue')||name.includes('html'))return 'html';
  if(name.includes('tsx'))return 'tsx';
  if(name.includes('typescript')||name==='ts')return 'typescript';
  if(name.includes('jsx')||name.includes('react'))return 'jsx';
  if(name.includes('json'))return 'json';
  if(name.includes('css')||name.includes('scss'))return 'css';
  return 'javascript';
}
function support(language){
  switch(normalizeEditorLanguage(language)){
    case 'html':return html();
    case 'css':return css();
    case 'json':return json();
    case 'typescript':return javascript({typescript:true});
    case 'tsx':return javascript({typescript:true,jsx:true});
    default:return javascript({jsx:true});
  }
}

/** An offline editing surface only. It never evaluates or runs the document. */
export function createCodeEditor(host,{value='',language='javascript',onChange=()=>{},onLimit=()=>{},maxLength=30000}={}){
  if(!host?.appendChild)throw new TypeError('需要一个编辑器容器');
  if(!Number.isInteger(maxLength)||maxLength<1)throw new RangeError('编辑器长度上限无效');
  const checked=value=>{const text=String(value??'');if(text.length>maxLength)throw new RangeError(`代码不能超过 ${maxLength} 个字符`);return text;};
  const languageSlot=new Compartment(),wrapSlot=new Compartment();
  const win=host.ownerDocument.defaultView;let wrap=true,font=16,expanded=false;
  try{const saved=JSON.parse(win.localStorage.getItem('zhixing-editor-display')||'{}');wrap=saved.wrap!==false;font=[14,16,18,20,22].includes(saved.font)?saved.font:16;}catch{}
  const persist=()=>{try{win.localStorage.setItem('zhixing-editor-display',JSON.stringify({wrap,font}));}catch{}};
  let selectedLanguage=language, destroyed=false, limitQueued=false;
  const extensions=()=>[
    lineNumbers(),highlightActiveLineGutter(),foldGutter(),drawSelection(),dropCursor(),
    EditorState.allowMultipleSelections.of(true),rectangularSelection(),crosshairCursor(),
    history(),indentOnInput(),indentUnit.of('  '),EditorState.tabSize.of(2),
    bracketMatching(),closeBrackets(),autocompletion(),highlightActiveLine(),
    highlightSelectionMatches(),search({top:true}),
    languageSlot.of(support(selectedLanguage)),wrapSlot.of(wrap?EditorView.lineWrapping:[]),syntaxHighlighting(colors),
    EditorView.theme({},{dark:true}),EditorState.phrases.of(phrases),
    EditorView.contentAttributes.of({'aria-label':'代码实操编辑器','aria-multiline':'true',spellcheck:'false',autocorrect:'off',autocapitalize:'off',autocomplete:'off'}),
    keymap.of([
      ...closeBracketsKeymap,...completionKeymap,...searchKeymap,
      ...historyKeymap,...defaultKeymap,...foldKeymap,
      {key:'Escape',run:temporarilySetTabFocusMode},indentWithTab
    ]),
    EditorState.transactionFilter.of(transaction=>{
      if(transaction.docChanged&&transaction.newDoc.length>maxLength){
        if(!limitQueued){limitQueued=true;queueMicrotask(()=>{limitQueued=false;if(!destroyed)onLimit(maxLength);});}
        return [];
      }
      return transaction;
    }),
    EditorView.updateListener.of(update=>{if(update.docChanged)onChange(update.state.doc.toString());})
  ];
  const makeState=text=>EditorState.create({doc:checked(text),extensions:extensions()});
  const view=new EditorView({state:makeState(value),parent:host});
  host.classList.add('code-editor-mount');
  const shell=host.closest('.editor-wrapper')||host,tools=host.ownerDocument.createElement('div');tools.className='editor-access-tools';
  tools.innerHTML='<button type="button" data-editor-wrap aria-pressed="true">自动换行</button><label>字号 <select data-editor-font aria-label="代码字号">'+[14,16,18,20,22].map(n=>'<option value="'+n+'">'+n+'px</option>').join('')+'</select></label><button type="button" data-editor-tab>插入缩进</button><button type="button" data-editor-expand aria-pressed="false">放大编辑</button>';
  host.before(tools);const wrapButton=tools.querySelector('[data-editor-wrap]'),fontSelect=tools.querySelector('[data-editor-font]'),expandButton=tools.querySelector('[data-editor-expand]');
  function appearance(){wrapButton.setAttribute('aria-pressed',String(wrap));wrapButton.textContent=wrap?'自动换行：开':'自动换行：关';fontSelect.value=String(font);host.style.setProperty('--editor-font',font+'px');}
  function expand(value){expanded=value;shell.classList.toggle('editor-focus-mode',expanded);host.ownerDocument.body.classList.toggle('editor-is-expanded',expanded);expandButton.textContent=expanded?'退出放大':'放大编辑';expandButton.setAttribute('aria-pressed',String(expanded));view.requestMeasure();}
  wrapButton.onclick=()=>{wrap=!wrap;view.dispatch({effects:wrapSlot.reconfigure(wrap?EditorView.lineWrapping:[])});appearance();persist();};
  fontSelect.onchange=()=>{font=Number(fontSelect.value);appearance();persist();view.requestMeasure();};
  tools.querySelector('[data-editor-tab]').onclick=()=>{view.dispatch(view.state.replaceSelection('  '));view.focus();};
  expandButton.onclick=()=>expand(!expanded);
  const escape=event=>{if(event.key==='Escape'&&expanded){event.preventDefault();expand(false);expandButton.focus();}};win.addEventListener('keydown',escape);appearance();
  const alive=()=>{if(destroyed)throw new Error('编辑器已关闭');};
  return {
    getValue(){alive();return view.state.doc.toString();},
    setValue(text){
      alive();const next=checked(text),changed=next!==view.state.doc.toString();
      // Replacing the whole state deliberately resets undo history for restored code.
      view.setState(makeState(next));
      if(changed)onChange(next);
    },
    setLanguage(next){alive();selectedLanguage=next;view.dispatch({effects:languageSlot.reconfigure(support(next))});},
    destroy(){if(!destroyed){destroyed=true;expand(false);win.removeEventListener('keydown',escape);tools.remove();view.destroy();host.classList.remove('code-editor-mount');}},
    focus(){alive();view.focus();},
    refresh(){alive();view.requestMeasure();},
    indentAll(){
      alive();ensureSyntaxTree(view.state,view.state.doc.length,100);
      const changes=indentRange(view.state,0,view.state.doc.length);
      if(!changes.empty)view.dispatch({changes,userEvent:'input.indent',annotations:isolateHistory.of('full')});
      view.focus();return !changes.empty;
    },
    undo(){alive();const done=undo(view);view.focus();return done;},
    redo(){alive();const done=redo(view);view.focus();return done;},
    search(){alive();return openSearchPanel(view);}
  };
}
