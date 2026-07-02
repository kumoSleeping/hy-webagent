/** Serialize PI tool partialResult / result payloads to plain text for the web client. */

export function toolResultToText(result: unknown): string {
  if (result == null) return "";
  if (typeof result === "string") return result;
  if (Array.isArray(result)) {
    return result
      .map((item) => toolResultToText(item))
      .filter(Boolean)
      .join("\n\n");
  }
  if (typeof result === "object") {
    const obj = result as Record<string, unknown>;
    if ("content" in obj) return toolResultToText(obj.content);
    if ("text" in obj) return String(obj.text ?? "");
    if ("output" in obj) return toolResultToText(obj.output);
    if ("result" in obj) return toolResultToText(obj.result);
    return JSON.stringify(result, null, 2);
  }
  return String(result);
}
