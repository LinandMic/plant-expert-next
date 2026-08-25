import { useState } from "react";
import { EXPOSURE_TYPES, ORIENTATION_TYPES, WATERING_MODES, WATERING_TYPES, EMPTY_PLANT_CONTEXT } from "@/lib/plantContextOptions";
import { getEffectivePlantContext } from "@/lib/effectivePlantContext";
import Button from "@/components/ui/Button";
import { IconSun, IconDroplet, IconHelpCircle } from "@/components/ui/icons";

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
// `showUnknownIcon` is a local rendering hint only (never persisted) —
// true when this option truly means "no value", so it can share the same
// sober icon as every other "unknown" option below.
function buildClearOption(zoneValue, options) {
  const zoneLabel = zoneValue ? labelFor(options, zoneValue) : null;
  return {
    id: "",
    label: zoneLabel ? `Utiliser la zone — ${zoneLabel}` : "Non renseigné",
    showUnknownIcon: !zoneLabel,
  };
}

// Sober, design-system icons replace the legacy emoji set — applied only
// where a real 1:1 fit exists (spec: "sinon utiliser uniquement le texte").
// Every option's persisted value is still just `opt.id`; this never touches
// that, only what's rendered next to the label.
const SOBER_ICON_BY_ID = {
  full_sun: IconSun,
  manual: IconDroplet,
};

function optionIcon(opt) {
  if (opt.id === "") return opt.showUnknownIcon ? IconHelpCircle : null;
  if (opt.id === "unknown") return IconHelpCircle;
  return SOBER_ICON_BY_ID[opt.id] || null;
}

function OptionGrid({ options, value, onChange, groupLabel }) {
  return (
    <div className="pce-option-grid" role="group" aria-label={groupLabel}>
      {options.map((opt) => {
        const Icon = optionIcon(opt);
        const active = value === opt.id;
        return (
          <button
            type="button"
            key={opt.id}
            className={"pce-option" + (active ? " active" : "")}
            aria-pressed={active}
            onClick={() => onChange(opt.id)}
          >
            {Icon && <Icon size={15} />}
            <span>{opt.label}</span>
          </button>
        );
      })}
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
    <form onSubmit={handleSubmit} className="pce-form">
      <style>{PCE_STYLES}</style>

      {isAuthenticated && (
        <div className="pce-field">
          <label className="pce-label" htmlFor="ctx-zone">Zone du jardin</label>
          {zones.length === 0 ? (
            <div className="pce-hint">Aucune zone créée. Gérez vos zones depuis Mon Jardin.</div>
          ) : (
            <>
              <select
                id="ctx-zone"
                className="pce-select"
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
              {zoneSaving && <span className="pce-hint">Enregistrement...</span>}
              {zoneError && <div className="error-box">{zoneError}</div>}
            </>
          )}
        </div>
      )}

      <div className="pce-field">
        <label className="pce-label" htmlFor="ctx-location">Emplacement</label>
        <input
          id="ctx-location"
          className="pce-input"
          value={location}
          onChange={(e) => { markDirty(); setLocation(e.target.value); }}
          placeholder="ex. coin nord du jardin, pot sur la terrasse..."
        />
      </div>

      <div className="pce-group-title">Conditions de culture</div>

      <div className="pce-field">
        <label className="pce-label">Exposition</label>
        <OptionGrid options={exposureOptions} value={exposure} onChange={(v) => { markDirty(); setExposure(v); }} groupLabel="Exposition" />
        {effective.exposure.source === "plant" && zoneExposureValue && (
          <div className="pce-hint">Remplace la zone : {labelFor(EXPOSURE_TYPES, zoneExposureValue)}</div>
        )}
      </div>

      <div className="pce-field">
        <label className="pce-label">Orientation (facultatif)</label>
        <OptionGrid options={orientationOptions} value={orientation} onChange={(v) => { markDirty(); setOrientation(v); }} groupLabel="Orientation" />
        {effective.orientation.source === "plant" && zoneOrientationValue && (
          <div className="pce-hint">Remplace la zone : {labelFor(ORIENTATION_TYPES, zoneOrientationValue)}</div>
        )}
      </div>

      <div className="pce-field">
        <label className="pce-label">Arrosage</label>
        <OptionGrid options={wateringModeOptions} value={wateringMode} onChange={(v) => { markDirty(); setWateringMode(v); }} groupLabel="Arrosage" />
        {effective.wateringMode.source === "plant" && zoneWateringModeValue && (
          <div className="pce-hint">Remplace la zone : {labelFor(WATERING_MODES, zoneWateringModeValue)}</div>
        )}
        {wateringMode === "" && effective.wateringMode.value === "automatic" && (
          <div className="pce-hint">
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
          <div className="pce-field">
            <label className="pce-label">Type d&apos;arrosage automatique</label>
            <OptionGrid options={wateringTypeOptions} value={wateringType} onChange={(v) => { markDirty(); setWateringType(v); }} groupLabel="Type d'arrosage automatique" />
            {effective.wateringType.source === "plant" && zoneWateringTypeValue && (
              <div className="pce-hint">Remplace la zone : {labelFor(WATERING_TYPES, zoneWateringTypeValue)}</div>
            )}
          </div>
          <div className="pce-field">
            <label className="pce-label" htmlFor="ctx-frequency">Fréquence (jours, facultatif)</label>
            <input
              id="ctx-frequency"
              className="pce-input"
              type="number"
              min="1"
              step="1"
              value={frequencyDays}
              onChange={(e) => { markDirty(); setFrequencyDays(e.target.value); }}
              placeholder={zoneWateringFrequencyValue ? `Zone : ${zoneWateringFrequencyValue} j` : ""}
            />
            {effective.wateringFrequencyDays.source === "plant" && zoneWateringFrequencyValue && (
              <div className="pce-hint">Remplace la zone : {zoneWateringFrequencyValue} j</div>
            )}
          </div>
          <div className="pce-field">
            <label className="pce-label" htmlFor="ctx-duration">Durée (minutes, facultatif)</label>
            <input
              id="ctx-duration"
              className="pce-input"
              type="number"
              min="1"
              step="1"
              value={durationMinutes}
              onChange={(e) => { markDirty(); setDurationMinutes(e.target.value); }}
              placeholder={zoneWateringDurationValue ? `Zone : ${zoneWateringDurationValue} min` : ""}
            />
            {effective.wateringDurationMinutes.source === "plant" && zoneWateringDurationValue && (
              <div className="pce-hint">Remplace la zone : {zoneWateringDurationValue} min</div>
            )}
          </div>
          <div className="pce-field">
            <label className="pce-label" htmlFor="ctx-flow">Débit par émetteur, en L/h (facultatif)</label>
            <input id="ctx-flow" className="pce-input" type="number" min="0.1" step="0.1" value={flowLph} onChange={(e) => { markDirty(); setFlowLph(e.target.value); }} />
          </div>
          <div className="pce-field">
            <label className="pce-label" htmlFor="ctx-emitters">Nombre d&apos;émetteurs (facultatif)</label>
            <input id="ctx-emitters" className="pce-input" type="number" min="1" step="1" value={emitterCount} onChange={(e) => { markDirty(); setEmitterCount(e.target.value); }} />
          </div>
        </>
      )}

      {error && <div className="error-box">{error}</div>}
      {success && <div className="pce-success">Contexte enregistré avec succès.</div>}

      <div className="pce-actions">
        <Button type="submit" disabled={saving}>
          {saving ? "Enregistrement..." : "Enregistrer"}
        </Button>
      </div>
    </form>
  );
}

