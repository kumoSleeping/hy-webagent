/**
 * 会话直播小窗的窗口管理(设计稿 F,docs/10 §4)。
 *
 * - windows 数组 = 开着的窗(带 z 序);点谁谁置顶(topZ 递增)。
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
  z: number;
}

export interface PersistedWindowEntry {
  sessionId: string;
}

interface SessionWindowsState {
  windows: SessionWindowEntry[];
  topZ: number;
  /** 接管:该会话占用整页背景(其余窗暂藏);null = 多任务态。 */
  zoomedSessionId: string | null;
  /** 命令/工具面板与文件预览小窗的 z —— 与会话窗同池竞争,
   *  谁最新被召出/点到谁在上(不再固定压在会话窗底下)。 */
  panelZ: number;
  previewZ: number;
  open: (sessionId: string) => void;
  close: (sessionId: string) => void;
  closeAll: () => void;
  bringToFront: (sessionId: string) => void;
  zoom: (sessionId: string) => void;
  unzoom: () => void;
  raisePanel: () => void;
  raisePreview: () => void;
}

/** 浮层基线 z(CSS 里 .pi-float-panel 的 60 只是未接管前的兜底);
 *  会话窗从 70 起,所有浮层此后共用 topZ 递增。 */
const PANEL_BASE_Z = 60;
const BASE_Z = 70;

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
  topZ: BASE_Z,
  zoomedSessionId: null,
  panelZ: PANEL_BASE_Z,
  previewZ: PANEL_BASE_Z,

  open: (sessionId) =>
    set((s) => {
      const topZ = s.topZ + 1;
      if (s.windows.some((w) => w.sessionId === sessionId)) {
        // 已有窗 = 置顶。
        const windows = s.windows.map((w) =>
          w.sessionId === sessionId ? { ...w, z: topZ } : w,
        );
        persist(windows);
        return { topZ, windows };
      }
      const windows = [...s.windows, { sessionId, z: topZ }];
      persist(windows);
      return { windows, topZ };
    }),

  close: (sessionId) =>
    set((s) => {
      const windows = s.windows.filter((w) => w.sessionId !== sessionId);
      persist(windows);
      // 注册表注销跟着窗列表走(不是组件卸载 —— StrictMode 双挂载会误杀)。
      dropChatStore(sessionId);
      return { windows, zoomedSessionId: s.zoomedSessionId === sessionId ? null : s.zoomedSessionId };
    }),

  closeAll: () =>
    set((s) => {
      // 不动持久化:目录切换走 setSessionWindowsPersistScope 换域,
      // 旧项目的窗列表留给下次回来恢复。
      for (const w of s.windows) dropChatStore(w.sessionId);
      return { windows: [], topZ: BASE_Z, zoomedSessionId: null };
    }),

  bringToFront: (sessionId) =>
    set((s) => {
      const topZ = s.topZ + 1;
      return {
        topZ,
        windows: s.windows.map((w) => (w.sessionId === sessionId ? { ...w, z: topZ } : w)),
      };
    }),

  zoom: (sessionId) => set({ zoomedSessionId: sessionId }),
  unzoom: () => set({ zoomedSessionId: null }),

  raisePanel: () => set((s) => ({ topZ: s.topZ + 1, panelZ: s.topZ + 1 })),
  raisePreview: () => set((s) => ({ topZ: s.topZ + 1, previewZ: s.topZ + 1 })),
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
