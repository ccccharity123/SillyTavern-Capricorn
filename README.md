# 摩羯座 Capricorn

当前开发版本为 `4.3.0-dev.2`，由 `4.2.1-preview.2` 继续开发。安装目录的根部应直接包含 `manifest.json`。拾忆依赖酒馆助手，请使用单独的测试存档试装。安装、测试和发布状态见 [测试计划](TEST_PLAN.md) 和 [已知问题](KNOWN_ISSUES.md)。

## v1.7 Alpha 更新

全屏播放器、LRC 同步歌词及翻译、播放队列调整。歌词需新版网关，使用 /music/lyric?id=歌曲ID；封面取色受跨域限制，失败时使用默认渐变。尚未真机测试。

# 摩羯座 Extension 1.1 Alpha

前端扩展源码，依赖酒馆助手在主页面暴露原有 API。尚未真机测试。

## 安装
备份声屿音乐库及拾忆世界书、聊天变量，停用两个旧全局脚本。将本目录全部文件上传到自己的 Git 仓库根目录，再在 TauriTavern 扩展管理粘贴仓库地址安装。保留酒馆助手扩展。没有发布公共仓库。

## 数据
保留 sound_isle_v01_library 和聊天变量 shiyi_v01，沿用原有世界书命名及角色歌单标识，不主动迁移或删除。

## 测试
检查统一入口、记忆审核、世界书切换、歌单继承、BGM 收录、直链播放。时序和设置暂时打开拾忆原有页面，未实现音乐时间轴合并。网易云登录及高音质尚未接入。共享轮询为初步实现，记忆异步操作可能回退到原始消息读取。

## 1.1
统一容器内嵌原模块面板；外观可跟随系统或手动选择（音乐内部保留深色样式）。设置页可打开拾忆设置。原数据键不变。尚未真机验证；仍依赖酒馆助手主页面 API。


## v1.2 Alpha
时序页按当前聊天的楼层合并已归档世界书记忆与角色歌单中首次收录的歌曲来源。读取实时世界书内容；手动刷新，切换聊天自动刷新。已有授权直链可点击播放，无音源则进入声屿。历史重复歌曲只保留首次来源，不推断缺失来源。仍依赖酒馆助手接口，未真机测试，未接入网易云登录。

## v1.3 Alpha
设置新增自动审核/收录开关及统一备份。备份包含全局音乐库、外观、开关、当前聊天拾忆变量与世界书条目；恢复仅替换音乐库和外观，不自动写回世界书或聊天变量。备份含私人剧情和音源地址，请勿公开。仍需酒馆助手；未接入网易云。

## v1.4 私人音乐服务
设置中输入 HTTPS 服务根地址及访问密钥，点击连接检测。地址保存在本机，密钥仅在页面内存中，不进入备份。检测最长 60 秒，可取消并手动重试。此版本仅验证网关连接，不提供网易云登录、搜索或播放。

## v1.5 登录
使用配套 v1.5 网关，在设置中输入地址和密钥，生成二维码并使用网易云 App 扫码确认。单手机可能需要另一屏幕。会话仅保存在服务端内存。尚未进行真实扫码、真机测试；不含在线搜歌播放。 


## v1.6
启用网易云自动匹配并填写访问密钥。只发送歌曲名称、歌手和歌曲 ID；唯一精确匹配自动关联，其他版本可手动选择。播放时请求完整授权音源，按返回格式与音质筛选，不持久化在线音源。真实上游、iOS 播放和会员权限尚未联调。若异步请求后系统禁止播放，请再次点击播放。


## v1.8 Alpha 移动端优化
- 收起时可拖动统一灵动岛，位置独立保存；展开面板固定于安全区域。
- 前台扫描间隔 4 秒，隐藏页面暂停轮询，返回时刷新；仍保留全历史扫描以识别旧楼编辑。
- 在线请求使用 AbortController 计时兼容方案；音频报错后点击播放重新获取音源，尽量恢复进度。
- 清理媒体会话控制和移动端监听。后台播放受 iOS 宿主限制，未验证。
- 网关协议未改变，继续使用 v1.7 网关。

## 1.8.2 Alpha
播放加载超时、实际播放失败降级、取消加载、全屏状态和可复制诊断。保留原网关和本地存储。需在实际设备验证。


## v2.0 Alpha.1
声屿顶部入口直接打开音乐，拾忆使用独立右侧标签。保留原有记忆逻辑、音乐服务、存储键及统一备份。无需更新网关。

