import { describe, expect, it } from "vitest";
import {
  createCompressedMarker,
  collapseSerializedPastes,
  expandCompressedMarkers,
  findMarkerBounds,
  insertCompressedMarker,
  isCompressedMarker,
  removeMarker,
  serializeCompressedMarkers,
  splitTextWithMarkers,
} from "./compressedText";

describe("compressedText", () => {
  it("creates an English-bracketed marker", () => {
    expect(createCompressedMarker(123)).toBe("[... · 123chars]");
  });

  it("detects a marker", () => {
    expect(isCompressedMarker("[... · 123chars]")).toBe(true);
    expect(isCompressedMarker("hello [... · 123chars]")).toBe(false);
    expect(isCompressedMarker("[... · 123 chars]")).toBe(false);
  });

  it("finds a marker at or touching a position", () => {
    const text = "foo [... · 300chars] bar";
    expect(findMarkerBounds(text, 0)).toBeNull();
    const bounds = findMarkerBounds(text, 8);
    expect(bounds).toEqual({ start: 4, end: 20 });
    expect(findMarkerBounds(text, 20)).toEqual(bounds);
  });

  it("removes a marker", () => {
    const text = "foo [... · 300chars] bar";
    const result = removeMarker(text, 8);
    expect(result?.text).toBe("foo  bar");
    expect(result?.position).toBe(4);
  });

  it("inserts a marker at the cursor position", () => {
    const text = "hello world";
    const result = insertCompressedMarker(text, 6, 6, 400);
    expect(result.text).toBe("hello [... · 400chars]world");
    expect(result.position).toBe(22);
    expect(result.marker).toBe("[... · 400chars]");
  });

  it("expands a pasted marker back to its complete payload before send", () => {
    const marker = createCompressedMarker(400, "Pasted text");
    expect(expandCompressedMarkers(`before ${marker} after`, new Map([[marker, "完整长文本"]])))
      .toBe("before 完整长文本 after");
  });

  it("round-trips a full pasted payload through live and history display", () => {
    const marker = createCompressedMarker(17, "Pasted text");
    const original = "before " + marker + " after";
    const serialized = serializeCompressedMarkers(original, new Map([[marker, "line 1\nline 2 中文"]]));
    expect(serialized).toContain("line 1\nline 2 中文");
    expect(collapseSerializedPastes(serialized)).toBe(original);
  });

  it("splits text into text and marker segments", () => {
    const text = "intro [... · 100chars] outro";
    const parts = splitTextWithMarkers(text);
    expect(parts).toEqual([
      { kind: "text", value: "intro " },
      { kind: "marker", value: "[... · 100chars]" },
      { kind: "text", value: " outro" },
    ]);
  });
});
