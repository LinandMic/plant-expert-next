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

  const userId = user?.id || null;

  // Bumped exactly once per run of the load effect below — i.e. once per
  // logout, login, or user A -> user B transition — and only ever mutated
  // inside an effect, never during render (a ref write during render can
  // leak from a render pass that never actually commits). Every async
  // operation this hook exposes (initial fetch, refresh, create, update,
  // delete) captures the generation active when it started and re-checks it
  // immediately before touching any state; a mismatch means the identity
  // this hook is tracking changed while the operation was in flight, so its
  // result — success or failure — is discarded rather than applied. This is
  // the single mechanism covering all five operations.
  const requestIdRef = useRef(0);

  const loadZones = useCallback(async (forUserId, requestId) => {
    setLoading(true);
    setError(null);

    for (let attempt = 0; attempt < GARDEN_ZONES_MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await wait(RETRY_DELAY_MS);
        if (requestIdRef.current !== requestId) return;
      }
      try {
        const rows = await gardenZonesApi.fetchZones(forUserId);
        if (requestIdRef.current !== requestId) return;
        setZones(rows);
        setLoading(false);
        return;
      } catch {
        if (requestIdRef.current !== requestId) return;
      }
    }
    if (requestIdRef.current !== requestId) return;
    // Never clears `zones` on failure — an error must not make
    // already-loaded data disappear; only a real logout (below) or a
    // successful (re)load ever replaces it.
    setError(LOAD_ERROR);
    setLoading(false);
  }, []);

  useEffect(() => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;

    if (authLoading) return;

    if (!userId) {
      setZones([]);
      setLoading(false);
      setError(null);
      return;
    }

    loadZones(userId, requestId);
  }, [userId, authLoading, loadZones]);

  const refreshZones = useCallback(() => {
    if (!userId) return;
    loadZones(userId, requestIdRef.current);
  }, [userId, loadZones]);

  // create/update/delete deliberately never touch `loading` — that state
  // represents the zones list itself being fetched/refreshed, not a
  // mutation in progress, so a create/update/delete never blocks the rest
  // of the UI (e.g. the zones list stays interactive while a delete is in
  // flight). Each mutation clears any previous `error` synchronously at
  // call time (a new attempt gets a clean slate) and, on failure, sets a
  // fresh one — gated by the same request-generation check, so a stale
  // mutation's outcome (for a user who has since logged out or been
  // replaced) can never overwrite the current user's error or zones.

  const createZone = useCallback(
    async (zone) => {
      if (!userId) return { error: AUTH_REQUIRED_ERROR, zone: null };
      const requestId = requestIdRef.current;
      setError(null);
      try {
        const created = await gardenZonesApi.insertZone(userId, zone);
        if (requestIdRef.current === requestId) {
          setZones((prev) => (prev.some((z) => z.id === created.id) ? prev : [created, ...prev]));
        }
        return { error: null, zone: created };
      } catch (e) {
        console.error("insertZone failed", e);
        if (requestIdRef.current === requestId) setError(GENERIC_ERROR);
        return { error: GENERIC_ERROR, zone: null };
      }
    },
    [userId]
  );

  const updateZone = useCallback(
    async (zoneId, patch) => {
      if (!userId) return { error: AUTH_REQUIRED_ERROR, zone: null };
      const requestId = requestIdRef.current;
      setError(null);
      try {
        const updated = await gardenZonesApi.updateZone(userId, zoneId, patch);
        if (requestIdRef.current === requestId) {
          setZones((prev) => prev.map((z) => (z.id === updated.id ? updated : z)));
        }
        return { error: null, zone: updated };
      } catch (e) {
        console.error("updateZone failed", e);
        if (requestIdRef.current === requestId) setError(GENERIC_ERROR);
        return { error: GENERIC_ERROR, zone: null };
      }
    },
    [userId]
  );

  const deleteZone = useCallback(
    async (zoneId) => {
      if (!userId) return { error: AUTH_REQUIRED_ERROR };
      const requestId = requestIdRef.current;
      setError(null);
      try {
        await gardenZonesApi.deleteZone(userId, zoneId);
        if (requestIdRef.current === requestId) {
          setZones((prev) => prev.filter((z) => z.id !== zoneId));
        }
        return { error: null };
      } catch (e) {
        console.error("deleteZone failed", e);
        if (requestIdRef.current === requestId) setError(GENERIC_ERROR);
        return { error: GENERIC_ERROR };
      }
    },
    [userId]
  );

  return { zones, loading, error, createZone, updateZone, deleteZone, refreshZones };
}
