import { useEffect, useState } from "react";
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

function ReminderRow({ name, item, busy, error, snoozeDraft, onMarkDone, onMarkSkipped, onOpenSnooze, onCancelSnooze, onChangeSnoozeDate, onConfirmSnooze }) {
  const isSnoozing = !!(snoozeDraft && snoozeDraft.open);
  return (
    <div className="reminders-item-row">
      <div className="reminders-item-name">
        {name}
        {item.status === "snoozed" && <span className="reminders-snoozed-tag"> · reporté</span>}
      </div>
      {!isSnoozing ? (
        <div className="reminders-item-actions">
          <button type="button" className="reminders-action-btn" disabled={busy} onClick={onMarkDone}>✅ Fait</button>
          <button type="button" className="reminders-action-btn" disabled={busy} onClick={onOpenSnooze}>⏰ Reporter</button>
          <button type="button" className="reminders-action-btn" disabled={busy} onClick={onMarkSkipped}>⏭️ Ignorer</button>
        </div>
      ) : (
        <div className="reminders-snooze-form">
          <label className="auth-label" htmlFor={`snooze-${item.reminderId}`}>Nouvelle date</label>
          <input
            id={`snooze-${item.reminderId}`}
            type="date"
            className="plant-input"
            value={(snoozeDraft && snoozeDraft.date) || ""}
            onChange={(e) => onChangeSnoozeDate(e.target.value)}
          />
          <div className="reminders-item-actions">
            <button type="button" className="reminders-action-btn reminders-action-confirm" disabled={busy} onClick={onConfirmSnooze}>Confirmer</button>
            <button type="button" className="reminders-action-btn" disabled={busy} onClick={onCancelSnooze}>Annuler</button>
          </div>
        </div>
      )}
      {error && <div className="reminders-item-error">{error}</div>}
    </div>
  );
}

export default function RemindersOverview({ reminders, garden, actions }) {
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

  const openSnooze = (reminderId) => {
    setItemError(reminderId, null);
    setSnoozeState((prev) => ({ ...prev, [reminderId]: { open: true, date: (prev[reminderId] && prev[reminderId].date) || "" } }));
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
              const groupKey = `${g.date}::${t.type}`;
              const isExpanded = expandedGroups.has(groupKey);
              return (
                <div className="reminders-type-group" key={t.type}>
                  <div className="reminders-type-line">
                    <span>
                      {typeInfo ? typeInfo.icon : "🔔"} {typeInfo ? typeInfo.label : t.type} — {t.plantIds.length} plante{t.plantIds.length > 1 ? "s" : ""}
                    </span>
                    {t.hasSnoozed && <span className="reminders-snoozed-tag"> · reporté</span>}
                    <button type="button" className="reminders-manage-btn" onClick={() => toggleGroup(groupKey)}>
                      {isExpanded ? "Fermer" : "Gérer"}
                    </button>
                  </div>

                  {!isExpanded && <div className="reminders-plant-names">{formatPlantNames(names)}</div>}

                  {isExpanded && t.items.length > 1 && (
                    <div className="reminders-group-actions">
                      {groupBusyKeys.has(groupKey) ? (
                        <span key="busy" className="reminders-group-busy">Mise à jour…</span>
                      ) : confirmingGroup && confirmingGroup.groupKey === groupKey ? (
                        <div key="confirm">
                          {confirmingGroup.action === "snooze" ? (
                            <>
                              <span className="reminders-group-confirm-text">Reporter ces {t.items.length} rappels</span>
                              <div className="auth-field">
                                <label className="auth-label" htmlFor={`group-snooze-${groupKey}`}>Nouvelle date</label>
                                <input
                                  id={`group-snooze-${groupKey}`}
                                  type="date"
                                  className="plant-input"
                                  value={confirmingGroup.date || ""}
                                  onChange={(e) => changeGroupSnoozeDate(e.target.value)}
                                />
                              </div>
                            </>
                          ) : (
                            <span className="reminders-group-confirm-text">
                              {confirmingGroup.action === "done"
                                ? `Marquer ces ${t.items.length} rappels comme faits ?`
                                : `Ignorer ces ${t.items.length} rappels ?`}
                            </span>
                          )}
                          <div className="reminders-item-actions">
                            <button type="button" className="reminders-action-btn reminders-action-confirm" onClick={() => confirmGroupAction()}>
                              Confirmer
                            </button>
                            <button type="button" className="reminders-action-btn" onClick={() => cancelGroupAction()}>Annuler</button>
                          </div>
                        </div>
                      ) : (
                        <div key="default" className="reminders-item-actions">
                          <button type="button" className="reminders-action-btn" onClick={() => requestGroupAction(groupKey, "done")}>✓ Tout fait</button>
                          <button type="button" className="reminders-action-btn" onClick={() => requestGroupAction(groupKey, "snooze")}>⏰ Reporter tout</button>
                          <button type="button" className="reminders-action-btn" onClick={() => requestGroupAction(groupKey, "skip")}>Ignorer tout</button>
                        </div>
                      )}
                      {groupResultMessages[groupKey] && <div className="reminders-item-error">{groupResultMessages[groupKey]}</div>}
                    </div>
                  )}

                  {isExpanded && (
                    <div className="reminders-item-list">
                      {t.items.map((item) => (
                        <ReminderRow
                          key={item.reminderId}
                          name={plantName(garden, item.plantId)}
                          item={item}
                          busy={busyIds.has(item.reminderId)}
                          error={itemErrors[item.reminderId]}
                          snoozeDraft={snoozeState[item.reminderId]}
                          onMarkDone={() => handleMarkDone(item.reminderId)}
                          onMarkSkipped={() => handleMarkSkipped(item.reminderId)}
                          onOpenSnooze={() => openSnooze(item.reminderId)}
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
        ))
      )}
    </div>
  );
}
