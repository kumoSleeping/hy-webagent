/**
 * 图片渲染代理 — 将请求转发到 Python 渲染微服务 (pi-render)。
 *
 * Python 服务默认监听 127.0.0.1:5151。
 * 可通过 RENDER_SERVICE_URL 环境变量覆盖。
 */
import { createLogger } from "../logger.js";

const log = createLogger("render-proxy");

const RENDER_SERVICE_URL =
  process.env.RENDER_SERVICE_URL || "http://127.0.0.1:5151";

export function proxyRenderRequest(
  targetPath: string,
  req: any,
  res: any,
): void {
  const url = `${RENDER_SERVICE_URL}${targetPath}${req.url.includes("?") ? "?" + req.url.split("?")[1] : ""}`;

  const headers: Record<string, string> = {};
  if (req.headers["accept"]) headers["Accept"] = req.headers["accept"];
  headers["Content-Type"] = "application/json";

  const body = JSON.stringify(req.body);

  fetch(url, {
    method: "POST",
    headers,
    body,
  })
    .then(async (proxyRes) => {
      const ct = proxyRes.headers.get("content-type") || "application/octet-stream";
      res.status(proxyRes.status).set("Content-Type", ct);

      const renderFilter = proxyRes.headers.get("x-render-filter");
      if (renderFilter) res.set("X-Render-Filter", renderFilter);

      const buf = await proxyRes.arrayBuffer();
      res.send(Buffer.from(buf));
    })
    .catch((err) => {
      log.error(`render proxy failed: ${(err as Error).message}`);
      res.status(502).json({ error: "Render service unavailable", detail: (err as Error).message });
    });
}
