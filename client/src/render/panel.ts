// 建造/生产面板绘制：圆角按钮 + 造价 + 热键角标 + 禁用灰化 + 进度条。
// 风格与 hud.ts 一致（暗底 + 荧光绿描边）。暂未被 main.ts 引用。

import {
  buttonVisual,
  type PanelButton,
} from '../game/panel.ts';
import { debriefLines, type Debrief, type FundsSample } from '../game/stats.ts';
import type { Rect } from '../game/index.ts';

export interface PanelTheme {
  /** 生产进度条颜色。 */
  progress: string;
  /** 造价文字颜色。 */
  cost: string;
  /** 热键角标颜色。 */
  hotkey: string;
  /** 类型角标颜色（unit/building）。 */
  kind: string;
}

const DEFAULT_THEME: PanelTheme = {
  progress: '#5dff5d',
  cost: '#ffd94d',
  hotkey: '#7da87a',
  kind: '#7da87a',
};

const FONT_FAMILY = 'ui-monospace, Menlo, Consolas, monospace';
const FONT = `11px ${FONT_FAMILY}`;
const FONT_SMALL = `9px ${FONT_FAMILY}`;
const FONT_TITLE = `bold 13px ${FONT_FAMILY}`;
const RADIUS = 4;

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawPanel(
  ctx: CanvasRenderingContext2D,
  layout: readonly PanelButton[],
  theme: PanelTheme = DEFAULT_THEME,
): void {
  for (const b of layout) {
    const v = buttonVisual(b.item);
    roundRect(ctx, b.x, b.y, b.w, b.h, RADIUS);
    ctx.fillStyle = v.fill;
    ctx.fill();
    ctx.strokeStyle = v.border;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    // 标签
    ctx.font = FONT;
    ctx.fillStyle = v.text;
    ctx.fillText(b.item.label, b.x + 8, b.y + 16);

    // 造价
    ctx.font = FONT_SMALL;
    ctx.fillStyle = v.disabled ? v.text : theme.cost;
    ctx.fillText(`$${b.item.cost}`, b.x + 8, b.y + b.h - 7);

    // 热键角标（右上）
    ctx.textAlign = 'right';
    ctx.fillStyle = theme.hotkey;
    ctx.fillText(b.item.hotkey, b.x + b.w - 6, b.y + 12);
    ctx.textAlign = 'left';

    // 进度条（底部）
    if (v.progress01 !== null) {
      const bw = b.w - 16;
      const bx = b.x + 8;
      const by = b.y + b.h - 18;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(bx, by, bw, 3);
      ctx.fillStyle = v.disabled ? v.text : theme.progress;
      ctx.fillRect(bx, by, bw * v.progress01, 3);
    }

    // 禁用原因（标签下方小字）
    if (v.disabled && b.item.reason) {
      ctx.font = FONT_SMALL;
      ctx.fillStyle = v.text;
      ctx.fillText(b.item.reason, b.x + 8, b.y + 27);
    }
  }
}

// ------------------------------------------------------------ 复盘页 ----
// 战后复盘面板：居中卡片，左栏「总览」+ 右栏「单位损失按兵种排行」+
// 底部资金曲线。几何与绘制分离，布局可在 node --test 下断言。

export const DEBRIEF = {
  /** 距视口边缘的最小间距。 */
  margin: 8,
  pad: 16,
  titleH: 30,
  headH: 18,
  rowH: 18,
  gap: 12,
  graphH: 64,
  /** 面板最大宽度。 */
  maxW: 600,
  /** 排行最多展示的名次数。 */
  maxRank: 8,
  /** 左栏固定统计行数，与 stats.ts 的 debriefLines 行数一致。 */
  statRows: 8,
  /** 左栏占内容宽度比例，余下归右栏排行。 */
  leftRatio: 0.44,
} as const;

export interface DebriefLayout {
  /** 居中面板外框。 */
  panel: Rect;
  /** 标题基线 y。 */
  titleY: number;
  /** 左右栏小标题（总览/单位损失）共享基线 y。 */
  headY: number;
  /** 左栏「总览」内容区。 */
  left: Rect;
  /** 右栏「单位损失排行」内容区。 */
  right: Rect;
  /** 行高（绘制左右两栏共用）。 */
  rowH: number;
  /** 排行行矩形，按名次顺序；视口过矮时被截断。 */
  rankRows: Rect[];
  /** 底部资金曲线绘制区（含小标题）。 */
  graph: Rect;
}

/**
 * 复盘页布局：面板居中、左右分栏、底部资金曲线。
 * rankCount 为右栏排行条数（截断到 maxRank）。
 */
