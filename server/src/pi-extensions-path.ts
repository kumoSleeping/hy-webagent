import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repo-bundled PI extensions root (`pi-extensions/`). */
export function defaultPiExtensionsRoot(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "../../pi-extensions");
}

export function bundledExtensionsDir(root: string): string {
  return path.join(root, "extensions");
}
