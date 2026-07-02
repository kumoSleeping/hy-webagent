import type { ComponentType } from "react";

/** Platform-owned UI regions — not PI extension widgets or agent footer. */
export type WebChromeRegion = "left" | "center" | "right";

export interface WebChromeSlot {
  id: string;
  region: WebChromeRegion;
  /** Lower numbers render first within a region. */
  order: number;
  component: ComponentType;
}
