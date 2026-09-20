'use strict';

/**
 * layout.js —— 盲文标签排版
 *
 * 几何约定（单位：毫米）：
 *   点距 d        同一盲方内点 1→4（水平）与点 1→2（垂直）的圆心距
 *                 因此每个盲方横向步进 = 2d；同一盲方左、右两列点水平相距 d
 *   行距 lineGap  相邻两行盲文“对应点”（如点1→点1）的圆心距，即行步进；
 *                 物理上须 ≥ 2d（否则上行点3与下行点1重叠）
 *   点直径 dotDia 凸点直径（ISO 17351 建议 1.5mm，固定常量）
 *   边距 margin   板边缘到可放凸点圆心的最小距离（系统另保证 ≥ 点半径，
 *                 因此凸点绝不会被板材边缘裁切）
 *
 * 每个盲方宽度按 2d 步进；盲方凸点实际外廓宽 d（左点到右点的圆心距）。
 */

const { transcribe } = require('./braille');

const DOT_DIAMETER_MM = 1.5;
const DOT_RADIUS_MM = DOT_DIAMETER_MM / 2;
const MAX_TEXT_LENGTH = 2000;
const MAX_DIMENSION_MM = 5000;

const round3 = (v) => Math.round(v * 1000) / 1000;

/**
 * 校验并规整请求参数。出错时抛出包含 code 与 field 的错误。
 */
function parseParams(input) {
  const out = {};
  const fields = [
    { key: 'boardWidth', label: '板材宽度', min: 0.1, max: MAX_DIMENSION_MM },
    { key: 'boardHeight', label: '板材高度', min: 0.1, max: MAX_DIMENSION_MM },
    { key: 'dotSpacing', label: '点距', min: 0.1, max: MAX_DIMENSION_MM },
    { key: 'lineGap', label: '行距', min: 0.1, max: MAX_DIMENSION_MM },
  ];

  for (const f of fields) {
    const raw = input[f.key];
    if (raw === undefined || raw === null || raw === '') {
      const err = new Error(`${f.label}不能为空`);
      err.code = 'VALIDATION';
      err.field = f.key;
      throw err;
    }
    const num = Number(raw);
    if (!Number.isFinite(num)) {
      const err = new Error(`${f.label}必须是有效数字，收到：${String(raw)}`);
      err.code = 'VALIDATION';
      err.field = f.key;
      throw err;
    }
    if (num < f.min) {
      const err = new Error(`${f.label}必须 ≥ ${f.min}mm，收到：${num}mm`);
      err.code = 'VALIDATION';
      err.field = f.key;
      throw err;
    }
    if (num > f.max) {
      const err = new Error(`${f.label}必须 ≤ ${f.max}mm，收到：${num}mm`);
      err.code = 'VALIDATION';
      err.field = f.key;
      throw err;
    }
    out[f.key] = num;
  }

  let margin;
  if (input.margin === undefined || input.margin === null || input.margin === '') {
    margin = 5;
  } else {
    margin = Number(input.margin);
    if (!Number.isFinite(margin)) {
      const err = new Error(`边距必须是有效数字，收到：${String(input.margin)}`);
      err.code = 'VALIDATION';
      err.field = 'margin';
      throw err;
    }
    if (margin < 0 || margin > MAX_DIMENSION_MM) {
      const err = new Error(`边距必须在 0 ~ ${MAX_DIMENSION_MM}mm 之间，收到：${margin}mm`);
      err.code = 'VALIDATION';
      err.field = 'margin';
      throw err;
    }
  }
  out.margin = margin;

  // 行距物理下限（不允许相邻行凸点重叠）
  if (out.lineGap < 2 * out.dotSpacing) {
    const err = new Error(
      `行距 ${out.lineGap}mm 小于点距的 2 倍（${2 * out.dotSpacing}mm），` +
        `相邻两行凸点会重叠，请增大行距或减小点距`
    );
    err.code = 'VALIDATION';
    err.field = 'lineGap';
    throw err;
  }

  const text = typeof input.text === 'string' ? input.text : '';
  if (text.length > MAX_TEXT_LENGTH) {
    const err = new Error(`标签文本过长（${text.length} 字符），上限 ${MAX_TEXT_LENGTH} 字符`);
    err.code = 'VALIDATION';
    err.field = 'text';
    throw err;
  }
  out.text = text;
  return out;
}

/**
 * 计算版面容量（单位 mm）。
 * 圆心安全区：[effMargin, W - effMargin]；effMargin = max(margin, 点半径)。
 * @returns {{usableWidth, usableHeight, cellPitch, maxCellsPerLine, maxLines, effMargin}}
 */
