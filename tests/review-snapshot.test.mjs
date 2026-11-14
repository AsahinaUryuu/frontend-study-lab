import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewSnapshotMarkup} from '../public/review-snapshot.js';
const codeBlock=(source,language)=>`<pre data-lang="${language}">${source.replaceAll('<','&lt;')}</pre>`;
test('review snapshot shows all three original files, runner example and frozen rubric without an editor',()=>{
 const review={submission:{mode:'web',files:{html:'<button>original</button>',css:'button{color:red}',javascript:'console.log(1)'},testCode:'run()'},challenge:{title:'原任务',description:'原要求',rubric:['原标准']}};
 const before=JSON.stringify(review),html=reviewSnapshotMarkup(review,{codeBlock});
 for(const part of ['index.html','style.css','main.js','调用示例','run()','原标准','&lt;button>original'])assert.ok(html.includes(part));
 assert.doesNotMatch(html,/<textarea|contenteditable|<details[^>]+open/);assert.equal(JSON.stringify(review),before);
});
test('old task material is explicitly unavailable and empty files are not filled from a current draft',()=>{
 const html=reviewSnapshotMarkup({submission:{mode:'web',files:{html:'',css:'',javascript:'saved'}}},{codeBlock});
 assert.match(html,/没有保存当时的任务要求/);assert.equal((html.match(/该文件当时为空/g)||[]).length,2);assert.match(html,/saved/);
});
