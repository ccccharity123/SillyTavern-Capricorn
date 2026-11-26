# 摩羯座 CSS 兼容性修复完整版

适用基线：SillyTavern-Capricorn `4.6.0-rc.18-apple-native-hybrid`（GitHub main，appearance.js blob `a5724447f5003e8b3d4571ca15ebaac421f9615c`；now-playing.js blob `ff5fd93576be304866e2318c2df71a1e77f0562f`）。

本包为完整安装包，基于此前保存的 Capricorn_Extension_v4.6.0_rc18_Hybrid.zip 合并 CSS 修复补丁。首次安装时，将 ZIP 解压至酒馆扩展目录的独立摩羯座文件夹，确保 manifest.json、index.js、style.css 位于同一级；已有安装时，先备份原插件与配置，再将全部文件覆盖至原插件目录，重启/刷新酒馆。不修改 manifest 版本号、记忆、播放逻辑或已有本地存储键。不要同时启用摩羯座和声屿独立版。

## 变更
- 复用声屿 v1.2.4 Verified 的 CSS Tree 解析、安全校验、图片失败回退、保存及错误报告实现。
- 将独立播放器标记改为 `data-capricorn-player`，拾忆继续使用 `#shiyi-dock.cap-memory-side`，完整本地主题限定在两个插件区域。
- 保留 CSS 手动粘贴、文件导入、HTTPS URL 导入、原文存储与 100 万 UTF-16 代码单元限制。外链请求仍受宿主浏览器的 CORS、CSP 和混合内容限制。
- 内嵌 SVG 沿用静态元素/属性允许列表；拒绝不安全资源和 @import。

## 实际验证（2026-11-26）
- Node 语法检查：三个修改/新增 JS 文件及 css-tree.js 通过。
- 原始 Natural.docx 提取 CSS（19102 UTF-16 代码单元）完整 AST 解析通过（71 个顶层节点）。
- 将三个内嵌 SVG 地址临时替换为测试 HTTPS 地址后，完整编译通过；验证播放器、拾忆作用域和图片失败声明回退。
- 三个安全样本（@import、javascript:、data:text/html）和容量超限检查通过。
- Chromium 页面加载受到环境限制（ERR_BLOCKED_BY_ADMINISTRATOR），未完成本版浏览器注入、SVG 解码、真实外链请求、保存刷新、移动设备或实际酒馆宿主验证。声屿的历史浏览器报告不等同于本版实际验证。
- 本完整安装包尚未推送 GitHub。原仓库不变。

## 完整打包核对
保留原始 RC18 安装包全部文件，替换 appearance.js、now-playing.js，新增 theme-css.js、vendor 解析器及许可证。本次仅打包和静态核对，不重复执行浏览器测试。
