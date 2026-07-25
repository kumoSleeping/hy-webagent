import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function barkNotifyPrompt(pi: ExtensionAPI) {
	const barkUrl = process.env.BARK_NOTIFY_URL?.trim().replace(/\/+$/, "");
	if (!barkUrl) return;

	pi.on("before_agent_start", (event) => ({
		systemPrompt: `${event.systemPrompt}\n\n## Bark 通知（必须执行）\n\n- 长任务（部署、多步调试、大型重构或持续数分钟的工作）结束后，必须使用 \`curl -sS "${barkUrl}/<URL 编码标题>/<URL 编码正文>"\` 发送 Bark 通知。\n- 任务过程中需要用户确认、授权或补充信息时，必须先通过同一 Bark 链接发送通知，再在 Pi 中提问。`,
	}));
}
