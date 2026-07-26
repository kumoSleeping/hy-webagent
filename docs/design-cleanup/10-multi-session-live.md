# 10 — 多会话直播小窗(设计稿 F,与桌面 PI-HGUI 同源)

日期:2026-07-26。桌面版蓝图见 PI-HGUI `docs/10-multi-session-live.md`(含 C→F 全部演进);本篇只记 Web 差异。

## 服务端三刀

1. **激活不再劫持**(session-manager `doActivateSessionById`):只回收「无连接且空闲」的旧壳(`!isStreaming && !connectedSessions.has(id)`);被小窗连着或在跑 agent 的绝不 `switchSession` morph —— 那会中断别的窗口的直播。不可回收 → 冷启新 `UserPISession`。
2. **owner feed-view socket**(index.ts 路由 + ws/chat.ts):登录用户带 `view=1&piSessionId=X` = 自己会话的只读小窗管道。复用访客 view-only 的「直连订阅、不抢主 socket 事件槽」机制,但走本人鉴权与本人 workspace;会话不在内存则以 attach 语义冷启入池(基座 onEvent 传空)。写入仍被 writableTypes 拦。
3. **每用户直播上限 8**(`ensureUserSessionCapacity`):超限先淘汰 无连接+空闲 的旧壳,无可淘汰报明确错误。

另:`ui:request_snapshot` 现在同时补发 `chat:history` —— 小窗对账(中途开窗丢在途半条 / 回合结束 / 激活切走)与主链路水合共用这一发。

## 客户端

- 每窗一条 WS(`useSessionWindowSocket`),事件进本窗独立 chatStore(`chatStores.ts` 注册表,与桌面同源);激活窗直接镜像单例 store(与主区逐字节一致)。
- UI 与桌面完全一致:控制钮、编号方块、历史行开窗、新建按钮语义等交互细节以 `11-send-stamping-and-window-controls.md` 为准(本篇写作时的三色灯/收折设计已在次轮返工中删除);激活标=灯彩色/灰、小窗滚动条隐藏、布局按用户持久化(`pi-session-windows-v1:<userId>`)。
- "(empty)" → "New Session"(服务端标题 + 历史过滤器 + 测试 fixture)。

## 已知差异与排查

- **runtime rebind(fork/new)会掐断小窗直连订阅**(直连订阅不随 rebind 迁移):窗内流停但不崩,2s 重连或下次对账自愈;彻底解法是把订阅挂到 onEvent 槽的多播上,留待需要时做。
- 第四根状态条(extensionLine):计算(footer-stats)/推送(pushFooterSnapshot)/渲染(StatusBar)链路两端均在;线上不显示 = 该会话的 extensionStatuses 为空,先查服务器侧扩展是否 setStatus。
- 小窗断流:先看服务端日志 `owner feed-view upgrade accepted` 是否出现;再确认 `connectedSessions` 里有该会话(否则 30 分钟闲置回收)。
