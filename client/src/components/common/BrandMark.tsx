import {
  BRAND_MARK_COLORS,
  BRAND_MARK_LAYOUT,
  BRAND_MARK_VIEWBOX,
} from "../../lib/brandMarkArt";

interface BrandMarkProps {
  size?: number;
  animated?: boolean;
  className?: string;
}

/** HY-Webagent signature mark — transparent tile, ink chevron, theme cursor block. */
export function BrandMark({ size = 40, animated = false, className = "" }: BrandMarkProps) {
  const { chevron, cursor } = BRAND_MARK_LAYOUT;

  return (
    <svg
      className={`pi-brand-mark${animated ? " pi-brand-mark--animated" : ""}${className ? ` ${className}` : ""}`}
      width={size}
      height={size}
      viewBox={BRAND_MARK_VIEWBOX}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d={chevron.d} fill={BRAND_MARK_COLORS.ink} />
      <rect
        className={animated ? "pi-brand-mark-cursor" : undefined}
        x={cursor.x}
        y={cursor.y}
        width={cursor.width}
        height={cursor.height}
        fill={BRAND_MARK_COLORS.theme}
      />
    </svg>
  );
}
