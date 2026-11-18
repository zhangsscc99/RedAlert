// 战役界面：关卡选择卡 + 任务结算（星级/下一关/重玩/返回菜单）。
// 与 menu.ts 同一约定 —— 纯几何(layout+hit)与 canvas 绘制分离，命中测试
// 可在 node --test 下无 DOM 运行。图形一律 canvas 绘制，无外部素材。

import type { Rect } from '../game/index.ts';

// ------------------------------------------------------------ geometry ----

export type CampaignHit = { kind: 'mission'; index: number } | { kind: 'back' };

export interface CampaignLayout {
  titleY: number;
  subtitleY: number;
  /** 当前页可见的卡片；index 为全局关卡序号。 */
  cards: { index: number; rect: Rect }[];
  back: Rect;
  /** 当前页（0 起，已钳制到 [0, pageCount)）。 */
  page: number;
  /** 总页数；>1 时调用方应提供翻页/滚动入口。 */
  pageCount: number;
  /** 每页卡片数（rows × cols）。 */
  perPage: number;
  /** 列数：viewW ≥ 900 两列，否则一列。 */
  cols: number;
  /** 第一行卡片顶缘 y —— 按页/滚动绘制时的网格原点。 */
  offsetY: number;
  /** 翻页按钮；不可翻向该方向时为 null（pageCount ≤1 时两者皆 null）。 */
  pager: { prev: Rect | null; next: Rect | null };
}

export type MissionEndButton = 'next' | 'retry' | 'menu';

export interface MissionEndLayout {
  /** 结算横幅（深色带）的垂直中心。 */
  bandY: number;
  /** 深色带高度，随内容伸缩。 */
  bandH: number;
  /** 标题（任务完成/失败）基线 y。 */
  headingY: number;
  /** 星级排中心 y —— 绘制星级用，保证不与目标文案重叠。 */
  starsY: number;
  /** 第一行说明文案基线 y；后续行 +lineGap。 */
  objectiveY: number;
  /** 说明文案行距。 */
  lineGap: number;
  buttons: { id: MissionEndButton; rect: Rect }[];
}

const CARD_GAP = 12;
const CARD_MIN_H = 64;
const CARD_MAX_H = 84;
const BTN_H = 52;
const BTN_GAP = 14;

const inRect = (r: Rect, x: number, y: number): boolean =>
  x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/**
 * 关卡卡网格：宽屏（≥900）两列、窄屏一列；行高随可用高度伸缩，
 * 最低 64px。放不下时按页展示 —— cards 只含当前页，pageCount /
 * offsetY / pager 供调用方做翻页或滚动。`count` 注入而不是读
 * MISSIONS，保证布局函数纯几何。
 */
export function campaignLayout(
  viewW: number,
  viewH: number,
  count: number,
  page = 0,
): CampaignLayout {
  const cols = viewW >= 900 ? 2 : 1;
  const totalW = Math.min(viewW - 32, cols === 2 ? 1080 : 620);
  const w = (totalW - CARD_GAP * (cols - 1)) / cols;
  const x0 = (viewW - (w * cols + CARD_GAP * (cols - 1))) / 2;
  const titleY = Math.round(viewH * 0.11);
  const subtitleY = titleY + 28;
  // 网格顶缘不能压到副标题（小视口 0.22·h 会挤上来）。
  const offsetY = Math.max(Math.round(viewH * 0.22), subtitleY + 14);
  const bh = viewH < 480 ? 40 : BTN_H;
  // 给返回按钮（兼翻页行）预留 bh + 上下空隙，其余高度均分给卡片行。
  const avail = Math.max(CARD_MIN_H, viewH - offsetY - bh - CARD_GAP * 3 - 16);
  const need = Math.max(1, Math.ceil(count / cols));
  const rows = Math.max(
    1,
    Math.min(need, Math.floor((avail + CARD_GAP) / (CARD_MIN_H + CARD_GAP))),
  );
  const cardH = Math.min(
    CARD_MAX_H,
    Math.max(CARD_MIN_H, (avail - CARD_GAP * (rows - 1)) / rows),
  );
  const perPage = rows * cols;
  const pageCount = Math.max(1, Math.ceil(count / perPage));
  const cur = Math.min(Math.max(0, page), pageCount - 1);
  const start = cur * perPage;
  const visible = Math.min(count - start, perPage);
  const cards = Array.from({ length: Math.max(0, visible) }, (_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      index: start + i,
      rect: {
        x: x0 + col * (w + CARD_GAP),
        y: offsetY + row * (cardH + CARD_GAP),
        w,
        h: cardH,
      },
    };
  });
  const rowsUsed = Math.max(1, Math.ceil(Math.max(0, visible) / cols));
  const gridBottom =
    visible > 0 ? offsetY + rowsUsed * cardH + (rowsUsed - 1) * CARD_GAP : offsetY;
  const backY = Math.min(viewH - bh - 12, gridBottom + CARD_GAP * 1.5);
  const back: Rect = { x: (viewW - 200) / 2, y: backY, w: 200, h: bh };
  // 翻页钮贴着返回钮左右排，只在可翻方向出现；命中走 campaignPageHit。
  const pw = 72;
  const pager = {
    prev:
      cur > 0
        ? { x: Math.max(8, back.x - CARD_GAP - pw), y: back.y, w: pw, h: bh }
        : null,
    next:
      cur < pageCount - 1
        ? {
            x: Math.min(viewW - pw - 8, back.x + back.w + CARD_GAP),
            y: back.y,
            w: pw,
            h: bh,
          }
        : null,
  };
  return { titleY, subtitleY, cards, back, page: cur, pageCount, perPage, cols, offsetY, pager };
}

