/**
 * 会话直播小窗的窗口管理(设计稿 F,docs/10 §4)。
 *
 * - windows 数组 = 开着的窗(按开窗顺序,供级联出生位);z 序由 stack 派生。
 * - stack = 浮层 z 序栈(末尾=最上):"panel"=命令/工具面板,"preview"=
 *   文件预览,其余为会话窗 id —— 谁最新被召出/点到谁在上。输入坞不入栈:
 *   design.css 给 .pi-composer-dock 固定 z=500,永远压在所有浮层之上。
 * - 收折概念已移除:关窗即 ✕(会话仍在列表);小窗模式下点历史行重新弹窗。
 *   bar 上的编号方块只剩接管(zoom)退出用。
 * - 布局按用户持久化:localStorage["pi-session-windows-v1:<userId>"] 存窗列表;
 *   每窗几何由 ComposerPanelChrome 以 storageKey `pi-swin-rect:<sessionId>` 各自记。
 * - 目录切换时由 ChatPanel 按用户调 setSessionWindowsPersistScope(userId)
 *   换持久化域并返回该用户上次的窗列表用于恢复。
 */
import { create } from "zustand";
import { dropChatStore } from "./chatStores";

export interface SessionWindowEntry {
  sessionId: string;
}

export interface PersistedWindowEntry {
  sessionId: string;
}

interface SessionWindowsState {
  windows: SessionWindowEntry[];
  /** 浮层 z 序栈,见文件头注释。 */
  stack: string[];
  /** 接管:该会话占用整页背景(其余窗暂藏);null = 多任务态。 */
  zoomedSessionId: string | null;
  open: (sessionId: string) => void;
  close: (sessionId: string) => void;
  closeAll: () => void;
  bringToFront: (sessionId: string) => void;
  zoom: (sessionId: string) => void;
  unzoom: () => void;
  raisePanel: () => void;
  raisePreview: () => void;
}

/** CSS .pi-float-panel 的兜底 z;栈内浮层从 +1 起按栈序递增,
 *  数值有界(≤ 60 + 浮层数),永远够不到输入坞的 500。 */
const FLOAT_BASE_Z = 60;

/** 由栈序派生某浮层的 z(不在栈里 = 兜底基线 60)。 */
export function floatZ(stack: string[], key: string): number {
  return FLOAT_BASE_Z + 1 + stack.indexOf(key);
}

/** 把 key 挪到栈顶(末尾)。 */
function raised(stack: string[], key: string): string[] {
  return [...stack.filter((k) => k !== key), key];
}

let persistKey: string | null = null;

function persist(windows: SessionWindowEntry[]): void {
  if (!persistKey) return;
  try {
    localStorage.setItem(
      persistKey,
      JSON.stringify(windows.map((w) => ({ sessionId: w.sessionId }))),
    );
  } catch {
    // 存储不可用:本次会话内仍生效。
  }
}

export const useSessionWindowsStore = create<SessionWindowsState>((set) => ({
  windows: [],
  stack: ["panel", "preview"],
  zoomedSessionId: null,

  open: (sessionId) =>
    set((s) => {
      // 已有窗 = 只置顶;新窗按开窗顺序入列(级联出生位跟 windows 序走)。
      const windows = s.windows.some((w) => w.sessionId === sessionId)
        ? s.windows
        : [...s.windows, { sessionId }];
      persist(windows);
      return { windows, stack: raised(s.stack, sessionId) };
    }),

  close: (sessionId) =>
    set((s) => {
      const windows = s.windows.filter((w) => w.sessionId !== sessionId);
      persist(windows);
      // 注册表注销跟着窗列表走(不是组件卸载 —— StrictMode 双挂载会误杀)。
      dropChatStore(sessionId);
      return {
        windows,
        stack: s.stack.filter((k) => k !== sessionId),
        zoomedSessionId: s.zoomedSessionId === sessionId ? null : s.zoomedSessionId,
      };
    }),

  closeAll: () =>
    set((s) => {
      // 不动持久化:目录切换走 setSessionWindowsPersistScope 换域,
      // 旧项目的窗列表留给下次回来恢复。
      for (const w of s.windows) dropChatStore(w.sessionId);
      return {
        windows: [],
        stack: s.stack.filter((k) => k === "panel" || k === "preview"),
        zoomedSessionId: null,
      };
    }),

  bringToFront: (sessionId) => set((s) => ({ stack: raised(s.stack, sessionId) })),

  zoom: (sessionId) => set({ zoomedSessionId: sessionId }),
  unzoom: () => set({ zoomedSessionId: null }),

  raisePanel: () => set((s) => ({ stack: raised(s.stack, "panel") })),
  raisePreview: () => set((s) => ({ stack: raised(s.stack, "preview") })),
}));

/** 换持久化域,返回该 scope 上次开着的窗列表(供恢复;兼容旧的
 * 纯 id 数组与带 minimized 的旧条目 —— 收折概念已移除,一律按开着恢复)。 */
export function setSessionWindowsPersistScope(cwd: string | null): PersistedWindowEntry[] {
  persistKey = cwd ? `pi-session-windows-v1:${cwd}` : null;
  if (!persistKey) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(persistKey) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((x): PersistedWindowEntry | null => {
        if (typeof x === "string") return { sessionId: x };
        if (x && typeof x === "object" && typeof (x as { sessionId?: unknown }).sessionId === "string") {
          return { sessionId: (x as { sessionId: string }).sessionId };
        }
        return null;
      })
      .filter((x): x is PersistedWindowEntry => x !== null);
  } catch {
    return [];
  }
}
