# SFX (WebAudio, 纯代码合成)

`createSfx()` 返回 `{ play, unitAck, unitOrder, unitDeath, setGroupVolume, setEnabled, enabled, masterVolume, dispose }`；
AudioContext 懒初始化，首次用户手势时创建。同名音效 50ms 内限流，应答音 90ms。
接入：`const sfx = createSfx(); sfx.play('rifle')`。
- rifle: 步兵开火 / cannon: 坦克炮击 / explosion: 单位或建筑爆炸（combat 组）
- build: 建筑就绪 / alarm: 遭袭警报 / fanfare: 胜利 / defeat: 失败（ui 组）
- unitAck(kind): 选中应答 / unitOrder(kind): 下令确认 / unitDeath(kind): 阵亡（voice 组）
- kind ∈ 'infantry' | 'tank' | 'harvester' | 'turret'；`setGroupVolume('ui'|'combat'|'voice', v)` 分组调音量
- 无 AudioContext（如 Node 测试环境）时所有接口静默无异常

# BGM (adaptive)

`createMusic(ac)` 的 `battle` 曲目分三层编曲，共享同一循环时钟，
`setIntensity(0..1)` 按战斗强度用增益节点原地交叉淡入淡出（不重建节点图）：
- 低强度 calm：低音铺底 + 稀疏琶音
- 中强度 combat：加入打击乐与十六分音符 ostinato + 主旋律
- 高强度 rout：失谐长音垫 + 低通滤波，听感降速
`setMuted(true/false)` 不丢失已存音量；`menu` 曲目为常开 base 层，不受 intensity 影响。
