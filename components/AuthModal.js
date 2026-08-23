import { useState } from "react";

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
    <div className="modal-overlay" onClick={onClose}>
      <style>{`.auth-forgot-link { display:block;background:none;border:none;color:var(--moss);font-family:'Outfit',sans-serif;font-size:12px;font-weight:500;cursor:pointer;padding:0;margin:-4px 0 12px;text-align:right;width:100%; }`}</style>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {mode === "forgot" ? (
          <>
            <button type="button" className="back-btn" onClick={() => switchMode("login")}>← Retour à la connexion</button>
            <div className="modal-title">Mot de passe oublié</div>
            <div className="modal-sub">Recevez un lien par email pour réinitialiser votre mot de passe.</div>
          </>
        ) : (
          <>
            <div className="modal-title">{mode === "login" ? "Connexion" : "Créer un compte"}</div>
            <div className="modal-sub">Accédez à votre espace Plant Expert.</div>
            <div className="auth-tabs">
              <button type="button" className={"auth-tab" + (mode === "login" ? " active" : "")} onClick={() => switchMode("login")}>Se connecter</button>
              <button type="button" className={"auth-tab" + (mode === "signup" ? " active" : "")} onClick={() => switchMode("signup")}>Créer un compte</button>
            </div>
          </>
        )}

        {successMessage ? (
          <>
            <div className="auth-success-box">{successMessage}</div>
            <div className="modal-actions">
              <button type="button" className="btn-modal-skip" onClick={onClose}>Fermer</button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="auth-field">
              <label className="auth-label" htmlFor="auth-email">Email</label>
              <input
                id="auth-email"
                className="plant-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>

            {mode !== "forgot" && (
              <div className="auth-field">
                <label className="auth-label" htmlFor="auth-password">Mot de passe</label>
                <input
                  id="auth-password"
                  className="plant-input"
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
              <button type="button" className="auth-forgot-link" onClick={() => switchMode("forgot")}>
                Mot de passe oublié ?
              </button>
            )}

            {error && <div className="error-box">{error}</div>}

            <div className="modal-actions">
              <button type="submit" className="btn-modal-confirm" disabled={submitting}>
                {submitting
                  ? "Veuillez patienter..."
                  : mode === "login"
                  ? "Se connecter"
                  : mode === "signup"
                  ? "Créer mon compte"
                  : "Envoyer le lien"}
              </button>
              <button type="button" className="btn-modal-skip" onClick={onClose}>Annuler</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
