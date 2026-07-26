import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { X } from "lucide-react";

interface ComposerPanelChromeProps {
  /** Label in the header row — same string as the toolbar button title. */
  title: string;
  /** The .pi-float-panel element — dragged / resized / persisted as one unified card. */
  panelRef: RefObject<HTMLDivElement | null>;
  /** localStorage slot — 每扇窗传自己的 key,几何互不串。 */
  storageKey?: string;
  /** 标题前的插槽(红 ✕ 之后);按钮不触发拖动(closest 守卫)。 */
  leading?: ReactNode;
  /** 标题后的插槽(右侧控制钮);同样不触发拖动。 */
  trailing?: ReactNode;
  /** 给了就渲染标题栏左端的主题红矩形 ✕ —— 统一窗口套件的唯一关闭钮。 */
  onClose?: () => void;
  /** 红 ✕ 的 title/aria 文案(默认「关闭」)。 */
  closeLabel?: string;
}

/** 统一浮窗套件:标题栏(按住拖动)+ 左端红 ✕ + 四周边缘拖拽改大小
 * (左/右/下三边 + 下两角 + 右上角;顶栏留给移动)。右下角握把已删 ——
 * 功能全走边缘,不再画提示角。几何存 localStorage;默认(没拖过)由
 * CSS 右贴 composer 右缘。 */

const DEFAULT_RECT_KEY = "pi-float-panel-rect-v1";
const MIN_W = 240;
const MIN_H = 160;
/** 允许出界,但四周始终留这么多像素可抓(顶部完全不许出,否则抓不回来)。 */
const GRAB = 56;

interface PanelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ResizeEdges {
  l?: boolean;
  r?: boolean;
  t?: boolean;
  b?: boolean;
}

function readSavedRect(key: string): PanelRect | null {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "null") as PanelRect | null;
    if (!raw) return null;
    if ([raw.x, raw.y, raw.w, raw.h].some((n) => typeof n !== "number" || !Number.isFinite(n))) {
      return null;
    }
    return { x: raw.x, y: raw.y, w: raw.w, h: raw.h };
  } catch {
    return null;
  }
}

function clampRect(r: PanelRect): PanelRect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(Math.max(r.w, MIN_W), vw);
  const h = Math.min(Math.max(r.h, MIN_H), vh);
  return {
    x: Math.min(Math.max(r.x, GRAB - w), vw - GRAB),
    y: Math.min(Math.max(r.y, 0), vh - 40),
    w,
    h,
  };
}

function applyRect(el: HTMLElement, r: PanelRect) {
  el.dataset.free = "true";
  el.style.left = `${r.x}px`;
  el.style.top = `${r.y}px`;
  el.style.width = `${r.w}px`;
  el.style.height = `${r.h}px`;
}

function currentRect(el: HTMLElement): PanelRect {
  const rect = el.getBoundingClientRect();
  return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
}

/** 边缘拖拽命中带布点:左/右/下三边、下两角、右上角(左上是红 ✕ 的地盘)。 */
const RESIZE_ZONES: ReadonlyArray<readonly [string, ResizeEdges]> = [
  ["l", { l: true }],
  ["r", { r: true }],
  ["b", { b: true }],
  ["bl", { l: true, b: true }],
  ["br", { r: true, b: true }],
  ["tr", { r: true, t: true }],
];

export function ComposerPanelChrome({
  title,
  panelRef,
  storageKey = DEFAULT_RECT_KEY,
  leading,
  trailing,
  onClose,
  closeLabel = "关闭",
}: ComposerPanelChromeProps) {
  const interactRef = useRef<
    | { mode: "drag"; grabX: number; grabY: number }
    | { mode: "resize"; edges: ResizeEdges }
    | null
  >(null);

  // 打开即恢复上次几何(钳到当前窗口);窗口缩放时把出界的卡拉回可抓范围。
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const saved = readSavedRect(storageKey);
    if (saved) applyRect(el, clampRect(saved));
    const onWindowResize = () => {
      if (el.dataset.free === "true") applyRect(el, clampRect(currentRect(el)));
    };
    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, [panelRef, storageKey]);

  function persist() {
    const el = panelRef.current;
    if (!el) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(currentRect(el)));
    } catch {
      // 存储不可用(隐私模式等):本次会话内仍生效,只是不记忆。
    }
  }

  /** 任何拖动/改大小都先把当前视觉位置冻结成自由坐标(脱离默认右贴锚)。 */
  function freeze(el: HTMLElement): PanelRect {
    const r = currentRect(el);
    applyRect(el, r);
    return r;
  }

  function beginDrag(e: React.PointerEvent<HTMLDivElement>) {
    // 头部的控制钮(红 ✕ / leading / trailing)不触发拖动。
    if ((e.target as HTMLElement).closest("button")) return;
    const el = panelRef.current;
    if (!el) return;
    const r = freeze(el);
    interactRef.current = { mode: "drag", grabX: e.clientX - r.x, grabY: e.clientY - r.y };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function beginResize(e: React.PointerEvent<HTMLDivElement>, edges: ResizeEdges) {
    const el = panelRef.current;
    if (!el) return;
    freeze(el);
    interactRef.current = { mode: "resize", edges };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const el = panelRef.current;
    const act = interactRef.current;
    if (!el || !act) return;
    const rect = el.getBoundingClientRect();
    if (act.mode === "drag") {
      applyRect(el, clampRect({ x: e.clientX - act.grabX, y: e.clientY - act.grabY, w: rect.width, h: rect.height }));
    } else {
      // 各边独立跟手;拖左/上边时对缘钉住(x/y 与 w/h 联动)。
      let x = rect.left;
      let y = rect.top;
      let w = rect.width;
      let h = rect.height;
      if (act.edges.r) w = e.clientX - rect.left;
      if (act.edges.b) h = e.clientY - rect.top;
      if (act.edges.l) {
        const nx = Math.min(e.clientX, rect.right - MIN_W);
        w = rect.right - nx;
        x = nx;
      }
      if (act.edges.t) {
        const ny = Math.min(e.clientY, rect.bottom - MIN_H);
        h = rect.bottom - ny;
        y = ny;
      }
      applyRect(el, clampRect({ x, y, w, h }));
    }
  }

  function endInteract() {
    if (interactRef.current) persist();
    interactRef.current = null;
  }

  return (
    <>
      <div
        className="pi-composer-panel-handle"
        onPointerDown={beginDrag}
        onPointerMove={onPointerMove}
        onPointerUp={endInteract}
        onPointerCancel={endInteract}
      >
        {onClose && (
          <button
            type="button"
            className="pi-swin-ctl pi-swin-ctl--close"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            title={closeLabel}
            aria-label={closeLabel}
          >
            <X strokeWidth={2} aria-hidden="true" />
          </button>
        )}
        {leading}
        <span className="pi-composer-panel-handle-title">{title}</span>
        {trailing}
      </div>
      {RESIZE_ZONES.map(([side, edges]) => (
        <div
          key={side}
          className={`pi-float-panel-edge pi-float-panel-edge--${side}`}
          aria-hidden="true"
          onPointerDown={(e) => beginResize(e, edges)}
          onPointerMove={onPointerMove}
          onPointerUp={endInteract}
          onPointerCancel={endInteract}
        />
      ))}
    </>
  );
}
