export const JARDIN_KEY = "mon_jardin_v2";

export function loadJardin() {
  try {
    const raw = localStorage.getItem(JARDIN_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveJardin(plants) {
  try {
    localStorage.setItem(JARDIN_KEY, JSON.stringify(plants));
  } catch {}
}

export function clearLocalJardin() {
  try {
    localStorage.removeItem(JARDIN_KEY);
  } catch {}
}

export function migrationMarkerKey(userId) {
  return `mon_jardin_migrated_v1_${userId}`;
}

export function hasMigrated(userId) {
  try {
    return localStorage.getItem(migrationMarkerKey(userId)) === "true";
  } catch {
    return false;
  }
}

export function markMigrated(userId) {
  try {
    localStorage.setItem(migrationMarkerKey(userId), "true");
  } catch {}
}
