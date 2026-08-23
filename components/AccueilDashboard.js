import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import SectionHeader from "@/components/ui/SectionHeader";
import {
  IconSun,
  IconBell,
  IconAlertCircle,
  IconCamera,
  IconSearch,
  IconSprout,
  IconSprig,
} from "@/components/ui/icons";

// Same local-calendar-day convention as lib/reminderApi.js and
// lib/weatherEngine.js (never toISOString()/UTC) — kept as a small private
// copy here, consistent with how the rest of the codebase already
// duplicates this helper rather than sharing it across unrelated modules.
function toLocalDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function todayLocalDateString() {
  return toLocalDateString(new Date());
}

function plantDisplayName(plant) {
  return (plant.data && plant.data.identite && plant.data.identite.nom_commun) || null;
}

function WeatherCard({ todayWeather, weatherLoading, hint, city }) {
  return (
    <Card className="ad-summary-card ad-summary-weather">
      <div className="ad-summary-card-head">
        <span className="ad-summary-icon"><IconSun size={20} /></span>
        <span className="ad-summary-label">Météo</span>
      </div>
      {todayWeather ? (
        <>
          <div className="ad-summary-value-lg">{Math.round(todayWeather.temperatureMaxC)}°C</div>
          <div className="ad-summary-sub">
            {city ? `${city} · ` : ""}min {Math.round(todayWeather.temperatureMinC)}°C
          </div>
        </>
      ) : (
        <>
          <div className="ad-summary-value-lg">{weatherLoading ? "…" : "—"}</div>
          <div className="ad-summary-sub">{hint}</div>
        </>
      )}
    </Card>
  );
}

function CompactSummaryCard({ icon: Icon, label, value, hint }) {
  return (
    <Card className="ad-summary-card ad-summary-compact">
      <div className="ad-summary-card-head">
        <span className="ad-summary-icon"><Icon size={17} /></span>
        <span className="ad-summary-label">{label}</span>
      </div>
      <div className="ad-summary-value">{value}</div>
      {hint && <div className="ad-summary-sub">{hint}</div>}
    </Card>
  );
}

function DisconnectedPromo({ onLogin, onSignup }) {
  return (
    <Card className="ad-promo-card">
      <div className="ad-promo-content">
        <h2 className="ad-promo-title">Votre jardin, au même endroit</h2>
        <p className="ad-promo-text">
          Connectez-vous pour identifier vos plantes, organiser votre jardin en zones et suivre leur entretien au
          fil des saisons.
        </p>
        <div className="ad-promo-benefits">
          <div className="ad-promo-benefit">
            <IconCamera size={18} />
            <span>Identifier</span>
          </div>
          <div className="ad-promo-benefit">
            <IconSprout size={18} />
            <span>Organiser</span>
          </div>
          <div className="ad-promo-benefit">
            <IconBell size={18} />
            <span>Suivre</span>
          </div>
        </div>
        <div className="ad-promo-actions">
          <Button onClick={onLogin}>Se connecter</Button>
          <Button variant="secondary" onClick={onSignup}>
            Créer un compte
          </Button>
        </div>
      </div>
      <div className="ad-promo-illustration" aria-hidden="true">
        <IconSprig size={56} />
      </div>
    </Card>
  );
}

