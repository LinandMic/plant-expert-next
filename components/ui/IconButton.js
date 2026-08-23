// An icon-only control MUST always carry an aria-label — there is no
// visible text for assistive tech to fall back on otherwise (spec §16).
export default function IconButton({ icon: Icon, label, className = "", ...rest }) {
  return (
    <button type="button" className={["pe-icon-btn", className].filter(Boolean).join(" ")} aria-label={label} {...rest}>
      <Icon size={18} />
    </button>
  );
}
