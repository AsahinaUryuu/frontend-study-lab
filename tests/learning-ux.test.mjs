import test from 'node:test';
import assert from 'node:assert/strict';
import {resumeStage,answeredQuestions,retryIncorrect,sortCourses,normalizeReading,applyReadingPreferences,saveReadingPreferences} from '../public/learning-ux.js';
import {validateProgress,gradeQuiz} from '../public/learning.js';
const quiz=[{id:'a',type:'choice',options:['zero','one'],answer:0},{id:'b',type:'fill',answer:['value'],caseSensitive:false},{id:'c',type:'fill',answer:['end'],caseSensitive:false}];
const lesson={id:'lesson',quiz,challenge:{starter:'// start'}};
test('返回课程恢复有效关卡，原书深链仍打开课堂提问，无效关卡回教材',()=>{
  assert.equal(resumeStage({lastStage:'practice'}),'practice');assert.equal(resumeStage({lastStage:'coding'},'q1'),'teach');assert.equal(resumeStage({lastStage:'unknown'}),'textbook');assert.equal(resumeStage(null),'textbook');
});
test('作答统计识别选项零，拒绝无效选项，空白填空为未答',()=>{
  assert.deepEqual(answeredQuestions(quiz,{a:0,b:'  ',c:'end'}),[true,false,true]);
  assert.deepEqual(answeredQuestions(quiz,{a:2,b:'value'}),[false,true,false]);
  assert.deepEqual(answeredQuestions(quiz,{a:'0',b:null}),[false,false,false]);
});
test('仅重做错题保留正确答案，不更改原始提交快照',()=>{
  const answers={a:0,b:'wrong',c:''},result=gradeQuiz(quiz,answers),next=retryIncorrect(quiz,answers,result);
  assert.deepEqual(next,{a:0});assert.deepEqual(answers,{a:0,b:'wrong',c:''});assert.deepEqual(retryIncorrect(quiz,answers,null),{});
});
test('收藏、笔记与关卡随导入恢复，笔记长度和关卡限制有效',()=>{
  const data=validateProgress({version:1,progress:{lesson:{bookmarked:true,notes:'n'.repeat(11000),lastStage:'evaluation',answers:{a:0}}}},[lesson]);
  assert.equal(data.lesson.bookmarked,true);assert.equal(data.lesson.notes.length,10000);assert.equal(data.lesson.lastStage,'evaluation');assert.equal(data.lesson.answers.a,0);
  const bad=validateProgress({version:1,progress:{lesson:{bookmarked:'true',notes:{html:'<script>'},lastStage:'<script>'}}},[lesson]);
  assert.equal(bad.lesson.bookmarked,false);assert.equal(bad.lesson.notes,undefined);assert.equal(bad.lesson.lastStage,undefined);
});
test('阅读偏好有范围默认值，坏数据不产生无效 CSS',()=>{
  assert.deepEqual(normalizeReading(),{font:15,line:2});assert.deepEqual(normalizeReading({font:500,line:999}),{font:22,line:2});assert.deepEqual(normalizeReading({font:1,line:1.7}),{font:14,line:1.7});
  const values={},root={style:{setProperty:(key,value)=>values[key]=value}},storage={getItem:()=>'{broken',setItem:(key,value)=>storage.saved={key,value}};
  assert.deepEqual(applyReadingPreferences(root,storage),{font:15,line:2});assert.equal(values['--lesson-font'],'15px');
  assert.equal(saveReadingPreferences(root,storage,{font:19,line:2.3}),true);assert.equal(JSON.parse(storage.saved.value).font,19);
  storage.setItem=()=>{throw new Error('quota');};assert.equal(saveReadingPreferences(root,storage,{font:16,line:2}),false);
});
test('课程排序不更改原始学习路径且近期顺序稳定',()=>{
  const list=[{id:'a',title:'A'},{id:'b',title:'B'},{id:'c',title:'C'}];
  assert.deepEqual(sortCourses(list,{a:{lastSeen:10},c:{lastSeen:30}},'recent').map(l=>l.id),['c','a','b']);
  assert.deepEqual(list.map(l=>l.id),['a','b','c']);assert.equal(sortCourses(list,{},'path'),list);
});
