/**
 * Bot-session-only outbound channel.
 *
 * Chat bots reach the platform over a websocket and, until now, could only
 * hear the agent once: the bridge reassembled the answer from text deltas and
 * posted it after `agent_end`. A minute of tool work looked like a dead bot,
 * and a failure anywhere in that reassembly meant total silence.
 *
 * This extension turns "speaking" into an explicit tool call. The bridge is
 * already subscribed to `tool_execution_start` for this session, and the agent
 * loop emits that event *before* awaiting `execute()`, so the text is on its
 * way to the group by the time this code runs. That ordering is what makes
 * `wait_for_reply` safe: the question is delivered, then the turn blocks.
 *
 * Loaded exclusively via DefaultResourceLoader.extensionFactories for bot
 * sessions — never install under ~/.pi/agent/extensions.
 */
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const SEND_MESSAGE_TOOL = "send_message";

interface SendMessageDetails {
  delivered: boolean;
  waited: boolean;
  reason?: string;
  aborted?: boolean;
  timedOut?: boolean;
}

function toolResult(
  text: string,
  details: SendMessageDetails
): AgentToolResult<SendMessageDetails> {
  return { content: [{ type: "text", text }], details };
}

/** How long a `wait_for_reply` question may hold the turn open. */
const DEFAULT_REPLY_TIMEOUT_MS = 180_000;

export interface BotChannelOptions {
  replyTimeoutMs?: number;
}

const DESCRIPTION = [
  "向当前群聊/频道里的用户发送一条消息。",
  "",
  "这是你与用户对话的唯一通道。除本工具发出的内容外，你输出的任何文字用户都看不到。",
  "",
  "怎么用：",
  '- 能立刻答完的问题：直接调用一次，kind="final"。',
  '- 需要动手做事的（无论活儿大小）：先调用一次 kind="brief"，一句话说明你打算做什么，',
  '  然后去做，做完再调用一次 kind="final" 给结论。中间不要汇报流水账。',
  "- 需要用户拍板才能继续：把已经得出的部分先说了，再带 wait_for_reply=true 提问。",
  "  工具会挂起直到用户回话，返回值就是用户的原话。",
  "",
  '一轮里 kind="final" 只应出现一次，并且必须是最后一条消息。',
].join("\n");

export function createBotChannelFactory(options: BotChannelOptions = {}): ExtensionFactory {
  const replyTimeoutMs = options.replyTimeoutMs ?? DEFAULT_REPLY_TIMEOUT_MS;

  return (pi: ExtensionAPI) => {
    // At most one question can be outstanding: the turn is parked inside
    // execute() while it waits, so a second call cannot start.
    let pending: ((text: string) => void) | null = null;

    pi.on("input", async (event) => {
      const waiter = pending;
      if (!waiter) return { action: "continue" };
      pending = null;
      waiter(event.text);
      // Swallow it. The text becomes the tool's return value, so letting it
      // also queue as a steer would hand the model the same words twice.
      return { action: "handled" };
    });

    pi.registerTool({
      name: SEND_MESSAGE_TOOL,
      label: "发言",
      description: DESCRIPTION,
      promptSnippet: "向群聊用户发送消息（你与用户对话的唯一通道）",
      promptGuidelines: [
        `用户只能看到 ${SEND_MESSAGE_TOOL} 发出的内容；你直接输出的文字不会到达任何人`,
        `动手之前先用 ${SEND_MESSAGE_TOOL}(kind="brief") 说一句你要做什么，别让用户干等`,
        `需要用户决定时用 wait_for_reply=true 提问，不要替用户假设`,
      ],
      // Chat is ordered: a parallel batch could interleave two messages and
      // deliver them out of the order the model wrote them.
      executionMode: "sequential",
      parameters: Type.Object({
        text: Type.String({ description: "要发给用户的消息正文，支持 Markdown" }),
        kind: Type.Optional(
          Type.Union([Type.Literal("brief"), Type.Literal("final")], {
            description:
              'brief=简短即时消息（开工说明、中途说明、提问），final=本轮最终答复。默认 brief',
          })
        ),
        wait_for_reply: Type.Optional(
          Type.Boolean({
            description: "true 时挂起本轮，等用户回话后把原话作为返回值。默认 false",
          })
        ),
      }),
      async execute(_toolCallId, params, signal): Promise<AgentToolResult<SendMessageDetails>> {
        const text = typeof params.text === "string" ? params.text.trim() : "";
        if (!text) {
          return toolResult(`${SEND_MESSAGE_TOOL} 需要非空的 text。`, {
            delivered: false,
            waited: false,
            reason: "empty-text",
          });
        }

        if (!params.wait_for_reply) {
          return toolResult("已发送。", { delivered: true, waited: false });
        }

        const reply = await waitForReply(
          signal,
          replyTimeoutMs,
          (resolve) => {
            pending = resolve;
          },
          () => {
            pending = null;
          }
        );

        if (reply.kind === "reply") {
          return toolResult(reply.text, { delivered: true, waited: true });
        }
        if (reply.kind === "aborted") {
          return toolResult("本轮已被用户中止。", {
            delivered: true,
            waited: true,
            aborted: true,
          });
        }
        return toolResult(
          `用户在 ${Math.round(replyTimeoutMs / 1000)} 秒内没有回话。` +
            "按你自己的最佳判断继续，并在最终答复里说明你替用户做了哪个假设。",
          { delivered: true, waited: true, timedOut: true }
        );
      },
    });
  };
}

type ReplyOutcome =
  | { kind: "reply"; text: string }
  | { kind: "timeout" }
  | { kind: "aborted" };

function waitForReply(
  signal: AbortSignal | undefined,
  timeoutMs: number,
  arm: (resolve: (text: string) => void) => void,
  disarm: () => void
): Promise<ReplyOutcome> {
  return new Promise<ReplyOutcome>((resolve) => {
    let settled = false;
    const finish = (outcome: ReplyOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      disarm();
      resolve(outcome);
    };

    const timer = setTimeout(() => finish({ kind: "timeout" }), timeoutMs);
    const onAbort = () => finish({ kind: "aborted" });

    if (signal?.aborted) {
      finish({ kind: "aborted" });
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    arm((text) => finish({ kind: "reply", text }));
  });
}
