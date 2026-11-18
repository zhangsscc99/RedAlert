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

- [ ] F501 客户端外壳收口：修掉触屏半成品的 tsc 报错，接线「开始菜单（三档难度）→ 开局 / 继续存档（三槽）/ 设置（静音·网格）」半屏遮罩 UI（唯一改 main.ts、index.html、render/hud.ts、input/gestures.ts）｜verify: (cd client && npx tsc --noEmit) && npm run build -w redalert-client && bash scripts/build-tests.sh && node --test client/src/input/ && node --test client/src/game/｜risk: med
- [ ] F502 兵种扩展与克制：新增 game/unitRoles.ts（火箭兵/工程师/侦察兵定义、护甲类型与伤害克制矩阵，纯逻辑可确定性测试），不改 units.ts 旧签名｜verify: bash scripts/build-tests.sh && node --test client/src/game/unitRoles.test.js && (cd client && npx tsc --noEmit)｜risk: low
- [ ] F503 建筑升级与出售：新增 game/upgrades.ts（三级升级表、升级耗时与费用、出售退款率、不可升级原因），纯逻辑不碰 buildings.ts 旧签名｜verify: bash scripts/build-tests.sh && node --test client/src/game/upgrades.test.js && (cd client && npx tsc --noEmit)｜risk: med
- [ ] F504 修理与工程师维修：新增 game/repair.ts（受损建筑/载具维修队列、工程师占用、费用与速率、可修复判定）｜verify: bash scripts/build-tests.sh && node --test client/src/game/repair.test.js && (cd client && npx tsc --noEmit)｜risk: low
- [ ] F505 雷达与侦查脉冲：新增 game/radar.ts（按 tick 周期扫描揭示范围内敌方单位、接触点保留时长、无雷达时降级）｜verify: bash scripts/build-tests.sh && node --test client/src/game/radar.test.js && (cd client && npx tsc --noEmit)｜risk: low
- [ ] F506 战报与战绩：新增 game/stats.ts（击杀/建造/采矿/时长统计、结算报告文本、历史最佳记录，storage 注入可测）｜verify: bash scripts/build-tests.sh && node --test client/src/game/stats.test.js && (cd client && npx tsc --noEmit)｜risk: low
- [ ] F507 程序化 BGM：新增 audio/music.ts（振荡器+包络生成两段循环 BGM、交叉淡入淡出、音量与静音接口，无外部素材）｜verify: (cd client && npx tsc --noEmit) && npm run build -w redalert-client｜risk: low
- [ ] F508 快捷键与指令卡：新增 game/hotkeys.ts（键位表、冲突检测、按上下文过滤可用指令、提示文案数据，纯逻辑）｜verify: bash scripts/build-tests.sh && node --test client/src/game/hotkeys.test.js && (cd client && npx tsc --noEmit)｜risk: low
- [ ] F509 战斗回放：新增 game/replay.ts（按 tick 记录指令流、序列化/反序列化、确定性回放校验、快进倍率）｜verify: bash scripts/build-tests.sh && node --test client/src/game/replay.test.js && (cd client && npx tsc --noEmit)｜risk: med
- [ ] F510 天气与昼夜：新增 game/weather.ts（雨/沙尘状态机随时间演进，影响视野与移速倍率，可确定性测试）+ render/weather.ts（Canvas 雨丝/暗角绘制）｜verify: bash scripts/build-tests.sh && node --test client/src/game/weather.test.js && (cd client && npx tsc --noEmit)｜risk: low
