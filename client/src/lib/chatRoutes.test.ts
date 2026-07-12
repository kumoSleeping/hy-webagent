import { describe, it, expect } from "vitest";
import { chatPath, groupPath, parseGroupPath, parseSessionIdFromPath } from "./chatRoutes";

describe("chatRoutes", () => {
  it("builds and parses session paths", () => {
    const id = "019f1104-1cf9-7d93-a733-eb4e4f5be525";
    const path = chatPath(id);
    expect(path).toBe(`/chat/${id}`);
    expect(parseSessionIdFromPath(path)).toBe(id);
  });

  it("returns null for non-chat paths", () => {
    expect(parseSessionIdFromPath("/")).toBeNull();
    expect(parseSessionIdFromPath("/chat")).toBeNull();
    expect(parseSessionIdFromPath("/api/sessions")).toBeNull();
  });

  it("builds bot-qualified group paths without colliding with normal chat routes", () => {
    expect(groupPath("kgy", "666808414")).toBe("/kgy/666808414");
    expect(parseGroupPath("/kgy/666808414")).toEqual({ botSlug: "kgy", channelId: "666808414" });
    expect(parseGroupPath("/chat/anything")).toBeNull();
    expect(parseGroupPath("/preview/anything")).toBeNull();
  });
});
