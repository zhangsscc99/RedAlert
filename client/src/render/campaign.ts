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
  /** 列数：viewW ≥ TWO_COL_MIN_W 两列，否则一列。 */
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
/** 双列断点：780 宽的小横屏也要放下 2×2 = 每页 4 张卡。 */
const TWO_COL_MIN_W = 720;
const BTN_H = 52;
const BTN_GAP = 14;

const inRect = (r: Rect, x: number, y: number): boolean =>
  x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/**
 * 关卡卡网格：宽屏（≥720）两列、窄屏一列；行高随可用高度伸缩，
 * 最低 64px。放不下时按页展示 —— cards 只含当前页，pageCount /
 * offsetY / pager 供调用方做翻页或滚动。`count` 注入而不是读
 * MISSIONS，保证布局函数纯几何。780×380 下为 2×2 = 每页 4 张。
 */
export function campaignLayout(
  viewW: number,
  viewH: number,
  count: number,
  page = 0,
): CampaignLayout {
  const cols = viewW >= TWO_COL_MIN_W ? 2 : 1;
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
  // 返回/翻页钮锚在满页网格底缘（而非当前页卡数底缘）—— 翻页时位置不跳。
  const gridBottom = offsetY + rows * cardH + (rows - 1) * CARD_GAP;
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

/** 单行截断（纯函数）：超宽时尾部省略号，`measure` 注入便于 node 测试。 */
export function clampLine(
  text: string,
  maxW: number,
  measure: (s: string) => number,
): string {
  if (measure(text) <= maxW) return text;
  let t = text;
  while (t.length > 0 && measure(`${t}…`) > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

/**
 * 贪心折行（纯函数）：按可用宽度 maxW 折行，CJK 任意处可断；
 * 最多 maxLines 行，放不下的内容在最后一行尾部省略号。
 * `measure` 注入字号对应的 measureText，便于 node --test 无 canvas 断言。
 */
export function wrapText(
  text: string,
  maxW: number,
  measure: (s: string) => number,
  maxLines = 2,
): string[] {
  const lines: string[] = [];
  const chars = [...text];
  let cur = '';
  let i = 0;
  while (i < chars.length && lines.length < maxLines) {
    const ch = chars[i]!;
    if (ch === '\n') {
      lines.push(cur);
      cur = '';
      i++;
      continue;
    }
    if (cur !== '' && measure(cur + ch) > maxW) {
      lines.push(cur);
      cur = '';
      continue; // 该字符留到下一行重试
    }
    cur += ch;
    i++;
  }
  const overflowed = i < chars.length;
  if (lines.length < maxLines && cur !== '') lines.push(cur);
  if (overflowed && lines.length > 0) {
    // 截断标记不可省：末行恰满也要尾部省略号。
    let t = lines[lines.length - 1]!;
    while (t.length > 0 && measure(`${t}…`) > maxW) t = t.slice(0, -1);
    lines[lines.length - 1] = `${t}…`;
  }
  return lines;
}

/** fillText capped at maxW — overlong strings ellipsize instead of bleeding. */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
): void {
  ctx.fillText(clampLine(text, maxW, (s) => ctx.measureText(s).width), x, y);
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
  /** 已通关者的最佳用时文案（e.g. "3:24"）；无记录时省略不画。 */
  bestTime?: string;
  /** 未解锁卡片的解锁条件；缺省推导为「通关关卡 N 解锁」。 */
  unlockHint?: string;
}

export interface CampaignModel {
  missions: readonly MissionCardModel[];
  /** 已通关数 / 总星数，副标题一行。 */
  cleared: number;
  totalStars: number;
  /** 当前页（多页时）；缺省第 0 页。 */
  page?: number;
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
  const l = campaignLayout(viewW, viewH, model.missions.length, model.page ?? 0);

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

  const measure = (s: string): number => ctx.measureText(s).width;

  for (const c of l.cards) {
    const m = model.missions[c.index];
    if (!m) continue;
    const r = c.rect;
    const dim = !m.unlocked;
    ctx.fillStyle = dim
      ? 'rgba(255,255,255,0.02)'
      : hoverMission(model.hover, c.index)
        ? 'rgba(93,255,93,0.10)'
        : PANEL_BG;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = dim ? 'rgba(255,255,255,0.10)' : BORDER;
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);

    const pad = 14;
    const side = 92; // 右栏：星级+用时 / 锁，文本行避开不重叠。
    const textX = r.x + pad;
    const textW = Math.max(80, r.w - pad * 2 - side);
    const indent = 20;
    const bodyW = textW - indent;

    // 正文行（卡高 ≥82 给 3 行，否则 2 行）：锁定卡首行写解锁条件，
    // 目标文案按可用宽度折行（≤2 行，超出省略）；空出行补一行简报。
    ctx.font = `12px ${FONT}`;
    const maxBody = r.h >= 82 ? 3 : 2;
    const hint = dim
      ? clampLine(
          m.unlockHint ?? (m.index > 0 ? `通关关卡 ${m.index} 解锁` : '未解锁'),
          bodyW,
          measure,
        )
      : null;
    const objCap = Math.max(1, Math.min(2, maxBody - (hint ? 1 : 0)));
    const objLines = wrapText(m.objective, bodyW, measure, objCap);
    const body: { text: string; color: string }[] = [];
    if (hint) body.push({ text: hint, color: 'rgba(255,217,77,0.6)' });
    if (body.length + objLines.length < maxBody) {
      body.push({ text: clampLine(m.briefing, bodyW, measure), color: TEXT_DIM });
    }
    for (const t of objLines) body.push({ text: t, color: dim ? TEXT_DIM : TEXT_MAIN });

    // 名称行 + 正文行整体垂直居中。
    const nameSize = r.h >= 66 ? 15 : 14;
    const lineH = 14.5;
    const blockH = nameSize + body.length * lineH;
    let cy = r.y + Math.max(6, (r.h - blockH) / 2) + nameSize / 2;
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${nameSize}px ${FONT}`;
    ctx.fillStyle = dim ? TEXT_DIM : ACCENT;
    fitText(ctx, `${m.index + 1}. ${m.name}`, textX, cy, textW);
    cy += nameSize / 2 + lineH / 2;
    ctx.font = `12px ${FONT}`;
    for (const row of body) {
      ctx.fillStyle = row.color;
      ctx.fillText(row.text, textX + indent, cy);
      cy += lineH;
    }

    // 右栏：已解锁 → 星级(+最佳用时)；锁定 → 锁 + 未解锁。
    const rcx = r.x + r.w - 46;
    if (m.unlocked) {
      const starY = m.bestTime ? r.y + r.h / 2 - 8 : r.y + r.h / 2;
      drawStars(ctx, rcx, starY, r.h >= 78 ? 8.5 : 8, m.stars);
      if (m.bestTime) {
        ctx.font = `10px ${FONT}`;
        ctx.fillStyle = TEXT_DIM;
        ctx.textAlign = 'center';
        ctx.fillText(clampLine(`最佳 ${m.bestTime}`, side, measure), rcx, r.y + r.h / 2 + 13);
        ctx.textAlign = 'left';
      }
    } else {
      drawLock(ctx, rcx, r.y + r.h / 2 - 5, 12);
      ctx.font = `10px ${FONT}`;
      ctx.fillStyle = TEXT_DIM;
      ctx.textAlign = 'center';
      ctx.fillText('未解锁', rcx, r.y + r.h / 2 + 13);
      ctx.textAlign = 'left';
    }
    ctx.textBaseline = 'alphabetic';
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
  const lineMaxW = viewW - 48;
  const measure = (s: string): number => ctx.measureText(s).width;
  m.lines.slice(0, 3).forEach((line, i) => {
    ctx.fillText(clampLine(line, lineMaxW, measure), viewW / 2, l.objectiveY + i * l.lineGap);
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
