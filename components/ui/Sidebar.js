import { IconLeaf } from "@/components/ui/icons";
import Badge from "@/components/ui/Badge";

function NavLink({ item, isActive }) {
  const Icon = item.icon;
  const content = (
    <>
      <span className="pe-sidebar-link-icon">
        <Icon size={20} />
      </span>
      <span className="pe-sidebar-link-label">{item.label}</span>
      {item.badge ? (
        <span className="pe-sidebar-link-badge">
          <Badge>{item.badge}</Badge>
        </span>
      ) : null}
    </>
  );

  const className = "pe-sidebar-link" + (isActive ? " is-active" : "");

  if (item.kind === "link") {
    return (
      <a href={item.href} className={className} aria-current={isActive ? "page" : undefined}>
        {content}
      </a>
    );
  }

  return (
    <button type="button" className={className} onClick={item.onClick} aria-current={isActive ? "page" : undefined}>
      {content}
    </button>
  );
}

// Desktop/tablet vertical navigation (spec §7-8): a compact icon-only rail
// from 768px, full width with labels from 1024px. Below 768px this renders
// nothing — MobileNav takes over.
export default function Sidebar({ navItems, activeKey }) {
  const mainItems = navItems.filter((item) => item.placement !== "bottom");
  const bottomItems = navItems.filter((item) => item.placement === "bottom");

  return (
    <aside className="pe-sidebar">
      <div>
        <div className="pe-sidebar-logo">
          <IconLeaf size={22} className="pe-sidebar-logo-mark" />
          <span className="pe-sidebar-logo-word">Plant Expert</span>
        </div>
        <nav className="pe-sidebar-nav" aria-label="Navigation principale">
          {mainItems.map((item) => (
            <NavLink key={item.key} item={item} isActive={item.key === activeKey} />
          ))}
        </nav>
      </div>

      {bottomItems.length > 0 && (
        <div className="pe-sidebar-bottom">
          {bottomItems.map((item) => (
            <NavLink key={item.key} item={item} isActive={item.key === activeKey} />
          ))}
        </div>
      )}
    </aside>
  );
}
