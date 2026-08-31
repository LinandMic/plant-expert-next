export default function PageHeader({ title, subtitle, actions }) {
  return (
    <header className="pe-page-header">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 className="pe-page-header-title">{title}</h1>
          {subtitle && <p className="pe-page-header-subtitle">{subtitle}</p>}
        </div>
        {actions && <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>{actions}</div>}
      </div>
    </header>
  );
}
