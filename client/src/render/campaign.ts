// 战役界面：关卡选择卡 + 任务结算（星级/下一关/重玩/返回菜单）。
// 与 menu.ts 同一约定 —— 纯几何(layout+hit)与 canvas 绘制分离，命中测试
// 可在 node --test 下无 DOM 运行。图形一律 canvas 绘制，无外部素材。

import type { Rect } from '../game/index.ts';

// ------------------------------------------------------------ geometry ----

export type CampaignHit = { kind: 'mission'; index: number } | { kind: 'back' };

export interface CampaignLayout {
  titleY: number;
  subtitleY: number;
  cards: { index: number; rect: Rect }[];
  back: Rect;
}

export type MissionEndButton = 'next' | 'retry' | 'menu';

export interface MissionEndLayout {
  bandY: number;
  buttons: { id: MissionEndButton; rect: Rect }[];
}

const CARD_GAP = 12;
const BTN_H = 52;
const BTN_GAP = 14;

const inRect = (r: Rect, x: number, y: number): boolean =>
  x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/**
 * 单列关卡卡：标题下顺序排开，卡高随可用高度伸缩（小屏收紧到 56）。
 * `count` 注入而不是读 MISSIONS，保证布局函数纯几何。
 */
export function campaignLayout(viewW: number, viewH: number, count: number): CampaignLayout {
  const w = Math.min(viewW - 32, 620);
  const x = (viewW - w) / 2;
  const top = Math.round(viewH * 0.22);
  const bh = viewH < 480 ? 40 : BTN_H;
  // 给返回按钮预留 bh + 上下空隙，其余高度均分给卡片。
  const avail = Math.max(120, viewH - top - bh - CARD_GAP * 3 - 16);
  const cardH = Math.max(56, Math.min(84, (avail - CARD_GAP * (count - 1)) / count));
  const cards = Array.from({ length: count }, (_, i) => ({
    index: i,
    rect: { x, y: top + i * (cardH + CARD_GAP), w, h: cardH },
  }));
  const last = cards[cards.length - 1];
  const backY = last ? last.rect.y + last.rect.h + CARD_GAP * 1.5 : top;
  return {
    titleY: Math.round(viewH * 0.11),
    subtitleY: Math.round(viewH * 0.11) + 28,
    cards,
    back: { x: (viewW - 200) / 2, y: Math.min(viewH - bh - 12, backY), w: 200, h: bh },
  };
}

export function campaignHit(l: CampaignLayout, x: number, y: number): CampaignHit | null {
  for (const c of l.cards) {
    if (inRect(c.rect, x, y)) return { kind: 'mission', index: c.index };
  }
  if (inRect(l.back, x, y)) return { kind: 'back' };
  return null;
}

/** 结算按钮行：胜利给 下一关/重玩/返回菜单，失败给 重试/返回菜单。 */
export function missionEndLayout(
  viewW: number,
  viewH: number,
  next: boolean,
): MissionEndLayout {
  const ids: MissionEndButton[] = next ? ['next', 'retry', 'menu'] : ['retry', 'menu'];
  const gap = 16;
  const bw = Math.max(110, Math.min(170, (viewW - 96 - gap * (ids.length - 1)) / ids.length));
  const bh = viewH < 480 ? 40 : 48;
  const totalW = ids.length * bw + (ids.length - 1) * gap;
  const x0 = (viewW - totalW) / 2;
  const y = viewH / 2 + 92; // 信息行排到 cy+66，按钮让到其下
  return {
    bandY: viewH / 2,
    buttons: ids.map((id, i) => ({
      id,
      rect: { x: x0 + i * (bw + gap), y, w: bw, h: bh },
    })),
  };
}

export function missionEndHit(
  l: MissionEndLayout,
  x: number,
  y: number,
): MissionEndButton | null {
  for (const b of l.buttons) {
    if (inRect(b.rect, x, y)) return b.id;
  }
  return null;
}

// ------------------------------------------------------------- drawing ----

