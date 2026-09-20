'use strict';

/* app.js —— 盲文标签排版台前端（原生 JS，实时防抖刷新） */

const $ = (id) => document.getElementById(id);

const fields = ['text', 'boardWidth', 'boardHeight', 'dotSpacing', 'lineGap', 'margin'];
const inputs = Object.fromEntries(fields.map((f) => [f, $(f)]));

let latest = null; // { result, svg }
let requestSeq = 0;
let pendingTimer = null;

const EXAMPLE = 'EXIT 7 RAILWAY\nROOM 408 OPEN 24H';

function readPayload() {
  return {
    text: inputs.text.value,
    boardWidth: inputs.boardWidth.value,
    boardHeight: inputs.boardHeight.value,
    dotSpacing: inputs.dotSpacing.value,
    lineGap: inputs.lineGap.value,
    margin: inputs.margin.value,
  };
}

function setStatus(kind, msg) {
  const pill = $('status-pill');
  pill.className = `status-pill ${kind}`;
  pill.textContent = msg;
}

function showErrors(errors, serverError) {
  const box = $('error-box');
  box.classList.remove('hidden', 'warn');
  const items = [];
  if (serverError) {
    items.push(serverError);
  }
  for (const e of errors || []) {
    let extra = '';
    if (e.code === 'WORD_OVERFLOW') {
      extra = `（需要 ${e.widthUnits} 方 / ${e.widthMm}mm，单行仅 ${e.maxUnits} 方）`;
    } else if (e.code === 'LINES_OVERFLOW') {
      extra = `（需要 ${e.requiredLines} 行 / ${e.requiredHeightMm}mm，最多 ${e.maxLines} 行 / ${e.usableHeightMm}mm）`;
    }
    items.push(`${e.message}${extra}`);
  }
  box.innerHTML =
    `<h4>${serverError ? '参数无效' : '排版失败：内容放不下（未裁切任何盲符）'}</h4>` +
    `<ul>${items.map((m) => `<li>${escapeHtml(m)}</li>`).join('')}</ul>`;
}

