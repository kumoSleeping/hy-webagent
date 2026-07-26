# 12 — 瞬时切换 + 琴弦切窗 + OpenAI/Codex 适配器上线

日期:2026-07-27。自本轮起 UI 只做 Web(桌面 PI-HGUI 停更于 57b4612)。

## 瞬时切换(多窗同屏来回切不再等待)

- **状态行**:statusBarStore 新增 `footerCache`(按会话缓存最近一次
  footer)与 `switchToSession`(切激活时有缓存立即换上,REST 到了再
  覆盖)。缓存写点两个:REST `/status` 返回(fetchSessionStatus)与
  主 socket `footer:update` 帧。原先切会话先 `clear()` 后等 REST ——
  肉眼可见闪空。
- **窗体内容**:SessionWindow 只有当 `isActive && 主 store 已
  hydrate 到本会话` 才镜像单例 store;激活换绑的窗口期继续用本窗
  自己的直播 store 渲染 —— 切换零白屏零「连接中」。

## 「琴弦」:手机小窗模式左缘滑动切窗(台前调度式)

`SessionWindowStrings`(ChatPanel 按 isMobileLayout 挂载,无窗自隐):
每窗一根短横线竖排在左缘竖中线;按住沿边滑动,滑到哪根那扇窗
bringToFront + setActiveSession(边滑边换),松手定格。激活窗的弦
主题红加长;**流式中的窗那根弦呼吸脉动**(方案 A+C)。闲时 0.35
透明度,触摸点亮;z=460(渐隐幕之上、输入坞之下)。

## OpenAI GPT 三模型 + Codex 适配器(服务器侧)

服务器本就给每个工作区装了 `@howaboua/pi-codex-conversion@2.2.19`
(PLATFORM_NPM_PACKAGES + /root/.pi/agent/npm 符号链接),第四行状态
一直不亮是因为:①适配器行为配置(pi-codex-conversion.json)没进工作区,
②所有账号的模型白名单只有 deepseek/xiaomi/grok,适配器 scope 挂在
openai 上从未被启用。本轮:

1. **isolation.ts**:ensureUserAgentDir 把 `pi-codex-conversion.json`
   与 models.json 同策略从主机每次刷新(scope=additionalProviders
   ["openai"],statusLine 开)。
2. **主机 /root/.pi/agent/models.json** 增加 openai 提供商
   (soruxgpt 网关 + openai-responses),用 **provider 的 `models` 数组**
   内联三个模型定义(从本地 models-store 抽取,含成本/上下文窗/思考
   档位):`gpt-5.6-luna` / `gpt-5.6-sol` / `gpt-5.6-terra`。
   改动前有备份 models.json.backup-*。
   坑 ×2:①首版配成 gpt-5.3 系 —— 网关 `/v1/models` 根本不供
   (它只供 5.4/5.5/5.6 系,先 curl 网关确认再配);②首版用
   `modelOverrides` —— 那只能改**已知**模型的属性,凭空定义新模型
   必须用 `models` 数组(jina 的 `"models": []` 即此字段)。
3. **admin 与 dreamprism 的 model_allow_json** 加上述三条(直改
   platform.db,服务重启后用户缓存刷新生效)。其他账号未动;要批量
   放开就改 server/config/model-templates.json 的 core-3 模板。
   用户本人的号是 **admin**(工作区 admin-zsx0vltj)。

## 试用返工(同日批五:会话常驻,切换零加载)

「为什么切一下就要加载」的根:主聊天管道是单例 —— 一条主 WS 只绑
激活会话,每切一次 = 拆线重连 + 全量重灌单例 store。小窗顺滑正是
因为每窗有自己的 store + socket。本批把小窗机制推广到全页:

- **sessionKeepAliveStore(LRU=6)**:看过的会话(激活过/关过窗的)
  store + 只读 socket 常驻;淘汰时非在窗会话才 dropChatStore。
  SessionKeepAliveHost 为 kept 中未开窗的会话各挂一条只读管道
  (开窗的由窗自己挂,避免双 socket 灌同一 store;窗关掉后 keeper
  接管同一 store 并 snapshot 对账)。服务器 8 路/用户上限,留 2 路余量。
- **关窗/退小窗模式不再 dropChatStore**,改 touch 进保活 ——
  大屏⇄多任务往返、弹回窗组,全部零加载(onPiSessionChange 的
  暖克隆路径本就存在:kept store 已水合时直接整段克隆进单例,
  hydratedPiSessionId 同步置位,isHydrating 不触发)。
