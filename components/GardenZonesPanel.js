import { Fragment, useState } from "react";
import GardenZoneSettings from "./GardenZoneSettings";
import Button from "@/components/ui/Button";
import { IconMapPin, IconAlertCircle } from "@/components/ui/icons";

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
    <div className="gzp-panel">
      <style>{GZP_STYLES}</style>

      <div className="gzp-title"><IconMapPin size={17} /> Zones du jardin</div>

      {error && <div className="error-box"><IconAlertCircle size={14} /> {error}</div>}

      {loading && zones.length === 0 ? (
        <div className="gzp-empty">Chargement de vos zones...</div>
      ) : zones.length === 0 ? (
        <div className="gzp-empty">Organisez votre jardin par emplacement : massif, terrasse, potager...</div>
      ) : (
        <div className="gzp-list">
          {zones.map((zone) => (
            <Fragment key={zone.id}>
            <div className="gzp-item">
              {editingId === zone.id ? (
                <form className="gzp-edit-form" onSubmit={(e) => handleEditSubmit(e, zone.id)}>
                  <input
                    className="gzp-input"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    maxLength={NAME_MAX_LENGTH}
                    autoFocus
                    disabled={savingId === zone.id}
                    aria-label="Nom de la zone"
                  />
                  {editValidationError && <div className="gzp-item-error">{editValidationError}</div>}
                  <div className="gzp-form-actions">
                    <Button type="submit" disabled={savingId === zone.id}>
                      {savingId === zone.id ? "Enregistrement..." : "Enregistrer"}
                    </Button>
                    <Button type="button" variant="secondary" onClick={cancelEdit} disabled={savingId === zone.id}>
                      Annuler
                    </Button>
                  </div>
                </form>
              ) : confirmDeleteId === zone.id ? (
                <div className="gzp-delete-confirm">
                  <span className="gzp-delete-confirm-text">Supprimer cette zone ?</span>
                  <div className="gzp-form-actions">
                    <Button
                      type="button"
                      variant="secondary"
                      className="gzp-btn-danger"
                      onClick={() => confirmDelete(zone.id)}
                      disabled={deletingId === zone.id}
                    >
                      {deletingId === zone.id ? "Suppression..." : "Supprimer"}
                    </Button>
                    <Button type="button" variant="secondary" onClick={cancelDelete} disabled={deletingId === zone.id}>
                      Annuler
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <span className="gzp-item-name"><IconMapPin size={14} /> {zone.name}</span>
                  <div className="gzp-item-actions">
                    <button type="button" className="gzp-item-action" onClick={() => startEdit(zone)}>
                      Modifier
                    </button>
                    <button type="button" className="gzp-item-action" onClick={() => toggleSettings(zone.id)} aria-pressed={settingsOpenId === zone.id}>
                      Paramètres
                    </button>
                    <button
                      type="button"
                      className="gzp-item-action gzp-item-action-danger"
                      onClick={() => requestDelete(zone.id)}
                    >
                      Supprimer
                    </button>
                  </div>
                </>
              )}
            </div>
            {settingsOpenId === zone.id && (
              <div className="gzp-settings-wrap">
                <GardenZoneSettings
                  zone={zone}
                  onSave={(patch) => updateZone(zone.id, patch)}
                  onCancel={() => setSettingsOpenId(null)}
                />
              </div>
            )}
            </Fragment>
          ))}
        </div>
      )}

      {showCreateForm ? (
        <form className="gzp-create-form" onSubmit={handleCreateSubmit}>
          <input
            className="gzp-input"
            placeholder="Massif terrasse, Haie côté rue, Potager..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={NAME_MAX_LENGTH}
            autoFocus
            disabled={creating}
            aria-label="Nom de la nouvelle zone"
          />
          {createValidationError && <div className="gzp-item-error">{createValidationError}</div>}
          <div className="gzp-form-actions">
            <Button type="submit" disabled={creating}>
              {creating ? "Ajout..." : "Ajouter"}
            </Button>
            <Button type="button" variant="secondary" onClick={cancelCreate} disabled={creating}>
              Annuler
            </Button>
          </div>
        </form>
      ) : (
        <button type="button" className="gzp-add-toggle" onClick={() => setShowCreateForm(true)}>
          + Ajouter une zone
        </button>
      )}
    </div>
  );
}

