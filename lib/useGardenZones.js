import { useCallback, useEffect, useRef, useState } from "react";
import * as gardenZonesApi from "./gardenZonesApi";

const GENERIC_ERROR = "Une erreur réseau est survenue. Réessaie dans un instant.";
const AUTH_REQUIRED_ERROR = "Connectez-vous pour créer et gérer vos zones de jardin.";
const LOAD_ERROR = "Impossible de charger vos zones pour le moment.";
const RETRY_DELAY_MS = 1000;
const GARDEN_ZONES_MAX_ATTEMPTS = 2;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useGardenZones(user, authLoading) {
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Depend on the stable scalar id, never the `user` object reference — a
  // redundant Supabase auth event firing for the same logged-in user must
  // never be treated as a user change (same fix already applied to
  // useGarden.js after PR #11).
  const userId = user?.id || null;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  // A transient failure on the Supabase read gets exactly one retry after a
  // short delay, never a poll, never more than GARDEN_ZONES_MAX_ATTEMPTS
  // calls total (mirrors useGarden.js's bounded-retry shape). Every check
  // below is against userIdRef.current (not a local `cancelled` closure):
  // whichever call was made for a since-replaced user (logout, or user A ->
  // user B) sees a mismatch and returns without ever touching
  // zones/loading/error — so a stale response can never land in the wrong
  // user's state, and a stale response can never overwrite a newer one for
  // the same user either, since only a match applies its result.
  const loadZones = useCallback(async (forUserId) => {
    setLoading(true);
    setError(null);

    for (let attempt = 0; attempt < GARDEN_ZONES_MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await wait(RETRY_DELAY_MS);
        if (userIdRef.current !== forUserId) return;
      }
      try {
        const rows = await gardenZonesApi.fetchZones(forUserId);
        if (userIdRef.current !== forUserId) return;
        setZones(rows);
        setLoading(false);
        return;
      } catch {
        if (userIdRef.current !== forUserId) return;
      }
    }
    if (userIdRef.current !== forUserId) return;
    // Never clears `zones` on failure — an error must not make
    // already-loaded data disappear; only a real logout (below) or a
    // successful (re)load ever replaces it.
    setError(LOAD_ERROR);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (authLoading) return;

    if (!userId) {
      setZones([]);
      setLoading(false);
      setError(null);
      return;
    }

    loadZones(userId);
  }, [userId, authLoading, loadZones]);

  const refreshZones = useCallback(() => {
    if (!userId) return;
    loadZones(userId);
  }, [userId, loadZones]);

  const createZone = useCallback(
    async (zone) => {
      if (!userId) return { error: AUTH_REQUIRED_ERROR, zone: null };
      try {
        const created = await gardenZonesApi.insertZone(userId, zone);
        if (userIdRef.current === userId) {
          setZones((prev) => (prev.some((z) => z.id === created.id) ? prev : [created, ...prev]));
        }
        return { error: null, zone: created };
      } catch (e) {
        console.error("insertZone failed", e);
        return { error: GENERIC_ERROR, zone: null };
      }
    },
    [userId]
  );

  const updateZone = useCallback(
    async (zoneId, patch) => {
      if (!userId) return { error: AUTH_REQUIRED_ERROR, zone: null };
      try {
        const updated = await gardenZonesApi.updateZone(userId, zoneId, patch);
        if (userIdRef.current === userId) {
          setZones((prev) => prev.map((z) => (z.id === updated.id ? updated : z)));
        }
        return { error: null, zone: updated };
      } catch (e) {
        console.error("updateZone failed", e);
        return { error: GENERIC_ERROR, zone: null };
      }
    },
    [userId]
  );

  const deleteZone = useCallback(
    async (zoneId) => {
      if (!userId) return { error: AUTH_REQUIRED_ERROR };
      try {
        await gardenZonesApi.deleteZone(userId, zoneId);
        if (userIdRef.current === userId) {
          setZones((prev) => prev.filter((z) => z.id !== zoneId));
        }
        return { error: null };
      } catch (e) {
        console.error("deleteZone failed", e);
        return { error: GENERIC_ERROR };
      }
    },
    [userId]
  );

  return { zones, loading, error, createZone, updateZone, deleteZone, refreshZones };
}
