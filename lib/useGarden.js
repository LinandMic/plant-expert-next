import { useCallback, useEffect, useRef, useState } from "react";
import { loadJardin, saveJardin, clearLocalJardin, hasMigrated, markMigrated } from "./localGarden";
import * as gardenApi from "./gardenApi";

const GENERIC_ERROR = "Une erreur réseau est survenue. Vos données restent en sécurité, réessaie dans un instant.";

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

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      runningForUserId.current = null;
      setJardin(loadJardin());
      setLoading(false);
      setMigrating(false);
      setError(null);
      return;
    }

    if (runningForUserId.current === user.id) return;
    runningForUserId.current = user.id;

    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);

      const localPlants = loadJardin();
      if (!hasMigrated(user.id) && localPlants.length > 0) {
        setMigrating(true);
        try {
          await migrateLocalToSupabase(user.id, localPlants);
          markMigrated(user.id);
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

      try {
        const rows = await gardenApi.fetchGardenRows(user.id);
        if (!cancelled) {
          setJardin(rows.map((r) => rowToLocalPlant(r, plantationTypes, usageTypes)));
        }
      } catch {
        if (!cancelled) setError("Impossible de charger votre jardin pour le moment.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, authLoading, plantationTypes, usageTypes]);

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

  return { jardin, loading, migrating, error, addPlant, deletePlant, updateContext };
}
