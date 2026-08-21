import { groupRemindersForDashboard } from "@/lib/reminderGrouping";
import { REMINDER_TYPES } from "@/lib/reminderOptions";

const TYPE_BY_ID = Object.fromEntries(REMINDER_TYPES.map((t) => [t.id, t]));
const MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MAX_NAMES_SHOWN = 3;

// Local calendar day only — never UTC — so "today"/"tomorrow"/"en retard"
// match the browser's actual local date near midnight.
function toLocalDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDateLabel(dateStr) {
  const today = new Date();
  const todayStr = toLocalDateString(today);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = toLocalDateString(tomorrow);

  if (dateStr === todayStr) return "Aujourd’hui";
  if (dateStr === tomorrowStr) return "Demain";

  const [y, m, d] = dateStr.split("-").map(Number);
  const formatted = `${d} ${MONTHS_FR[m - 1]} ${y}`;

  // Plain string comparison on YYYY-MM-DD is chronological — no Date
  // parsing/UTC involved here at all.
  return dateStr < todayStr ? `En retard · ${formatted}` : formatted;
}

function plantName(garden, plantId) {
  const plant = ((garden && garden.jardin) || []).find((p) => p.id === plantId);
  return (plant && plant.data && plant.data.identite && plant.data.identite.nom_commun) || "Plante";
}

function formatPlantNames(names) {
  if (names.length <= MAX_NAMES_SHOWN) return names.join(", ");
  const shown = names.slice(0, MAX_NAMES_SHOWN).join(", ");
  const rest = names.length - MAX_NAMES_SHOWN;
  return `${shown} + ${rest} autre${rest > 1 ? "s" : ""}`;
}

export default function RemindersOverview({ reminders, garden }) {
  if (reminders.requiresAuth || reminders.loading) return null;

  const groups = groupRemindersForDashboard(reminders.reminders);

  return (
    <div className="reminders-overview">
      <div className="reminders-overview-title">📋 Tâches</div>
      {groups.length === 0 ? (
        <div className="reminders-empty">Aucune tâche planifiée.</div>
      ) : (
        groups.map((g) => (
          <div className="reminders-date-group" key={g.date}>
            <div className="reminders-date-label">{formatDateLabel(g.date)}</div>
            {g.types.map((t) => {
              const typeInfo = TYPE_BY_ID[t.type];
              const names = t.plantIds.map((id) => plantName(garden, id));
              return (
                <div className="reminders-type-group" key={t.type}>
                  <div className="reminders-type-line">
                    {typeInfo ? typeInfo.icon : "🔔"} {typeInfo ? typeInfo.label : t.type} — {t.plantIds.length} plante{t.plantIds.length > 1 ? "s" : ""}
                    {t.hasSnoozed && <span className="reminders-snoozed-tag"> · reporté</span>}
                  </div>
                  <div className="reminders-plant-names">{formatPlantNames(names)}</div>
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
