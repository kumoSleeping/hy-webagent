interface StreamCursorProps {
  visible?: boolean;
}

export function StreamCursor({ visible = true }: StreamCursorProps) {
  if (!visible) return null;
  return (
    <span className="inline-block w-[2px] h-[1.1em] bg-[var(--pi-muted)] animate-pulse align-text-bottom ml-0.5" />
  );
}
