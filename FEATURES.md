# FEATURES

每条一行，`- [x]` 已完成 / `- [ ]` 待办；`verify:` 里的命令须能通过。

注意：本机 Node 未编译 TypeScript stripping，`node --test` 跑的是
`src/game/*.test.js`（由 `scripts/build-tests.sh` 从 `*.test.ts` 打包生成，
已提交）。改了 `*.test.ts` 后先跑 `bash scripts/build-tests.sh` 再 verify。

## M1

- [x] F001 地图生成确定性（种子可复现，64×64）｜verify: node --test client/src/game/grid.test.js｜risk: low
- [x] F002 地形通行性（水面不可走、越界不可走、中心留空地）｜verify: node --test client/src/game/grid.test.js｜risk: low
- [x] F003 A* 寻路正确性（直线/绕障/不可达返回 null）｜verify: node --test client/src/game/pathfind.test.js｜risk: med
- [x] F004 对角线代价与禁止切角、目标吸附最近可走格｜verify: node --test client/src/game/pathfind.test.js｜risk: med
- [x] F005 单位生成（8 个步兵落在可通行格）｜verify: node --test client/src/game/units.test.js｜risk: low
- [x] F006 右键移动命令只对选中单位生效并沿路径到达｜verify: node --test client/src/game/units.test.js｜risk: med
- [x] F007 点选/框选/Shift 加选/点空地取消｜verify: node --test client/src/game/selection.test.js｜risk: low
- [x] F008 相机平移、锚点缩放限位 0.5x–2x、边界钳制｜verify: node --test client/src/game/camera.test.js｜risk: low
- [x] F009 客户端类型检查零错误｜verify: cd client && npx tsc --noEmit｜risk: low
- [x] F010 构建-部署-健康检查流水线｜verify: bash scripts/ci-deploy.sh && curl -sf http://127.0.0.1:3027/api/health｜risk: med
- [x] F011 生产路径 /redalert/ 返回 200 且含游戏 canvas｜verify: bash -c "curl -sf http://127.0.0.1:3027/redalert/ | grep -q 'canvas id=\"game\"'"｜risk: low
- [x] F012 部署失败时可回退上一版 dist｜verify: bash -n scripts/rollback.sh && bash -n scripts/ci-deploy.sh｜risk: low

## M2（旧占位已并入 F201–F206）

> F101 矿石地形→F201；F102 采集→F202+F302；F103 建筑放置→F203；F104 生产队列→F204+F303。旧复选框删除，避免重复计数。

## M2 并行车道批（2026-11-18 13:15 UTC）

- [x] F201 矿石地形：grid 新增 ORE 地形（不可通行、可采集），generateMap 在中心空地外围撒 4~6 处矿脉，exports isOre/oreTiles，terrain 渲染矿石色｜verify: bash scripts/build-tests.sh && node --test client/src/game/grid.test.js && (cd client && npx tsc --noEmit)｜risk: med
- [x] F202 单位属性表：UnitKind(infantry/harvester/tank) + UNIT_STATS(hp/speed/cost/buildTime/radius/canHarvest) + spawnUnit(kind) 工厂，步兵行为不变｜verify: bash scripts/build-tests.sh && node --test client/src/game/units.test.js && (cd client && npx tsc --noEmit)｜risk: med
- [x] F203 建筑放置：buildings.ts（占地矩形、格子吸附、与水面/已有建筑/越界冲突判定、canPlace/place）｜verify: bash scripts/build-tests.sh && node --test client/src/game/buildings.test.js && (cd client && npx tsc --noEmit)｜risk: med
- [x] F204 经济内核：economy.ts（资金账户、采矿结算、生产队列扣款/出队，纯逻辑无 DOM）｜verify: bash scripts/build-tests.sh && node --test client/src/game/economy.test.js && (cd client && npx tsc --noEmit)｜risk: med
- [x] F205 战斗内核：combat.ts（血量、伤害、射程、冷却、死亡结算，纯函数）｜verify: bash scripts/build-tests.sh && node --test client/src/game/combat.test.js && (cd client && npx tsc --noEmit)｜risk: med
- [x] F206 敌方 AI 状态机：enemyAI.ts（攒矿→造兵→波次进攻，step() 输出指令数组，确定性可测）｜verify: bash scripts/build-tests.sh && node --test client/src/game/enemyAI.test.js && (cd client && npx tsc --noEmit)｜risk: med
- [x] F207 HUD 扩展：资源条、选中单位信息卡、消息提示队列（render/hud.ts）｜verify: (cd client && npx tsc --noEmit) && npm run build -w redalert-client｜risk: low
- [x] F208 选择增强：双击选同类、Ctrl+A 全选、框选顺序稳定（selection.ts）｜verify: bash scripts/build-tests.sh && node --test client/src/game/selection.test.js && (cd client && npx tsc --noEmit)｜risk: low
- [x] F209 相机体验：屏幕边缘滚动 + 平移平滑插值 + 限位不越界（camera.ts）｜verify: bash scripts/build-tests.sh && node --test client/src/game/camera.test.js && (cd client && npx tsc --noEmit)｜risk: low
- [x] F210 存档序列化：save.ts（版本化快照 serialize/parse + 校验，纯逻辑）｜verify: bash scripts/build-tests.sh && node --test client/src/game/save.test.js && (cd client && npx tsc --noEmit)｜risk: low