## v2.1 Alpha
拾忆侧边栏直接展示已归档摘要时间轴；支持结构化时间、标题、摘要及旧格式。按楼层读取原消息 BGM，重复歌曲可关联多个节点。缺失原消息时仅回退首次收录来源。管理与设置折叠。声屿移除时序入口。无需更新网关。未真机验证。

## v2.2 Alpha
Requires gateway v1.10. Cloud library refreshes on opening; private creation, rename, add/remove tracks, delete owned ordinary playlists. No automatic role upload yet. Real upstream behavior requires testing. Keep existing environment and encrypted session file. Back up gateway before replacing. Do not test deletion on important playlists.

## v2.3 Alpha
角色私密原声带：云端曲库内创建或绑定，按账号及角色保存关联，每120秒增量添加已匹配歌曲，不自动删除。播放记忆：恢复队列及歌曲，点击播放后尝试恢复进度。沿用网关1.10。真实设备及网易云联机测试待完成。

## 2.3.1
云端曲库 → 管理导入：不导入、选择性导入、全部导入；按网关及网易云 UID 保存。新建歌单与已绑定原声带始终显示。取消导入仅隐藏，不删除云端数据。网关无需升级。

## v2.4 光与纸
声屿设置顶部可选玻璃、磨砂、实色，原有外观选项控制日夜。拾忆独立日夜与纸张主题。自定义 CSS 为两个声明编辑器（不输入选择器、大括号或外部资源），例如侧栏 `--note-width: 360px; --note-bg: #f5eee1;`，便签 `--note-card: #fff8dc; --note-radius: 8px;`。本地保存，可恢复默认 CSS。无需更新网关。CSS 模拟材质，非原生 iOS API。实际设备视觉及兼容性待测试。

## v2.5 留白
基于用户 Alpha1，保留材质与纸张主题。播放/曲库分离，歌曲操作折叠，拾忆外观与 CSS 仅在拾忆菜单内。网关与数据键不变。

## 2.5.2 Alpha
修复脚本转义与截断，恢复基础样式，新增余音 · 银蓝手账主题。

## 2.5.3 Alpha
灵动岛直达播放器，三档尺寸按钮切换，音量常驻，共用主题。曲库与设置关闭后返回播放器。尺寸本地记忆。

## v2.5.4 Alpha
本地原创几何 SVG 控件，参考统一细线风格；未下载或打包 Lucide 官方资源。播放器、曲库快捷操作和拾忆入口统一图标，保留文字管理操作。

## 2.6.1 Alpha
新增切换聊天时音乐跟随、精简主题选择、专辑背景及封面设置。自动播放受系统限制。保留旧记忆逻辑。

### v2.6.2 流光
- 官方 Phosphor Core 2.1.1 CDN SVG（Light / Fill），加载失败保留本地图标；非离线内置官方库。
- 双层专辑背景预加载及 720ms 交叉渐变。
- 音量独立于过渡增益，切歌淡出 320ms、淡入 650ms，暂停与恢复也采用淡变。实际设备可能限制媒体音量控制。

## 2.6.3
专辑背景双层 1200ms 过渡；音量拖动保护。原生音量不可写时，尝试已授权跨域音源的 Web Audio 增益；不支持时使用系统音量键。实际客户端兼容性待测试。

## 2.6.4
封面容器自定义、跨域取色尝试与模糊封面回退、iOS Web Audio 优先并在加载失败时回退。跨域音源仍可能只支持系统音量。

## 2.6.5 Alpha
独立角色/聊天检测，等待聊天消息稳定后切换剧情音乐，取消旧音源请求的播放权限；优先读取当前上下文原始聊天。

## v2.6.6 聆听
最大屏默认同步歌词，缩小封面，歌词独立滚动，底部保留播放控制；点击歌词跳转，手动滚动暂缓自动跟随。保留原有主题及其他模块。

## 2.6.7
无图标灵动岛，材质联动、封面三色渐变；聊天事件监听及当前聊天 ID 优先，历史歌单回退。跨域取色失败回退主题。尚未实机验证。

## 2.7 私域 Alpha
默认本地模式，不自动连接共享网关。在线模式允许音乐接口，完整模式允许账号和歌单接口。手动音源及远程封面仍会联网，本地模式不是全局网络沙箱。图标改用已有本地备用 SVG（非官方 Phosphor）。旧凭证和世界书不删除。网关 1.11 删除音源诊断日志；部署平台和上游仍可能记录请求。退出会话后可清除本地凭证。未进行实机安全测试。

