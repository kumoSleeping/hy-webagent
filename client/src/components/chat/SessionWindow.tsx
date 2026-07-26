/**
 * 会话直播小窗(设计稿 F,与桌面 PI-HGUI 同源;docs/design-cleanup/10)。
 *
 * 每窗一条只读 WS 直播(useSessionWindowSocket);点窗任意处 = 置顶 + 激活
 * (共用输入框走主 socket 发激活会话)。头部 macOS 三色灯:红=关窗、
 * 黄=收折成工具栏编号方块、绿=接管整页(本会话回原生整页视图,其余窗暂藏)。
 * 对账:切走 / 回合结束时 refresh() 重拉全量历史,自愈中途开窗丢的半条。
 */
import { useEffect, useRef } from "react";
import { Maximize2, Minus, X } from "lucide-react";
import { useStore } from "zustand";
import { ComposerPanelChrome } from "./ComposerPanelChrome";
import { MessageFeed } from "./MessageFeed";
import { useChatStore } from "../../stores/chatStore";
import { ensureChatStore } from "../../stores/chatStores";
import { useSessionWindowsStore } from "../../stores/sessionWindowsStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useSessionWindowSocket } from "../../hooks/useSessionWindowSocket";

interface SessionWindowProps {
  sessionId: string;
  z: number;
  /** 级联出生位:默认锚基础上每窗偏移 24px,避免全叠在一起。 */
  cascade: number;
  /** 黄灯收折:窗保持挂载与直播(store 不动),只是 display:none。 */
  minimized: boolean;
  /** 绿灯接管期间全部窗暂藏(挂载与直播保持)。 */
  hidden: boolean;
}

export function SessionWindow({ sessionId, z, cascade, minimized, hidden }: SessionWindowProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // 幂等取用:注册表条目由窗口 store 的 close/closeAll 负责注销,
  // 组件卸载绝不 drop(StrictMode 双挂载会误杀开着的窗的直播)。
  const chatStore = ensureChatStore(sessionId);
  const { refresh } = useSessionWindowSocket(sessionId, chatStore);
  const attached = useStore(chatStore, (s) => s.hydratedPiSessionId === sessionId);
  const activeId = useSessionStore((s) => s.activePiSessionId);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const sessions = useSessionStore((s) => s.sessions);
  const bringToFront = useSessionWindowsStore((s) => s.bringToFront);
  const minimizeWindow = useSessionWindowsStore((s) => s.minimize);
  const closeWindow = useSessionWindowsStore((s) => s.close);
  const zoomWindow = useSessionWindowsStore((s) => s.zoom);

  const isActive = activeId === sessionId;
  const title = sessions.find((entry) => entry.id === sessionId)?.title ?? "New Session";

  // 对账 (a):本窗从激活变非激活 —— 主链路可能吃掉了在途半条,重拉。
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  const wasActiveRef = useRef(isActive);
  useEffect(() => {
    if (wasActiveRef.current && !isActive) refresh();
    wasActiveRef.current = isActive;
  }, [isActive, refresh]);

  // 对账 (b):本窗回合结束(isStreaming ↘)且非激活 —— 重拉补全。
  useEffect(() => {
    return chatStore.subscribe((state, prev) => {
      if (prev.isStreaming && !state.isStreaming && !isActiveRef.current) refresh();
    });
  }, [chatStore, refresh]);

  function handleWindowPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // 三色灯不参与「点窗置顶/激活」:点背景窗的关闭键不该先激活它;
    // 捕获阶段的状态更新也会打断灯按钮的 click 合成。
    if ((e.target as HTMLElement).closest(".pi-swin-ctl")) return;
    bringToFront(sessionId);
    if (!isActive) setActiveSession(sessionId);
  }

  /** 扩大 = 接管整页:本会话回到原生整页视图,其余窗暂藏。 */
  function enterZoom() {
    if (!isActive) setActiveSession(sessionId);
    zoomWindow(sessionId);
  }

  return (
    <div
      className={`pi-float-panel pi-float-panel--session${isActive ? " pi-float-panel--active" : ""}`}
      ref={panelRef}
      data-open="true"
      style={{
        zIndex: z,
        display: minimized || hidden ? "none" : undefined,
        right: `calc(var(--pi-float-right, 1.25rem) + ${cascade * 24}px)`,
        bottom: `calc(var(--pi-float-bottom, 8.5rem) + ${cascade * 24}px)`,
      }}
      onPointerDownCapture={handleWindowPointerDown}
      onClick={(e) => e.stopPropagation()}
    >
      <ComposerPanelChrome
        title={title}
        panelRef={panelRef}
        storageKey={`pi-swin-rect:${sessionId}`}
      />
      {/* 两个方正控制钮 —— 面板的绝对定位直接子元素,完全不进拖动把手的
          事件圈;命中区手机端加大。左=隐藏(收进 bar),右=扩大(接管整页)。 */}
      <button
        type="button"
        className="pi-swin-ctl pi-swin-ctl--hide"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          minimizeWindow(sessionId);
        }}
        title="隐藏到工具栏"
        aria-label="隐藏到工具栏编号方块"
      >
        <Minus strokeWidth={2} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="pi-swin-ctl pi-swin-ctl--zoom"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          enterZoom();
        }}
        title="扩展至整个页面"
        aria-label="本会话扩展至整个页面"
      >
        <Maximize2 strokeWidth={2} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="pi-swin-ctl pi-swin-ctl--close"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          closeWindow(sessionId);
        }}
        title="完全关闭小窗（会话保留）"
        aria-label="完全关闭会话小窗"
      >
        <X strokeWidth={2} aria-hidden="true" />
      </button>
      <div className="pi-swin-body">
        {attached || isActive ? (
          // 激活窗直接镜像单例 store —— 与主区(让位前)显示的内容逐字节一致;
          // 非激活窗走本窗独立 store + 对账。
          <MessageFeed chatStore={isActive ? useChatStore : chatStore} reserveComposer={false} />
        ) : (
          <div className="pi-swin-loading">连接中…</div>
        )}
      </div>
    </div>
  );
}

/** 全部会话小窗的宿主 —— 与聊天面板解耦。 */
export function SessionWindowsHost() {
  const windows = useSessionWindowsStore((s) => s.windows);
  const zoomedSessionId = useSessionWindowsStore((s) => s.zoomedSessionId);
  return (
    <>
      {windows.map((w, index) => (
        <SessionWindow
          key={w.sessionId}
          sessionId={w.sessionId}
          z={w.z}
          cascade={index % 6}
          minimized={w.minimized}
          hidden={zoomedSessionId !== null}
        />
      ))}
    </>
  );
}

