# Capricorn 开发记录

## 4.3.0-dev.10

- 实测候选版：冻结运行时代码，保留 dev.9 功能。
- Node 回归 53/53；30k/50k/100k 标注语料 3/3，每组 11/11 命中。宿主夹具自检通过。
- Chromium 两项测试因 ERR_BLOCKED_BY_ADMINISTRATOR 阻塞，真实宿主及手机未验收。
- 新增实测指南及测试日志。

## 4.3.0-dev.9

- 注入阶段按已知剧情时间与完整摘要正文去重，保护星标和不同时间记录。复用候选列表，保留剩余预算再分配。
- Node 回归 53/53 通过，新增三项去重及预算测试。未执行真实宿主或设备测试。

## 4.3.0-dev.4

- 单独人物名触发有界场景扩查，即使已命中远期摘要；优先选择同时匹配人物和至少两个额外场景词的远期摘要。
- Node 回归 44/44 通过；未执行真实宿主或设备测试。

## 4.3.0-dev.3

- 短输入仅命中近期摘要或人物档案时，允许一次场景扩查，避免过早停止远期召回。保留原预算与直接远期命中优先策略。
- Node 回归 42/42 通过（基线 41/41）；本轮未运行真实宿主及设备测试。

## 4.3.0-dev.2

- 显式叙事时态用于区分当前、回忆、未来与假设。倒叙保留时间和来源，当前字段与知情范围保持由当前剧情更新。
- 未结伏笔按标题、场景和相关度有界召回。已回收或已废弃的状态优先于旧记录，预算紧张时优先保留当前字段再省略历史。
- 唯一人物别名可关联只写正式姓名的远期摘要。共用别名保留为搜索线索。
- 单聊角色视角可以按聊天临时启用，只检索准确匹配角色获知的事实和自己的看法。该部分走本地即时检索。
- 新增 1,000 和 5,000 楼标注语料回归，以及 30,000 至 100,000 楼的本地扩展语料测试。修复声屿播放诊断引用已移除变量的问题。

## 4.3.0-dev.1

- 超长模式先检索当前输入，线索有限时扩查有限的可见场景。明确命中的远期摘要优先纳入既有预算，诊断显示本轮走过的路径。
- 新增结构化角色认知和公开范围校验，混合检索只注入明确公开的结构化事实。随层档案与摘要预设同步更新，保留已经安装的预设内容。
- 备份恢复等待宿主保存请求并复核聊天范围。旧版逐条摘要按明确的聊天归属补入。
- 修正双模式回归的断言，自检可识别模式卡住和误用 100 楼档案。设备与宿主实测留到最终阶段。

## 4.2.1-preview.2

- 拦截器在交给宿主之前复核聊天范围和生成版本。过期请求终止，较早的异步错误和 dry run 不会恢复当前请求正在使用的预设开关。
- 动态记忆估算预算同时受用户设置和宿主提供的本轮上下文上限约束，诊断显示实际使用的上限。
- 增加生成生命周期回归，验证来源切换、事件重绑和销毁。
- 增加两个独立捕获文件的批量断言，覆盖简约→超长→简约、A→B→A 及跨档串忆。实测仍等待能运行两个宿主的环境。

## 4.2.1-preview.1

- 生成拦截器负责单次动态注入，聊天事件与后台扫描更新来源及派生索引。
- 双模式共享来源档案。废弃分支退出生成上下文，同时保留原摘要及手动修订。
- 增加按聊天的备份和索引重建。恢复按数据范围验证，优先保留当前内容。
- 增加播放会话隔离及任务诊断，统一群聊和单聊的作用域，优化时间线连接及分页。
- 本地候选构建仅作回归和双宿主验收使用。可验证状态见 `TEST_PLAN.md` 和 `KNOWN_ISSUES.md`。

## 4.2.0-alpha

- 导入用户提供的完整 ZIP，基线 Git 标签为 `v4.2.0-alpha`。
- ZIP SHA-256 为 `d4ae96613b6b7068bb393ff1d664d110b68b29084554f9cc64f676a2e5cdb3a3`。
- 基线 40 个 ES 模块通过语法检查，9 项 Node 回归通过。基线历史记录见 `README.md`。

## 4.3.0-dev.5
- 人名独立命中不再强制锚定缺乏场景证据的历史摘要；保留普通排序候选。
- 增加召回证据等级与设置诊断显示；新增两项回归测试，Node 46/46 通过。

## 4.3.0-dev.6
- Adaptive budget uses 65% baseline, 85% expanded recall, 100% strong historical anchor (query length may raise the floor; never above ceiling).
- Oversized high-evidence sentences receive a bounded verbatim window before weaker short sentences.

## v4.3.0-dev.7
- Oversized excerpt: prioritize joint keyword evidence and map normalized offsets to source code points.
- Regression: 49/49 Node tests passed.

## v4.3.0-dev.8
- Bounded context-only third retrieval pass for weak or limited evidence; no new factual anchor.
- Node regression: 50/50 passed.

## 4.3.1-dev.1
Explicit Chat Completion preset manager, save/reselect verification, individual and bulk removal, insertion before native post-history instructions. Real host verification pending.

## 4.3.1-dev.2
- 读取排序分组和条目，手动选择前后或首尾，插入并启用保存；支持平面及分组排序。
- 未知宿主结构拒绝写入；提供复制提示词回退。iOSTT 实机未验证。

## 4.3.1-dev.3
- 支持包装式预设读取、结构诊断及 JSON 副本导出。原生 iOSTT 写入接口仍待实机确认。
