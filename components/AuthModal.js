import { useState } from "react";
import { IconX, IconLeaf } from "@/components/ui/icons";
import IconButton from "@/components/ui/IconButton";
import Button from "@/components/ui/Button";

export default function AuthModal({ auth, onClose, initialMode = "login" }) {
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const switchMode = (next) => {
    setMode(next);
    setPassword("");
    setError("");
    setSuccessMessage("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setError("");
    setSuccessMessage("");

    if (mode === "forgot") {
      if (!email) return;
      setSubmitting(true);
      const { error } = await auth.requestPasswordReset(email);
      setSubmitting(false);
      if (error) { setError(error); return; }
      setSuccessMessage("Si un compte existe pour cette adresse, un email de réinitialisation a été envoyé.");
      return;
    }

    if (!email || !password) return;
    setSubmitting(true);

    if (mode === "login") {
      const { error } = await auth.signIn(email, password);
      setSubmitting(false);
      if (error) { setError(error); return; }
      onClose();
    } else {
      const { error, data } = await auth.signUp(email, password);
      setSubmitting(false);
      if (error) { setError(error); return; }
      if (data.needsEmailConfirmation) {
        setSuccessMessage("Compte créé ! Consultez votre boîte mail pour confirmer votre adresse avant de vous connecter.");
      } else {
        onClose();
      }
    }
  };

  return (
    <div className="am-overlay" onClick={onClose}>
      <style>{AM_STYLES}</style>
      <div
        className="am-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="am-title"
        aria-describedby="am-sub"
      >
        <IconButton icon={IconX} label="Fermer" onClick={onClose} className="am-close-btn" />

        <div className="am-brand"><IconLeaf size={16} /> Plant Expert</div>

        {mode === "forgot" ? (
          <>
            <button type="button" className="am-back-link" onClick={() => switchMode("login")}>← Retour à la connexion</button>
            <div className="am-title" id="am-title">Mot de passe oublié</div>
            <div className="am-sub" id="am-sub">Recevez un lien par email pour réinitialiser votre mot de passe.</div>
          </>
        ) : (
          <>
            <div className="am-title" id="am-title">{mode === "login" ? "Connexion" : "Créer un compte"}</div>
            <div className="am-sub" id="am-sub">Accédez à votre espace Plant Expert.</div>
            <div className="am-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={mode === "login"} className={"am-tab" + (mode === "login" ? " active" : "")} onClick={() => switchMode("login")}>Se connecter</button>
              <button type="button" role="tab" aria-selected={mode === "signup"} className={"am-tab" + (mode === "signup" ? " active" : "")} onClick={() => switchMode("signup")}>Créer un compte</button>
            </div>
          </>
        )}

        {successMessage ? (
          <>
            <div className="am-success">{successMessage}</div>
            <div className="am-actions">
              <Button type="button" variant="secondary" onClick={onClose}>Fermer</Button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="am-field">
              <label className="am-label" htmlFor="auth-email">Email</label>
              <input
                id="auth-email"
                className="am-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>

            {mode !== "forgot" && (
              <div className="am-field">
                <label className="am-label" htmlFor="auth-password">Mot de passe</label>
                <input
                  id="auth-password"
                  className="am-input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  minLength={6}
                  required
                />
              </div>
            )}

            {mode === "login" && (
              <button type="button" className="am-forgot-link" onClick={() => switchMode("forgot")}>
                Mot de passe oublié ?
              </button>
            )}

            {error && <div className="error-box">{error}</div>}

            <div className="am-actions">
              <Button type="submit" disabled={submitting}>
                {submitting
                  ? "Veuillez patienter..."
                  : mode === "login"
                  ? "Se connecter"
                  : mode === "signup"
                  ? "Créer mon compte"
                  : "Envoyer le lien"}
              </Button>
              <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const AM_STYLES = `
  .am-overlay { position:fixed;inset:0;background:rgba(24,33,29,0.45);display:flex;align-items:center;justify-content:center;padding:20px;z-index:1000; }
  .am-panel { position:relative;width:100%;max-width:440px;max-height:min(640px,90vh);overflow-y:auto;background:var(--pe-surface);border-radius:var(--pe-radius-lg);border:1px solid var(--pe-border);box-shadow:var(--pe-shadow-md);padding:28px; }
  .am-close-btn.pe-icon-btn { position:absolute;top:16px;right:16px;width:44px;height:44px; }

  .am-brand { display:flex;align-items:center;gap:6px;color:var(--pe-text-muted);font-size:12px;font-weight:600;margin-bottom:18px; }
  .am-brand svg { color:var(--pe-accent);flex-shrink:0; }

  .am-back-link { display:inline-flex;align-items:center;min-height:36px;padding:0;margin-bottom:6px;border:none;background:none;color:var(--pe-text-muted);font-family:var(--pe-font-body);font-size:12.5px;font-weight:600;cursor:pointer; }
  .am-back-link:hover { color:var(--pe-accent); }

  .am-title { font-family:var(--pe-font-display);font-weight:600;font-size:22px;color:var(--pe-text);padding-right:36px; }
  .am-sub { margin-top:4px;margin-bottom:18px;color:var(--pe-text-muted);font-size:13.5px; }

  .am-tabs { display:flex;gap:4px;margin-bottom:20px;border-bottom:1px solid var(--pe-border); }
  .am-tab { flex:1;min-height:44px;padding:10px 12px;border:none;background:none;color:var(--pe-text-muted);font-family:var(--pe-font-body);font-size:13.5px;font-weight:600;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px; }
  .am-tab:hover { color:var(--pe-text); }
  .am-tab.active { color:var(--pe-accent);border-bottom-color:var(--pe-accent); }
  .am-tab:focus-visible { outline:2px solid var(--pe-accent);outline-offset:-2px; }

  .am-field { margin-bottom:16px; }
  .am-label { display:block;font-size:13px;font-weight:600;color:var(--pe-text);margin-bottom:7px; }
  .am-input { width:100%;min-height:44px;border:1px solid var(--pe-border);border-radius:var(--pe-radius-sm);padding:10px 14px;font-family:var(--pe-font-body);font-size:14px;color:var(--pe-text);background:var(--pe-surface);outline:none;transition:border-color .15s; }
  .am-input:focus { border-color:var(--pe-accent); }

  .am-forgot-link { display:block;min-height:36px;background:none;border:none;color:var(--pe-accent);font-family:var(--pe-font-body);font-size:12.5px;font-weight:600;cursor:pointer;padding:0;margin:-6px 0 14px;text-align:right;width:100%; }
  .am-forgot-link:hover { text-decoration:underline; }

  .am-success { padding:12px 14px;border-radius:var(--pe-radius-sm);background:var(--pe-sand);color:var(--pe-accent);font-size:13.5px;line-height:1.5;margin-bottom:4px; }

  .am-actions { display:flex;gap:8px;flex-wrap:wrap;margin-top:18px; }

  @media (max-width:480px) { .am-panel { padding:22px; } }
`;
