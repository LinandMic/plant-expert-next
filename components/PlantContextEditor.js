import { useState } from "react";
import { EXPOSURE_TYPES, ORIENTATION_TYPES, WATERING_MODES, WATERING_TYPES, EMPTY_PLANT_CONTEXT } from "@/lib/plantContextOptions";
import { getEffectivePlantContext } from "@/lib/effectivePlantContext";

function numToInput(n) {
  return n === null || n === undefined ? "" : String(n);
}

function inputToPositiveNumOrNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function labelFor(options, id) {
  const opt = options.find((o) => o.id === id);
  return opt ? opt.label : id;
}

// The synthetic "" option at the head of each grid is how a plant override
// is cleared — selecting it never writes the zone's value onto the plant,
// only `null` (see handleSubmit: `exposure || null`, unchanged). Its label
// makes what will actually apply explicit, without duplicating the
// inheritance resolution itself (that stays in getEffectivePlantContext).
function buildClearOption(zoneValue, options) {
  const zoneLabel = zoneValue ? labelFor(options, zoneValue) : null;
  return {
    id: "",
    label: zoneLabel ? `Utiliser la zone — ${zoneLabel}` : "Non renseigné",
    icon: zoneLabel ? "🔗" : "❔",
  };
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
  const [exposure, setExposure] = useState(initial.exposure || "");
  const [orientation, setOrientation] = useState(initial.orientation || "");
  const [wateringMode, setWateringMode] = useState(initialWatering.mode || "");
  const [wateringType, setWateringType] = useState(initialWatering.type || "");
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

  // Single source of truth for "current zone" — derived from the already-
  // loaded `zones` list by `zoneId`, never refetched here.
  const currentZone = zones.find((z) => z.id === zoneId) || null;

  // Effective values are computed from the live, in-progress form state
  // (not the saved `context` prop) purely for display hints below — never
  // used to initialize or overwrite the form fields themselves, which
  // always represent the plant's own raw, possibly-empty values.
  const liveContext = {
    exposure: exposure || null,
    orientation: orientation || null,
    watering: {
      mode: wateringMode || null,
      type: wateringType || null,
      frequencyDays: inputToPositiveNumOrNull(frequencyDays),
      durationMinutes: inputToPositiveNumOrNull(durationMinutes),
    },
  };
  const effective = getEffectivePlantContext(liveContext, currentZone);

  const zoneExposureValue = currentZone ? currentZone.exposure : null;
  const zoneOrientationValue = currentZone ? currentZone.orientation : null;
  const zoneWateringModeValue = currentZone ? currentZone.wateringMode : null;
  const zoneWateringTypeValue = currentZone ? currentZone.wateringType : null;
  const zoneWateringFrequencyValue = currentZone ? currentZone.wateringFrequencyDays : null;
  const zoneWateringDurationValue = currentZone ? currentZone.wateringDurationMinutes : null;

  const exposureOptions = [buildClearOption(zoneExposureValue, EXPOSURE_TYPES), ...EXPOSURE_TYPES];
  const orientationOptions = [buildClearOption(zoneOrientationValue, ORIENTATION_TYPES), ...ORIENTATION_TYPES];
  const wateringModeOptions = [buildClearOption(zoneWateringModeValue, WATERING_MODES), ...WATERING_MODES];
  const wateringTypeOptions = [buildClearOption(zoneWateringTypeValue, WATERING_TYPES), ...WATERING_TYPES];

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
        <OptionGrid options={exposureOptions} value={exposure} onChange={(v) => { markDirty(); setExposure(v); }} />
        {effective.exposure.source === "plant" && zoneExposureValue && (
          <div className="empty-text">Remplace la zone : {labelFor(EXPOSURE_TYPES, zoneExposureValue)}</div>
        )}
      </div>

      <div className="auth-field">
        <label className="auth-label">Orientation (facultatif)</label>
        <OptionGrid options={orientationOptions} value={orientation} onChange={(v) => { markDirty(); setOrientation(v); }} />
        {effective.orientation.source === "plant" && zoneOrientationValue && (
          <div className="empty-text">Remplace la zone : {labelFor(ORIENTATION_TYPES, zoneOrientationValue)}</div>
        )}
      </div>

      <div className="auth-field">
        <label className="auth-label">Arrosage</label>
        <OptionGrid options={wateringModeOptions} value={wateringMode} onChange={(v) => { markDirty(); setWateringMode(v); }} />
        {effective.wateringMode.source === "plant" && zoneWateringModeValue && (
          <div className="empty-text">Remplace la zone : {labelFor(WATERING_MODES, zoneWateringModeValue)}</div>
        )}
        {wateringMode === "" && effective.wateringMode.value === "automatic" && (
          <div className="empty-text">
            Détails hérités de la zone : {[
              effective.wateringType.value ? labelFor(WATERING_TYPES, effective.wateringType.value) : null,
              effective.wateringFrequencyDays.value ? `${effective.wateringFrequencyDays.value} j` : null,
              effective.wateringDurationMinutes.value ? `${effective.wateringDurationMinutes.value} min` : null,
            ].filter(Boolean).join(" · ") || "aucun détail renseigné"}
          </div>
        )}
      </div>

      {isAutomatic && (
        <>
          <div className="auth-field">
            <label className="auth-label">Type d&apos;arrosage automatique</label>
            <OptionGrid options={wateringTypeOptions} value={wateringType} onChange={(v) => { markDirty(); setWateringType(v); }} />
            {effective.wateringType.source === "plant" && zoneWateringTypeValue && (
              <div className="empty-text">Remplace la zone : {labelFor(WATERING_TYPES, zoneWateringTypeValue)}</div>
            )}
          </div>
          <div className="auth-field">
            <label className="auth-label" htmlFor="ctx-frequency">Fréquence (jours, facultatif)</label>
            <input
              id="ctx-frequency"
              className="plant-input"
              type="number"
              min="1"
              step="1"
              value={frequencyDays}
              onChange={(e) => { markDirty(); setFrequencyDays(e.target.value); }}
              placeholder={zoneWateringFrequencyValue ? `Zone : ${zoneWateringFrequencyValue} j` : ""}
            />
            {effective.wateringFrequencyDays.source === "plant" && zoneWateringFrequencyValue && (
              <div className="empty-text">Remplace la zone : {zoneWateringFrequencyValue} j</div>
            )}
          </div>
          <div className="auth-field">
            <label className="auth-label" htmlFor="ctx-duration">Durée (minutes, facultatif)</label>
            <input
              id="ctx-duration"
              className="plant-input"
              type="number"
              min="1"
              step="1"
              value={durationMinutes}
              onChange={(e) => { markDirty(); setDurationMinutes(e.target.value); }}
              placeholder={zoneWateringDurationValue ? `Zone : ${zoneWateringDurationValue} min` : ""}
            />
            {effective.wateringDurationMinutes.source === "plant" && zoneWateringDurationValue && (
              <div className="empty-text">Remplace la zone : {zoneWateringDurationValue} min</div>
            )}
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