export function campaignHit(l: CampaignLayout, x: number, y: number): CampaignHit | null {
  for (const c of l.cards) {
    if (inRect(c.rect, x, y)) return { kind: 'mission', index: c.index };
  }
  if (inRect(l.back, x, y)) return { kind: 'back' };
  return null;
}

/** 翻页命中测试：'prev' | 'next' | null；与 campaignHit 互不抢点。 */
export function campaignPageHit(
  l: CampaignLayout,
  x: number,
  y: number,
): 'prev' | 'next' | null {
  if (l.pager.prev && inRect(l.pager.prev, x, y)) return 'prev';
  if (l.pager.next && inRect(l.pager.next, x, y)) return 'next';
  return null;
}

/**
 * 结算屏：标题 → 星级 → 说明文案 → 按钮 自上而下排布，整体在视口内
 * 垂直居中；小屏（<480 高）压缩行距与按钮高，保证 380px 高也不溢出。
 * 按钮行锚在内容下缘与视口底之间，绝不与文案重叠。
 */
export function missionEndLayout(
  viewW: number,
  viewH: number,
  next: boolean,
): MissionEndLayout {
  const ids: MissionEndButton[] = next ? ['next', 'retry', 'menu'] : ['retry', 'menu'];
  const compact = viewH < 480;
  const gap = viewW < 480 ? 10 : 16;
  const bw = Math.max(
    96,
    Math.min(170, (viewW - 64 - gap * (ids.length - 1)) / ids.length),
  );
  const bh = compact ? 40 : 48;
  const totalW = ids.length * bw + (ids.length - 1) * gap;
  const x0 = (viewW - totalW) / 2;
  const lineGap = compact ? 18 : 20;
  const starGap = compact ? 24 : 30;
  const maxLines = 3; // lines 由调用方给，布局按上界预留。
  // 内容总高：标题升部 ~34 + 星距 + 星半径 14 + 文案块 + 间距 + 按钮。
  const contentH = 34 + starGap + 14 + 30 + lineGap * (maxLines - 1) + 20 + bh;
  const top = Math.max(8, Math.round((viewH - contentH) / 2));
  const headingY = top + 34;
  const starsY = headingY + starGap;
  const objectiveY = starsY + 30;
  const buttonsY = Math.min(
    objectiveY + lineGap * (maxLines - 1) + 20,
    viewH - bh - 12,
  );
  const bandH = buttonsY + bh + 16 - top;
  return {
    bandY: Math.round(top + bandH / 2),
    bandH,
    headingY,
    starsY,
    objectiveY,
    lineGap,
    buttons: ids.map((id, i) => ({
      id,
      rect: { x: x0 + i * (bw + gap), y: buttonsY, w: bw, h: bh },
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
  if (l.pageCount > 1) {
    if (l.pager.prev) button(ctx, l.pager.prev, '‹ 上一页');
    if (l.pager.next) button(ctx, l.pager.next, '下一页 ›');
    ctx.font = `11px ${FONT}`;
    ctx.fillStyle = TEXT_DIM;
    ctx.textAlign = 'center';
    ctx.fillText(`${l.page + 1}/${l.pageCount}`, viewW / 2, l.back.y - 8);
    ctx.textAlign = 'left';
  }

  ctx.font = `12px ${FONT}`;
  ctx.fillStyle = TEXT_DIM;
  ctx.textAlign = 'center';
  ctx.fillText('Esc 返回主菜单', viewW / 2, viewH < 480 ? viewH - 8 : viewH - 24);
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

  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(0, l.bandY - l.bandH / 2, viewW, l.bandH);
  ctx.textAlign = 'center';
  ctx.font = `bold ${viewH < 480 ? 30 : 40}px ${FONT}`;
  ctx.fillStyle = m.won ? '#7dff7d' : BAD;
  ctx.fillText(m.heading, viewW / 2, l.headingY);

  if (m.won) drawStars(ctx, viewW / 2, l.starsY, 14, m.stars);

  ctx.font = `14px ${FONT}`;
  ctx.fillStyle = TEXT_MAIN;
  m.lines.forEach((line, i) => {
    ctx.fillText(line, viewW / 2, l.objectiveY + i * l.lineGap);
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
