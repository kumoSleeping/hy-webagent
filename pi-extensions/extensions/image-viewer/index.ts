/**
 * Image Viewer Extension - Describe images using a vision-capable model
 *
 * When the main model doesn't support vision (e.g., DeepSeek), this tool
 * delegates image description to a separate vision-capable model.
 *
 * The vision model is auto-detected from available API keys. Configure it
 * explicitly by setting VISION_MODEL env var (e.g., "xiaomi/mimo-v2-omni").
 *
 * Usage:
 *   "Look at screenshot.png and tell me what's there"
 *   The model will call describe_image to describe the image
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { complete, getModel, getModels, type Model, type Message, type Api } from "@earendil-works/pi-ai/compat";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Preferred vision model in "provider/model" format. Set via env var to override. */
const PREFERRED_VISION_MODEL = process.env.VISION_MODEL || "xiaomi/mimo-v2.5";

/** Fallback vision models to try (provider/model), in priority order. */
const VISION_MODEL_CANDIDATES = [
	// OpenAI
	"openai/gpt-4o",
	"openai/gpt-4o-mini",
	// Anthropic
	"anthropic/claude-sonnet-4-5",
	"anthropic/claude-haiku-4-5",
	"anthropic/claude-opus-4-5",
	// Google
	"google/gemini-2.5-flash",
	"google/gemini-2.5-pro",
	// Xiaomi
	"xiaomi/mimo-v2-omni",
	"xiaomi/mimo-v2.5",
	// OpenRouter
	"openrouter/openai/gpt-4o",
	// xAI
	"xai/grok-4",
];

const SUPPORTED_EXTENSIONS = new Set([
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".bmp",
	".tiff",
	".svg",
]);

const MIME_MAP: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".bmp": "image/bmp",
	".tiff": "image/tiff",
	".svg": "image/svg+xml",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMimeType(ext: string): string {
	return MIME_MAP[ext.toLowerCase()] || "image/png";
}

/**
 * Find a vision-capable model from the built-in catalog.
 * Returns the first match that:
 *  - Accepts image input
 *  - Has an available API key
 */
