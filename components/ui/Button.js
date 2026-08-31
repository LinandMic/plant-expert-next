const VARIANT_CLASS = {
  primary: "pe-btn-primary",
  secondary: "pe-btn-secondary",
  ghost: "pe-btn-ghost",
};

export default function Button({ variant = "primary", as, href, className = "", children, ...rest }) {
  const classes = ["pe-btn", VARIANT_CLASS[variant] || VARIANT_CLASS.primary, className].filter(Boolean).join(" ");

  if (href) {
    return (
      <a href={href} className={classes} {...rest}>
        {children}
      </a>
    );
  }

  const Tag = as || "button";
  return (
    <Tag type={Tag === "button" ? "button" : undefined} className={classes} {...rest}>
      {children}
    </Tag>
  );
}
