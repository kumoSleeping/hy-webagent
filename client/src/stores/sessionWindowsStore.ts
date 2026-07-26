/**
 * 会话直播小窗的窗口管理(设计稿 F,docs/10 §4)。
 *
 * - windows 数组 = 开着的窗(带 z 序);点谁谁置顶(topZ 递增)。
 * - 布局按项目持久化:localStorage["pi-session-windows-v1:<cwd>"] 存窗列表;
 *   每窗几何由 ComposerPanelChrome 以 storageKey `pi-swin-rect:<sessionId>` 各自记。
 * - 目录切换时由 useDesktopEvents 调 setSessionWindowsPersistScope(cwd)
 *   换持久化域并返回该项目上次的窗列表用于恢复。
 */
import { create } from "zustand";
import { dropChatStore } from "./chatStores";

export interface SessionWindowEntry {
  sessionId: string;
  z: number;
  /** 黄灯收折:窗保持挂载与直播,只是视觉收进工具栏编号方块。 */
  minimized: boolean;
}

export interface PersistedWindowEntry {
  sessionId: string;
  minimized: boolean;
}

interface SessionWindowsState {
  windows: SessionWindowEntry[];
  topZ: number;
  /** 绿灯接管:该会话占用整页背景(其余窗暂藏);null = 多任务态。 */
  zoomedSessionId: string | null;
  open: (sessionId: string) => void;
  close: (sessionId: string) => void;
  closeAll: () => void;
  bringToFront: (sessionId: string) => void;
  minimize: (sessionId: string) => void;
  restore: (sessionId: string) => void;
  zoom: (sessionId: string) => void;
  unzoom: () => void;
}

/** 面板/预览小窗 z=60;会话窗从 70 起,互相点击递增。 */
const BASE_Z = 70;

let persistKey: string | null = null;

function persist(windows: SessionWindowEntry[]): void {
  if (!persistKey) return;
  try {
    localStorage.setItem(
      persistKey,
      JSON.stringify(windows.map((w) => ({ sessionId: w.sessionId, minimized: w.minimized }))),
    );
  } catch {
    // 存储不可用:本次会话内仍生效。
  }
}

export const useSessionWindowsStore = create<SessionWindowsState>((set) => ({
  windows: [],
  topZ: BASE_Z,
  zoomedSessionId: null,

  open: (sessionId) =>
    set((s) => {
      const topZ = s.topZ + 1;
      if (s.windows.some((w) => w.sessionId === sessionId)) {
        // 已有窗 = 还原(取消收折)+ 置顶。
        const windows = s.windows.map((w) =>
          w.sessionId === sessionId ? { ...w, z: topZ, minimized: false } : w,
        );
        persist(windows);
        return { topZ, windows };
      }
      const windows = [...s.windows, { sessionId, z: topZ, minimized: false }];
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

  minimize: (sessionId) =>
    set((s) => {
      const windows = s.windows.map((w) =>
        w.sessionId === sessionId ? { ...w, minimized: true } : w,
      );
      persist(windows);
      return { windows, zoomedSessionId: s.zoomedSessionId === sessionId ? null : s.zoomedSessionId };
    }),

  restore: (sessionId) =>
    set((s) => {
      const topZ = s.topZ + 1;
      const windows = s.windows.map((w) =>
        w.sessionId === sessionId ? { ...w, minimized: false, z: topZ } : w,
      );
      persist(windows);
      return { windows, topZ };
    }),

  zoom: (sessionId) => set({ zoomedSessionId: sessionId }),
  unzoom: () => set({ zoomedSessionId: null }),
}));

/** 切项目:换持久化域,返回该项目上次开着的窗列表(供恢复;兼容旧的纯 id 数组)。 */
export function setSessionWindowsPersistScope(cwd: string | null): PersistedWindowEntry[] {
  persistKey = cwd ? `pi-session-windows-v1:${cwd}` : null;
  if (!persistKey) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(persistKey) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((x): PersistedWindowEntry | null => {
        if (typeof x === "string") return { sessionId: x, minimized: false };
        if (x && typeof x === "object" && typeof (x as { sessionId?: unknown }).sessionId === "string") {
          return {
            sessionId: (x as { sessionId: string }).sessionId,
            minimized: Boolean((x as { minimized?: unknown }).minimized),
          };
        }
        return null;
      })
      .filter((x): x is PersistedWindowEntry => x !== null);
  } catch {
    return [];
  }
}
