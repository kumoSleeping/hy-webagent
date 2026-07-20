import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright-core";
import { createLogger } from "../logger.js";

const log = createLogger("message-renderer");

const CARD_DIST_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../render-assets/card-dist",
);

export function resolveCardDistDir(): string {
  return CARD_DIST_DIR;
}

function findChromiumExecutable(): string | undefined {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  const candidates = [
    configured,
    chromium.executablePath(),
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ].filter((value): value is string => Boolean(value));
  return candidates.find((candidate) => fs.existsSync(candidate));
}

/** HYW card-ui payload — matches entari_plugin_hyw RenderData. */
function buildRenderData(markdown: string, themeColor: string) {
  return {
    markdown,
    stages: [],
    references: [],
    page_references: [],
    image_references: [],
    stats: {},
    total_time: 0,
    theme_color: themeColor,
  };
}

/**
 * Screenshot the vendored HYW Vue card-ui (560px × zoom 1.5 reading column).
 * Used by both web download and bot remote render APIs.
 */
export class BrowserMessageRenderer {
  private browserPromise: Promise<Browser> | null = null;
  private pagePromise: Promise<Page> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly cardOrigin: string) {}

  private getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      const executablePath = findChromiumExecutable();
      if (!executablePath) {
        throw new Error("Chromium executable not found; set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH");
      }
      this.browserPromise = chromium.launch({
        executablePath,
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      }).catch((error) => {
        this.browserPromise = null;
        throw error;
      });
      log.info(`starting shared Chromium card renderer: ${executablePath}`);
    }
    return this.browserPromise;
  }

  /** Serialize captures to cap Chromium memory use under bursty public calls. */
  render(markdown: string, themeColor = "#ef4444"): Promise<Buffer> {
    const task = this.queue.then(() => this.capture(markdown, themeColor));
    this.queue = task.catch(() => undefined);
    return task;
  }

  private getPage(): Promise<Page> {
    if (!this.pagePromise) {
      this.pagePromise = this.createPage().catch((error) => {
        this.pagePromise = null;
        throw error;
      });
    }
    return this.pagePromise;
  }

  private async createPage(): Promise<Page> {
    const browser = await this.getBrowser();
    // Match HYW ContentRenderer: wide viewport, height grows with content.
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      if (url.startsWith(this.cardOrigin) || url.startsWith("data:") || url.startsWith("blob:")) {
        await route.continue();
      } else {
        await route.abort();
      }
    });
    await page.goto(`${this.cardOrigin}/__render/card/`, { waitUntil: "load", timeout: 20_000 });
    await page.waitForFunction(() => typeof (window as any).updateRenderData === "function");
    return page;
  }

  private async capture(markdown: string, themeColor: string): Promise<Buffer> {
    const page = await this.getPage();
    try {
      const payload = buildRenderData(markdown, themeColor);
      await page.evaluate((data) => {
        (window as any).RENDER_FINISHED = false;
        (window as any).updateRenderData?.(data);
      }, payload);

      await page.waitForFunction(() => (window as any).RENDER_FINISHED === true, undefined, {
        timeout: 15_000,
      });

      const scrollHeight = await page.evaluate(() =>
        Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
      );
      const viewportHeight = Math.min(Math.max(Number(scrollHeight) + 200, 900), 16_000);
      await page.setViewportSize({ width: 1440, height: viewportHeight });

      await page.evaluate(() => {
        document.documentElement.style.overflow = "hidden";
        document.body.style.overflow = "hidden";
      });

      const card = page.locator("#main-container");
      await card.waitFor({ state: "visible" });
      await page.evaluate(() => document.fonts.ready);
      return await card.screenshot({ type: "jpeg", quality: 85, animations: "disabled" });
    } catch (error) {
      this.pagePromise = null;
      await page.close().catch(() => undefined);
      throw error;
    }
  }
}
