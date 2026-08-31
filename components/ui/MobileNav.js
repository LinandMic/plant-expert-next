// Fixed bottom navigation for <768px (spec §9). Shows every item in
// navItems, in order — callers should cap that list at 5 destinations.
// The `emphasis` item (Identifier) gets a subtly raised icon chip, never a
// giant floating button.
export default function MobileNav({ navItems, activeKey }) {
  return (
    <nav className="pe-mobile-nav" aria-label="Navigation principale">
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = item.key === activeKey;
        const className =
          "pe-mobile-nav-item" + (isActive ? " is-active" : "") + (item.emphasis ? " is-emphasis" : "");
        const content = (
          <>
            <span className="pe-mobile-nav-item-icon">
              <Icon size={20} />
            </span>
            <span>{item.label}</span>
          </>
        );

        if (item.kind === "link") {
          return (
            <a key={item.key} href={item.href} className={className} aria-current={isActive ? "page" : undefined}>
              {content}
            </a>
          );
        }

        return (
          <button
            key={item.key}
            type="button"
            className={className}
            onClick={item.onClick}
            aria-current={isActive ? "page" : undefined}
          >
            {content}
          </button>
        );
      })}
    </nav>
  );
}
