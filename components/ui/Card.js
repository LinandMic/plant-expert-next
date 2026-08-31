// Generic surface container for the new design system. Interactive cards
// render as a <button> (or <a> when href is given) so they get real
// keyboard focus/activation for free instead of a div+onClick hack.
export default function Card({ as, href, onClick, className = "", children, ...rest }) {
  const classes = ["pe-card", onClick || href ? "pe-card-interactive" : "", className].filter(Boolean).join(" ");

  if (href) {
    return (
      <a href={href} className={classes} {...rest}>
        {children}
      </a>
    );
  }

  if (onClick) {
    return (
      <button type="button" className={classes} onClick={onClick} {...rest}>
        {children}
      </button>
    );
  }

  const Tag = as || "div";
  return (
    <Tag className={classes} {...rest}>
      {children}
    </Tag>
  );
}