## 2.7.1
音质胶囊可选择网易云音质，保存偏好并按所选档位向下尝试，切换时尝试恢复进度。更新本地 SVG 控件，不增加外部请求。

## v2.7.5 Alpha
移动端优先原生 HTMLAudioElement，避免 Web Audio 后台挂起；iOS 使用系统音量键。系统媒体会话同步歌曲、进度和控制，不发送角色或聊天名。后台播放与原生灵动岛由系统和 WebView 决定，强制退出不支持。

## v2.7.6 Alpha
Android 播放器使用可见视口定位，禁用坐标变形展开动画；iOS 和媒体引擎保持不变。

## v2.7.7 Alpha
拾忆入口支持纵向拖动并记忆位置；展开面板独立使用可视视口高度，内部滚动。保留音乐、网关和记忆数据逻辑。尚未真机测试。

## v2.7.8 Alpha
拾忆：精确替换聊天变量，持久删除标记，禁止重建已删除的归档条目，来源变更后撤销旧摘要，时间轴实时刷新。原始正文不删除；轮询存在延迟，生成前不保证完成同步。未真机验证。

## v2.8.0 Alpha · 固本
- 拾忆使用实时消息校验，不再使用跨异步操作的共享快照；清理失效审核队列和暂缓项。
- 在宿主提供相应事件时，生成开始、命令处理后、切档、编辑、删除、切换回复和生成结束触发记忆校验；保留轮询。宿主是否等待异步监听器以及重 Roll 的事件顺序尚未实机验证，不能保证生成前完成。
- 音乐扫描与记忆扫描独立调度；移除入口重复读取消息，回到前台立即检查。保留播放器源码和网关协议。
- 销毁时移除新增事件监听并关闭拾忆弹窗；切档时关闭旧审核窗口。
- 保留 v2.7.8 删除标记及世界书同步机制。仍使用全量校验，不宣称增量扫描或完整事务恢复。
- 更新前备份世界书及聊天；先在测试存档验证删除、重 Roll、切档及提示词查看器。未真机验证。

## v2.8.1 Alpha
Manual full-history scan and explicit recovery of blocked summaries; default titles renumbered in source order, custom titles preserved. Full-text editor modal. No device testing.

## v2.8.2 Alpha
Keyword search and visual song picker for local playlist addition and manual online matching. Existing gateway search endpoint; no gateway update. Background matching unchanged. Device testing pending.

## v2.8.3 Alpha
Opt-in GD local music adapter (Netease source), no gateway credentials. Cloud tab requires verified login. Local role playlists retained. Search cover thumbnails unavailable in GD mode; playback cover lookup uses search metadata. No live API or device testing.

## v2.9.0 Alpha
拾忆档案：搜索、手动章节、星标、批量删除、回收站、编辑历史（每条最多20版）、楼层跳转及分批显示。回收恢复必须匹配当前正文哈希；不恢复失效正史。仅支持已加载楼层跳转。章节与星标为聊天变量元数据，不注入世界书。未真机测试。

## v3.0.0 Alpha 共鸣
新增声屿共鸣页：当前聊天有效归档摘要与当前正文 BGM 双向检索、章节筛选、临时原声带队列、音乐锁定、跳转便签。关联不使用过期歌曲来源回退；不删除歌曲库。锁定为会话内状态，不修改原跟随设置。尚无自动逐便签回忆模式、云端原声带同步或真机验证。无需更新网关。

## v3.1.0 Alpha · 留痕
新增拾忆管理菜单中的留痕档案：人物、关系、伏笔、事件、成长；手动创建、编辑、删除、搜索、关联多条正史记忆。从记忆整理可预填摘要，需人工确认。来源失效仅标记，不自动删除档案。档案存于当前聊天 archiveUI，不注入世界书。未实现 AI 自动提取、关系图或直接音乐关联；未真机测试。

## v3.2.0 Alpha 回响
Read-only immersive recall from resonance or memory dock. Chapter, star and linked person filters; manual swipe/keyboard, optional music and timed advance, local resume by source hash. Closing restores previous follow lock, not previous audio queue. Missing music leaves existing audio unchanged. Cover background only when track metadata includes a usable cover URL. No real-device testing.

## v3.3.0 Alpha 识微
新增随层 JSON 留痕解析。有效且已归档的摘要对应楼层才参与自动档案投影，重 Roll 或删除摘要后自动投影撤销。手动编辑为独立覆盖副本，可能标记来源失效；删除自动档案会隐藏其稳定名称。名称规范化精确合并，不自动合并近似姓名。支持物品、地点、中文日期和部分关键词模糊搜索。附独立预设提示词及显示层正则；未修改原预设。无独立审核模式、AI 历史补提取、相对日期推算或错误 JSON 修复。未真机测试。

