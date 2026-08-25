import { useEffect, useState } from "react";
import { groupRemindersForDashboard } from "@/lib/reminderGrouping";
import { REMINDER_TYPES } from "@/lib/reminderOptions";
import { IconBell, IconDroplet, IconScissors, IconSprout, IconSearch, IconCheck, IconX, IconSun, IconAlertCircle } from "@/components/ui/icons";

const TYPE_BY_ID = Object.fromEntries(REMINDER_TYPES.map((t) => [t.id, t]));
const MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MAX_NAMES_SHOWN = 3;

// Sober, design-system icons for each reminder type — a direct 1:1 fit for
// four of the six (spec: icon only where it genuinely helps scanning "quoi
// faire"); repotting/general_care/any unrecognized type share the same
// generic bell the original code already fell back to for unknown types.
// Never touches `lib/reminderOptions.js` itself — that file (and its
// emoji `icon` field) stays exactly as-is, only unused by this renderer now.
const ICON_BY_TYPE = {
  watering: IconDroplet,
  pruning: IconScissors,
  fertilizing: IconSprout,
  pest_check: IconSearch,
};
function typeIcon(typeId) {
  return ICON_BY_TYPE[typeId] || IconBell;
}

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
  return `${d} ${MONTHS_FR[m - 1]} ${y}`;
}

// Purely a display partition of the already-sorted, already-dated groups
// `groupRemindersForDashboard` returns — no new business logic, the same
// three-way comparison (`date <=> today`) the original inline label already
// made per group. lib/reminderGrouping.js itself is untouched.
function bucketGroupsByUrgency(groups, todayStr) {
  const overdue = [];
  const today = [];
  const upcoming = [];
  for (const g of groups) {
    if (g.date < todayStr) overdue.push(g);
    else if (g.date === todayStr) today.push(g);
    else upcoming.push(g);
  }
  return { overdue, today, upcoming };
}

