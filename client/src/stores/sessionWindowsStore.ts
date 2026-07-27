/**
 * 会话直播小窗的窗口管理(设计稿 F,docs/10 §4)。
 *
 * - windows 数组 = 开着的窗(按开窗顺序,供级联出生位);z 序由 stack 派生。
 * - stack = 浮层 z 序栈(末尾=最上):"panel"=命令/工具面板,"preview"=
 *   文件预览,其余为会话窗 id —— 谁最新被召出/点到谁在上。输入坞不入栈:
 *   design.css 给 .pi-composer-dock 固定 z=500,永远压在所有浮层之上。
 *   (前提:三类浮层与输入坞同处 .pi-interactive-shell 的 stacking
 *   context —— SessionWindowsHost 必须挂在 shell 里,别再挪出去。)
 * - 接管(zoom)概念已删:长按工具栏新建按钮 = 进/出小窗模式;
 *   退出时把当时开着的窗暂存(stashedWindows),再进入原样弹回。
 * - 收折概念已移除:关窗即 ✕(会话仍在列表);小窗模式下点历史行重新弹窗。
 * - 布局按用户持久化:localStorage["pi-session-windows-v1:<userId>"] 存
 *   {open, stash};每窗几何由 ComposerPanelChrome 以 storageKey
 *   `pi-swin-rect:<sessionId>` 各自记。
 * - 目录切换时由 ChatPanel 按用户调 setSessionWindowsPersistScope(userId)
 *   换持久化域并返回该用户上次的 {open, stash} 用于恢复。
 */
import { create } from "zustand";
import { dropChatStore } from "./chatStores";
import { registerWindowedChecker, touchKeepAlive } from "./sessionKeepAliveStore";

export interface SessionWindowEntry {
  sessionId: string;
}

export interface PersistedWindowEntry {
  sessionId: string;
}

export interface PersistedWindowsState {
  open: PersistedWindowEntry[];
  stash: PersistedWindowEntry[];
}

