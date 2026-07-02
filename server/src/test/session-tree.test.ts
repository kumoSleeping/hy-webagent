import { describe, it, expect } from "vitest";
import { buildToolCallMap, mapSessionTree, type ClientTreeNode } from "../pi/session-tree.js";

type FakeEntry = {
  entry: Record<string, unknown>;
  children?: FakeEntry[];
  label?: string;
};

function flattenRoles(nodes: ClientTreeNode[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    out.push(node.role);
    out.push(...flattenRoles(node.children));
  }
  return out;
}

describe("mapSessionTree", () => {
  it("includes tool results and bash executions in default mode", () => {
    const tree: FakeEntry[] = [
      {
        entry: { type: "message", id: "u1", message: { role: "user", content: "run ls" } },
        children: [
          {
            entry: {
              type: "message",
              id: "a1",
              message: {
                role: "assistant",
                content: [{ type: "toolCall", id: "tc1", name: "bash", arguments: { command: "ls -la" } }],
              },
            },
            children: [
              {
                entry: {
                  type: "message",
                  id: "tr1",
                  message: { role: "toolResult", toolCallId: "tc1", toolName: "bash", content: "ok" },
                },
                children: [
                  {
                    entry: {
                      type: "message",
                      id: "bash1",
                      message: { role: "bashExecution", command: "ls -la /tmp" },
                    },
                    children: [
                      {
                        entry: {
                          type: "message",
                          id: "a2",
                          message: { role: "assistant", content: "Done." },
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ];

    const mapped = mapSessionTree(tree as never, "a2");
    expect(flattenRoles(mapped)).toEqual(["user", "tool", "bash", "assistant"]);
    expect(mapped[0].children[0].preview).toContain("[bash:");
    expect(mapped[0].children[0].children[0].preview).toContain("[bash]:");
  });

  it("hides tool-call-only assistant turns unless they are the current leaf", () => {
    const tree: FakeEntry[] = [
      {
        entry: { type: "message", id: "u1", message: { role: "user", content: "hi" } },
        children: [
          {
            entry: {
              type: "message",
              id: "a1",
              message: {
                role: "assistant",
                content: [{ type: "toolCall", id: "tc1", name: "read", arguments: { path: "/tmp/x" } }],
              },
            },
            children: [
              {
                entry: {
                  type: "message",
                  id: "tr1",
                  message: { role: "toolResult", toolCallId: "tc1", toolName: "read", content: "file" },
                },
              },
            ],
          },
        ],
      },
    ];

    const withoutLeaf = mapSessionTree(tree as never, "tr1");
    expect(flattenRoles(withoutLeaf)).toEqual(["user", "tool"]);

    const withLeaf = mapSessionTree(tree as never, "a1");
    expect(flattenRoles(withLeaf)).toEqual(["user", "assistant", "tool"]);
  });

  it("builds a tool call lookup from assistant messages", () => {
    const tree: FakeEntry[] = [
      {
        entry: {
          type: "message",
          id: "a1",
          message: {
            role: "assistant",
            content: [{ type: "toolCall", id: "tc1", name: "grep", arguments: { pattern: "foo", path: "." } }],
          },
        },
      },
    ];
    const map = buildToolCallMap(tree as never);
    expect(map.get("tc1")).toEqual({ name: "grep", arguments: { pattern: "foo", path: "." } });
  });
});