function clearErrors() {
  const box = $('error-box');
  box.className = 'error-box hidden';
  box.innerHTML = '';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

async function refresh() {
  const payload = readPayload();
  const seq = ++requestSeq;
  try {
    const resp = await fetch('/api/layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (seq !== requestSeq) return; // 已有更新的请求，丢弃过期响应
    const data = await resp.json();
    if (!resp.ok) {
      latest = null;
      $('preview').innerHTML = '';
      $('stats').innerHTML = '';
      $('stream').innerHTML = '';
      $('lines').innerHTML = '';
      $('coords').innerHTML = '';
      showErrors(null, data.error || '请求失败');
      setStatus('bad', '参数无效');
      toggleDownloads(false);
      return;
    }
    latest = data;
    render(data);
  } catch (err) {
    latest = null;
    showErrors(null, `无法连接排版服务：${err.message}`);
    setStatus('bad', '网络错误');
    toggleDownloads(false);
  }
}

function toggleDownloads(ok) {
  $('btn-svg').disabled = !ok;
  $('btn-json').disabled = !ok;
}

function render({ result, svg }) {
  // 预览
  $('preview').innerHTML = svg;
  bindPreviewCursor();

  if (!result.fits) {
    showErrors(result.errors);
    setStatus('bad', `放不下（${result.errors.length} 项原因）`);
    toggleDownloads(false);
  } else {
    clearErrors();
    setStatus(
      'ok',
      `排版成功：${result.requiredLines} 行 · ${result.content.dotCount} 个凸点 · 内容 ${result.content.widthMm}×${result.content.heightMm}mm`
    );
    toggleDownloads(true);
  }

  // 统计
  const s = result.transcription.stats;
  const cap = result.capacity;
  const stats = [
    ['盲方总数', s.cells],
    ['前缀符', s.signs],
    ['字母', s.letters],
    ['数字', s.digits],
    ['标点/空方', `${s.punct}/${s.spaces}`],
    ['所需行数', result.requiredLines],
    ['单行上限', `${cap.maxCellsPerLine} 方`],
    ['行数上限', `${cap.maxLines} 行`],
    ['盲方步进', `${cap.cellPitchMm}mm`],
  ];
  $('stats').innerHTML = stats
    .map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`)
    .join('');

  // 盲文流（前缀符高亮）
  $('stream').innerHTML = result.transcription.units
    .map((u) => {
      if (u.kind === 'newline') return '<br>';
      if (u.kind === 'sign') return `<span class="sign" title="${escapeHtml(u.note || '')}">${u.braille}</span>`;
      return u.braille || '⠀';
    })
    .join('');

  // 逐行
  $('lines').innerHTML =
    result.lines.length === 0
      ? '<div class="line-row"><span class="no">—</span><span class="br">（空）</span></div>'
      : result.lines
          .map(
            (l) =>
              `<div class="line-row"><span class="no">第 ${l.lineNo} 行</span>` +
              `<span class="br">${escapeHtml(l.braille || '（空行）')}</span>` +
              `<span class="w">${l.cells} 方 / ${l.widthMm}mm</span></div>`
          )
          .join('');

  // 坐标表
  if (result.fits) {
    $('coords').innerHTML =
      `<table><thead><tr><th>来源</th><th>行</th><th>方</th><th>点</th><th>x(mm)</th><th>y(mm)</th></tr></thead><tbody>` +
      result.dots
        .map(
          (p) =>
            `<tr class="${p.kind === 'sign' ? 'sign-row' : ''}"><td>${
              p.kind === 'sign'
                ? escapeHtml(p.note || '前缀符')
                : escapeHtml(p.sourceChar === ' ' ? '空格' : p.sourceChar)
            }</td><td>${p.cellRow + 1}</td><td>${p.cellColumn + 1}</td><td>${p.dot}</td>` +
            `<td>${p.x.toFixed(3)}</td><td>${p.y.toFixed(3)}</td></tr>`
        )
        .join('') +
      `</tbody></table>`;
  } else {
    $('coords').innerHTML =
      '<p style="padding:8px 10px;color:#b02a2a;font-size:0.82rem;margin:0;">排版未通过，不生成坐标（避免输出裁切的半成品）。</p>';
  }
}

/** 在预览 SVG 上跟随光标显示毫米坐标 */
function bindPreviewCursor() {
  const svg = $('preview').querySelector('svg');
  if (!svg) return;
  // SVG 含外侧标尺带（src/svg.js 的 PAD），减去后才是板材相对毫米坐标
  const pad = Number(svg.dataset.pad) || 12;
  const pt = svg.createSVGPoint();
  const show = (clientX, clientY) => {
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const p = pt.matrixTransform(ctm.inverse());
    $('cursor-coord').textContent = `光标毫米坐标（相对板材左上角）：x = ${(
      p.x - pad
    ).toFixed(2)} mm，y = ${(p.y - pad).toFixed(2)} mm`;
  };
  svg.addEventListener('mousemove', (e) => show(e.clientX, e.clientY));
  svg.addEventListener('mouseleave', () => {
    $('cursor-coord').textContent = '光标毫米坐标：—';
  });
}

function scheduleRefresh() {
  clearTimeout(pendingTimer);
  setStatus('', '排版计算中…');
  pendingTimer = setTimeout(refresh, 180);
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

for (const el of Object.values(inputs)) {
  el.addEventListener('input', scheduleRefresh);
}

$('btn-svg').addEventListener('click', () => {
  if (!latest || !latest.result.fits) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  download(`braille-label-${stamp}.svg`, latest.svg, 'image/svg+xml;charset=utf-8');
});

$('btn-json').addEventListener('click', () => {
  if (!latest || !latest.result.fits) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  download(
    `braille-layout-${stamp}.json`,
    JSON.stringify(latest.result, null, 2),
    'application/json'
  );
});

$('btn-example').addEventListener('click', () => {
  inputs.text.value = EXAMPLE;
  inputs.boardWidth.value = 150;
  inputs.boardHeight.value = 70;
  inputs.dotSpacing.value = 2.5;
  inputs.lineGap.value = 10;
  inputs.margin.value = 6;
  scheduleRefresh();
});

refresh();
