import { useCallback, useEffect, useRef, useState } from "react";
import { loadJardin, saveJardin, clearLocalJardin, hasMigrated, markMigrated } from "./localGarden";
import * as gardenApi from "./gardenApi";

const GENERIC_ERROR = "Une erreur réseau est survenue. Vos données restent en sécurité, réessaie dans un instant.";
const ZONE_AUTH_ERROR = "Connectez-vous pour associer une plante à une zone.";
const RETRY_DELAY_MS = 1000;
const GARDEN_MAX_ATTEMPTS = 2;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rowToContext(plant) {
  return {
    location: plant.location ?? null,
    exposure: plant.exposure ?? null,
    orientation: plant.orientation ?? null,
    watering: {
      mode: plant.watering_mode ?? null,
      type: plant.watering_type ?? null,
      frequencyDays: plant.watering_frequency_days ?? null,
      durationMinutes: plant.watering_duration_minutes ?? null,
      flowLph: plant.watering_flow_lph ?? null,
      emitterCount: plant.watering_emitter_count ?? null,
    },
  };
}

function rowToLocalPlant({ plant, imageUrl }, plantationTypes, usageTypes) {
  return {
    id: plant.id,
    dateAjout: plant.created_at,
    imagePreview: imageUrl,
    plantation: plantationTypes.find((p) => p.id === plant.plantation) || null,
    usage: usageTypes.find((u) => u.id === plant.usage) || null,
    data: plant.ai_data,
    context: rowToContext(plant),
    identificationStatus: plant.identification_status ?? null,
    zoneId: plant.zone_id ?? null,
  };
}

// Inserts (or, on retry, re-uses) each local plant in Supabase. Throws on the
// first failure so the caller never marks the migration done or clears
// localStorage on a partial result — already-migrated plants are safely
// re-detected via findExistingByLegacyId on the next attempt.
async function migrateLocalToSupabase(userId, localPlants) {
  for (const localPlant of localPlants) {
    const existing = await gardenApi.findExistingByLegacyId(userId, localPlant.id);
    if (existing) continue;

    const inserted = await gardenApi.insertPlant(userId, localPlant);
    if (typeof localPlant.imagePreview === "string" && localPlant.imagePreview.startsWith("data:")) {
      await gardenApi.uploadPrimaryPhoto(userId, inserted.id, localPlant.imagePreview);
    }
  }
}

