/**
 * 「琴弦」:小窗模式(手机)左缘的窗口切换条 —— 台前调度式。
 * 每扇窗一根短横线,竖排等距;拇指按住沿边滑动,滑到哪根,那扇窗就
 * 置顶 + 激活(边滑边实时换),松手定格。正在流式输出的窗那根弦呼吸
 * 脉动(方案 C 的活体感)。闲时半透明,触摸点亮;只在有窗时渲染,
 * 挂载点由 ChatPanel 按 isMobileLayout 把关。
 */
import { useRef, useState } from "react";
import { useStore } from "zustand";
import { ensureChatStore } from "../../stores/chatStores";
import { useSessionStore } from "../../stores/sessionStore";
import { useSessionWindowsStore } from "../../stores/sessionWindowsStore";

function StringTick({ sessionId, active }: { sessionId: string; active: boolean }) {
  const chatStore = ensureChatStore(sessionId);
  const streaming = useStore(chatStore, (s) => s.isStreaming);
  return (
    <div
      className={`pi-swin-string${active ? " pi-swin-string--active" : ""}${streaming ? " pi-swin-string--live" : ""}`}
    />
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
        <StringTick key={w.sessionId} sessionId={w.sessionId} active={w.sessionId === activeId} />
      ))}
    </div>
  );
}
