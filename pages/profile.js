import { useEffect, useState } from "react";
import AppShell from "@/components/ui/AppShell";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { useAuth } from "@/lib/useAuth";
import { fetchProfile, updateProfile } from "@/lib/profileApi";
import { getExternalNavItems } from "@/components/ui/externalNavItems";
import { IconUser, IconMapPin, IconHome } from "@/components/ui/icons";
import { useI18n, SUPPORTED_LOCALES } from "@/lib/i18n";

const SPACE_TYPE_IDS = ["jardin", "terrasse", "balcon", "interieur", "mixte"];

const EMPTY_FORM = { first_name: "", last_name: "", country: "", region: "", city: "", space_type: "" };

// Same AccountBar pattern/markup as pages/index.js's own (page-local, not
// exported there) — reuses the exact same auth.signOut() call, not a second
// logout mechanism. Only rendered once a user is present; the unauthenticated
// branch below already has its own distinct "Connexion requise" panel.
function ProfileAccountBar({ auth }) {
  const { t } = useI18n();
  if (!auth.user) return null;
  return (
    <div className="pe-account-bar">
      <span className="pe-account-email">{auth.user.email}</span>
      <a className="pe-account-action" href="/profile">{t("account.myProfile")}</a>
      <button className="pe-account-action" onClick={() => auth.signOut()}>{t("account.logout")}</button>
    </div>
  );
}

