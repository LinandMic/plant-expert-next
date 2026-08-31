import { IconArrowRight } from "@/components/ui/icons";

export default function SectionHeader({ title, actionLabel, onAction, href }) {
  return (
    <div className="pe-section-header">
      <h2 className="pe-section-header-title">{title}</h2>
      {actionLabel &&
        (href ? (
          <a className="pe-section-header-action" href={href}>
            {actionLabel} <IconArrowRight size={14} />
          </a>
        ) : (
          <button type="button" className="pe-section-header-action" onClick={onAction}>
            {actionLabel} <IconArrowRight size={14} />
          </button>
        ))}
    </div>
  );
}
