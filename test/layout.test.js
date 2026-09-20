'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  transcribe,
  dotsToMask,
  CAP_SIGN_DOTS,
  NUM_SIGN_DOTS,
  LETTER_DOTS,
} = require('../src/braille');
const { layout, capacity, parseParams } = require('../src/layout');

test('小写字母点位正确（抽样 a b i j w z）', () => {
  assert.deepEqual(LETTER_DOTS.a, [1]);
  assert.deepEqual(LETTER_DOTS.b, [1, 2]);
  assert.deepEqual(LETTER_DOTS.i, [2, 4]);
  assert.deepEqual(LETTER_DOTS.j, [2, 4, 5]);
  assert.deepEqual(LETTER_DOTS.w, [2, 4, 5, 6]);
  assert.deepEqual(LETTER_DOTS.z, [1, 3, 5, 6]);
});

test('大写字母逐字母添加大写前缀符（点6）', () => {
  const { units } = transcribe('AB');
  // CAP, A, CAP, B
  assert.equal(units.length, 4);
  assert.deepEqual(units[0].dots, CAP_SIGN_DOTS);
  assert.equal(units[0].note, '大写前缀符');
  assert.deepEqual(units[1].dots, [1]);
  assert.deepEqual(units[2].dots, CAP_SIGN_DOTS);
  assert.deepEqual(units[3].dots, [1, 2]);
});

test('连续数字段只添加一个数字前缀符', () => {
  const { units, stats } = transcribe('42');
  // NUM, d(=4), b(=2)
  assert.equal(units.length, 3);
  assert.deepEqual(units[0].dots, NUM_SIGN_DOTS);
  assert.deepEqual(units[1].dots, LETTER_DOTS.d);
  assert.equal(units[1].char, '4');
  assert.deepEqual(units[2].dots, LETTER_DOTS.b);
  assert.equal(units[2].char, '2');
  assert.equal(stats.signs, 1);
});

test('数字 0 映射 j 点（2-4-5），字母与数字混排各加各的前缀', () => {
  const { units } = transcribe('A10');
  // CAP a, NUM a, j
  assert.deepEqual(units.map((u) => u.dots), [
    CAP_SIGN_DOTS,
    [1],
    NUM_SIGN_DOTS,
    [1], // 1 = a
    [2, 4, 5], // 0 = j
  ]);
});

test('空格产生空方，换行保留为 newline 单元', () => {
  const { units } = transcribe('A B\nC');
  const kinds = units.map((u) => u.kind);
  assert.deepEqual(kinds, ['sign', 'letter', 'space', 'sign', 'letter', 'newline', 'sign', 'letter']);
  assert.deepEqual(units[2].dots, []);
});

test('不支持的字符被明确报告（不静默丢弃）', () => {
  const { unsupported } = transcribe('a€b');
  assert.equal(unsupported.length, 1);
  assert.equal(unsupported[0].char, '€');
  assert.equal(unsupported[0].index, 1);
});

test('盲文 Unicode 码位正确（a=U+2801，数字符=U+283C）', () => {
  assert.equal(dotsToMask([1]), 0x01);
  const { units } = transcribe('1');
  assert.equal(units[0].braille, '⠼'); // U+283C
  assert.equal(units[1].braille, '⠁'); // U+2801
});

test('容量：120mm 宽、边距 5、点距 2.5 → 每行 23 方', () => {
  const p = parseParams({
    boardWidth: 120,
    boardHeight: 60,
    dotSpacing: 2.5,
    lineGap: 10,
    margin: 5,
  });
  const cap = capacity(p);
  // usable = 110; (110-2.5)/5 + 1 = 22.5 -> 22 +1? floor(107.5/5)=21 +1 = 22
  assert.equal(cap.maxCellsPerLine, 22);
  // usableHeight = 50; (50-5)/10 +1 = 5
  assert.equal(cap.maxLines, 5);
});

