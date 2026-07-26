import { useEffect, useState, type RefObject } from "react";
import { Maximize2, Minimize2, X } from "lucide-react";
import { useComposerPanelStore } from "../../stores/composerPanelStore";

interface ComposerPanelChromeProps {
  /** Label in the header row — same string as the toolbar button title. */
  title: string;
  /** The .pi-float-panel element — measured to decide whether content is clipped. */
  panelRef: RefObject<HTMLDivElement | null>;
}

/** 独立悬浮面板的头部行:标题 / ⤢⤡ / ✕(设计稿 D,无拖拽)。
 * ⤢ 只在贴身内容被截断时出现 —— 看到它就代表「下面还有」。 */
export function ComposerPanelChrome({ title, panelRef }: ComposerPanelChromeProps) {
  const stance = useComposerPanelStore((s) => s.stance);
  const setStance = useComposerPanelStore((s) => s.setStance);
  const closePanel = useComposerPanelStore((s) => s.closePanel);
  const [clipped, setClipped] = useState(false);
  const staged = stance === "stage";

  useEffect(() => {
    const panelEl = panelRef.current;
    if (!panelEl) return;
    let observedScroll: Element | null = null;
    let raf = 0;

    const measure = () => {
      raf = 0;
      const scrollEl = panelEl.querySelector(".pi-panel-body-scroll");
      if (scrollEl !== observedScroll) {
        if (observedScroll) ro?.unobserve(observedScroll);
        observedScroll = scrollEl;
        if (scrollEl) ro?.observe(scrollEl);
      }
      setClipped(scrollEl ? scrollEl.scrollHeight > scrollEl.clientHeight + 1 : false);
    };
    const schedule = () => {
      if (raf === 0) raf = requestAnimationFrame(measure);
    };

    // jsdom(测试)没有 ResizeObserver;MutationObserver 始终可用。
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    ro?.observe(panelEl);
    // Box observers miss content growing behind an already-capped viewport
    // (async history/project loads) — watch the subtree for those.
    const mo = new MutationObserver(schedule);
    mo.observe(panelEl, { childList: true, subtree: true });
    schedule();
    return () => {
      ro?.disconnect();
      mo.disconnect();
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, [panelRef]);

  const stanceHidden = !staged && !clipped;
  return (
    <div className="pi-composer-panel-handle">
      <span className="pi-composer-panel-handle-title">{title}</span>
      <button
        type="button"
        className="pi-composer-panel-handle-btn pi-composer-panel-handle-btn--stance"
        data-hidden={stanceHidden ? "true" : undefined}
        tabIndex={stanceHidden ? -1 : 0}
        onClick={() => setStance(staged ? "hug" : "stage")}
        title={staged ? "回贴身" : "满台"}
        aria-label={staged ? "面板回贴身高度" : "面板铺满聊天区"}
      >
        {staged
          ? <Minimize2 strokeWidth={2} aria-hidden="true" />
          : <Maximize2 strokeWidth={2} aria-hidden="true" />}
      </button>
      <button
        type="button"
        className="pi-composer-panel-handle-btn"
        onClick={() => closePanel()}
        title="关闭"
        aria-label="关闭面板"
      >
        <X strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}