const PANEL_BG = 'rgba(10, 14, 8, 0.72)';
const BORDER = 'rgba(93, 255, 93, 0.35)';
const ACCENT = '#5dff5d';
const TEXT_MAIN = '#cfe8c9';
const TEXT_DIM = '#7da87a';
const WARN = '#ffd94d';
const BAD = '#ff6b5d';
const FONT = 'ui-monospace, Menlo, Consolas, monospace';

/** fillText capped at maxW — overlong strings ellipsize instead of bleeding. */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
): void {
  if (ctx.measureText(text).width <= maxW) {
    ctx.fillText(text, x, y);
    return;
  }
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  ctx.fillText(`${t}…`, x, y);
}

function button(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  label: string,
  opts: { hover?: boolean; dim?: boolean; font?: string } = {},
): void {
  ctx.fillStyle = opts.dim
    ? 'rgba(255,255,255,0.03)'
    : opts.hover
      ? 'rgba(255,255,255,0.12)'
      : 'rgba(255,255,255,0.07)';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = opts.dim ? 'rgba(255,255,255,0.10)' : BORDER;
  ctx.lineWidth = 1;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  ctx.font = opts.font ?? `bold 16px ${FONT}`;
  ctx.fillStyle = opts.dim ? TEXT_DIM : TEXT_MAIN;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/** 五角星路径：canvas 手画，空心描边 / 实心填充两用。 */
function starPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const inner = r * 0.42;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + rr * Math.cos(a);
    const y = cy + rr * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** 一排 n 颗星：filled 颗实心金，其余描边暗色。返回整排宽度。 */
export function drawStars(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  filled: number,
  total = 3,
): void {
  const span = r * 2.4;
  const x0 = cx - ((total - 1) * span) / 2;
  for (let i = 0; i < total; i++) {
    starPath(ctx, x0 + i * span, cy, r);
    if (i < filled) {
      ctx.fillStyle = WARN;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    } else {
      ctx.strokeStyle = TEXT_DIM;
    }
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
}

/** 未解锁卡右上角的锁形：圆角框 + 扣环，全 canvas。 */
function drawLock(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  ctx.strokeStyle = TEXT_DIM;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy - s * 0.15, s * 0.42, Math.PI, 0);
  ctx.stroke();
  ctx.fillStyle = 'rgba(125,168,122,0.5)';
  ctx.fillRect(cx - s * 0.5, cy - s * 0.15, s, s * 0.8);
  ctx.strokeRect(cx - s * 0.5, cy - s * 0.15, s, s * 0.8);
}

export interface MissionCardModel {
  index: number;
  name: string;
  briefing: string;
  /** 目标摘要行（e.g. "目标：歼灭巡逻队"），由调用方拼装。 */
  objective: string;
  unlocked: boolean;
  /** 历史最佳 0–3。 */
  stars: number;
}

export interface CampaignModel {
  missions: readonly MissionCardModel[];
  /** 已通关数 / 总星数，副标题一行。 */
  cleared: number;
  totalStars: number;
  hover?: CampaignHit | null;
}

const hoverMission = (h: CampaignHit | null | undefined, i: number): boolean =>
  !!h && h.kind === 'mission' && h.index === i;

export function drawCampaign(
  ctx: CanvasRenderingContext2D,
  viewW: number,
  viewH: number,
  model: CampaignModel,
): void {
  const l = campaignLayout(viewW, viewH, model.missions.length);

  ctx.textAlign = 'center';
  ctx.fillStyle = ACCENT;
  ctx.font = `bold ${viewW < 480 ? 30 : 40}px ${FONT}`;
  ctx.fillText('战 役', viewW / 2, l.titleY);
  ctx.font = `13px ${FONT}`;
  ctx.fillStyle = TEXT_DIM;
  ctx.fillText(
    `通关 ${model.cleared}/${model.missions.length} · 星 ${model.totalStars}/${model.missions.length * 3}`,
    viewW / 2,
    l.subtitleY,
  );
  ctx.textAlign = 'left';

  for (const c of l.cards) {
    const m = model.missions[c.index];
    if (!m) continue;
    const r = c.rect;
    const dim = !m.unlocked;
    ctx.fillStyle = dim
      ? 'rgba(255,255,255,0.025)'
      : hoverMission(model.hover, c.index)
        ? 'rgba(93,255,93,0.10)'
        : PANEL_BG;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = dim ? 'rgba(255,255,255,0.10)' : BORDER;
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);

    const pad = 14;
    const row = (r.h - pad * 2 - 2) / 3;
    // 右列星级/锁占 ~96px —— 文本行收窄省略，不压到控件上。
    const textW = r.w - pad - 96;
    // 关卡序号 + 名称（锁定时置灰）。
    ctx.font = `bold ${r.h >= 66 ? 16 : 14}px ${FONT}`;
    ctx.fillStyle = dim ? TEXT_DIM : ACCENT;
    fitText(ctx, `${m.index + 1}. ${m.name}`, r.x + pad, r.y + pad + row, textW);
    // 简报 + 目标行。
    ctx.font = `12px ${FONT}`;
    ctx.fillStyle = TEXT_DIM;
    fitText(ctx, m.briefing, r.x + pad + 26, r.y + pad + row * 2, textW - 26);
    ctx.fillStyle = dim ? TEXT_DIM : TEXT_MAIN;
    fitText(ctx, m.objective, r.x + pad + 26, r.y + pad + row * 3, textW - 26);

    // 右列：已解锁 → 星级；锁定 → 锁 + 未解锁。
    if (m.unlocked) {
      drawStars(ctx, r.x + r.w - 64, r.y + r.h / 2, 9, m.stars);
    } else {
      drawLock(ctx, r.x + r.w - 44, r.y + r.h / 2 - 4, 13);
      ctx.font = `11px ${FONT}`;
      ctx.fillStyle = TEXT_DIM;
      ctx.textAlign = 'center';
      ctx.fillText('未解锁', r.x + r.w - 44, r.y + r.h / 2 + 22);
      ctx.textAlign = 'left';
    }
  }

  button(ctx, l.back, '返回菜单', { hover: model.hover?.kind === 'back' });

  ctx.font = `12px ${FONT}`;
  ctx.fillStyle = TEXT_DIM;
  ctx.textAlign = 'center';
  ctx.fillText('Esc 返回主菜单', viewW / 2, viewH - 24);
  ctx.textAlign = 'left';
}

