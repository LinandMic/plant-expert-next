import { useState } from "react";
import { EXPOSURE_TYPES, ORIENTATION_TYPES, WATERING_MODES, WATERING_TYPES } from "@/lib/plantContextOptions";

// Mirrors gardenApi.js's toPositiveIntOrNull (used for the same columns on
// plants) — coerces "" to null and guarantees a NaN/non-finite/non-positive
// input never reaches the patch, rather than rejecting it.
function toPositiveIntOrNull(raw) {
  if (raw === "" || raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function numToInput(n) {
  return n === null || n === undefined ? "" : String(n);
}

export default function GardenZoneSettings({ zone, onSave, onCancel }) {
  const [exposure, setExposure] = useState(zone.exposure || "");
  const [orientation, setOrientation] = useState(zone.orientation || "");
  const [wateringMode, setWateringMode] = useState(zone.wateringMode || "");
  const [wateringType, setWateringType] = useState(zone.wateringType || "");
  const [frequencyDays, setFrequencyDays] = useState(numToInput(zone.wateringFrequencyDays));
  const [durationMinutes, setDurationMinutes] = useState(numToInput(zone.wateringDurationMinutes));

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isAutomatic = wateringMode === "automatic";

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");

    // "" -> null for every select; automatic-only fields are forced to null
    // the moment wateringMode isn't "automatic", regardless of what was
    // typed before switching the mode back.
    const patch = {
      exposure: exposure || null,
      orientation: orientation || null,
      wateringMode: wateringMode || null,
      wateringType: isAutomatic ? wateringType || null : null,
      wateringFrequencyDays: isAutomatic ? toPositiveIntOrNull(frequencyDays) : null,
      wateringDurationMinutes: isAutomatic ? toPositiveIntOrNull(durationMinutes) : null,
    };

    const { error: err } = await onSave(patch);
    setSaving(false);
    if (err) {
      setError(err);
      return;
    }
    onCancel();
  };

  return (
    <form className="zone-settings-panel" onSubmit={handleSubmit}>
      <div className="auth-field">
        <label className="auth-label" htmlFor={`zs-exposure-${zone.id}`}>Exposition</label>
        <select
          id={`zs-exposure-${zone.id}`}
          className="plant-input"
          value={exposure}
          onChange={(e) => setExposure(e.target.value)}
          disabled={saving}
        >
          <option value="">Non renseigné</option>
          {EXPOSURE_TYPES.map((o) => (
            <option key={o.id} value={o.id}>{o.icon} {o.label}</option>
          ))}
        </select>
      </div>

      <div className="auth-field">
        <label className="auth-label" htmlFor={`zs-orientation-${zone.id}`}>Orientation</label>
        <select
          id={`zs-orientation-${zone.id}`}
          className="plant-input"
          value={orientation}
          onChange={(e) => setOrientation(e.target.value)}
          disabled={saving}
        >
          <option value="">Non renseigné</option>
          {ORIENTATION_TYPES.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      </div>

      <div className="auth-field">
        <label className="auth-label" htmlFor={`zs-watering-mode-${zone.id}`}>Arrosage</label>
        <select
          id={`zs-watering-mode-${zone.id}`}
          className="plant-input"
          value={wateringMode}
          onChange={(e) => setWateringMode(e.target.value)}
          disabled={saving}
        >
          <option value="">Non renseigné</option>
          {WATERING_MODES.map((o) => (
            <option key={o.id} value={o.id}>{o.icon} {o.label}</option>
          ))}
        </select>
      </div>

      {isAutomatic && (
        <>
          <div className="auth-field">
            <label className="auth-label" htmlFor={`zs-watering-type-${zone.id}`}>Type d&apos;arrosage</label>
            <select
              id={`zs-watering-type-${zone.id}`}
              className="plant-input"
              value={wateringType}
              onChange={(e) => setWateringType(e.target.value)}
              disabled={saving}
            >
              <option value="">Non renseigné</option>
              {WATERING_TYPES.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="auth-field">
            <label className="auth-label" htmlFor={`zs-freq-${zone.id}`}>Fréquence (jours)</label>
            <input
              id={`zs-freq-${zone.id}`}
              className="plant-input"
              type="number"
              min="1"
              step="1"
              value={frequencyDays}
              onChange={(e) => setFrequencyDays(e.target.value)}
              disabled={saving}
            />
          </div>
          <div className="auth-field">
            <label className="auth-label" htmlFor={`zs-duration-${zone.id}`}>Durée (minutes)</label>
            <input
              id={`zs-duration-${zone.id}`}
              className="plant-input"
              type="number"
              min="1"
              step="1"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
              disabled={saving}
            />
          </div>
        </>
      )}

      {error && <div className="error-box">⚠️ {error}</div>}

      <div className="zones-edit-actions">
        <button type="submit" className="reminders-action-btn reminders-action-confirm" disabled={saving}>
          {saving ? "Enregistrement..." : "Enregistrer"}
        </button>
        <button type="button" className="reminders-action-btn" onClick={onCancel} disabled={saving}>
          Annuler
        </button>
      </div>
    </form>
  );
}
