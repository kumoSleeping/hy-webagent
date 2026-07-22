/** Marker format for large pasted/compressed text shown in the composer and message feed. */
const MARKER_OPEN = "[";
const MARKER_CLOSE = "]";
const MARKER_ELLIPSIS = "...";
const MARKER_SEP = " · ";
const MARKER_UNIT = "chars";

const MARKER_REGEX = /\[[^\]]* · \d+chars\]/g;

/** Build a compressed-text marker for a given character count. */
export function createCompressedMarker(length: number, label = MARKER_ELLIPSIS): string {
  return `${MARKER_OPEN}${label}${MARKER_SEP}${length}${MARKER_UNIT}${MARKER_CLOSE}`;
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
  label?: string,
): { text: string; position: number; marker: string } {
  const marker = createCompressedMarker(pastedLength, label);
  const newText = text.slice(0, position) + marker + text.slice(selectionEnd);
  return { text: newText, position: position + marker.length, marker };
}

/** Replace display markers with their original pasted payload before sending. */
export function expandCompressedMarkers(text: string, payloads: ReadonlyMap<string, string>): string {
  return text.replace(MARKER_REGEX, (marker) => payloads.get(marker) ?? marker);
}

const PASTE_BLOCK_START = "<<<PI_PASTE_START";
const PASTE_BLOCK_END = "<<<PI_PASTE_END>>>";
const PASTE_BLOCK_HEADER = /<<<PI_PASTE_START chars=(\d+) marker=([^>]+)>>>\r?\n/g;

/** Preserve pasted-text boundaries in the model/session payload without hiding its contents. */
export function serializeCompressedMarkers(text: string, payloads: ReadonlyMap<string, string>): string {
  return text.replace(MARKER_REGEX, (marker) => {
    const payload = payloads.get(marker);
    if (payload == null) return marker;
    return `${PASTE_BLOCK_START} chars=${payload.length} marker=${encodeURIComponent(marker)}>>>\n${payload}${PASTE_BLOCK_END}`;
  });
}

/** Restore persisted pasted-text payloads to compact markers for chat display. */
export function collapseSerializedPastes(text: string): string {
  let cursor = 0;
  let collapsed = "";
  PASTE_BLOCK_HEADER.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PASTE_BLOCK_HEADER.exec(text)) !== null) {
    const payloadLength = Number(match[1]);
    const payloadStart = PASTE_BLOCK_HEADER.lastIndex;
    const payloadEnd = payloadStart + payloadLength;
    if (!Number.isSafeInteger(payloadLength) || payloadLength < 0 || text.slice(payloadEnd, payloadEnd + PASTE_BLOCK_END.length) !== PASTE_BLOCK_END) {
      continue;
    }
    let marker: string;
    try {
      marker = decodeURIComponent(match[2]!);
    } catch {
      continue;
    }
    collapsed += text.slice(cursor, match.index) + marker;
    cursor = payloadEnd + PASTE_BLOCK_END.length;
    PASTE_BLOCK_HEADER.lastIndex = cursor;
  }
  return cursor === 0 ? text : collapsed + text.slice(cursor);
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