export function debriefLayout(
  viewW: number,
  viewH: number,
  rankCount = 0,
): DebriefLayout {
  const compact = viewW < 480 || viewH < 420;
  const pad = compact ? 10 : DEBRIEF.pad;
  const titleH = compact ? 22 : DEBRIEF.titleH;
  const headH = compact ? 14 : DEBRIEF.headH;
  const rowH = compact ? 14 : DEBRIEF.rowH;
  const gap = compact ? 8 : DEBRIEF.gap;
  const graphH = compact ? 40 : DEBRIEF.graphH;

  const rc = Number.isFinite(rankCount) ? Math.floor(rankCount) : 0;
  const n = Math.max(0, Math.min(DEBRIEF.maxRank, rc));
  const w = Math.min(DEBRIEF.maxW, Math.max(0, viewW - DEBRIEF.margin * 2));
  const wantRows = Math.max(DEBRIEF.statRows, n);
  const wantH =
    pad * 2 + titleH + headH + wantRows * rowH + gap + graphH;
  const h = Math.min(wantH, Math.max(0, viewH - DEBRIEF.margin * 2));
  const panel: Rect = {
    x: Math.round((viewW - w) / 2),
    y: Math.round((viewH - h) / 2),
    w,
    h,
  };

  const innerX = panel.x + pad;
  const innerW = Math.max(0, panel.w - pad * 2);
  const bodyY = panel.y + pad + titleH + headH;
  // 视口过矮时按剩余高度截断行数，保证所有矩形仍在面板内。
  const bodyMaxH = Math.max(
    0,
    panel.y + panel.h - pad - gap - graphH - bodyY,
  );
  const shownRows = Math.min(wantRows, Math.floor(bodyMaxH / rowH));
  const bodyH = shownRows * rowH;
  const leftW = Math.floor((innerW - gap) * DEBRIEF.leftRatio);
  const left: Rect = { x: innerX, y: bodyY, w: leftW, h: bodyH };
  const right: Rect = {
    x: innerX + leftW + gap,
    y: bodyY,
    w: innerW - leftW - gap,
    h: bodyH,
  };
  const rankRows: Rect[] = [];
  for (let i = 0; i < Math.min(n, shownRows); i++) {
    rankRows.push({ x: right.x, y: right.y + i * rowH, w: right.w, h: rowH });
  }
  const graphY = bodyY + bodyH + gap;
  const graph: Rect = {
    x: innerX,
    y: graphY,
    w: innerW,
    h: Math.max(0, Math.min(graphH, panel.y + panel.h - pad - graphY)),
  };
  return {
    panel,
    titleY: panel.y + pad + Math.round(titleH * 0.72),
    headY: panel.y + pad + titleH + Math.round(headH * 0.7),
    left,
    right,
    rowH,
    rankRows,
    graph,
  };
}

function drawFundsGraph(
  ctx: CanvasRenderingContext2D,
  graph: Rect,
  funds: readonly FundsSample[],
): void {
  if (graph.w <= 0 || graph.h <= 0) return;
  ctx.textAlign = 'left';
  ctx.font = FONT_SMALL;
  ctx.fillStyle = '#7da87a';
  ctx.fillText('资金曲线', graph.x, graph.y + 9);
  const plot = { x: graph.x, y: graph.y + 12, w: graph.w, h: graph.h - 12 };
  if (plot.h <= 0) return;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.fillRect(plot.x, plot.y, plot.w, plot.h);
  if (funds.length === 0) return;
  const max = Math.max(1, ...funds.map((p) => p.credits));
  const t0 = funds[0]!.t;
  const t1 = Math.max(funds[funds.length - 1]!.t, t0 + 1);
  ctx.strokeStyle = '#5dff5d';
  ctx.lineWidth = 1;
  ctx.beginPath();
  funds.forEach((p, i) => {
    const x = plot.x + ((p.t - t0) / (t1 - t0)) * plot.w;
    const y = plot.y + plot.h - (p.credits / max) * plot.h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

/**
 * 绘制复盘页。labelOf 把兵种 id 翻成显示名（默认原样输出）。
 * 数据来自 stats.ts 的 debrief()。
 */
export function drawDebrief(
  ctx: CanvasRenderingContext2D,
  layout: DebriefLayout,
  d: Debrief,
  labelOf: (kind: string) => string = (k) => k,
): void {
  const { panel } = layout;
  roundRect(ctx, panel.x, panel.y, panel.w, panel.h, RADIUS);
  ctx.fillStyle = 'rgba(10, 14, 8, 0.88)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(93, 255, 93, 0.55)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textBaseline = 'alphabetic';

  // 标题
  ctx.textAlign = 'center';
  ctx.font = FONT_TITLE;
  ctx.fillStyle = '#cfe8c9';
  ctx.fillText('战后复盘', panel.x + panel.w / 2, layout.titleY);

  // 栏目标题
  ctx.textAlign = 'left';
  ctx.font = FONT_SMALL;
  ctx.fillStyle = '#7da87a';
  ctx.fillText('总览', layout.left.x, layout.headY);
  ctx.fillText('单位损失排行', layout.right.x, layout.headY);

  // 左栏：总览行（首行结果按胜负着色）
  const lines = debriefLines(d);
  ctx.font = FONT;
  for (let i = 0; i < lines.length; i++) {
    const y = layout.left.y + (i + 0.78) * layout.rowH;
    if (y > layout.left.y + layout.left.h) break;
    ctx.fillStyle =
      i === 0 ? (d.victory ? '#5dff5d' : '#ff6b5d') : '#cfe8c9';
    ctx.fillText(lines[i]!, layout.left.x, y);
  }

  // 右栏：单位损失排行（名次 + 兵种 + 数量 + 比例条）
  const top = d.unitLossRank.slice(0, layout.rankRows.length);
  const max = Math.max(1, ...top.map((r) => r.count));
  ctx.font = FONT;
  layout.rankRows.forEach((row, i) => {
    const r = top[i];
    if (!r) return;
    ctx.fillStyle = 'rgba(93, 255, 93, 0.14)';
    ctx.fillRect(row.x, row.y + row.h - 4, (row.w * r.count) / max, 3);
    ctx.fillStyle = '#cfe8c9';
    ctx.textAlign = 'left';
    ctx.fillText(`${i + 1}. ${labelOf(r.kind)}`, row.x, row.y + row.h - 7);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffd94d';
    ctx.fillText(`×${r.count}`, row.x + row.w, row.y + row.h - 7);
    ctx.textAlign = 'left';
  });
  if (d.unitLossRank.length === 0 && layout.right.h > 0) {
    ctx.fillStyle = '#6b7a68';
    ctx.fillText('无损失', layout.right.x, layout.right.y + layout.rowH * 0.78);
  }

  // 底部：资金曲线
  drawFundsGraph(ctx, layout.graph, d.funds);
}
