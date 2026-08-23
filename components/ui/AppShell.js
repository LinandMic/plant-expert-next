import Sidebar from "@/components/ui/Sidebar";
import MobileNav from "@/components/ui/MobileNav";

// The desktop/tablet/mobile responsive shell (spec §7-10): a sidebar from
// 768px, a fixed bottom nav below that, and a centered content column that
// actually uses the screen from ~1024px up instead of staying phone-width.
export default function AppShell({ navItems, activeKey, topBar, children }) {
  return (
    <div className="pe-shell">
      <Sidebar navItems={navItems} activeKey={activeKey} />
      <div className="pe-shell-main">
        {topBar && <div className="pe-topbar">{topBar}</div>}
        <div className="pe-shell-content">{children}</div>
      </div>
      <MobileNav navItems={navItems} activeKey={activeKey} />
    </div>
  );
}
