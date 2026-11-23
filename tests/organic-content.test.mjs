import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { textbookMarkup } from '../public/textbook.js';
import { createApp } from '../server.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('基础教学回归纯粹统一排版，不再包含割裂的模式切换条或分块伴读卡片', async () => {
  const basics = JSON.parse(await readFile(path.join(rootDir, 'public', 'textbook', 'basics.json'), 'utf8'));
  const markup = textbookMarkup(basics['js-types'], false, () => '<pre>code</pre>');
  assert.ok(!markup.includes('book-mode-bar'), '不应再渲染模式切换条');
  assert.ok(!markup.includes('book-companion'), '不应再渲染分块伴读卡片');
  assert.ok(!markup.includes('book-section-plain'), '不应再渲染分块白话条');
  assert.ok(!markup.includes('面试怎么回答'), '不应包含禁用字面串');
});

test('全站 85 课正文、课堂提问与 182 道逐题讲解融合自然，无机械割裂标签且篇幅充实', async () => {
  const [frameworks, platform] = await Promise.all([
    readFile(path.join(rootDir, 'public', 'data', 'frameworks.json'), 'utf8').then(JSON.parse),
    readFile(path.join(rootDir, 'public', 'data', 'platform.json'), 'utf8').then(JSON.parse),
  ]);
  const bookFiles = (await readdir(path.join(rootDir, 'public', 'textbook'))).filter(f => f.endsWith('.json'));
  const books = Object.assign({}, ...await Promise.all(
    bookFiles.map(f => readFile(path.join(rootDir, 'public', 'textbook', f), 'utf8').then(JSON.parse))
  ));
  const lessons = [...frameworks, ...platform];
  assert.equal(lessons.length, 85);

  const splitLabel = /^(?:白话|大白话|八股|面试要点|白话解释)\s*[：:]/m;
  let totalSections = 0;
  let totalDeepDives = 0;
  for (const l of lessons) {
    const b = books[l.id];
    assert.ok(b, `缺少教材 ${l.id}`);
    assert.ok(b.intro.length >= 45, `${l.id} intro 过短`);
    assert.ok(!splitLabel.test(b.intro), `${l.id} intro 不应使用割裂标签`);
    for (const s of b.sections) {
      totalSections++;
      for (const p of s.paragraphs) {
        assert.ok(p.length >= 60, `${l.id}/${s.title} 段落过短`);
        assert.ok(!splitLabel.test(p), `${l.id}/${s.title} 段落不应使用割裂标签`);
        assert.ok(!p.includes('面试怎么回答'), `${l.id}/${s.title} 包含禁用字面串`);
      }
    }
    assert.ok(l.answer.length >= 80, `${l.id} teach.answer 过短`);
    assert.ok(!splitLabel.test(l.answer), `${l.id} teach.answer 不应使用割裂标签`);
    for (const exp of l.explanation) {
      assert.ok(exp.body.length >= 60, `${l.id}/${exp.title} explanation 过短`);
      assert.ok(!splitLabel.test(exp.body), `${l.id}/${exp.title} 不应使用割裂标签`);
    }
    for (const d of l.deepDives || []) {
      totalDeepDives++;
      assert.ok(d.answer.length >= 110, `${l.id}/${d.id} deepDive answer 过短`);
      assert.ok(!splitLabel.test(d.answer), `${l.id}/${d.id} deepDive 不应使用割裂标签`);
    }
  }
  assert.equal(totalSections, 300);
  assert.equal(totalDeepDives, 182);
});

test('/api/health 返回 1.16.0', async () => {
  const app = createApp();
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = app.address();
    const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
    assert.equal(health.ok, true);
    assert.equal(health.version, '1.16.0');
  } finally {
    await new Promise(resolve => app.close(resolve));
  }
});