## v3.4.0 Alpha
通用标签 summary/table/bgm；旧标签可读取。模块独立启动，右下角设置按钮可在全部关闭时使用，切换模块需要刷新。关闭拾忆不删除已存在的世界书或解除宿主原有世界书挂载。预设安装依赖宿主 Chat Completion preset manager，保留原条目，给现有排序组添加并启用三条独立提示词；同 ID 不重复安装。旧提示词不自动删除，需人工停用冲突条目。隐藏正则需手动配置。未真机测试。

## v3.4.1 Alpha
模块开关迁入宿主扩展设置及 extensionsMenu 快捷菜单，移除独立悬浮设置按钮。预设安装界面及确认提示注明拾忆/声屿依赖。宿主 DOM 兼容性待真机验证。

## v3.4.2 Alpha
九种提示词、独立长度选择、预览、估算 Token、固定 ID 更新、自定义覆盖提醒及停用。摘要标题自动读取。Token 为字符估算，宿主保存及移动端界面需实测。

## 3.5.0 Alpha · 织忆

- 当前聊天变量 `shiyi_v01.weave` 保存有效表格及实体快照；表格不再要求摘要先归档。新表格稳定至少八秒后收录，已归档摘要对应表格可立即收录。删除/拒绝摘要仍排除同版本表格。
- 拾忆设置提供仅归档、精简、智能、深度四种档案记忆模式、分类开关及预算。留痕档案可标为核心记忆。
- 使用最近四条聊天消息的名称/别名匹配及共同人物关联，通过 ST `setExtensionPrompt` 注入相关档案；不额外调用 AI。预算为 UTF-8 字节数/2 的保守估算，不包含原摘要世界书。
- 原摘要世界书机制不变；本版未实现摘要联合检索、独立档案世界书、语义检索或真实 Token 计数。实际注入时序及客户端兼容性待实测。

## 3.6.0 Alpha
默认统一动态召回：保留世界书完整原文和元数据，但关闭其常驻注入，近期摘要、星标、字符二元组相关性与档案共享估算预算。设置可切回旧版完整世界书。无额外 AI 调用；不是语义检索或生成式压缩。需在实际酒馆验证注入时序。已有预算设置沿用，新聊天默认 3000。

## 3.7.0 Alpha 凝忆
独立实现 BM25（中文双字切分）、实体别名与关联召回、会话内余温、紧凑字段及完全相同行去重；设置可回退原检索。检查器展示最近准备注入内容，不代表最终 API 请求。预算为字节估算。未实现向量接口、自动隐藏、章节压缩或跨文本语义去重。借鉴 Anima-RAG 的检索设计：https://github.com/Ellinav/anima-rag ，未复制其源码。

## 3.7.1 Alpha 去冗（阶段构建）
- 凝忆可选自适应预算，按近期查询长度估算，上限由用户设置；默认关闭。
- 对近期正文中完整重复的摘要进行保守过滤，核心/星标不受此过滤影响。
- 保守过滤完全重复的实体历史字段。仍非语义去重。
- 保留手动正文归档；自动隐藏、向量服务、章节压缩尚未实现。

### v3.7.2-alpha
实验性自动隐藏：默认关闭，仅当前聊天已确认且表格有效的旧 AI 正文；保留原文。关闭拾忆前恢复当前聊天自动隐藏记录。其他聊天及手动隐藏记录不自动恢复。尚未进行酒馆集成测试。

## v3.7.3 灵索
可选 OpenAI-compatible Embedding 完整 URL；默认关闭。异步批量索引，缓存按聊天、接口、模型隔离，RRF 融合；未命中缓存时本地检索。密钥仅 sessionStorage。尚未实测接口与酒馆。

## v3.8.0 Alpha（实验整合）
新增可关闭的章节索引：优先使用手动章节，无章节时按12条旧摘要分组；最近12条摘要不分组。章节索引按需召回标题链，保留原始摘要及来源，不是生成式压缩。新增硅基流动配置填充与官方获取指南。未实测酒馆、真实向量服务或节省比例；故事主线压缩、连接测试与缓存清理尚未实现。

## 3.8.1-alpha
- 修复短输入预算、摘要去重、字符串别名及隐藏消息查询过滤。
- 章节索引增加每条摘要前100字符；BM25分词缓存上限1500。
- 向量失败冷却60秒，清理非当前候选内存缓存。
- 未进行酒馆运行测试；预算仍为估算。

