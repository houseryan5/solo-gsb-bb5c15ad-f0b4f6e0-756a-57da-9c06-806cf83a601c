'use strict';

/**
 * braille.js —— 六点一级（Grade 1）盲文转换
 *
 * 点位约定（国际通用编号）：
 *   1  4
 *   2  5
 *   3  6
 *
 * dots 数组使用 1~6 编号；内部以 6 位二进制位掩码存储（位 0~5 对应点 1~6）。
 * 映射字符表遵循 Braille ASCII / 英语一级盲文惯例：
 *   - 大写字母前加“大写前缀符”（点 6），逐字母添加；
 *   - 连续数字段只在段首加一个“数字前缀符”（点 3-4-5-6），a~j 映射 1~9、0；
 *   - 其余为常见标点。
 */

const CAP_SIGN_DOTS = [6];
const NUM_SIGN_DOTS = [3, 4, 5, 6];

// 字母 a-z 的点位
const LETTER_DOTS = {
  a: [1],
  b: [1, 2],
  c: [1, 4],
  d: [1, 4, 5],
  e: [1, 5],
  f: [1, 2, 4],
  g: [1, 2, 4, 5],
  h: [1, 2, 5],
  i: [2, 4],
  j: [2, 4, 5],
  k: [1, 3],
  l: [1, 2, 3],
  m: [1, 3, 4],
  n: [1, 3, 4, 5],
  o: [1, 3, 5],
  p: [1, 2, 3, 4],
  q: [1, 2, 3, 4, 5],
  r: [1, 2, 3, 5],
  s: [2, 3, 4],
  t: [2, 3, 4, 5],
  u: [1, 3, 6],
  v: [1, 2, 3, 6],
  w: [2, 4, 5, 6],
  x: [1, 3, 4, 6],
  y: [1, 3, 4, 5, 6],
  z: [1, 3, 5, 6],
};

// 常见标点（Braille ASCII / 英语一级盲文）
const PUNCT_DOTS = {
  ' ': [], // 空格 —— 空方
  ',': [2],
  ';': [2, 3],
  ':': [2, 5],
  '.': [2, 5, 6],
  '!': [2, 3, 5],
  '?': [2, 3, 6],
  "'": [3],
  '-': [3, 6],
  '"': [2, 3, 6], // 引号（与问号同形，英语盲文惯例；引号还需上下文成对符，此处取单符）
  '(': [1, 2, 3, 5, 6],
  ')': [2, 3, 4, 5, 6],
  '/': [3, 4],
  '&': [1, 2, 3, 4, 6],
  '*': [1, 6],
  '@': [4],
  '+': [3, 4, 6],
  '=': [1, 2, 3, 4, 5, 6],
  '#': [3, 4, 5, 6], // 数字符本身
  $: [1, 2, 4, 6],
  '%': [1, 4, 6],
  _: [6],
};

// 数字 a-j -> 1-9,0
const DIGIT_BY_LETTER = {
  a: '1',
  b: '2',
  c: '3',
  d: '4',
  e: '5',
  f: '6',
  g: '7',
  h: '8',
  i: '9',
  j: '0',
};

function dotsToMask(dots) {
  let mask = 0;
  for (const d of dots) mask |= 1 << (d - 1);
  return mask;
}

/** 将点位掩码转换为 Unicode 盲文字符（U+28xx，位序即 1..6 -> 位 0..5） */
function maskToUnicode(mask) {
  return String.fromCharCode(0x2800 + mask);
}

function dotsToUnicode(dots) {
  return maskToUnicode(dotsToMask(dots));
}

const BRAILLE_CHARS = {};
for (const [ch, dots] of Object.entries(LETTER_DOTS)) BRAILLE_CHARS[ch] = dots;
for (const [ch, dots] of Object.entries(PUNCT_DOTS)) BRAILLE_CHARS[ch] = dots;

/**
 * 将英文文本转换为一级盲文单元序列（含前缀符）。
 *
 * @param {string} text 原始文本
 * @returns {{
 *   units: Array<{kind:'sign'|'cell'|'space'|'newline', dots:number[], mask:number,
 *                  braille:string, char?:string, index:number, note?:string}>,
 *   unsupported: Array<{char:string, index:number}>,
 *   stats: {cells:number, signs:number, letters:number, digits:number, punct:number, spaces:number}
 * }}
 */
function transcribe(text) {
  const units = [];
  const unsupported = [];
  const stats = { cells: 0, signs: 0, letters: 0, digits: 0, punct: 0, spaces: 0 };

  const pushSign = (dots, index, note) => {
    units.push({
      kind: 'sign',
      dots,
      mask: dotsToMask(dots),
      braille: dotsToUnicode(dots),
      index,
      note,
    });
    stats.signs++;
  };

  const pushCell = (dots, index, char, kind) => {
    units.push({
      kind,
      dots,
      mask: dotsToMask(dots),
      braille: dotsToUnicode(dots),
      char,
      index,
    });
    stats.cells++;
  };

  let prevDigit = false;

  for (let index = 0; index < text.length; index++) {
    const ch = text[index];

    // 硬换行（换行符）单独保留为换行单元
    if (ch === '\n') {
      units.push({ kind: 'newline', dots: [], mask: 0, braille: '', char: ch, index });
      prevDigit = false;
      continue;
    }

    // 水平空白统一视为空格
    if (/\s/.test(ch)) {
      pushCell([], index, ' ', 'space');
      stats.spaces++;
      prevDigit = false;
      continue;
    }

    // 数字：连续数字段只在段首添加一个数字前缀
    if (/[0-9]/.test(ch)) {
      if (!prevDigit) pushSign(NUM_SIGN_DOTS, index, '数字前缀符');
      const letter = Object.keys(DIGIT_BY_LETTER).find((k) => DIGIT_BY_LETTER[k] === ch);
      pushCell(LETTER_DOTS[letter], index, ch, 'digit');
      stats.digits++;
      prevDigit = true;
      continue;
    }

    const lower = ch.toLowerCase();
    const isLetter = /[a-z]/.test(lower) && lower in LETTER_DOTS;

    if (isLetter) {
      if (ch >= 'A' && ch <= 'Z') pushSign(CAP_SIGN_DOTS, index, '大写前缀符');
      pushCell(LETTER_DOTS[lower], index, ch, 'letter');
      stats.letters++;
      prevDigit = false;
      continue;
    }

    if (ch in PUNCT_DOTS) {
      pushCell(PUNCT_DOTS[ch], index, ch, 'punct');
      stats.punct++;
      prevDigit = false;
      continue;
    }

    unsupported.push({ char: ch, index });
    prevDigit = false;
  }

  return { units, unsupported, stats };
}

module.exports = {
  CAP_SIGN_DOTS,
  NUM_SIGN_DOTS,
  LETTER_DOTS,
  PUNCT_DOTS,
  DIGIT_BY_LETTER,
  dotsToMask,
  maskToUnicode,
  dotsToUnicode,
  transcribe,
};