export function useGarden(user, authLoading, plantationTypes, usageTypes) {
  const [jardin, setJardin] = useState([]);
  const [loading, setLoading] = useState(true);
  const [migrating, setMigrating] = useState(false);
  const [error, setError] = useState(null);
  const runningForUserId = useRef(null);

  // A new `user` object for the same logged-in id (e.g. a redundant
  // Supabase auth event) must never cancel and restart this load — depend
  // on the stable id instead of the object reference, exactly like the
  // profile/weather loads in pages/index.js.
  const userId = user?.id || null;

  useEffect(() => {
    if (authLoading) return;

    if (!userId) {
      runningForUserId.current = null;
      setJardin(loadJardin());
      setLoading(false);
      setMigrating(false);
      setError(null);
      return;
    }

    if (runningForUserId.current === userId) return;
    runningForUserId.current = userId;

    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);

      const localPlants = loadJardin();
      if (!hasMigrated(userId) && localPlants.length > 0) {
        setMigrating(true);
        try {
          await migrateLocalToSupabase(userId, localPlants);
          markMigrated(userId);
          clearLocalJardin();
        } catch {
          if (!cancelled) {
            setError(
              "La synchronisation de vos plantes existantes a échoué. Vos données restent sauvegardées localement, nouvelle tentative à la prochaine connexion."
            );
          }
        } finally {
          if (!cancelled) setMigrating(false);
        }
      }
      if (cancelled) return;

      // A transient failure on the initial Supabase read (e.g. a momentary
      // 401 right after sign-in) gets exactly one retry after a short
      // delay before giving up — never a poll, never more than
      // GARDEN_MAX_ATTEMPTS calls total. Migration above already ran (at
      // most once) before this loop, and is never repeated by a retry.
      for (let attempt = 0; attempt < GARDEN_MAX_ATTEMPTS; attempt++) {
        if (attempt > 0) {
          await wait(RETRY_DELAY_MS);
          if (cancelled) return;
        }
        try {
          const rows = await gardenApi.fetchGardenRows(userId);
          if (cancelled) return;
          setJardin(rows.map((r) => rowToLocalPlant(r, plantationTypes, usageTypes)));
          setLoading(false);
          return;
        } catch {
          if (cancelled) return;
        }
      }
      if (cancelled) return;
      setError("Impossible de charger votre jardin pour le moment.");
      setLoading(false);
      // A failure must never permanently strand this userId as "already
      // tried" — release the guard so a future legitimate run can retry.
      if (runningForUserId.current === userId) {
        runningForUserId.current = null;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, authLoading, plantationTypes, usageTypes]);

  const addPlant = useCallback(
    async (localPlantDraft) => {
      if (!user) {
        const updated = [localPlantDraft, ...jardin];
        setJardin(updated);
        saveJardin(updated);
        return { error: null };
      }
      try {
        const inserted = await gardenApi.insertPlant(user.id, localPlantDraft);
        let imageUrl = null;
        if (typeof localPlantDraft.imagePreview === "string" && localPlantDraft.imagePreview.startsWith("data:")) {
          const photoRow = await gardenApi.uploadPrimaryPhoto(user.id, inserted.id, localPlantDraft.imagePreview);
          imageUrl = await gardenApi.createSignedPhotoUrl(photoRow.storage_path);
        }
        const newLocal = rowToLocalPlant({ plant: inserted, imageUrl }, plantationTypes, usageTypes);
        setJardin((prev) => [newLocal, ...prev]);
        return { error: null };
      } catch {
        return { error: GENERIC_ERROR };
      }
    },
    [user, jardin, plantationTypes, usageTypes]
  );

  const updateContext = useCallback(
    async (id, context) => {
      if (!user) {
        const updated = jardin.map((p) => (p.id === id ? { ...p, context } : p));
        setJardin(updated);
        saveJardin(updated);
        return { error: null };
      }
      try {
        await gardenApi.updatePlantContext(user.id, id, context);
        setJardin((prev) => prev.map((p) => (p.id === id ? { ...p, context } : p)));
        return { error: null };
      } catch {
        return { error: GENERIC_ERROR };
      }
    },
    [user, jardin]
  );

  // Zones aren't implemented for unauthenticated/local plants (no
  // localStorage zones yet), so unlike addPlant/updateContext/deletePlant
  // there is no local fallback branch here — the caller (PlantContextEditor)
  // never reaches this without isAuthenticated being true regardless.
  const updatePlantZone = useCallback(
    async (id, zoneId) => {
      if (!userId) return { error: ZONE_AUTH_ERROR };
      try {
        await gardenApi.updatePlantZone(userId, id, zoneId);
        setJardin((prev) => prev.map((p) => (p.id === id ? { ...p, zoneId } : p)));
        return { error: null };
      } catch {
        return { error: GENERIC_ERROR };
      }
    },
    [userId]
  );

  // Applies the DB's own guaranteed ON DELETE SET NULL (zone_id) consequence
  // locally, after a zone deletion has already succeeded server-side — this
  // is not an optimistic update (it runs only post-success, and only
  // mirrors a fact the DB has already committed), just a local sync so
  // `jardin` doesn't keep pointing at a zone that no longer exists without
  // requiring a full refetch.
  const clearPlantsZoneLocally = useCallback((zoneId) => {
    setJardin((prev) => prev.map((p) => (p.zoneId === zoneId ? { ...p, zoneId: null } : p)));
  }, []);

  const deletePlant = useCallback(
    async (id) => {
      if (!user) {
        const updated = jardin.filter((p) => p.id !== id);
        setJardin(updated);
        saveJardin(updated);
        return { error: null };
      }
      try {
        await gardenApi.deletePlantCascade(user.id, id);
        setJardin((prev) => prev.filter((p) => p.id !== id));
        return { error: null };
      } catch {
        return { error: GENERIC_ERROR };
      }
    },
    [user, jardin]
  );

  return { jardin, loading, migrating, error, addPlant, deletePlant, updateContext, updatePlantZone, clearPlantsZoneLocally };
}
