import { useState } from "react";
import { IconX, IconAlertCircle } from "@/components/ui/icons";
import IconButton from "@/components/ui/IconButton";
import Button from "@/components/ui/Button";
import { useI18n } from "@/lib/i18n";
import { deleteAccount } from "@/lib/accountApi";

// DeleteAccountModal — the explicit, deliberate confirmation step for
// "Delete my account" (App Store / Google Play account-deletion
// compliance). Mirrors AuthModal.js's overlay/panel structure and
// interaction conventions (role="dialog", focus-visible outlines, same
// min-height tap targets), but is otherwise a separate component: this
// flow's confirmation requirement (typing the exact confirmation word) and
// destructive-styling needs don't fit AuthModal's shape.
//
// Only ever mounted from pages/profile.js once a real authenticated user
// is already known — same precondition AddToGardenModal.js documents for
// itself, so this component has no "please log in" branch either.
export default function DeleteAccountModal({ onClose, onDeleted }) {
  const { t } = useI18n();
  const [confirmText, setConfirmText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const requiredWord = t("profile.deleteAccount.confirmWord");
  const canConfirm = confirmText.trim() === requiredWord && !submitting;

  const handleConfirm = async () => {
    // Double-tap / accidental-resubmit guard, same idiom as
    // AuthModal/AddToGardenModal's own submitting guards.
    if (!canConfirm) return;
    setSubmitting(true);
    setError("");
    const result = await deleteAccount();
    if (!result.ok) {
      setSubmitting(false);
      setError(t("profile.deleteAccount.error"));
      return;
    }
    onDeleted();
  };

  return (
    <div className="dam-overlay" onClick={submitting ? undefined : onClose}>
      <style>{DAM_STYLES}</style>
      <div
        className="dam-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dam-title"
        aria-describedby="dam-intro"
      >
        {!submitting && (
          <IconButton icon={IconX} label={t("auth.close")} onClick={onClose} className="dam-close-btn" />
        )}

        <div className="dam-icon"><IconAlertCircle size={22} /></div>
        <div className="dam-title" id="dam-title">{t("profile.deleteAccount.modalTitle")}</div>
        <p className="dam-intro" id="dam-intro">{t("profile.deleteAccount.modalIntro")}</p>

        <ul className="dam-list">
          <li>{t("profile.deleteAccount.itemPlants")}</li>
          <li>{t("profile.deleteAccount.itemPhotos")}</li>
          <li>{t("profile.deleteAccount.itemZones")}</li>
          <li>{t("profile.deleteAccount.itemReminders")}</li>
          <li>{t("profile.deleteAccount.itemProfile")}</li>
        </ul>

        <div className="dam-field">
          <label className="dam-label" htmlFor="dam-confirm-input">
            {t("profile.deleteAccount.confirmLabel")}
          </label>
          <input
            id="dam-confirm-input"
            className="dam-input"
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={t("profile.deleteAccount.confirmPlaceholder")}
            autoComplete="off"
            autoCapitalize="characters"
            disabled={submitting}
          />
        </div>

        {error && <div className="dam-error">{error}</div>}

        <div className="dam-actions">
          <Button type="button" className="dam-confirm-btn" disabled={!canConfirm} onClick={handleConfirm}>
            {submitting ? t("profile.deleteAccount.deleting") : t("profile.deleteAccount.confirmButton")}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            {t("profile.deleteAccount.cancel")}
          </Button>
        </div>
      </div>
    </div>
  );
}

const DAM_STYLES = `
  .dam-overlay { position:fixed;inset:0;background:rgba(24,33,29,0.45);display:flex;align-items:center;justify-content:center;padding:20px;z-index:1000; }
  .dam-panel { position:relative;width:100%;max-width:460px;max-height:min(680px,90vh);overflow-y:auto;background:var(--pe-surface);border-radius:var(--pe-radius-lg);border:1px solid var(--pe-border);box-shadow:var(--pe-shadow-md);padding:28px; }
  .dam-close-btn.pe-icon-btn { position:absolute;top:16px;right:16px;width:44px;height:44px; }

  .dam-icon { color:var(--pe-terracotta,#8b3a1e);margin-bottom:8px; }
  .dam-title { font-family:var(--pe-font-display);font-weight:600;font-size:21px;color:var(--pe-text);padding-right:36px; }
  .dam-intro { margin-top:8px;margin-bottom:10px;color:var(--pe-text-muted);font-size:13.5px;line-height:1.5; }

  .dam-list { margin:0 0 18px;padding-left:20px;color:var(--pe-text);font-size:13.5px;line-height:1.8; }

  .dam-field { margin-bottom:14px; }
  .dam-label { display:block;font-size:13px;font-weight:600;color:var(--pe-text);margin-bottom:7px; }
  .dam-input { width:100%;min-height:44px;border:1px solid var(--pe-border);border-radius:var(--pe-radius-sm);padding:10px 14px;font-family:var(--pe-font-body);font-size:14px;color:var(--pe-text);background:var(--pe-surface);outline:none;transition:border-color .15s; }
  .dam-input:focus { border-color:var(--pe-terracotta,#8b3a1e); }

  .dam-error { background:#fff5f5;border:1px solid rgba(139,58,30,0.2);border-radius:var(--pe-radius-sm);padding:12px 14px;color:var(--pe-terracotta,#8b3a1e);font-size:13.5px;line-height:1.5;margin-bottom:4px; }

  .dam-actions { display:flex;gap:8px;flex-wrap:wrap;margin-top:18px; }
  /* Destructive styling, scoped to this modal's own confirm button only —
     Button.js's shared "pe-btn-primary" class/theme is left untouched. */
  .dam-confirm-btn.pe-btn-primary { background:var(--pe-terracotta,#8b3a1e);border-color:var(--pe-terracotta,#8b3a1e);color:#fff; }
  .dam-confirm-btn.pe-btn-primary:disabled { opacity:0.45;cursor:not-allowed; }

  @media (max-width:480px) { .dam-panel { padding:22px; } }
`;