// --------------------------------------------------------- mission end ----

export interface MissionEndModel {
  won: boolean;
  /** 结算标题，e.g. "任务完成" / "任务失败"。 */
  heading: string;
  /** 副标题行（关卡名 + 用时 / 失败原因）。 */
  lines: readonly string[];
  /** 胜利时 1–3；失败忽略。 */
  stars: number;
  /** 是否存在下一关（决定 下一关 按钮）。 */
  hasNext: boolean;
  hover?: MissionEndButton | null;
}

export function drawMissionEnd(
  ctx: CanvasRenderingContext2D,
  viewW: number,
  viewH: number,
  m: MissionEndModel,
): void {
  const l = missionEndLayout(viewW, viewH, m.won && m.hasNext);
  const cy = l.bandY;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(0, cy - 80, viewW, 236);
  ctx.textAlign = 'center';
  ctx.font = `bold 40px ${FONT}`;
  ctx.fillStyle = m.won ? '#7dff7d' : BAD;
  ctx.fillText(m.heading, viewW / 2, cy - 24);

  if (m.won) drawStars(ctx, viewW / 2, cy + 16, 14, m.stars);

  ctx.font = `14px ${FONT}`;
  ctx.fillStyle = TEXT_MAIN;
  m.lines.forEach((line, i) => {
    ctx.fillText(line, viewW / 2, cy + 46 + i * 20);
  });
  ctx.textAlign = 'left';

  const label: Record<MissionEndButton, string> = {
    next: '下一关',
    retry: m.won ? '重玩' : '重试',
    menu: '返回菜单',
  };
  for (const b of l.buttons) {
    button(ctx, b.rect, label[b.id], { hover: m.hover === b.id });
  }
}
