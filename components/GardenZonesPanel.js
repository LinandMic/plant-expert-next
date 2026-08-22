import { Fragment, useState } from "react";
import GardenZoneSettings from "./GardenZoneSettings";

const NAME_MAX_LENGTH = 120;

function normalizeName(raw) {
  return (raw || "").trim();
}

// Pure client-side check, run before ever calling createZone/updateZone —
// never a network round-trip, so its message is never a raw Supabase error.
// Mirrors the DB's own name constraints (garden_zones_name_not_blank_check,
// garden_zones_name_max_length_check) so a rejection here would also have
// been rejected server-side.
function validateName(raw) {
  const trimmed = normalizeName(raw);
  if (!trimmed) return "Le nom de la zone est requis.";
  if (trimmed.length > NAME_MAX_LENGTH) return `Le nom ne doit pas dépasser ${NAME_MAX_LENGTH} caractères.`;
  return null;
}

export default function GardenZonesPanel({ zones, loading, error, createZone, updateZone, deleteZone }) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createValidationError, setCreateValidationError] = useState(null);

  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [editValidationError, setEditValidationError] = useState(null);

  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const [settingsOpenId, setSettingsOpenId] = useState(null);
  const toggleSettings = (zoneId) => setSettingsOpenId((prev) => (prev === zoneId ? null : zoneId));

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    if (creating) return;
    const trimmed = normalizeName(newName);
    const validationError = validateName(trimmed);
    if (validationError) {
      setCreateValidationError(validationError);
      return;
    }

    setCreating(true);
    setCreateValidationError(null);
    const { error: err } = await createZone({ name: trimmed });
    setCreating(false);
    if (err) return; // surfaced discreetly via the shared `error` prop below
    setNewName("");
    setShowCreateForm(false);
  };

  const cancelCreate = () => {
    setShowCreateForm(false);
    setNewName("");
    setCreateValidationError(null);
  };

  const startEdit = (zone) => {
    setEditingId(zone.id);
    setEditName(zone.name);
    setEditValidationError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditValidationError(null);
  };

  const handleEditSubmit = async (e, zoneId) => {
    e.preventDefault();
    if (savingId) return;
    const trimmed = normalizeName(editName);
    const validationError = validateName(trimmed);
    if (validationError) {
      setEditValidationError(validationError);
      return;
    }

    setSavingId(zoneId);
    setEditValidationError(null);
    const { error: err } = await updateZone(zoneId, { name: trimmed });
    setSavingId(null);
    if (err) return; // surfaced discreetly via the shared `error` prop below
    setEditingId(null);
    setEditName("");
  };

  const requestDelete = (zoneId) => setConfirmDeleteId(zoneId);
  const cancelDelete = () => setConfirmDeleteId(null);

  const confirmDelete = async (zoneId) => {
    if (deletingId) return;
    setDeletingId(zoneId);
    const { error: err } = await deleteZone(zoneId);
    setDeletingId(null);
    if (err) return; // zone stays in the list, error shown via the shared `error` prop
    setConfirmDeleteId(null);
  };

  return (
    <div className="zones-panel">
      <div className="zones-panel-title">📍 Zones du jardin</div>

      {error && <div className="error-box">⚠️ {error}</div>}

      {loading && zones.length === 0 ? (
        <div className="zones-empty-text">Chargement de vos zones...</div>
      ) : zones.length === 0 ? (
        <div className="zones-empty-text">Organisez votre jardin par emplacement : massif, terrasse, potager...</div>
      ) : (
        <div className="zones-list">
          {zones.map((zone) => (
            <Fragment key={zone.id}>
            <div className="zones-item">
              {editingId === zone.id ? (
                <form className="zones-edit-form" onSubmit={(e) => handleEditSubmit(e, zone.id)}>
                  <input
                    className="plant-input"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    maxLength={NAME_MAX_LENGTH}
                    autoFocus
                    disabled={savingId === zone.id}
                  />
                  {editValidationError && <div className="zones-item-error">{editValidationError}</div>}
                  <div className="zones-edit-actions">
                    <button
                      type="submit"
                      className="reminders-action-btn reminders-action-confirm"
                      disabled={savingId === zone.id}
                    >
                      {savingId === zone.id ? "Enregistrement..." : "Enregistrer"}
                    </button>
                    <button
                      type="button"
                      className="reminders-action-btn"
                      onClick={cancelEdit}
                      disabled={savingId === zone.id}
                    >
                      Annuler
                    </button>
                  </div>
                </form>
              ) : confirmDeleteId === zone.id ? (
                <div className="zones-delete-confirm">
                  <span className="zones-delete-confirm-text">Supprimer cette zone ?</span>
                  <div className="zones-edit-actions">
                    <button
                      type="button"
                      className="jardin-delete-confirm-yes"
                      onClick={() => confirmDelete(zone.id)}
                      disabled={deletingId === zone.id}
                    >
                      {deletingId === zone.id ? "Suppression..." : "Supprimer"}
                    </button>
                    <button
                      type="button"
                      className="jardin-delete-confirm-no"
                      onClick={cancelDelete}
                      disabled={deletingId === zone.id}
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <span className="zones-item-name">📍 {zone.name}</span>
                  <div className="zones-item-actions">
                    <button type="button" className="zones-item-action" onClick={() => startEdit(zone)}>
                      Modifier
                    </button>
                    <button type="button" className="zones-item-action" onClick={() => toggleSettings(zone.id)}>
                      Paramètres
                    </button>
                    <button
                      type="button"
                      className="zones-item-action zones-item-action-danger"
                      onClick={() => requestDelete(zone.id)}
                    >
                      Supprimer
                    </button>
                  </div>
                </>
              )}
            </div>
            {settingsOpenId === zone.id && (
              <GardenZoneSettings
                zone={zone}
                onSave={(patch) => updateZone(zone.id, patch)}
                onCancel={() => setSettingsOpenId(null)}
              />
            )}
            </Fragment>
          ))}
        </div>
      )}

      {showCreateForm ? (
        <form className="zones-create-form" onSubmit={handleCreateSubmit}>
          <input
            className="plant-input"
            placeholder="Massif terrasse, Haie côté rue, Potager..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={NAME_MAX_LENGTH}
            autoFocus
            disabled={creating}
          />
          {createValidationError && <div className="zones-item-error">{createValidationError}</div>}
          <div className="zones-edit-actions">
            <button type="submit" className="btn-analyze" disabled={creating}>
              {creating ? "Ajout..." : "Ajouter"}
            </button>
            <button type="button" className="reminders-action-btn" onClick={cancelCreate} disabled={creating}>
              Annuler
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="zones-add-btn" onClick={() => setShowCreateForm(true)}>
          + Ajouter une zone
        </button>
      )}
    </div>
  );
}
