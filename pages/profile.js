import { useEffect, useState } from "react";
import { useAuth } from "@/lib/useAuth";
import { fetchProfile, updateProfile } from "@/lib/profileApi";

const SPACE_TYPES = [
  { id: "jardin", label: "Jardin" },
  { id: "terrasse", label: "Terrasse" },
  { id: "balcon", label: "Balcon" },
  { id: "interieur", label: "Intérieur" },
  { id: "mixte", label: "Mixte" },
];

const EMPTY_FORM = { first_name: "", last_name: "", country: "", region: "", city: "", space_type: "" };

export default function ProfilePage() {
  const auth = useAuth();
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (auth.loading) return;
    if (!auth.user) { setLoading(false); return; }

    let cancelled = false;
    setLoading(true);
    setLoadError("");
    fetchProfile(auth.user.id)
      .then((profile) => {
        if (cancelled || !profile) return;
        setForm({
          first_name: profile.first_name || "",
          last_name: profile.last_name || "",
          country: profile.country || "",
          region: profile.region || "",
          city: profile.city || "",
          space_type: profile.space_type || "",
        });
      })
      .catch(() => { if (!cancelled) setLoadError("Impossible de charger votre profil pour le moment."); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [auth.user, auth.loading]);

  const updateField = (key) => (e) => {
    setSaveSuccess(false);
    setForm((f) => ({ ...f, [key]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving || !auth.user) return;
    setSaving(true);
    setSaveError("");
    setSaveSuccess(false);
    try {
      await updateProfile(auth.user.id, form);
      setSaveSuccess(true);
    } catch {
      setSaveError("Impossible d'enregistrer votre profil pour le moment. Réessaie.");
    } finally {
      setSaving(false);
    }
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
        .tab-page { padding:16px 16px 20px;max-width:480px;margin:0 auto; }
        .reset-panel { background:white;border-radius:var(--r);box-shadow:var(--shadow);padding:24px 20px;margin-top:20px; }
        .modal-title { font-family:'Cormorant Garamond',serif;font-size:22px;color:var(--forest);font-weight:700;margin-bottom:16px; }
        .modal-sub { color:#999;font-size:13px;margin-bottom:20px; }
        .auth-field { margin-bottom:14px; }
        .auth-field .plant-input { width:100%; }
        .auth-label { font-size:11px;font-weight:600;color:var(--forest);margin-bottom:5px;display:block; }
        .plant-input { border:1.5px solid rgba(0,0,0,0.12);border-radius:10px;padding:11px 14px;font-family:'Outfit',sans-serif;font-size:15px;outline:none;background:var(--cream); }
        .plant-input:focus { border-color:var(--moss); }
        .profile-readonly { border:1.5px solid rgba(0,0,0,0.08);border-radius:10px;padding:11px 14px;font-size:15px;background:var(--mist);color:#666; }
        .profile-hint { font-size:11px;color:#aaa;margin-top:4px; }
        .space-type-grid { display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:2px; }
        .space-type-btn { padding:12px 10px;border:2px solid rgba(0,0,0,0.1);border-radius:12px;background:var(--cream);cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px;font-weight:500;color:var(--ink);text-align:center;transition:all 0.15s; }
        .space-type-btn.active { border-color:var(--moss);background:var(--mist);color:var(--forest);font-weight:600; }
        .error-box { background:#fff5f5;border:1px solid rgba(139,58,30,0.2);border-radius:8px;padding:12px 14px;color:var(--rust);font-size:14px;margin:0 0 16px; }
        .auth-success-box { background:var(--mist);border-radius:8px;padding:12px 14px;color:var(--forest);font-size:13px;margin-bottom:16px;line-height:1.5; }
        .btn-modal-confirm { background:var(--forest);color:white;border:none;border-radius:12px;padding:14px;font-family:'Outfit',sans-serif;font-size:15px;font-weight:600;cursor:pointer;width:100%;text-align:center;text-decoration:none;display:block; }
        .btn-modal-confirm:disabled { opacity:0.4;cursor:not-allowed; }
        .back-btn { display:flex;align-items:center;gap:6px;background:none;border:none;color:var(--moss);font-family:'Outfit',sans-serif;font-size:14px;cursor:pointer;padding:0;margin-top:16px;font-weight:500;text-decoration:none; }
        .loading-state { text-align:center;padding:40px 20px; }
        .leaf-spin { font-size:48px;display:inline-block;animation:spin 2s linear infinite;margin-bottom:14px; }
        @keyframes spin { from{transform:rotate(0deg)}to{transform:rotate(360deg)} }
        .loading-title { font-family:'Cormorant Garamond',serif;font-size:20px;color:var(--forest); }
      `}</style>

      <div className="header">
        <h1>Plante <em>Expert</em></h1>
        <p>Mon profil</p>
      </div>

      <div className="tab-page">
        <div className="reset-panel">
          {auth.loading ? (
            <div className="loading-state">
              <div className="leaf-spin">🌿</div>
              <div className="loading-title">Chargement...</div>
            </div>
          ) : !auth.user ? (
            <>
              <div className="modal-title">Connexion requise</div>
              <div className="modal-sub">Connecte-toi pour accéder à ton profil.</div>
              <a href="/" className="btn-modal-confirm">Retour à Plant Expert</a>
            </>
          ) : (
            <>
              <div className="modal-title">Mon profil</div>

              <div className="auth-field">
                <label className="auth-label">Email</label>
                <div className="profile-readonly">{auth.user.email}</div>
                <div className="profile-hint">Non modifiable</div>
              </div>

              {loading ? (
                <div className="loading-state">
                  <div className="leaf-spin">🌿</div>
                  <div className="loading-title">Chargement du profil...</div>
                </div>
              ) : (
                <form onSubmit={handleSubmit}>
                  {loadError && <div className="error-box">{loadError}</div>}

                  <div className="auth-field">
                    <label className="auth-label" htmlFor="first_name">Prénom</label>
                    <input id="first_name" className="plant-input" value={form.first_name} onChange={updateField("first_name")} />
                  </div>
                  <div className="auth-field">
                    <label className="auth-label" htmlFor="last_name">Nom</label>
                    <input id="last_name" className="plant-input" value={form.last_name} onChange={updateField("last_name")} />
                  </div>
                  <div className="auth-field">
                    <label className="auth-label" htmlFor="country">Pays</label>
                    <input id="country" className="plant-input" value={form.country} onChange={updateField("country")} />
                  </div>
                  <div className="auth-field">
                    <label className="auth-label" htmlFor="region">Région / province</label>
                    <input id="region" className="plant-input" value={form.region} onChange={updateField("region")} />
                  </div>
                  <div className="auth-field">
                    <label className="auth-label" htmlFor="city">Ville</label>
                    <input id="city" className="plant-input" value={form.city} onChange={updateField("city")} />
                  </div>

                  <div className="auth-field">
                    <label className="auth-label">Mon espace</label>
                    <div className="space-type-grid">
                      {SPACE_TYPES.map((s) => (
                        <button
                          type="button"
                          key={s.id}
                          className={"space-type-btn" + (form.space_type === s.id ? " active" : "")}
                          onClick={() => { setSaveSuccess(false); setForm((f) => ({ ...f, space_type: s.id })); }}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {saveError && <div className="error-box">{saveError}</div>}
                  {saveSuccess && <div className="auth-success-box">Profil enregistré avec succès.</div>}

                  <button type="submit" className="btn-modal-confirm" disabled={saving}>
                    {saving ? "Enregistrement..." : "Enregistrer"}
                  </button>
                </form>
              )}

              <a href="/" className="back-btn">← Retour à Plant Expert</a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
