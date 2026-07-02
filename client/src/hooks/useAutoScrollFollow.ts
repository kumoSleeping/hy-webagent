import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

const NEAR_BOTTOM_PX = 80;

interface UseAutoScrollFollowOptions {
  /** Re-pin when this value changes (e.g. a new pending turn id). */
  resetKey?: string | null;
}

export function useAutoScrollFollow(options: UseAutoScrollFollowOptions = {}) {
  const { resetKey = null } = options;
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);
  const suppressScrollCheck = useRef(false);
  const touchStartY = useRef<number | null>(null);

  const isNearBottom = useCallback((el: HTMLElement) => {
    return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !shouldAutoScroll.current) return;
    suppressScrollCheck.current = true;
    el.scrollTop = el.scrollHeight;
    requestAnimationFrame(() => {
      suppressScrollCheck.current = false;
    });
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (suppressScrollCheck.current || !el) return;
    shouldAutoScroll.current = isNearBottom(el);
  }, [isNearBottom]);

  useLayoutEffect(() => {
    if (!resetKey) return;
    shouldAutoScroll.current = true;
    scrollToBottom();
  }, [resetKey, scrollToBottom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    function disableAutoScroll() {
      shouldAutoScroll.current = false;
    }

    function onWheel(e: WheelEvent) {
      if (e.deltaY < 0) disableAutoScroll();
    }

    function onTouchStart(e: TouchEvent) {
      touchStartY.current = e.touches[0]?.clientY ?? null;
    }

    function onTouchMove(e: TouchEvent) {
      const y = e.touches[0]?.clientY;
      const start = touchStartY.current;
      if (y != null && start != null && y - start > 8) disableAutoScroll();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "PageUp" || e.key === "ArrowUp" || e.key === "Home") {
        disableAutoScroll();
      }
    }

    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("keydown", onKeyDown);

    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(scrollToBottom);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollToBottom]);

  return { scrollRef, contentRef, scrollToBottom, handleScroll };
}