const PCE_STYLES = `
  .pce-form { margin-top:2px; }
  .pce-field { margin-bottom:18px; }
  .pce-label { display:block;font-size:13.5px;font-weight:600;color:var(--pe-text);margin-bottom:8px; }
  .pce-input, .pce-select { width:100%;min-height:44px;border:1px solid var(--pe-border);border-radius:var(--pe-radius-sm);padding:10px 14px;font-family:var(--pe-font-body);font-size:14px;color:var(--pe-text);background:var(--pe-surface);outline:none;transition:border-color .15s; }
  .pce-input:focus, .pce-select:focus { border-color:var(--pe-accent); }
  .pce-input::placeholder { color:var(--pe-text-muted); }

  .pce-group-title { margin:22px 0 14px;padding-top:18px;border-top:1px solid var(--pe-border);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--pe-text-muted); }

  .pce-option-grid { display:flex;flex-wrap:wrap;gap:8px; }
  .pce-option { display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:9px 16px;border-radius:999px;border:1.5px solid var(--pe-border);background:var(--pe-surface);color:var(--pe-text-muted);font-family:var(--pe-font-body);font-size:13.5px;font-weight:600;cursor:pointer;transition:border-color .15s,background-color .15s,color .15s; }
  .pce-option:hover { border-color:var(--pe-border-strong); }
  .pce-option:focus-visible { outline:2px solid var(--pe-accent);outline-offset:2px; }
  .pce-option.active { border-color:var(--pe-accent);background:var(--pe-sand);color:var(--pe-accent); }

  .pce-hint { margin-top:7px;font-size:12.5px;color:var(--pe-text-muted); }

  .pce-success { margin-top:4px;margin-bottom:16px;padding:12px 14px;border-radius:var(--pe-radius-sm);background:var(--pe-sand);color:var(--pe-accent);font-size:13.5px;line-height:1.5; }

  .pce-actions { margin-top:22px; }

  @media (max-width:480px) { .pce-option { padding:9px 14px;font-size:13px; } }
`;
