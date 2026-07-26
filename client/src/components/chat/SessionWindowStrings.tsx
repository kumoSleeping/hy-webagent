/**
 * 「小山峰」:小窗模式(手机)左缘的窗口切换条 —— 台前调度式。
 * 每扇窗 = 一组竖排短横杠组成的小山峰(音频波形观感:短-中-长-中-短),
 * 多扇窗多座峰纵向排列。拇指按住沿边滑动,滑到哪座峰,那扇窗就置顶 +
 * 激活(边滑边实时换),松手定格。激活峰主题红且更宽;流式中的峰各杠
 * 交错跳动(EQ 感)。闲时半透明,触摸点亮;ChatPanel 按 isMobileLayout
 * 挂载,无窗自隐。
 */
import { useRef, useState } from "react";
import { useStore } from "zustand";
import { ensureChatStore } from "../../stores/chatStores";
import { useSessionStore } from "../../stores/sessionStore";
import { useSessionWindowsStore } from "../../stores/sessionWindowsStore";
import type { ChatStoreApi } from "../../stores/chatStore";

/** 峰形:五根杠的基准长度(px),中间最长 —— 山峰轮廓。 */
const PEAK_BARS = [7, 12, 18, 12, 7];

function Peak({ chatStore, active }: { chatStore: ChatStoreApi; active: boolean }) {
  const streaming = useStore(chatStore, (s) => s.isStreaming);
  return (
    <div
      className={`pi-swave-peak${active ? " pi-swave-peak--active" : ""}${streaming ? " pi-swave-peak--live" : ""}`}
    >
      {PEAK_BARS.map((len, i) => (
        <span
          key={i}
          className="pi-swave-bar"
          style={{ width: `${len}px`, ["--bar-i" as string]: i }}
        />
      ))}
    </div>
  );
}

export function SessionWindowStrings() {
  const windows = useSessionWindowsStore((s) => s.windows);
  const activeId = useSessionStore((s) => s.activePiSessionId);
  const [touching, setTouching] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const lastPickRef = useRef<string | null>(null);

  if (windows.length === 0) return null;

  function pickAt(clientY: number) {
    const host = hostRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const idx = Math.min(
      windows.length - 1,
      Math.max(0, Math.floor(((clientY - rect.top) / rect.height) * windows.length)),
    );
    const id = windows[idx]?.sessionId;
    if (!id || lastPickRef.current === id) return;
    lastPickRef.current = id;
    useSessionWindowsStore.getState().bringToFront(id);
    useSessionStore.getState().setActiveSession(id);
  }

  return (
    <div
      ref={hostRef}
      className={`pi-swin-strings${touching ? " pi-swin-strings--touching" : ""}`}
      aria-label="滑动切换会话小窗"
      onPointerDown={(e) => {
        setTouching(true);
        lastPickRef.current = null;
        e.currentTarget.setPointerCapture(e.pointerId);
        pickAt(e.clientY);
      }}
      onPointerMove={(e) => {
        if (touching) pickAt(e.clientY);
      }}
      onPointerUp={() => setTouching(false)}
      onPointerCancel={() => setTouching(false)}
    >
      {windows.map((w) => (
        <Peak
          key={w.sessionId}
          chatStore={ensureChatStore(w.sessionId)}
          active={w.sessionId === activeId}
        />
      ))}
    </div>
  );
}
