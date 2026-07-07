"""
独立浏览器渲染器 — 从 entari_plugin_pi_hyw 提取，去除 Entari 框架依赖。
负责管理 DrissionPage Chromium 浏览器单例。
"""
from __future__ import annotations

import os
import socket
import threading
from pathlib import Path
from typing import Optional, Any

from loguru import logger
from DrissionPage import ChromiumPage, ChromiumOptions
from DrissionPage.errors import PageDisconnectedError


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


class SharedBrowserManager:
    """Singleton DrissionPage Chromium browser (headless)."""

    _instance: Optional["SharedBrowserManager"] = None
    _lock = threading.Lock()

    def __init__(self, headless: bool = True):
        self.headless = headless
        self._page: Optional[ChromiumPage] = None
        self._starting = False
        self._start_cond = threading.Condition(self._lock)
        self._tab_lock = threading.Lock()

    @classmethod
    def get_instance(cls, headless: bool = True) -> "SharedBrowserManager":
        with cls._lock:
            if cls._instance is None:
                cls._instance = cls(headless=headless)
            return cls._instance

    def start(self) -> bool:
        if self._page is not None:
            try:
                if self._page.run_cdp("Browser.getVersion"):
                    return True
            except (PageDisconnectedError, Exception):
                self._page = None

        with self._start_cond:
            if self._starting:
                while self._starting:
                    self._start_cond.wait()
                return self._page is not None
            self._starting = True

        try:
            logger.info("render browser: starting DrissionPage (headless={})", self.headless)

            co = ChromiumOptions()
            co.headless(True)
            co.set_argument("--no-sandbox")
            co.set_argument("--disable-gpu")
            co.set_argument("--allow-file-access-from-files")
            co.set_argument("--disable-web-security")
            co.set_argument("--hide-scrollbars")
            co.set_argument("--window-size=1280,800")

            import tempfile
            import uuid
            profile_dir = os.path.join(tempfile.gettempdir(), f"pi_render_browser_{uuid.uuid4().hex[:8]}")
            os.makedirs(profile_dir, exist_ok=True)
            co.set_user_data_path(profile_dir)
            co.set_local_port(_find_free_port())

            self._page = ChromiumPage(addr_or_opts=co)
            logger.success("render browser: ready (port={})", self._page.address)
            return True

        except Exception as e:
            logger.error("render browser: start failed: {}", e)
            self._page = None
            raise
        finally:
            with self._start_cond:
                self._starting = False
                self._start_cond.notify_all()

    @property
    def page(self) -> Optional[ChromiumPage]:
        if self._page is None:
            self.start()
        return self._page

    def new_tab(self, url: str = None) -> Any:
        page = self.page
        if page is None:
            raise RuntimeError("Browser not available")
        with self._tab_lock:
            return page.new_tab(url)

    def close(self):
        with self._lock:
            if self._page:
                try:
                    self._page.quit()
                    logger.info("render browser: closed")
                except Exception as e:
                    logger.warning("render browser: close error: {}", e)
                finally:
                    self._page = None


_shared_manager: Optional[SharedBrowserManager] = None


def get_shared_browser(headless: bool = True, auto_start: bool = False) -> SharedBrowserManager:
    global _shared_manager
    if _shared_manager is None:
        _shared_manager = SharedBrowserManager.get_instance(headless=headless)
        if auto_start:
            _shared_manager.start()
    return _shared_manager


def close_shared_browser():
    global _shared_manager
    if _shared_manager:
        _shared_manager.close()
        _shared_manager = None
