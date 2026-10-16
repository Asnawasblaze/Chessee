import type { ReactNode } from "react";
import ScrambleText from "../textFx/ScrambleText";
import "./chrome.css";

interface Props {
  href: string;
  label: string;
  variant?: "accent2" | "accent1" | "ghost";
  big?: boolean;
  external?: boolean;
  className?: string;
  icon?: ReactNode;
}

const Arrow = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
  </svg>
);

export default function PillButton({
  href,
  label,
  variant = "accent2",
  big,
  external,
  className = "",
  icon,
}: Props) {
  const v = variant === "accent2" ? "" : ` pill--${variant}`;
  return (
    <a
      className={`pill${v}${big ? " pill--big" : ""} ${className}`}
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      <ScrambleText text={label} />
      <span className="pill-knob">{icon ?? <Arrow />}</span>
    </a>
  );
}
