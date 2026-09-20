import { useState } from "react";
import { EXPOSURE_TYPES, ORIENTATION_TYPES, WATERING_MODES, WATERING_TYPES } from "@/lib/plantContextOptions";
import Button from "@/components/ui/Button";
import { IconSun, IconDroplet, IconHelpCircle, IconAlertCircle } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n";

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

// A zone has no other zone to inherit from, so — unlike PlantContextEditor's
// per-plant grids — the synthetic first option here only ever means "no
// value", never "inherits X". Same sober-icon convention as Phase 7 though:
// a real design-system icon only where a 1:1 fit exists, plain text
// otherwise (never the legacy emoji).
const SOBER_ICON_BY_ID = {
  full_sun: IconSun,
  manual: IconDroplet,
};

function optionIcon(id) {
  if (id === "" || id === "unknown") return IconHelpCircle;
  return SOBER_ICON_BY_ID[id] || null;
}

// EXPOSURE_TYPES/ORIENTATION_TYPES/WATERING_MODES/WATERING_TYPES (from
// lib/plantContextOptions.js) are out of scope for round 1 (see
// UNTRANSLATED_IN_SCOPE) — their .label stays French this round, only this
// component's own chrome (field labels, buttons, the synthetic "cleared"
// option below) is translated.
function withClearOption(options, t) {
  return [{ id: "", label: t("gardenZoneSettings.notProvided") }, ...options];
}

function OptionGrid({ options, value, onChange, groupLabel, idPrefix }) {
  return (
    <div className="gzs-option-grid" role="group" aria-label={groupLabel}>
      {options.map((opt) => {
        const Icon = optionIcon(opt.id);
        const active = value === opt.id;
        return (
          <button
            type="button"
            key={idPrefix + opt.id}
            className={"gzs-option" + (active ? " active" : "")}
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

export default function GardenZoneSettings({ zone, onSave, onCancel }) {
  const { t } = useI18n();
  const [exposure, setExposure] = useState(zone.exposure || "");
  const [orientation, setOrientation] = useState(zone.orientation || "");
  const [wateringMode, setWateringMode] = useState(zone.wateringMode || "");
  const [wateringType, setWateringType] = useState(zone.wateringType || "");
  const [frequencyDays, setFrequencyDays] = useState(numToInput(zone.wateringFrequencyDays));
  const [durationMinutes, setDurationMinutes] = useState(numToInput(zone.wateringDurationMinutes));

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isAutomatic = wateringMode === "automatic";

  const exposureOptions = withClearOption(EXPOSURE_TYPES, t);
  const orientationOptions = withClearOption(ORIENTATION_TYPES, t);
  const wateringModeOptions = withClearOption(WATERING_MODES, t);
  const wateringTypeOptions = withClearOption(WATERING_TYPES, t);

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
    <form className="gzs-form" onSubmit={handleSubmit}>
      <style>{GZS_STYLES}</style>

      <div className="gzs-field">
        <label className="gzs-label">{t("gardenZoneSettings.exposure")}</label>
        <OptionGrid options={exposureOptions} value={exposure} onChange={setExposure} groupLabel={t("gardenZoneSettings.exposure")} idPrefix={`zs-exposure-${zone.id}-`} />
      </div>

      <div className="gzs-field">
        <label className="gzs-label">{t("gardenZoneSettings.orientation")}</label>
        <OptionGrid options={orientationOptions} value={orientation} onChange={setOrientation} groupLabel={t("gardenZoneSettings.orientation")} idPrefix={`zs-orientation-${zone.id}-`} />
      </div>

      <div className="gzs-field">
        <label className="gzs-label">{t("gardenZoneSettings.watering")}</label>
        <OptionGrid options={wateringModeOptions} value={wateringMode} onChange={setWateringMode} groupLabel={t("gardenZoneSettings.watering")} idPrefix={`zs-watering-mode-${zone.id}-`} />
      </div>

      {isAutomatic && (
        <>
          <div className="gzs-field">
            <label className="gzs-label">{t("gardenZoneSettings.wateringType")}</label>
            <OptionGrid options={wateringTypeOptions} value={wateringType} onChange={setWateringType} groupLabel={t("gardenZoneSettings.wateringType")} idPrefix={`zs-watering-type-${zone.id}-`} />
          </div>
          <div className="gzs-field">
            <label className="gzs-label" htmlFor={`zs-freq-${zone.id}`}>{t("gardenZoneSettings.frequencyDays")}</label>
            <input
              id={`zs-freq-${zone.id}`}
              className="gzs-input"
              type="number"
              min="1"
              step="1"
              value={frequencyDays}
              onChange={(e) => setFrequencyDays(e.target.value)}
              disabled={saving}
            />
          </div>
          <div className="gzs-field">
            <label className="gzs-label" htmlFor={`zs-duration-${zone.id}`}>{t("gardenZoneSettings.durationMinutes")}</label>
            <input
              id={`zs-duration-${zone.id}`}
              className="gzs-input"
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

      {error && <div className="error-box"><IconAlertCircle size={14} /> {error}</div>}

      <div className="gzs-actions">
        <Button type="submit" disabled={saving}>
          {saving ? t("gardenZoneSettings.saving") : t("gardenZoneSettings.save")}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
          {t("gardenZoneSettings.cancel")}
        </Button>
      </div>
    </form>
  );
}

const GZS_STYLES = `
  .gzs-field { margin-bottom:16px; }
  .gzs-field:last-of-type { margin-bottom:0; }
  .gzs-label { display:block;font-size:13.5px;font-weight:600;color:var(--pe-text);margin-bottom:8px; }
  .gzs-input { width:100%;min-height:44px;border:1px solid var(--pe-border);border-radius:var(--pe-radius-sm);padding:10px 14px;font-family:var(--pe-font-body);font-size:14px;color:var(--pe-text);background:var(--pe-surface);outline:none;transition:border-color .15s; }
  .gzs-input:focus { border-color:var(--pe-accent); }

  .gzs-option-grid { display:flex;flex-wrap:wrap;gap:8px; }
  .gzs-option { display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:9px 16px;border-radius:999px;border:1.5px solid var(--pe-border);background:var(--pe-surface);color:var(--pe-text-muted);font-family:var(--pe-font-body);font-size:13.5px;font-weight:600;cursor:pointer;transition:border-color .15s,background-color .15s,color .15s; }
  .gzs-option:hover { border-color:var(--pe-border-strong); }
  .gzs-option:focus-visible { outline:2px solid var(--pe-accent);outline-offset:2px; }
  .gzs-option.active { border-color:var(--pe-accent);background:var(--pe-sand);color:var(--pe-accent); }

  .gzs-actions { display:flex;gap:8px;flex-wrap:wrap;margin-top:18px; }

  @media (max-width:480px) { .gzs-option { padding:9px 14px;font-size:13px; } }
`;
