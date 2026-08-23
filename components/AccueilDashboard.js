import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import PageHeader from "@/components/ui/PageHeader";
import SectionHeader from "@/components/ui/SectionHeader";
import { IconSun, IconBell, IconAlertCircle, IconCamera, IconSearch, IconSprout, IconLeaf } from "@/components/ui/icons";

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

function SummaryCard({ icon: Icon, label, value, hint }) {
  return (
    <Card className="ad-summary-card">
      <div className="ad-summary-icon">
        <Icon size={20} />
      </div>
      <div className="ad-summary-label">{label}</div>
      <div className="ad-summary-value">{value}</div>
      {hint && <div className="ad-summary-hint">{hint}</div>}
    </Card>
  );
}

// The new Accueil dashboard (spec §11-12). Every number shown here is
// derived from data the app already loads (auth/profile, garden, reminders,
// weather) — nothing is invented, and an unavailable data source always
// renders as an elegant empty/loading state rather than a fabricated value.
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

  let weatherHint;
  if (todayWeather) {
    weatherHint = (weather.location && weather.location.city) || null;
  } else if (weatherLoading) {
    weatherHint = "Chargement…";
  } else if (isAuthenticated) {
    weatherHint = "Renseignez votre ville dans votre profil.";
  } else {
    weatherHint = "Connectez-vous pour voir la météo.";
  }

  return (
    <div className="ad-page">
      <style>{`
        .ad-summary-row { display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:36px; }
        @media (max-width:640px) { .ad-summary-row { grid-template-columns:1fr; } }
        .ad-summary-card { padding:20px;display:flex;flex-direction:column;gap:6px; }
        .ad-summary-card:first-child { background:var(--pe-sand);border-color:transparent; }
        .ad-summary-icon { color:var(--pe-accent); }
        .ad-summary-label { font:var(--pe-text-small);color:var(--pe-text-muted);text-transform:uppercase;letter-spacing:0.4px; }
        .ad-summary-value { font-family:var(--pe-font-display);font-size:30px;font-weight:600;color:var(--pe-text);line-height:1.1; }
        .ad-summary-hint { font:var(--pe-text-small);color:var(--pe-text-muted);font-weight:400; }

        .ad-section { margin-bottom:40px; }

        .ad-empty-card { padding:44px 24px;display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center;color:var(--pe-text-muted);font:var(--pe-text-body); }
        .ad-empty-card svg { color:var(--pe-sage-400); }

        .ad-garden-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:14px; }
        .ad-plant-card { padding:0;overflow:hidden; }
        .ad-plant-photo { aspect-ratio:1;background:var(--pe-sand);display:flex;align-items:center;justify-content:center;color:var(--pe-sage-400);overflow:hidden; }
        .ad-plant-photo img { width:100%;height:100%;object-fit:cover;display:block; }
        .ad-plant-name { padding:10px 12px;font:var(--pe-text-small);color:var(--pe-text);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }

        .ad-actions-grid { display:grid;grid-template-columns:repeat(4,1fr);gap:14px; }
        @media (max-width:900px) { .ad-actions-grid { grid-template-columns:repeat(2,1fr); } }
        .ad-action-card { padding:22px 18px;display:flex;flex-direction:column;align-items:flex-start;gap:14px;font:var(--pe-text-h3);color:var(--pe-text); }
        .ad-action-card:first-child { background:var(--pe-accent);color:var(--pe-on-accent);border-color:transparent; }
        .ad-action-card:first-child svg { color:var(--pe-sage-400); }
      `}</style>

      <PageHeader
        title={firstName ? `Bonjour ${firstName}` : "Bonjour"}
        subtitle="Voici un aperçu de votre jardin aujourd'hui."
      />

      <div className="ad-summary-row">
        <SummaryCard
          icon={IconSun}
          label="Météo"
          value={todayWeather ? `${Math.round(todayWeather.temperatureMaxC)}°C` : weatherLoading ? "…" : "—"}
          hint={weatherHint}
        />
        <SummaryCard
          icon={IconBell}
          label="Tâches"
          value={remindersLoading ? "…" : String(dueCount)}
          hint={remindersLoading ? null : dueCount > 0 ? "à traiter aujourd'hui" : "rien pour l'instant"}
        />
        <SummaryCard
          icon={IconAlertCircle}
          label="À surveiller"
          value={remindersLoading ? "…" : String(overdueCount)}
          hint={remindersLoading ? null : overdueCount > 0 ? "rappels en retard" : "tout est à jour"}
        />
      </div>

      <section className="ad-section">
        <SectionHeader title="Dans votre jardin" actionLabel={jardin.length > 0 ? "Voir tout" : null} onAction={onGoJardin} />
        {gardenLoading ? (
          <Card className="ad-empty-card">
            <IconSprout size={26} />
            <p>Chargement de votre jardin…</p>
          </Card>
        ) : previewPlants.length === 0 ? (
          <Card className="ad-empty-card">
            <IconSprout size={26} />
            <p>Votre jardin est encore vide.</p>
            <Button variant="secondary" onClick={onGoIdentifier}>
              Identifier une première plante
            </Button>
          </Card>
        ) : (
          <div className="ad-garden-grid">
            {previewPlants.map((plant) => (
              <Card key={plant.id} onClick={onGoJardin} className="ad-plant-card">
                <div className="ad-plant-photo">
                  {plant.imagePreview ? <img src={plant.imagePreview} alt="" /> : <IconLeaf size={22} />}
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
            <span>Identifier une plante</span>
          </Card>
          <Card href="/plant-finder" className="ad-action-card">
            <IconSearch size={22} />
            <span>Trouver une plante</span>
          </Card>
          <Card onClick={onGoJardin} className="ad-action-card">
            <IconBell size={22} />
            <span>Voir mes rappels</span>
          </Card>
          <Card onClick={onGoJardin} className="ad-action-card">
            <IconSprout size={22} />
            <span>Mon jardin & zones</span>
          </Card>
        </div>
      </section>
    </div>
  );
}
