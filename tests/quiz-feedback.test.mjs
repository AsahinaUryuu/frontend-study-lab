import test from 'node:test';
import assert from 'node:assert/strict';
import {quizFeedbackCard} from '../public/quiz-feedback.js';
const question={id:'old-q',type:'choice',prompt:'预测代码输出',code:{source:'console.log("<value>")',language:'javascript'},options:['<value>','error'],codeOptions:[0],answer:0,explanation:'原始解释'};
test('feedback includes the submitted prompt, code, all original options and answer while hiding the reference initially',()=>{
 const html=quizFeedbackCard(question,{correct:true,unanswered:false},0,{'old-q':0});
 assert.match(html,/预测代码输出/);assert.match(html,/console.log\(&quot;&lt;value&gt;&quot;\)/);assert.match(html,/<ol[^>]*type="A"/);assert.match(html,/error/);assert.match(html,/你的提交/);assert.match(html,/<details class="feedback-explanation">/);assert.doesNotMatch(html,/<details[^>]*open/);assert.match(html,/id="quiz-prompt-feedback-old-q"/);assert.match(html,/data-tutor-quiz="old-q"/);
});
test('missing historic material is not replaced with an invented reference and all imported text is escaped',()=>{
 const html=quizFeedbackCard({id:'<bad>',type:'fill',prompt:'<script>bad</script>',answer:[],unavailable:true,explanation:'仅保留当时判定'},{correct:false,unanswered:false},1,{'<bad>':'<img src=x>'});
 assert.match(html,/旧记录没有保存参考答案/);assert.match(html,/&lt;img src=x&gt;/);assert.doesNotMatch(html,/<script>|<img/);assert.doesNotMatch(html,/undefined/);
});
