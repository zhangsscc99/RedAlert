# RedAlert 视觉与声音规范（ART-SPEC，强制）

> 本文件是**所有自动化开发轮次的硬约束**。每一轮改动只要碰到 `client/src/render/**`、
> `client/src/audio/**`、`client/index.html` 或任何颜色/尺寸字面量，必须先读本文件。
> 与本文件冲突的实现一律视为不合格，不得勾选 FEATURES。

## 0. 三条不可协商的红线

1. **绝不使用《红色警戒》/《命令与征服》/EA 的任何原作素材**（美术、音乐、音效、单位名、阵营名、UI 文案）。
   参考只允许看它的**交互设计**，不允许取任何像素。
2. **只允许 CC0 素材入库**。需要署名的（CC-BY / CC-BY-SA）除非同时更新 `CREDITS.md`
   与游戏内「关于」页，否则不许用。GPL 引擎的随附素材（OpenRA 等）**一律禁止**。
3. **不引入渲染引擎**（Phaser / PixiJS / Three / Babylon 都不行）。渲染层是 Canvas2D + 程序化绘制 + 图集贴图。

## 1. 调色板：DawnBringer 32（DB32）

唯一合法调色板。所有颜色**必须**从 `client/src/render/palette.ts` 命名 token 取值，
禁止在绘制代码里写 `#rrggbb` / `rgb()` 字面量（图集贴图除外）。

```ts
// palette.ts 必须导出的结构（示意，命名可按语义微调但必须集中管理）
export const DB32 = {
  black: '#000000', navy: '#222034', darkred: '#45283c', maroon: '#663931',
  brown: '#8f563b', orange: '#df7126', gold: '#d9a066', yellow: '#fbf236',
  lime: '#99e550', green: '#6abe30', forest: '#37946e', teal: '#4b692f',
  deepgreen: '#323c39', slate: '#4b5bab', blue: '#4fa4f1', sky: '#6dc2ca',
  cyan: '#76f6d8', white: '#ffffff', silver: '#d9d9d9', grey: '#a9a9a9',
  shadow: '#595652', plum: '#76428a', purple: '#ac3232', pink: '#d77bba',
} as const;

// 语义 token（绘制代码只用这些）
export const THEME = {
  bgVoid: DB32.black,
  terrainGrass: [DB32.deepgreen, DB32.teal, DB32.forest],   // 3 档 ramp
  terrainOre:   [DB32.maroon, DB32.brown, DB32.gold],
  terrainWater: [DB32.navy, DB32.slate, DB32.blue],
  teamPlayer:   DB32.green,      // 我方：绿系
  teamEnemy:    DB32.purple,     // 敌方：红紫系（与 DB32.purple #ac3232 区分用 plum+purple 组合）
  uiPanel:      'rgba(34,32,52,0.82)',  // navy 半透明
  uiBorder:     DB32.sky,
  uiText:       DB32.silver,
  uiTextDim:    DB32.grey,
  uiAccent:     DB32.yellow,
  hpFull:       DB32.lime,
  hpMid:        DB32.yellow,
  hpLow:        DB32.purple,
} as const;
```

**材质 ramp 规则**：每个可着色材质固定 3 档（暗/中/亮），档间**同时改变明度与色相**
（暗部偏蓝紫、亮部偏黄白），不允许只是"同色加减亮度"。

## 2. 素材来源与规格

### 2.1 主素材包（唯一允许的默认来源）
- **Kenney Sci-Fi RTS**（CC0）— `https://kenney.nl/assets/sci-fi-rts`，120+ sprites：
  单位、建筑、地形、环境物件。
- 备选（同样 CC0）：**Kenney Tower Defense Top-Down**、**Screaming Brain Studios Sci-Fi Essentials Kit**。
- 落地位置：`client/public/assets/kenney-scifi-rts/`（原始 PNG）+ `client/public/assets/atlas/`
  （生成的图集 PNG + JSON）。**原始包里的 License.txt 必须一并复制保留。**

### 2.2 贴图规格
- 统一 tile 基准：**32×32 px**，单位 24×24 或 32×32，建筑按 32 的整数倍。
- 图集：单张 PNG ≤ 2048×2048，JSON 用 TexturePacker 兼容格式（`frames[].frame{x,y,w,h}`）。
- 缩放用 `imageSmoothingEnabled = false`（像素风），DPR 缩放只能整数倍。
- **必须有降级路径**：贴图缺失/加载失败时回落到现有的程序化绘制，游戏不许白屏。

