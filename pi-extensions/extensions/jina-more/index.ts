import type { ExtensionAPI, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveJinaApiKey } from "../_lib/jina-auth.ts";

// ─── Jina 配置 ───────────────────────────────────────────
const JINA_MCP_URL = "https://mcp.jina.ai/v1";

const JINA_AUTH_HINT =
  'Add Jina to auth.json: { "jina": { "type": "api_key", "key": "jina_..." } } (same file as deepseek/xiaomi keys)';

// ─── 类型 ─────────────────────────────────────────────────
interface MCPToolResult {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  isError?: boolean;
}

// ─── 会话统计（与 response-timer 共享 globalThis）─────────
function addJinaCost(tokens: number) {
  const g = globalThis as Record<string, unknown>;
  g.__jinaCalls  = ((g.__jinaCalls  as number) || 0) + 1;
  g.__jinaTokens = ((g.__jinaTokens as number) || 0) + tokens;
}

// ─── 精确 token 计数（Jina Segmenter API，免费不扣额度）────
async function countTokens(text: string, apiKey: string): Promise<number> {
  try {
    const resp = await fetch("https://api.jina.ai/v1/segment", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: text, tokenizer: "cl100k_base" }),
      signal: AbortSignal.timeout(3000),
    });
    const data = await resp.json() as Record<string, unknown>;
    return (data.num_tokens as number) || 0;
  } catch {
    return 0; // fall back to estimation below
  }
}

// ─── Jina API 调用封装 ───────────────────────────────────
async function callJinaMCP(
  method: string,
  params: Record<string, unknown>,
  apiKey: string
): Promise<MCPToolResult> {
  const response = await fetch(JINA_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name: method, arguments: params },
    }),
  });

  const text = await response.text();
  const dataMatch = text.match(/data:\s*(\{[\s\S]*\})/);
  if (!dataMatch) throw new Error(`Jina MCP 响应解析失败: ${text.slice(0, 200)}`);
  const json = JSON.parse(dataMatch[1]);
  if (json.error) throw new Error(`Jina MCP 错误: ${json.error.message || JSON.stringify(json.error)}`);
  return json.result as MCPToolResult;
}

async function requireJinaApiKey(registry?: ModelRegistry): Promise<string> {
  const key = await resolveJinaApiKey(registry);
  if (!key) {
    throw new Error(`Jina API key not configured. ${JINA_AUTH_HINT}`);
  }
  return key;
}

// ─── 工具注册 ────────────────────────────────────────────
export default function (pi: ExtensionAPI) {

  pi.registerTool({
    name: "parallel_search_web",
    label: "搜索网络",
    description:
      "并行搜索多个关键词获取最新网络信息。适合需要多角度了解一个话题时使用。" +
      "每个搜索可独立设置查询词、结果数量、时间范围、地区和语言。最多 5 个并行搜索。",
    promptSnippet: "并行搜索网络，获取多个角度的最新信息",
    promptGuidelines: [
      "当需要获取实时信息、新闻、最新资料时，优先使用 parallel_search_web",
      "为获得全面视角，尽可能提供 2-3 个不同角度的搜索词（如中英文各一个）",
      "搜索词构建：使用项目内容所贴切的社区术语与原文语言进行搜索——Node.js 生态问题用英文搜 npm/GitHub，前端框架问题搜对应官方文档和论坛，中文政策/新闻类信息用中文搜",
      "时效优先：始终追求最新资料，优先点击近期结果；避免引用过时的版本、已废弃的 API 或旧公告",
      "交叉核实：不要盲信单一来源，用不同搜索词和多个独立来源反复校验关键事实，逐步逼近用户真正想了解的本意",
    ],
    parameters: Type.Object({
      searches: Type.Array(
        Type.Object({
          query: Type.String({ description: "搜索关键词" }),
          num: Type.Optional(Type.Number({ description: "返回结果数，默认 30，范围 1-100" })),
          tbs: Type.Optional(Type.String({ description: "时间过滤" })),
          location: Type.Optional(Type.String({ description: "地区" })),
          gl: Type.Optional(Type.String({ description: "国家代码" })),
          hl: Type.Optional(Type.String({ description: "语言代码" })),
        }),
        { description: "搜索配置数组，最多 5 个" }
      ),
      timeout: Type.Optional(Type.Number({ description: "超时毫秒，默认 30000" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const apiKey = await requireJinaApiKey(ctx?.modelRegistry);
      const result = await callJinaMCP("parallel_search_web", {
        searches: params.searches,
        timeout: params.timeout ?? 30000,
      }, apiKey);
      const textContent = result.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n\n");

      // Jina 搜索固定消耗 10,000 tokens / 次（官方文档明确）
      const tokens = 10000;
      addJinaCost(tokens);

      return {
        content: [{ type: "text", text: textContent || "（无搜索结果）" }],
        details: { isError: result.isError, jinaTokens: tokens },
      };
    },
  });

  pi.registerTool({
    name: "read_url",
    label: "阅读网页",
    description:
      "读取网页或 PDF 内容，转换为干净的 Markdown 格式。适合阅读文章、文档、博客等。" +
      "支持单个 URL 或 URL 数组并行读取。可选提取所有链接或图片。",
    promptSnippet: "读取网页/PDF 内容，转换为 Markdown",
    promptGuidelines: [
      "当需要获取网页具体内容时，使用 read_url",
      "搜索后如果要深入了解某个结果，用 read_url 打开对应链接",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "要读取的网页 URL 或 PDF 链接" }),
      withAllLinks: Type.Optional(Type.Boolean({ description: "是否提取页面所有链接" })),
      withAllImages: Type.Optional(Type.Boolean({ description: "是否提取所有图片" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const apiKey = await requireJinaApiKey(ctx?.modelRegistry);
      const result = await callJinaMCP("read_url", {
        url: params.url,
        withAllLinks: params.withAllLinks ?? false,
        withAllImages: params.withAllImages ?? false,
      }, apiKey);
      const textContent = result.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n\n");

      // Reader 按输出 token 计费 → Segmenter API 精确计数，失败则估算
      let tokens = await countTokens(textContent, apiKey);
      if (tokens === 0) tokens = Math.max(1, Math.round(textContent.length / 3));
      addJinaCost(tokens);

      return {
        content: [{ type: "text", text: textContent || "（无法读取该网页）" }],
        details: { isError: result.isError, jinaTokens: tokens },
      };
    },
  });

}
