import type { MouseEvent, ReactNode, Ref } from "react";

export type PanelListLeading = "icon" | "index" | "check" | "none";

interface PanelListRowProps {
  title: ReactNode;
  /** Secondary trailing text (description / meta), inline with title. */
  detail?: ReactNode;
  /** icon | index | check slot on the left. */
  leading?: ReactNode;
  leadingKind?: PanelListLeading;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onMouseDown?: (e: MouseEvent) => void;
  itemRef?: Ref<HTMLButtonElement>;
  titleAttr?: string;
  className?: string;
}

/** Unified list row: leading + title + detail (command-style inline). */
export function PanelListRow({
  title,
  detail,
  leading,
  leadingKind = leading != null ? "icon" : "none",
  selected = false,
  disabled = false,
  onClick,
  onMouseEnter,
  onMouseLeave,
  onMouseDown,
  itemRef,
  titleAttr,
  className = "",
}: PanelListRowProps) {
  const classNames = [
    "pi-panel-row",
    "pi-panel-list-row",
    selected ? "pi-panel-row--selected" : "",
    !onClick ? "pi-panel-list-row--static" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const leadingNode =
    leading != null && leadingKind !== "none" ? (
      <span className={`pi-panel-list-leading pi-panel-list-leading--${leadingKind}`} aria-hidden="true">
        {leading}
      </span>
    ) : null;

  const textNode = (
    <span className="pi-panel-list-text">
      <span className="pi-panel-list-title">{title}</span>
      {detail != null && detail !== "" ? (
        <span className="pi-panel-list-detail">{detail}</span>
      ) : null}
    </span>
  );

  if (!onClick) {
    return (
      <div className={classNames} data-leading={leadingKind} title={titleAttr}>
        {leadingNode}
        {textNode}
      </div>
    );
  }

  return (
    <button
      ref={itemRef}
      type="button"
      disabled={disabled}
      title={titleAttr}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onMouseDown={onMouseDown}
      className={classNames}
      data-leading={leadingKind}
    >
      {leadingNode}
      {textNode}
    </button>
  );
}
