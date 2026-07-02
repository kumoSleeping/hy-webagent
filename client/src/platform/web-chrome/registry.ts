import type { WebChromeRegion, WebChromeSlot } from "./types";

const slots: WebChromeSlot[] = [];

export function registerWebChromeSlot(slot: WebChromeSlot): () => void {
  slots.push(slot);
  slots.sort((a, b) => a.order - b.order);
  return () => {
    const idx = slots.findIndex((s) => s.id === slot.id);
    if (idx >= 0) slots.splice(idx, 1);
  };
}

export function getWebChromeSlots(region?: WebChromeRegion): WebChromeSlot[] {
  if (!region) return [...slots];
  return slots.filter((s) => s.region === region);
}
