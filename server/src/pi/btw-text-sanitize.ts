/** Strip DeepSeek DSML tool-call markup that leaks into text when tools are disabled. */
function stripDsml(text: string): string {
  let out = text;
  let prev: string;
  do {
    prev = out;
    out = out.replace(/<\|DSML\|[^>]*>[\s\S]*?<\/\|DSML\|[^>]*>/g, "");
  } while (out !== prev);
  out = out.replace(/<\/?\|DSML\|[^>]*>/g, "");
  out = out.replace(/<\|DSML\|[\s\S]*$/g, "");
  return out;
}

/** Streaming sanitizer — holds back partial `<|DSML|…` tags split across deltas. */
export class BtwStreamSanitizer {
  private buffer = "";

  push(delta: string): string {
    this.buffer += delta;
    this.buffer = stripDsml(this.buffer);

    const holdFrom = this.buffer.lastIndexOf("<|DSML|");
    if (holdFrom >= 0) {
      const emit = this.buffer.slice(0, holdFrom);
      this.buffer = this.buffer.slice(holdFrom);
      return emit;
    }

    const lt = this.buffer.lastIndexOf("<");
    if (lt >= 0 && lt > this.buffer.length - 12) {
      const emit = this.buffer.slice(0, lt);
      this.buffer = this.buffer.slice(lt);
      return emit;
    }

    const emit = this.buffer;
    this.buffer = "";
    return emit;
  }

  flush(): string {
    const emit = stripDsml(this.buffer);
    this.buffer = "";
    return emit;
  }
}

export function sanitizeBtwAnswer(text: string): string {
  return stripDsml(text).trim();
}
