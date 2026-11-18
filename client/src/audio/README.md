# SFX (WebAudio, 纯代码合成)

`createSfx()` 返回 `{ play, setEnabled, enabled, masterVolume, dispose }`；
AudioContext 懒初始化，首次用户手势时创建。同名音效 50ms 内限流。
接入：`const sfx = createSfx(); sfx.play('rifle')`。
- rifle: 步兵开火 / cannon: 坦克炮击 / explosion: 单位或建筑爆炸
- build: 建筑就绪 / alarm: 遭袭警报 / fanfare: 胜利 / defeat: 失败
