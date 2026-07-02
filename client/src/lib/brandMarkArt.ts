/** Shared geometry + palette for HY-Webagent brand mark assets. */
export const BRAND_MARK_VIEWBOX = "0 0 48 48";

export const BRAND_MARK_LAYOUT = {
  /* Blocky chevron — 45° arms of even width, flat-cut top/bottom ends. */
  chevron: { d: "M6 9 L15 9 L30 24 L15 39 L6 39 L21 24 Z" },
  cursor: { x: 32, y: 32, width: 10, height: 7 },
} as const;

export const BRAND_MARK_COLORS = {
  theme: "#ef4444",
  ink: "#2c2c2e",
} as const;
