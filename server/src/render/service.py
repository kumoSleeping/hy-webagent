"""
pi-web-platform 图片渲染微服务
复用 entari-plugin-hyw 的 card-ui 模板 + DrissionPage 渲染管道，无 Entari 框架依赖。

启动: python service.py --port 5151

API:
  POST /api/render
    Headers:
      Accept: image/png  → 返回 PNG 图片
      Accept: text/plain → 返回原始 markdown 文本
    Query:
      filter=final   → 只渲染最终回答
      filter=process → 只渲染搜索/工具过程
      filter=all     → 渲染全部（默认）
    Body (JSON):
      {
        "markdown": "...",
        "title": "可选标题",
        "theme_color": "#ef4444",
        "sections": { "process": "...", "final": "..." }
      }

  POST /api/render/b64
    同上，但返回 JSON { data: "data:image/...;base64,...", base64: "...", mime_type: "..." }

  GET /health
"""
from __future__ import annotations

import argparse
import base64
import io
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import Response, PlainTextResponse
from pydantic import BaseModel
import uvicorn
from loguru import logger

try:
    from card_renderer import get_card_renderer
except (ImportError, ModuleNotFoundError) as error:
    logger.warning("browser renderer unavailable ({}); using Pillow fallback", error)
    from simple_renderer import get_simple_renderer as get_card_renderer

app = FastAPI(title="pi-render", version="1.0.0")

# --- 请求模型 ---

class RenderRequest(BaseModel):
    markdown: str = ""
    title: str = ""
    theme_color: str = "#ef4444"
    sections: Optional[dict] = None  # {"process": "...", "final": "..."}


# --- 工具函数 ---

def _resolve_content(req: RenderRequest, filter_mode: str) -> str:
    if req.sections:
        if filter_mode == "final":
            return req.sections.get("final", req.markdown)
        elif filter_mode == "process":
            return req.sections.get("process", "")
        else:  # all
            parts = []
            if req.sections.get("process"):
                parts.append(req.sections["process"])
            if req.sections.get("final"):
                parts.append("\n\n---\n\n" + req.sections["final"])
            return "\n\n".join(parts) if parts else req.markdown
    return req.markdown


def _make_b64_data_uri(b64: str, mime: str = "image/jpeg") -> str:
    return f"data:{mime};base64,{b64}"


# --- 生命周期 ---

@app.on_event("startup")
async def startup():
    logger.info("pi-render starting (browser will warm up lazily on first request)")
    r = get_card_renderer()
    if r.is_ready:
        logger.info("pi-render: template OK")
    else:
        logger.warning("pi-render: template not found, rendering disabled")


# --- API 路由 ---

@app.get("/health")
async def health():
    r = get_card_renderer()
    return {
        "status": "ok" if r.is_ready else "degraded",
        "service": "pi-render",
        "template_ready": r.is_ready,
    }


@app.post("/api/render")
async def render(request: Request):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    req = RenderRequest(**body)
    filter_mode = request.query_params.get("filter", "all")
    if filter_mode not in ("all", "final", "process"):
        filter_mode = "all"

    content = _resolve_content(req, filter_mode)
    accept = request.headers.get("accept", "")

    # --- text/plain → 返回原始 markdown ---
    if "text/plain" in accept and "image" not in accept:
        return PlainTextResponse(
            content=content,
            headers={"X-Render-Filter": filter_mode},
        )

    # --- 渲染为图片 ---
    if not content.strip():
        empty_png = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        )
        return Response(content=empty_png, media_type="image/png")

    renderer = get_card_renderer()
    b64_jpg = renderer.render_to_b64(content, theme_color=req.theme_color)

    if not b64_jpg:
        raise HTTPException(status_code=500, detail="Render failed")

    if "image/png" in accept:
        from PIL import Image as PILImage
        jpg_bytes = base64.b64decode(b64_jpg)
        img = PILImage.open(io.BytesIO(jpg_bytes))
        png_buf = io.BytesIO()
        img.save(png_buf, format="PNG")
        return Response(
            content=png_buf.getvalue(),
            media_type="image/png",
            headers={"X-Render-Filter": filter_mode},
        )
    else:
        return Response(
            content=base64.b64decode(b64_jpg),
            media_type="image/jpeg",
            headers={"X-Render-Filter": filter_mode},
        )


@app.post("/api/render/b64")
async def render_b64(request: Request):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    req = RenderRequest(**body)
    filter_mode = request.query_params.get("filter", "all")
    if filter_mode not in ("all", "final", "process"):
        filter_mode = "all"

    content = _resolve_content(req, filter_mode)
    accept = request.headers.get("accept", "")

    if "text/plain" in accept and "image" not in accept:
        return {"text": content, "filter": filter_mode}

    if not content.strip():
        return {"error": "empty content"}

    renderer = get_card_renderer()
    b64 = renderer.render_to_b64(content, theme_color=req.theme_color)

    if not b64:
        raise HTTPException(status_code=500, detail="Render failed")

    mime = "image/png" if "image/png" in accept else "image/jpeg"
    return {
        "data": _make_b64_data_uri(b64, mime),
        "base64": b64,
        "mime_type": mime,
        "filter": filter_mode,
    }


def main():
    parser = argparse.ArgumentParser(description="pi-web-platform 图片渲染微服务")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5151)
    args = parser.parse_args()

    print(f"🎨 pi-render service starting on http://{args.host}:{args.port}")
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
