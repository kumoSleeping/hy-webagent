/**
 * 「小波形」:小窗模式(手机)左缘的窗口切换条 —— 台前调度式。
 * 每扇窗一个波峰(SVG 贝塞尔鼓包)竖排相连成一条波形;只有一扇窗时
 * 就是单波峰。拇指按住沿边滑动,滑到哪个波峰,那扇窗就置顶 + 激活
 * (边滑边实时换),松手定格。激活峰主题红且振幅更大;流式中的峰
 * 呼吸脉动。闲时半透明,触摸点亮;ChatPanel 按 isMobileLayout 挂载。
 */
import { useRef, useState } from "react";
import { useStore } from "zustand";
import { ensureChatStore } from "../../stores/chatStores";
import { useSessionStore } from "../../stores/sessionStore";
import { useSessionWindowsStore } from "../../stores/sessionWindowsStore";
import type { ChatStoreApi } from "../../stores/chatStore";

/** 每个波峰占的纵向槽高 / 画布宽 / 基线离左缘距离。 */
const SLOT_H = 48;
const WAVE_W = 28;
const BASE_X = 4;

function crestPath(y0: number, y1: number, amp: number): string {
  const rise = (y1 - y0) * 0.55;
  return `M ${BASE_X} ${y0} C ${BASE_X + amp} ${y0 + rise * 0.5}, ${BASE_X + amp} ${y1 - rise * 0.5}, ${BASE_X} ${y1}`;
}

function Crest({
  chatStore,
  active,
  y0,
  y1,
}: {
  chatStore: ChatStoreApi;
  active: boolean;
  y0: number;
  y1: number;
}) {
  const streaming = useStore(chatStore, (s) => s.isStreaming);
  return (
    <path
      className={`pi-swave-crest${active ? " pi-swave-crest--active" : ""}${streaming ? " pi-swave-crest--live" : ""}`}
      d={crestPath(y0, y1, active ? 18 : 11)}
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
  const height = windows.length * SLOT_H;

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
      <svg
        className="pi-swave"
        width={WAVE_W}
        height={height}
        viewBox={`0 0 ${WAVE_W} ${height}`}
        aria-hidden="true"
      >
        {windows.map((w, i) => (
          <Crest
            key={w.sessionId}
            chatStore={ensureChatStore(w.sessionId)}
            active={w.sessionId === activeId}
            y0={i * SLOT_H}
            y1={(i + 1) * SLOT_H}
          />
        ))}
      </svg>
    </div>
  );
}
