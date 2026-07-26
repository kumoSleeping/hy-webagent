/**
 * 会话保活(LRU):看过的会话的 store **纯内存缓存** —— 不挂 socket。
 *
 * 首版给每个保活会话挂常驻只读 socket,结果服务器把有连接的会话钉在
 * 直播池里不可淘汰 —— 关窗只是把 socket 从窗挪进保活,8 路坑位从不
 * 释放,攒满后新建必报「已达上限」。降级为纯 store 缓存后:
 * - 切回时 onPiSessionChange 无缝克隆暖数据(零加载零布局跳变),
 *   主链路连上后 chat:history 原地静默对账(「该更新更新」);
 * - 关窗即归还服务器坑位(窗 socket 随组件卸载断开,会话变可淘汰);
 * - kept 淘汰时若会话没在窗里开着,dropChatStore 释放内存。
 * 换用户/工作区时 ChatPanel 调 clearKeepAlive() 全清。
 */
import { create } from "zustand";
import { dropChatStore } from "./chatStores";

/* 退出小窗模式会把整组窗(可能 5-6 扇)塞进保活 —— KEEP 要装得下,
 * 弹回才全员零加载;纯内存缓存,不占服务器直播坑位。 */
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
