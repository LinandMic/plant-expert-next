import { useCallback, useEffect, useRef, useState } from "react";
import * as reminderApi from "./reminderApi";

const GENERIC_ERROR = "Une erreur est survenue. Réessaie dans un instant.";
const AUTH_REQUIRED_ERROR = "Connectez-vous pour créer et synchroniser vos rappels sur tous vos appareils.";

function sortByNextDueDate(reminders) {
  return [...reminders].sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));
}

export function useReminders(user, authLoading) {
  const [reminders, setReminders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const remindersRef = useRef(reminders);
  const mountedRef = useRef(true);

  remindersRef.current = reminders;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setReminders([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    reminderApi
      .fetchReminders(user.id)
      .then((rows) => {
        if (!cancelled && mountedRef.current) setReminders(rows);
      })
      .catch(() => {
        if (!cancelled && mountedRef.current) setError("Impossible de charger vos rappels pour le moment.");
      })
      .finally(() => {
        if (!cancelled && mountedRef.current) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  const requiresAuth = !authLoading && !user;

  const applyUpdatedReminder = useCallback((updated) => {
    if (!mountedRef.current) return;
    setReminders((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }, []);

  const createBulk = useCallback(
    async (plantIds, reminderConfigs) => {
      if (!user) return { error: AUTH_REQUIRED_ERROR };
      try {
        const created = await reminderApi.createRemindersBulk(user.id, plantIds, reminderConfigs);
        if (mountedRef.current) {
          const byId = new Map(remindersRef.current.map((r) => [r.id, r]));
          created.forEach((r) => byId.set(r.id, r));
          setReminders(sortByNextDueDate(Array.from(byId.values())));
        }
        return { error: null };
      } catch (e) {
        console.error("createRemindersBulk failed", e);
        return { error: GENERIC_ERROR };
      }
    },
    [user]
  );

  const markDone = useCallback(
    async (reminderId) => {
      if (!user) return { error: AUTH_REQUIRED_ERROR };
      const current = remindersRef.current.find((r) => r.id === reminderId);
      if (!current) return { error: GENERIC_ERROR };
      try {
        const updated = await reminderApi.markReminderDone(user.id, reminderId, current);
        applyUpdatedReminder(updated);
        return { error: null };
      } catch (e) {
        console.error("markReminderDone failed", e);
        return { error: GENERIC_ERROR };
      }
    },
    [user, applyUpdatedReminder]
  );

  const markSkipped = useCallback(
    async (reminderId) => {
      if (!user) return { error: AUTH_REQUIRED_ERROR };
      const current = remindersRef.current.find((r) => r.id === reminderId);
      if (!current) return { error: GENERIC_ERROR };
      try {
        const updated = await reminderApi.markReminderSkipped(user.id, reminderId, current);
        applyUpdatedReminder(updated);
        return { error: null };
      } catch (e) {
        console.error("markReminderSkipped failed", e);
        return { error: GENERIC_ERROR };
      }
    },
    [user, applyUpdatedReminder]
  );

  const snooze = useCallback(
    async (reminderId, newNextDueDate) => {
      if (!user) return { error: AUTH_REQUIRED_ERROR };
      try {
        const updated = await reminderApi.snoozeReminder(user.id, reminderId, newNextDueDate);
        applyUpdatedReminder(updated);
        return { error: null };
      } catch (e) {
        console.error("snoozeReminder failed", e);
        return { error: GENERIC_ERROR };
      }
    },
    [user, applyUpdatedReminder]
  );

  const setActive = useCallback(
    async (reminderId, isActive) => {
      if (!user) return { error: AUTH_REQUIRED_ERROR };
      try {
        const updated = await reminderApi.setReminderActive(user.id, reminderId, isActive);
        applyUpdatedReminder(updated);
        return { error: null };
      } catch (e) {
        console.error("setReminderActive failed", e);
        return { error: GENERIC_ERROR };
      }
    },
    [user, applyUpdatedReminder]
  );

  const remove = useCallback(
    async (reminderId) => {
      if (!user) return { error: AUTH_REQUIRED_ERROR };
      try {
        await reminderApi.deleteReminder(user.id, reminderId);
        if (mountedRef.current) setReminders((prev) => prev.filter((r) => r.id !== reminderId));
        return { error: null };
      } catch (e) {
        console.error("deleteReminder failed", e);
        return { error: GENERIC_ERROR };
      }
    },
    [user]
  );

  return { reminders, loading, error, requiresAuth, createBulk, markDone, markSkipped, snooze, setActive, remove };
}
