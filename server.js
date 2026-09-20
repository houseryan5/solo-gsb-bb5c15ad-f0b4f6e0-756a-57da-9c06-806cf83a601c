'use strict';

/**
 * server.js —— 盲文标签排版台 HTTP 服务
 *
 * 路由：
 *   GET  /                  前端页面
 *   GET  /healthz           容器健康检查
 *   POST /api/layout        排版计算，返回 { result, svg }（参数错误 400，放得下/放不下均为 200）
 *   GET  /api/layout.svg?... 直接 GET 方式取 SVG（便于下载/调试）
 */

const path = require('path');
const express = require('express');
const { layout } = require('./src/layout');
const { renderSvg } = require('./src/svg');

const app = express();
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, service: 'braille-layout-station', time: new Date().toISOString() });
});

function buildLayout(raw) {
  return layout({
    text: raw.text,
    boardWidth: raw.boardWidth,
    boardHeight: raw.boardHeight,
    dotSpacing: raw.dotSpacing,
    lineGap: raw.lineGap,
    margin: raw.margin,
  });
}

app.post('/api/layout', (req, res) => {
  let result;
  try {
    result = buildLayout(req.body || {});
  } catch (err) {
    if (err.code === 'VALIDATION') {
      return res.status(400).json({ error: err.message, field: err.field || null });
    }
    throw err;
  }
  res.json({ result, svg: renderSvg(result) });
});

app.get('/api/layout.svg', (req, res) => {
  let result;
  try {
    result = buildLayout(req.query);
  } catch (err) {
    if (err.code === 'VALIDATION') {
      return res.status(400).type('text/plain; charset=utf-8').send(err.message);
    }
    throw err;
  }
  res
    .type('image/svg+xml; charset=utf-8')
    .set('Content-Disposition', 'inline; filename="braille-label.svg"')
    .send(renderSvg(result));
});

app.use((err, _req, res, _next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: '请求体不是合法的 JSON', field: null });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: '请求体过大', field: null });
  }
  // eslint-disable-next-line no-console
  console.error('[server] 未处理错误：', err);
  res.status(500).json({ error: '服务器内部错误' });
});

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`[盲文标签排版台] 已启动：http://localhost:${PORT}（监听 ${HOST}）`);
  });
}

module.exports = app;
