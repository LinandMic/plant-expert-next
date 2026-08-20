import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/useAuth";

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
    <div className="app">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=Outfit:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root { --ink:#0f1f0f;--forest:#1e3a1e;--moss:#3a6b3a;--sage:#7aad7a;--mist:#e8f0e8;--paper:#f4f2ed;--cream:#faf8f3;--gold:#c4962a;--rust:#8b3a1e;--r:14px;--shadow:0 4px 20px rgba(15,31,15,0.1); }
        body { font-family:'Outfit',sans-serif;background:var(--paper);color:var(--ink); }
        .app { min-height:100vh;padding-bottom:40px; }
        .header { background:var(--forest);padding:24px 20px 16px; }
        .header h1 { font-family:'Cormorant Garamond',serif;font-size:30px;font-weight:700;color:white; }
        .header h1 em { color:var(--sage);font-style:normal; }
        .header p { color:rgba(255,255,255,0.45);font-size:12px;margin-top:3px; }
        .tab-page { padding:16px 16px 20px;max-width:420px;margin:0 auto; }
        .reset-panel { background:white;border-radius:var(--r);box-shadow:var(--shadow);padding:24px 20px;margin-top:20px; }
        .modal-title { font-family:'Cormorant Garamond',serif;font-size:22px;color:var(--forest);font-weight:700;margin-bottom:4px; }
        .modal-sub { color:#999;font-size:13px;margin-bottom:20px; }
        .auth-field { margin-bottom:12px; }
        .auth-field .plant-input { width:100%; }
        .auth-label { font-size:11px;font-weight:600;color:var(--forest);margin-bottom:5px;display:block; }
        .plant-input { border:1.5px solid rgba(0,0,0,0.12);border-radius:10px;padding:11px 14px;font-family:'Outfit',sans-serif;font-size:15px;outline:none;background:var(--cream); }
        .plant-input:focus { border-color:var(--moss); }
        .error-box { background:#fff5f5;border:1px solid rgba(139,58,30,0.2);border-radius:8px;padding:12px 14px;color:var(--rust);font-size:14px;margin:0 0 16px; }
        .auth-success-box { background:var(--mist);border-radius:8px;padding:12px 14px;color:var(--forest);font-size:13px;margin-bottom:16px;line-height:1.5; }
        .btn-modal-confirm { background:var(--forest);color:white;border:none;border-radius:12px;padding:14px;font-family:'Outfit',sans-serif;font-size:15px;font-weight:600;cursor:pointer;width:100%;text-align:center;text-decoration:none;display:block; }
        .btn-modal-confirm:disabled { opacity:0.4;cursor:not-allowed; }
        .loading-state { text-align:center;padding:40px 20px; }
        .leaf-spin { font-size:48px;display:inline-block;animation:spin 2s linear infinite;margin-bottom:14px; }
        @keyframes spin { from{transform:rotate(0deg)}to{transform:rotate(360deg)} }
        .loading-title { font-family:'Cormorant Garamond',serif;font-size:20px;color:var(--forest); }
      `}</style>

      <div className="header">
        <h1>Plante <em>Expert</em></h1>
        <p>Réinitialisation du mot de passe</p>
      </div>

      <div className="tab-page">
        <div className="reset-panel">
          {status === "loading" && (
            <div className="loading-state">
              <div className="leaf-spin">🌿</div>
              <div className="loading-title">Vérification du lien...</div>
            </div>
          )}

          {status === "invalid" && (
            <>
              <div className="modal-title">Lien invalide</div>
              <div className="error-box">Ce lien de réinitialisation est invalide ou a expiré.</div>
              <a href="/" className="btn-modal-confirm">Retour à Plant Expert</a>
            </>
          )}

          {status === "ready" && (
            <form onSubmit={handleSubmit}>
              <div className="modal-title">Nouveau mot de passe</div>
              <div className="modal-sub">Choisissez un nouveau mot de passe pour votre compte.</div>
              <div className="auth-field">
                <label className="auth-label" htmlFor="new-password">Nouveau mot de passe</label>
                <input
                  id="new-password"
                  className="plant-input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>
              <div className="auth-field">
                <label className="auth-label" htmlFor="confirm-password">Confirmer le mot de passe</label>
                <input
                  id="confirm-password"
                  className="plant-input"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>
              {formError && <div className="error-box">{formError}</div>}
              <button type="submit" className="btn-modal-confirm" disabled={submitting}>
                {submitting ? "Veuillez patienter..." : "Changer le mot de passe"}
              </button>
            </form>
          )}

          {status === "success" && (
            <>
              <div className="modal-title">Mot de passe modifié avec succès</div>
              <div className="auth-success-box">Vous pouvez maintenant vous reconnecter avec votre nouveau mot de passe.</div>
              <a href="/" className="btn-modal-confirm">Retour à Plant Expert</a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