async function findVisionModel(
	modelRegistry: ExtensionAPI["modelRegistry"] | undefined,
): Promise<{ model: Model<Api>; apiKey: string; headers?: Record<string, string> } | null> {
	// 1. Try user-configured preference
	if (PREFERRED_VISION_MODEL) {
		const [provider, modelId] = PREFERRED_VISION_MODEL.split("/");
		if (provider && modelId) {
			const model = getModel(provider, modelId);
			if (model && model.input.includes("image")) {
				if (modelRegistry) {
					const auth = await modelRegistry.getApiKeyAndHeaders(model);
					if (auth.ok && auth.apiKey) {
						return { model, apiKey: auth.apiKey, headers: auth.headers };
					}
				}
			}
		}
	}

	// 2. Fall back to candidate list
	for (const candidate of VISION_MODEL_CANDIDATES) {
		const [provider, modelId] = candidate.split("/");
		if (!provider || !modelId) continue;

		const model = getModel(provider, modelId);
		if (!model || !model.input.includes("image")) continue;

		if (modelRegistry) {
			const auth = await modelRegistry.getApiKeyAndHeaders(model);
			if (auth.ok && auth.apiKey) {
				return { model, apiKey: auth.apiKey, headers: auth.headers };
			}
		}
	}

	return null;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "describe_image",
		label: "Describe Image",
		description: [
			"Read an image file and get a detailed description of its contents using a vision-capable model.",
			"Use this tool when you need to understand what's in an image file (screenshot, photo, diagram, chart, etc).",
			"If you already have native vision/image viewing capabilities, do NOT use this tool — view the image directly instead.",
			`Supported formats: ${Array.from(SUPPORTED_EXTENSIONS).join(", ")}.`,
			"Set the VISION_MODEL env var to override the auto-detected model (e.g., 'xiaomi/mimo-v2-omni').",
		].join(" "),
		promptSnippet: "Describe the contents of an image file using a separate vision model (screenshot, photo, diagram, etc)",
		promptGuidelines: [
			"Use describe_image to describe images when the user asks about a screenshot, photo, diagram, or any image file. Provide the file path and optionally a specific question about the image.",
			"If you already have native vision/image viewing capabilities, do NOT use this tool — view the image directly instead.",
			"If you need a focused description (e.g., only the error message, only the numbers in a table), specify it in the question parameter.",
		],
		parameters: Type.Object({
			path: Type.String({
				description:
					"Path to the image file to view (e.g., 'screenshot.png', '/tmp/photo.jpg')",
			}),
			question: Type.Optional(
				Type.String({
					description:
						"Specific question about the image. Default: 'Describe this image in detail, including all visible text, elements, layout, and important details.'",
				}),
			),
		}),

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			// 1. Resolve and validate the file path
			const filePath = resolve(ctx.cwd, params.path);
			const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();

			if (!SUPPORTED_EXTENSIONS.has(ext)) {
				return {
					content: [
						{
							type: "text",
							text: `Unsupported image format: ${ext}. Supported: ${Array.from(SUPPORTED_EXTENSIONS).join(", ")}.`,
						},
					],
					details: {},
					isError: true,
				};
			}

			// 2. Read the image file
			let imageBuffer: Buffer;
			try {
				imageBuffer = await readFile(filePath);
			} catch (error: any) {
				return {
					content: [
						{
							type: "text",
							text: `Failed to read image file "${filePath}": ${error.message || error}`,
						},
					],
					details: {},
					isError: true,
				};
			}

			// Enforce a reasonable size limit (20 MB)
			const MAX_SIZE = 20 * 1024 * 1024;
			if (imageBuffer.length > MAX_SIZE) {
				return {
					content: [
						{
							type: "text",
							text: `Image too large (${(imageBuffer.length / 1024 / 1024).toFixed(1)} MB). Maximum is 20 MB.`,
						},
					],
					details: {},
					isError: true,
				};
			}

			// 3. Find a vision-capable model
			const visionModel = await findVisionModel(ctx.modelRegistry);

			if (!visionModel) {
				return {
					content: [
						{
							type: "text",
							text: [
								"No vision-capable model found with a valid API key.",
								"",
								"To use this tool, configure one of the following providers:",
								"  - OpenAI: export OPENAI_API_KEY=...    (gpt-4o, gpt-4o-mini)",
								"  - Anthropic: export ANTHROPIC_API_KEY=... (claude-sonnet-4-5, etc)",
								"  - Google: export GOOGLE_API_KEY=...    (gemini-2.5-flash, etc)",
								"  - Xiaomi: export XIAOMI_API_KEY=...    (mimo-v2-omni, mimo-v2.5)",
								"",
								"Or set VISION_MODEL to override: export VISION_MODEL='xiaomi/mimo-v2-omni'",
							].join("\n"),
						},
					],
					details: {},
					isError: true,
				};
			}

			// 4. Build the prompt
			const question = params.question || "Describe this image in detail. Include all visible text, UI elements, layout structure, colors, and any important details.";

			const base64Data = imageBuffer.toString("base64");
			const mimeType = getMimeType(ext);

			const userMessage: Message = {
				role: "user",
				content: [
					{
						type: "image",
						data: base64Data,
						mimeType,
					},
					{
						type: "text",
						text: question,
					},
				],
				timestamp: Date.now(),
			};

			// 5. Call the vision model
			try {
				const response = await complete(
					visionModel.model,
					{
						systemPrompt: "You are an image description assistant. Describe images accurately and thoroughly. When describing screenshots or UI, note the layout, text content, colors, and interactive elements. When describing photos, note subjects, setting, lighting, and mood. Be concise but complete.",
						messages: [userMessage],
					},
					{
						apiKey: visionModel.apiKey,
						headers: visionModel.headers,
						signal,
					},
				);

				if (response.stopReason === "aborted") {
					return {
						content: [{ type: "text", text: "Image description was cancelled." }],
						details: {},
						isError: true,
					};
				}

				if (response.stopReason === "error") {
					return {
						content: [
							{
								type: "text",
								text: `Vision model error: ${response.errorMessage || "Unknown error"}`,
							},
						],
						details: {},
						isError: true,
					};
				}

				const description = response.content
					.filter((c): c is { type: "text"; text: string } => c.type === "text")
					.map((c) => c.text)
					.join("\n")
					.trim();

				const modelName = `${visionModel.model.provider}/${visionModel.model.id}`;
				const usage = response.usage;
				const cost = usage?.cost?.total;

				return {
					content: [
						{
							type: "text",
							text: [
								`## Image Description (via ${modelName})`,
								"",
								description || "(no description returned)",
								"",
								cost !== undefined
									? `---\n*Cost: $${cost.toFixed(6)}*`
									: "",
							]
								.filter(Boolean)
								.join("\n"),
						},
					],
					details: {
						model: modelName,
						path: filePath,
						format: mimeType,
						size: imageBuffer.length,
						usage: usage
							? {
									input: usage.input,
									output: usage.output,
									cost: usage.cost.total,
								}
							: undefined,
					},
				};
			} catch (error: any) {
				return {
					content: [
						{
							type: "text",
							text: `Vision model call failed: ${error.message || error}`,
						},
					],
					details: {},
					isError: true,
				};
			}
		},
	});
}
