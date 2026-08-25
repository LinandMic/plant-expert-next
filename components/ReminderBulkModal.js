import { useState } from "react";
import { REMINDER_TYPES } from "@/lib/reminderOptions";
import Button from "@/components/ui/Button";
import { IconBell, IconDroplet, IconScissors, IconSprout, IconSearch, IconX } from "@/components/ui/icons";

const EMPTY_CONFIG = { nextDueDate: "", recurrenceType: "none", intervalDays: "" };

// Same sober-icon convention as RemindersOverview.js (kept as its own small
// local mapping rather than a shared import — presentation-only, not
// business logic, matching the precedent set in Phase 7/8 of not coupling
// sibling components together just to save a few lines).
const ICON_BY_TYPE = {
  watering: IconDroplet,
  pruning: IconScissors,
  fertilizing: IconSprout,
  pest_check: IconSearch,
};
function typeIcon(typeId) {
  return ICON_BY_TYPE[typeId] || IconBell;
}

export default function ReminderBulkModal({ plantCount, onClose, onSubmit }) {
  const [selectedTypes, setSelectedTypes] = useState(() => new Set());
  const [configByType, setConfigByType] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const toggleType = (typeId) => {
    setError("");
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(typeId)) next.delete(typeId);
      else next.add(typeId);
      return next;
    });
    setConfigByType((prev) => (prev[typeId] ? prev : { ...prev, [typeId]: { ...EMPTY_CONFIG } }));
  };

  const allSelected = selectedTypes.size === REMINDER_TYPES.length;

  const handleToggleAll = () => {
    setError("");
    if (allSelected) {
      setSelectedTypes(new Set());
      return;
    }
    setSelectedTypes(new Set(REMINDER_TYPES.map((t) => t.id)));
    setConfigByType((prev) => {
      const next = { ...prev };
      REMINDER_TYPES.forEach((t) => {
        if (!next[t.id]) next[t.id] = { ...EMPTY_CONFIG };
      });
      return next;
    });
  };

  const updateConfig = (typeId, patch) => {
    setError("");
    setConfigByType((prev) => ({ ...prev, [typeId]: { ...prev[typeId], ...patch } }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setError("");

    if (selectedTypes.size === 0) {
      setError("Sélectionne au moins un type de rappel.");
      return;
    }

    const configs = [];
    for (const typeId of selectedTypes) {
      const cfg = configByType[typeId] || EMPTY_CONFIG;
      if (!cfg.nextDueDate) {
        setError("Indique une prochaine date pour chaque type sélectionné.");
        return;
      }
      if (cfg.recurrenceType === "interval_days") {
        const days = Number(cfg.intervalDays);
        if (!Number.isInteger(days) || days <= 0) {
          setError("Indique un nombre de jours valide (entier supérieur à 0) pour la récurrence.");
          return;
        }
        configs.push({ type: typeId, nextDueDate: cfg.nextDueDate, recurrence: { type: "interval_days", intervalDays: days } });
      } else {
        configs.push({ type: typeId, nextDueDate: cfg.nextDueDate, recurrence: { type: "none", intervalDays: null } });
      }
    }

    setSubmitting(true);
    const { error: err } = await onSubmit(configs);
    setSubmitting(false);
    if (err) { setError(err); return; }
    // Success: the parent already closes this modal and resets selection.
  };

  return (
    <div className="rbm-overlay" onClick={onClose}>
      <style>{RBM_STYLES}</style>
      <div className="rbm-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="rbm-title">
        <button type="button" className="rbm-close-btn" onClick={onClose} aria-label="Fermer">
          <IconX size={16} />
        </button>
        <div className="rbm-title" id="rbm-title">Créer des rappels</div>
        <div className="rbm-sub">
          {plantCount} plante{plantCount > 1 ? "s" : ""} sélectionnée{plantCount > 1 ? "s" : ""}
        </div>

        <label className="rbm-toggle-all">
          <input type="checkbox" checked={allSelected} onChange={handleToggleAll} />
          <span>Tout activer</span>
        </label>

        <form onSubmit={handleSubmit}>
          {REMINDER_TYPES.map((t) => {
            const TypeIcon = typeIcon(t.id);
            const isSelected = selectedTypes.has(t.id);
            return (
              <div className={"rbm-type-row" + (isSelected ? " selected" : "")} key={t.id}>
                <label className="rbm-type-header">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleType(t.id)}
                  />
                  <TypeIcon size={16} />
                  <span className="rbm-type-label">{t.label}</span>
                </label>

                {isSelected && (
                  <div className="rbm-type-config">
                    <div className="rbm-field">
                      <label className="rbm-label" htmlFor={`due-${t.id}`}>Prochaine date</label>
                      <input
                        id={`due-${t.id}`}
                        type="date"
                        className="rbm-input"
                        value={(configByType[t.id] || EMPTY_CONFIG).nextDueDate}
                        onChange={(e) => updateConfig(t.id, { nextDueDate: e.target.value })}
                      />
                    </div>
                    <div className="rbm-recurrence-grid">
                      <button
                        type="button"
                        className={"rbm-recurrence-option" + ((configByType[t.id] || EMPTY_CONFIG).recurrenceType === "none" ? " active" : "")}
                        aria-pressed={(configByType[t.id] || EMPTY_CONFIG).recurrenceType === "none"}
                        onClick={() => updateConfig(t.id, { recurrenceType: "none" })}
                      >
                        Ponctuel
                      </button>
                      <button
                        type="button"
                        className={"rbm-recurrence-option" + ((configByType[t.id] || EMPTY_CONFIG).recurrenceType === "interval_days" ? " active" : "")}
                        aria-pressed={(configByType[t.id] || EMPTY_CONFIG).recurrenceType === "interval_days"}
                        onClick={() => updateConfig(t.id, { recurrenceType: "interval_days" })}
                      >
                        Tous les N jours
                      </button>
                    </div>
                    {(configByType[t.id] || EMPTY_CONFIG).recurrenceType === "interval_days" && (
                      <div className="rbm-field">
                        <label className="rbm-label" htmlFor={`interval-${t.id}`}>Tous les combien de jours ?</label>
                        <input
                          id={`interval-${t.id}`}
                          type="number"
                          min="1"
                          step="1"
                          className="rbm-input"
                          value={(configByType[t.id] || EMPTY_CONFIG).intervalDays}
                          onChange={(e) => updateConfig(t.id, { intervalDays: e.target.value })}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {error && <div className="error-box">{error}</div>}

          <div className="rbm-actions">
            <Button type="submit" disabled={submitting || selectedTypes.size === 0}>
              {submitting ? "Création en cours..." : "Créer les rappels"}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>Annuler</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

const RBM_STYLES = `
  .rbm-overlay { position:fixed;inset:0;background:rgba(24,33,29,0.45);display:flex;align-items:center;justify-content:center;padding:20px;z-index:1000; }
  .rbm-panel { position:relative;width:100%;max-width:520px;max-height:min(720px,90vh);overflow-y:auto;background:var(--pe-surface);border-radius:var(--pe-radius-lg);border:1px solid var(--pe-border);box-shadow:var(--pe-shadow-md);padding:28px; }
  .rbm-close-btn { position:absolute;top:12px;right:12px;display:flex;align-items:center;justify-content:center;width:44px;height:44px;border:none;border-radius:var(--pe-radius-sm);background:none;color:var(--pe-text-muted);cursor:pointer; }
  .rbm-close-btn:hover { background:var(--pe-sand);color:var(--pe-text); }
  .rbm-close-btn:focus-visible { outline:2px solid var(--pe-accent);outline-offset:2px; }

  .rbm-title { font-family:var(--pe-font-display);font-weight:600;font-size:21px;color:var(--pe-text);padding-right:36px; }
  .rbm-sub { margin-top:4px;margin-bottom:18px;color:var(--pe-text-muted);font-size:13.5px; }

  .rbm-toggle-all { display:flex;align-items:center;gap:9px;min-height:44px;margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--pe-border);font-size:13.5px;font-weight:700;color:var(--pe-text);cursor:pointer; }
  .rbm-toggle-all input, .rbm-type-header input { width:19px;height:19px;accent-color:var(--pe-accent);cursor:pointer;flex-shrink:0; }

  .rbm-type-row { padding:12px 0;border-bottom:1px solid var(--pe-border); }
  .rbm-type-row:last-of-type { border-bottom:none; }
  .rbm-type-header { display:flex;align-items:center;gap:9px;min-height:44px;font-size:14px;font-weight:600;color:var(--pe-text);cursor:pointer; }
  .rbm-type-header svg { color:var(--pe-accent);flex-shrink:0; }

  .rbm-type-config { margin-top:10px;padding-left:28px;display:flex;flex-direction:column;gap:12px; }
  .rbm-field { display:flex;flex-direction:column;gap:6px; }
  .rbm-label { font-size:12.5px;font-weight:600;color:var(--pe-text); }
  .rbm-input { width:100%;min-height:44px;border:1px solid var(--pe-border);border-radius:var(--pe-radius-sm);padding:10px 14px;font-family:var(--pe-font-body);font-size:14px;color:var(--pe-text);background:var(--pe-ivory);outline:none;transition:border-color .15s; }
  .rbm-input:focus { border-color:var(--pe-accent); }

  .rbm-recurrence-grid { display:flex;flex-wrap:wrap;gap:8px; }
  .rbm-recurrence-option { min-height:44px;padding:9px 16px;border-radius:999px;border:1.5px solid var(--pe-border);background:var(--pe-surface);color:var(--pe-text-muted);font-family:var(--pe-font-body);font-size:13px;font-weight:600;cursor:pointer;transition:border-color .15s,background-color .15s,color .15s; }
  .rbm-recurrence-option:hover { border-color:var(--pe-border-strong); }
  .rbm-recurrence-option:focus-visible { outline:2px solid var(--pe-accent);outline-offset:2px; }
  .rbm-recurrence-option.active { border-color:var(--pe-accent);background:var(--pe-sand);color:var(--pe-accent); }

  .rbm-actions { display:flex;gap:8px;flex-wrap:wrap;margin-top:20px; }

  @media (max-width:480px) { .rbm-panel { padding:20px; } .rbm-type-config { padding-left:0; } }
`;
