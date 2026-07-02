const LOADER_ID = "pi-global-loader";

/** Toggle the document-level loader without remounting the spinner element. */
export function setGlobalLoaderActive(active: boolean): void {
  const el = document.getElementById(LOADER_ID);
  if (!el) return;
  el.classList.toggle("pi-loading-gate--active", active);
  el.setAttribute("aria-hidden", active ? "false" : "true");
  el.querySelector<HTMLElement>(".pi-loading-screen")?.setAttribute("aria-busy", String(active));
}
