# Capricorn 已知问题

- 桌面联合验收需要 SillyTavern 1.19.1、TauriTavern 2.4.0 热修复版和酒馆助手。需要记录实际运行的原生 WebView、浏览器、宿主和助手版本。原生走查及宿主出站请求结果见测试记录。
- 宿主和设备适配及实机验收按用户安排留到最终。当前的测试结果来自本地 Node 和宿主夹具。
- TauriTavern 的后台 Agent 与检查点恢复需要独立验收。宿主的 dry run 跳过生成拦截器，生成预览与最终请求可能不同。
- 算法压力测试以文档数计，50,000 楼完整聊天和 100,000 楼极限承载能力仍需分别在宿主实测。当前检索预算由算法估算，精确模型 Token 预算仍需与各宿主的本地 tokenizer 集成并计量。
- 当前短输入的置信度来自词法命中。扩大复杂叙事和语义覆盖仍需更多语料。显式叙事时态依赖正确的随层档案标记，缺少标记的旧档按当前语境兼容处理。
- 角色视角默认使用公开认知。临时授权仅限准确匹配的单聊角色。原聊天正文、用户原有的摘要和世界书仍可携带私密剧情，需单独核对其可见范围。
- 安卓 Chrome／Via、iOS 和桌面原生媒体体验需要设备实测，含后台播放、旋转、拖动和键盘切换。
- 本基线含九种摘要、留痕和 BGM 提示词变体及隐藏正则。完整摩羯座预设尚未提供。
- 旧版本已删除的摘要可从仍存的原楼层、回收记录或外部备份找回。旧版按楼层保存的正文隐藏记录缺少来源指纹，需在宿主中核对并恢复。若回滚至 `4.2.0-alpha`，请使用升级前的数据副本，旧版校验可能删除当前分支之外的摘要。

- 短输入扩查仍依赖词法证据，可能增加一次本地检索；真实设备延迟尚未测量。

- 单独人物名扩查使用词法证据（至少两个额外词），并非语义理解；设备耗时待测。

- dev.5 证据等级为词法启发式，不是校准概率；弱证据候选仍可进入普通排序。第三层深度召回尚未实现，真实宿主及手机未验证。

- dev.6: budget ratios are heuristics, not measured model token counts; excerpt offsets use normalized matching and may drift for unusual Unicode. Real host/device performance remains unverified.

- dev.7: joint window selection is lexical, caps occurrences at 64 per term, and per-code-point normalization does not fully handle combining sequences. Real device tests pending.

- dev.8: third pass remains lexical; may add one retrieval latency. Real host/device validation pending.

- dev.9 去重仅覆盖相同时间和规范化正文的摘要；时间标签可能不准确，未实现跨类型语义去重或摘录级去重。

- dev.10: Chromium 本地页面访问被管理员策略阻止；仅允许备份后的副本实测，不能视为正式稳定版。

- dev.2: iOSTT 预设读写接口仍待实机确认；不保证未知预设结构。
