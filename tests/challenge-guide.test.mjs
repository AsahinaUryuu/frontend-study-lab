import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { challengeGuideMarkup } from '../public/challenge-guide.js';
import { createApp } from '../server.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('public/challenge-guides.json 完整覆盖全部 85 课且结构合法', async () => {
  const [frameworks, platform, guides] = await Promise.all([
    readFile(path.join(rootDir, 'public', 'data', 'frameworks.json'), 'utf8').then(JSON.parse),
    readFile(path.join(rootDir, 'public', 'data', 'platform.json'), 'utf8').then(JSON.parse),
    readFile(path.join(rootDir, 'public', 'challenge-guides.json'), 'utf8').then(JSON.parse),
  ]);
  const lessons = [...frameworks, ...platform];
  assert.equal(lessons.length, 85);

  const guideKeys = Object.keys(guides);
  assert.equal(guideKeys.length, lessons.length, '任务书条目数应与课程总数严格一致');

  for (const lesson of lessons) {
    const g = guides[lesson.id];
    assert.ok(g && typeof g === 'object', `缺少任务书：${lesson.id}`);
    assert.equal(typeof g.plainGoal, 'string', `${lesson.id} plainGoal 应为字符串`);
    assert.ok(g.plainGoal.trim().length >= 18, `${lesson.id} plainGoal 过短`);
    assert.equal(typeof g.scenario, 'string', `${lesson.id} scenario 应为字符串`);
    assert.ok(g.scenario.trim().length >= 18, `${lesson.id} scenario 过短`);

    assert.ok(Array.isArray(g.examples) && g.examples.length >= 2, `${lesson.id} 至少需要 2 组输入输出示例`);
    for (const [idx, ex] of g.examples.entries()) {
      assert.ok(typeof ex?.input === 'string' && ex.input.trim(), `${lesson.id} examples[${idx}].input 不能为空`);
      assert.ok(typeof ex?.expected === 'string' && ex.expected.trim(), `${lesson.id} examples[${idx}].expected 不能为空`);
      assert.ok(typeof ex?.why === 'string' && ex.why.trim(), `${lesson.id} examples[${idx}].why 不能为空`);
    }

    assert.ok(Array.isArray(g.steps) && g.steps.length >= 3, `${lesson.id} 至少需要 3 条分步拆解`);
    for (const [idx, step] of g.steps.entries()) {
      assert.ok(typeof step === 'string' && step.trim().length >= 8, `${lesson.id} steps[${idx}] 过短`);
    }

    assert.ok(Array.isArray(g.jargon), `${lesson.id} jargon 应为数组`);
    for (const [idx, item] of g.jargon.entries()) {
      assert.ok(typeof item?.term === 'string' && item.term.trim(), `${lesson.id} jargon[${idx}].term 不能为空`);
      assert.ok(typeof item?.plain === 'string' && item.plain.trim(), `${lesson.id} jargon[${idx}].plain 不能为空`);
    }
  }
});

test('challengeGuideMarkup 渲染人话任务书、验收清单、按需折叠区，并严格转义 HTML', () => {
  const sampleLesson = {
    id: 'demo-xss',
    challenge: {
      title: '演示 <script>alert(1)</script>',
      description: '原始题意含 <img onerror=alert(1)>',
      rubric: ['检查点 A <b>粗体</b>', '检查点 B'],
      hints: ['提示 <svg onload=1>'],
    },
  };
  const sampleGuide = {
    plainGoal: '用大白话实现 foo(<x>)',
    scenario: '真实业务场景 & 边界处理',
    examples: [{ input: 'foo("<a&b>")', expected: '"&lt;a&amp;b&gt;"', why: '防止标签注入' }],
    steps: ['第 1 步：拆解输入', '第 2 步：校验边界', '第 3 步：返回结果'],
    jargon: [{ term: 'XSS <tag>', plain: '脚本注入风险' }],
  };

  const jsHtml = challengeGuideMarkup(sampleLesson, sampleGuide, { mode: 'javascript' });
  assert.match(jsHtml, /可直接运行 JS/);
  assert.match(jsHtml, /一句话看懂要做什么/);
  assert.match(jsHtml, /实际开发里什么时候用到/);
  assert.match(jsHtml, /举个例子：输入什么 → 期望得到什么/);
  assert.match(jsHtml, /本关验收清单/);
  assert.match(jsHtml, /展开分步拆解/);
  assert.match(jsHtml, /本题术语白话对照/);
  assert.match(jsHtml, /查看原始精简题意/);
  assert.match(jsHtml, /data-tutor-explain-challenge/);
  assert.ok(!jsHtml.includes('<script>alert(1)</script>'), '标题未转义');
  assert.ok(!jsHtml.includes('<img onerror=alert(1)>'), '原始题意未转义');
  assert.ok(!jsHtml.includes('<svg onload=1>'), '提示未转义');

  const webHtml = challengeGuideMarkup(sampleLesson, sampleGuide, { mode: 'web' });
  assert.match(webHtml, /HTML \+ CSS \+ JS 联动预览/);

  const projectHtml = challengeGuideMarkup(sampleLesson, null, { mode: 'project' });
  assert.match(projectHtml, /代码方案题 · 提交 AI 评阅/);
  assert.match(projectHtml, /guide-fallback-desc/);
  assert.match(projectHtml, /本关验收清单/);
});

test('/api/health 返回有效版本号且 /challenge-guides.json 可正常提供静态 JSON', async () => {
  const app = createApp();
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = app.address();
    const healthRes = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(healthRes.status, 200);
    const health = await healthRes.json();
    assert.equal(health.ok, true);
    assert.match(health.version, /^\d+\.\d+\.\d+$/);

    const guideRes = await fetch(`http://127.0.0.1:${port}/challenge-guides.json`);
    assert.equal(guideRes.status, 200);
    assert.match(guideRes.headers.get('content-type') || '', /application\/json/);
    const body = await guideRes.json();
    assert.equal(Object.keys(body).length, 85);
  } finally {
    await new Promise(resolve => app.close(resolve));
  }
});
