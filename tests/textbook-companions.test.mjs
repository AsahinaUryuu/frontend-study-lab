import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { textbookMarkup, TEXTBOOK_MODES } from '../public/textbook.js';
import { createApp } from '../server.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('public/textbook-companions.json 完整覆盖 85 课与全部 300 个小节，结构合法且不含禁用字面串', async () => {
  const [frameworks, platform, companions] = await Promise.all([
    readFile(path.join(rootDir, 'public', 'data', 'frameworks.json'), 'utf8').then(JSON.parse),
    readFile(path.join(rootDir, 'public', 'data', 'platform.json'), 'utf8').then(JSON.parse),
    readFile(path.join(rootDir, 'public', 'textbook-companions.json'), 'utf8').then(JSON.parse),
  ]);
  const bookFiles = (await readdir(path.join(rootDir, 'public', 'textbook'))).filter(f => f.endsWith('.json'));
  const books = Object.assign({}, ...await Promise.all(
    bookFiles.map(f => readFile(path.join(rootDir, 'public', 'textbook', f), 'utf8').then(JSON.parse))
  ));

  const lessons = [...frameworks, ...platform];
  assert.equal(lessons.length, 85);
  assert.equal(Object.keys(companions).length, 85);

  let totalSections = 0;
  for (const lesson of lessons) {
    const book = books[lesson.id];
    const comp = companions[lesson.id];
    assert.ok(comp && typeof comp === 'object', `缺少基础教学白话伴读：${lesson.id}`);
    assert.ok(typeof comp.plainIntro === 'string' && comp.plainIntro.trim().length >= 30, `${lesson.id} plainIntro 过短`);
    assert.ok(typeof comp.analogy === 'string' && comp.analogy.trim().length >= 16, `${lesson.id} analogy 过短`);

    assert.ok(Array.isArray(comp.baguCore) && comp.baguCore.length >= 3, `${lesson.id} 至少需要 3 条八股高频考点`);
    for (const [idx, item] of comp.baguCore.entries()) {
      assert.ok(typeof item?.term === 'string' && item.term.trim().length >= 3, `${lesson.id} baguCore[${idx}].term 过短`);
      assert.ok(typeof item?.plain === 'string' && item.plain.trim().length >= 15, `${lesson.id} baguCore[${idx}].plain 过短`);
    }

    assert.ok(Array.isArray(comp.interviewTraps) && comp.interviewTraps.length >= 2, `${lesson.id} 至少需要 2 条高频追问与避坑`);
    for (const [idx, trap] of comp.interviewTraps.entries()) {
      assert.ok(typeof trap === 'string' && trap.trim().length >= 15, `${lesson.id} interviewTraps[${idx}] 过短`);
    }

    assert.ok(Array.isArray(comp.sectionLeads), `${lesson.id} sectionLeads 应为数组`);
    assert.equal(comp.sectionLeads.length, book.sections.length, `${lesson.id} sectionLeads 数量必须与教材小节数严格一致`);
    for (const [idx, lead] of comp.sectionLeads.entries()) {
      assert.ok(typeof lead === 'string' && lead.trim().length >= 15, `${lesson.id} sectionLeads[${idx}] 过短`);
    }
    totalSections += book.sections.length;

    // 确认开启伴读渲染后也不包含 textbook.test.mjs 禁止的字面串
    const rendered = textbookMarkup(book, false, () => '<pre>code</pre>', comp, 'dual');
    assert.ok(!rendered.includes('面试怎么回答'), `${lesson.id} 不应出现禁用字面串`);
  }
  assert.equal(totalSections, 300);
});

test('textbookMarkup 支持三种阅读模式切换并严格转义 HTML', () => {
  assert.deepEqual(TEXTBOOK_MODES, ['dual', 'plain', 'classic']);
  const book = {
    title: '演示教材',
    intro: '严谨导入说明',
    objectives: ['目标一', '目标二', '目标三'],
    prerequisites: ['前置一'],
    sections: [
      { title: '第一小节', paragraphs: ['严谨正文第一段内容。', '严谨正文第二段内容。'] },
    ],
    walkthrough: { title: '演练', scenario: '场景', steps: ['步1', '步2', '步3'] },
    checkpoint: { prompt: '自检题', answer: '自检答' },
    takeaways: ['总结1', '总结2', '总结3'],
  };
  const comp = {
    plainIntro: '白话导语 <script>alert(1)</script>',
    analogy: '比喻 <img src=x onerror=alert(1)>',
    baguCore: [{ term: '核心术语 <b>', plain: '解释内容' }],
    interviewTraps: ['易错坑 <svg onload=1>'],
    sectionLeads: ['本节白话先懂 <iframe>'],
  };

  const dual = textbookMarkup(book, false, () => '', comp, 'dual');
  assert.match(dual, /先说人话/);
  assert.match(dual, /八股高频考点/);
  assert.match(dual, /白话先懂/);
  assert.match(dual, /严谨正文第一段内容/);
  assert.ok(!dual.includes('book-prose-details'));
  assert.ok(!dual.includes('<script>alert(1)</script>'));
  assert.ok(!dual.includes('<img src=x onerror=alert(1)>'));
  assert.ok(!dual.includes('<svg onload=1>'));
  assert.ok(!dual.includes('<iframe>'));

  const plain = textbookMarkup(book, false, () => '', comp, 'plain');
  assert.match(plain, /先说人话/);
  assert.match(plain, /白话先懂/);
  assert.match(plain, /book-prose-details/);
  assert.match(plain, /展开本节原版严谨正文（2 段）/);

  const classic = textbookMarkup(book, false, () => '', comp, 'classic');
  assert.match(classic, /book-mode-bar/);
  assert.ok(!classic.includes('book-companion'));
  assert.ok(!classic.includes('book-section-plain'));
  assert.match(classic, /严谨正文第一段内容/);
});

test('/api/health 返回 1.15.0 且 /textbook-companions.json 可正常提供静态 JSON', async () => {
  const app = createApp();
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = app.address();
    const healthRes = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(healthRes.status, 200);
    const health = await healthRes.json();
    assert.equal(health.ok, true);
    assert.equal(health.version, '1.15.0');

    const compRes = await fetch(`http://127.0.0.1:${port}/textbook-companions.json`);
    assert.equal(compRes.status, 200);
    assert.match(compRes.headers.get('content-type') || '', /application\/json/);
    const body = await compRes.json();
    assert.equal(Object.keys(body).length, 85);
  } finally {
    await new Promise(resolve => app.close(resolve));
  }
});
