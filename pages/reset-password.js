import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/useAuth";
import { IconLeaf, IconAlertCircle, IconCheck } from "@/components/ui/icons";
import Button from "@/components/ui/Button";

function urlAuthError() {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
  const search = window.location.search.startsWith("?") ? window.location.search.slice(1) : "";
  const params = new URLSearchParams(hash || search);
  return params.get("error") || params.get("error_code");
}

export default function ResetPasswordPage() {
  const auth = useAuth();
  const [status, setStatus] = useState("loading"); // loading | ready | invalid | success
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!supabase) { setStatus("invalid"); return; }
    if (urlAuthError()) { setStatus("invalid"); return; }

    let settled = false;

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" && session) {
        settled = true;
        setStatus("ready");
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      if (!settled && data.session) {
        settled = true;
        setStatus("ready");
      }
    });

    const timer = setTimeout(() => {
      if (!settled) setStatus("invalid");
    }, 5000);

    return () => {
      listener.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setFormError("");

    if (password.length < 8) { setFormError("Le mot de passe doit contenir au moins 8 caractères."); return; }
    if (password !== confirmPassword) { setFormError("Les mots de passe ne correspondent pas."); return; }

    setSubmitting(true);
    const { error } = await auth.updatePassword(password);
    if (error) {
      setSubmitting(false);
      setFormError(error);
      return;
    }
    await auth.signOut();
    setSubmitting(false);
    setStatus("success");
  };

  return (
    <div className="rp-page">
      <style>{RP_STYLES}</style>
      <div className="rp-brand"><IconLeaf size={20} /> <span>Plant Expert</span></div>

      <div className="rp-card">
        {status === "loading" && (
          <div className="rp-loading">
            <div className="rp-spinner" aria-hidden="true" />
            <div className="rp-loading-title">Vérification du lien...</div>
          </div>
        )}

        {status === "invalid" && (
          <>
            <div className="rp-status-icon rp-status-icon-warn"><IconAlertCircle size={22} /></div>
            <div className="rp-title">Lien invalide</div>
            <div className="error-box">Ce lien de réinitialisation est invalide ou a expiré.</div>
            <Button href="/" className="rp-cta">Retour à Plant Expert</Button>
          </>
        )}

        {status === "ready" && (
          <form onSubmit={handleSubmit}>
            <div className="rp-title">Nouveau mot de passe</div>
            <div className="rp-sub">Choisissez un nouveau mot de passe pour votre compte.</div>
            <div className="rp-field">
              <label className="rp-label" htmlFor="new-password">Nouveau mot de passe</label>
              <input
                id="new-password"
                className="rp-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            <div className="rp-field">
              <label className="rp-label" htmlFor="confirm-password">Confirmer le mot de passe</label>
              <input
                id="confirm-password"
                className="rp-input"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            {formError && <div className="error-box">{formError}</div>}
            <Button type="submit" disabled={submitting} className="rp-cta">
              {submitting ? "Veuillez patienter..." : "Changer le mot de passe"}
            </Button>
          </form>
        )}

        {status === "success" && (
          <>
            <div className="rp-status-icon rp-status-icon-success"><IconCheck size={22} /></div>
            <div className="rp-title">Mot de passe modifié avec succès</div>
            <div className="rp-success">Vous pouvez maintenant vous reconnecter avec votre nouveau mot de passe.</div>
            <Button href="/" className="rp-cta">Retour à Plant Expert</Button>
          </>
        )}
      </div>
    </div>
  );
}

const RP_STYLES = `
  .rp-page { min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 20px; }

  .rp-brand { display:flex;align-items:center;gap:8px;color:var(--pe-accent);font-family:var(--pe-font-display);font-weight:600;font-size:19px;margin-bottom:24px; }
  .rp-brand svg { flex-shrink:0; }

  .rp-card { width:100%;max-width:420px;background:var(--pe-surface);border:1px solid var(--pe-border);border-radius:var(--pe-radius-lg);box-shadow:var(--pe-shadow-sm);padding:32px 28px; }

  .rp-title { font-family:var(--pe-font-display);font-weight:600;font-size:22px;color:var(--pe-text);margin-bottom:6px; }
  .rp-sub { color:var(--pe-text-muted);font-size:13.5px;margin-bottom:20px; }

  .rp-field { margin-bottom:16px; }
  .rp-label { display:block;font-size:13px;font-weight:600;color:var(--pe-text);margin-bottom:7px; }
  .rp-input { width:100%;min-height:44px;border:1px solid var(--pe-border);border-radius:var(--pe-radius-sm);padding:10px 14px;font-family:var(--pe-font-body);font-size:14px;color:var(--pe-text);background:var(--pe-surface);outline:none;transition:border-color .15s; }
  .rp-input:focus { border-color:var(--pe-accent); }

  .rp-cta { width:100%;justify-content:center;margin-top:6px; }

  .rp-status-icon { width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin-bottom:16px; }
  .rp-status-icon-warn { background:#fff0ec;color:var(--pe-terracotta,#8b3a1e); }
  .rp-status-icon-success { background:var(--pe-sand);color:var(--pe-accent); }

  .rp-success { padding:12px 14px;border-radius:var(--pe-radius-sm);background:var(--pe-sand);color:var(--pe-accent);font-size:13.5px;line-height:1.5;margin-bottom:20px; }

  .rp-loading { text-align:center;padding:20px 0; }
  .rp-spinner { width:44px;height:44px;margin:0 auto 16px;border-radius:50%;border:3px solid var(--pe-sand);border-top-color:var(--pe-accent);animation:rp-spin .85s linear infinite; }
  @media (prefers-reduced-motion: reduce) { .rp-spinner { animation:none; } }
  @keyframes rp-spin { to { transform:rotate(360deg); } }
  .rp-loading-title { font-family:var(--pe-font-display);font-weight:600;font-size:17px;color:var(--pe-text); }

  @media (max-width:480px) { .rp-card { padding:24px 20px; } }
`;
