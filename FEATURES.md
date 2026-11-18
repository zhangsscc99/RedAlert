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

## M2（待办示例，下一轮展开）

- [ ] F101 矿石地形生成与渲染｜verify: node --test client/src/game/grid.test.js｜risk: low
- [ ] F102 矿车采集-回程循环｜verify: node --test client/src/game/economy.test.js｜risk: med
- [ ] F103 建筑放置（格子吸附/占地判定）｜verify: node --test client/src/game/buildings.test.js｜risk: med
- [ ] F104 兵营生产队列与资金扣款｜verify: node --test client/src/game/economy.test.js｜risk: med
