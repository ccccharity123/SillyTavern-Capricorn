# 摩羯座 Capricorn RC20 小剧场更新

插件以提供的 RC19 Theater Render Fix2 为母版，保留原扩展入口和旧剧场标签。RC19 母版代码中可运行的旧玩法为翻牌、逐格揭示和滑动探索。场景、手机、物件组合和随机事件由这次更新在同一入口新增。

## 安装和更新

1. 备份用户数据与当前摩羯座插件目录。退出 SillyTavern 页面或停止当前实例。
2. 将 ZIP 内全部文件解压到当前实例第三方扩展目录的 **同一个** `Capricorn/` 文件夹。单用户常见位置为 `data/default-user/extensions/Capricorn/`。多用户或移动宿主以原 RC19 的实际安装位置为准。目录内应直接看到 `manifest.json`、`index.js` 和 `theater/`。已有安装可在原目录覆盖，避免同时启用 RC19 和 RC20 两份。
3. 重新打开 SillyTavern，刷新页面，在扩展列表确认「摩羯座 · Capricorn」已启用，再到聊天补全预设页面导入并选中 `Capricorn_Preset_v0.8.3.json`。
4. 用现有旧楼层检查翻牌或滑动，再将 `theater-examples/` 中的一段内容原样粘到助手消息验证新版。完整示例和协议见 [THEATER-PROTOCOL.md](THEATER-PROTOCOL.md)。预设只影响之后生成的回复。

## 文件清单

- 新增 `theater/` 模块文件。包括 `parser.js`、`payload.js`、`state.js`、`interactions.js`、`components.js`、`renderer.js`、`storage.js`、`legacy.js`、`dom.js`、`raw-dom.js`、`theme.js` 和 `diagnostics.js`。
- 新增 `theater-example-01-scene.txt`、`02-phone.txt`、`03-random.txt`、`04-order.txt`、`THEATER-UPDATE.md`、`THEATER-PROTOCOL.md`。
- 修改 `theater.js`、`style.css`、`manifest.json`。在 `memory.js`、`traces.js`、`scene.js` 和 `music.js` 增加剧场载荷隔离。
- 配套预设只更新现有剧场条目的名称和内容，保留条目标识、启用状态、顺序和所有其他条目。

## 兼容与范围

保留拾忆侧边栏及历史记录、声屿播放器和 BGM 识别、主题库和用户 CSS、原状态栏和正文、摘要、结构化档案和记忆、角色卡论坛及其他扩展标签。拾忆数据库结构沿用 RC19。动态正文通常 1800～2600 汉字，精简 1100～1700，长篇沉浸 2600～3800，沿用原叙事视角、人设、世界书和导演逻辑。

进度留在当前浏览器的剧场专用存储。优先使用宿主消息 UUID 或唯一发送时间，缺失或重名时回退楼层索引。旧翻牌、揭示和滑动读取原 RC19 键，后续操作写入新命名空间。删除楼层时按当前聊天清理新存档；旧 RC19 键为无索引的散列，只在重置该旧剧场时针对性清除。存档失败时使用当页内存并显示提示。剧场外观覆盖只对本浏览器的小剧场生效。

首轮游戏提供密码、顺序／时间还原和多选。配对、找不同、专用线索拼接与记忆翻牌暂未实现。录音、相册和音乐使用虚构文字内容；物件中的拼图可通过顺序模块搭建。没有 iPhone、Android 或 TauriTavern 真机认证，宿主自定义主题与第三方脚本组合仍需在实际配置下验证。

## 实际验证

- 对插件内全部 JavaScript 执行了 `node --check`。
- 用 Node 检查了 v1/v2、引号和转义换行、字符串中的结束标签、循环和缺失引用、档案标签隔离、四例可完成路径、骰子与多选，以及存档失败时的内存回退。
- 用无头 Chromium 与模拟 SillyTavern 宿主运行了四例。在 320 CSS 像素的触控视口检查了剧场宽度、减少动态效果和外观覆盖。验证了合起、刷新、跨聊天恢复、重置、旧存档读取、编辑、切换生成版本、删除后清理，以及原 `index.js` 入口启动和卸载。入口测试关闭了声屿和拾忆模块，保留的模块未作整套运行回归。
- 对照 RC19 压缩包核对保留文件，校验 ZIP 成员、CRC、入口和本地脚本引用。比较预设 JSON，确认 42 个条目的 ID 与顺序沿用，差异仅为剧场条目的名称与提示词。