interface SessionWindowsState {
  windows: SessionWindowEntry[];
  /** 浮层 z 序栈,见文件头注释。 */
  stack: string[];
  /** 长按退出小窗模式时暂存的窗口集合 —— 再次长按原样弹回。 */
  stashedWindows: string[];
  /** 新建/切窗后请求聚焦到该会话窗内输入;递增 tick 触发副作用。 */
  focusSessionId: string | null;
  focusTick: number;
  open: (sessionId: string) => void;
  close: (sessionId: string) => void;
  closeAll: () => void;
  /** 长按退出小窗模式:关全部窗,窗口集合入暂存(持久化跟着记)。 */
  exitWindowMode: () => void;
  /** 长按进入小窗模式:有暂存就原样弹回,返回恢复的窗数(0 = 无暂存)。 */
  restoreStash: () => number;
  /** 换持久化域后播种暂存(不写盘 —— 值本来就来自盘)。 */
  seedStash: (sessionIds: string[]) => void;
  bringToFront: (sessionId: string) => void;
  raisePanel: () => void;
  raisePreview: () => void;
  /** 多会话新建后把光标送进目标窗输入框。 */
  requestWindowComposerFocus: (sessionId: string) => void;
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

function persist(windows: SessionWindowEntry[], stash: string[]): void {
  if (!persistKey) return;
  try {
    localStorage.setItem(
      persistKey,
      JSON.stringify({
        open: windows.map((w) => ({ sessionId: w.sessionId })),
        stash: stash.map((sessionId) => ({ sessionId })),
      }),
    );
  } catch {
    // 存储不可用:本次会话内仍生效。
  }
}

export const useSessionWindowsStore = create<SessionWindowsState>((set, get) => ({
  windows: [],
  stack: ["panel", "preview"],
  stashedWindows: [],
  focusSessionId: null,
  focusTick: 0,

  open: (sessionId) =>
    set((s) => {
      // 已有窗 = 只置顶;新窗按开窗顺序入列(级联出生位跟 windows 序走)。
      const windows = s.windows.some((w) => w.sessionId === sessionId)
        ? s.windows
        : [...s.windows, { sessionId }];
      persist(windows, s.stashedWindows);
      return { windows, stack: raised(s.stack, sessionId) };
    }),

  close: (sessionId) =>
    set((s) => {
      const windows = s.windows.filter((w) => w.sessionId !== sessionId);
      persist(windows, s.stashedWindows);
      // 关窗不拆管道:store 交给保活 LRU(切回去零加载),窗 socket 随
      // 组件卸载断开,SessionKeepAliveHost 接管同一 store 并对账。
      touchKeepAlive(sessionId);
      return {
        windows,
        stack: s.stack.filter((k) => k !== sessionId),
        focusSessionId: s.focusSessionId === sessionId ? null : s.focusSessionId,
      };
    }),

  closeAll: () =>
    set((s) => {
      // 不动持久化:目录/用户切换走 setSessionWindowsPersistScope 换域,
      // 旧域的 {open, stash} 留给下次回来恢复;内存暂存随窗一并清。
      for (const w of s.windows) dropChatStore(w.sessionId);
      return {
        windows: [],
        stack: s.stack.filter((k) => k === "panel" || k === "preview"),
        stashedWindows: [],
        focusSessionId: null,
      };
    }),

  exitWindowMode: () =>
    set((s) => {
      const stash = s.windows.map((w) => w.sessionId);
      // 不拆管道:交给保活 LRU,再进小窗模式原样弹回时零加载。
      for (const w of s.windows) touchKeepAlive(w.sessionId);
      persist([], stash);
      return {
        windows: [],
        stack: s.stack.filter((k) => k === "panel" || k === "preview"),
        stashedWindows: stash,
        focusSessionId: null,
      };
    }),

  restoreStash: () => {
    const stash = get().stashedWindows;
    if (stash.length === 0) return 0;
    set((s) => {
      const windows = stash.map((sessionId) => ({ sessionId }));
      persist(windows, []);
      return {
        windows,
        stack: [...s.stack.filter((k) => k === "panel" || k === "preview"), ...stash],
        stashedWindows: [],
      };
    });
    return stash.length;
  },

  seedStash: (sessionIds) => set({ stashedWindows: sessionIds }),

  bringToFront: (sessionId) => set((s) => ({ stack: raised(s.stack, sessionId) })),

  raisePanel: () => set((s) => ({ stack: raised(s.stack, "panel") })),
  raisePreview: () => set((s) => ({ stack: raised(s.stack, "preview") })),

  requestWindowComposerFocus: (sessionId) =>
    set((s) => ({ focusSessionId: sessionId, focusTick: s.focusTick + 1 })),
}));

// 保活 LRU 淘汰时要避开正开着窗的会话(它们有自己的生命周期)。
registerWindowedChecker((sessionId) =>
  useSessionWindowsStore.getState().windows.some((w) => w.sessionId === sessionId),
);

/** 新窗出生位与尺寸:
 * - 有参照窗(栈顶):沿用它的尺寸(= 用户最近设定的),右下错开
 *   一点生成(桌面 20px、手机约 1cm);固定方向,窗不「飞来飞去」。
 * - 没有参照窗(第一扇):现场探测视口长宽,取 **50% × 50%** 建默认
 *   板块,贴右下默认锚位。
 * 预写 pi-swin-rect,chrome 挂载即读,越界由 clampRect 兜底。
 * 该窗已有历史位置则不动(肌肉记忆优先)。 */
export function seedSpawnRect(newSessionId: string): void {
  const key = `pi-swin-rect:${newSessionId}`;
  try {
    if (localStorage.getItem(key)) return;
  } catch {
    return;
  }
  const s = useSessionWindowsStore.getState();
  const refKey = [...s.stack].reverse().find((k) => s.windows.some((w) => w.sessionId === k));
  const refEl = refKey ? document.querySelector(`[data-swin-id="${CSS.escape(refKey)}"]`) : null;
  const offset = document.querySelector(".pi-app-shell--mobile") ? 38 : 20;
  let rect: { x: number; y: number; w: number; h: number };
  if (refEl) {
    const r = refEl.getBoundingClientRect();
    rect = { x: r.left + offset, y: r.top + offset, w: r.width, h: r.height };
  } else {
    const w = Math.round(window.innerWidth * 0.5);
    const h = Math.round(window.innerHeight * 0.5);
    rect = {
      x: Math.max(8, window.innerWidth - w - 20),
      y: Math.max(8, window.innerHeight - h - 152),
      w,
      h,
    };
  }
  try {
    localStorage.setItem(key, JSON.stringify(rect));
  } catch {
    // 存储不可用:退回 CSS 默认锚。
  }
}

/** 换持久化域,返回该 scope 上次的 {open, stash}(供恢复)。兼容旧格式:
 * 纯 id 数组 / 带 minimized 的旧条目(一律按开着恢复,stash 空)。 */
export function setSessionWindowsPersistScope(cwd: string | null): PersistedWindowsState {
  persistKey = cwd ? `pi-session-windows-v1:${cwd}` : null;
  const empty: PersistedWindowsState = { open: [], stash: [] };
  if (!persistKey) return empty;
  try {
    const raw = JSON.parse(localStorage.getItem(persistKey) ?? "null") as unknown;
    if (Array.isArray(raw)) return { open: normalizeEntries(raw), stash: [] };
    if (raw && typeof raw === "object") {
      const obj = raw as { open?: unknown; stash?: unknown };
      return {
        open: Array.isArray(obj.open) ? normalizeEntries(obj.open) : [],
        stash: Array.isArray(obj.stash) ? normalizeEntries(obj.stash) : [],
      };
    }
    return empty;
  } catch {
    return empty;
  }
}

function normalizeEntries(raw: unknown[]): PersistedWindowEntry[] {
  return raw
    .map((x): PersistedWindowEntry | null => {
      if (typeof x === "string") return { sessionId: x };
      if (x && typeof x === "object" && typeof (x as { sessionId?: unknown }).sessionId === "string") {
        return { sessionId: (x as { sessionId: string }).sessionId };
      }
      return null;
    })
    .filter((x): x is PersistedWindowEntry => x !== null);
}