- **状态行零白帧**:onPiSessionChange 原先无条件 clear() 抢在
  useStatusBarSync 重放缓存前白一帧 —— 改成 switchToSession(缓存
  立即换上)。/api/models 每会话只网络请求一次(切回重放缓存;
  换模型走 refreshModels 强刷)。
- **全关进空白页**:红方块关掉最后一扇(且为激活)窗时
  setActiveSession(null) —— 背景不再跳进那个会话的整页。
- 手势:html/body overscroll-behavior none + touch-action pan-y
  pinch-zoom,拖窗不再触发浏览器横向历史滑动(iOS 最贴边的系统
  返回手势仅 PWA standalone 可全禁)。
- 顶带渐变改可见淡影(line 色 14% 起 —— 原 panel→transparent 叠
  同色内容等于隐形)。

## 试用返工(同日批四:定位大改)

- **左缘条重新定位**:不再管窗口切换,改为 **Codex 式当前会话时间线**
  (SessionTimeline,SessionWindowStrings 退役):每个用户轮次一格灰
  刻度,常态半透明;按住后手指附近刻度按高斯衰减隆起成波形 + 浮出
  该轮消息摘要,滑动实时换轮,松手平滑滚到那一轮(DOM 取主区第 n 个
  `.pi-message-dialog-user`,排除小窗内的)。长会话间距自动压缩到半屏。
  仅主区 feed 可见时渲染;扩展位:节点换 session-tree 可带 PI tree 分叉。
- **窗口切换入口 = bar 左端编号瓦片**(用户定的方向):点击置顶+激活,
  右键关窗,激活瓦主题红。bar 左侧本就是留白带,零挤占。
- **「连接中」全面清除**:窗身加载不再有文字/加载条 —— 正文留白,
  左上角红杠位变成输入框同款呼吸块(chrome 新增 loading prop,无框),
  连上即变回红杠;主输入框的连接指示此前已 900ms 去抖。
- **账号勘误**:用户日常登录的是 **default**(Default Admin,工作区
  default-admin-n9fk8sc9,当日活跃),不是 admin —— GPT 三模型白名单
  已补到 default(admin/dreamprism 也保留)。default 工作区 models.json
  当日已同步,含 gpt-5.6 三模型。

## 试用返工(同日批三)

- **关闭钮定稿**:红矩形+白 ✕ → 标题栏左端**一根小红杠**(最小化观感,
  无方框,hover 拉长)。chrome 级,三类浮窗统一。
- **切窗条「琴弦」→「小波形」**:短横线改 SVG 波峰(贝塞尔鼓包)竖排
  相连,单窗=单波峰;加粗(stroke 3.5/激活 4),激活峰主题红且振幅大,
  流式峰呼吸。单横线版观感太差。
- **预览置顶补漏**:openPreview 每次调用都 raisePreview —— 同文件重开
  不触发 ChatPanel effect(previewOpen/activeTabId 都没变),预览会被
  刚 raise 的 Files 面板/会话窗压住。
- **关激活窗背景闪会话(严重)**:关掉激活会话的窗时
  activeSessionWindowed 翻 false,主区背景突然渲染该会话。修:还有
  别的窗就把焦点交给栈顶剩余窗(bringToFront + setActiveSession),
  背景保持让位;最后一扇窗照旧回主区。
- **新建会话失败透出原因**:sessionStore.createSession 失败时把服务端
  报文闪进状态行(典型:「直播会话已达上限(8),请先关闭一些会话小窗」
  —— 窗口的 view socket 会把会话钉在池里不可淘汰,8 扇全开时必现)。

## 验证 / 排查

- admin 登录后模型面板应出现三个 GPT 模型(Luna/Sol/Terra);选中后开新会话,
  状态栏应出现第四行(Codex adapter …)—— 即 #19 的 extensionLine,
  服务端 extensionStatuses 由适配器 setStatus 填充。
- 第四行仍不亮:先确认会话是**配置生效后新开的**(旧会话池里的
  进程不会重读配置);再看工作区
  `workspaces/dreamprism-*/.pi/agent/pi-codex-conversion.json` 是否
  已被同步(每次 ensureUserAgentDir 刷新)。
- GPT 模型 401/404:soruxgpt 网关键在主机 models.json 的 openai 段,
  确认未被下一次手工编辑覆盖(workspace 侧永远是主机的镜像)。