## M3 并行车道批（2026-11-18 14:20 UTC）— 已全部合并部署（main 90b5d4e，公网 200）

> 现状判断：M2 的内核（矿脉/单位表/建筑/经济/战斗/敌方 AI/存档/HUD/相机）都只是**纯模块**，
> `main.ts` 仍只跑「8 个步兵走来走去」——没有资金、没有建筑、没有敌人、没有胜负，产品层是断的。
> 本批先把缺失的内核补齐（各自独占文件），F301 负责唯一一次 `main.ts`/`index.ts` 接线。

- [x] F301 游戏主循环集成：新增 gameState.ts（tick 聚合 economy/buildings/combat/enemyAI/胜负判定，纯逻辑）+ main.ts/index.ts 唯一接线（资金条、放置 HQ/兵营/矿厂、敌方单位与战斗、胜负结算与重开）｜verify: bash scripts/build-tests.sh && node --test client/src/game/gameState.test.js && (cd client && npx tsc --noEmit) && npm run build -w redalert-client｜risk: med
- [x] F302 矿车采集循环：harvest.ts（矿车 idle→去矿脉→采满→回矿厂→卸货入账 状态机，纯逻辑、可确定性测试）｜verify: bash scripts/build-tests.sh && node --test client/src/game/harvest.test.js && (cd client && npx tsc --noEmit)｜risk: med
- [x] F303 生产与建造队列：production.ts（建筑建造进度、兵营出兵队列、取消退款、并发上限；复用 economy/buildings 不重写）｜verify: bash scripts/build-tests.sh && node --test client/src/game/production.test.js && (cd client && npx tsc --noEmit)｜risk: med
- [x] F304 战争迷雾：fog.ts（单位视野半径、已探明/当前可见两层、逐 tick 更新、格子级 bitmask，纯逻辑）｜verify: bash scripts/build-tests.sh && node --test client/src/game/fog.test.js && (cd client && npx tsc --noEmit)｜risk: low
- [x] F305 战斗特效：game/effects.ts（特效粒子状态机：爆炸/曳光/伤害数字，纯更新逻辑）+ render/effects.ts（Canvas 绘制）｜verify: bash scripts/build-tests.sh && node --test client/src/game/effects.test.js && (cd client && npx tsc --noEmit)｜risk: med
- [x] F306 指令系统：commands.ts（攻击指令/攻击移动/停止/保持阵型/编队 1–9 分配与选中，纯逻辑，衔接 combat）｜verify: bash scripts/build-tests.sh && node --test client/src/game/commands.test.js && (cd client && npx tsc --noEmit)｜risk: med
- [x] F307 电力系统：power.ts（电厂供电、建筑耗电、低电时生产降速）+ buildings.ts 增加 power 建筑定义（只增不改旧签名）｜verify: bash scripts/build-tests.sh && node --test client/src/game/power.test.js && node --test client/src/game/buildings.test.js && (cd client && npx tsc --noEmit)｜risk: med
- [x] F308 地形渲染升级：render/terrain.ts（矿脉晶簇、水岸过渡、草地纹理噪点，预渲染离屏，不引第三方库）｜verify: (cd client && npx tsc --noEmit) && npm run build -w redalert-client｜risk: low
- [x] F309 HUD 深化：render/hud.ts（多选信息卡、生产面板骨架、快捷键提示、消息队列样式；保持 drawHud 旧签名兼容）｜verify: (cd client && npx tsc --noEmit) && npm run build -w redalert-client｜risk: low
- [x] F310 数值平衡表：balance.ts（单位/建筑成本、伤害、波次难度曲线，集中可调 + 一致性校验测试）｜verify: bash scripts/build-tests.sh && node --test client/src/game/balance.test.js && (cd client && npx tsc --noEmit)｜risk: low

## M4 并行车道批（2026-11-18 15:00 UTC）— 产品闭环：让已有内核真正跑起来

> 现状判断：M2/M3 造了 harvest/fog/power/production/commands/effects/save/balance 八个内核，
> `gameState.ts` 只用到了 economy/buildings/combat/enemyAI，`main.ts` 完全没有迷雾、没有特效、
> 没有攻击指令、没有矿车——矿脉是装饰，玩起来仍是「步兵互推」。本批两条接线车道（F401 逻辑层、
> F402 表现层）+ 八条独立模块，先把断掉的产品环补上。