### 3.8.2 Alpha · 长篇性能第一轮
- BM25 查询词倒排临时表、LRU 分词缓存（12000 条上限）、预算增量计算；仍需全量扫描候选。
- 留痕确认记录复用、手动实体 ID 集合匹配。
- 声屿批量保存扫描结果；播放 timeupdate 仅更新时间与歌词，歌词二分定位。
- 合成一万摘要检索测试通过；未验证真实酒馆、移动端或播放器运行。


## 3.9.0 Alpha
双模式入口：新空聊天默认古法总结，已有明确设置保留；有历史摘要但无设置的聊天保留动态模式。共享摘要和表格，简约模式关闭向量调用，恢复自动隐藏正文。设置失败尝试回退。尚无后台迁移、持久化索引或原文补建。

### v3.9.1 Alpha
超长模式新增 IndexedDB 分词词频缓存，按聊天隔离，精确文本匹配，最多12000条内存缓存；延迟写入，数据库不可用时回退原检索。简约模式不读取索引。此为派生缓存，不是持久化倒排索引；仍需全量候选扫描，尚未实现 Worker。缓存包含剧情文本，保存在浏览器本地，关闭模块可能丢失尚未写入的缓存，不影响原始记忆。

### 3.9.2 Alpha
- 超长模式 BM25 分词与评分移至模块 Worker，使用聊天级 IndexedDB 分词缓存；不支持 Worker 时回退原检索。
- 简约模式停止 Worker；销毁及聊天切换停止任务，异步结果注入前检查聊天身份。
- 文档构建、候选排序、向量融合仍在主线程；尚未实现增量倒排索引、同聊天编辑期间的完整版本校验或浏览器实测。

### 3.9.3-alpha
Worker 内存倒排索引，按文档 ID 与精确文本发送增删改差量；同聊天异步结果校验。首次仍全量传输，Worker 重启需重建；未实现持久化倒排索引或模式迁移断点续建。主线程版本校验仍全量序列化，需进一步优化。播放器未改动。

### 3.9.4 Alpha
超长凝忆模式采用五组软预算（星标20%、近期25%、远期30%、实体15%、未结伏笔10%），剩余预算按原排序共享。明确标记未解决或发展中的相关伏笔优先，保留档案来源；不推断秘密或因果。预算仍为估算，超长单条可能跳过。简约模式和播放器未改动。

### 3.9.5-alpha
- 声屿：按聊天及楼层缓存 BGM 解析结果，单次扫描同时确定最新歌曲；删除楼层清理缓存，切换聊天清空缓存。缓存最多 50000 条，仍需遍历消息并保留文本引用。
- 拾忆：历史档案固定每页 40 条，支持跨页选择，搜索防抖 180ms。
- 尚未实现真正事件驱动扫描、虚拟列表或移动端实测。

### v3.9.6 Alpha
- 简约模式累计200条摘要或24000字符时提示切换，每次运行每聊天一次，可关闭。
- 定时拾忆维护让出主线程，支持 requestIdleCallback，超时1500ms；生成校验保持即时。
- 尚未实现完整资源调度、性能档位及持久化倒排索引。

### 3.9.7 Alpha
Worker 倒排索引的词频快照按聊天保存到独立 IndexedDB。重新进入时复用完全相同的文本词频，并用当前候选集合校验、替换和删除旧记录。数据库异常回退到重建。当前仍需传输首次完整候选、重建 postings，且每次变更保存完整快照；不支持中途断点续建。原始数据不受影响。

### 3.9.8 Alpha
- Worker 故障或超时后冷却30秒再尝试启动，保留本地回退及运行计数。
- 向量请求使用 AbortController，聊天切换及重置时取消旧请求。
- 设置中显示后台检索状态及最近耗时。
- 未验证真实浏览器、移动端及播放器联动。

## 4.0.0 Alpha — 整合验证
- 修复 Worker 索引残留校验、错误响应冷却及零历史条数时的 slice(-0) 问题。
- `tests/stress.mjs` 可通过 `node --experimental-default-type=module tests/stress.mjs` 运行；`tests/results.jsonl` 为本次合成数据结果。
- 测试只覆盖纯 JS 检索、快照恢复、编辑删除、预算与单一远期目标；不代表浏览器、真实 IndexedDB、播放器或完整酒馆端到端性能。播放器本轮未修改。

