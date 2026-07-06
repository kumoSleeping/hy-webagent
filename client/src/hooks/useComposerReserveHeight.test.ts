/** @vitest-environment jsdom */
import { describe, expect, it, beforeEach } from "vitest";
import { measureComposerReserveHeight, readRootCssLengthPx } from "./useComposerReserveHeight";

describe("readRootCssLengthPx", () => {
  beforeEach(() => {
    document.documentElement.style.setProperty("--pi-composer-fade", "80px");
  });

  it("converts rem/px variables to pixels, not parseFloat truncation", () => {
    document.documentElement.style.setProperty("--pi-composer-fade", "2rem");
    const px = readRootCssLengthPx("--pi-composer-fade", 0);
    expect(px).toBeGreaterThan(10);
    expect(px).not.toBe(2);
  });
});

describe("measureComposerReserveHeight", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.documentElement.style.setProperty("--pi-composer-fade", "80px");
  });

  it("includes toolbar bar above the interactive shell box, not popup panels", () => {
    document.body.innerHTML = `
      <div class="pi-interactive-shell" style="position:absolute;bottom:0;height:200px;width:400px;">
        <div class="pi-composer-dock">
          <div class="pi-composer-shell" style="height:120px;">
            <div class="pi-composer-toolbar" style="position:absolute;bottom:100%;height:32px;width:200px;">
              <div class="pi-composer-toolbar-bar" style="height:32px;width:200px;"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    const shell = document.querySelector(".pi-interactive-shell") as HTMLElement;
    shell.getBoundingClientRect = () =>
      ({ top: 100, bottom: 300, left: 0, right: 400, width: 400, height: 200, x: 0, y: 100, toJSON: () => ({}) }) as DOMRect;

    const toolbarBar = document.querySelector(".pi-composer-toolbar-bar") as HTMLElement;
    toolbarBar.getBoundingClientRect = () =>
      ({ top: 68, bottom: 100, left: 0, right: 200, width: 200, height: 32, x: 0, y: 68, toJSON: () => ({}) }) as DOMRect;

    // footprint 300 - 68 = 232, + fade 80 = 312
    expect(measureComposerReserveHeight()).toBe(312);
  });
});
