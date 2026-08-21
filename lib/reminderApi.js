import { supabase } from "./supabaseClient";

const VALID_TYPES = ["watering", "pruning", "repotting", "fertilizing", "pest_check", "general_care"];
const VALID_RECURRENCE_TYPES = ["none", "interval_days"];
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function toLocalDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// "Today" from the browser's local calendar day, never UTC — avoids
// new Date().toISOString().slice(0,10) landing on the wrong day near
// midnight depending on the user's timezone offset.
function todayLocalDateString() {
  return toLocalDateString(new Date());
}

// Pure. baseDate is the local date of completion/skip (typically "today"),
// never the reminder's previous next_due_date — an overdue task done late
// still reschedules from today, not from the missed date.
export function computeNextDueDate(baseDate, intervalDays) {
  if (typeof baseDate !== "string" || !DATE_ONLY_RE.test(baseDate)) {
    throw new Error("computeNextDueDate: baseDate invalide");
  }
  if (!Number.isInteger(intervalDays) || intervalDays <= 0) {
    throw new Error("computeNextDueDate: intervalDays invalide");
  }
  const [y, m, d] = baseDate.split("-").map(Number);
  const base = new Date(y, m - 1, d);
  base.setDate(base.getDate() + intervalDays);
  return toLocalDateString(base);
}

function rowToReminder(row) {
  return {
    id: row.id,
    plantId: row.plant_id,
    type: row.type,
    isActive: row.is_active,
    status: row.status,
    recurrence: {
      type: row.recurrence_type,
      intervalDays: row.recurrence_interval_days,
    },
    nextDueDate: row.next_due_date,
    lastCompletedAt: row.last_completed_at,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function fetchReminders(userId) {
  if (!userId) throw new Error("fetchReminders: userId requis");

  const { data, error } = await supabase
    .from("plant_reminders")
    .select("*")
    .eq("user_id", userId)
    .order("next_due_date", { ascending: true });
  if (error) throw error;
  return (data || []).map(rowToReminder);
}

function assertValidReminderConfig(config) {
  if (!config || typeof config !== "object") {
    throw new Error("createRemindersBulk: configuration de rappel invalide");
  }
  if (!VALID_TYPES.includes(config.type)) {
    throw new Error(`createRemindersBulk: type de rappel invalide (${config.type})`);
  }
  if (typeof config.nextDueDate !== "string" || !DATE_ONLY_RE.test(config.nextDueDate)) {
    throw new Error("createRemindersBulk: nextDueDate doit être au format YYYY-MM-DD");
  }
  const recurrenceType = config.recurrence && config.recurrence.type;
  if (!VALID_RECURRENCE_TYPES.includes(recurrenceType)) {
    throw new Error("createRemindersBulk: recurrence.type invalide");
  }
  if (recurrenceType === "interval_days") {
    const days = config.recurrence.intervalDays;
    if (!Number.isInteger(days) || days <= 0) {
      throw new Error("createRemindersBulk: recurrence.intervalDays doit être un entier positif");
    }
  }
}

export async function createRemindersBulk(userId, plantIds, reminderConfigs) {
  if (!userId) throw new Error("createRemindersBulk: userId requis");
  if (!Array.isArray(plantIds) || plantIds.length === 0) {
    throw new Error("createRemindersBulk: au moins une plante requise");
  }
  if (!Array.isArray(reminderConfigs) || reminderConfigs.length === 0) {
    throw new Error("createRemindersBulk: au moins un type de rappel requis");
  }
  reminderConfigs.forEach(assertValidReminderConfig);

  // Only the columns that must always be reset on (re)activation are
  // included here. last_completed_at, note, created_at are deliberately
  // left out of the payload so upsert's ON CONFLICT DO UPDATE never
  // touches them — a reactivation never resurrects a stale done/skipped
  // history value.
  const rows = [];
  for (const plantId of plantIds) {
    for (const config of reminderConfigs) {
      const isInterval = config.recurrence.type === "interval_days";
      rows.push({
        user_id: userId,
        plant_id: plantId,
        type: config.type,
        is_active: true,
        status: "pending",
        recurrence_type: config.recurrence.type,
        recurrence_interval_days: isInterval ? config.recurrence.intervalDays : null,
        next_due_date: config.nextDueDate,
      });
    }
  }

  const { data, error } = await supabase
    .from("plant_reminders")
    .upsert(rows, { onConflict: "plant_id,type" })
    .select();
  if (error) throw error;
  return (data || []).map(rowToReminder);
}

async function updateReminderRow(userId, reminderId, row) {
  const { data, error } = await supabase
    .from("plant_reminders")
    .update(row)
    .eq("id", reminderId)
    .eq("user_id", userId)
    .select()
    .single();
  if (error) throw error;
  return rowToReminder(data);
}

export async function markReminderDone(userId, reminderId, reminder) {
  if (!userId) throw new Error("markReminderDone: userId requis");
  if (!reminderId) throw new Error("markReminderDone: reminderId requis");
  if (!reminder) throw new Error("markReminderDone: reminder requis");

  const isRecurring = reminder.recurrence && reminder.recurrence.type === "interval_days";
  const nowIso = new Date().toISOString();

  const row = isRecurring
    ? {
        last_completed_at: nowIso,
        next_due_date: computeNextDueDate(todayLocalDateString(), reminder.recurrence.intervalDays),
        status: "pending",
      }
    : {
        last_completed_at: nowIso,
        status: "done",
        is_active: false,
      };

  return updateReminderRow(userId, reminderId, row);
}

export async function markReminderSkipped(userId, reminderId, reminder) {
  if (!userId) throw new Error("markReminderSkipped: userId requis");
  if (!reminderId) throw new Error("markReminderSkipped: reminderId requis");
  if (!reminder) throw new Error("markReminderSkipped: reminder requis");

  const isRecurring = reminder.recurrence && reminder.recurrence.type === "interval_days";

  const row = isRecurring
    ? {
        next_due_date: computeNextDueDate(todayLocalDateString(), reminder.recurrence.intervalDays),
        status: "pending",
      }
    : {
        status: "skipped",
        is_active: false,
      };

  return updateReminderRow(userId, reminderId, row);
}

export async function snoozeReminder(userId, reminderId, newNextDueDate) {
  if (!userId) throw new Error("snoozeReminder: userId requis");
  if (!reminderId) throw new Error("snoozeReminder: reminderId requis");
  if (typeof newNextDueDate !== "string" || !DATE_ONLY_RE.test(newNextDueDate)) {
    throw new Error("snoozeReminder: newNextDueDate doit être au format YYYY-MM-DD");
  }

  return updateReminderRow(userId, reminderId, {
    status: "snoozed",
    next_due_date: newNextDueDate,
  });
}

export async function setReminderActive(userId, reminderId, isActive) {
  if (!userId) throw new Error("setReminderActive: userId requis");
  if (!reminderId) throw new Error("setReminderActive: reminderId requis");

  // The DB forbids status in (done, skipped) with is_active = true, so
  // reactivating always resets the status to pending — never resurrects a
  // terminal status.
  const row = isActive ? { is_active: true, status: "pending" } : { is_active: false };

  return updateReminderRow(userId, reminderId, row);
}

export async function deleteReminder(userId, reminderId) {
  if (!userId) throw new Error("deleteReminder: userId requis");
  if (!reminderId) throw new Error("deleteReminder: reminderId requis");

  const { error } = await supabase
    .from("plant_reminders")
    .delete()
    .eq("id", reminderId)
    .eq("user_id", userId);
  if (error) throw error;
}
