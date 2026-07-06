/** Marker format for large pasted/compressed text shown in the composer and message feed. */
const MARKER_OPEN = "[";
const MARKER_CLOSE = "]";
const MARKER_ELLIPSIS = "...";
const MARKER_SEP = " · ";
const MARKER_UNIT = "chars";

const MARKER_REGEX = /\[[^\]]* · \d+chars\]/g;

/** Build a compressed-text marker for a given character count. */
export function createCompressedMarker(length: number): string {
  return `${MARKER_OPEN}${MARKER_ELLIPSIS}${MARKER_SEP}${length}${MARKER_UNIT}${MARKER_CLOSE}`;
}

/** Check whether the entire string is a single compressed marker. */
export function isCompressedMarker(text: string): boolean {
  const matches = text.match(MARKER_REGEX);
  return matches !== null && matches.length === 1 && matches[0] === text;
}

/** Find the start/end indices of the compressed marker at or touching `position`. */
export function findMarkerBounds(text: string, position: number): { start: number; end: number } | null {
  let match: RegExpExecArray | null;
  MARKER_REGEX.lastIndex = 0;
  while ((match = MARKER_REGEX.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (position >= start && position <= end) {
      return { start, end };
    }
  }
  return null;
}

/** Remove the marker touching `position` from `text`, returning the new text and the cursor position. */
export function removeMarker(text: string, position: number): { text: string; position: number } | null {
  const bounds = findMarkerBounds(text, position);
  if (!bounds) return null;
  const newText = text.slice(0, bounds.start) + text.slice(bounds.end);
  return { text: newText, position: bounds.start };
}

/** Insert a compressed marker into `text` at `position`, replacing the selection from `selectionStart` to `selectionEnd`. */
export function insertCompressedMarker(
  text: string,
  position: number,
  selectionEnd: number,
  pastedLength: number,
): { text: string; position: number } {
  const marker = createCompressedMarker(pastedLength);
  const newText = text.slice(0, position) + marker + text.slice(selectionEnd);
  return { text: newText, position: position + marker.length };
}

/** Split text into alternating plain-text and marker segments. */
export function splitTextWithMarkers(text: string): Array<{ kind: "text" | "marker"; value: string }> {
  const out: Array<{ kind: "text" | "marker"; value: string }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  MARKER_REGEX.lastIndex = 0;
  while ((match = MARKER_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      out.push({ kind: "text", value: text.slice(lastIndex, match.index) });
    }
    out.push({ kind: "marker", value: match[0] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    out.push({ kind: "text", value: text.slice(lastIndex) });
  }
  return out;
}