- [x] F401 经济闭环接线：gameState 接 harvest 矿车循环（矿车可训练、自动采矿卸货）+ power 供电（低电降速）+ 矿物入账，保持旧导出签名兼容｜verify: bash scripts/build-tests.sh && node --test client/src/game/gameState.test.js && node --test client/src/game/harvest.test.js && (cd client && npx tsc --noEmit)｜risk: med
- [x] F402 战场表现接线：main.ts/index.ts 接战争迷雾叠加、战斗特效、攻击移动/停止/编队 1-9、HUD 生产面板、鼠标边缘滚屏、暂停与加速（只此一条车道改 main.ts）｜verify: (cd client && npx tsc --noEmit) && npm run build -w redalert-client｜risk: med
- [x] F403 WebAudio 合成音效：client/src/audio/sfx.ts（枪声/爆炸/建造完成/低电警报/胜负，全部振荡器合成，无外部素材，可静音、懒初始化）｜verify: (cd client && npx tsc --noEmit) && npm run build -w redalert-client｜risk: low
- [x] F404 防御建筑：buildings.ts 新增 turret（炮塔，射程/伤害/power 消耗）与 wall（围墙），旧定义与签名不变，canPlace/place 兼容｜verify: bash scripts/build-tests.sh && node --test client/src/game/buildings.test.js && (cd client && npx tsc --noEmit)｜risk: med
- [x] F405 建筑避障寻路：pathfind 新增 findPathAvoiding（把建筑占地当障碍，禁止穿墙，不可达返回 null）｜verify: bash scripts/build-tests.sh && node --test client/src/game/pathfind.test.js && (cd client && npx tsc --noEmit)｜risk: med
- [x] F406 建造/生产面板逻辑：game/panel.ts（底栏按钮布局、命中测试、禁用原因与进度条数值，纯几何无 DOM）+ render/panel.ts 绘制｜verify: bash scripts/build-tests.sh && node --test client/src/game/panel.test.js && (cd client && npx tsc --noEmit)｜risk: low
- [x] F407 存档 v2 与三槽位：save.ts 升级快照（含建筑/敌方/AI/相机/时间，兼容读 v1）+ game/saveload.ts 槽位逻辑（storage 注入，可测）｜verify: bash scripts/build-tests.sh && node --test client/src/game/save.test.js && node --test client/src/game/saveload.test.js && (cd client && npx tsc --noEmit)｜risk: med
- [x] F408 新手引导状态机：game/onboarding.ts（采矿→建兵营→出兵→摧毁敌基地，事件驱动推进、可跳过、步骤高亮文案）｜verify: bash scripts/build-tests.sh && node --test client/src/game/onboarding.test.js && (cd client && npx tsc --noEmit)｜risk: low
- [x] F409 三档难度曲线：balance.ts 增加 difficulty（easy/normal/hard：初始资金、波次间隔、敌方强度倍率）+ 一致性校验｜verify: bash scripts/build-tests.sh && node --test client/src/game/balance.test.js && (cd client && npx tsc --noEmit)｜risk: low
- [x] F410 帧率与实体护栏：game/perf.ts（帧时间 EMA、实体上限、慢帧降级建议、断线判定，纯逻辑）｜verify: bash scripts/build-tests.sh && node --test client/src/game/perf.test.js && (cd client && npx tsc --noEmit)｜risk: low

## M5 并行车道批（2026-11-18 16:10 UTC）— 产品外壳与深度

> 现状判断：M4 已把内核接进主循环（经济/迷雾/特效/面板），但产品外壳仍是「打开即开局」：
> `balance.difficulty` 无任何引用、三槽存档（saveload.ts）没接线、没有设置项，
> 也缺少「再来一局」的理由（战报/战役/回放）。上轮触屏改造（input/gestures.ts + HUD TouchMenu）
> 在 main 上留下未提交且 tsc 报错的半成品，已存到分支 wip/touch-ui，本轮由 F501 单独收口。
> F501 是唯一允许改 `main.ts` / `index.html` / `render/hud.ts` / `input/gestures.ts` 的车道；
> 其余九条各自独占新文件，互不重叠，禁止改 FEATURES.md。