### v4.0.1 Alpha
超预算候选支持原文摘录，优先保留查询相关句段；摘录明确标记并保留摘要楼层。章节候选在单楼候选之后处理，已有任一来源摘要入选时跳过章节（保守去重，可能损失其他章节细节）。不修改原始记录，不调用额外 AI。新增 tests/fidelity.mjs。尚未实现语义压缩、原始聊天正文按需读取或浏览器集成测试。

### 4.0.2 Alpha
- IndexedDB v2 uses individual document records scoped by chat; updates write only changed records, with checkpoints every 256 changed documents. Old v1 cache is retained but not imported; first run rebuilds once.
- Restart reuses committed records after comparison against current candidate text. No database support falls back to memory. No original memory is migrated.
- Full candidate ID/text comparison and initial database read remain; actual browser performance and interruption recovery require integration tests. No player changes.

### 4.0.3 Alpha
声屿：消息事件标记扫描，稳定等待到期重查，60秒全量兜底，手动扫描强制执行；时间线复用标签缓存；旧歌单面板40首分页；会话歌词缓存64首。仍需真实宿主验证事件覆盖、播放及安卓视口。全屏队列未分页。

### 4.0.4-alpha
- Cooperative idle maintenance scheduler with coalescing, visibility guard, cleanup and on-demand diagnostics. Audio and generation validation remain outside the queue. Browser integration not tested.

## v4.1.0 Alpha
检索任务代际隔离：取消与故障分离，旧线程事件不能终止新线程。新增模拟 Worker 生命周期测试。真实酒馆集成仍待验证。

## v4.1.1 Alpha
超长混合检索增加有界场景查询、显式人物优先和短输入人物提示。仅为词法辅助，不推断确定身份；简约模式不变。

## v4.1.2 Alpha
- 动态注入前独立校验正文来源及删除标记，保留无楼层手工记录；无效来源不参与档案关联。
- 别名累计，其他数组以最新明确值覆盖，空数组清空；历史仍保留。预设三档同步规则，已有预设需手动更新。
- 混合检索标注楼层及历史状态；异步返回后再次校验剧情版本。
- tests/canon.mjs 覆盖来源失效、删除标记、数组更新与回滚。真实酒馆尚未测试；旧档案若使用增量数组可能需要人工核对。

## 4.1.3-alpha
声屿按事件楼层增量更新稀疏 BGM 索引；删除、未知事件及60秒校验全量回退。保留收藏；时间线仍独立读取正文。索引单元测试通过，真实宿主事件未验证。

## v4.1.4 Alpha
- 统一 visualViewport 计算；移动端播放器使用显式矩形定位，移除定位 transform；视口滚动、尺寸变化合并至动画帧。
- 灵动岛拖动使用可视区域边界；页面恢复刷新播放器。隐藏页面跳过 timeupdate 的视觉更新。
- 系统减少动态效果或设备内存报告不超过 4GB 时启用轻量视觉效果，不改变音质与记忆预算。
- 新增 tests/viewport.mjs，覆盖 15 个矩形场景；全部 Node 回归测试通过。尚未在真实安卓 Chrome/Via、iOS 或酒馆宿主验证，不能保证解决所有定位问题。

## v4.1.5 Alpha
- Optional embeddings rerank a bounded lexical shortlist (192 lexical + 64 protected/recent candidates), not the entire archive. Local BM25 still covers all documents.
- Vector cache retains reusable queries, capped at 256 entries and approximately 2 MB of numeric/text payload; serialized persistence capped at 1 million characters. On successful persistence, other chat/model vector cache keys are removed. No authoritative records are removed.
- Disabling embeddings or switching away from hybrid cancels pending requests. Mock vector cache test and all existing Node regression tests passed. Browser storage and mobile integration remain unverified. IndexedDB global capacity management is not implemented.

## 4.2.0 Alpha
- 缺失世界书或聊天条目时，从聊天变量中的原始摘要恢复，不自动标记删除。显式清空已有条目的旧逻辑不变；整条世界书删除现在视为可恢复异常。
- 全部 Node 回归脚本及 JS 语法检查通过。新增 tests/browser.py（需 Python Playwright 与 Chromium）；本环境浏览器导航被管理员策略阻止，未完成真实 Worker/IndexedDB 测试。
- 尚未验证真实酒馆、移动端或双模式端到端切换；不是稳定版。

## dev.10 实测候选版

先阅读 [实测指南](FIELD_TEST.md)，仅在备份后的独立测试聊天或测试数据目录使用。
