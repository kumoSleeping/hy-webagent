import fs from "node:fs";
import { chromium, type Browser, type Page } from "playwright-core";
import { createLogger } from "../logger.js";

const log = createLogger("message-renderer");

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

export class BrowserMessageRenderer {
  private browserPromise: Promise<Browser> | null = null;
  private pagePromise: Promise<Page> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private renderSequence = 0;

  constructor(private readonly appOrigin: string) {}

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
      log.info(`starting shared Chromium renderer: ${executablePath}`);
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
    const page = await browser.newPage({ viewport: { width: 960, height: 800 }, deviceScaleFactor: 3 });
    // The render document is self-contained. Blocking cross-origin requests
    // prevents Markdown image URLs from turning the public API into an SSRF
    // primitive; links remain visible but are never followed during capture.
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      if (url.startsWith(this.appOrigin) || url.startsWith("data:") || url.startsWith("blob:")) {
        await route.continue();
      } else {
        await route.abort();
      }
    });
    // Vite emits hashed local assets; `load` is sufficient and avoids the
    // fixed network-idle quiet window. The page stays alive between captures.
    await page.goto(`${this.appOrigin}/__render/message`, { waitUntil: "load", timeout: 20_000 });
    await page.waitForFunction(() => document.documentElement.dataset.piRenderReady === "true");
    return page;
  }

  private async capture(markdown: string, themeColor: string): Promise<Buffer> {
    const page = await this.getPage();
    const renderId = `render-${++this.renderSequence}`;
    try {
      await page.evaluate(({ markdown: value, themeColor: color, renderId: id }) => {
        (window as any).__PI_RENDER_MESSAGE__?.({ markdown: value, themeColor: color, renderId: id });
      }, { markdown, themeColor, renderId });
      const card = page.locator(".pi-message-render-card");
      await card.waitFor({ state: "visible" });
      await page.waitForFunction(
        (expected) => document.querySelector(".pi-message-render-card")?.getAttribute("data-render-id") === expected,
        renderId,
      );
      await page.evaluate(() => document.fonts.ready);
      return await card.screenshot({ type: "jpeg", quality: 88, animations: "disabled" });
    } catch (error) {
      this.pagePromise = null;
      await page.close().catch(() => undefined);
      throw error;
    }
  }
}