// The new Accueil dashboard (spec §11-12 of the redesign, refined in Phase
// 1.1). Every number shown here is derived from data the app already loads
// (auth/profile, garden, reminders, weather) — nothing is invented, and an
// unavailable data source always renders as an elegant empty/loading state
// rather than a fabricated value. Logged-out visitors get a dedicated
// promotional composition instead of near-empty summary cards.
export default function AccueilDashboard({
  firstName,
  jardin,
  gardenLoading,
  reminders,
  remindersLoading,
  weather,
  weatherLoading,
  isAuthenticated,
  onGoIdentifier,
  onGoJardin,
  onLogin,
  onSignup,
}) {
  const today = todayLocalDateString();
  const todayWeather =
    weather && Array.isArray(weather.days) ? weather.days.find((d) => d.date === today) : null;

  const activeReminders = (reminders || []).filter(
    (r) => r.isActive && (r.status === "pending" || r.status === "snoozed")
  );
  const dueCount = activeReminders.filter((r) => r.nextDueDate <= today).length;
  const overdueCount = activeReminders.filter((r) => r.nextDueDate < today).length;

  const previewPlants = (jardin || []).slice(0, 6);

  const weatherHint = weatherLoading
    ? "Chargement…"
    : isAuthenticated
    ? "Renseignez votre ville dans votre profil."
    : "Connectez-vous pour voir la météo.";

  return (
    <div className="ad-page">
      <style>{`
        .ad-hero { display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin-bottom:32px;padding-bottom:24px;border-bottom:1px solid var(--pe-border); }
        .ad-hero-title { font-family:var(--pe-font-display);font-weight:600;font-size:clamp(28px,3.4vw,44px);color:var(--pe-text);line-height:1.08; }
        .ad-hero-subtitle { margin-top:10px;font:var(--pe-text-body);color:var(--pe-text-muted);max-width:480px; }
        .ad-hero-mark { flex-shrink:0;width:64px;height:64px;border-radius:50%;background:var(--pe-sand);display:flex;align-items:center;justify-content:center;color:var(--pe-sage-400); }
        @media (max-width:640px) { .ad-hero { flex-direction:column;align-items:flex-start;gap:4px;padding-bottom:16px;margin-bottom:24px; } .ad-hero-mark { display:none; } }

        .ad-section { margin-bottom:36px; }

        .ad-summary-grid { display:grid;grid-template-columns:1.5fr 1fr;gap:16px; }
        @media (max-width:820px) { .ad-summary-grid { grid-template-columns:1fr; } }
        .ad-summary-stack { display:flex;flex-direction:column;gap:16px; }
        @media (max-width:820px) { .ad-summary-stack { flex-direction:row; } }
        @media (max-width:520px) { .ad-summary-stack { flex-direction:column; } }
        .ad-summary-card { padding:18px 20px;display:flex;flex-direction:column;gap:8px; }
        .ad-summary-weather { background:var(--pe-sand);border-color:transparent;justify-content:center; }
        .ad-summary-compact { flex:1; }
        .ad-summary-card-head { display:flex;align-items:center;gap:8px; }
        .ad-summary-icon { color:var(--pe-accent);display:flex; }
        .ad-summary-label { font:var(--pe-text-small);color:var(--pe-text-muted);text-transform:uppercase;letter-spacing:0.4px; }
        .ad-summary-value-lg { font-family:var(--pe-font-display);font-size:42px;font-weight:600;color:var(--pe-text);line-height:1.05; }
        .ad-summary-value { font-family:var(--pe-font-display);font-size:26px;font-weight:600;color:var(--pe-text);line-height:1.1; }
        .ad-summary-sub { font:var(--pe-text-small);color:var(--pe-text-muted);font-weight:400; }

        .ad-promo-card { display:flex;align-items:center;justify-content:space-between;gap:32px;padding:36px; }
        @media (max-width:700px) { .ad-promo-card { flex-direction:column;align-items:stretch;padding:24px 20px;gap:20px; } }
        .ad-promo-title { font-family:var(--pe-font-display);font-size:24px;font-weight:600;color:var(--pe-text);margin-bottom:8px; }
        .ad-promo-text { font:var(--pe-text-body);color:var(--pe-text-muted);max-width:440px;margin-bottom:18px; }
        .ad-promo-benefits { display:flex;gap:20px;margin-bottom:24px;flex-wrap:wrap; }
        .ad-promo-benefit { display:flex;align-items:center;gap:8px;font:var(--pe-text-small);color:var(--pe-text);font-weight:600; }
        .ad-promo-benefit svg { color:var(--pe-accent); }
        .ad-promo-actions { display:flex;gap:12px;flex-wrap:wrap; }
        .ad-promo-illustration { flex-shrink:0;width:120px;height:120px;border-radius:50%;background:var(--pe-sand);display:flex;align-items:center;justify-content:center;color:var(--pe-sage-400); }
        @media (max-width:700px) { .ad-promo-illustration { display:none; } }

        .ad-empty-card { padding:36px 24px;display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center;color:var(--pe-text-muted);font:var(--pe-text-body); }
        .ad-empty-card svg { color:var(--pe-sage-400); }

        .ad-garden-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:14px; }
        .ad-plant-card { padding:0;overflow:hidden; }
        .ad-plant-photo { aspect-ratio:1;background:var(--pe-sand);display:flex;align-items:center;justify-content:center;color:var(--pe-sage-400);overflow:hidden; }
        .ad-plant-photo img { width:100%;height:100%;object-fit:cover;display:block; }
        .ad-plant-name { padding:10px 12px;font:var(--pe-text-small);color:var(--pe-text);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }

        .ad-actions-grid { display:grid;grid-template-columns:repeat(4,1fr);gap:14px; }
        @media (max-width:900px) { .ad-actions-grid { grid-template-columns:repeat(2,1fr); } }
        .ad-action-card { padding:18px;display:flex;flex-direction:row;align-items:center;gap:14px;text-align:left; }
        .ad-action-card svg { flex-shrink:0; }
        .ad-action-text { min-width:0; }
        .ad-action-title { font:var(--pe-text-h3);color:inherit; }
        .ad-action-desc { margin-top:2px;font-size:12px;color:var(--pe-text-muted);font-weight:400;line-height:1.35; }
        .ad-action-card:first-child { background:var(--pe-accent);color:var(--pe-on-accent);border-color:transparent; }
        .ad-action-card:first-child svg { color:var(--pe-sage-400); }
        .ad-action-card:first-child .ad-action-desc { color:rgba(255,255,255,0.72); }
        @media (max-width:480px) { .ad-action-card { padding:14px; gap:10px; } }
      `}</style>

      <section className="ad-hero">
        <div>
          <h1 className="ad-hero-title">
            {isAuthenticated ? (firstName ? `Bonjour ${firstName}` : "Bonjour") : "Bienvenue dans Plant Expert"}
          </h1>
          <p className="ad-hero-subtitle">
            {isAuthenticated
              ? "Prenons soin de votre jardin aujourd'hui."
              : "Identifiez vos plantes, organisez votre jardin et suivez leur entretien."}
          </p>
        </div>
        <div className="ad-hero-mark" aria-hidden="true">
          <IconSprig size={28} />
        </div>
      </section>

      {isAuthenticated ? (
        <section className="ad-section">
          <SectionHeader title="Résumé du jour" />
          <div className="ad-summary-grid">
            <WeatherCard
              todayWeather={todayWeather}
              weatherLoading={weatherLoading}
              hint={weatherHint}
              city={weather && weather.location && weather.location.city}
            />
            <div className="ad-summary-stack">
              <CompactSummaryCard
                icon={IconBell}
                label="Tâches"
                value={remindersLoading ? "…" : String(dueCount)}
                hint={remindersLoading ? null : dueCount > 0 ? "à traiter aujourd'hui" : "rien pour l'instant"}
              />
              <CompactSummaryCard
                icon={IconAlertCircle}
                label="À surveiller"
                value={remindersLoading ? "…" : String(overdueCount)}
                hint={remindersLoading ? null : overdueCount > 0 ? "rappels en retard" : "tout est à jour"}
              />
            </div>
          </div>
        </section>
      ) : (
        <section className="ad-section">
          <DisconnectedPromo onLogin={onLogin} onSignup={onSignup} />
        </section>
      )}

      <section className="ad-section">
        <SectionHeader title="Dans votre jardin" actionLabel={jardin.length > 0 ? "Voir tout" : null} onAction={onGoJardin} />
        {gardenLoading ? (
          <Card className="ad-empty-card">
            <IconSprig size={26} />
            <p>Chargement de votre jardin…</p>
          </Card>
        ) : previewPlants.length === 0 ? (
          <Card className="ad-empty-card">
            <IconSprig size={26} />
            <p>{isAuthenticated ? "Votre jardin est encore vide." : "Connectez-vous pour retrouver votre jardin ici."}</p>
            {isAuthenticated && (
              <Button variant="secondary" onClick={onGoIdentifier}>
                Identifier une première plante
              </Button>
            )}
          </Card>
        ) : (
          <div className="ad-garden-grid">
            {previewPlants.map((plant) => (
              <Card key={plant.id} onClick={onGoJardin} className="ad-plant-card">
                <div className="ad-plant-photo">
                  {plant.imagePreview ? <img src={plant.imagePreview} alt="" /> : <IconSprig size={22} />}
                </div>
                <div className="ad-plant-name">{plantDisplayName(plant) || "Plante"}</div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="ad-section">
        <SectionHeader title="Actions rapides" />
        <div className="ad-actions-grid">
          <Card onClick={onGoIdentifier} className="ad-action-card">
            <IconCamera size={22} />
            <div className="ad-action-text">
              <div className="ad-action-title">Identifier</div>
              <div className="ad-action-desc">Photo ou nom de la plante</div>
            </div>
          </Card>
          <Card href="/plant-finder" className="ad-action-card">
            <IconSearch size={22} />
            <div className="ad-action-text">
              <div className="ad-action-title">Trouver une plante</div>
              <div className="ad-action-desc">Parcourir le catalogue</div>
            </div>
          </Card>
          <Card onClick={onGoJardin} className="ad-action-card">
            <IconBell size={22} />
            <div className="ad-action-text">
              <div className="ad-action-title">Mes rappels</div>
              <div className="ad-action-desc">Arrosage, taille, entretien</div>
            </div>
          </Card>
          <Card onClick={onGoJardin} className="ad-action-card">
            <IconSprout size={22} />
            <div className="ad-action-text">
              <div className="ad-action-title">Mon jardin</div>
              <div className="ad-action-desc">Plantes et zones</div>
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
}
