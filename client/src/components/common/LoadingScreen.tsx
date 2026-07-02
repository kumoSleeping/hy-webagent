import { BrandMark } from "./BrandMark";

interface LoadingScreenProps {
  /** Defaults to the app-wide loading copy. */
  label?: string;
}

/** Full-viewport loading shell — auth gate, session bootstrap, and route sync. */
export function LoadingScreen({ label = "Loading…" }: LoadingScreenProps) {
  return (
    <div className="pi-loading-screen" role="status" aria-live="polite" aria-busy="true">
      <div className="pi-loading-screen-inner">
        <div className="pi-loading-screen-mark" aria-hidden="true">
          <BrandMark size={52} animated />
        </div>
        <p className="pi-loading-screen-label">{label}</p>
      </div>
    </div>
  );
}
