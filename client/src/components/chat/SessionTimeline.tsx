/**
 * 「时间线」:主区左缘的当前会话轮次导航(Codex 式,非照抄)。
 * 每个用户轮次一格灰刻度,常态安静半透明;按住后手指附近的刻度按
 * 高斯衰减隆起成波形,旁边浮出该轮消息摘要;沿边滑动实时换轮,
 * 松手把主 feed 平滑滚到那一轮。只在主区 feed 可见时渲染
 * (激活会话进了小窗 / 组预览时由 ChatPanel 摘除);轮数 < 2 自隐。
 * 扩展位:节点数据换成 session-tree 即可带上 PI tree 的分叉标记。
 */
import { useMemo, useRef, useState } from "react";
import { useChatStore } from "../../stores/chatStore";

/** 常态刻度长 / 隆起增量 / 波形扩散(px)。 */
const BASE_W = 10;
const BULGE_W = 22;
const SIGMA = 30;
const PAD_Y = 10;

export function SessionTimeline() {
  const messages = useChatStore((s) => s.messages);
  const turns = useMemo(
    () =>
      messages
        .filter((m) => m.role === "user")
        .map((m) => ({ id: m.id, excerpt: m.content.replace(/\s+/g, " ").trim().slice(0, 42) })),
    [messages],
  );
  // 长会话把间距压缩到最多占半屏,滑动比例映射不受影响。
  const tickGap = useMemo(
    () => Math.min(14, Math.max(6, Math.floor((window.innerHeight * 0.5) / Math.max(1, turns.length)))),
    [turns.length],
  );
  const [pointerY, setPointerY] = useState<number | null>(null);
  const [pickIdx, setPickIdx] = useState<number | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  if (turns.length < 2) return null;

  function indexAt(clientY: number): number {
    const host = hostRef.current;
    if (!host) return 0;
    const rect = host.getBoundingClientRect();
    return Math.min(
      turns.length - 1,
      Math.max(0, Math.floor(((clientY - rect.top) / rect.height) * turns.length)),
    );
  }

  /** 滚到主区 feed 的第 idx 个用户气泡(排除小窗里的同类气泡)。 */
  function scrollToTurn(idx: number) {
    const bubbles = [...document.querySelectorAll(".pi-message-dialog-user")].filter(
      (el) => !el.closest(".pi-float-panel--session"),
    );
    bubbles[idx]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const hostRect = hostRef.current?.getBoundingClientRect() ?? null;
  const touching = pointerY !== null;

  return (
    <div
      ref={hostRef}
      className={`pi-timeline${touching ? " pi-timeline--touching" : ""}`}
      style={{ paddingTop: PAD_Y, paddingBottom: PAD_Y }}
      aria-label="会话时间线"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setPointerY(e.clientY);
        setPickIdx(indexAt(e.clientY));
      }}
      onPointerMove={(e) => {
        if (pointerY === null) return;
        setPointerY(e.clientY);
        setPickIdx(indexAt(e.clientY));
      }}
      onPointerUp={() => {
        if (pickIdx !== null) scrollToTurn(pickIdx);
        setPointerY(null);
        setPickIdx(null);
      }}
      onPointerCancel={() => {
        setPointerY(null);
        setPickIdx(null);
      }}
    >
      {turns.map((t, i) => {
        const centerY = hostRect ? hostRect.top + PAD_Y + (i + 0.5) * tickGap : 0;
        const d = touching && hostRect ? Math.abs(centerY - (pointerY as number)) : Infinity;
        const bulge = touching ? Math.exp(-(d * d) / (2 * SIGMA * SIGMA)) : 0;
        return (
          <span key={t.id} className="pi-timeline-slot" style={{ height: tickGap }}>
            <span
              className={`pi-timeline-tick${pickIdx === i ? " pi-timeline-tick--pick" : ""}`}
              style={{ width: `${BASE_W + BULGE_W * bulge}px` }}
            />
          </span>
        );
      })}
      {touching && pickIdx !== null && hostRect && (
        <div
          className="pi-timeline-preview"
          style={{ top: (pointerY as number) - hostRect.top }}
        >
          {turns[pickIdx].excerpt || "(空消息)"}
        </div>
      )}
    </div>
  );
}
