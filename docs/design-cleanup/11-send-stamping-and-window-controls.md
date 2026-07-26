# 11 — 回车即时盖章 + 小窗控制钮极简化

日期:2026-07-26。桌面同源改动见 PI-HGUI `docs/10-multi-session-live.md` §9;本篇记 Web 侧实现与排查。

## 根治「第一问占着输入框,第二问发不出去」

根因:聊天动词此前按**连接绑定会话**解析(`getActiveSessionId()` /
`ensureSessionReady()`),而主 socket 是按激活会话重建的 ——
切换/新建激活的换绑窗口期里,第二问顺着旧连接进了旧会话,被当成对
还在流式的第一问的 steering 塞进队列(表现即「发送被占」)。

修法 = **回车即时盖章**,发送与连接解耦:

- 客户端(`useChatWebSocket.ts`):五个聊天动词(prompt/steer/followup/
  abort/dequeue)发送时读 `useSessionStore.getState().activePiSessionId`
  盖进 `payload.piSessionId` —— 取「按下发送那一刻」UI 上的激活会话,
  不受 socket 换绑进度影响。
- 服务端(`ws/chat.ts` `resolveTargetSession()`):有章按章路由 ——
  ① 在内存:校验 `named.userId === userId`(跨用户直接拒绝并留日志);
  ② 不在内存(重启/被淘汰):以本人身份 `createSession(..., stamp)` 冷启
  入池(基座 onEvent 传空,事件槽归绑定该会话的主 socket);
  ③ 冷启失败(会话已删/超上限):返回 undefined,拒发优于错发。
  无章 = 旧客户端,退回 `ensureSessionReady()` —— 加字段协议,无锁步。
- view-only 连接忽略章(只读管道永远不该写)。

顺手修:`ui:request_snapshot` 里 `sendHistorySnapshot()` 被重复调用了两次
(上一轮引入),每次快照请求全量 transcript 发双份 —— 删一。

## 控制钮:三枚 → 两枚,收折子系统删除

- 每窗只剩:**左上 ✕ = 直接关窗**(会话仍在列表;关窗零心理负担),
  **右上 = 扩大接管整页**。下方两角留空 —— 会话窗不再可拉伸
  (`ComposerPanelChrome` 新增 `resizable` prop,会话窗传 false 不渲染右下握把;
  其他悬浮面板不受影响)。
- **minimize(收折)整体删除**:`sessionWindowsStore` 去掉 minimize/restore
  动作与 `minimized` 字段;持久化 `pi-session-windows-v1:<userId>` 只存
  `[{sessionId}]`,旧 `{sessionId, minimized}` / 纯 id 数组一律按开着恢复。
- bar 编号方块只剩一个用途:**接管中的窗**的返回入口(点=回多任务,
  右键=关窗);命令面板顶部的小窗兜底列表随收折概念一并移除。
- **小窗模式点历史行 = 重新弹窗 + 激活**(✕ 关掉的窗从这里找回);
  ⌘/Ctrl 点任何时候强制开窗;无窗时保持原地切换、组预览不受影响。
- **新建按钮随模式换义**:无小窗 = 纯新建会话(createSession +
  setActiveSession,不开窗);有小窗 = 新建会话并开直播小窗。
  title/aria 文案同步分叉(「新建会话」/「新会话小窗」)。
- **工具栏新增「开小窗」按钮(open-window,画中画图标)** —— 小窗模式的
  显式入口(试用返工:新建按钮换义后,零窗时启动小窗模式只剩 ⌘/Ctrl
  点历史行这个隐藏入口)。语义恒定:把当前主区会话弹成小窗(已有窗则
  置顶 = store.open 原语义);空态没会话就新建一路直接以小窗开场。
  排在 new-chat 左边;窄屏裁剪序里排第二早(tree 之后)——手机上拖小窗
  本就勉强,先让位,`composerLayout.test.ts` 各断言随 8 项池同步更新。
- **浮层层级模型(二次返工定稿)**:命令/工具面板、文件预览、会话窗
  三类浮层共用 sessionWindowsStore 的 **z 序栈 stack**(末尾=最上,
  key = "panel"/"preview"/会话 id),z 由栈序派生(`floatZ`,61 起有界
  递增),谁最新被召出/点到(open/bringToFront/raisePanel/raisePreview,
  含面板 div 的 pointerdown capture)谁在上。**输入坞不入栈**:
  `.pi-composer-dock` 固定 `z-index: 500`,浮层数值永远够不到 ——
  会话窗/面板怎么拖都盖不住输入框。首版用无界 topZ 计数器 + 面板固定
  z=60,被会话窗永久压底,已废弃。前提:三类浮层与输入坞同处
  `.pi-interactive-shell`(isolation)的 stacking context;
  SessionWindowsHost 必须挂在 shell 里,别挪出去。
- **渐隐幕 `.pi-float-fade`**:输入坞只有自身宽度,浮窗拖进输入区时
  两 flank 缝隙里原样可见、切边生硬。全视口宽的 fixed 装饰层
  (z=400,浮层之上、坞之下,pointer-events:none),从
  `--pi-float-bottom` 线起向下渐变到 `--pi-bg` —— 浮窗坠入即溶解;
  静止浮层停在线上方,零影响。页脚 `.pi-web-chrome-bar` 提到 450;
  状态行 `.pi-status-bar-stack` 提到 500(它是输入框整体的一部分,
  首发时被幕的不透明段盖掉 —— 手机端「底下几行字消失」即此)。
- **new-chat 永不裁剪**:加入 TOOLBAR_PROTECTED(手机再窄也得能新建
  会话),窄屏兜底集为 commands + new-chat。

## 排查

- 怀疑消息发错会话:服务端日志搜 `rejected cross-user stamped send`
  (章被伪造/串号)与 `stamped session cold-open failed`(章指向已删会话
  或触到每用户 8 路上限)。两者都表现为该次发送被静默拒绝(prompt 有
  `chat:error` 回执,其余动词无副作用)。
- 旧客户端(无章)行为不变;若线上出现「仍被占」,先确认前端已带
  `piSessionId`(浏览器 devtools WS 帧里看 payload)。
- 测试基线:`platform-system.test.ts` 原断言「SYSTEM.md 不得出现
  `projects/`」已因聊天附件一节(`Pictures/`(相对 `projects/`))作废,
  收窄为不暴露 cwd + 必含 `Pictures/`。
