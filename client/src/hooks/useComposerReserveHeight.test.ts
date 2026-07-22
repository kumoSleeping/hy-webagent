/** @vitest-environment jsdom */
import { describe, expect, it, beforeEach } from "vitest";
import { measureComposerReserveHeight } from "./useComposerReserveHeight";

describe("measureComposerReserveHeight", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.documentElement.style.setProperty("--pi-composer-fade", "80px");
  });

  it("reserves only from the composer top edge to the shell bottom", () => {
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

    const composer = document.querySelector(".pi-composer-shell") as HTMLElement;
    composer.getBoundingClientRect = () =>
      ({ top: 180, bottom: 300, left: 0, right: 400, width: 400, height: 120, x: 0, y: 180, toJSON: () => ({}) }) as DOMRect;

    expect(measureComposerReserveHeight()).toBe(120);
  });
});