function capacity(p) {
  const effMargin = Math.max(p.margin, DOT_RADIUS_MM);
  const cellPitch = 2 * p.dotSpacing;
  const usableWidth = p.boardWidth - 2 * effMargin;
  const usableHeight = p.boardHeight - 2 * effMargin;

  // n 个盲方：首个圆心 x=effMargin，第 n 个右点圆心 x=effMargin+(n-1)*2d+d
  let maxCellsPerLine = 0;
  if (usableWidth >= p.dotSpacing) {
    maxCellsPerLine = Math.floor((usableWidth - p.dotSpacing) / cellPitch) + 1;
  }

  // m 行：首行点1 y=effMargin，点3 y=effMargin+2d；第 m 行点3 y=effMargin+(m-1)*lineGap+2d
  let maxLines = 0;
  if (usableHeight >= 2 * p.dotSpacing) {
    maxLines = Math.floor((usableHeight - 2 * p.dotSpacing) / p.lineGap) + 1;
  }

  return { usableWidth, usableHeight, cellPitch, maxCellsPerLine, maxLines, effMargin };
}

/**
 * 将盲文单元流切分为 token：
 *   - 空白（含连续空白，折叠为一个空格 token，占一个空方）
 *   - 硬换行 break
 *   - 词：连续的非空白单元（前缀符+字符），宽度 = 单元数
 */
function tokenize(units) {
  const tokens = [];
  let word = null;

  const flushWord = () => {
    if (word) {
      tokens.push(word);
      word = null;
    }
  };

  for (const u of units) {
    if (u.kind === 'newline') {
      flushWord();
      tokens.push({ type: 'break', units: [], width: 0 });
    } else if (u.kind === 'space') {
      flushWord();
      if (tokens.length === 0 || tokens[tokens.length - 1].type !== 'space') {
        tokens.push({ type: 'space', units: [u], width: 1 });
      }
    } else {
      if (!word) word = { type: 'word', units: [], width: 0 };
      word.units.push(u);
      word.width++;
    }
  }
  flushWord();
  // 折叠尾随空格（行尾空格不占盲方）
  while (tokens.length && tokens[tokens.length - 1].type === 'space') tokens.pop();
  return tokens;
}

/** 去除一行首尾的空格盲方 */
function trimLine(units) {
  let lo = 0;
  let hi = units.length;
  while (lo < hi && units[lo].kind === 'space') lo++;
  while (hi > lo && units[hi - 1].kind === 'space') hi--;
  return units.slice(lo, hi);
}

/**
 * 生成完整排版结果。放不下时通过 errors 给出原因，绝不裁切。
 */
