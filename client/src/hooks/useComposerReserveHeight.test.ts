/** @vitest-environment jsdom */
import { describe, expect, it, beforeEach } from "vitest";
import { measureComposerReserveHeight } from "./useComposerReserveHeight";

describe("measureComposerReserveHeight", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.documentElement.style.setProperty("--pi-composer-fade", "80px");
  });

  it("includes toolbar overflow above the interactive shell box", () => {
    document.body.innerHTML = `
      <div class="pi-interactive-shell" style="position:absolute;bottom:0;height:200px;width:400px;">
        <div class="pi-composer-dock">
          <div class="pi-composer-shell" style="height:120px;">
            <div class="pi-composer-toolbar" style="position:absolute;bottom:100%;height:32px;width:200px;"></div>
          </div>
        </div>
      </div>
    `;

    const shell = document.querySelector(".pi-interactive-shell") as HTMLElement;
    shell.getBoundingClientRect = () =>
      ({ top: 100, bottom: 300, left: 0, right: 400, width: 400, height: 200, x: 0, y: 100, toJSON: () => ({}) }) as DOMRect;

    const toolbar = document.querySelector(".pi-composer-toolbar") as HTMLElement;
    toolbar.getBoundingClientRect = () =>
      ({ top: 68, bottom: 100, left: 0, right: 200, width: 200, height: 32, x: 0, y: 68, toJSON: () => ({}) }) as DOMRect;

    // footprint 300 - 68 = 232, + fade 80 = 312
    expect(measureComposerReserveHeight()).toBe(312);
  });
});