- [x] F501 客户端外壳收口：修掉触屏半成品的 tsc 报错，接线「开始菜单（三档难度）→ 开局 / 继续存档（三槽）/ 设置（静音·网格）」半屏遮罩 UI（唯一改 main.ts、index.html、render/hud.ts、input/gestures.ts）｜verify: (cd client && npx tsc --noEmit) && npm run build -w redalert-client && bash scripts/build-tests.sh && node --test client/src/input/ && node --test client/src/game/｜risk: med
- [x] F502 兵种扩展与克制：新增 game/unitRoles.ts（火箭兵/工程师/侦察兵定义、护甲类型与伤害克制矩阵，纯逻辑可确定性测试），不改 units.ts 旧签名｜verify: bash scripts/build-tests.sh && node --test client/src/game/unitRoles.test.js && (cd client && npx tsc --noEmit)｜risk: low
- [x] F503 建筑升级与出售：新增 game/upgrades.ts（三级升级表、升级耗时与费用、出售退款率、不可升级原因），纯逻辑不碰 buildings.ts 旧签名｜verify: bash scripts/build-tests.sh && node --test client/src/game/upgrades.test.js && (cd client && npx tsc --noEmit)｜risk: med
- [x] F504 修理与工程师维修：新增 game/repair.ts（受损建筑/载具维修队列、工程师占用、费用与速率、可修复判定）｜verify: bash scripts/build-tests.sh && node --test client/src/game/repair.test.js && (cd client && npx tsc --noEmit)｜risk: low
- [x] F505 雷达与侦查脉冲：新增 game/radar.ts（按 tick 周期扫描揭示范围内敌方单位、接触点保留时长、无雷达时降级）｜verify: bash scripts/build-tests.sh && node --test client/src/game/radar.test.js && (cd client && npx tsc --noEmit)｜risk: low
- [x] F506 战报与战绩：新增 game/stats.ts（击杀/建造/采矿/时长统计、结算报告文本、历史最佳记录，storage 注入可测）｜verify: bash scripts/build-tests.sh && node --test client/src/game/stats.test.js && (cd client && npx tsc --noEmit)｜risk: low
- [x] F507 程序化 BGM：新增 audio/music.ts（振荡器+包络生成两段循环 BGM、交叉淡入淡出、音量与静音接口，无外部素材）｜verify: (cd client && npx tsc --noEmit) && npm run build -w redalert-client｜risk: low
- [x] F508 快捷键与指令卡：新增 game/hotkeys.ts（键位表、冲突检测、按上下文过滤可用指令、提示文案数据，纯逻辑）｜verify: bash scripts/build-tests.sh && node --test client/src/game/hotkeys.test.js && (cd client && npx tsc --noEmit)｜risk: low
- [x] F509 战斗回放：新增 game/replay.ts（按 tick 记录指令流、序列化/反序列化、确定性回放校验、快进倍率）｜verify: bash scripts/build-tests.sh && node --test client/src/game/replay.test.js && (cd client && npx tsc --noEmit)｜risk: med
- [x] F510 天气与昼夜：新增 game/weather.ts（雨/沙尘状态机随时间演进，影响视野与移速倍率，可确定性测试）+ render/weather.ts（Canvas 雨丝/暗角绘制）｜verify: bash scripts/build-tests.sh && node --test client/src/game/weather.test.js && (cd client && npx tsc --noEmit)｜risk: low

## M6 并行车道批（2026-11-18 17:45 UTC）— 把孤儿模块接进产品 + 手感深化