const GZP_STYLES = `
  .gzp-title { display:flex;align-items:center;gap:8px;font-family:var(--pe-font-display);font-weight:600;font-size:18px;color:var(--pe-text);margin-bottom:14px; }
  .gzp-title svg { color:var(--pe-accent);flex-shrink:0; }

  .gzp-empty { color:var(--pe-text-muted);font-size:13.5px;line-height:1.5; }

  .gzp-list { display:flex;flex-direction:column;gap:10px;margin-bottom:16px; }
  .gzp-item { display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;background:var(--pe-ivory);border:1px solid var(--pe-border);border-radius:var(--pe-radius-sm);padding:12px 14px; }
  .gzp-item-name { display:flex;align-items:center;gap:7px;font-size:14px;font-weight:600;color:var(--pe-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0; }
  .gzp-item-name svg { flex-shrink:0;color:var(--pe-accent); }
  .gzp-item-actions { display:flex;gap:2px;flex-shrink:0; }
  .gzp-item-action { min-height:40px;padding:8px 10px;border:none;background:none;border-radius:var(--pe-radius-sm);color:var(--pe-text-muted);font-family:var(--pe-font-body);font-size:12.5px;font-weight:600;cursor:pointer;transition:color .15s,background-color .15s; }
  .gzp-item-action:hover { color:var(--pe-accent);background:var(--pe-sand); }
  .gzp-item-action:focus-visible { outline:2px solid var(--pe-accent);outline-offset:-2px; }
  .gzp-item-action-danger:hover { color:var(--pe-terracotta,#8b3a1e); }

  .gzp-edit-form { flex:1;min-width:200px;display:flex;flex-direction:column;gap:8px; }
  .gzp-delete-confirm { flex:1;min-width:200px;display:flex;flex-direction:column;gap:8px; }
  .gzp-delete-confirm-text { font-size:13.5px;font-weight:600;color:var(--pe-text); }
  .gzp-item-error { color:var(--pe-terracotta,#8b3a1e);font-size:12px; }
  .gzp-form-actions { display:flex;gap:8px;flex-wrap:wrap; }

  .gzp-btn-danger.pe-btn-secondary { border-color:var(--pe-terracotta,#8b3a1e);color:var(--pe-terracotta,#8b3a1e); }
  .gzp-btn-danger.pe-btn-secondary:hover { border-color:var(--pe-terracotta,#8b3a1e);background:#fff0ec; }

  .gzp-input { width:100%;min-height:44px;border:1px solid var(--pe-border);border-radius:var(--pe-radius-sm);padding:10px 14px;font-family:var(--pe-font-body);font-size:14px;color:var(--pe-text);background:var(--pe-surface);outline:none;transition:border-color .15s; }
  .gzp-input:focus { border-color:var(--pe-accent); }
  .gzp-input::placeholder { color:var(--pe-text-muted); }

  .gzp-create-form { display:flex;flex-direction:column;gap:8px;margin-top:4px; }
  .gzp-add-toggle { display:flex;align-items:center;justify-content:center;gap:6px;width:100%;min-height:44px;padding:10px;border:1.5px dashed var(--pe-border-strong);border-radius:var(--pe-radius-sm);background:transparent;color:var(--pe-text-muted);font-family:var(--pe-font-body);font-size:13.5px;font-weight:600;cursor:pointer;margin-top:4px;transition:border-color .15s,color .15s; }
  .gzp-add-toggle:hover { border-color:var(--pe-accent);color:var(--pe-accent); }
  .gzp-add-toggle:focus-visible { outline:2px solid var(--pe-accent);outline-offset:2px; }

  .gzp-settings-wrap { margin-top:-2px;padding:16px;border:1px solid var(--pe-border);border-radius:var(--pe-radius-sm);background:var(--pe-surface); }

  @media (max-width:480px) { .gzp-item-actions { width:100%;justify-content:flex-start; } }
`;
