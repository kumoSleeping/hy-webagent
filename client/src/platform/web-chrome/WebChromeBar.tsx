import { getWebChromeSlots } from "./registry";
import type { WebChromeRegion } from "./types";

function Region({ region }: { region: WebChromeRegion }) {
  const items = getWebChromeSlots(region);
  if (items.length === 0) return null;

  return (
    <div className={`pi-web-chrome-region pi-web-chrome-region--${region}`}>
      {items.map(({ id, component: Component }) => (
        <div key={id} className="pi-web-chrome-item" data-slot={id}>
          <Component />
        </div>
      ))}
    </div>
  );
}

/** Fixed platform footer — Web-owned chrome, separate from PI StatusBar. */
export function WebChromeBar() {
  return (
    <footer className="pi-web-chrome-bar" aria-label="Platform">
      <Region region="left" />
      <Region region="center" />
      <Region region="right" />
    </footer>
  );
}
