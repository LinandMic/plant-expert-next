export default function Badge({ children, muted = false, className = "" }) {
  return <span className={["pe-badge", muted ? "pe-badge-muted" : "", className].filter(Boolean).join(" ")}>{children}</span>;
}
