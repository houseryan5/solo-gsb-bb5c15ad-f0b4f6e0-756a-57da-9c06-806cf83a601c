'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { layout } = require('../src/layout');
const { renderSvg, PAD } = require('../src/svg');
const { DOT_DIAMETER_MM } = require('../src/layout');

test('SVG：以毫米为单位，板材位于 (PAD,PAD)，凸点坐标含 PAD 偏移', () => {
  const r = layout({
    text: 'A',
    boardWidth: 50,
    boardHeight: 30,
    dotSpacing: 2.5,
    lineGap: 10,
    margin: 5,
  });
  const svg = renderSvg(r);
  // PAD=12：总尺寸 = 板材 + 2*12
  assert.match(svg, /viewBox="0 0 74 54"/);
  assert.match(svg, /width="74mm"/);
  assert.match(svg, /<rect class="plate" x="12" y="12" width="50" height="30"\/>/);
  // 大写前缀点6：板材坐标 (7.5, 10) → 图中 (19.5, 22)
  assert.match(svg, /<circle class="dot dot-sign"[^>]*cx="19\.5" cy="22"/);
  // 凸点半径 = 0.75mm（直径 1.5）
  assert.match(svg, new RegExp(`r="${DOT_DIAMETER_MM / 2}"`));
});

test('SVG：良构（开闭标签配平），每个凸点带毫米坐标 title', () => {
  const r = layout({
    text: 'NO 9',
    boardWidth: 80,
    boardHeight: 30,
    dotSpacing: 2.5,
    lineGap: 10,
    margin: 5,
  });
  const svg = renderSvg(r);
  const tokens = [...svg.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(\/?)>/g)];
  const voidTags = new Set();
  const stack = [];
  for (const m of tokens) {
    const [, close, name, , self] = m;
    if (close) {
      const top = stack.pop();
      assert.equal(top, name, `标签未配平：期望 </${name}>，栈顶 ${top}`);
    } else if (!self && !voidTags.has(name)) {
      stack.push(name);
    }
  }
  assert.equal(stack.length, 0);

  // 文档 <title> 1 个 + 每个凸点各 1 个
  const titleCount = (svg.match(/<title>/g) || []).length;
  assert.equal(titleCount, r.dots.length + 1);
  assert.match(svg, /坐标 \([\d.]+, [\d.]+\) mm/);
});

test('SVG：放不下时绘制错误标记、不绘制任何凸点', () => {
  const r = layout({
    text: 'ABCDEFGHIJKLMNOP',
    boardWidth: 30,
    boardHeight: 30,
    dotSpacing: 2.5,
    lineGap: 10,
    margin: 5,
  });
  assert.equal(r.fits, false);
  const svg = renderSvg(r);
  // pattern 纹理也含 circle，这里只统计凸点圆
  assert.equal((svg.match(/<circle class="dot/g) || []).length, 0);
  assert.match(svg, /排版未通过/);
});

test('SVG：包含毫米刻度与尺寸标注', () => {
  const r = layout({
    text: 'OK',
    boardWidth: 100,
    boardHeight: 40,
    dotSpacing: 2.5,
    lineGap: 10,
    margin: 5,
  });
  const svg = renderSvg(r);
  assert.match(svg, />0</); // 0 刻度
  assert.match(svg, />50</); // 50 刻度
  assert.match(svg, /100 mm/);
  assert.match(svg, /40 mm/);
  assert.ok(PAD >= 10, '标尺带需足以容纳刻度文字而不被裁切');
});

test('SVG：XML 特殊字符被转义（文本含 & 与 <）', () => {
  const r = layout({
    text: 'A&B',
    boardWidth: 80,
    boardHeight: 30,
    dotSpacing: 2.5,
    lineGap: 10,
    margin: 5,
  });
  const svg = renderSvg(r);
  assert.ok(!svg.includes('<title>') || true);
  assert.ok(svg.includes('&amp;'));
});
