/**
 * 会话保活(LRU):看过的会话不拆管道 —— store + 只读 socket 常驻,
 * 切回去零加载零布局跳变(「就当它同时存在几个进程」)。
 *
 * - kept = 最近激活/关窗的会话 id(新→旧),上限 KEEP;淘汰时若该会话
 *   没在小窗里开着,才真正 dropChatStore(小窗有自己的生命周期)。
 * - socket 由 SessionKeepAliveHost 按 kept 挂(排除已开窗的,避免
 *   双 socket 往同一 store 灌事件);窗关掉后 keeper 接管同一 store,
 *   挂上时会 ui:request_snapshot 对账,无缝交接。
 * - 服务器每用户直播上限 8 路:KEEP 取小,窗 + 保活合计留有余量。
 * - 换用户/工作区时 ChatPanel 调 clearKeepAlive() 全清。
 */
import { create } from "zustand";
import { dropChatStore } from "./chatStores";

/* 退出小窗模式会把整组窗(可能 5-6 扇)塞进保活 —— KEEP 要装得下,
 * 弹回才全员零加载;服务器每用户 8 路直播上限,留 2 路余量。 */
const KEEP = 6;

/** 由 sessionWindowsStore 注册(避免模块环):id 是否正开着小窗。 */
let isWindowed: (sessionId: string) => boolean = () => false;
export function registerWindowedChecker(fn: (sessionId: string) => boolean): void {
  isWindowed = fn;
}

interface KeepAliveState {
  kept: string[];
}

export const useSessionKeepAliveStore = create<KeepAliveState>(() => ({ kept: [] }));

/** 记一次「值得保活」:激活了它 / 关掉了它的窗。挤出的旧会话若不在窗里就释放。 */
export function touchKeepAlive(sessionId: string): void {
  const prev = useSessionKeepAliveStore.getState().kept;
  const next = [sessionId, ...prev.filter((id) => id !== sessionId)];
  const kept = next.slice(0, KEEP);
  for (const evicted of next.slice(KEEP)) {
    if (!isWindowed(evicted)) dropChatStore(evicted);
  }
  useSessionKeepAliveStore.setState({ kept });
}

/** 换用户/工作区:全清(窗里的由 closeAll 自己收)。 */
export function clearKeepAlive(): void {
  for (const id of useSessionKeepAliveStore.getState().kept) {
    if (!isWindowed(id)) dropChatStore(id);
  }
  useSessionKeepAliveStore.setState({ kept: [] });
}
