"""
独立浏览器卡片渲染器 — 从 entari_plugin_pi_hyw 提取，去除 Entari 框架依赖。
将 markdown 渲染为 card-ui 风格的 JPG/PNG 图片。
"""
from __future__ import annotations

import base64
import io
import json
from pathlib import Path

from loguru import logger
from PIL import Image as PILImage

from browser_manager import get_shared_browser


# --- card-dist 模板路径 ---
_CARD_DIST = Path("/Users/kumo/git/kumocode_v2/entari_plugin_pi_hyw/browser/assets/card-dist/index.html")


def compress_image_b64(b64: str, quality: int = 85, max_width: int = 1440) -> str:
    """Compress base64 JPG with PIL."""
    try:
        img_bytes = base64.b64decode(b64)
        img = PILImage.open(io.BytesIO(img_bytes))
        if img.width > max_width:
            ratio = max_width / img.width
            img = img.resize((max_width, int(img.height * ratio)), PILImage.Resampling.LANCZOS)
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        output = io.BytesIO()
        img.save(output, format="JPEG", quality=quality, optimize=True)
        return base64.b64encode(output.getvalue()).decode()
    except Exception:
        return b64


class CardRenderer:
    """Markdown → card-ui 图片渲染器。使用 DrissionPage + Vue 模板。"""

    def __init__(self, template_path: str | Path | None = None):
        self._manager = None  # 惰性初始化
        self._template_path = Path(template_path) if template_path else _CARD_DIST
        if self._template_path.exists():
            logger.info(f"CardRenderer: loaded template ({self._template_path.stat().st_size} bytes)")
        else:
            logger.warning(f"CardRenderer: template not found at {self._template_path}")

    def _ensure_browser(self):
        if self._manager is None:
            self._manager = get_shared_browser(auto_start=True)

    @property
    def is_ready(self) -> bool:
        return self._template_path.exists()

    def render_to_b64(self, markdown: str, theme_color: str = "#ef4444") -> str | None:
        """渲染 markdown 为 base64 JPG。失败返回 None。"""
        if not self._template_path.exists():
            return None

        self._ensure_browser()
        tab = None
        try:
            page = self._manager.page
            if not page:
                return None

            tab = page.new_tab(self._template_path.as_uri())
            tab.ele("#app", timeout=5)

            render_data = {
                "markdown": markdown,
                "total_time": 0,
                "stages": [],
                "references": [],
                "page_references": [],
                "image_references": [],
                "stats": {},
                "theme_color": theme_color,
            }

            tab.run_js(f"window.updateRenderData({json.dumps(render_data, ensure_ascii=False)})")
            self._wait_render(tab)

            scroll_height = tab.run_js(
                "return Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);"
            )
            viewport_h = min(int(scroll_height) + 200, 15000)
            tab.run_cdp(
                "Emulation.setDeviceMetricsOverride",
                width=1440, height=viewport_h, deviceScaleFactor=1, mobile=False,
            )

            self._hide_scrollbars(tab)
            tab.run_js("document.documentElement.style.overflow = 'hidden';")
            tab.run_js("document.body.style.overflow = 'hidden';")

            main_ele = tab.ele("#main-container", timeout=5)
            if main_ele:
                b64 = main_ele.get_screenshot(as_base64="jpg")
                return compress_image_b64(b64)
            return tab.get_screenshot(as_base64="jpg", full_page=False)

        except Exception as e:
            logger.error(f"CardRenderer: render failed: {e}")
            return None
        finally:
            if tab:
                try:
                    tab.close()
                except Exception:
                    pass

    def _wait_render(self, tab, timeout: float = 12.0):
        import time as pytime
        start = pytime.time()
        while pytime.time() - start < timeout:
            if tab.run_js("return window.RENDER_FINISHED"):
                return
            pytime.sleep(0.1)
        logger.warning("CardRenderer: RENDER_FINISHED timeout")

    @staticmethod
    def _hide_scrollbars(tab):
        try:
            tab.run_cdp("Emulation.setScrollbarsHidden", hidden=True)
            tab.run_js("""
                const style = document.createElement('style');
                style.textContent = `
                    ::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
                    * { -ms-overflow-style: none !important; scrollbar-width: none !important; }
                `;
                document.head.appendChild(style);
            """)
        except Exception:
            pass


# 全局单例
_card_renderer: CardRenderer | None = None


def get_card_renderer() -> CardRenderer:
    global _card_renderer
    if _card_renderer is None:
        _card_renderer = CardRenderer()
    return _card_renderer
