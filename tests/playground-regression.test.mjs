import test from 'node:test';
import assert from 'node:assert/strict';
import {mountPlayground} from '../public/playground.js';
import {webFiles} from '../public/web-files.js';

// Exercise the actual mounted event handlers with isolated runner transports.
// No learner code is executed and no browser/network dependency is required.
function fixture(t,{profile,state}){
 const globals=new Map(['document','window','MutationObserver'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 class Node extends EventTarget{
  constructor(){super();this.value='';this.children=[];this.style={};this.dataset={};this.hidden=false;this.disabled=false;this.textContent='';const classes=new Set();this.classList={toggle:(name,value)=>{const on=value??!classes.has(name);if(on)classes.add(name);else classes.delete(name);return on;},contains:name=>classes.has(name)};}
  append(node){this.children.push(node);}replaceChildren(...nodes){this.children=nodes;}
  querySelector(){return null;}querySelectorAll(){return this.children;}setAttribute(){}focus(){}
 }
 const win=new EventTarget(),doc={body:new Node(),createElement:()=>new Node()};globalThis.window=win;globalThis.document=doc;globalThis.MutationObserver=class{observe(){}disconnect(){}};
 const nodes=new Map(),root={querySelector(selector){if(!nodes.has(selector))nodes.set(selector,new Node());return nodes.get(selector);}},get=s=>root.querySelector(s);
 get('#run-mode').value=state.runMode||profile.mode;get('#preview-width').value='auto';get('#run-test-code').value=state.runTestCode||'';
 let emitDOM;const runs=[],previews=[];
 const mounted=mountPlayground(root,{profile,state,readCode:()=>state.code,readFiles:()=>webFiles(profile,state),runnerFactory:()=>({stop(){},destroy(){},runJavaScript(){},preview:value=>previews.push(value)}),domRunnerFactory:({onEvent})=>{emitDOM=onEvent;return {stop(){},destroy(){},run:value=>runs.push(value)};}});
 t.after(()=>{mounted.destroy();for(const [key,descriptor] of globals)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];});
 return {get,runs,previews,mounted,emit:event=>emitDOM(event),click:selector=>get(selector).dispatchEvent(new Event('click')),change:(selector,value,type='change')=>{get(selector).value=value;get(selector).dispatchEvent(new Event(type));},output:()=>get('#run-output').children.map(node=>node.textContent).join('\n')};
}
test('running web page errors keep original JS/test line boundaries after the draft changes',t=>{
 const state={code:'const original = 1;\n// second\n// third\nthrow new Error("later");',runMode:'web',runTestCode:'initialize();'},f=fixture(t,{profile:{mode:'web',mainLanguage:'javascript',html:'<button>run</button>'},state});
 f.click('#run-code');assert.equal(f.runs[0].javascript,'const original = 1;\n// second\n// third\nthrow new Error("later");\n;\ninitialize();');
 state.code='shorterDraft();';f.mounted.markDirty();f.emit({type:'error',source:'javascript',line:4,column:1,text:'old page handler'});
 assert.match(f.output(),/JavaScript第 4 行/);assert.ok(!f.output().includes('调用示例'));
 state.code='// another draft\n'.repeat(20);f.mounted.markDirty();f.emit({type:'error',source:'javascript',line:6,column:1,text:'old initialization'});
 assert.match(f.output(),/调用示例第 1 行/);
 f.click('#run-code');const newTestStart=state.code.split('\n').length+2;f.emit({type:'error',source:'javascript',line:newTestStart,column:1,text:'new initialization'});assert.match(f.output(),/调用示例第 1 行/);
});
test('CSS and linked previews keep the latest companion HTML in both directions, including empty edits',t=>{
 const profile={mode:'web',mainLanguage:'css',html:'<h1>default</h1>'},state={code:'h1 {color:red}',runMode:'web',previewHtml:'<h1>old legacy</h1>',webFiles:{html:'<h1>latest linked</h1>'}},f=fixture(t,{profile,state});
 f.change('#run-mode','css');assert.equal(f.get('#run-html-source').value,'<h1>latest linked</h1>');f.click('#run-code');assert.equal(f.previews.at(-1).html,'<h1>latest linked</h1>');
 f.change('#run-html-source','<h1>edited in CSS preview</h1>','input');assert.equal(state.previewHtml,state.webFiles.html);f.change('#run-mode','web');f.click('#run-code');assert.equal(f.runs.at(-1).html,'<h1>edited in CSS preview</h1>');
 state.webFiles.html='';f.mounted.markDirty();f.change('#run-mode','css');assert.equal(f.get('#run-html-source').value,'');f.click('#run-code');assert.equal(f.previews.at(-1).html,'');
 f.change('#run-html-source','<p>restored from companion editor</p>','input');f.change('#run-mode','web');f.click('#run-code');assert.equal(f.runs.at(-1).html,'<p>restored from companion editor</p>');assert.equal(state.code,'h1 {color:red}');
});
