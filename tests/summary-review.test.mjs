import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { normalizeSummaryInput, reviewSummarySubmission } from '../lib/summary-review.mjs';
import { buildTutorContext as buildServerTutorContext } from '../lib/tutor.mjs';
import { makeSummaryReview, addSummaryReview, buildTutorContext, sanitizeTutorState } from '../public/tutor-context.js';
import { validateProgress } from '../public/learning.js';
import { createApp } from '../server.mjs';

const config = { provider: 'openai', baseUrl: 'https://example.test/v1', model: 'test-model', apiKey: 'test-only-key' };
const lesson = {
  id: 'demo-closure',
  chapterId: 'javascript',
  title: '闭包与词法作用域',
  tutorial: { title: '闭包与词法作用域' },
  question: '闭包是如何记住外层变量的？',
  answer: '函数定义时捕获词法环境，返回后仍保持引用。',
  pitfalls: ['循环中使用 var 共享绑定'],
  summary: { professional: '闭包由函数及其词法环境组成。', simple: '内部函数随身带着外层变量背包。' },
  code: { language: 'javascript' },
  challenge: { title: '计数器', description: '实现独立计数器', rubric: ['互不干扰'], starter: '' },
  quiz: [{ id: 'q1', type: 'choice', prompt: 'var 在 for 中？', options: ['函数作用域', '块级作用域'], answer: 0, explanation: 'var 是函数作用域。' }],
};
const textbook = { title: '闭包基础', objectives: ['理解词法作用域'], takeaways: ['避免无意识内存泄漏'] };
const reviewResult = {
  score: 88,
  verdict: '核心概念准确，例子清晰，建议补充内存释放边界。',
  strengths: ['准确区分了定义时作用域与调用时作用域'],
  issues: [{ message: '未提及闭包长期持有大对象时的内存回收注意点', suggestion: '补充不再使用时解除引用的例子' }],
  nextSteps: ['尝试手写 once 与 debounce 并说明各自捕获的变量'],
  referenceExplanation: '闭包保持的是词法环境引用，而不是值拷贝。',
};
const response = (provider, text) => new Response(JSON.stringify(
  provider === 'gemini'
    ? { candidates: [{ content: { parts: [{ text }] } }] }
    : { choices: [{ message: { content: text } }] }
), { headers: { 'content-type': 'application/json' } });

test('本课总结评审校验必填与长度上限，并支持 OpenAI 与 Gemini 协议', async () => {
  assert.throws(() => normalizeSummaryInput({ reflection: '   ' }), /我的回忆与例子/);
  assert.throws(() => normalizeSummaryInput({ reflection: 'a'.repeat(3001) }), /3,000/);
  for (const provider of ['openai', 'gemini']) {
    let captured;
    const out = await reviewSummarySubmission({
      config: { ...config, provider },
      reflection: '核心意思：函数记住定义时的外层变量。\n例子：createCounter 每次返回独立 count。',
      rating: 'apply',
      quizSummary: { score: 100, correct: 1, total: 1, unanswered: 0, wrongPrompts: [] },
      codeSummary: { score: 90, verdict: '实现正确', issues: [] },
    }, lesson, textbook, {
      fetchImpl: async (_url, req) => { captured = JSON.parse(req.body); return response(provider, JSON.stringify(reviewResult)); },
    });
    assert.equal(out.score, 88);
    assert.equal(out.strengths.length, 1);
    const serialized = JSON.stringify(captured);
    assert.match(serialized, /createCounter/);
    assert.match(serialized, /闭包基础/);
    assert.ok(!serialized.includes(config.apiKey));
  }
});

test('回忆评审快照冻结，后续修改草稿不会覆盖原评审，且助教上下文准确绑定', () => {
  const state = {
    studyCheck: { reflection: '初版回忆：闭包会拷贝外层变量。', rating: 'explain' },
    answers: {},
  };
  const review = makeSummaryReview(lesson.id, { reflection: state.studyCheck.reflection, rating: 'explain' }, reviewResult);
  addSummaryReview(state, review, lesson);
  state.studyCheck.reflection = '修改后草稿：闭包引用外层词法环境，而非拷贝。';

  const ctx = buildTutorContext({ lesson, stage: 'conclusion', progress: state });
  assert.equal(ctx.kind, 'summary');
  assert.equal(ctx.key, review.id);
  assert.equal(ctx.request.context.summaryReview.reflection, '初版回忆：闭包会拷贝外层变量。');
  assert.equal(ctx.request.context.currentReflection, state.studyCheck.reflection);

  const serverCtx = buildServerTutorContext({
    lessonId: lesson.id,
    stage: 'conclusion',
    context: ctx.request.context,
  }, lesson, textbook);
  assert.equal(serverCtx.summaryReview.result.score, 88);
  assert.equal(serverCtx.summaryReview.reflection, '初版回忆：闭包会拷贝外层变量。');
  assert.equal(serverCtx.currentReflection, state.studyCheck.reflection);

  const imported = validateProgress({ version: 1, progress: { [lesson.id]: state } }, [lesson]);
  assert.equal(imported[lesson.id].summaryReviews.length, 1);
  assert.equal(imported[lesson.id].summaryReviewId, review.id);
  assert.equal(sanitizeTutorState({ summaryReviews: [review], apiKey: 'drop-me' }, lesson).summaryReviews.length, 1);
});

test('HTTP /api/review-summary 校验同源、格式、课程号并返回结构化评审', async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'zhixing-summary-'));
  const pub = path.join(temp, 'public');
  await mkdir(path.join(pub, 'data'), { recursive: true });
  await mkdir(path.join(pub, 'textbook'));
  await writeFile(path.join(pub, 'data', 'test.json'), JSON.stringify([lesson]));
  await writeFile(path.join(pub, 'textbook', 'test.json'), JSON.stringify({ [lesson.id]: textbook }));
  const app = createApp({
    publicDir: pub,
    localConfigPath: path.join(temp, 'local-config', 'settings.json'),
    progressPath: path.join(temp, 'local-config', 'progress.json'),
    fetchImpl: async () => response('openai', JSON.stringify(reviewResult)),
  });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  t.after(async () => {
    await new Promise(resolve => { app.close(resolve); app.closeAllConnections(); });
    await rm(temp, { recursive: true, force: true });
  });
  const post = (body, headers = {}) => fetch(base + '/api/review-summary', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base, ...headers },
    body: JSON.stringify(body),
  });
  const health = await (await fetch(base + '/api/health')).json();
  assert.equal(health.version, '1.13.0');
  const ok = await post({ config, lessonId: lesson.id, reflection: '我的回忆与例子：闭包保持外层引用。', rating: 'apply' });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).score, 88);
  assert.equal((await post({ config, lessonId: lesson.id, reflection: '  ' })).status, 400);
  assert.equal((await post({ config, lessonId: lesson.id, reflection: 'x' }, { origin: 'https://evil.test' })).status, 403);
  assert.equal((await fetch(base + '/api/review-summary')).status, 405);
});
