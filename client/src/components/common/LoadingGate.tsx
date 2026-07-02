import { useLayoutEffect } from "react";
import { setGlobalLoaderActive } from "../../lib/globalLoader";

interface LoadingGateProps {
  active: boolean;
}

/**
 * Drives the persistent #pi-global-loader in index.html — never mounts a new
 * spinner in React, so the CSS rotation is not restarted mid-bootstrap.
 */
export function LoadingGate({ active }: LoadingGateProps) {
  // Keep the document-level loader in sync even if an effect pass is skipped.
  setGlobalLoaderActive(active);

  useLayoutEffect(() => {
    setGlobalLoaderActive(active);
  }, [active]);

  return null;
}