test('正常排版成功并生成毫米坐标（BRAILLE 2026）', () => {
  const r = layout({
    text: 'BRAILLE 2026',
    boardWidth: 120,
    boardHeight: 60,
    dotSpacing: 2.5,
    lineGap: 10,
    margin: 5,
  });
  assert.equal(r.fits, true, JSON.stringify(r.errors));
  assert.equal(r.requiredLines, 1);
  // BRAILLE = 7 字母 ×（CAP+字母）=14 方；2026 = NUM + 4 = 5 方；非空盲方合计 19
  const nonSpaceUnits = r.transcription.units.filter(
    (u) => u.kind !== 'space' && u.kind !== 'newline'
  );
  assert.equal(nonSpaceUnits.length, 19);
  // 行内还要算上词间空方：19 + 1 = 20 方
  assert.equal(r.lines[0].cells, 20);
  // 第一个凸点：大写前缀（点6 = 右下点）位于首方右列底行：
  //   x = margin + d = 7.5, y = margin + 2d = 10
  const capDot = r.dots.find((p) => p.kind === 'sign' && p.note === '大写前缀符');
  assert.equal(capDot.x, 7.5);
  assert.equal(capDot.y, 10);
  // B（第二方，列序 col=1）的点1：x = margin + 1*2d = 10, y = margin = 5
  const bDot1 = r.dots.find((p) => p.sourceChar === 'B' && p.dot === 1);
  assert.equal(bDot1.x, 10);
  assert.equal(bDot1.y, 5);
});

test('整词换行：长文本自动换到第二行，统计行数', () => {
  const r = layout({
    text: 'AAAA BBBB CCCC DDDD EEEE',
    boardWidth: 60, // (50-2.5)/5+1 = 10 方/行
    boardHeight: 60,
    dotSpacing: 2.5,
    lineGap: 10,
    margin: 5,
  });
  assert.equal(r.fits, true, JSON.stringify(r.errors));
  assert.ok(r.requiredLines >= 2);
  // 每个词 8 方；每行最多放一个词（8+1+8=17>10）
  assert.ok(r.lines.every((l) => l.cells <= 10));
  // 第二行点1 的 y = margin + lineGap = 15；该词首单元是大写前缀（点6），
  // 所以用点1 坐标验证：第二行的词取点1
  const line2Dot1 = r.dots.filter((p) => p.cellRow === 1 && p.dot === 1);
  assert.ok(line2Dot1.length > 0);
  assert.equal(line2Dot1[0].y, 15);
});

test('单词放不下：报告 WORD_OVERFLOW 且给出原因、不裁切（无坐标）', () => {
  const r = layout({
    text: 'ABCDEFGHIJK', // 11 个大写 → 22 方
    boardWidth: 60, // 10 方/行
    boardHeight: 60,
    dotSpacing: 2.5,
    lineGap: 10,
    margin: 5,
  });
  assert.equal(r.fits, false);
  const codes = r.errors.map((e) => e.code);
  assert.ok(codes.includes('WORD_OVERFLOW'));
  assert.match(r.errors[0].message, /单行容量 10 方/);
  assert.equal(r.dots.length, 0);
});

test('总行数超限：报告 LINES_OVERFLOW 与所需/可用高度', () => {
  const r = layout({
    text: 'A B C D E F',
    boardWidth: 40, // 容量约 7 方/行，每词 2 方 → 每行 3 个词共 6 方；2 行
    boardHeight: 22, // margin5: usable 12, 2d=5; (12-5)/10+1 = 1 行
    dotSpacing: 2.5,
    lineGap: 10,
    margin: 5,
  });
  assert.equal(r.fits, false);
  const e = r.errors.find((x) => x.code === 'LINES_OVERFLOW');
  assert.ok(e, '应有行数超限错误');
  assert.ok(e.requiredLines >= 2);
  assert.equal(e.maxLines, 1);
  assert.equal(r.dots.length, 0);
});

test('板宽连一个盲方都放不下时：WORD_OVERFLOW（容量为 0）', () => {
  const r = layout({
    text: 'A',
    boardWidth: 6, // margin5 → usable 1? effMargin=max(5,0.75)=5; usableWidth=1 < d → 0 方
    boardHeight: 30,
    dotSpacing: 2.5,
    lineGap: 10,
    margin: 5,
  });
  assert.equal(r.fits, false);
  assert.ok(r.errors.some((e) => e.code === 'WORD_OVERFLOW'));
});

test('不支持字符与超宽同时出现，两类原因都要报告', () => {
  const r = layout({
    text: 'ABCDEFGHIJK¢',
    boardWidth: 30,
    boardHeight: 30,
    dotSpacing: 2.5,
    lineGap: 10,
    margin: 5,
  });
  const codes = r.errors.map((e) => e.code);
  assert.ok(codes.includes('UNSUPPORTED_CHAR'));
  assert.ok(codes.includes('WORD_OVERFLOW'));
});