// A reminder can only meaningfully be snoozed while it's still in a
// pending/snoozed, active state — once any other action (individual or
// grouped) has moved it to done/skipped, or moved it to a different date,
// snoozing it further makes no sense and must never be attempted.
function isReminderActionable(reminder) {
  return !!reminder && reminder.isActive && (reminder.status === "pending" || reminder.status === "snoozed");
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

// Renders a read-only weather hint under a watering reminder. It never
// mutates anything itself: CONSIDER_SNOOZE's "Reporter au..." button only
// opens/pre-fills the existing individual snooze form (via onOpenSnooze),
// exactly like the plain "Reporter" button — the user still has to click
// "Confirmer" there for anything to actually change. KEEP and
// INSUFFICIENT_DATA render nothing, by design (no noise for the common
// case, no false confidence when data is missing).
function WeatherHint({ recommendation, busy, onOpenSnooze }) {
  if (!recommendation) return null;

  if (recommendation.status === "CONSIDER_SNOOZE") {
    return (
      <div className="rem-weather-hint">
        <div className="rem-weather-hint-text">
          Pluie récente ou prévue importante. L&apos;arrosage est peut-être moins nécessaire.
        </div>
        {recommendation.suggestedDate && (
          <button
            type="button"
            className="rem-action-btn"
            disabled={busy}
            onClick={() => onOpenSnooze(recommendation.suggestedDate)}
          >
            Reporter au {formatDateLabel(recommendation.suggestedDate)}
          </button>
        )}
      </div>
    );
  }

  if (recommendation.status === "CHECK_SOONER") {
    return (
      <div className="rem-weather-hint">
        <div className="rem-weather-hint-text">
          <IconSun size={14} /> Temps chaud et sec prévu. Une vérification plus tôt peut être utile.
        </div>
      </div>
    );
  }

  return null;
}

function ReminderRow({ name, item, busy, error, snoozeDraft, weatherRecommendation, onMarkDone, onMarkSkipped, onOpenSnooze, onCancelSnooze, onChangeSnoozeDate, onConfirmSnooze }) {
  const isSnoozing = !!(snoozeDraft && snoozeDraft.open);
  return (
    <div className="rem-item-row">
      <div className="rem-item-name">
        {name}
        {item.status === "snoozed" && <span className="rem-snoozed-tag"> · reporté</span>}
      </div>
      {!isSnoozing ? (
        <div className="rem-item-actions">
          <button type="button" className="rem-action-btn" disabled={busy} onClick={onMarkDone}><IconCheck size={14} /> Fait</button>
          <button type="button" className="rem-action-btn" disabled={busy} onClick={() => onOpenSnooze()}>Reporter</button>
          <button type="button" className="rem-action-btn" disabled={busy} onClick={onMarkSkipped}><IconX size={14} /> Ignorer</button>
        </div>
      ) : (
        <div className="rem-snooze-form">
          <label className="rem-label" htmlFor={`snooze-${item.reminderId}`}>Nouvelle date</label>
          <input
            id={`snooze-${item.reminderId}`}
            type="date"
            className="rem-input"
            value={(snoozeDraft && snoozeDraft.date) || ""}
            onChange={(e) => onChangeSnoozeDate(e.target.value)}
          />
          <div className="rem-item-actions">
            <button type="button" className="rem-action-btn rem-action-btn-primary" disabled={busy} onClick={onConfirmSnooze}>Confirmer</button>
            <button type="button" className="rem-action-btn" disabled={busy} onClick={onCancelSnooze}>Annuler</button>
          </div>
        </div>
      )}
      {!isSnoozing && <WeatherHint recommendation={weatherRecommendation} busy={busy} onOpenSnooze={onOpenSnooze} />}
      {error && <div className="rem-item-error"><IconAlertCircle size={13} /> {error}</div>}
    </div>
  );
}

export default function RemindersOverview({ reminders, garden, actions, weatherRecommendations = {}, weatherLocationName = null }) {
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  const [busyIds, setBusyIds] = useState(() => new Set());
  const [itemErrors, setItemErrors] = useState({});
  const [snoozeState, setSnoozeState] = useState({});
  const [confirmingGroup, setConfirmingGroup] = useState(null); // { groupKey, action: "done" | "skip" | "snooze", date } | null
  const [groupBusyKeys, setGroupBusyKeys] = useState(() => new Set());
  const [groupResultMessages, setGroupResultMessages] = useState({});

  // Self-healing: whenever the underlying reminders change (e.g. a grouped
  // action just moved one of them to done/skipped/a new date from under an
  // open individual "Reporter" form), drop any snoozeState entry that is no
  // longer actionable so the stale form closes on its own.
  useEffect(() => {
    const list = reminders.reminders || [];
    setSnoozeState((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const reminderId of Object.keys(prev)) {
        const current = list.find((r) => r.id === reminderId);
        if (!isReminderActionable(current)) {
          delete next[reminderId];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [reminders.reminders]);

  if (reminders.requiresAuth || reminders.loading) return null;

  const groups = groupRemindersForDashboard(reminders.reminders);
  const todayStr = toLocalDateString(new Date());
  const buckets = bucketGroupsByUrgency(groups, todayStr);

  const toggleGroup = (key) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const setBusy = (id, isBusy) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (isBusy) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const setItemError = (id, message) => {
    setItemErrors((prev) => ({ ...prev, [id]: message || null }));
  };

  const handleMarkDone = async (reminderId) => {
    if (busyIds.has(reminderId)) return;
    setBusy(reminderId, true);
    setItemError(reminderId, null);
    const { error } = await actions.markDone(reminderId);
    setBusy(reminderId, false);
    if (error) setItemError(reminderId, error);
  };

  const handleMarkSkipped = async (reminderId) => {
    if (busyIds.has(reminderId)) return;
    setBusy(reminderId, true);
    setItemError(reminderId, null);
    const { error } = await actions.markSkipped(reminderId);
    setBusy(reminderId, false);
    if (error) setItemError(reminderId, error);
  };

  // suggestedDate is optional: the plain "Reporter" button calls this
  // with no argument (unchanged behavior); the weather hint's "Reporter
  // au..." button passes its suggested date to pre-fill the same form. It
  // never overrides a date the user already started typing.
  const openSnooze = (reminderId, suggestedDate) => {
    setItemError(reminderId, null);
    setSnoozeState((prev) => ({
      ...prev,
      [reminderId]: { open: true, date: (prev[reminderId] && prev[reminderId].date) || suggestedDate || "" },
    }));
  };

  const closeSnooze = (reminderId) => {
    setSnoozeState((prev) => {
      const next = { ...prev };
      delete next[reminderId];
      return next;
    });
    setItemError(reminderId, null);
  };

  const changeSnoozeDate = (reminderId, date) => {
    setSnoozeState((prev) => ({ ...prev, [reminderId]: { open: true, date } }));
  };

  const confirmSnooze = async (reminderId) => {
    if (busyIds.has(reminderId)) return;
    const draft = snoozeState[reminderId];
    if (!draft || !draft.date) {
      setItemError(reminderId, "Choisis une nouvelle date.");
      return;
    }
    // Hard backstop: even if the pruning effect above hasn't run yet (e.g.
    // this confirm fires in the same tick as a concurrent grouped action),
    // never mutate a reminder that isn't actionable anymore.
    const current = (reminders.reminders || []).find((r) => r.id === reminderId);
    if (!isReminderActionable(current)) {
      closeSnooze(reminderId);
      return;
    }
    setBusy(reminderId, true);
    setItemError(reminderId, null);
    const { error } = await actions.snooze(reminderId, draft.date);
    setBusy(reminderId, false);
    if (error) {
      // Keep the modal/draft usable: preserve the chosen date, just show the error.
      setItemError(reminderId, error);
      return;
    }
    closeSnooze(reminderId);
  };

  const setGroupBusy = (groupKey, isBusy) => {
    setGroupBusyKeys((prev) => {
      const next = new Set(prev);
      if (isBusy) next.add(groupKey);
      else next.delete(groupKey);
      return next;
    });
  };

  const setGroupResultMessage = (groupKey, message) => {
    setGroupResultMessages((prev) => ({ ...prev, [groupKey]: message || null }));
  };

  // Three strictly separated entry points so a click can never both open
  // and execute a group action:
  //   - requestGroupAction only ever calls setConfirmingGroup(...) — it
  //     never touches the network.
  //   - cancelGroupAction only ever calls setConfirmingGroup(null) —
  //     likewise inert.
  //   - confirmGroupAction is the ONLY function that may call
  //     markDone/markSkipped, and it re-derives everything (which group,
  //     which action, which reminder ids) from the current confirmingGroup
  //     state and the live `groups` at call time — never from a value
  //     captured by a render-time JSX closure — so a stale closure can
  //     never feed it the wrong target list.
  const requestGroupAction = (groupKey, action) => {
    setConfirmingGroup({ groupKey, action, date: "" });
  };

  const cancelGroupAction = () => {
    setConfirmingGroup(null);
  };

  const changeGroupSnoozeDate = (date) => {
    setConfirmingGroup((prev) => (prev ? { ...prev, date } : prev));
  };

  // Reuses markDone/markSkipped/snooze exactly as the individual actions
  // do — no business logic (recurrence math, status transitions) is
  // duplicated here, this only fans the same per-item call out
  // concurrently and tallies the outcomes. Any reminderId already mid an
  // individual action is skipped from the batch (never double-submitted),
  // and the group keeps going through every remaining id even if some
  // fail, so partial success is never silently reported as full success.
  const confirmGroupAction = async () => {
    const pending = confirmingGroup;
    if (!pending) return;
    const { groupKey, action } = pending;
    if (groupBusyKeys.has(groupKey)) return;

    if (action === "snooze" && !pending.date) {
      setGroupResultMessage(groupKey, "Choisis une nouvelle date.");
      return;
    }

    const [date, type] = groupKey.split("::");
    const group = groups.find((g) => g.date === date);
    const typeGroup = group && group.types.find((t) => t.type === type);
    const allReminderIds = typeGroup ? typeGroup.items.map((i) => i.reminderId) : [];
    const targetIds = allReminderIds.filter((id) => !busyIds.has(id));

    setConfirmingGroup(null);
    if (targetIds.length === 0) return;

    setGroupBusy(groupKey, true);
    targetIds.forEach((id) => setBusy(id, true));
    setGroupResultMessage(groupKey, null);

    const actionFn =
      action === "done"
        ? actions.markDone
        : action === "skip"
        ? actions.markSkipped
        : (id) => actions.snooze(id, pending.date);
    const results = await Promise.allSettled(targetIds.map((id) => actionFn(id)));

    const failCount = results.filter(
      (r) => r.status === "rejected" || (r.status === "fulfilled" && r.value && r.value.error)
    ).length;
    const successCount = targetIds.length - failCount;

    targetIds.forEach((id) => setBusy(id, false));
    setGroupBusy(groupKey, false);

    if (failCount > 0) {
      setGroupResultMessage(
        groupKey,
        `${successCount} rappel${successCount > 1 ? "s" : ""} mis à jour sur ${targetIds.length}. ${failCount} ${failCount > 1 ? "ont échoué" : "a échoué"}.`
      );
    } else {
      setGroupResultMessage(groupKey, null);
    }
  };

  // dateLabel: under the "En retard" bucket the section header already says
  // so, so the per-date sub-label only needs the plain date (no repeated
  // "En retard ·" prefix). Under "Aujourd'hui" every group shares the exact
  // same date by definition, so repeating "Aujourd'hui" as a sub-label too
  // would be pure duplication — hidden there. "À venir" keeps
  // formatDateLabel as before ("Demain" / a plain date), since it can span
  // several distinct dates that do need to stay distinguishable.
  const renderDateGroup = (g, { plainDate, hideLabel } = {}) => (
    <div className="rem-date-group" key={g.date}>
      {!hideLabel && (
        <div className="rem-date-label">
          {plainDate ? (() => { const [y, m, d] = g.date.split("-").map(Number); return `${d} ${MONTHS_FR[m - 1]} ${y}`; })() : formatDateLabel(g.date)}
        </div>
      )}
      {g.types.map((t) => {
        const typeInfo = TYPE_BY_ID[t.type];
        const TypeIcon = typeIcon(t.type);
        const names = t.plantIds.map((id) => plantName(garden, id));
        const groupKey = `${g.date}::${t.type}`;
        const isExpanded = expandedGroups.has(groupKey);
        return (
          <div className="rem-type-group" key={t.type}>
            <div className="rem-type-line">
              <span className="rem-type-line-label">
                <TypeIcon size={16} />
                {typeInfo ? typeInfo.label : t.type} — {t.plantIds.length} plante{t.plantIds.length > 1 ? "s" : ""}
              </span>
              {t.hasSnoozed && <span className="rem-snoozed-tag"> · reporté</span>}
              <button type="button" className="rem-manage-btn" onClick={() => toggleGroup(groupKey)} aria-expanded={isExpanded}>
                {isExpanded ? "Fermer" : "Gérer"}
              </button>
            </div>

            {!isExpanded && <div className="rem-plant-names">{formatPlantNames(names)}</div>}

            {isExpanded && t.items.length > 1 && (
              <div className="rem-group-actions">
                {groupBusyKeys.has(groupKey) ? (
                  <span key="busy" className="rem-group-busy">Mise à jour…</span>
                ) : confirmingGroup && confirmingGroup.groupKey === groupKey ? (
                  <div key="confirm">
                    {confirmingGroup.action === "snooze" ? (
                      <>
                        <span className="rem-group-confirm-text">Reporter ces {t.items.length} rappels</span>
                        <div className="rem-field">
                          <label className="rem-label" htmlFor={`group-snooze-${groupKey}`}>Nouvelle date</label>
                          <input
                            id={`group-snooze-${groupKey}`}
                            type="date"
                            className="rem-input"
                            value={confirmingGroup.date || ""}
                            onChange={(e) => changeGroupSnoozeDate(e.target.value)}
                          />
                        </div>
                      </>
                    ) : (
                      <span className="rem-group-confirm-text">
                        {confirmingGroup.action === "done"
                          ? `Marquer ces ${t.items.length} rappels comme faits ?`
                          : `Ignorer ces ${t.items.length} rappels ?`}
                      </span>
                    )}
                    <div className="rem-item-actions">
                      <button type="button" className="rem-action-btn rem-action-btn-primary" onClick={() => confirmGroupAction()}>
                        Confirmer
                      </button>
                      <button type="button" className="rem-action-btn" onClick={() => cancelGroupAction()}>Annuler</button>
                    </div>
                  </div>
                ) : (
                  <div key="default" className="rem-item-actions">
                    <button type="button" className="rem-action-btn" onClick={() => requestGroupAction(groupKey, "done")}><IconCheck size={14} /> Tout fait</button>
                    <button type="button" className="rem-action-btn" onClick={() => requestGroupAction(groupKey, "snooze")}>Reporter tout</button>
                    <button type="button" className="rem-action-btn" onClick={() => requestGroupAction(groupKey, "skip")}><IconX size={14} /> Ignorer tout</button>
                  </div>
                )}
                {groupResultMessages[groupKey] && <div className="rem-item-error"><IconAlertCircle size={13} /> {groupResultMessages[groupKey]}</div>}
              </div>
            )}

            {isExpanded && (
              <div className="rem-item-list">
                {t.items.map((item) => (
                  <ReminderRow
                    key={item.reminderId}
                    name={plantName(garden, item.plantId)}
                    item={item}
                    busy={busyIds.has(item.reminderId)}
                    error={itemErrors[item.reminderId]}
                    snoozeDraft={snoozeState[item.reminderId]}
                    weatherRecommendation={weatherRecommendations[item.reminderId]}
                    onMarkDone={() => handleMarkDone(item.reminderId)}
                    onMarkSkipped={() => handleMarkSkipped(item.reminderId)}
                    onOpenSnooze={(suggestedDate) => openSnooze(item.reminderId, suggestedDate)}
                    onCancelSnooze={() => closeSnooze(item.reminderId)}
                    onChangeSnoozeDate={(date) => changeSnoozeDate(item.reminderId, date)}
                    onConfirmSnooze={() => confirmSnooze(item.reminderId)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="rem-panel">
      <style>{REM_STYLES}</style>

      <div className="rem-title"><IconBell size={17} /> Tâches</div>
      {weatherLocationName && (
        <>
          <div className="rem-weather-line"><IconSun size={14} /> Météo : {weatherLocationName}</div>
          <div className="rem-weather-attribution">
            Données météo :{" "}
            <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a>
            {" · "}
            <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>
          </div>
        </>
      )}
      {groups.length === 0 ? (
        <div className="rem-empty">Aucune tâche planifiée.</div>
      ) : (
        <>
          {buckets.overdue.length > 0 && (
            <div className="rem-bucket">
              <div className="rem-section-label rem-section-label-overdue">En retard</div>
              {buckets.overdue.map((g) => renderDateGroup(g, { plainDate: true }))}
            </div>
          )}
          {buckets.today.length > 0 && (
            <div className="rem-bucket">
              <div className="rem-section-label">Aujourd&apos;hui</div>
              {buckets.today.map((g) => renderDateGroup(g, { hideLabel: true }))}
            </div>
          )}
          {buckets.upcoming.length > 0 && (
            <div className="rem-bucket">
              <div className="rem-section-label">À venir</div>
              {buckets.upcoming.map((g) => renderDateGroup(g))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const REM_STYLES = `
  .rem-title { display:flex;align-items:center;gap:8px;font-family:var(--pe-font-display);font-weight:600;font-size:18px;color:var(--pe-text);margin-bottom:10px; }
  .rem-title svg { color:var(--pe-accent);flex-shrink:0; }

  .rem-weather-line { display:flex;align-items:center;gap:6px;color:var(--pe-text-muted);font-size:13px;font-weight:600;margin-bottom:2px; }
  .rem-weather-attribution { color:var(--pe-text-muted);font-size:11px;margin-bottom:14px; }
  .rem-weather-attribution a { color:var(--pe-text-muted);text-decoration:underline; }

  .rem-empty { color:var(--pe-text-muted);font-size:13.5px;line-height:1.5; }

  .rem-bucket { margin-bottom:18px; }
  .rem-bucket:last-child { margin-bottom:0; }
  .rem-section-label { font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--pe-text-muted);margin-bottom:10px; }
  .rem-section-label-overdue { color:var(--pe-terracotta,#8b3a1e); }

  .rem-date-group { margin-bottom:14px; }
  .rem-date-group:last-child { margin-bottom:0; }
  .rem-date-label { font-size:13px;font-weight:700;color:var(--pe-text);margin-bottom:8px; }

  .rem-type-group { background:var(--pe-ivory);border:1px solid var(--pe-border);border-radius:var(--pe-radius-sm);padding:12px 14px;margin-bottom:8px; }
  .rem-type-group:last-child { margin-bottom:0; }
  .rem-type-line { display:flex;align-items:center;flex-wrap:wrap;gap:8px; }
  .rem-type-line-label { display:flex;align-items:center;gap:7px;font-size:13.5px;font-weight:600;color:var(--pe-text); }
  .rem-type-line-label svg { color:var(--pe-accent);flex-shrink:0; }
  .rem-snoozed-tag { color:var(--pe-text-muted);font-size:12px;font-weight:600; }
  .rem-manage-btn { margin-left:auto;min-height:44px;padding:6px 12px;border:none;background:none;border-radius:var(--pe-radius-sm);color:var(--pe-accent);font-family:var(--pe-font-body);font-size:12.5px;font-weight:700;cursor:pointer; }
  .rem-manage-btn:hover { background:var(--pe-sand); }
  .rem-manage-btn:focus-visible { outline:2px solid var(--pe-accent);outline-offset:-2px; }

  .rem-plant-names { margin-top:4px;color:var(--pe-text-muted);font-size:12.5px; }

  .rem-group-actions { margin-top:10px;padding-top:10px;border-top:1px solid var(--pe-border); }
  .rem-group-busy { color:var(--pe-text-muted);font-size:12.5px;font-weight:600; }
  .rem-group-confirm-text { display:block;margin-bottom:8px;font-size:13px;font-weight:600;color:var(--pe-text); }

  .rem-item-list { margin-top:10px;padding-top:10px;border-top:1px solid var(--pe-border);display:flex;flex-direction:column;gap:10px; }
  .rem-item-row { background:var(--pe-surface);border:1px solid var(--pe-border);border-radius:var(--pe-radius-sm);padding:10px 12px; }
  .rem-item-name { font-size:13px;font-weight:600;color:var(--pe-text);margin-bottom:6px; }

  .rem-item-actions { display:flex;flex-wrap:wrap;gap:6px; }
  .rem-action-btn { display:inline-flex;align-items:center;gap:5px;min-height:44px;padding:7px 13px;border:1px solid var(--pe-border);border-radius:var(--pe-radius-sm);background:var(--pe-surface);color:var(--pe-text-muted);font-family:var(--pe-font-body);font-size:12.5px;font-weight:600;cursor:pointer;transition:border-color .15s,background-color .15s,color .15s; }
  .rem-action-btn:hover { border-color:var(--pe-border-strong);color:var(--pe-text); }
  .rem-action-btn:disabled { opacity:0.5;cursor:not-allowed; }
  .rem-action-btn:focus-visible { outline:2px solid var(--pe-accent);outline-offset:2px; }
  .rem-action-btn-primary { background:var(--pe-accent);border-color:var(--pe-accent);color:var(--pe-on-accent); }
  .rem-action-btn-primary:hover { background:var(--pe-accent-strong);border-color:var(--pe-accent-strong);color:var(--pe-on-accent); }

  .rem-snooze-form { display:flex;flex-direction:column;gap:8px; }
  .rem-field { display:flex;flex-direction:column;gap:6px; }
  .rem-label { font-size:12px;font-weight:600;color:var(--pe-text); }
  .rem-input { min-height:44px;border:1px solid var(--pe-border);border-radius:var(--pe-radius-sm);padding:8px 12px;font-family:var(--pe-font-body);font-size:13.5px;color:var(--pe-text);background:var(--pe-surface);outline:none; }
  .rem-input:focus { border-color:var(--pe-accent); }

  .rem-item-error { display:flex;align-items:flex-start;gap:5px;margin-top:6px;color:var(--pe-terracotta,#8b3a1e);font-size:12px; }

  .rem-weather-hint { margin-top:8px;padding-top:8px;border-top:1px dashed var(--pe-border); }
  .rem-weather-hint-text { display:flex;align-items:center;gap:6px;color:var(--pe-text-muted);font-size:12px;margin-bottom:6px;line-height:1.4; }

  @media (max-width:480px) { .rem-manage-btn { margin-left:0;width:100%;text-align:left; } .rem-type-line { flex-direction:column;align-items:flex-start; } }
`;
