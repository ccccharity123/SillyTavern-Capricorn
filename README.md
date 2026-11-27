# 摩羯座 Capricorn RC23.1

适用于已有 RC22.1 ContextFix 的更新，也可作为完整扩展安装。以 RC22.1 ContextFix 完整包补全 RC23 覆盖包中的原有模块，再合入 RC23 新玩法、布景、物件和界面。

## 安装

1. 备份当前 Capricorn 扩展目录。将本 ZIP 完整解压到该目录。首次安装时在宿主的第三方扩展路径创建 Capricorn 目录。
2. 确认 `manifest.json`、`index.js`、`style.css` 和 `theater/` 直接位于同一级。RC23 样式已合入 `style.css`，安装只需要这一份清单样式表。
3. 刷新酒馆，在聊天补全预设页面导入并选中 `Capricorn_Preset_v0.8.8_RC23.1.json`。
4. 查看摩羯座设置中的「全局隐藏正则」状态。宿主接受规则后，可刷新或重显聊天检查导演规划的显示效果。已有手动规则和禁用状态会被保留。
5. 体验剧场时，将 `theater-examples/` 里的完整文本粘贴到单独的助手消息。见 [剧场协议与关卡](THEATER-PROTOCOL.md)。

## 变更

- 保留 RC23 的 `talk` 对话回放、`views` 多视角、使用背包线索的推理板、多阶段路线、18 种物件和八个通用布景。沿用旧 v1/v2、专属构图、主题和存档。
- 预设以 v0.8.7 ContextFix 为底，只更新版本标记及自动／手动剧场条目。导演规则继续只采用紧邻本轮的助手楼完整规划；缺失就从已发生事实继续，不沿用已失效候选。计划和剧场均不作为摘要、随层档案和角色认知的事实。保留 ID、顺序、启用状态和模型参数。
- 清理仍由 `capricornPrepareGeneration` 调用，位置在拾忆准备之后。在确认索引化提示词数组与原消息独立、可修改之后替换提示词条目。正常、续写、重生成和重新生成切换版本使用宿主当轮消息。续写尾条按前缀保留。孤立反引号按正文处理，未闭合的 Markdown 围栏保留围栏内内容。无法满足安全条件时跳过。
- 导演规划隐藏使用宿主全局正则，将规则配置为仅 Markdown 显示和助手消息。已有等效规则不会重复安装；规则被禁用、同 ID 冲突、接口不可用或保存回调报告失败时提供对应提示。宿主的防抖保存没有持久化回执，界面仅报告保存请求和当前配置。
- 本轮修改 RC23 覆盖内容中的 `context-clean.js`、`regex-global.js`、`manifest.json`、`THEATER-PROTOCOL.md`，新增本说明并输出完整配套预设。原 `index.js`、拾忆、声屿、主题库与生成生命周期保持 RC22.1 完整包版本。RC23 的样式、玩法代码和 08–16 示例全部保留。附件中的独立预览和基准 HTML 属于开发工具。

## 验证

- **静态与 Node**。插件 JavaScript 语法、ZIP 成员及相对导入检查通过。当前 16 个原有示例和 5 段预设示例可解析。验证了未知参数跳过、引用保护、围栏边界、剧场与导演候选隔离、正则去重、禁用与冲突提示及保存失败回退。
- **Chromium 模拟宿主**。通过原 `index.js` 启动拾忆、声屿、CSS 主题库与剧场。演练正常、续写、重生成和生成新切换版本的拦截入口。用拾忆探针确认先读取原提示词内容，原聊天保持不变。模拟了仅显示规则与保存接口，确认规划仍在提示词里。操作了现成的 13–16 关及旧 v2 雨夜观测台，验证对话分页、多视角切换、推理板失败重试及三站解锁。
- **尚未实测**。真实 SillyTavern／TauriTavern 的安装、服务器持久化、第三方正则组合、外部模型请求及 iPhone 真机。已对照官方实现核实提示词构造、全局设置字段和仅 Markdown 规则的适用范围。[官方生成器](https://github.com/SillyTavern/SillyTavern/blob/release/public/script.js#L4152-L4225) · [宿主上下文](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/st-context.js) · [正则引擎](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/extensions/regex/engine.js#L325-L335)