> 现状判断（本轮 grep 实测）：M5 造了 upgrades/repair/radar/stats/replay/weather/music/hotkeys/unitRoles/onboarding/panel
> 十一块，但 `grep -c` 在 `main.ts` / `gameState.ts` 里对它们全部为 **0**——功能造好了没上线，玩家一条都用不到；
> 同时已上线的 render/*、combat、harvest、enemyAI 还是 M2 的粗版（无行走动画、无建造进度环、矿车会抢矿、AI 不会撤退）。
> 本批 F601 是**唯一**允许改 `main.ts` / `index.html` / `render/hud.ts` 的车道（接线 hotkeys/radar/weather/music）；
> 其余九条各自独占一个已上线模块的文件，只加功能不改旧签名、不改 FEATURES.md，互不重叠。

- [x] F601 上线触达层接线：main.ts 接 hotkeys（空格暂停、1-9 编队、H 快捷键提示卡）、radar 侦查脉冲（按 tick 扫描、接触点画面上淡出标记、无雷达降级）、weather（雨/沙尘影响视野与移速并叠层渲染）、music（开局 BGM、暂停/静音联动，与 sfx 共存不抢音量）｜verify: bash scripts/build-tests.sh && node --test client/src/game/radar.test.js && node --test client/src/game/weather.test.js && node --test client/src/game/hotkeys.test.js && (cd client && npx tsc --noEmit) && npm run build -w redalert-client｜risk: med
- [x] F602 地形视觉细化：render/terrain.ts 加水岸泡沫线、矿脉晶簇高光与跳动、草地噪点分块、可选网格叠加更克制（保持 drawTerrain/prerenderMap/prerenderGrid 签名）｜verify: (cd client && npx tsc --noEmit) && npm run build -w redalert-client｜risk: low
- [x] F603 单位表现升级：render/units.ts 按 UnitKind 区分外观（步兵/矿车/坦克/火箭兵），加行走摆动动画、朝向、选中圈脉冲、血条与受损变色（drawUnits 签名不变）｜verify: (cd client && npx tsc --noEmit) && npm run build -w redalert-client｜risk: low
- [x] F604 建筑表现升级：render/buildings.ts 加建造脚手架与进度环、受损冒烟/火花、炮塔朝最近敌人转向、等级角标（签名不变）｜verify: (cd client && npx tsc --noEmit) && npm run build -w redalert-client｜risk: low
- [x] F605 迷雾质感：render/fog.ts 边缘柔化、未探索纯黑幕、已探明半透明灰、可见区随 tick 平滑过渡（不重算 fog 逻辑）｜verify: (cd client && npx tsc --noEmit) && npm run build -w redalert-client｜risk: low
- [x] F606 寻路手感：pathfind.ts 加路径平滑（拉直冗余拐点）与单位半径避让，findPath 旧签名与语义不变，新增 findPathSmooth 供单位使用｜verify: bash scripts/build-tests.sh && node --test client/src/game/pathfind.test.js && node --test client/src/game/gameState.test.js && (cd client && npx tsc --noEmit)｜risk: med
- [x] F607 矿车调度：harvest.ts 加矿脉储量与枯竭、多矿车就近分配不抢同一格、回程走 findPathAvoiding 绕建筑、被堵超时自动换矿｜verify: bash scripts/build-tests.sh && node --test client/src/game/harvest.test.js && node --test client/src/game/gameState.test.js && (cd client && npx tsc --noEmit)｜risk: med
- [x] F608 敌方 AI 深度：enemyAI.ts 加侦察试探、集结后进攻、血量低撤退、多兵种搭配与难度缩放（默认行为与现有一致，新行为按参数开启）｜verify: bash scripts/build-tests.sh && node --test client/src/game/enemyAI.test.js && node --test client/src/game/gameState.test.js && (cd client && npx tsc --noEmit)｜risk: med
- [x] F609 战斗深度：combat.ts 加护甲类型与克制（复用 unitRoles 矩阵）、溅射伤害、集火目标保持、射击遮挡判定，纯函数可测，旧导出签名不变｜verify: bash scripts/build-tests.sh && node --test client/src/game/combat.test.js && node --test client/src/game/gameState.test.js && (cd client && npx tsc --noEmit)｜risk: med
- [x] F610 生产队列深度：production.ts 加多兵营并行队列、集结点（rally point）、取消退款按进度折算、升级任务排队（复用 upgrades 表，不改旧签名）｜verify: bash scripts/build-tests.sh && node --test client/src/game/production.test.js && node --test client/src/game/gameState.test.js && (cd client && npx tsc --noEmit)｜risk: med

## M7 并行车道批（2026-11-18 18:25 UTC）— 建筑操作上线 + 内容与手感纵深

> 现状判断（本轮 grep 实测）：`upgrades.ts` / `repair.ts` / `replay.ts` / `onboarding.ts` 在
> `main.ts` 与 `gameState.ts` 里引用数全部为 **0**；玩家能建矿厂/兵营/炮塔，却不能**升级、出售、维修**，
> 建筑一被打就永久残血；结算只有一句话，没有战报，也没有新手引导；唯一玩法是无尽遭遇战，
> 没有关卡、没有老兵成长、敌方 AI 也只会攒钱出步兵。`index.html` 的标题还写着「RedAlert — M1」。
> 本批 F701 是**唯一**允许改 `main.ts` / `index.html` / `render/hud.ts` / `gameState.ts` 的车道；
> 其余九条各自独占文件，只加不改旧签名，禁止改 FEATURES.md。
> F702（战役关卡内核）与 F703（老兵等级内核）本轮只落纯逻辑模块，接线留给下一轮 F801/F802，别当孤儿模块放着不管。

- [x] F701 建筑操作与战报上线：选中己方建筑后 HUD 显示「升级 / 出售 / 维修」三个动作，接 upgrades.ts 三级升级（费用、耗时、完成提示）、出售按建造进度退款、repair.ts 工程师维修队列与扣费；结算画面用 stats.ts 出完整战报（击杀/建造/采矿/时长/历史最佳）；首局桌面端用 onboarding.ts 显示四步引导条（可跳过）；index.html 标题改为「RedAlert — 苏联来袭」｜verify: bash scripts/build-tests.sh && node --test client/src/game/upgrades.test.js && node --test client/src/game/repair.test.js && node --test client/src/game/stats.test.js && (cd client && npx tsc --noEmit) && npm run build -w redalert-client｜risk: med
- [x] F702 战役关卡内核：新增 game/missions.ts（5 关目标定义 destroy/capture/survive/escort、关卡初始资金与敌方编成、目标推进与星评价判定、确定性可测），纯逻辑不碰 main.ts/gameState.ts｜verify: bash scripts/build-tests.sh && node --test client/src/game/missions.test.js && (cd client && npx tsc --noEmit)｜risk: low
- [x] F703 老兵等级内核：新增 game/veterancy.ts（击杀累计经验、新兵/老兵/精英三级、伤害与护甲加成表、升级事件流、可序列化），纯逻辑不改 units.ts/combat.ts｜verify: bash scripts/build-tests.sh && node --test client/src/game/veterancy.test.js && (cd client && npx tsc --noEmit)｜risk: low
- [x] F704 敌方经济与基地：enemyAI.ts 让敌方按资金自建矿厂/兵营/炮塔、多波次扩张、失去建筑后重建、炮塔参与防守、难度参数控制扩张节奏（默认行为与现有测试一致，新行为按参数开启）｜verify: bash scripts/build-tests.sh && node --test client/src/game/enemyAI.test.js && node --test client/src/game/gameState.test.js && (cd client && npx tsc --noEmit)｜risk: med
- [x] F705 单位表现细化：render/units.ts 加脚下投影、受击闪白、阵亡残骸与淡出、移动尘土尾迹、低血抖动（drawUnits 签名不变）｜verify: (cd client && npx tsc --noEmit) && npm run build -w redalert-client｜risk: low
- [x] F706 地形多样化：render/terrain.ts 加土路/石板路纹理、悬崖边缘阴影、随机岩石与草丛装饰、水岸波光（drawTerrain/prerenderMap/prerenderGrid 签名不变，离屏预渲染）｜verify: (cd client && npx tsc --noEmit) && npm run build -w redalert-client｜risk: low
- [x] F707 群体寻路与编队：pathfind.ts 新增 formationSlots（编队目标点分配）与 findPathGroup（软避让代价 + 拥堵降级为逐个 findPathSmooth），旧 findPath/findPathSmooth 签名与语义不变｜verify: bash scripts/build-tests.sh && node --test client/src/game/pathfind.test.js && node --test client/src/game/gameState.test.js && (cd client && npx tsc --noEmit)｜risk: med
- [x] F708 存档 v3：save.ts 快照加入迷雾已探明位图、统计快照、建筑等级与受损状态、老兵经验、天气/雷达种子，兼容读 v1/v2；saveload.ts 三槽位保持旧 API 与旧存档可读｜verify: bash scripts/build-tests.sh && node --test client/src/game/save.test.js && node --test client/src/game/saveload.test.js && node --test client/src/game/gameState.test.js && (cd client && npx tsc --noEmit)｜risk: med
- [x] F709 自适应音频：music.ts 加战斗强度驱动的三段编曲（平静/交战/溃败）无缝切换与音量回退；sfx.ts 加单位应答音（选中/下令/阵亡，振荡器合成、无外部素材）与分组音量｜verify: (cd client && npx tsc --noEmit) && npm run build -w redalert-client｜risk: low
- [x] F710 战斗反馈特效：game/effects.ts 加弹坑残留、残骸粒子、爆炸冲击波环与震屏强度数值，render/effects.ts 绘制（updateEffects/drawEffects 签名不变）｜verify: bash scripts/build-tests.sh && node --test client/src/game/effects.test.js && (cd client && npx tsc --noEmit)｜risk: low

## M8 并行车道批（2026-11-18 19:45 UTC）— 战役模式落地 + 战斗纵深 + 表现层

> 现状判断（本轮 grep 实测）：`missions.ts`（5 关定义、目标推进、星评价）与 `veterancy.ts`
> 在 `main.ts` / `gameState.ts` / `index.ts` 里引用数全为 **0** —— 上一轮造好却没接线的孤儿模块；
> 玩家依旧只有无尽遭遇战，没有关卡、没有目标、没有星级；单位击杀不成长；
> AI 只会攒钱出兵，生产没有科技前置，电力没有实际惩罚；渲染与音频仍偏「程序员 Demo」。
> 本批 F801 是**唯一**允许改 `main.ts` / `gameState.ts` / `render/hud.ts` / `render/menu.ts` / `index.html` 的车道；
> 其余九条各自独占文件，只加不改旧签名（可加可选字段），禁止改 FEATURES.md，禁止互相 import 对方新符号。

- [x] F801 战役模式上线：菜单加「战役」入口与 5 关关卡选择（复用 missions.ts 的 MISSIONS），开局按 MissionDef 布置双方编成与初始资金，游戏中 HUD 显示目标列表与进度、计时与存活/占领提示，达成目标走 updateMission → 胜利结算按 rateMission 出 1–3 星并解锁下一关，失败给出重试；关卡进度与星级存 localStorage；战役与遭遇战互不影响｜verify: bash scripts/build-tests.sh && node --test client/src/game/missions.test.js && (cd client && npx tsc --noEmit) && npm run build -w redalert-client｜risk: med
- [x] F802 老兵成长接入战斗：Unit 加可选 kills/rank 字段（不破坏旧构造），combat.ts 结算击杀时用 veterancy.addKill 累计并按 damageMultiplier/armorMultiplier 生效，晋升记录事件供 UI 取用；新增纯函数 resolveDamage 的等级参数化测试｜verify: bash scripts/build-tests.sh && node --test client/src/game/combat.test.js && node --test client/src/game/veterancy.test.js && node --test client/src/game/units.test.js && (cd client && npx tsc --noEmit)｜risk: med
- [x] F803 敌方 AI 战术纵深：enemyAI.ts 加侦察小队、按玩家编成选克制兵种、集火优先目标、残血撤退回修、按难度分波次增兵；旧导出与默认行为保持一致，新行为由参数开启并补测试｜verify: bash scripts/build-tests.sh && node --test client/src/game/enemyAI.test.js && node --test client/src/game/gameState.test.js && (cd client && npx tsc --noEmit)｜risk: med
- [x] F804 科技前置与建筑功能：production.ts 加科技/建筑前置解锁（无兵营不能出兵、无雷达不能出坦克）、队列优先级与退款规则；buildings.ts 让雷达提供扫描与视野加成、维修厂自动修复邻接载具、建造完成产出一次补给；旧签名不变｜verify: bash scripts/build-tests.sh && node --test client/src/game/production.test.js && node --test client/src/game/buildings.test.js && (cd client && npx tsc --noEmit)｜risk: med
- [x] F805 经济与矿车手感：economy.ts 加资金上限、低资金告警与被动收入节奏；harvest.ts 加矿车排队不打架、矿脉枯竭后自动迁矿、被堵超时换道与满载提示；纯逻辑可测，旧签名不变｜verify: bash scripts/build-tests.sh && node --test client/src/game/economy.test.js && node --test client/src/game/harvest.test.js && (cd client && npx tsc --noEmit)｜risk: med
- [x] F806 电力与视野联动：power.ts 加低电惩罚（生产减速、炮塔充能变慢）与电力缺口分级；fog.ts 加建筑/单位视野半径差异化、雷达扫描短暂揭示、被摧毁后视野收缩；纯逻辑可测｜verify: bash scripts/build-tests.sh && node --test client/src/game/power.test.js && node --test client/src/game/fog.test.js && (cd client && npx tsc --noEmit)｜risk: med
- [x] F807 单位表现再升级：render/units.ts 按兵种加行走循环帧、坦克履带尘与炮塔朝向分离、步兵卧倒/射击火光、矿车满载抖动、选中体显示老兵角标位（读可选 rank），drawUnits 签名不变｜verify: (cd client && npx tsc --noEmit) && npm run build -w redalert-client｜risk: low
- [x] F808 建筑表现再升级：render/buildings.ts 加建造完成闪光与吊装动画、电力不足时窗口变暗、受损分级贴花与裂缝、炮塔待机扫描与开火后坐、雷达碟旋转，签名不变｜verify: (cd client && npx tsc --noEmit) && npm run build -w redalert-client｜risk: low
- [x] F809 地形与天气视觉：render/terrain.ts 加季节色调、道路与建筑地基过渡、矿脉储量可视化；render/weather.ts 让雨雪在地面积水/积雪并影响能见度绘制，保持既有导出签名｜verify: (cd client && npx tsc --noEmit) && npm run build -w redalert-client｜risk: low
- [x] F810 音频层次：audio/music.ts 三段编曲加乐器分层与关卡切换淡入淡出；audio/sfx.ts 加建造/采矿/警报/晋升音与空间化音量衰减，振荡器合成无外部素材｜verify: (cd client && npx tsc --noEmit) && npm run build -w redalert-client｜risk: low

## M9 并行车道批（2026-11-18 21:10 UTC）— 生产系统上线 + 玩法纵深 + 服务端战绩

> 现状判断（本轮 grep 实测）：`game/production.ts`（505 行、33 个导出、科技前置/集结点/多队列/退款规则全套）
> 在 `main.ts` / `gameState.ts` / `render/hud.ts` 里的引用数为 **0** —— 玩家点「训练」走的仍是 gameState 手搓的
> 单队列 `trainUnit`，科技前置、集结点、取消退款这些规则一条也用不到；`server/index.js` 只有 health + 静态托管，
> 打完成就只存在浏览器 localStorage 里，服务端没有任何战绩沉淀；战斗、AI、矿车、寻路、渲染在 M2–M8 的粗版上还能再深一层。
> 本批 F901 是**唯一**允许改 `client/src/main.ts` / `client/src/game/gameState.ts` / `client/src/render/hud.ts` / `client/index.html` 的车道；
> 其余九条各自独占列出的文件，只加不改旧导出签名，禁止改 FEATURES.md，禁止互相 import 对方新增符号。

- [x] F901 生产系统上线：用 game/production.ts 取代 main.ts 手搓的 trainUnit —— 多兵营并行队列、科技/建筑前置（无兵营不出兵、无雷达不出坦克）、右键设集结点（rally point）并让新兵自动前往、取消按进度退款、升级任务排队；HUD 生产面板显示队列进度条与「前置未满足」原因。唯一允许改 main.ts / gameState.ts / render/hud.ts / client/index.html｜verify: bash scripts/build-tests.sh && node --test client/src/game/production.test.js && node --test client/src/game/gameState.test.js && (cd client && npx tsc --noEmit) && npm run build -w redalert-client｜risk: med
- [x] F902 战斗纵深：combat.ts 加压制值（被持续火力压制时命中与移速下降、脱离后恢复）、溅射伤害随距离衰减、集火目标保持与失效切换、对地与对空伤害权重；纯函数可测，旧导出签名不变｜verify: bash scripts/build-tests.sh && node --test client/src/game/combat.test.js && node --test client/src/game/gameState.test.js && (cd client && npx tsc --noEmit)｜risk: med
- [x] F903 敌方 AI 战术：enemyAI.ts 加骚扰小队（绕侧翼偷袭矿车与矿厂）、被打退后回防再反击、按玩家兵力动态调整波次规模、0–3 级难度曲线；旧导出与默认行为保持一致，新行为由参数开启并补测试｜verify: bash scripts/build-tests.sh && node --test client/src/game/enemyAI.test.js && node --test client/src/game/gameState.test.js && (cd client && npx tsc --noEmit)｜risk: med
- [x] F904 经济与矿车手感：economy.ts 加分矿与富矿收入梯度、资金上限与低资金告警节奏；harvest.ts 加矿车避堵换道、矿脉枯竭自动迁矿、满载优先回程、多矿车就近分配；纯逻辑可测，旧签名不变｜verify: bash scripts/build-tests.sh && node --test client/src/game/economy.test.js && node --test client/src/game/harvest.test.js && (cd client && npx tsc --noEmit)｜risk: med
- [x] F905 寻路与编队：pathfind.ts 加地形代价分层（道路更快、水面与岩石绕行）、动态拥堵避让、formationSlots 支持宽/窄两种阵型；旧 findPath / findPathSmooth 签名与语义不变并补测试｜verify: bash scripts/build-tests.sh && node --test client/src/game/pathfind.test.js && node --test client/src/game/gameState.test.js && (cd client && npx tsc --noEmit)｜risk: med
- [x] F906 单位表现再细化：render/units.ts 加坦克履带压痕、步兵开火后坐与枪口烟、老兵角标（读可选 rank）、阵亡残骸停留与淡出、低血抖动；drawUnits 签名不变｜verify: (cd client && npx tsc --noEmit) && npm run build -w redalert-client｜risk: low
- [x] F907 建筑表现再细化：render/buildings.ts 加电力不足时窗口变暗与灯光闪烁、建造吊装与完成闪光、受损分级裂缝贴花、炮塔开火后坐与待机扫描、雷达碟旋转；导出签名不变｜verify: (cd client && npx tsc --noEmit) && npm run build -w redalert-client｜risk: low
- [x] F908 地形氛围：render/terrain.ts 与 render/textures.ts 加季节色调、土路与建筑地基过渡、矿脉储量可视化（枯竭变暗）、水岸波光与岸线阴影；drawTerrain / prerenderMap / prerenderGrid 签名不变｜verify: (cd client && npx tsc --noEmit) && npm run build -w redalert-client｜risk: low
- [x] F909 触屏与小地图：input/minimap.ts 加拖拽持续平移与框选跳转、敌方来袭红点告警与闪烁；input/gestures.ts 加双指缩放、长按框选、双击居中，导出签名不变｜verify: bash scripts/build-tests.sh && node --test client/src/input/ && (cd client && npx tsc --noEmit)｜risk: med
- [x] F910 战绩榜服务端：server/index.js 加 POST /api/score（入参校验 + 原子写 data/scoreboard.json + 简单限流）与 GET /api/leaderboard（按关卡/总分排序取前 20），不改端口 3027、不改静态托管与隧道；新增纯 Node 单测覆盖排序与校验，不引入新依赖｜verify: (cd client && npx tsc --noEmit) && node --test server/scoreboard.test.js｜risk: med
