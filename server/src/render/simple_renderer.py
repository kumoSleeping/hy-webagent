"""Browser-free Markdown card renderer used when DrissionPage is unavailable."""
from __future__ import annotations

import base64
import io
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


FONT_CANDIDATES = (
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
)


def _font(size: int):
    for candidate in FONT_CANDIDATES:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size=size)
    return ImageFont.load_default()


def _plain(markdown: str) -> str:
    text = re.sub(r"```(?:\w+)?\n?", "", markdown)
    text = re.sub(r"!\[([^]]*)\]\([^)]+\)", r"[图片] \1", text)
    text = re.sub(r"\[([^]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"^\s{0,3}#{1,6}\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"[*_~`]", "", text)
    return text.strip()


def _wrap(draw: ImageDraw.ImageDraw, text: str, font, width: int) -> list[str]:
    lines: list[str] = []
    for paragraph in text.splitlines() or [""]:
        if not paragraph:
            lines.append("")
            continue
        current = ""
        for char in paragraph:
            candidate = current + char
            if current and draw.textlength(candidate, font=font) > width:
                lines.append(current)
                current = char
            else:
                current = candidate
        lines.append(current)
    return lines


class SimpleCardRenderer:
    is_ready = True

    def render_to_b64(self, markdown: str, theme_color: str = "#ef4444") -> str | None:
        content = _plain(markdown)
        if not content:
            return None
        width, padding = 1080, 72
        font = _font(30)
        probe = Image.new("RGB", (width, 100), "white")
        draw = ImageDraw.Draw(probe)
        lines = _wrap(draw, content, font, width - padding * 2)
        line_height = 46
        height = max(240, padding * 2 + len(lines) * line_height + 28)
        image = Image.new("RGB", (width, height), "#f7f7f5")
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle((28, 28, width - 28, height - 28), radius=24, fill="white", outline="#ddddda", width=2)
        try:
            accent = theme_color if re.fullmatch(r"#[0-9a-fA-F]{6}", theme_color) else "#ef4444"
        except TypeError:
            accent = "#ef4444"
        draw.rounded_rectangle((28, 28, 40, height - 28), radius=6, fill=accent)
        y = padding
        for line in lines:
            draw.text((padding, y), line, font=font, fill="#202124")
            y += line_height
        output = io.BytesIO()
        image.save(output, format="JPEG", quality=90, optimize=True)
        return base64.b64encode(output.getvalue()).decode("ascii")


_renderer = SimpleCardRenderer()


def get_simple_renderer() -> SimpleCardRenderer:
    return _renderer
