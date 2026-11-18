// 建造/生产面板：纯几何逻辑，无 DOM。
// 布局规则：底部横栏、按钮等宽，放不下则向上换行；
// 与小地图（右下角，占 MINIMAP_FOOTPRINT 见方）不得重叠。

// 数值复制自 render/hud.ts 的 MINIMAP_SIZE / MINIMAP_MARGIN。
export const MINIMAP_SIZE = 144;
export const MINIMAP_MARGIN = 12;
/** 小地图含边距的占地（正方形边长）。 */
export const MINIMAP_FOOTPRINT = MINIMAP_SIZE + MINIMAP_MARGIN * 2;

export type PanelItemKind = 'unit' | 'building';

export interface PanelItem {
  id: string;
  label: string;
  cost: number;
  hotkey: string;
  kind: PanelItemKind;
  enabled: boolean;
  /** 禁用原因（资金不足/缺前置建筑等），透传给 UI 显示。 */
  reason?: string;
  /** 生产进度 0..1，仅生产中有意义。 */
  progress01?: number;
}

export interface PanelButton {
  x: number;
  y: number;
  w: number;
  h: number;
  item: PanelItem;
}

export interface PanelLayoutOpts {
  /** 单个按钮宽度（默认 120）。 */
  buttonW?: number;
  /** 单个按钮高度（默认 44）。 */
  buttonH?: number;
  /** 按钮间距（默认 6）。 */
  gap?: number;
  /** 距屏幕边缘间距（默认 8）。 */
  margin?: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 小地图占地矩形（含外边距）。 */
export function minimapFootprint(
  viewW: number,
  viewH: number,
): { x: number; y: number; w: number; h: number } {
  return {
    x: viewW - MINIMAP_FOOTPRINT,
    y: viewH - MINIMAP_FOOTPRINT,
    w: MINIMAP_FOOTPRINT,
    h: MINIMAP_FOOTPRINT,
  };
}

/**
 * 底栏布局：从左往右排；当前行若与小地图纵向重叠，
 * 右界收至小地图左缘，排满则向上另起一行。
 * 返回顺序与 items 一致。
 */
export function layoutPanel(
  items: readonly PanelItem[],
  viewW: number,
  viewH: number,
  opts: PanelLayoutOpts = {},
): PanelButton[] {
  const bw = opts.buttonW ?? 120;
  const bh = opts.buttonH ?? 44;
  const gap = opts.gap ?? 6;
  const margin = opts.margin ?? 8;
  const map = minimapFootprint(viewW, viewH);
  const rightLimit = viewW - margin;

  const out: PanelButton[] = [];
  let x = margin;
  let bottom = viewH - margin;

  for (const item of items) {
    for (;;) {
      const rowTop = bottom - bh;
      const overlapsMapY = bottom > map.y && rowTop < map.y + map.h;
      const maxRight = overlapsMapY
        ? Math.min(rightLimit, map.x - gap)
        : rightLimit;
      if (x + bw <= maxRight) {
        out.push({ x, y: rowTop, w: bw, h: bh, item });
        x += bw + gap;
        break;
      }
      // 当前行放不下：若已经贴着左缘仍放不下（视口过窄），放弃该按钮；
      // 否则向上换行重试。
      if (x <= margin) {
        out.push({ x, y: rowTop, w: bw, h: bh, item });
        x += bw + gap;
        break;
      }
      x = margin;
      bottom = rowTop - gap;
    }
  }
  return out;
}

/** 命中测试：返回按钮的 item.id，未命中返回 null。 */
export function hitTestPanel(
  layout: readonly PanelButton[],
  x: number,
  y: number,
): string | null {
  for (const b of layout) {
    if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) {
      return b.item.id;
    }
  }
  return null;
}

export interface ButtonVisual {
  /** 底色（CSS 颜色字符串）。 */
  fill: string;
  /** 描边色。 */
  border: string;
  /** 文字色。 */
  text: string;
  /** 进度条进度 0..1；无进度时为 null。 */
  progress01: number | null;
  /** 是否灰化（禁用）。 */
  disabled: boolean;
}

/** 按钮视觉数据：暗底 + 荧光绿描边，与 HUD 风格一致；禁用灰化。 */
export function buttonVisual(item: PanelItem): ButtonVisual {
  const disabled = !item.enabled;
  return {
    fill: disabled ? 'rgba(20, 24, 18, 0.7)' : 'rgba(10, 14, 8, 0.72)',
    border: disabled ? 'rgba(120, 130, 118, 0.35)' : 'rgba(93, 255, 93, 0.55)',
    text: disabled ? '#6b7a68' : '#cfe8c9',
    progress01:
      item.progress01 === undefined ? null : clamp01(item.progress01),
    disabled,
  };
}
