# 02 · 移除弹出消息系统,改为状态栏 flash

## 决策

用户明确要求:右上角弹出消息很丑,**所有弹出消息全部删除**。
替代交互(自主设计):通知降级为**状态栏(status rail)最顶部 slot 的一条临时
flash 消息**,数秒后自动消失。理由:

- 平面、不遮挡任何内容、不新增浮层——与 pi 的 CLI 血统和 flat 设计语言一致;
- 状态栏本来就是"系统在说话"的地方(footer / working message / widget line);
- 状态栏 stack 是固定行高的 slot 结构,flash 借用最顶行不会引起 composer 跳动。

## 删除清单

| 删除物 | 说明 |
|---|---|
| `stores/notificationStore.ts` + `.test.ts` | 通知队列 store |
| `components/common/NotificationStack.tsx` | 右上角浮层组件(App.tsx 挂载点一并移除) |
| `components/slash/SlashToast.tsx` | **本来就是死代码**:`showToast` 在全项目没有任何调用方;ChatPanel 里的渲染分支永远不触发 |
| `slashStore` 的 `toast/showToast/clearToast/SlashToast` | 同上 |
| design.css `.pi-notification-*` 全部 + `pi-notification-in/out` keyframes | |

## 新机制

`stores/statusBarStore.ts`:

```ts
setFlash(text, kind?: "info" | "error", durationMs = 5000)  // 自动清除,后来的覆盖前面的
clearFlash()
flashStatus(text, kind?, durationMs?)   // 非 React 调用点的便捷函数(WS handler、api.ts)
```

`components/chat/StatusBar.tsx`:flash 存在时借用最顶部(widget)slot 渲染,
row 加 `pi-status-bar--flash`(error 时再加 `--flash-error`,文字用 `--pi-danger`);
flash 消失后 widget 行自动恢复。`role="status"` 保持无障碍语义(容器本身已有 aria-live)。

## 原 notify() 调用点 → 新行为

| 位置 | 事件 | 新行为 |
|---|---|---|
| `useChatWebSocket.ts` chat:notice | 服务器通知 | flash info |
| 同上 chat:error | 聊天错误 | **transcript 内联错误不变**(setAssistantError),外加 flash error |
| 同上 extension `notify` 请求 | 扩展通知 | flash info |
| 同上 slash:result 带 message | 命令成功 | flash info |
| 同上 slash:error | 命令失败 | flash error |
| `ChatPanel.notifySendFailure` | 连接未就绪 | flash error |
| `ComposerBar` 附件失败 ×2 | 附件错误 | flash error |
| `MessageBubble` 复制/存图结果 | 菜单操作反馈 | flash(存图过程中原有的 inline spinner `pi-message-exporting` 保留) |
| `lib/api.ts` 下载失败 | 下载错误 | flash error(动态 import statusBarStore) |

## 排查提示

- flash 不入队:同一时间只显示一条,新 flash 直接覆盖旧的并重置计时器。
  若未来需要队列,在 statusBarStore 内扩展,不要恢复浮层。
- `statusBarStore.clear()`(切换会话)不清 flash,由其自身计时器兜底。