// Discrete FR/EN switcher (round spec: placed in Profil since there's no
// Settings screen yet, must stay reachable even when logged out, >=44px tap
// targets on mobile). setLocale() persists the manual choice to
// localStorage — it always wins over browser auto-detection from then on.
function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className="pro-lang-switcher" role="group" aria-label={t("profile.language")}>
      <span className="pro-lang-switcher-label">{t("profile.language")}</span>
      <div className="pro-lang-switcher-pills">
        {SUPPORTED_LOCALES.map((loc) => (
          <button
            key={loc}
            type="button"
            className={"pro-lang-pill" + (locale === loc ? " active" : "")}
            aria-pressed={locale === loc}
            onClick={() => setLocale(loc)}
          >
            {loc === "fr" ? t("profile.languageFr") : t("profile.languageEn")}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const auth = useAuth();
  const { t } = useI18n();
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
      .catch(() => { if (!cancelled) setLoadError(t("profile.loadError")); })
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
      setSaveError(t("profile.saveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell navItems={getExternalNavItems(t)} activeKey="profil" topBar={<ProfileAccountBar auth={auth} />}>
      <div className="pro-page">
        <style>{PROFILE_STYLES}</style>

        {auth.loading ? (
          <div className="pro-loading" role="status" aria-live="polite">
            <div className="pro-spinner" aria-hidden="true" />
            <div className="pro-loading-title">{t("profile.loading")}</div>
          </div>
        ) : !auth.user ? (
          <Card className="pro-empty-card">
            <IconUser size={26} />
            <div className="pro-empty-title">{t("profile.loginRequiredTitle")}</div>
            <p className="pro-empty-sub">{t("profile.loginRequiredSub")}</p>
            <Button href="/">{t("profile.backToHome")}</Button>
            <LanguageSwitcher />
          </Card>
        ) : (
          <>
            <header className="pro-header">
              <div className="pro-eyebrow">{t("profile.eyebrow")}</div>
              <h1 className="pro-title">{t("profile.title")}</h1>
              <p className="pro-subtitle">{t("profile.subtitle")}</p>
            </header>

            {loading ? (
              <div className="pro-loading" role="status" aria-live="polite">
                <div className="pro-spinner" aria-hidden="true" />
                <div className="pro-loading-title">{t("profile.loadingProfile")}</div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="pro-form">
                {loadError && <div className="pro-error-box">{loadError}</div>}

                <Card className="pro-section">
                  <div className="pro-section-head"><IconUser size={18} /><span>{t("profile.personalInfo")}</span></div>
                  <div className="pro-field">
                    <label className="pro-label">{t("profile.email")}</label>
                    <div className="pro-readonly">{auth.user.email}</div>
                    <div className="pro-hint">{t("profile.notModifiable")}</div>
                  </div>
                  <div className="pro-field-row">
                    <div className="pro-field">
                      <label className="pro-label" htmlFor="first_name">{t("profile.firstName")}</label>
                      <input id="first_name" className="pro-input" value={form.first_name} onChange={updateField("first_name")} />
                    </div>
                    <div className="pro-field">
                      <label className="pro-label" htmlFor="last_name">{t("profile.lastName")}</label>
                      <input id="last_name" className="pro-input" value={form.last_name} onChange={updateField("last_name")} />
                    </div>
                  </div>
                </Card>

                <Card className="pro-section">
                  <div className="pro-section-head"><IconMapPin size={18} /><span>{t("profile.location")}</span></div>
                  <div className="pro-field-row">
                    <div className="pro-field">
                      <label className="pro-label" htmlFor="country">{t("profile.country")}</label>
                      <input id="country" className="pro-input" value={form.country} onChange={updateField("country")} />
                    </div>
                    <div className="pro-field">
                      <label className="pro-label" htmlFor="region">{t("profile.region")}</label>
                      <input id="region" className="pro-input" value={form.region} onChange={updateField("region")} />
                    </div>
                  </div>
                  <div className="pro-field">
                    <label className="pro-label" htmlFor="city">{t("profile.city")}</label>
                    <input id="city" className="pro-input" value={form.city} onChange={updateField("city")} />
                  </div>
                </Card>

                <Card className="pro-section">
                  <div className="pro-section-head"><IconHome size={18} /><span>{t("profile.mySpace")}</span></div>
                  <div className="pro-space-grid">
                    {SPACE_TYPE_IDS.map((id) => (
                      <button
                        type="button"
                        key={id}
                        aria-pressed={form.space_type === id}
                        className={"pro-space-btn" + (form.space_type === id ? " active" : "")}
                        onClick={() => { setSaveSuccess(false); setForm((f) => ({ ...f, space_type: id })); }}
                      >
                        {t(`profile.spaceTypes.${id}`)}
                      </button>
                    ))}
                  </div>
                </Card>

                <Card className="pro-section">
                  <LanguageSwitcher />
                </Card>

                {saveError && <div className="pro-error-box">{saveError}</div>}
                {saveSuccess && <div className="pro-success-box">{t("profile.saveSuccess")}</div>}

                <div className="pro-actions">
                  <Button type="submit" disabled={saving} className="pro-save-btn">
                    {saving ? t("profile.saving") : t("profile.save")}
                  </Button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

const PROFILE_STYLES = `
  .pro-page { max-width:720px; }
  .pro-header { margin-bottom:28px;padding-bottom:22px;border-bottom:1px solid var(--pe-border); }
  .pro-eyebrow { font:var(--pe-text-small);color:var(--pe-accent);text-transform:uppercase;letter-spacing:1.2px;font-weight:700; }
  .pro-title { margin-top:6px;font-family:var(--pe-font-display);font-weight:600;font-size:clamp(26px,3.2vw,40px);color:var(--pe-text);line-height:1.1; }
  .pro-subtitle { margin-top:8px;font:var(--pe-text-body);color:var(--pe-text-muted);max-width:480px; }
  @media (max-width:640px) { .pro-header { padding-bottom:16px;margin-bottom:22px; } }

  .pro-form { display:flex;flex-direction:column;gap:18px; }
  .pro-section { padding:22px; }
  .pro-section-head { display:flex;align-items:center;gap:9px;color:var(--pe-accent);font:var(--pe-text-h3);margin-bottom:18px; }

  .pro-field { margin-bottom:14px; }
  .pro-field:last-child { margin-bottom:0; }
  .pro-field-row { display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px; }
  .pro-label { display:block;margin-bottom:6px;font:var(--pe-text-small);color:var(--pe-text-muted);font-weight:600; }
  .pro-input { width:100%;height:46px;padding:0 14px;border-radius:var(--pe-radius-sm);border:1px solid var(--pe-border);background:var(--pe-surface);font:var(--pe-text-body);color:var(--pe-text);outline:none;transition:border-color .15s; }
  .pro-input:focus-visible { border-color:var(--pe-accent); }
  .pro-readonly { height:46px;display:flex;align-items:center;padding:0 14px;border-radius:var(--pe-radius-sm);border:1px solid var(--pe-border);background:var(--pe-sand);color:var(--pe-text-muted);font:var(--pe-text-body); }
  .pro-hint { margin-top:5px;font-size:11.5px;color:var(--pe-text-muted); }
  @media (max-width:560px) { .pro-field-row { grid-template-columns:1fr; gap:14px; } }

  .pro-space-grid { display:grid;grid-template-columns:repeat(3,1fr);gap:10px; }
  .pro-space-btn { min-height:44px;padding:12px 10px;border-radius:var(--pe-radius-sm);border:1.5px solid var(--pe-border);background:var(--pe-surface);color:var(--pe-text);font:var(--pe-text-small);font-weight:600;cursor:pointer;transition:border-color .15s,background-color .15s,color .15s; }
  .pro-space-btn.active { border-color:var(--pe-accent);background:var(--pe-sand);color:var(--pe-accent); }
  .pro-space-btn:focus-visible { outline:2px solid var(--pe-accent);outline-offset:2px; }
  @media (max-width:560px) { .pro-space-grid { grid-template-columns:repeat(2,1fr); } }

  .pro-error-box { background:#fff5f5;border:1px solid rgba(139,58,30,0.2);border-radius:var(--pe-radius-md);padding:14px 16px;color:var(--pe-terracotta,#8b3a1e);font:var(--pe-text-body); }
  .pro-success-box { background:var(--pe-sand);border-radius:var(--pe-radius-md);padding:14px 16px;color:var(--pe-accent);font:var(--pe-text-body); }

  .pro-actions { display:flex; }
  .pro-save-btn { min-width:200px; }
  @media (max-width:560px) { .pro-save-btn { width:100%; } }

  .pro-loading { display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:80px 24px;text-align:center; }
  .pro-spinner { width:48px;height:48px;border-radius:50%;border:3px solid var(--pe-sand);border-top-color:var(--pe-accent);animation:pro-spin .85s linear infinite; }
  @media (prefers-reduced-motion: reduce) { .pro-spinner { animation:none; } }
  @keyframes pro-spin { to { transform:rotate(360deg); } }
  .pro-loading-title { font:var(--pe-text-h3);color:var(--pe-text); }

  .pro-empty-card { padding:48px 24px;display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center;color:var(--pe-text-muted);font:var(--pe-text-body); }
  .pro-empty-card svg { color:var(--pe-sage-400); }
  .pro-empty-title { font:var(--pe-text-h3);color:var(--pe-text); }
  .pro-empty-sub { max-width:340px; }

  .pro-lang-switcher { display:flex;flex-direction:column;align-items:center;gap:8px;margin-top:20px; }
  .pro-lang-switcher-label { font:var(--pe-text-small);color:var(--pe-text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.4px; }
  .pro-lang-switcher-pills { display:inline-flex;gap:8px; }
  .pro-lang-pill { min-height:44px;min-width:76px;padding:9px 18px;border-radius:999px;border:1.5px solid var(--pe-border);background:var(--pe-surface);color:var(--pe-text-muted);font:var(--pe-text-small);font-weight:700;cursor:pointer;transition:border-color .15s,background-color .15s,color .15s; }
  .pro-lang-pill:hover { border-color:var(--pe-border-strong); }
  .pro-lang-pill:focus-visible { outline:2px solid var(--pe-accent);outline-offset:2px; }
  .pro-lang-pill.active { border-color:var(--pe-accent);background:var(--pe-sand);color:var(--pe-accent); }
`;
