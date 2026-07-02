import { describe, it, expect } from "vitest";
import { canSubmitBareSlash, shouldPickSlashFromList } from "./slashSubmit";

describe("canSubmitBareSlash", () => {
  const find = (id: string) => {
    if (id === "model") return { kind: "panel" };
    if (id === "settings") return { kind: "panel" };
    if (id === "name") return { kind: "args" };
    if (id === "dream") return { kind: "extension" };
    if (id === "deploy") return { kind: "prompt" };
    if (id === "skill:review") return { kind: "skill" };
    return undefined;
  };

  it("submits bare /new even when not in the command registry", () => {
    expect(canSubmitBareSlash("/new", find)).toBe(true);
  });

  it("submits toolbar slash commands", () => {
    expect(canSubmitBareSlash("/resume", find)).toBe(true);
  });

  it("requires args for args-kind commands", () => {
    expect(canSubmitBareSlash("/name", find)).toBe(false);
    expect(canSubmitBareSlash("/name foo", find)).toBe(true);
  });

  it("does not submit panel commands without args", () => {
    expect(canSubmitBareSlash("/settings", find)).toBe(false);
  });

  it("submits toolbar panel shortcuts", () => {
    expect(canSubmitBareSlash("/model", find)).toBe(true);
  });

  it("submits SDK extension/prompt/skill commands without args", () => {
    expect(canSubmitBareSlash("/dream", find)).toBe(true);
    expect(canSubmitBareSlash("/deploy", find)).toBe(true);
    expect(canSubmitBareSlash("/skill:review", find)).toBe(true);
  });

  it("forwards unknown bare slash commands to the SDK", () => {
    expect(canSubmitBareSlash("/not-in-registry", find)).toBe(true);
  });
});

describe("shouldPickSlashFromList", () => {
  const compact = { id: "compact", label: "compact" };

  it("picks when the typed id is only a prefix of the filtered match", () => {
    expect(shouldPickSlashFromList("/com", [compact])).toBe(true);
  });

  it("does not pick when the typed id exactly matches a filtered command", () => {
    expect(shouldPickSlashFromList("/compact", [compact])).toBe(false);
  });

  it("does not pick when arguments are already present", () => {
    expect(shouldPickSlashFromList("/compact extra", [compact])).toBe(false);
  });
});
