import { useState } from "react";

export default function AuthModal({ auth, onClose }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const switchMode = (next) => {
    setMode(next);
    setError("");
    setSuccessMessage("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password || submitting) return;
    setSubmitting(true);
    setError("");
    setSuccessMessage("");

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
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{mode === "login" ? "Connexion" : "Créer un compte"}</div>
        <div className="modal-sub">Accédez à votre espace Plant Expert.</div>

        <div className="auth-tabs">
          <button type="button" className={"auth-tab" + (mode === "login" ? " active" : "")} onClick={() => switchMode("login")}>Se connecter</button>
          <button type="button" className={"auth-tab" + (mode === "signup" ? " active" : "")} onClick={() => switchMode("signup")}>Créer un compte</button>
        </div>

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

            {error && <div className="error-box">{error}</div>}

            <div className="modal-actions">
              <button type="submit" className="btn-modal-confirm" disabled={submitting}>
                {submitting ? "Veuillez patienter..." : mode === "login" ? "Se connecter" : "Créer mon compte"}
              </button>
              <button type="button" className="btn-modal-skip" onClick={onClose}>Annuler</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
