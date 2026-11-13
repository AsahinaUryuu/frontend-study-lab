import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {quizPromptMarkup,quizOptionMarkup,inlineCodeMarkup,quizExplanationMarkup} from '../public/quiz-presentation.js';
import {gradeQuiz} from '../public/learning.js';

const read = async path => JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
const lessons = (await Promise.all(['frameworks','platform'].map(name=>read(`../public/data/${name}.json`)))).flat();
const questions = lessons.flatMap(l=>l.quiz);
const byId = Object.fromEntries(questions.map(q=>[q.id,q]));
const baseline = await read('./fixtures/quiz-answers-v1.2.json');

test('题干代码拆分保留全部425题的ID、类型、选项顺序及答案，已有答案仍能得分',()=>{
  assert.equal(questions.length,425);
  assert.equal(new Set(questions.map(q=>q.id)).size,425);
  assert.equal(baseline.length,425);
  for(const old of baseline){
    const now=byId[old.id];assert.ok(now,old.id);
    for(const key of Object.keys(old)){
      // v1.4 deliberately audits case policy; historical answer content stays
      // compatible. CSS var() additionally accepts its seven legal case forms.
      if(key==='caseSensitive')continue;
      if(key==='answer'&&old.id==='css-stacking-q3'){
        for(const answer of old.answer)assert.ok(now.answer.includes(answer));
        assert.equal(now.answer.length,8);
      }else assert.deepEqual(now[key],old[key],`${old.id}.${key}`);
    }
  }
  for(const lesson of lessons){
    const answers=Object.fromEntries(lesson.quiz.map(q=>[q.id,q.type==='choice'?q.answer:q.answer[0]]));
    assert.equal(gradeQuiz(lesson.quiz,answers).score,100,lesson.id);
  }
});

test('明确标记的代码题均有独立正文与语言，JS片段语法有效且不执行',()=>{
  const codeQuestions=questions.filter(q=>q.code);
  assert.equal(codeQuestions.length,31);
  for(const q of codeQuestions){
    assert.ok(q.prompt.trim(),q.id);
    assert.ok(q.code.source.trim(),q.id);
    assert.ok(['javascript','jsx','html','css','http'].includes(q.code.language),q.id);
    if(q.code.language==='javascript'&&!q.code.source.includes('____'))assert.doesNotThrow(()=>new vm.Script(q.code.source),q.id);
  }
  for(const q of questions.filter(q=>q.codeOptions)){
    assert.equal(q.type,'choice');
    assert.equal(new Set(q.codeOptions).size,q.codeOptions.length);
    for(const i of q.codeOptions)assert.ok(Number.isInteger(i)&&i>=0&&i<q.options.length,q.id);
  }
});

test('截图中的Boolean题及引用上例的题目现在可以独立阅读，代码不泄漏答案',()=>{
  const q=byId['js-types-q4'];
  assert.equal(q.prompt,'执行下面的代码，会怎样？');
  assert.match(q.code.source,/const b = new Boolean\(false\);\nif \(b\) \{\n  console.log/);
  assert.equal(byId['js-closure-q1'].code.source.includes('// 1 2 1'),false);
  assert.equal(byId['browser-events-q1'].code.source.includes('// 常规脚本上下文输出'),false);
  const output=[];
  vm.runInNewContext(q.code.source,{console:{log:(...args)=>output.push(...args)}});
  assert.deepEqual(output,['进入']);
});

test('题干、行内代码、代码块、选项与解析不会把HTML当作页面执行',()=>{
  const payload='<img src=x onerror=alert(1)>';
  const q={id:'" onclick="alert(1)',prompt:`文本 ${payload} 与 \`${payload}\``,code:{language:'" onmouseover="bad',source:'</code></pre><script>alert(1)</script>'},options:[payload,'`<script>x</script>`'],codeOptions:[0],explanation:payload};
  const markup=quizPromptMarkup(q);
  assert.ok(!markup.includes('<img'));
  assert.ok(!markup.includes('<script>'));
  assert.ok(markup.includes('id="quiz-prompt-&quot; onclick=&quot;alert(1)"'));
  assert.ok(markup.includes('data-language="text"'));
  assert.ok(markup.includes('&lt;/code&gt;&lt;/pre&gt;'));
  assert.ok(quizOptionMarkup(q,0).includes('&lt;img'));
  assert.ok(!quizOptionMarkup(q,1).includes('<script>'));
  assert.ok(!quizExplanationMarkup(q).includes('<img'));
});

test('纯文字旧题和不成对反引号保留文字，显式代码块交给现有安全渲染器',()=>{
  const old={id:'legacy',prompt:'这里是普通问题？',options:['普通答案','a < b']};
  assert.equal(quizOptionMarkup(old,1),'a &lt; b');
  assert.ok(quizPromptMarkup(old).includes('这里是普通问题？'));
  assert.ok(!quizPromptMarkup(old).includes('<pre'));
  assert.equal(inlineCodeMarkup('未闭合 `x < y'),'未闭合 `x &lt; y');
  assert.equal(inlineCodeMarkup('`a < b`'),'<code class="inline-code">a &lt; b</code>');
  let called;
  const markup=quizPromptMarkup(byId['js-types-q4'],(source,language)=>{called={source,language};return '<pre>existing safe renderer</pre>';});
  assert.deepEqual(called,byId['js-types-q4'].code);
  assert.ok(markup.endsWith('<pre>existing safe renderer</pre></div>'));
});
