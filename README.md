# 盲文标签排版台（Braille Layout Station）

输入英文标签与板材参数，系统按 **六点一级（Grade 1）盲文** 转写、**整词换行**排版，
并在页面上实时预览带 **毫米坐标** 的凸点 SVG；可下载 **SVG** 与完整 **排版 JSON**。

技术栈：Node.js + Express + 原生 HTML/CSS/JavaScript（无前端构建）。

---

## 一条命令启动

需要 Docker 20.10+（带 Compose v2）。在项目根目录执行：

```bash
docker compose up -d --build
```

构建阶段即完成 `npm ci` 安装，容器启动脚本完成初始化后直接监听。

然后在浏览器打开：

> **http://localhost:3000**

端口：宿主机 **3000** → 容器 3000（修改端口可编辑 `docker-compose.yml` 的 `ports`）。

停止与清理：

```bash
docker compose down          # 停止
docker compose logs -f       # 查看日志
```

---

## 本地直接运行（无需 Docker）

```bash
npm install
npm start          # http://localhost:3000
npm test           # 运行 26 项单元测试
```

要求 Node.js ≥ 20。

---

## 功能说明

### 盲文转写规则（六点一级）

六点编号（从左到右、自上而下）：

```
1 ● ● 4
2 ● ● 5
3 ● ● 6
```

- **大写字母**：每个大写字母前都加 **大写前缀符（点 6）**，逐字母添加。
- **连续数字段**：一整段数字只在段首加 **一个数字前缀符（点 3-4-5-6）**，
  随后 `a~j` 的点位表示 `1~9、0`（例：`2026` → `数字符 + d b b f`）。
- 支持字母 `A–Z`、数字 `0–9` 与常用标点（逗号、句号、问号、叹号、冒号、分号、
  连字符、撇号、引号、括号、斜杠等）；换行符 `\n` 作为硬换行（空段落保留为空行）。
- 不支持的字符会被**明确指出位置与 Unicode**，绝不静默丢弃。

### 排版与“放不下”的判定

- 按空格分词，贪心 **整词换行**（不在单词中间断行）。
- 几何参数（单位 mm）：
  - **点距 d**：同方内点 1→4、点 1→2 的圆心距（盲方横向步进 = `2d`，标准 2.5）；
  - **行距**：相邻两行对应点的圆心距（标准 10mm；物理下限为 `2d`，否则凸点重叠，会被拒绝）；
  - **边距**：板边缘到凸点圆心的距离，默认 5mm；系统另强制 ≥ 凸点半径（0.75mm），
    保证凸点不被板边裁切；
  - 凸点直径固定 **1.5mm**（ISO 17351 建议值）。
- 以下任一情况都会在页面上列出**具体原因**（可多条同时报告），且不输出被裁切的半成品：
  1. `UNSUPPORTED_CHAR`：字符无法转成一级盲文；
  2. `WORD_OVERFLOW`：某个单词转换后的盲方数超过单行容量，会给出词宽（mm/方数）与容量；
  3. `LINES_OVERFLOW`：整词换行后总行数超过板材行数上限，会给出所需高度与可用高度；
  4. 参数无效（空值/非数字、行距小于 2 倍点距等）返回 HTTP 400。

### 实时预览与下载

- 输入即（180ms 防抖）重新排版，SVG 中 1 用户单位 = 1mm，含：
  - 板材轮廓、10/20mm 网格与毫米刻度坐标；
  - 每个凸点 `<title>` 提示点位与 `(x, y)` 毫米坐标（悬停查看）；
  - 大写/数字前缀符单元以橙色底纹区分；
  - 绿色虚线框为边距安全区；
  - 鼠标在预览图上移动时显示光标毫米坐标（原点为板材左上角）。
- **下载 SVG**：可直接送雕刻/激光打标的矢量文件（viewBox 即毫米）。
- **下载排版 JSON**：含输入参数、盲文单元流、逐行结果、容量、每个凸点的毫米坐标等，
  字段示例：

```json
{
  "schemaVersion": "1.0",
  "input": { "text": "BRAILLE 2026", "boardWidth": 120, "...": "..." },
  "lines": [{ "lineNo": 1, "cells": 20, "widthMm": 97.5, "text": "..." }],
  "dots": [{ "cellColumn": 0, "cellRow": 0, "dot": 6, "x": 7.5, "y": 10.0, "kind": "sign" }],
  "fits": true,
  "errors": []
}
```

---

## HTTP 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/layout` | JSON 入参 `text/boardWidth/boardHeight/dotSpacing/lineGap/margin`，返回 `{ result, svg }` |
| `GET` | `/api/layout.svg?text=...&boardWidth=...` | 直接返回 `image/svg+xml`（便于下载/调试） |
| `GET` | `/healthz` | 健康检查（容器 HEALTHCHECK 使用） |

---

## 项目结构

```
.
├── Dockerfile                # 多阶段构建，构建期完成依赖安装
├── docker-compose.yml        # 一条命令启动
├── docker/entrypoint.sh      # 容器初始化（幂等）
├── server.js                 # Express 服务与 API
├── src/
│   ├── braille.js            # 六点一级盲文转写（大写/数字前缀）
│   ├── layout.js             # 参数校验、容量计算、整词换行、毫米坐标
│   └── svg.js                # 带毫米坐标的凸点 SVG 渲染
├── public/                   # 原生前端（index.html / styles.css / app.js）
└── test/layout.test.js       # node:test 单元测试
```

## 默认示例参数

| 参数 | 默认值 |
| --- | --- |
| 板材宽 × 高 | 120 × 60 mm |
| 点距 d | 2.5 mm（盲方步进 5mm） |
| 行距 | 10 mm |
| 边距 | 5 mm |
| 凸点直径 | 1.5 mm（固定） |
