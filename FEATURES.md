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
