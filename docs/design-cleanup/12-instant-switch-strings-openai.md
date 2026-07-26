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
   (soruxgpt 网关 + openai-responses),modelOverrides 内联三个模型
   定义(从本地 models-store 抽取,含成本/上下文窗/思考档位):
   `gpt-5.3-chat-latest` / `gpt-5.3-codex` / `gpt-5.3-codex-spark`。
   改动前有备份 models.json.backup-*。
3. **dreamprism 的 model_allow_json** 追加上述三条(直改 platform.db,
   服务重启后用户缓存刷新生效)。其他账号未动;要批量放开就改
   server/config/model-templates.json 的 core-3 模板。

## 验证 / 排查

- dreamprism 登录后模型面板应出现三个 GPT 模型;选中后开新会话,
  状态栏应出现第四行(Codex adapter …)—— 即 #19 的 extensionLine,
  服务端 extensionStatuses 由适配器 setStatus 填充。
- 第四行仍不亮:先确认会话是**配置生效后新开的**(旧会话池里的
  进程不会重读配置);再看工作区
  `workspaces/dreamprism-*/.pi/agent/pi-codex-conversion.json` 是否
  已被同步(每次 ensureUserAgentDir 刷新)。
- GPT 模型 401/404:soruxgpt 网关键在主机 models.json 的 openai 段,
  确认未被下一次手工编辑覆盖(workspace 侧永远是主机的镜像)。
