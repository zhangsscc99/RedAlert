// 建造/生产面板绘制：圆角按钮 + 造价 + 热键角标 + 禁用灰化 + 进度条。
// 风格与 hud.ts 一致（暗底 + 荧光绿描边）。暂未被 main.ts 引用。

import {
  buttonVisual,
  type PanelButton,
} from '../game/panel.ts';

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

const FONT = '11px ui-monospace, Menlo, Consolas, monospace';
const FONT_SMALL = '9px ui-monospace, Menlo, Consolas, monospace';
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
