import { useState } from "react";
import { REMINDER_TYPES } from "@/lib/reminderOptions";

const EMPTY_CONFIG = { nextDueDate: "", recurrenceType: "none", intervalDays: "" };

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

  const handleActivateAll = () => {
    setError("");
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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Créer des rappels</div>
        <div className="modal-sub">
          {plantCount} plante{plantCount > 1 ? "s" : ""} sélectionnée{plantCount > 1 ? "s" : ""}
        </div>

        <div className="modal-actions" style={{ marginBottom: 16 }}>
          <button type="button" className="btn-modal-skip" onClick={handleActivateAll}>✅ Tout activer</button>
        </div>

        <form onSubmit={handleSubmit}>
          {REMINDER_TYPES.map((t) => (
            <div className="reminder-type-row" key={t.id}>
              <label className="reminder-type-header">
                <input
                  type="checkbox"
                  checked={selectedTypes.has(t.id)}
                  onChange={() => toggleType(t.id)}
                />
                <span className="reminder-type-icon">{t.icon}</span>
                <span className="reminder-type-label">{t.label}</span>
              </label>

              {selectedTypes.has(t.id) && (
                <div className="reminder-type-config">
                  <div className="auth-field">
                    <label className="auth-label" htmlFor={`due-${t.id}`}>Prochaine date</label>
                    <input
                      id={`due-${t.id}`}
                      type="date"
                      className="plant-input"
                      value={(configByType[t.id] || EMPTY_CONFIG).nextDueDate}
                      onChange={(e) => updateConfig(t.id, { nextDueDate: e.target.value })}
                    />
                  </div>
                  <div className="plantation-grid" style={{ marginBottom: 12 }}>
                    <button
                      type="button"
                      className={"plantation-btn" + ((configByType[t.id] || EMPTY_CONFIG).recurrenceType === "none" ? " active" : "")}
                      onClick={() => updateConfig(t.id, { recurrenceType: "none" })}
                    >
                      <span className="plantation-label">Ponctuel</span>
                    </button>
                    <button
                      type="button"
                      className={"plantation-btn" + ((configByType[t.id] || EMPTY_CONFIG).recurrenceType === "interval_days" ? " active" : "")}
                      onClick={() => updateConfig(t.id, { recurrenceType: "interval_days" })}
                    >
                      <span className="plantation-label">Tous les N jours</span>
                    </button>
                  </div>
                  {(configByType[t.id] || EMPTY_CONFIG).recurrenceType === "interval_days" && (
                    <div className="auth-field">
                      <label className="auth-label" htmlFor={`interval-${t.id}`}>Tous les combien de jours ?</label>
                      <input
                        id={`interval-${t.id}`}
                        type="number"
                        min="1"
                        step="1"
                        className="plant-input"
                        value={(configByType[t.id] || EMPTY_CONFIG).intervalDays}
                        onChange={(e) => updateConfig(t.id, { intervalDays: e.target.value })}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {error && <div className="error-box">{error}</div>}

          <div className="modal-actions">
            <button type="submit" className="btn-modal-confirm" disabled={submitting}>
              {submitting ? "Création en cours..." : "Créer les rappels"}
            </button>
            <button type="button" className="btn-modal-skip" onClick={onClose} disabled={submitting}>Annuler</button>
          </div>
        </form>
      </div>
    </div>
  );
}