test('参数校验：非数字、行距小于 2 倍点距均拒绝', () => {
  assert.throws(() => parseParams({ boardWidth: '', boardHeight: 10, dotSpacing: 2.5, lineGap: 10 }),
    /不能为空/);
  assert.throws(
    () => parseParams({ boardWidth: 50, boardHeight: 50, dotSpacing: 5, lineGap: 8 }),
    /相邻两行凸点会重叠/
  );
});

test('硬换行（\\n）强制分段，空段落保留为空行', () => {
  const r = layout({
    text: 'A\n\nB',
    boardWidth: 80,
    boardHeight: 60,
    dotSpacing: 2.5,
    lineGap: 10,
    margin: 5,
  });
  assert.equal(r.fits, true, JSON.stringify(r.errors));
  assert.equal(r.requiredLines, 3);
  assert.equal(r.lines[1].cells, 0);
  // 第三行点1 y = margin + 2*lineGap = 25
  const line3Dot1 = r.dots.filter((p) => p.cellRow === 2 && p.dot === 1);
  assert.equal(line3Dot1[0].y, 25);
});

test('连续空格折叠为单个词间空方；首尾空格不占位', () => {
  const r = layout({
    text: 'A    B',
    boardWidth: 80,
    boardHeight: 30,
    dotSpacing: 2.5,
    lineGap: 10,
    margin: 5,
  });
  assert.equal(r.fits, true);
  assert.equal(r.lines.length, 1);
  // A(2方) + 空方1 + B(2方) = 5
  assert.equal(r.lines[0].cells, 5);
  assert.equal(r.lines[0].text, 'A B');

  const r2 = layout({
    text: '  HI  ',
    boardWidth: 80,
    boardHeight: 30,
    dotSpacing: 2.5,
    lineGap: 10,
    margin: 5,
  });
  assert.equal(r2.lines[0].cells, 4);
  assert.equal(r2.lines[0].text, 'HI');
});

test('行内“空方+单词”恰好越界时整词换行，行尾不留空方', () => {
  // 板宽 30 / 边距 5 / d=2.5 → 每行 4 方
  // AA = 4 方正好满一行；B 需整体到第二行（而不是“AA + 空方”占第一行）
  const r = layout({
    text: 'AA B',
    boardWidth: 30,
    boardHeight: 60,
    dotSpacing: 2.5,
    lineGap: 10,
    margin: 5,
  });
  assert.equal(r.fits, true, JSON.stringify(r.errors));
  assert.deepEqual(r.lines.map((l) => l.cells), [4, 2]);
  assert.deepEqual(r.lines.map((l) => l.text), ['AA', 'B']);
});

test('恰好放满一行（不越界）时不产生多余换行', () => {
  // AB CD：AB=4方，+空方1+CD=4方 → 9方；板宽 55 → 每行 9 方
  const r = layout({
    text: 'AB CD',
    boardWidth: 55,
    boardHeight: 30,
    dotSpacing: 2.5,
    lineGap: 10,
    margin: 5,
  });
  assert.equal(r.capacity.maxCellsPerLine, 9);
  assert.equal(r.fits, true, JSON.stringify(r.errors));
  assert.equal(r.requiredLines, 1);
  assert.equal(r.lines[0].cells, 9);
});

test('纯空格文本：fits 且 1 个空行、0 凸点', () => {
  const r = layout({
    text: '   ',
    boardWidth: 80,
    boardHeight: 30,
    dotSpacing: 2.5,
    lineGap: 10,
    margin: 5,
  });
  assert.equal(r.fits, true);
  assert.equal(r.requiredLines, 1);
  assert.equal(r.content.dotCount, 0);
});

test('数字段紧跟字母时只对数字段加一个数字前缀', () => {
  const { units } = transcribe('A12B34');
  // CAP a | NUM a b | CAP b | NUM c d
  const signs = units.filter((u) => u.kind === 'sign');
  assert.equal(signs.length, 4); // 2 大写 + 2 数字段
  assert.deepEqual(signs.map((s) => s.note), [
    '大写前缀符',
    '数字前缀符',
    '大写前缀符',
    '数字前缀符',
  ]);
});
