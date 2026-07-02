import { useState, useEffect, useRef, useCallback } from "react";

interface UseKeyboardListNavOptions<T> {
  items: T[];
  onSelect: (item: T, index: number) => void;
  onEscape?: () => void;
  enabled?: boolean;
  initialIndex?: number;
  /** Ignore Enter briefly after mount so opening key doesn't confirm selection */
  enterGraceMs?: number;
}

/**
 * Keyboard-first list navigation: arrow keys move the active (Enter) selection;
 * mouse hover shows a preview highlight without changing the keyboard selection
 * until the user clicks.
 */
export function useKeyboardListNav<T>({
  items,
  onSelect,
  onEscape,
  enabled = true,
  initialIndex = 0,
  enterGraceMs = 200,
}: UseKeyboardListNavOptions<T>) {
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const onSelectRef = useRef(onSelect);
  const onEscapeRef = useRef(onEscape);
  const enterArmedRef = useRef(false);
  onSelectRef.current = onSelect;
  onEscapeRef.current = onEscape;

  useEffect(() => {
    setActiveIndex(initialIndex);
    setHoverIndex(null);
  }, [items.length, initialIndex]);

  // Disarm Enter until grace period passes or user navigates with arrows.
  useEffect(() => {
    if (!enabled || items.length === 0) return;

    enterArmedRef.current = false;
    const timer = window.setTimeout(() => {
      enterArmedRef.current = true;
    }, enterGraceMs);

    return () => window.clearTimeout(timer);
  }, [enabled, items.length, enterGraceMs]);

  useEffect(() => {
    if (!enabled || items.length === 0) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        enterArmedRef.current = true;
        setHoverIndex(null);
        setActiveIndex((i) => (i + 1) % items.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        enterArmedRef.current = true;
        setHoverIndex(null);
        setActiveIndex((i) => (i - 1 + items.length) % items.length);
        return;
      }
      if (e.key === "Enter") {
        if (e.repeat || !enterArmedRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        const idx = activeIndex;
        const item = items[idx];
        if (item) onSelectRef.current(item, idx);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onEscapeRef.current?.();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [enabled, items, activeIndex]);

  useEffect(() => {
    itemRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const setItemRef = useCallback((index: number, el: HTMLElement | null) => {
    itemRefs.current[index] = el;
  }, []);

  const getHighlight = useCallback(
    (index: number) => ({
      isActive: index === activeIndex,
      isHovered: hoverIndex === index && hoverIndex !== activeIndex,
    }),
    [activeIndex, hoverIndex]
  );

  const getMouseHandlers = useCallback(
    (index: number) => ({
      onMouseEnter: () => setHoverIndex(index),
      onMouseLeave: () => setHoverIndex(null),
    }),
    []
  );

  return { activeIndex, hoverIndex, setItemRef, getHighlight, getMouseHandlers, setActiveIndex };
}
