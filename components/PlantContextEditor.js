import { useState } from "react";
import { EXPOSURE_TYPES, ORIENTATION_TYPES, WATERING_MODES, WATERING_TYPES, EMPTY_PLANT_CONTEXT } from "@/lib/plantContextOptions";

function numToInput(n) {
  return n === null || n === undefined ? "" : String(n);
}

function inputToPositiveNumOrNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function OptionGrid({ options, value, onChange }) {
  return (
    <div className="plantation-grid">
      {options.map((opt) => (
        <button
          type="button"
          key={opt.id}
          className={"plantation-btn" + (value === opt.id ? " active" : "")}
          onClick={() => onChange(opt.id)}
        >
          {opt.icon && <span className="plantation-icon">{opt.icon}</span>}
          <span className="plantation-label">{opt.label}</span>
        </button>
      ))}
    </div>
  );
}

export default function PlantContextEditor({ context, onSave, zoneId = null, zones = [], isAuthenticated = false, onSaveZone }) {
  const initial = context || EMPTY_PLANT_CONTEXT;
  const initialWatering = initial.watering || EMPTY_PLANT_CONTEXT.watering;

  const [location, setLocation] = useState(initial.location || "");
  const [exposure, setExposure] = useState(initial.exposure || null);
  const [orientation, setOrientation] = useState(initial.orientation || null);
  const [wateringMode, setWateringMode] = useState(initialWatering.mode || null);
  const [wateringType, setWateringType] = useState(initialWatering.type || null);
  const [frequencyDays, setFrequencyDays] = useState(numToInput(initialWatering.frequencyDays));
  const [durationMinutes, setDurationMinutes] = useState(numToInput(initialWatering.durationMinutes));
  const [flowLph, setFlowLph] = useState(numToInput(initialWatering.flowLph));
  const [emitterCount, setEmitterCount] = useState(numToInput(initialWatering.emitterCount));

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const [zoneSaving, setZoneSaving] = useState(false);
  const [zoneError, setZoneError] = useState("");

  const isAutomatic = wateringMode === "automatic";

  // Controlled entirely by the `zoneId` prop, never by local state — the
  // select can only ever display a value the parent's jardin state has
  // actually confirmed. A failed save never gets a chance to "stick"
  // locally: since we never set an intermediate value here, the select
  // simply keeps showing whatever `zoneId` already was.
  const handleZoneChange = async (e) => {
    const newZoneId = e.target.value || null;
    setZoneSaving(true);
    setZoneError("");
    const { error: err } = await onSaveZone(newZoneId);
    setZoneSaving(false);
    if (err) setZoneError(err);
  };

  const markDirty = () => setSuccess(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    setSuccess(false);

    const newContext = {
      location: location.trim() || null,
      exposure: exposure || null,
      orientation: orientation || null,
      watering: {
        mode: wateringMode || null,
        type: isAutomatic ? (wateringType || null) : null,
        frequencyDays: isAutomatic ? inputToPositiveNumOrNull(frequencyDays) : null,
        durationMinutes: isAutomatic ? inputToPositiveNumOrNull(durationMinutes) : null,
        flowLph: isAutomatic ? inputToPositiveNumOrNull(flowLph) : null,
        emitterCount: isAutomatic ? inputToPositiveNumOrNull(emitterCount) : null,
      },
    };

    const { error: err } = await onSave(newContext);
    setSaving(false);
    if (err) { setError(err); return; }
    setSuccess(true);
  };

  return (
    <form onSubmit={handleSubmit}>
      {isAuthenticated && (
        <div className="auth-field">
          <label className="auth-label" htmlFor="ctx-zone">Zone du jardin</label>
          {zones.length === 0 ? (
            <div className="empty-text">Aucune zone créée. Gérez vos zones depuis Mon Jardin.</div>
          ) : (
            <>
              <select
                id="ctx-zone"
                className="plant-input"
                value={zoneId || ""}
                onChange={handleZoneChange}
                disabled={zoneSaving}
              >
                <option value="">Sans zone</option>
                <option value="__divider__" disabled>──────</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>{z.name}</option>
                ))}
              </select>
              {zoneSaving && <span className="empty-text">Enregistrement...</span>}
              {zoneError && <div className="error-box">{zoneError}</div>}
            </>
          )}
        </div>
      )}

      <div className="auth-field">
        <label className="auth-label" htmlFor="ctx-location">Emplacement</label>
        <input
          id="ctx-location"
          className="plant-input"
          value={location}
          onChange={(e) => { markDirty(); setLocation(e.target.value); }}
          placeholder="ex. coin nord du jardin, pot sur la terrasse..."
        />
      </div>

      <div className="auth-field">
        <label className="auth-label">Exposition</label>
        <OptionGrid options={EXPOSURE_TYPES} value={exposure} onChange={(v) => { markDirty(); setExposure(v); }} />
      </div>

      <div className="auth-field">
        <label className="auth-label">Orientation (facultatif)</label>
        <OptionGrid options={ORIENTATION_TYPES} value={orientation} onChange={(v) => { markDirty(); setOrientation(v); }} />
      </div>

      <div className="auth-field">
        <label className="auth-label">Arrosage</label>
        <OptionGrid options={WATERING_MODES} value={wateringMode} onChange={(v) => { markDirty(); setWateringMode(v); }} />
      </div>

      {isAutomatic && (
        <>
          <div className="auth-field">
            <label className="auth-label">Type d&apos;arrosage automatique</label>
            <OptionGrid options={WATERING_TYPES} value={wateringType} onChange={(v) => { markDirty(); setWateringType(v); }} />
          </div>
          <div className="auth-field">
            <label className="auth-label" htmlFor="ctx-frequency">Fréquence (jours, facultatif)</label>
            <input id="ctx-frequency" className="plant-input" type="number" min="1" step="1" value={frequencyDays} onChange={(e) => { markDirty(); setFrequencyDays(e.target.value); }} />
          </div>
          <div className="auth-field">
            <label className="auth-label" htmlFor="ctx-duration">Durée (minutes, facultatif)</label>
            <input id="ctx-duration" className="plant-input" type="number" min="1" step="1" value={durationMinutes} onChange={(e) => { markDirty(); setDurationMinutes(e.target.value); }} />
          </div>
          <div className="auth-field">
            <label className="auth-label" htmlFor="ctx-flow">Débit par émetteur, en L/h (facultatif)</label>
            <input id="ctx-flow" className="plant-input" type="number" min="0.1" step="0.1" value={flowLph} onChange={(e) => { markDirty(); setFlowLph(e.target.value); }} />
          </div>
          <div className="auth-field">
            <label className="auth-label" htmlFor="ctx-emitters">Nombre d&apos;émetteurs (facultatif)</label>
            <input id="ctx-emitters" className="plant-input" type="number" min="1" step="1" value={emitterCount} onChange={(e) => { markDirty(); setEmitterCount(e.target.value); }} />
          </div>
        </>
      )}

      {error && <div className="error-box">{error}</div>}
      {success && <div className="auth-success-box">Contexte enregistré avec succès.</div>}

      <div className="modal-actions">
        <button type="submit" className="btn-modal-confirm" disabled={saving}>
          {saving ? "Enregistrement..." : "Enregistrer"}
        </button>
      </div>
    </form>
  );
}
