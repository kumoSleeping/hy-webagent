/**
 * 会话直播小窗(设计稿 F,与桌面 PI-HGUI 同源;docs/design-cleanup/10)。
 *
 * 每窗一条只读 WS 直播(useSessionWindowSocket);点窗任意处 = 置顶 + 激活。
 * 多会话时输入框嵌在每扇窗底部(SessionWindowComposer),底栏只留工具条。
 * 顶栏无关闭钮,只留隐形拖动带;关闭在输入框上方工具条(原历史位)。
 * 接管(zoom)概念已删 —— 长按工具栏新建按钮整体进/出小窗模式。
 * 拖顶带移动、拖侧边/下缘改大小(edgeResizable)。
 * 对账:切走 / 回合结束时 refresh() 重拉全量历史,自愈中途开窗丢的半条。
 */
import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import { ComposerPanelChrome } from "./ComposerPanelChrome";
import { MessageFeed } from "./MessageFeed";
import { SessionWindowComposer } from "./SessionWindowComposer";
import { useChatStore } from "../../stores/chatStore";
import { ensureChatStore } from "../../stores/chatStores";
import { floatZ, useSessionWindowsStore } from "../../stores/sessionWindowsStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useSessionWindowSocket } from "../../hooks/useSessionWindowSocket";

interface SessionWindowProps {
  sessionId: string;
  z: number;
  /** 级联出生位:默认锚基础上每窗偏移 24px,避免全叠在一起。 */
  cascade: number;
  disabled?: boolean;
  onSend: (text: string) => boolean | void;
  onSteer?: (text: string) => void;
  onAbort?: () => void;
}

export function SessionWindow({
  sessionId,
  z,
  cascade,
  disabled,
  onSend,
  onSteer,
  onAbort,
}: SessionWindowProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // 幂等取用:注册表条目由窗口 store 的 close/closeAll 负责注销,
  // 组件卸载绝不 drop(StrictMode 双挂载会误杀开着的窗的直播)。
  const chatStore = ensureChatStore(sessionId);
  const { refresh } = useSessionWindowSocket(sessionId, chatStore);
  const attached = useStore(chatStore, (s) => s.hydratedPiSessionId === sessionId);
  const activeId = useSessionStore((s) => s.activePiSessionId);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const bringToFront = useSessionWindowsStore((s) => s.bringToFront);
  const closeWindow = useSessionWindowsStore((s) => s.close);

  const isActive = activeId === sessionId;
  // 主链路是否已挂到本会话:激活瞬间主 store 还在换绑旧会话,这段窗口期
  // 继续用本窗自己的直播 store 渲染 —— 切换零白屏零「连接中」。
  const mainHydrated = useChatStore((s) => s.hydratedPiSessionId);
  const mirrorMain = isActive && mainHydrated === sessionId;

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
    // 控制钮不参与「点窗置顶/激活」:点背景窗的关闭键不该先激活它;
    // 捕获阶段的状态更新也会打断按钮的 click 合成。
    if ((e.target as HTMLElement).closest(".pi-swin-ctl, .pi-composer-toolbar-btn")) return;
    bringToFront(sessionId);
    if (!isActive) setActiveSession(sessionId);
  }

  function handleClose() {
    // 关的是激活窗且还有别的窗:焦点交给栈顶剩余窗 —— 否则
    // 背景主区会突然显示本会话(activeSessionWindowed 翻 false)。
    // 全关:背景进空白页,不跳进这个会话的整页。
    const ws = useSessionWindowsStore.getState();
    const remaining = ws.windows.filter((w) => w.sessionId !== sessionId);
    const nextId = isActive && remaining.length > 0
      ? [...ws.stack].reverse().find((k) => remaining.some((w) => w.sessionId === k)) ??
        remaining[remaining.length - 1].sessionId
      : null;
    closeWindow(sessionId);
    if (nextId) {
      ws.bringToFront(nextId);
      setActiveSession(nextId);
    } else if (isActive && remaining.length === 0) {
      setActiveSession(null);
    }
  }

  return (
    <div
      className={`pi-float-panel pi-float-panel--session${isActive ? " pi-float-panel--active" : ""}`}
      ref={panelRef}
      data-open="true"
      data-swin-id={sessionId}
      style={{
        zIndex: z,
        right: `calc(var(--pi-float-right, 1.25rem) + ${cascade * 24}px)`,
        bottom: `calc(var(--pi-float-bottom, 8.5rem) + ${cascade * 24}px)`,
      }}
      onPointerDownCapture={handleWindowPointerDown}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 顶栏只留隐形拖动带 + 边缘改大小;关闭改到输入框上方工具条。 */}
      <ComposerPanelChrome
        panelRef={panelRef}
        storageKey={`pi-swin-rect:${sessionId}`}
      />
      <div className="pi-swin-body">
        {/* feed 铺满窗体;输入坞叠底;渐隐幕夹在中间(对齐主区 .pi-float-fade)。 */}
        <div className="pi-swin-feed">
          {(attached || mirrorMain) && (
            // 激活且主链路已就位 = 镜像单例 store(与主区逐字节一致);
            // 其余时刻走本窗独立 store + 对账 —— 含激活换绑的过渡期。
            <MessageFeed chatStore={mirrorMain ? useChatStore : chatStore} reserveComposer={false} />
          )}
        </div>
        {/* 顶缘极薄淡化;底幕短淡化 + 不透明遮挡(对齐主区 .pi-float-fade)。 */}
        <div className="pi-swin-fade-top" aria-hidden="true" />
        <div className="pi-swin-fade" aria-hidden="true" />
        <SessionWindowComposer
          sessionId={sessionId}
          disabled={disabled}
          onSend={onSend}
          onSteer={onSteer}
          onAbort={onAbort}
          onClose={handleClose}
        />
      </div>
    </div>
  );
}

interface SessionWindowsHostProps {
  disabled?: boolean;
  onSend: (text: string) => boolean | void;
  onSteer?: (text: string) => void;
  onAbort?: () => void;
}

/** 全部会话小窗的宿主 —— 与聊天面板解耦。 */
export function SessionWindowsHost({ disabled, onSend, onSteer, onAbort }: SessionWindowsHostProps) {
  const windows = useSessionWindowsStore((s) => s.windows);
  const stack = useSessionWindowsStore((s) => s.stack);
  return (
    <>
      {windows.map((w, index) => (
        <SessionWindow
          key={w.sessionId}
          sessionId={w.sessionId}
          z={floatZ(stack, w.sessionId)}
          cascade={index % 6}
          disabled={disabled}
          onSend={onSend}
          onSteer={onSteer}
          onAbort={onAbort}
        />
      ))}
    </>
  );
}

