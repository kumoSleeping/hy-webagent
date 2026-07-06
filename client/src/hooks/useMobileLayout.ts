import { useEffect, useState } from "react";

const MOBILE_MEDIA = "(max-width: 639px)";

function readMobileMatch(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(MOBILE_MEDIA).matches;
}

/** Matches design.css mobile breakpoints — narrow phones / small viewports. */
export function useMobileLayout(): boolean {
  const [isMobile, setIsMobile] = useState(readMobileMatch);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(MOBILE_MEDIA);
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return isMobile;
}