### 2.3 署名
CC0 不需要署名，但**关于页仍要列出素材包名称与链接**（诚实，也方便替换）。

## 3. 可读性硬指标（比"好看"更重要）

在 **390×844（手机竖屏）** 下必须满足，且作为验收项：

1. **100ms 内可区分**：我方单位 / 敌方单位 / 建筑 / 资源点，四者轮廓或色系必须不同，
   只靠颜色区分不够，必须**形状也不同**（圆/方/菱形/三角）。
2. 单位与地形的最小对比度：单位外沿必须有 **1.5px 深色描边**（`DB32.black` 或 `navy`）。
3. 任何可点击元素 ≥ **44×44 CSS px**；文字 ≥ **14 CSS px**（DPR 换算后）。
4. 血条：宽度随单位宽度，高度 ≥ 3px CSS，颜色随血量走 `hpFull→hpMid→hpLow`。
5. 选中态：脉冲光环（周期 1.2s，正弦缩放 1.0–1.15），**不改变单位本体颜色**。

## 4. 视觉层次（渲染顺序固定）

```
1 地形底图（3 档 ramp + 确定性噪声）
2 地形装饰（矿脉、碎石、草丛；只读，不参与碰撞）
3 建筑阴影 → 建筑本体 → 建造进度条
4 单位阴影 → 单位本体 → 朝向指示 → 血条 → 选中环
5 特效层（开火火花 / 爆炸 / 移动标记 / 命中数字）
6 迷雾层（半透明黑，边缘柔和）
7 HUD（面板 / 小地图 / 操作栏 / 指令条）
8 遮罩层（开始菜单 / 引导 / 暂停 / 复盘）
```

- **阴影**：统一向东偏移 `(2, 2)` 世界像素，`rgba(0,0,0,0.35)`，不许用 `shadowBlur` 做全局阴影（性能）。
- **特效**：全部使用预分配对象池，**每帧零新增分配**（这是性能红线，`game/perf.ts` 里有断言）。

## 5. 声音（WebAudio 程序化，零素材文件）

全部通过 `client/src/audio/sfx.ts`（已存在，扩展它，不要新建第二套）：

| 事件 | 声音设计 | 时长 |
|---|---|---|
| 选中单位 | 短促方波 880Hz → 660Hz，衰减 60ms | ≤80ms |
| 下达移动 | 三角波 220Hz 单脉冲 | ≤60ms |
| 开火 | 白噪声 burst + 低通 1200Hz 扫频 | ≤120ms |
| 命中 | 噪声 80ms + 220Hz 方波点击 | ≤100ms |
| 单位死亡 | 低频正弦 160→60Hz 下滑 + 噪声尾 | ≤350ms |
| 建筑完成 | 三音符上行（523/659/784，各 80ms） | ≤300ms |
| 采到矿 | 高频短 ping 1320Hz | ≤50ms |
| 警报（被攻击） | 双音交替 440/330，重复 2 次 | ≤500ms |

规则：
- **必须由用户手势解锁**（第一次 pointerdown 时 `AudioContext.resume()`，已有实现）。
- 同时最多 **6 个** 同类音效并发，超出丢弃最旧的。
- 设置里「静音」开关必须立即生效并持久化（`localStorage`）。
- 不允许任何 `<audio>` 标签或音频文件下载。

## 6. "好玩"的可验证标准（每轮自检）

每轮开发结束，用自己的手机或 390×844 模拟器回答这四个问题，答不出"是"就不算完成：

1. 打开后 3 秒内，玩家知道该干什么（有提示或明确目标）。
2. 点一个单位、下一个命令，**有视觉和听觉反馈**（不是静默）。
3. 打起来时，能一眼看出"谁在打谁、谁快死了"。
4. 连续操作 2 分钟，手不需要找按钮（拇指热区内完成 90% 操作）。

## 7. 与 FEATURES 的关系

- 任何新功能条目，如果产出可见画面，verify 里必须含一条**截图或像素断言**，
  或引用本文件 §3 的可读性指标。
- 只做逻辑、无可见产出的条目（如纯算法），不要求美术合规，但**不许破坏**本文件约束。
