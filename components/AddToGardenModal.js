import { useState } from "react";
import { IconX, IconLeaf, IconCheck } from "@/components/ui/icons";
import IconButton from "@/components/ui/IconButton";
import Button from "@/components/ui/Button";
import { useI18n } from "@/lib/i18n";
import * as gardenApi from "@/lib/gardenApi";

// AddToGardenModal — the "catalog plant -> My Garden" flow (see this
// round's audit: the existing add-to-garden path, gardenApi.insertPlant /
// useGarden's addPlant, is shaped entirely around the AI-identification
// flow's payload and is never touched by this component). Only ever
// mounted by the caller once `user` is already known to be a real
// authenticated user (pages/plant-finder/[slug].js opens the existing
// AuthModal instead when logged out) — so this component itself has no
// "please log in" branch to keep it simple, matching "do not silently
// fail" being satisfied one level up.
//
// Minimum safe flow (spec): pick an existing zone if any exist (never a
// zone-creation sub-flow here — that already exists in My Garden's own UI,
// wiring a second one in here would be exactly the kind of incomplete
// flow this round explicitly warns against) -> confirm -> clear success
// state. No plantation/usage step: PLANTATION_TYPES/USAGE_TYPES
// (pages/index.js) are French-only with emoji icons and feed the AI advice
// prompt specifically — not "already supported cleanly" for a catalog
// plant, so deliberately omitted this round (see round report).
export default function AddToGardenModal({ plant, locale, user, zones, zonesLoading, onClose, onSuccess }) {
  const { t } = useI18n();
  const [zoneId, setZoneId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const commonName = locale === "en" ? plant.preferredCommonNameEn : plant.preferredCommonNameFr;
  const title = commonName || plant.displayName;

  const handleConfirm = async () => {
    // Double-tap / accidental-resubmit guard for this one interaction —
    // same idiom as AuthModal/PlantContextEditor's own submitting guards.
    // Valid intentional duplicates (the same plant added again in a later,
    // separate visit) are never blocked — no uniqueness constraint exists
    // on plants for this, by design (see the round's audit: none did
    // before this round either).
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await gardenApi.insertCatalogPlant(user.id, {
        commonName: title,
        latinName: plant.displayName,
        family: plant.taxon?.family || null,
        catalogPlantId: plant.id,
        taxonId: plant.taxon?.id || null,
        zoneId: zoneId || null,
      });
      setSubmitting(false);
      setSuccess(true);
    } catch {
      setSubmitting(false);
      setError(t("finder.addToGardenError"));
    }
  };

  return (
    <div className="atg-overlay" onClick={onClose}>
      <style>{ATG_STYLES}</style>
      <div className="atg-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="atg-title">
        <IconButton icon={IconX} label={t("common.close")} onClick={onClose} className="atg-close-btn" />
        <div className="atg-brand"><IconLeaf size={16} /> Herbiose</div>

        {success ? (
          <>
            <div className="atg-success-icon"><IconCheck size={22} /></div>
            <div className="atg-title" id="atg-title">{t("finder.addToGardenSuccessTitle")}</div>
            <div className="atg-sub">{t("finder.addToGardenSuccessBody")}</div>
            <div className="atg-actions">
              <Button type="button" onClick={onSuccess}>{t("common.close")}</Button>
            </div>
          </>
        ) : (
          <>
            <div className="atg-title" id="atg-title">{t("finder.addToGardenTitle")}</div>
            <div className="atg-sub">{title}</div>

            {!zonesLoading && (
              <div className="atg-field">
                <label className="atg-label" htmlFor="atg-zone">{t("finder.addToGardenZoneLabel")}</label>
                {zones.length === 0 ? (
                  <div className="atg-hint">{t("finder.addToGardenNoZonesHint")}</div>
                ) : (
                  <select id="atg-zone" className="atg-select" value={zoneId} onChange={(e) => setZoneId(e.target.value)} disabled={submitting}>
                    <option value="">{t("garden.noZone")}</option>
                    {zones.map((z) => (
                      <option key={z.id} value={z.id}>{z.name}</option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {error && <div className="error-box">{error}</div>}

            <div className="atg-actions">
              <Button type="button" onClick={handleConfirm} disabled={submitting}>
                {submitting ? t("gardenZones.adding") : t("common.add")}
              </Button>
              <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
                {t("common.cancel")}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const ATG_STYLES = `
  .atg-overlay { position:fixed;inset:0;background:rgba(24,33,29,0.45);display:flex;align-items:center;justify-content:center;padding:20px;z-index:1000; }
  .atg-panel { position:relative;width:100%;max-width:420px;max-height:min(560px,90vh);overflow-y:auto;background:var(--pe-surface);border-radius:var(--pe-radius-lg);border:1px solid var(--pe-border);box-shadow:var(--pe-shadow-md);padding:28px; }
  .atg-close-btn.pe-icon-btn { position:absolute;top:16px;right:16px;width:44px;height:44px; }

  .atg-brand { display:flex;align-items:center;gap:6px;color:var(--pe-text-muted);font-size:12px;font-weight:600;margin-bottom:18px; }
  .atg-brand svg { color:var(--pe-accent);flex-shrink:0; }

  .atg-title { font-family:var(--pe-font-display);font-weight:600;font-size:20px;color:var(--pe-text);padding-right:36px; }
  .atg-sub { margin-top:4px;margin-bottom:18px;color:var(--pe-text-muted);font-size:13.5px; }

  .atg-field { margin-bottom:8px; }
  .atg-label { display:block;font-size:13px;font-weight:600;color:var(--pe-text);margin-bottom:7px; }
  .atg-select { width:100%;min-height:44px;border:1px solid var(--pe-border);border-radius:var(--pe-radius-sm);padding:10px 14px;font-family:var(--pe-font-body);font-size:14px;color:var(--pe-text);background:var(--pe-surface);outline:none;transition:border-color .15s; }
  .atg-select:focus { border-color:var(--pe-accent); }
  .atg-hint { font-size:12.5px;color:var(--pe-text-muted); }

  .atg-success-icon { width:44px;height:44px;border-radius:999px;background:var(--pe-sand);color:var(--pe-accent);display:flex;align-items:center;justify-content:center;margin-bottom:14px; }

  .atg-actions { display:flex;gap:8px;flex-wrap:wrap;margin-top:18px; }

  @media (max-width:480px) { .atg-panel { padding:22px; } }
`;