function layout(input) {
  const params = parseParams(input);
  const { text, boardWidth, boardHeight, dotSpacing, lineGap, margin } = params;

  const { units, unsupported, stats } = transcribe(text);
  const cap = capacity(params);

  const errors = [];

  for (const bad of unsupported) {
    errors.push({
      code: 'UNSUPPORTED_CHAR',
      message:
        `不支持的字符 “${bad.char}”（第 ${bad.index + 1} 个字符，Unicode U+${bad.char
          .codePointAt(0)
          .toString(16)
          .toUpperCase()
          .padStart(4, '0')}），无法转换为一级盲文`,
      char: bad.char,
      index: bad.index,
    });
  }

  const tokens = tokenize(units);

  // 1) 单词超宽检查（任何换行策略都无法挽救）
  for (const t of tokens) {
    if (t.type === 'word' && t.width > cap.maxCellsPerLine) {
      const surface = t.units.map((u) => u.char).join('');
      const wordExtent = round3((t.width - 1) * cap.cellPitch + dotSpacing);
      errors.push({
        code: 'WORD_OVERFLOW',
        message:
          `单词 “${surface}” 转换后含 ${t.width} 个盲方，凸点外廓宽 ${wordExtent}mm，` +
          `超过板材单行容量 ${cap.maxCellsPerLine} 方（可用圆心宽 ${round3(
            cap.usableWidth
          )}mm，盲方步进 ${round3(cap.cellPitch)}mm），整词换行也无法容纳`,
        word: surface,
        widthUnits: t.width,
        widthMm: wordExtent,
        maxUnits: cap.maxCellsPerLine,
      });
    }
  }

  // 2) 贪心整词换行。
  //    逐词处理：行首直接放词；行中判断“空方 + 词”能否放下，
  //    放不下则另起一行，词间空方随词一起到新行（即行尾不留空格）。
  const rawLines = [[]];
  let cursor = 0;

  for (const t of tokens) {
    if (t.type === 'break') {
      rawLines.push([]);
      cursor = 0;
      continue;
    }
    if (t.type === 'space') continue; // 空格由词放置时按需补入

    const cur = rawLines[rawLines.length - 1];
    if (cur.length > 0 && cursor + 1 + t.width > cap.maxCellsPerLine) {
      rawLines.push([]);
      cursor = 0;
    }
    const target = rawLines[rawLines.length - 1];
    if (target.length > 0) {
      target.push({ kind: 'space', dots: [], mask: 0, braille: '', char: ' ', index: -1 });
    }
    for (const u of t.units) target.push(u);
    cursor = target.length;
  }

  // 每行去掉首尾空方；折叠尾随硬换行产生的末尾空行（段落中间的空行保留）
  let usedLines = rawLines.map(trimLine);
  while (usedLines.length > 1 && usedLines[usedLines.length - 1].length === 0) {
    usedLines.pop();
  }
  if (text.length === 0) usedLines = [];

  // 3) 总行数检查
  if (usedLines.length > cap.maxLines) {
    const requiredHeight = 2 * dotSpacing + (usedLines.length - 1) * lineGap;
    errors.push({
      code: 'LINES_OVERFLOW',
      message:
        `整词换行后共需 ${usedLines.length} 行，板材最多容纳 ${cap.maxLines} 行：` +
        `所需高度 ${round3(requiredHeight)}mm，而可用圆心高仅 ${round3(
          cap.usableHeight
        )}mm（板材高 ${boardHeight}mm，边距 ${margin}mm）`,
      requiredLines: usedLines.length,
      maxLines: cap.maxLines,
      requiredHeightMm: round3(requiredHeight),
      usableHeightMm: round3(cap.usableHeight),
    });
  }

  const fits = errors.length === 0;

  // 4) 仅在完全放得下时输出凸点毫米坐标
  const placed = [];
  let contentWidth = 0;
  let contentHeight = 0;
  if (fits) {
    usedLines.forEach((lineUnitsArr, lineNo) => {
      const y1 = cap.effMargin + lineNo * lineGap;
      lineUnitsArr.forEach((u, col) => {
        const x0 = cap.effMargin + col * cap.cellPitch;
        if (!u.dots || u.dots.length === 0) return;
        for (const d of u.dots) {
          const isRight = d >= 4;
          const row = isRight ? d - 4 : d - 1; // 0/1/2
          placed.push({
            cellColumn: col,
            cellRow: lineNo,
            dot: d,
            x: round3(x0 + (isRight ? dotSpacing : 0)),
            y: round3(y1 + row * dotSpacing),
            sourceChar: u.char,
            sourceIndex: u.index,
            kind: u.kind,
            note: u.note || null,
          });
        }
      });
      if (lineUnitsArr.length > 0) {
        const extent = (lineUnitsArr.length - 1) * cap.cellPitch + dotSpacing;
        if (extent > contentWidth) contentWidth = extent;
      }
    });
    contentWidth = round3(contentWidth);
    contentHeight = round3(
      usedLines.length > 0 ? 2 * dotSpacing + (usedLines.length - 1) * lineGap : 0
    );
  }

  return {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    input: { text, boardWidth, boardHeight, dotSpacing, lineGap, margin },
    standard: {
      grade: 'Grade 1（六点一级）',
      dotNumbering: '1-4 / 2-5 / 3-6（左上、左中、左下、右上、右中、右下）',
      dotDiameterMm: DOT_DIAMETER_MM,
      cellPitchMm: cap.cellPitch,
      rules: [
        '大写字母前加大写前缀符（点6），逐字母添加',
        '连续数字段只在段首添加一个数字前缀符（点3-4-5-6），a~j 对应 1~9、0',
        '按空格分词、整词换行；任何单词超宽或总行数超限都报错，绝不裁切',
      ],
    },
    transcription: {
      brailleStream: units.map((u) => u.braille).join(''),
      units: units.map((u) => ({
        kind: u.kind,
        dots: u.dots,
        braille: u.braille,
        sourceChar: u.char,
        sourceIndex: u.index,
        note: u.note || null,
      })),
      stats,
    },
    capacity: {
      usableWidthMm: round3(cap.usableWidth),
      usableHeightMm: round3(cap.usableHeight),
      cellPitchMm: round3(cap.cellPitch),
      maxCellsPerLine: cap.maxCellsPerLine,
      maxLines: cap.maxLines,
    },
    lines: usedLines.map((lineUnitsArr, i) => ({
      lineNo: i + 1,
      cells: lineUnitsArr.length,
      widthMm: round3(
        lineUnitsArr.length > 0 ? (lineUnitsArr.length - 1) * cap.cellPitch + dotSpacing : 0
      ),
      text: lineUnitsArr.map((u) => u.char).join(''),
      braille: lineUnitsArr.map((u) => u.braille).join(''),
    })),
    requiredLines: usedLines.length,
    content: {
      widthMm: contentWidth,
      heightMm: contentHeight,
      dotCount: placed.length,
    },
    fits,
    errors,
    dots: fits ? placed : [],
  };
}

module.exports = {
  DOT_DIAMETER_MM,
  DOT_RADIUS_MM,
  MAX_TEXT_LENGTH,
  round3,
  parseParams,
  capacity,
  tokenize,
  layout,
};
