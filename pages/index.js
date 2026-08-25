import React, { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/router";
import { useAuth } from "@/lib/useAuth";
import { tabFromQuery, tabToQuery } from "@/lib/homeTabRouting";
import { useGarden } from "@/lib/useGarden";
import { useReminders } from "@/lib/useReminders";
import { useGardenZones } from "@/lib/useGardenZones";
import { fetchProfile } from "@/lib/profileApi";
import { fetchWeatherForProfile } from "@/lib/weatherApi";
import { evaluateWateringWeather } from "@/lib/weatherEngine";
import { getEffectivePlantContext } from "@/lib/effectivePlantContext";
import AuthModal from "@/components/AuthModal";
import PlantContextEditor from "@/components/PlantContextEditor";
import ReminderBulkModal from "@/components/ReminderBulkModal";
import RemindersOverview from "@/components/RemindersOverview";
import GardenZonesPanel from "@/components/GardenZonesPanel";
import AccueilDashboard from "@/components/AccueilDashboard";
import AppShell from "@/components/ui/AppShell";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import SectionHeader from "@/components/ui/SectionHeader";
import {
  IconHome,
  IconCamera,
  IconSprout,
  IconSearch,
  IconUser,
  IconInfo,
  IconBell,
  IconCalendar,
  IconMapPin,
  IconTrash,
  IconSprig,
  IconChevronRight,
  IconSun,
  IconX,
  IconCheck,
  IconHelpCircle,
  IconScissors,
  IconDroplet,
  IconFlask,
  IconAlertCircle,
  IconArrowRight,
} from "@/components/ui/icons";

const CATEGORIES = ["Arbre", "Arbuste", "Plante vivace", "Annuelle", "Aromate", "Légume", "Fruit", "Rosier", "Autre"];
const MONTHS = [["jan","Jan"],["fev","Fév"],["mar","Mar"],["avr","Avr"],["mai","Mai"],["jun","Jun"],["jul","Jul"],["aou","Août"],["sep","Sep"],["oct","Oct"],["nov","Nov"],["dec","Déc"]];

const PLANTATION_TYPES = [
  { id: "terre", label: "En pleine terre", icon: "🌍" },
  { id: "semi", label: "Semi-enterré", icon: "🌗" },
  { id: "pot_petit", label: "Pot petit (< 20cm)", icon: "🪴" },
  { id: "pot_moyen", label: "Pot moyen (20-40cm)", icon: "🪴" },
  { id: "pot_grand", label: "Pot grand (40-60cm)", icon: "🪴" },
  { id: "pot_xl", label: "Pot XL (> 60cm)", icon: "🪴" },
  { id: "jardiniere", label: "Jardinière", icon: "📦" },
  { id: "suspension", label: "Suspension", icon: "🪣" },
];

const USAGE_TYPES = [
  { id: "isole", label: "Arbre / plante isolé(e)", icon: "🌳" },
  { id: "haie_taillee", label: "Haie taillée", icon: "✂️" },
  { id: "haie_libre", label: "Haie libre / champêtre", icon: "🌿" },
  { id: "massif", label: "Massif / mixed-border", icon: "🌺" },
  { id: "couvre_sol", label: "Couvre-sol", icon: "🍃" },
  { id: "palisse", label: "Palissé / espalier", icon: "🪟" },
  { id: "bordure", label: "Bordure", icon: "〰️" },
  { id: "potager", label: "Potager / carré", icon: "🥕" },
];

function buildSystemPrompt(plantation, usage) {
  const ctx = plantation ? `
CONTEXTE DE PLANTATION : ${plantation.label}
Adapte TOUS tes conseils (quantités d eau en litres, doses d engrais en grammes, fréquences) à ce contexte spécifique.
- Pour les pots : donne des quantités précises en ml ou litres selon la taille du pot
- Pour la terre : donne des conseils adaptés à la pleine terre
- Pour semi-enterré : combine les deux approches` : "";

  const usageCtx = usage ? `
USAGE / FORME DE CULTURE : ${usage.label}
IMPORTANT : Adapte TOUS tes conseils à cet usage spécifique.
- Pour haie taillée : REGLES : taille annuelle 1-2x/an juin/aout, etetage autorise, trapeze, eviter mars-mai, pas mastic. NE PAS ('arbre isolé), fréquence de taille pour maintien de forme
- Pour haie libre : conseils naturalistes, taille minimale
- Pour arbre isolé : conseils pour port naturel, taille de formation uniquement
- Pour palissé/espalier : techniques de palissage, taille en vert
- Pour massif : conseils de cohabitation, espacement
Les conseils de taille en particulier doivent être radicalement différents selon l'usage.` : "";

  return `Tu es un expert botaniste et horticulteur francophone spécialisé en jardinage européen (Belgique, France, Luxembourg).

REGLES ABSOLUES - NE JAMAIS VIOLER :
1. PRECISION BOTANIQUE : Identifie l espece exacte avant tout conseil. Un hetre en haie et un hetre isole ont des regles COMPLETEMENT differentes. Une lavande en pot et en pleine terre aussi.
2. JAMAIS DE GENERALISATION : Ne donne jamais les conseils d un arbre isole pour une haie, ni d une plante en terre pour un pot. Chaque contexte change tout.
3. PAS D INVENTION : Si tu n es pas certain d une information precise (dose, frequence, periode), dis-le clairement plutot que d inventer.
4. RESPECT DU CONTEXTE : Le contexte de plantation ET l usage fournis sont PRIORITAIRES sur tes connaissances generales. Adapte chaque conseil en consequence.
5. COHERENCE : Tes conseils doivent etre coherents entre eux. Pas de contradictions entre sections.
6. SPECIFICITE : Donne des quantites precises (litres, grammes, cm) adaptees au contexte reel, pas des generalites vagues.
${ctx}
${usageCtx}

Quand on te donne une photo ou un nom de plante, tu fournis une analyse complète structurée en JSON.
IMPORTANT : Réponds UNIQUEMENT en JSON valide, sans backticks, sans texte avant ou après.

{
  "identite": {
    "nom_commun": "string",
    "nom_latin": "string",
    "famille": "string",
    "categorie": "Arbre|Arbuste|Plante vivace|Annuelle|Aromate|Légume|Fruit|Rosier|Autre",
    "description": "string (2-3 phrases)",
    "confiance": "élevée | moyenne | faible"
  },
  "maladies": {
    "vulnerabilites": ["maladies/ravageurs courants"],
    "symptomes_alerte": ["signes à surveiller"],
    "traitements": ["remèdes et préventions"],
    "conseil_urgence": "string"
  },
  "taille": {
    "periode_ideale": "string",
    "frequence": "string",
    "technique": "string avec quantités si applicable",
    "a_eviter": "string",
    "conseil_pro": "string"
  },
  "nutriments": {
    "besoins_principaux": ["N, P, K et besoins spécifiques"],
    "engrais_recommande": "string avec dose précise (ex: 5g/litre substrat, 30g/m²)",
    "periode_fertilisation": "string",
    "frequence_apport": "string avec quantités précises selon le contexte",
    "signes_carence": ["symptômes visibles"],
    "surdosage_risques": "string"
  },
  "arrosage": {
    "frequence_ete": "string avec quantité précise en litres selon contexte",
    "frequence_hiver": "string avec quantité précise",
    "methode": "string",
    "eau_ideale": "string",
    "signes_manque": "string",
    "signes_exces": "string",
    "conseil_pratique": "string adapté au contexte de plantation"
  },
  "calendrier": {
    "jan": "string", "fev": "string", "mar": "string",
    "avr": "string", "mai": "string", "jun": "string",
    "jul": "string", "aou": "string", "sep": "string",
    "oct": "string", "nov": "string", "dec": "string"
  }
}`;
}

async function analyzeWithClaude(imageBase64, plantName, plantation, usage) {
  const content = [];
  if (imageBase64) {
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } });
    content.push({ type: "text", text: plantName ? `Identifie et analyse cette plante. L utilisateur pense que c est : "${plantName}". Confirme ou corrige.` : "Identifie et analyse complètement cette plante." });
  } else {
    content.push({ type: "text", text: `Analyse complète de la plante : "${plantName}"` });
  }
  const response = await fetch("/api/proxy", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 8000, system: buildSystemPrompt(plantation, usage), messages: [{ role: "user", content }] })
  });
  if (!response.ok) throw new Error(`API error ${response.status}`);
  const data = await response.json();
  const text = data.content.map(b => b.text || "").join("");
  const clean = text.replace(/```json|```/g, "").trim(); const start = clean.indexOf("{"); const end = clean.lastIndexOf("}"); return JSON.parse(clean.slice(start, end + 1));
}

function resizeImage(file, maxSize = 1024) {
  return new Promise((res) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let w = img.width, h = img.height;
      if (w > maxSize || h > maxSize) { if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; } else { w = Math.round(w * maxSize / h); h = maxSize; } }
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => { const reader = new FileReader(); reader.onload = () => res(reader.result.split(",")[1]); reader.readAsDataURL(blob); }, "image/jpeg", 0.85);
    };
    img.src = url;
  });
}

function PlantationModal({ onConfirm, onSkip }) {
  const [step, setStep] = useState(1);
  const [plantation, setPlantation] = useState(null);
  const [usageSelected, setUsageSelected] = useState(null);

  const handleConfirm = () => {
    if (step === 1 && plantation) { setStep(2); return; }
    if (step === 2) { onConfirm(plantation, usageSelected); }
  };

  return (
    <div className="plm-overlay">
      <style>{PLM_STYLES}</style>
      <div className="plm-panel" role="dialog" aria-modal="true" aria-labelledby="plm-title">
        <div className="plm-step">Étape {step}/2</div>
        {step === 1 && (
          <>
            <div className="plm-title" id="plm-title">Contexte de plantation</div>
            <div className="plm-sub">Les quantités eau et engrais seront adaptées</div>
            <div className="plm-option-grid" role="group" aria-label="Contexte de plantation">
              {PLANTATION_TYPES.map(p => (
                <button
                  type="button"
                  key={p.id}
                  className={"plm-option" + (plantation && plantation.id === p.id ? " active" : "")}
                  aria-pressed={!!(plantation && plantation.id === p.id)}
                  onClick={() => setPlantation(p)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <div className="plm-title" id="plm-title">Usage de la plante</div>
            <div className="plm-sub">Les conseils de taille seront adaptés à cet usage</div>
            <div className="plm-option-grid" role="group" aria-label="Usage de la plante">
              {USAGE_TYPES.map(u => (
                <button
                  type="button"
                  key={u.id}
                  className={"plm-option" + (usageSelected && usageSelected.id === u.id ? " active" : "")}
                  aria-pressed={!!(usageSelected && usageSelected.id === u.id)}
                  onClick={() => setUsageSelected(u)}
                >
                  {u.label}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="plm-actions">
          <Button
            type="button"
            disabled={step === 1 ? !plantation : false}
            onClick={handleConfirm}
          >
            {step === 1 ? <>Suivant <IconArrowRight size={16} /></> : "Obtenir les conseils adaptés"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => onSkip()}>
            Passer (conseils généraux)
          </Button>
        </div>
      </div>
    </div>
  );
}

const PLM_STYLES = `
  .plm-overlay { position:fixed;inset:0;background:rgba(24,33,29,0.45);display:flex;align-items:center;justify-content:center;padding:20px;z-index:1000; }
  .plm-panel { position:relative;width:100%;max-width:480px;max-height:min(640px,90vh);overflow-y:auto;background:var(--pe-surface);border-radius:var(--pe-radius-lg);border:1px solid var(--pe-border);box-shadow:var(--pe-shadow-md);padding:28px; }

  .plm-step { font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--pe-text-muted);margin-bottom:8px; }
  .plm-title { font-family:var(--pe-font-display);font-weight:600;font-size:21px;color:var(--pe-text); }
  .plm-sub { margin-top:4px;margin-bottom:18px;color:var(--pe-text-muted);font-size:13.5px; }

  .plm-option-grid { display:flex;flex-wrap:wrap;gap:8px; }
  .plm-option { min-height:44px;padding:9px 16px;border-radius:999px;border:1.5px solid var(--pe-border);background:var(--pe-surface);color:var(--pe-text-muted);font-family:var(--pe-font-body);font-size:13.5px;font-weight:600;cursor:pointer;transition:border-color .15s,background-color .15s,color .15s; }
  .plm-option:hover { border-color:var(--pe-border-strong); }
  .plm-option:focus-visible { outline:2px solid var(--pe-accent);outline-offset:2px; }
  .plm-option.active { border-color:var(--pe-accent);background:var(--pe-sand);color:var(--pe-accent); }

  .plm-actions { display:flex;gap:8px;flex-wrap:wrap;margin-top:22px; }

  @media (max-width:480px) { .plm-panel { padding:20px; } }
`;

function TagList({ items, color }) {
  const c = color || "green";
  if (!items || !items.length) return <p className="pdet-empty-text">Aucune donnée</p>;
  return (
    <div className="pdet-tag-list">
      {items.map((item, i) => (
        <div key={i} className={"pdet-tag pdet-tag-" + c}>
          <span className="pdet-tag-dot" />
          {item}
        </div>
      ))}
    </div>
  );
}

// A missing/empty value never renders an empty decorative box (spec: "SI
// une donnée n'existe pas -> masquer proprement l'élément") — every call
// site in PlanteFiche below relies on this instead of re-guarding itself.
function InfoCard({ icon: Icon, label, value }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="pdet-info-card">
      {Icon && <span className="pdet-info-icon"><Icon size={16} /></span>}
      <div className="pdet-info-body">
        <div className="pdet-info-label">{label}</div>
        <div className="pdet-info-value">{value}</div>
      </div>
    </div>
  );
}

function CalendrierGrid({ data }) {
  const moisActuel = new Date().getMonth();
  return (
    <div className="pdet-cal-grid">
      {MONTHS.map(([key, label], i) => (
        <div key={key} className={"pdet-cal-cell" + (i === moisActuel ? " active" : "")}>
          <div className="pdet-cal-month">{label}</div>
          <div className="pdet-cal-text">{data[key] || "—"}</div>
        </div>
      ))}
    </div>
  );
}

const PLANT_DETAIL_TABS = [
  { key: "maladies", label: "Maladies", icon: IconAlertCircle },
  { key: "taille", label: "Taille", icon: IconScissors },
  { key: "nutriments", label: "Nutriments", icon: IconFlask },
  { key: "arrosage", label: "Arrosage", icon: IconDroplet },
  { key: "calendrier", label: "Calendrier", icon: IconCalendar },
];

function PlanteFiche({ result, imagePreview, plantation, usage, onSave, alreadySaved, context, onSaveContext, identificationStatus, identificationActions, zoneId, zones, isAuthenticated, onSaveZone }) {
  const [activeTab, setActiveTab] = useState("maladies");
  const tabs = onSaveContext ? [...PLANT_DETAIL_TABS, { key: "jardin", label: "Jardin", icon: IconSprout }] : PLANT_DETAIL_TABS;
  const r = result;
  const identite = r && r.identite;
  // zoneId/zones are only ever passed from the Mon Jardin context — reuses
  // the exact same pure helper Mon Jardin's own cards use, so a plant whose
  // zone was since deleted never shows a stale/raw zoneId here either.
  const zoneName = zones ? zoneNameForPlant({ zoneId }, zones) : null;

  return (
    <div className="pdet-page">
      <style>{PLANT_DETAIL_STYLES}</style>
      <div className="pdet-hero">
        <div className="pdet-hero-top">
          <div className="pdet-hero-photo">
            {imagePreview ? (
              <img
                src={imagePreview}
                alt={identite && identite.nom_commun ? `Photo de ${identite.nom_commun}` : "Photo de la plante"}
              />
            ) : (
              <IconSprig size={34} />
            )}
          </div>
          <div className="pdet-hero-text">
            {identite && identite.confiance && (
              <span className={"pdet-confidence pdet-confidence-" + identite.confiance}>
                Confiance : {identite.confiance}
              </span>
            )}
            {identite && identite.nom_commun && <h1 className="pdet-hero-name">{identite.nom_commun}</h1>}
            {identite && identite.nom_latin && <div className="pdet-hero-latin">{identite.nom_latin}</div>}
            <div className="pdet-hero-facts">
              {identite && identite.categorie && <span className="pdet-fact-pill">{identite.categorie}</span>}
              {identite && identite.famille && <span className="pdet-fact-pill">{identite.famille}</span>}
              {zoneName && <span className="pdet-fact-pill pdet-fact-pill-zone"><IconMapPin size={12} /> {zoneName}</span>}
            </div>
            <div className="pdet-status-row">
              {alreadySaved && identificationStatus === "confirmed" && (
                <span className="pdet-status-badge pdet-status-confirmed"><IconCheck size={13} /> Identification confirmée</span>
              )}
              {alreadySaved && identificationStatus === "uncertain" && (
                <span className="pdet-status-badge pdet-status-uncertain"><IconHelpCircle size={13} /> Identification à confirmer</span>
              )}
              {plantation && <span className="pdet-context-pill">{plantation.icon} {plantation.label}</span>}
              {usage && <span className="pdet-context-pill">{usage.icon} {usage.label}</span>}
            </div>
          </div>
        </div>

        {identite && identite.description && <p className="pdet-hero-desc">{identite.description}</p>}

        <div className="pdet-save-row">
          {alreadySaved ? (
            <span className="pdet-saved-badge"><IconCheck size={15} /> Dans Mon Jardin</span>
          ) : identificationStatus === "rejected" ? (
            <span className="pdet-blocked-note">Ajout à Mon Jardin bloqué — identification rejetée</span>
          ) : (
            <Button onClick={onSave}><IconSprout size={16} /> Ajouter à Mon Jardin</Button>
          )}
        </div>

        {identificationActions && identificationStatus && !alreadySaved && (
          <div className="pdet-id-check" role="group" aria-label="Confirmer l'identification">
            <button
              type="button"
              aria-pressed={identificationStatus === "confirmed"}
              className={"pdet-id-check-btn" + (identificationStatus === "confirmed" ? " active-yes" : "")}
              onClick={identificationActions.onConfirm}
            >
              <IconCheck size={15} /> Oui, c&apos;est ça
            </button>
            <button
              type="button"
              aria-pressed={identificationStatus === "rejected"}
              className={"pdet-id-check-btn" + (identificationStatus === "rejected" ? " active-no" : "")}
              onClick={identificationActions.onReject}
            >
              <IconX size={15} /> Non
            </button>
            <button
              type="button"
              aria-pressed={identificationStatus === "uncertain"}
              className={"pdet-id-check-btn" + (identificationStatus === "uncertain" ? " active-unsure" : "")}
              onClick={identificationActions.onUncertain}
            >
              <IconHelpCircle size={15} /> Je ne sais pas
            </button>
          </div>
        )}

        <div className="pdet-tabs" role="tablist">
          {tabs.map((s) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={activeTab === s.key}
              className={"pdet-tab" + (activeTab === s.key ? " active" : "")}
              onClick={() => setActiveTab(s.key)}
            >
              <s.icon size={15} />
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {identificationStatus === "rejected" && identificationActions && !alreadySaved && (
        <div className="pdet-content-card" style={{ marginBottom: 16 }}>
          <div className="pdet-section-title"><IconX size={17} /> Identification rejetée</div>
          <div className="error-box" style={{ margin: "0 0 16px" }}>
            Vous avez indiqué que ce résultat n&apos;était pas correct. Il ne peut pas être ajouté à Mon Jardin tel quel.
          </div>
          <div className="pdet-rejected-actions">
            <Button onClick={identificationActions.onRetakePhoto}><IconCamera size={16} /> Reprendre une photo</Button>
            <Button variant="secondary" onClick={identificationActions.onSwitchToNameSearch}><IconSearch size={16} /> Identifier par nom</Button>
          </div>
        </div>
      )}
      {identificationStatus === "uncertain" && !alreadySaved && (
        <div className="pdet-content-card" style={{ marginBottom: 16 }}>
          <div className="pdet-section-title"><IconHelpCircle size={17} /> Identification à confirmer</div>
          <div className="pdet-highlight-box">
            Pour confirmer cette identification, essaie une nouvelle photo : la plante entière, une feuille, une fleur ou un fruit si disponible, et l&apos;écorce ou la tige si pertinent.
          </div>
        </div>
      )}

      <div className="pdet-content-card">
        {activeTab === "maladies" && r.maladies && (
          <div>
            <div className="pdet-section-title"><IconAlertCircle size={17} /> Maladies &amp; Ravageurs</div>
            <div className="pdet-subsection"><div className="pdet-subsection-title">Vulnérabilités</div><TagList items={r.maladies.vulnerabilites} color="red" /></div>
            <div className="pdet-subsection"><div className="pdet-subsection-title">Symptômes</div><TagList items={r.maladies.symptomes_alerte} color="gold" /></div>
            <div className="pdet-subsection"><div className="pdet-subsection-title">Traitements</div><TagList items={r.maladies.traitements} color="green" /></div>
            {r.maladies.conseil_urgence && <div className="pdet-highlight-box"><div className="pdet-highlight-label">Urgence</div>{r.maladies.conseil_urgence}</div>}
          </div>
        )}
        {activeTab === "taille" && r.taille && (
          <div>
            <div className="pdet-section-title"><IconScissors size={17} /> Taille</div>
            <div className="pdet-info-grid">
              <InfoCard icon={IconCalendar} label="Période" value={r.taille.periode_ideale} />
              <InfoCard label="Fréquence" value={r.taille.frequence} />
            </div>
            {r.taille.technique && <div className="pdet-highlight-box"><div className="pdet-highlight-label">Technique</div>{r.taille.technique}</div>}
            {r.taille.a_eviter && <div className="pdet-highlight-box pdet-highlight-warn"><div className="pdet-highlight-label">À éviter</div>{r.taille.a_eviter}</div>}
            {r.taille.conseil_pro && <div className="pdet-highlight-box pdet-highlight-gold"><div className="pdet-highlight-label">Conseil pro</div>{r.taille.conseil_pro}</div>}
          </div>
        )}
        {activeTab === "nutriments" && r.nutriments && (
          <div>
            <div className="pdet-section-title"><IconFlask size={17} /> Nutriments &amp; Engrais</div>
            {plantation && <div className="pdet-context-banner">{plantation.icon} Conseils adaptés : {plantation.label}</div>}
            <div className="pdet-subsection"><div className="pdet-subsection-title">Besoins</div><TagList items={r.nutriments.besoins_principaux} color="green" /></div>
            <div className="pdet-info-grid" style={{ marginTop: 14 }}>
              <InfoCard icon={IconFlask} label="Engrais recommandé" value={r.nutriments.engrais_recommande} />
              <InfoCard icon={IconCalendar} label="Période" value={r.nutriments.periode_fertilisation} />
            </div>
            {r.nutriments.frequence_apport && <div className="pdet-highlight-box"><div className="pdet-highlight-label">Quantités et fréquence</div>{r.nutriments.frequence_apport}</div>}
            {r.nutriments.signes_carence && r.nutriments.signes_carence.length > 0 && <div className="pdet-subsection"><div className="pdet-subsection-title">Signes de carence</div><TagList items={r.nutriments.signes_carence} color="gold" /></div>}
            {r.nutriments.surdosage_risques && <div className="pdet-highlight-box pdet-highlight-warn"><div className="pdet-highlight-label">Risque surdosage</div>{r.nutriments.surdosage_risques}</div>}
          </div>
        )}
        {activeTab === "arrosage" && r.arrosage && (
          <div>
            <div className="pdet-section-title"><IconDroplet size={17} /> Arrosage</div>
            {plantation && <div className="pdet-context-banner">{plantation.icon} Conseils adaptés : {plantation.label}</div>}
            <div className="pdet-info-grid">
              <InfoCard icon={IconSun} label="Été" value={r.arrosage.frequence_ete} />
              <InfoCard label="Hiver" value={r.arrosage.frequence_hiver} />
            </div>
            {r.arrosage.methode && <div className="pdet-highlight-box"><div className="pdet-highlight-label">Méthode</div>{r.arrosage.methode}</div>}
            {r.arrosage.conseil_pratique && <div className="pdet-highlight-box pdet-highlight-gold"><div className="pdet-highlight-label">Conseil pratique</div>{r.arrosage.conseil_pratique}</div>}
            <div className="pdet-info-grid" style={{ marginTop: 10 }}>
              <InfoCard icon={IconAlertCircle} label="Manque" value={r.arrosage.signes_manque} />
              <InfoCard icon={IconAlertCircle} label="Excès" value={r.arrosage.signes_exces} />
            </div>
          </div>
        )}
        {activeTab === "calendrier" && r.calendrier && (
          <div>
            <div className="pdet-section-title"><IconCalendar size={17} /> Calendrier annuel</div>
            <CalendrierGrid data={r.calendrier} />
          </div>
        )}
        {activeTab === "jardin" && onSaveContext && (
          <div>
            <div className="pdet-section-title"><IconSprout size={17} /> Contexte du jardin</div>
            <PlantContextEditor
              context={context}
              onSave={onSaveContext}
              zoneId={zoneId}
              zones={zones}
              isAuthenticated={isAuthenticated}
              onSaveZone={onSaveZone}
            />
          </div>
        )}
      </div>
    </div>
  );
}

const PLANT_DETAIL_STYLES = `
  .pdet-page { max-width:760px;margin:0 auto; }

  .pdet-hero { padding:24px;border-radius:var(--pe-radius-lg);background:var(--pe-surface);border:1px solid var(--pe-border);box-shadow:var(--pe-shadow-sm);margin-bottom:20px; }
  .pdet-hero-top { display:flex;gap:18px;align-items:flex-start; }
  .pdet-hero-photo { flex-shrink:0;width:96px;height:96px;border-radius:var(--pe-radius-md);background:var(--pe-sand);display:flex;align-items:center;justify-content:center;color:var(--pe-sage-400);overflow:hidden; }
  .pdet-hero-photo img { width:100%;height:100%;object-fit:cover;display:block; }
  .pdet-hero-text { flex:1;min-width:0; }
  @media (max-width:480px) { .pdet-hero { padding:18px; } .pdet-hero-top { gap:14px; } .pdet-hero-photo { width:72px;height:72px; } }

  .pdet-confidence { display:inline-flex;padding:3px 10px;border-radius:999px;font:var(--pe-text-small);font-size:11px;font-weight:700;margin-bottom:7px; }
  .pdet-confidence-élevée { background:var(--pe-sand);color:var(--pe-accent); }
  .pdet-confidence-moyenne { background:#fdf3e0;color:#8a6a1e; }
  .pdet-confidence-faible { background:#fff0ec;color:var(--pe-terracotta,#8b3a1e); }

  .pdet-hero-name { font-family:var(--pe-font-display);font-weight:600;font-size:clamp(20px,2.6vw,28px);color:var(--pe-text);line-height:1.15; }
  .pdet-hero-latin { margin-top:3px;font-style:italic;font-size:14px;color:var(--pe-text-muted); }
  .pdet-hero-facts { margin-top:10px;display:flex;flex-wrap:wrap;gap:6px; }
  .pdet-fact-pill { display:inline-flex;align-items:center;gap:3px;padding:3px 10px;border-radius:999px;background:var(--pe-sand);color:var(--pe-text-muted);font-size:11.5px;font-weight:600; }
  .pdet-fact-pill-zone { color:var(--pe-accent); }
  .pdet-status-row { margin-top:10px;display:flex;flex-wrap:wrap;gap:8px; }
  .pdet-status-badge { display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:999px;font-size:11.5px;font-weight:700; }
  .pdet-status-confirmed { background:var(--pe-sand);color:var(--pe-accent); }
  .pdet-status-uncertain { background:#fdf3e0;color:#8a6a1e; }
  .pdet-context-pill { display:inline-flex;align-items:center;padding:4px 10px;border-radius:999px;background:var(--pe-ivory);border:1px solid var(--pe-border);color:var(--pe-text);font-size:11.5px;font-weight:600; }

  .pdet-hero-desc { margin-top:16px;font:var(--pe-text-body);color:var(--pe-text-muted); }

  .pdet-save-row { margin-top:18px; }
  .pdet-saved-badge { display:inline-flex;align-items:center;gap:6px;padding:9px 16px;border-radius:999px;background:var(--pe-sand);color:var(--pe-accent);font:var(--pe-text-small);font-weight:700; }
  .pdet-blocked-note { display:inline-block;padding:9px 4px;color:var(--pe-text-muted);font:var(--pe-text-small); }

  .pdet-id-check { margin-top:14px;display:flex;flex-wrap:wrap;gap:8px; }
  .pdet-id-check-btn { display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:9px 16px;border-radius:999px;border:1.5px solid var(--pe-border);background:var(--pe-surface);color:var(--pe-text);font:var(--pe-text-small);font-weight:600;cursor:pointer;transition:border-color .15s,background-color .15s,color .15s; }
  .pdet-id-check-btn:hover { border-color:var(--pe-border-strong); }
  .pdet-id-check-btn.active-yes { border-color:var(--pe-accent);background:var(--pe-sand);color:var(--pe-accent); }
  .pdet-id-check-btn.active-no { border-color:var(--pe-terracotta,#8b3a1e);background:#fff0ec;color:var(--pe-terracotta,#8b3a1e); }
  .pdet-id-check-btn.active-unsure { border-color:#c4962a;background:#fdf3e0;color:#8a6a1e; }

  .pdet-tabs { margin-top:20px;display:flex;gap:6px;overflow-x:auto;padding-bottom:2px;border-bottom:1px solid var(--pe-border); }
  .pdet-tab { flex-shrink:0;display:inline-flex;align-items:center;gap:7px;padding:10px 14px;min-height:44px;border:none;background:none;color:var(--pe-text-muted);font:var(--pe-text-small);font-weight:600;cursor:pointer;white-space:nowrap;border-bottom:2px solid transparent;margin-bottom:-1px; }
  .pdet-tab:hover { color:var(--pe-text); }
  .pdet-tab.active { color:var(--pe-accent);border-bottom-color:var(--pe-accent); }
  .pdet-tab:focus-visible { outline:2px solid var(--pe-accent);outline-offset:-2px; }

  .pdet-content-card { padding:24px;border-radius:var(--pe-radius-lg);background:var(--pe-surface);border:1px solid var(--pe-border);box-shadow:var(--pe-shadow-sm); }
  @media (max-width:480px) { .pdet-content-card { padding:18px; } }
  .pdet-section-title { display:flex;align-items:center;gap:8px;font-family:var(--pe-font-display);font-weight:600;font-size:19px;color:var(--pe-text);margin-bottom:16px; }
  .pdet-section-title svg { color:var(--pe-accent);flex-shrink:0; }

  .pdet-subsection { margin-bottom:16px; }
  .pdet-subsection:last-child { margin-bottom:0; }
  .pdet-subsection-title { font:var(--pe-text-small);color:var(--pe-text-muted);font-weight:700;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:8px; }

  .pdet-tag-list { display:flex;flex-direction:column;gap:6px; }
  .pdet-tag { display:flex;align-items:flex-start;gap:8px;font:var(--pe-text-body);font-size:14px;color:var(--pe-text);line-height:1.45; }
  .pdet-tag-dot { flex-shrink:0;width:6px;height:6px;border-radius:50%;margin-top:7px; }
  .pdet-tag-green .pdet-tag-dot { background:var(--pe-accent); }
  .pdet-tag-gold .pdet-tag-dot { background:#c4962a; }
  .pdet-tag-red .pdet-tag-dot { background:var(--pe-terracotta,#8b3a1e); }
  .pdet-empty-text { color:var(--pe-text-muted);font:var(--pe-text-small); }

  .pdet-info-grid { display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px; }
  .pdet-info-card { display:flex;align-items:flex-start;gap:9px;background:var(--pe-sand);border-radius:var(--pe-radius-sm);padding:12px 13px; }
  .pdet-info-icon { flex-shrink:0;color:var(--pe-accent);display:flex;margin-top:1px; }
  .pdet-info-label { font-size:10.5px;text-transform:uppercase;letter-spacing:0.6px;color:var(--pe-text-muted);font-weight:700;margin-bottom:2px; }
  .pdet-info-value { font-size:13.5px;color:var(--pe-text);font-weight:500;line-height:1.4; }
  @media (max-width:480px) { .pdet-info-grid { grid-template-columns:1fr; } }

  .pdet-highlight-box { background:var(--pe-ivory);border-left:3px solid var(--pe-accent);border-radius:0 var(--pe-radius-sm) var(--pe-radius-sm) 0;padding:12px 14px;font:var(--pe-text-body);font-size:14px;color:var(--pe-text);margin-bottom:12px; }
  .pdet-highlight-box:last-child { margin-bottom:0; }
  .pdet-highlight-label { font-size:10.5px;text-transform:uppercase;letter-spacing:0.6px;color:var(--pe-text-muted);font-weight:700;margin-bottom:4px; }
  .pdet-highlight-warn { border-left-color:var(--pe-terracotta,#8b3a1e);background:#fff8f6; }
  .pdet-highlight-warn .pdet-highlight-label { color:var(--pe-terracotta,#8b3a1e); }
  .pdet-highlight-gold { border-left-color:#c4962a;background:#fffbf0; }
  .pdet-highlight-gold .pdet-highlight-label { color:#8a6a1e; }

  .pdet-context-banner { background:var(--pe-sand);border-radius:var(--pe-radius-sm);padding:10px 13px;font:var(--pe-text-small);color:var(--pe-accent);font-weight:600;margin-bottom:14px; }

  .pdet-cal-grid { display:grid;grid-template-columns:repeat(3,1fr);gap:8px; }
  @media (max-width:560px) { .pdet-cal-grid { grid-template-columns:repeat(2,1fr); } }
  .pdet-cal-cell { background:var(--pe-sand);border-radius:var(--pe-radius-sm);padding:10px 11px; }
  .pdet-cal-cell.active { background:var(--pe-accent); }
  .pdet-cal-month { font-size:10.5px;text-transform:uppercase;letter-spacing:0.6px;font-weight:700;color:var(--pe-text-muted);margin-bottom:3px; }
  .pdet-cal-cell.active .pdet-cal-month { color:rgba(255,255,255,0.75); }
  .pdet-cal-text { font-size:12.5px;color:var(--pe-text);line-height:1.35; }
  .pdet-cal-cell.active .pdet-cal-text { color:var(--pe-on-accent); }

  .pdet-rejected-actions { display:flex;flex-wrap:wrap;gap:10px; }
  @media (max-width:480px) { .pdet-rejected-actions { flex-direction:column; } .pdet-rejected-actions .pe-btn { width:100%; } }
`;

function IdentifierTab({ addPlant }) {
  const [plantName, setPlantName] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [usage, setUsage] = useState(null);
  const [plantation, setPlantation] = useState(null);
  const [identificationStatus, setIdentificationStatus] = useState(null);
  const [pendingFocus, setPendingFocus] = useState(null); // "photo" | "name" | null
  const fileRef = useRef();
  const nameInputRef = useRef();

  // Runs strictly after React has committed the reset (result cleared, back
  // to the input-panel), instead of racing a requestAnimationFrame against
  // the click event that triggered it — avoids the programmatic focus/click
  // landing before the DOM has actually switched view, or picking up a
  // still-in-flight keyboard event from the button that was just clicked.
  useEffect(() => {
    if (pendingFocus === "photo") {
      fileRef.current && fileRef.current.click();
      setPendingFocus(null);
    } else if (pendingFocus === "name") {
      nameInputRef.current && nameInputRef.current.focus();
      setPendingFocus(null);
    }
  }, [pendingFocus]);

  const handleFile = useCallback((file) => {
    if (!file || !file.type.startsWith("image/")) return;
    setImageFile(file); setImagePreview(URL.createObjectURL(file));
    setResult(null); setError(null); setSaved(false); setIdentificationStatus(null);
  }, []);

  const doAnalyze = async (plantationCtx, usageCtx) => {
    setLoading(true); setError(null); setResult(null); setSaved(false); setShowModal(false); setIdentificationStatus(null);
    try {
      let b64 = null;
      if (imageFile) { b64 = await resizeImage(imageFile); setImagePreview(`data:image/jpeg;base64,${b64}`); }
      const data = await analyzeWithClaude(b64, plantName.trim(), plantationCtx, usageCtx);
      setResult(data);
      setIdentificationStatus(imageFile ? "unreviewed" : null);
    } catch (e) {
      setError("Erreur d analyse. Vérifie ta connexion ou réessaie.");
    } finally { setLoading(false); }
  };

  const handleAnalyze = () => {
    if (!imageFile && !plantName.trim()) { setError("Fournis une photo ou un nom de plante."); return; }
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!result || identificationStatus === "rejected") return;
    setSaveError(null);
    const plante = { id: Date.now(), dateAjout: new Date().toISOString(), imagePreview, plantation, usage, data: result, identificationStatus };
    const { error: err } = await addPlant(plante);
    if (err) { setSaveError(err); return; }
    setSaved(true);
  };

  const reset = () => {
    setResult(null); setError(null); setImageFile(null);
    setImagePreview(null); setPlantName(""); setSaved(false); setSaveError(null);
    setPlantation(null); setUsage(null); setIdentificationStatus(null);
  };

  const handleRetakePhoto = (e) => {
    if (e && e.currentTarget) e.currentTarget.blur();
    reset();
    setPendingFocus("photo");
  };

  const handleSwitchToNameSearch = (e) => {
    if (e && e.currentTarget) e.currentTarget.blur();
    reset();
    setPendingFocus("name");
  };

  const identificationActions = {
    onConfirm: () => setIdentificationStatus("confirmed"),
    onReject: () => setIdentificationStatus("rejected"),
    onUncertain: () => setIdentificationStatus("uncertain"),
    onRetakePhoto: handleRetakePhoto,
    onSwitchToNameSearch: handleSwitchToNameSearch,
  };

  return (
    <div className="pi-page">
      <style>{IDENTIFIER_STYLES}</style>
      {showModal && (
        <PlantationModal
          onConfirm={(p, u) => { setPlantation(p); setUsage(u); doAnalyze(p, u); }}
          onSkip={() => { setPlantation(null); doAnalyze(null); }}
        />
      )}
      {!result && !loading && (
        <>
          <header className="pi-header">
            <div className="pi-eyebrow">IDENTIFIER</div>
            <h1 className="pi-title">Quelle est cette plante ?</h1>
            <p className="pi-subtitle">Prenez ou importez une photo pour tenter de l&apos;identifier.</p>
          </header>

          <div className="pi-layout">
            <Card className="pi-main-card">
              <div
                className={"pi-dropzone" + (imagePreview ? " has-image" : "")}
                role={imagePreview ? undefined : "button"}
                tabIndex={imagePreview ? undefined : 0}
                aria-label={imagePreview ? undefined : "Choisir ou déposer une photo de plante"}
                onClick={() => !imagePreview && fileRef.current && fileRef.current.click()}
                onKeyDown={(e) => {
                  if (!imagePreview && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    fileRef.current && fileRef.current.click();
                  }
                }}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
              >
                {imagePreview ? (
                  <>
                    <img
                      src={imagePreview}
                      alt={imageFile && imageFile.name ? `Photo sélectionnée : ${imageFile.name}` : "Photo sélectionnée"}
                      className="pi-preview-img"
                    />
                    <button
                      type="button"
                      className="pi-change-btn"
                      onClick={e => { e.stopPropagation(); fileRef.current && fileRef.current.click(); }}
                    >
                      <IconCamera size={15} /> Changer
                    </button>
                    {imageFile && imageFile.name && <div className="pi-filename">{imageFile.name}</div>}
                  </>
                ) : (
                  <>
                    <span className="pi-dropzone-icon"><IconCamera size={26} /></span>
                    <div className="pi-dropzone-title">Dépose une photo ici</div>
                    <div className="pi-dropzone-sub">ou clique pour en choisir une</div>
                  </>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                style={{display:"none"}}
                tabIndex={-1}
                aria-hidden="true"
                aria-label="Choisir une photo de plante"
                onChange={e => e.target.files && handleFile(e.target.files[0])}
              />

              <div className="pi-divider"><div className="pi-divider-line" /><span>ou</span><div className="pi-divider-line" /></div>

              <div className="pi-name-field">
                <label htmlFor="pi-plant-name" className="pi-name-label">Nom de la plante</label>
                <div className="pi-name-input-wrap">
                  <IconSearch size={16} />
                  <input
                    id="pi-plant-name"
                    ref={nameInputRef}
                    className="pi-name-input"
                    placeholder="Ex. Lavande, Rosier..."
                    value={plantName}
                    onChange={e => setPlantName(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleAnalyze()}
                  />
                </div>
              </div>

              <Button onClick={handleAnalyze} className="pi-analyze-btn">
                <IconSearch size={16} /> Analyser
              </Button>

              {error && <div className="error-box pi-error">⚠️ {error}</div>}
            </Card>

            <Card className="pi-tips-card">
              <div className="pi-tips-head">
                <IconSprig size={18} />
                <span>Pour de meilleurs résultats</span>
              </div>
              <ul className="pi-tips-list">
                <li>Photographiez la plante de près</li>
                <li>Privilégiez une image nette et bien éclairée</li>
                <li>Montrez les feuilles ou les fleurs si elles sont visibles</li>
                <li>Évitez une plante trop éloignée dans le cadre</li>
              </ul>
            </Card>
          </div>
        </>
      )}
      {loading && (
        <div className="pi-loading" role="status" aria-live="polite">
          <div className="pi-spinner" aria-hidden="true" />
          <div className="pi-loading-title">Analyse en cours</div>
          <div className="pi-loading-sub">{plantation ? "Adaptation pour " + plantation.label : "Identification et conseils"}...</div>
        </div>
      )}
      {result && !loading && (
        <div className="pi-result-wrap">
          <div className="pi-reset-row"><button type="button" className="pi-reset-btn" onClick={reset}>← Nouvelle analyse</button></div>
          <PlanteFiche result={result} imagePreview={imagePreview} plantation={plantation} usage={usage} onSave={handleSave} alreadySaved={saved} identificationStatus={identificationStatus} identificationActions={identificationActions} />
          {saveError && <div className="error-box pi-error" style={{marginTop:12}}>⚠️ {saveError}</div>}
        </div>
      )}
    </div>
  );
}

const IDENTIFIER_STYLES = `
  .pi-header { margin-bottom:28px;padding-bottom:22px;border-bottom:1px solid var(--pe-border); }
  .pi-eyebrow { font:var(--pe-text-small);color:var(--pe-accent);text-transform:uppercase;letter-spacing:1.2px;font-weight:700; }
  .pi-title { margin-top:6px;font-family:var(--pe-font-display);font-weight:600;font-size:clamp(26px,3.2vw,40px);color:var(--pe-text);line-height:1.1; }
  .pi-subtitle { margin-top:8px;font:var(--pe-text-body);color:var(--pe-text-muted);max-width:480px; }
  @media (max-width:640px) { .pi-header { padding-bottom:16px;margin-bottom:22px; } }

  .pi-layout { display:grid;grid-template-columns:1.7fr 1fr;gap:20px;align-items:start; }
  @media (max-width:900px) { .pi-layout { grid-template-columns:1fr; } }

  .pi-main-card { padding:24px; }
  @media (max-width:480px) { .pi-main-card { padding:16px; } }

  .pi-dropzone { position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-height:260px;padding:24px;border-radius:var(--pe-radius-md);border:1.5px dashed var(--pe-border-strong);background:var(--pe-ivory);cursor:pointer;text-align:center;transition:border-color .15s,background-color .15s; }
  .pi-dropzone:hover, .pi-dropzone:focus-visible { border-color:var(--pe-accent);background:var(--pe-sand); }
  .pi-dropzone:focus-visible { outline:2px solid var(--pe-accent);outline-offset:2px; }
  .pi-dropzone-icon { color:var(--pe-sage-400);display:flex;margin-bottom:6px; }
  .pi-dropzone-title { font:var(--pe-text-h3);color:var(--pe-text); }
  .pi-dropzone-sub { font:var(--pe-text-small);color:var(--pe-text-muted);font-weight:400; }
  @media (max-width:480px) { .pi-dropzone { min-height:220px;padding:16px; } }

  .pi-dropzone.has-image { display:block;padding:0;overflow:hidden;cursor:default;min-height:0; }
  .pi-preview-img { display:block;width:100%;max-height:440px;object-fit:cover;border-radius:var(--pe-radius-md); }
  .pi-change-btn { position:absolute;top:12px;right:12px;display:inline-flex;align-items:center;gap:6px;padding:8px 16px;min-height:44px;border-radius:999px;border:none;background:var(--pe-surface);color:var(--pe-text);font:var(--pe-text-small);font-weight:600;cursor:pointer;box-shadow:var(--pe-shadow-md); }
  .pi-change-btn:hover { background:var(--pe-sand); }
  .pi-filename { margin-top:8px;padding:0 4px;font:var(--pe-text-small);color:var(--pe-text-muted);font-weight:400;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }

  .pi-divider { display:flex;align-items:center;gap:12px;margin:18px 0;color:var(--pe-text-muted);font:var(--pe-text-small); }
  .pi-divider-line { flex:1;height:1px;background:var(--pe-border); }

  .pi-name-field { margin-bottom:14px; }
  .pi-name-label { display:block;margin-bottom:6px;font:var(--pe-text-small);color:var(--pe-text-muted);font-weight:600; }
  .pi-name-input-wrap { display:flex;align-items:center;gap:10px;padding:0 16px;border-radius:var(--pe-radius-md);border:1px solid var(--pe-border);background:var(--pe-surface);color:var(--pe-text-muted);height:48px; }
  .pi-name-input-wrap:focus-within { border-color:var(--pe-accent); }
  .pi-name-input { flex:1;border:none;outline:none;background:transparent;font:var(--pe-text-body);color:var(--pe-text);height:100%; }
  .pi-name-input::placeholder { color:var(--pe-text-muted); }

  .pi-analyze-btn { width:100%; }
  .pi-error { margin-top:14px; }

  .pi-tips-card { padding:22px;background:var(--pe-sand);border-color:transparent; }
  .pi-tips-head { display:flex;align-items:center;gap:8px;color:var(--pe-accent);font:var(--pe-text-h3);margin-bottom:14px; }
  .pi-tips-list { list-style:none;display:flex;flex-direction:column;gap:10px; }
  .pi-tips-list li { position:relative;padding-left:18px;font:var(--pe-text-small);color:var(--pe-text-muted);font-weight:400;line-height:1.5; }
  .pi-tips-list li::before { content:"";position:absolute;left:0;top:7px;width:6px;height:6px;border-radius:50%;background:var(--pe-accent); }
  @media (max-width:900px) { .pi-tips-card { padding:18px; } }

  .pi-loading { display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:80px 24px;text-align:center; }
  .pi-spinner { width:52px;height:52px;border-radius:50%;border:3px solid var(--pe-sand);border-top-color:var(--pe-accent);animation:pi-spin .85s linear infinite; }
  @media (prefers-reduced-motion: reduce) { .pi-spinner { animation:none; } }
  @keyframes pi-spin { to { transform:rotate(360deg); } }
  .pi-loading-title { font:var(--pe-text-h3);color:var(--pe-text); }
  .pi-loading-sub { font:var(--pe-text-small);color:var(--pe-text-muted);font-weight:400; }

  .pi-result-wrap { max-width:760px;margin:0 auto; }
  .pi-reset-row { padding:0 0 12px; }
  .pi-reset-btn { display:inline-flex;align-items:center;padding:8px 4px;border:none;background:none;color:var(--pe-text-muted);font:var(--pe-text-small);font-weight:600;cursor:pointer;min-height:44px; }
  .pi-reset-btn:hover { color:var(--pe-accent); }
`;

// Local calendar day only — never UTC — same convention duplicated in
// lib/reminderApi.js and components/RemindersOverview.js.
function todayLocalDateString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// zoneNameForPlant(plant, zonesList) -> the plant's zone name, or null when
// unassigned or when the zone it pointed to no longer exists — never a raw
// zoneId, never "undefined".
function zoneNameForPlant(plant, zonesList) {
  if (!plant || !plant.zoneId) return null;
  const zone = (zonesList || []).find((z) => z.id === plant.zoneId);
  return zone ? zone.name : null;
}

// Styles for MonJardinTab's selectedPlant/PlanteFiche detail branch —
// rendered inline here (rather than relying on MonJardinTab's own
// GARDEN_STYLES) since this branch returns before GARDEN_STYLES' own
// <style> tag would ever mount.
const MJ_DETAIL_STYLES = `
  .mj-detail-page { max-width:760px;margin:0 auto; }
  .mj-detail-back { display:inline-flex;align-items:center;padding:8px 4px;margin-bottom:16px;border:none;background:none;color:var(--pe-text-muted);font:var(--pe-text-small);font-weight:600;cursor:pointer;min-height:40px; }
  .mj-detail-back:hover { color:var(--pe-accent); }
  .mj-detail-error { margin-top:16px; }
  .mj-detail-delete-row { margin-top:16px; }
  .mj-detail-delete-btn { display:inline-flex;align-items:center;gap:7px;min-height:44px;padding:10px 16px;border-radius:var(--pe-radius-sm);border:1px solid var(--pe-border);background:var(--pe-surface);color:var(--pe-text-muted);font:var(--pe-text-small);font-weight:600;cursor:pointer; }
  .mj-detail-delete-btn:hover { border-color:var(--pe-terracotta,#8b3a1e);color:var(--pe-terracotta,#8b3a1e); }
`;

function MonJardinTab({ jardin, deletePlant, updateContext, updatePlantZone, loading, migrating, error, reminders, weather, weatherLoading, zones, isAuthenticated, onGoIdentifier }) {
  // selectedId (not the plant object itself) is the only state kept for the
  // open detail view — the plant is always re-derived from the live
  // `jardin` array below, so any update to `jardin` (e.g. a successful
  // updatePlantZone) is reflected immediately without a second, divergent
  // copy of the same plant going stale.
  const [selectedId, setSelectedId] = useState(null);
  const selectedPlant = selectedId ? jardin.find((p) => p.id === selectedId) || null : null;
  const [filterCat, setFilterCat] = useState("Tout");
  const [searchQ, setSearchQ] = useState("");
  const [deleteError, setDeleteError] = useState(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [reminderNotice, setReminderNotice] = useState(null);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [aFaireOpen, setAFaireOpen] = useState(false);
  const [zonesOpen, setZonesOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [zoneFilter, setZoneFilter] = useState("all");

  // A filter pinned to a specific zoneId must never keep restricting the
  // grid once that zone can no longer be selected from the dropdown — e.g.
  // the zone was deleted (it drops out of zones.zones), or the user logged
  // out (zones.zones resets to []). "all"/"unassigned" are always valid and
  // left untouched; only a real, no-longer-existing zoneId gets reset.
  useEffect(() => {
    if (zoneFilter === "all" || zoneFilter === "unassigned") return;
    if (!zones.zones.some((z) => z.id === zoneFilter)) {
      setZoneFilter("all");
    }
  }, [zones.zones, zoneFilter]);

  const handleDelete = async (id) => {
    setDeleteError(null);
    const { error: err } = await deletePlant(id);
    if (err) { setDeleteError(err); return; }
    if (selectedId === id) setSelectedId(null);
  };

  // Delete stays a two-step, in-card confirmation — no window.confirm, no
  // new package. Only one card can be in confirm state at a time; clicking
  // anywhere inside the confirm overlay must never bubble up to the card's
  // own onClick (which would open the fiche or toggle selection).
  const handleRequestDelete = (e, id) => {
    e.stopPropagation();
    setConfirmDeleteId(id);
  };

  const handleCancelDeleteClick = (e) => {
    e.stopPropagation();
    setConfirmDeleteId(null);
  };

  const handleConfirmDeleteClick = async (e, id) => {
    e.stopPropagation();
    await handleDelete(id);
    setConfirmDeleteId(null);
  };

  const moisIdx = new Date().getMonth();
  const moisActuel = MONTHS[moisIdx][0];
  const moisLabel = MONTHS[moisIdx][1];

  const filtered = jardin.filter(p => {
    const nom = (p.data && p.data.identite && p.data.identite.nom_commun || "").toLowerCase();
    const cat = (p.data && p.data.identite && p.data.identite.categorie) || "";
    const matchesZone =
      zoneFilter === "all" || (zoneFilter === "unassigned" ? !p.zoneId : p.zoneId === zoneFilter);
    return (filterCat === "Tout" || cat === filterCat) && (!searchQ || nom.includes(searchQ.toLowerCase())) && matchesZone;
  });

  const toggleSelected = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allVisibleSelected = filtered.length > 0 && filtered.every(p => selectedIds.has(p.id));

  const handleSelectAll = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) filtered.forEach(p => next.delete(p.id));
      else filtered.forEach(p => next.add(p.id));
      return next;
    });
  };

  const handleCancelSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
    setReminderNotice(null);
  };

  // Composes the three existing filter setters — no new state, no new
  // business logic, just a convenience for the "no results" empty state's
  // reset action.
  const handleResetFilters = () => {
    setSearchQ("");
    setFilterCat("Tout");
    setZoneFilter("all");
  };

  const handleOpenReminderModal = () => {
    if (reminders.requiresAuth) {
      setReminderNotice({ type: "error", text: "Connectez-vous pour créer et synchroniser vos rappels sur tous vos appareils." });
      return;
    }
    setReminderNotice(null);
    setShowReminderModal(true);
  };

  const handleSubmitReminders = async (configs) => {
    const result = await reminders.createBulk(Array.from(selectedIds), configs);
    if (!result.error) {
      setShowReminderModal(false);
      setSelectionMode(false);
      setSelectedIds(new Set());
      setReminderNotice({ type: "success", text: "Rappels créés." });
    }
    return result;
  };

  // Recommendation-only, read-only pass: never mutates a reminder, just a
  // per-reminder lookup for RemindersOverview to render. Recomputed fresh
  // from the live reminders/jardin/weather on every render — no separate
  // state, so a reminder that changes status is reflected immediately and
  // never produces a recommendation tied to stale data.
  const today = todayLocalDateString();
  const weatherRecommendationsByReminderId = {};
  if (weather) {
    const wateringReminders = (reminders.reminders || []).filter(
      (r) => r.type === "watering" && r.isActive && (r.status === "pending" || r.status === "snoozed")
    );
    // Built once per render, not once per reminder — a handful of zones,
    // no need for anything more elaborate.
    const zoneById = new Map((zones.zones || []).map((z) => [z.id, z]));
    for (const reminder of wateringReminders) {
      const plant = jardin.find((p) => p.id === reminder.plantId);
      const plantZone = plant && plant.zoneId ? zoneById.get(plant.zoneId) || null : null;
      // weatherEngine only ever reads plantContext.exposure (see
      // lib/weatherEngine.js) — so only that one field is resolved through
      // the single source of truth (lib/effectivePlantContext.js) and
      // handed over, exactly as before except the plant's own null now
      // falls back to its zone's value when there's no explicit override.
      const effectiveExposure = plant ? getEffectivePlantContext(plant.context, plantZone).exposure.value : null;
      weatherRecommendationsByReminderId[reminder.id] = evaluateWateringWeather({
        weather,
        reminder,
        plantContext: { exposure: effectiveExposure },
        today,
      });
    }
  }
  const weatherLocationName = (weather && weather.location && weather.location.name) || null;

  // Same active pending/snoozed filter as lib/reminderGrouping.js's
  // groupRemindersForDashboard, so the summary/Tâches-closed count always
  // matches exactly what RemindersOverview itself would show once opened.
  const activeTasksForSummary = (reminders.reminders || []).filter(
    (r) => r.isActive && (r.status === "pending" || r.status === "snoozed")
  );
  const tasksCount = activeTasksForSummary.length;
  const wateringTasksCount = activeTasksForSummary.filter((r) => r.type === "watering").length;

  // Plants with a real (non "—") AI calendar tip for the current month —
  // computed once here and reused both for the collapsed count and the
  // expanded list, instead of filtering twice.
  const moisTasks = jardin.filter((p) => {
    const tache = p.data && p.data.calendrier && p.data.calendrier[moisActuel];
    return tache && tache !== "—";
  });

  if (selectedPlant) {
    return (
      <div className="mj-detail-page">
        <style>{MJ_DETAIL_STYLES}</style>
        <button type="button" className="mj-detail-back" onClick={() => setSelectedId(null)}>← Mon Jardin</button>
        <PlanteFiche result={selectedPlant.data} imagePreview={selectedPlant.imagePreview} plantation={selectedPlant.plantation} usage={selectedPlant.usage} onSave={() => {}} alreadySaved={true} context={selectedPlant.context} onSaveContext={(ctx) => updateContext(selectedPlant.id, ctx)} identificationStatus={selectedPlant.identificationStatus} zoneId={selectedPlant.zoneId} zones={zones.zones} isAuthenticated={isAuthenticated} onSaveZone={(newZoneId) => updatePlantZone(selectedPlant.id, newZoneId)} />
        {deleteError && <div className="error-box mj-detail-error">⚠️ {deleteError}</div>}
        <div className="mj-detail-delete-row">
          <button type="button" className="mj-detail-delete-btn" onClick={() => handleDelete(selectedPlant.id)}>
            <IconTrash size={15} /> Retirer du jardin
          </button>
        </div>
      </div>
    );
  }

  const hasZones = zones.zones.length > 0;
  const hasActiveFilters = searchQ !== "" || filterCat !== "Tout" || zoneFilter !== "all";
  const activeZoneName = zoneFilter !== "all" && zoneFilter !== "unassigned" ? zoneNameForPlant({ zoneId: zoneFilter }, zones.zones) : null;

  return (
    <div className="mj-page">
      <style>{GARDEN_STYLES}</style>
      {migrating && <div className="context-banner">🔄 Synchronisation de votre jardin avec votre compte...</div>}
      {error && <div className="error-box">⚠️ {error}</div>}
      {deleteError && <div className="error-box">⚠️ {deleteError}</div>}

      <header className="mj-header">
        <div>
          <div className="mj-eyebrow">MON JARDIN</div>
          <h1 className="mj-title">Votre jardin</h1>
          <p className="mj-subtitle">Suivez vos plantes, leurs zones et leur entretien au fil des saisons.</p>
        </div>
        {onGoIdentifier && (
          <Button onClick={onGoIdentifier} className="mj-header-cta">
            <IconCamera size={17} /> Identifier une plante
          </Button>
        )}
      </header>

      {loading && jardin.length === 0 ? (
        <div className="mj-loading">
          <IconSprig size={26} />
          <div className="mj-loading-title">Chargement de votre jardin…</div>
        </div>
      ) : jardin.length === 0 ? (
        <>
          <Card className="mj-empty-card">
            <IconSprig size={28} />
            <div className="mj-empty-title">Votre jardin est vide</div>
            <p className="mj-empty-sub">Identifiez une plante et ajoutez-la à Mon Jardin pour la retrouver ici.</p>
            {onGoIdentifier && (
              <Button variant="secondary" onClick={onGoIdentifier}>
                <IconCamera size={16} /> Identifier une plante
              </Button>
            )}
          </Card>
          {isAuthenticated && (
            <section className="mj-section">
              <button type="button" className="mj-section-toggle" onClick={() => setZonesOpen((v) => !v)}>
                <span className="mj-section-toggle-label"><IconMapPin size={17} /> Zones du jardin</span>
                <span className="mj-section-toggle-action">{zonesOpen ? "Masquer" : "Voir"} <IconChevronRight size={15} /></span>
              </button>
              {zonesOpen && (
                <Card className="mj-section-body">
                  <GardenZonesPanel
                    zones={zones.zones}
                    loading={zones.loading}
                    error={zones.error}
                    createZone={zones.createZone}
                    updateZone={zones.updateZone}
                    deleteZone={zones.deleteZone}
                  />
                </Card>
              )}
            </section>
          )}
        </>
      ) : (
        <>
          <div className="mj-stats-row">
            <Card className="mj-stat-card">
              <span className="mj-stat-icon"><IconSprout size={18} /></span>
              <div className="mj-stat-value">{jardin.length}</div>
              <div className="mj-stat-label">plante{jardin.length > 1 ? "s" : ""}</div>
            </Card>
            <Card className="mj-stat-card">
              <span className="mj-stat-icon"><IconBell size={18} /></span>
              <div className="mj-stat-value">{tasksCount}</div>
              <div className="mj-stat-label">tâche{tasksCount > 1 ? "s" : ""} à venir</div>
            </Card>
            <Card className="mj-stat-card">
              <span className="mj-stat-icon"><IconSun size={18} /></span>
              <div className="mj-stat-value">{wateringTasksCount}</div>
              <div className="mj-stat-label">arrosage{wateringTasksCount > 1 ? "s" : ""}</div>
            </Card>
            {isAuthenticated && (
              <Card className="mj-stat-card">
                <span className="mj-stat-icon"><IconMapPin size={18} /></span>
                <div className="mj-stat-value">{zones.zones.length}</div>
                <div className="mj-stat-label">zone{zones.zones.length > 1 ? "s" : ""}</div>
              </Card>
            )}
          </div>
          {weatherLocationName && (
            <div className="mj-weather-line">
              {weatherLoading ? "Météo…" : <>Météo pour <strong>{weatherLocationName}</strong></>}
            </div>
          )}

          {isAuthenticated && hasZones && (
            <div className="mj-zones-row" role="tablist" aria-label="Filtrer par zone">
              <button
                type="button"
                className={"mj-zone-chip" + (zoneFilter === "all" ? " active" : "")}
                onClick={() => setZoneFilter("all")}
              >
                Toutes les zones
              </button>
              {zones.zones.map((z) => (
                <button
                  key={z.id}
                  type="button"
                  className={"mj-zone-chip" + (zoneFilter === z.id ? " active" : "")}
                  onClick={() => setZoneFilter(z.id)}
                >
                  {z.name}
                </button>
              ))}
              <button
                type="button"
                className={"mj-zone-chip" + (zoneFilter === "unassigned" ? " active" : "")}
                onClick={() => setZoneFilter("unassigned")}
              >
                Sans zone
              </button>
              <button type="button" className="mj-zone-manage-btn" onClick={() => setZonesOpen((v) => !v)}>
                Gérer les zones
              </button>
            </div>
          )}

          {isAuthenticated && zonesOpen && (
            <section className="mj-section">
              <button type="button" className="mj-section-collapse-btn" onClick={() => setZonesOpen(false)}>
                Masquer les zones
              </button>
              <Card className="mj-section-body">
                <GardenZonesPanel
                  zones={zones.zones}
                  loading={zones.loading}
                  error={zones.error}
                  createZone={zones.createZone}
                  updateZone={zones.updateZone}
                  deleteZone={zones.deleteZone}
                />
              </Card>
            </section>
          )}

          <div className="mj-search-row">
            <div className="mj-search-field">
              <IconSearch size={17} />
              <input
                className="mj-search-input"
                placeholder="Rechercher une plante..."
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
              />
              {searchQ && (
                <button type="button" className="mj-search-clear" onClick={() => setSearchQ("")} aria-label="Effacer la recherche">
                  <IconX size={15} />
                </button>
              )}
            </div>
          </div>
          <div className="mj-cats-row">
            {["Tout", ...CATEGORIES].map((c) => (
              <button
                key={c}
                type="button"
                className={"mj-cat-chip" + (filterCat === c ? " active" : "")}
                onClick={() => setFilterCat(c)}
              >
                {c}
              </button>
            ))}
          </div>

          <div className="mj-dash-row">
            <Card className="mj-dash-card" onClick={() => setTasksOpen((v) => !v)}>
              <span className="mj-dash-icon"><IconBell size={19} /></span>
              <div className="mj-dash-text">
                <div className="mj-dash-title">Tâches</div>
                <div className="mj-dash-sub">{tasksCount} à venir</div>
              </div>
              <span className="mj-dash-action">{tasksOpen ? "Masquer" : "Voir"} <IconChevronRight size={15} /></span>
            </Card>
            <Card className="mj-dash-card" onClick={() => setAFaireOpen((v) => !v)}>
              <span className="mj-dash-icon"><IconCalendar size={19} /></span>
              <div className="mj-dash-text">
                <div className="mj-dash-title">À faire en {moisLabel}</div>
                <div className="mj-dash-sub">
                  {moisTasks.length > 0 ? `${moisTasks.length} plante${moisTasks.length > 1 ? "s" : ""}` : "rien de particulier"}
                </div>
              </div>
              <span className="mj-dash-action">{aFaireOpen ? "Masquer" : "Voir"} <IconChevronRight size={15} /></span>
            </Card>
          </div>

          {tasksOpen && (
            <section className="mj-section">
              <Card className="mj-section-body">
                <RemindersOverview
                  reminders={reminders}
                  garden={{ jardin }}
                  actions={{ markDone: reminders.markDone, markSkipped: reminders.markSkipped, snooze: reminders.snooze }}
                  weatherRecommendations={weatherRecommendationsByReminderId}
                  weatherLocationName={weatherLocationName}
                />
              </Card>
            </section>
          )}

          {aFaireOpen && (
            <section className="mj-section">
              <Card className="mj-section-body mj-mois-card">
                {moisTasks.length === 0 ? (
                  <div className="mj-mois-vide">Rien de particulier ce mois-ci.</div>
                ) : (
                  <div className="mj-mois-list">
                    {moisTasks.map((p) => (
                      <div key={p.id} className="mj-mois-item">
                        <span className="mj-mois-plante">{p.data && p.data.identite && p.data.identite.nom_commun}</span>
                        <span className="mj-mois-tache">{p.data.calendrier[moisActuel]}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </section>
          )}

          <div className="mj-select-bar">
            {!selectionMode ? (
              <button type="button" className="mj-select-toggle-btn" onClick={() => setSelectionMode(true)}>
                Sélectionner
              </button>
            ) : (
              <>
                <button type="button" className="mj-select-toggle-btn" onClick={handleSelectAll}>
                  {allVisibleSelected ? "Tout désélectionner" : "Tout sélectionner"}
                </button>
                <span className="mj-select-count">
                  {selectedIds.size} sélectionnée{selectedIds.size > 1 ? "s" : ""}
                </span>
                <button type="button" className="mj-select-toggle-btn" onClick={handleCancelSelection}>Annuler</button>
                {selectedIds.size > 0 && (
                  <Button onClick={handleOpenReminderModal} className="mj-select-reminder-btn">
                    <IconBell size={16} /> Créer des rappels
                  </Button>
                )}
              </>
            )}
          </div>
          {reminderNotice && (
            <div className={reminderNotice.type === "success" ? "auth-success-box" : "error-box"}>{reminderNotice.text}</div>
          )}
          {showReminderModal && (
            <ReminderBulkModal
              plantCount={selectedIds.size}
              onClose={() => setShowReminderModal(false)}
              onSubmit={handleSubmitReminders}
            />
          )}

          {filtered.length === 0 ? (
            <Card className="mj-empty-card">
              <IconSprig size={26} />
              <div className="mj-empty-title">Aucune plante ne correspond</div>
              <p className="mj-empty-sub">
                {activeZoneName
                  ? <>Aucun résultat pour la zone « {activeZoneName} » avec ces filtres.</>
                  : "Essayez une autre recherche ou réinitialisez les filtres."}
              </p>
              {hasActiveFilters && (
                <Button variant="secondary" onClick={handleResetFilters}>Réinitialiser les filtres</Button>
              )}
            </Card>
          ) : (
            <div className="mj-grid">
              {filtered.map((p) => {
                const nom = p.data && p.data.identite && p.data.identite.nom_commun;
                const nomLatin = p.data && p.data.identite && p.data.identite.nom_latin;
                const categorie = p.data && p.data.identite && p.data.identite.categorie;
                const zoneName = zoneNameForPlant(p, zones.zones);
                return (
                  <div
                    key={p.id}
                    className={"mj-card" + (selectionMode && selectedIds.has(p.id) ? " mj-card-selected" : "")}
                    onClick={() => (selectionMode ? toggleSelected(p.id) : setSelectedId(p.id))}
                  >
                    {selectionMode && (
                      <input
                        type="checkbox"
                        className="mj-card-checkbox"
                        checked={selectedIds.has(p.id)}
                        onChange={() => toggleSelected(p.id)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={nom ? `Sélectionner ${nom}` : "Sélectionner cette plante"}
                      />
                    )}
                    <div className="mj-card-photo">
                      {p.imagePreview ? (
                        <img src={p.imagePreview} alt="" />
                      ) : (
                        <IconSprig size={30} />
                      )}
                    </div>
                    <div className="mj-card-body">
                      {nom && <div className="mj-card-name">{nom}</div>}
                      {nomLatin && <div className="mj-card-latin">{nomLatin}</div>}
                      <div className="mj-card-meta">
                        {categorie && <span className="mj-card-tag">{categorie}</span>}
                        {zoneName && <span className="mj-card-tag mj-card-tag-zone"><IconMapPin size={12} /> {zoneName}</span>}
                      </div>
                    </div>
                    {!selectionMode && <span className="mj-card-chevron" aria-hidden="true"><IconChevronRight size={18} /></span>}
                    {!selectionMode && (
                      confirmDeleteId === p.id ? (
                        <div className="mj-delete-confirm" onClick={(e) => e.stopPropagation()}>
                          <span className="mj-delete-confirm-text">Supprimer cette plante ?</span>
                          <div className="mj-delete-confirm-actions">
                            <button type="button" className="mj-delete-confirm-yes" onClick={(e) => handleConfirmDeleteClick(e, p.id)}>Supprimer</button>
                            <button type="button" className="mj-delete-confirm-no" onClick={handleCancelDeleteClick}>Annuler</button>
                          </div>
                        </div>
                      ) : (
                        <button type="button" className="mj-card-delete" onClick={(e) => handleRequestDelete(e, p.id)} aria-label="Supprimer cette plante">
                          <IconTrash size={15} />
                        </button>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div className="mj-count">{jardin.length} plante{jardin.length > 1 ? "s" : ""} dans votre jardin</div>
        </>
      )}
    </div>
  );
}

const GARDEN_STYLES = `
  .mj-page { max-width:100%; }
  .mj-header { display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin-bottom:28px;padding-bottom:22px;border-bottom:1px solid var(--pe-border); }
  .mj-eyebrow { font:var(--pe-text-small);color:var(--pe-accent);text-transform:uppercase;letter-spacing:1.2px;font-weight:700; }
  .mj-title { margin-top:6px;font-family:var(--pe-font-display);font-weight:600;font-size:clamp(26px,3.2vw,40px);color:var(--pe-text);line-height:1.1; }
  .mj-subtitle { margin-top:8px;font:var(--pe-text-body);color:var(--pe-text-muted);max-width:480px; }
  .mj-header-cta { flex-shrink:0;display:inline-flex;align-items:center;gap:8px;white-space:nowrap; }
  @media (max-width:640px) { .mj-header { flex-direction:column;align-items:stretch;gap:14px;padding-bottom:16px;margin-bottom:22px; } .mj-header-cta { align-self:flex-start; } }

  .mj-loading, .mj-empty-card { padding:40px 24px;display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center;color:var(--pe-text-muted);font:var(--pe-text-body); }
  .mj-loading svg, .mj-empty-card svg { color:var(--pe-sage-400); }
  .mj-empty-title { font:var(--pe-text-h3);color:var(--pe-text); }
  .mj-empty-sub { max-width:360px; }
  .mj-loading-title { font:var(--pe-text-h3);color:var(--pe-text); }

  .mj-stats-row { display:flex;gap:14px;margin-bottom:16px;overflow-x:auto;padding-bottom:2px; }
  .mj-stat-card { flex:1;min-width:110px;padding:16px 18px;display:flex;flex-direction:column;gap:4px; }
  .mj-stat-icon { color:var(--pe-accent);display:flex;margin-bottom:4px; }
  .mj-stat-value { font-family:var(--pe-font-display);font-size:26px;font-weight:600;color:var(--pe-text);line-height:1.1; }
  .mj-stat-label { font:var(--pe-text-small);color:var(--pe-text-muted);font-weight:400; }
  @media (max-width:640px) { .mj-stats-row { display:grid;grid-template-columns:repeat(2,1fr);overflow-x:visible; } .mj-stat-card { min-width:0; } }

  .mj-weather-line { font:var(--pe-text-small);color:var(--pe-text-muted);margin-bottom:20px; }
  .mj-weather-line strong { color:var(--pe-text);font-weight:600; }

  .mj-zones-row { display:flex;flex-wrap:nowrap;gap:8px;overflow-x:auto;margin-bottom:18px;padding-bottom:2px; }
  .mj-zone-chip { flex-shrink:0;padding:9px 16px;border-radius:999px;border:1px solid var(--pe-border);background:var(--pe-surface);color:var(--pe-text);font:var(--pe-text-small);font-weight:600;cursor:pointer;transition:background .15s,color .15s,border-color .15s;min-height:38px; }
  .mj-zone-chip:hover { border-color:var(--pe-border-strong); }
  .mj-zone-chip.active { background:var(--pe-accent);border-color:var(--pe-accent);color:var(--pe-on-accent); }
  .mj-zone-manage-btn { flex-shrink:0;padding:9px 14px;border-radius:999px;border:1px dashed var(--pe-border-strong);background:transparent;color:var(--pe-text-muted);font:var(--pe-text-small);font-weight:600;cursor:pointer;min-height:38px; }
  .mj-zone-manage-btn:hover { color:var(--pe-text);border-color:var(--pe-accent); }

  .mj-section { margin-bottom:18px; }
  .mj-section-toggle { width:100%;display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-radius:var(--pe-radius-md);border:1px solid var(--pe-border);background:var(--pe-surface);cursor:pointer;font:var(--pe-text-body);color:var(--pe-text);min-height:44px; }
  .mj-section-toggle-label { display:flex;align-items:center;gap:8px;font-weight:600; }
  .mj-section-toggle-action { display:flex;align-items:center;gap:2px;color:var(--pe-accent);font:var(--pe-text-small);font-weight:600; }
  .mj-section-collapse-btn { margin-bottom:8px;padding:8px 4px;border:none;background:none;color:var(--pe-text-muted);font:var(--pe-text-small);font-weight:600;cursor:pointer; }
  .mj-section-collapse-btn:hover { color:var(--pe-text); }
  .mj-section-body { padding:20px; }

  .mj-search-row { margin-bottom:12px; }
  .mj-search-field { display:flex;align-items:center;gap:10px;padding:0 16px;border-radius:var(--pe-radius-md);border:1px solid var(--pe-border);background:var(--pe-surface);color:var(--pe-text-muted);height:48px; }
  .mj-search-field:focus-within { border-color:var(--pe-accent); }
  .mj-search-input { flex:1;border:none;outline:none;background:transparent;font:var(--pe-text-body);color:var(--pe-text);height:100%; }
  .mj-search-input::placeholder { color:var(--pe-text-muted); }
  .mj-search-clear { display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;border:none;background:var(--pe-sand);color:var(--pe-text-muted);cursor:pointer;flex-shrink:0; }
  .mj-search-clear:hover { color:var(--pe-text); }

  .mj-cats-row { display:flex;gap:8px;overflow-x:auto;margin-bottom:22px;padding-bottom:2px; }
  .mj-cat-chip { flex-shrink:0;padding:8px 15px;border-radius:999px;border:1px solid var(--pe-border);background:var(--pe-surface);color:var(--pe-text-muted);font:var(--pe-text-small);font-weight:600;cursor:pointer;min-height:38px; white-space:nowrap; }
  .mj-cat-chip:hover { border-color:var(--pe-border-strong);color:var(--pe-text); }
  .mj-cat-chip.active { background:var(--pe-accent);border-color:var(--pe-accent);color:var(--pe-on-accent); }

  .mj-dash-row { display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:8px; }
  @media (max-width:640px) { .mj-dash-row { grid-template-columns:1fr; } }
  .mj-dash-card { padding:16px 18px;display:flex;align-items:center;gap:14px;text-align:left; }
  .mj-dash-icon { flex-shrink:0;width:38px;height:38px;border-radius:50%;background:var(--pe-sand);color:var(--pe-accent);display:flex;align-items:center;justify-content:center; }
  .mj-dash-text { flex:1;min-width:0; }
  .mj-dash-title { font:var(--pe-text-h3);color:var(--pe-text); }
  .mj-dash-sub { margin-top:2px;font:var(--pe-text-small);color:var(--pe-text-muted);font-weight:400; }
  .mj-dash-action { flex-shrink:0;display:flex;align-items:center;gap:2px;font:var(--pe-text-small);font-weight:600;color:var(--pe-accent);white-space:nowrap; }

  .mj-mois-card { display:block; }
  .mj-mois-vide { color:var(--pe-text-muted);font:var(--pe-text-body); }
  .mj-mois-list { display:flex;flex-direction:column;gap:10px; }
  .mj-mois-item { display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding-bottom:10px;border-bottom:1px solid var(--pe-border); }
  .mj-mois-item:last-child { border-bottom:none;padding-bottom:0; }
  .mj-mois-plante { font:var(--pe-text-small);font-weight:700;color:var(--pe-text); }
  .mj-mois-tache { font:var(--pe-text-small);color:var(--pe-text-muted);font-weight:400;text-align:right; }

  .mj-select-bar { display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px;min-height:44px; }
  .mj-select-toggle-btn { padding:9px 16px;border-radius:999px;border:1px solid var(--pe-border);background:var(--pe-surface);color:var(--pe-text);font:var(--pe-text-small);font-weight:600;cursor:pointer;min-height:40px; }
  .mj-select-toggle-btn:hover { border-color:var(--pe-border-strong); }
  .mj-select-count { font:var(--pe-text-small);color:var(--pe-text-muted); }
  .mj-select-reminder-btn { display:inline-flex;align-items:center;gap:8px; }

  .mj-grid { display:grid;grid-template-columns:repeat(3,1fr);gap:16px; }
  @media (max-width:1080px) { .mj-grid { grid-template-columns:repeat(2,1fr); } }
  @media (max-width:640px) { .mj-grid { grid-template-columns:1fr; } }

  .mj-card { position:relative;display:flex;gap:14px;align-items:center;padding:14px;border-radius:var(--pe-radius-md);border:1px solid var(--pe-border);background:var(--pe-surface);box-shadow:var(--pe-shadow-sm);cursor:pointer;transition:box-shadow .15s,border-color .15s; }
  .mj-card:hover { box-shadow:var(--pe-shadow-md);border-color:var(--pe-border-strong); }
  .mj-card-selected { border-color:var(--pe-accent);background:var(--pe-sand); }
  .mj-card-checkbox { flex-shrink:0;width:20px;height:20px;accent-color:var(--pe-accent);cursor:pointer; }
  .mj-card-photo { flex-shrink:0;width:72px;height:72px;border-radius:var(--pe-radius-sm);background:var(--pe-sand);display:flex;align-items:center;justify-content:center;color:var(--pe-sage-400);overflow:hidden; }
  .mj-card-photo img { width:100%;height:100%;object-fit:cover;display:block; }
  .mj-card-body { flex:1;min-width:0; }
  .mj-card-name { font:var(--pe-text-h3);color:var(--pe-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
  .mj-card-latin { margin-top:2px;font-style:italic;font-size:13px;color:var(--pe-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
  .mj-card-meta { margin-top:8px;display:flex;flex-wrap:wrap;gap:6px; }
  .mj-card-tag { display:inline-flex;align-items:center;gap:3px;padding:3px 9px;border-radius:999px;background:var(--pe-sand);color:var(--pe-text-muted);font-size:11.5px;font-weight:600; }
  .mj-card-tag-zone { color:var(--pe-accent); }
  .mj-card-chevron { flex-shrink:0;color:var(--pe-text-muted); }
  .mj-card-delete { position:absolute;top:10px;right:10px;width:30px;height:30px;border-radius:50%;border:none;background:var(--pe-surface);color:var(--pe-text-muted);display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:var(--pe-shadow-sm);opacity:0;transition:opacity .15s; }
  .mj-card:hover .mj-card-delete, .mj-card:focus-within .mj-card-delete { opacity:1; }
  .mj-card-delete:hover { color:var(--pe-terracotta); }
  @media (max-width:640px) { .mj-card-delete { opacity:1; } }

  .mj-delete-confirm { position:absolute;inset:0;border-radius:var(--pe-radius-md);background:var(--pe-surface);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:12px;text-align:center;box-shadow:var(--pe-shadow-md); }
  .mj-delete-confirm-text { font:var(--pe-text-small);color:var(--pe-text);font-weight:600; }
  .mj-delete-confirm-actions { display:flex;gap:8px; }
  .mj-delete-confirm-yes { padding:7px 14px;border-radius:999px;border:none;background:var(--pe-terracotta);color:var(--pe-white);font:var(--pe-text-small);font-weight:700;cursor:pointer;min-height:36px; }
  .mj-delete-confirm-no { padding:7px 14px;border-radius:999px;border:1px solid var(--pe-border);background:var(--pe-surface);color:var(--pe-text);font:var(--pe-text-small);font-weight:600;cursor:pointer;min-height:36px; }

  .mj-count { margin-top:20px;text-align:center;font:var(--pe-text-small);color:var(--pe-text-muted); }

  @media (max-width:480px) {
    .mj-stat-card { padding:14px; }
    .mj-search-field { height:46px; }
    .mj-cat-chip, .mj-zone-chip { padding:8px 13px; }
  }
`;

// One bounded retry each for the profile and weather loads — never a
// polling loop, never unbounded: each is a plain for-loop capped at
// MAX_ATTEMPTS, so a normal first-try success always makes exactly one
// call and a failing one makes at most two, then stops for good.
const RETRY_DELAY_MS = 1000;
const PROFILE_MAX_ATTEMPTS = 2;
const WEATHER_MAX_ATTEMPTS = 2;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function AccountBar({ auth, onLogin }) {
  if (auth.loading) return null;
  return (
    <div className="pe-account-bar">
      {auth.user ? (
        <>
          <span className="pe-account-email">{auth.user.email}</span>
          <a className="pe-account-action" href="/profile">Mon profil</a>
          <button className="pe-account-action" onClick={() => auth.signOut()}>Se déconnecter</button>
        </>
      ) : (
        <button className="pe-account-action" onClick={onLogin}>Se connecter</button>
      )}
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [activeNav, setActiveNav] = useState("accueil");
  const [navInitialized, setNavInitialized] = useState(false);
  const auth = useAuth();
  const garden = useGarden(auth.user, auth.loading, PLANTATION_TYPES, USAGE_TYPES);
  const reminders = useReminders(auth.user, auth.loading);
  const gardenZones = useGardenZones(auth.user, auth.loading);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalMode, setAuthModalMode] = useState("login");
  const openAuthModal = (mode) => {
    setAuthModalMode(mode);
    setShowAuthModal(true);
  };

  // URL -> tab: the initial load, a browser back/forward navigation, or an
  // external link landing here with ?tab=... (Plant Finder's "Identifier"/
  // "Mon jardin" nav links) must always show the right tab. "/" used to be
  // pure local state with no such mechanism at all — clicking those links
  // from Plant Finder silently landed back on Accueil, which is the bug
  // this effect (together with the one below) fixes.
  useEffect(() => {
    if (!router.isReady) return;
    setActiveNav(tabFromQuery(router.query));
    setNavInitialized(true);
  }, [router.isReady, router.query.tab]);

  // tab -> URL: keep the address bar in sync whenever the tab changes
  // locally (a sidebar/bottom-nav click, "onGoIdentifier", etc.), so the
  // current tab is shareable, refresh-safe, and back/forward-navigable.
  // Guarded by navInitialized so this never fires before the effect above
  // has done its first URL->state pass, and only replaces when the URL
  // isn't already showing this tab — together, that's what keeps this from
  // ever looping with the effect above.
  useEffect(() => {
    if (!navInitialized) return;
    if (tabFromQuery(router.query) === activeNav) return;
    const query = tabToQuery(activeNav);
    router.replace({ pathname: "/", query }, undefined, { shallow: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNav, navInitialized]);

  // The DB's own ON DELETE SET NULL (zone_id) already guarantees every
  // plant that pointed at this zone now has zone_id = NULL server-side once
  // deleteZone has resolved without error — so the local sync below is not
  // a guess, only a reflection of an already-committed fact, applied
  // locally to avoid a full garden refetch after every zone deletion.
  const handleDeleteZone = async (zoneId) => {
    const result = await gardenZones.deleteZone(zoneId);
    if (!result.error) {
      garden.clearPlantsZoneLocally(zoneId);
    }
    return result;
  };

  // auth.user is a fresh object reference on every Supabase auth event
  // (including redundant ones like the INITIAL_SESSION event that always
  // fires right after subscribing, on top of getSession()'s own
  // resolution) even when it's the same logged-in user. Depending on this
  // scalar id instead of the object itself means the effect below only
  // re-runs when the user actually changes.
  const userId = auth.user?.id || null;

  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState(null);

  useEffect(() => {
    if (auth.loading) return;

    if (!userId) {
      setProfile(null);
      setProfileLoading(false);
      setProfileError(null);
      return;
    }

    let cancelled = false;
    setProfileLoading(true);
    setProfileError(null);

    // A profile load failure must never break Mon Jardin — it only means
    // weather/localisation stays unavailable this session. One retry after
    // a short delay covers a transient blip (e.g. a cold start) without
    // ever polling: this loop always runs at most PROFILE_MAX_ATTEMPTS
    // times, and `cancelled` is checked before every state update and
    // before every retry attempt, so a logout/user change/unmount that
    // happens mid-retry is never applied.
    (async () => {
      for (let attempt = 0; attempt < PROFILE_MAX_ATTEMPTS; attempt++) {
        if (attempt > 0) {
          await wait(RETRY_DELAY_MS);
          if (cancelled) return;
        }
        try {
          const data = await fetchProfile(userId);
          if (cancelled) return;
          setProfile(data);
          setProfileLoading(false);
          return;
        } catch {
          if (cancelled) return;
        }
      }
      if (cancelled) return;
      setProfileError("Impossible de charger le profil.");
      setProfileLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [auth.loading, userId]);

  const [weather, setWeather] = useState(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState(null);
  // In-memory only, never persisted: dedupes an identical weather request
  // that's already in flight, and skips refetching a location that's
  // already loaded successfully. A failed request is never recorded here,
  // so the same location can always be retried later.
  const weatherInFlightKeyRef = useRef(null);
  const lastSuccessfulWeatherKeyRef = useRef(null);

  // fetchProfile always returns a freshly-deserialized object, so `profile`
  // gets a new reference on every load even when the row's content is
  // identical. Deriving a scalar key from the actual values that matter
  // (who + where) means the effect only re-runs when one of them really
  // changes.
  const rawCity = (profile && profile.city) || "";
  const rawRegion = (profile && profile.region) || "";
  const rawCountry = (profile && profile.country) || "";
  const normalizedCity = rawCity.trim().toLowerCase();
  const weatherRequestKey =
    userId && normalizedCity
      ? `${userId}|${normalizedCity}|${rawRegion.trim().toLowerCase()}|${rawCountry.trim().toLowerCase()}`
      : null;

  useEffect(() => {
    if (auth.loading || profileLoading) return;

    if (!weatherRequestKey) {
      // Logout, or a profile with no city: reset state AND forget any
      // past in-flight/success marker so a future legitimate fetch for
      // this same key (e.g. logging back in as the same user) isn't
      // silently skipped as "already loaded".
      weatherInFlightKeyRef.current = null;
      lastSuccessfulWeatherKeyRef.current = null;
      setWeather(null);
      setWeatherLoading(false);
      setWeatherError(null);
      return;
    }

    if (weatherInFlightKeyRef.current === weatherRequestKey) return;
    if (lastSuccessfulWeatherKeyRef.current === weatherRequestKey) return;

    weatherInFlightKeyRef.current = weatherRequestKey;

    let cancelled = false;
    setWeatherLoading(true);
    setWeatherError(null);

    // Same bounded-retry shape as the profile load: at most
    // WEATHER_MAX_ATTEMPTS calls for this key, `cancelled` gates every
    // state update and every retry attempt (a key/location change runs
    // this effect's cleanup synchronously before the next run starts, so a
    // stale retry can never apply its result — see the race trace already
    // validated for the single-attempt version of this effect). A failed
    // attempt is never recorded in lastSuccessfulWeatherKeyRef, so this
    // location can always be retried later by a fresh effect run.
    (async () => {
      let lastErrorMessage = null;
      for (let attempt = 0; attempt < WEATHER_MAX_ATTEMPTS; attempt++) {
        if (attempt > 0) {
          await wait(RETRY_DELAY_MS);
          if (cancelled) return;
        }
        let result;
        try {
          result = await fetchWeatherForProfile({ city: rawCity, region: rawRegion, country: rawCountry });
        } catch {
          result = { data: null, error: "Impossible de récupérer la météo pour le moment." };
        }
        if (cancelled) return;
        if (!result.error) {
          setWeather(result.data);
          setWeatherError(null);
          lastSuccessfulWeatherKeyRef.current = weatherRequestKey;
          if (weatherInFlightKeyRef.current === weatherRequestKey) {
            weatherInFlightKeyRef.current = null;
          }
          setWeatherLoading(false);
          return;
        }
        lastErrorMessage = result.error;
      }
      if (cancelled) return;
      setWeather(null);
      setWeatherError(lastErrorMessage);
      // Only clear if this is still the request that set it — a newer
      // request for a different key may already be in flight.
      if (weatherInFlightKeyRef.current === weatherRequestKey) {
        weatherInFlightKeyRef.current = null;
      }
      setWeatherLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [auth.loading, profileLoading, weatherRequestKey]);

  const navItems = [
    { key: "accueil", label: "Accueil", icon: IconHome, kind: "tab", placement: "main", onClick: () => setActiveNav("accueil") },
    { key: "identifier", label: "Identifier", icon: IconCamera, kind: "tab", placement: "main", emphasis: true, onClick: () => setActiveNav("identifier") },
    { key: "jardin", label: "Mon jardin", icon: IconSprout, kind: "tab", placement: "main", onClick: () => setActiveNav("jardin"), badge: garden.jardin.length > 0 ? garden.jardin.length : null },
    { key: "trouver", label: "Trouver", icon: IconSearch, kind: "link", href: "/plant-finder", placement: "main" },
    { key: "profil", label: "Profil", icon: IconUser, kind: "link", href: "/profile", placement: "bottom" },
  ];

  return (
    <AppShell navItems={navItems} activeKey={activeNav} topBar={<AccountBar auth={auth} onLogin={() => openAuthModal("login")} />}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=Outfit:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root { --ink:#0f1f0f;--forest:#1e3a1e;--moss:#3a6b3a;--sage:#7aad7a;--mist:#e8f0e8;--paper:#f4f2ed;--cream:#faf8f3;--gold:#c4962a;--rust:#8b3a1e;--r:14px;--shadow:0 4px 20px rgba(15,31,15,0.1); }
        body { font-family:'Outfit',sans-serif;background:var(--paper);color:var(--ink); }
        .tab-page { padding:16px 16px 20px;max-width:680px;margin:0 auto; }
        .modal-overlay { position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:200;display:flex;align-items:flex-end; }
        .modal { background:white;border-radius:20px 20px 0 0;padding:28px 20px 36px;width:100%;max-height:85vh;overflow-y:auto; }
        .modal-title { font-family:'Cormorant Garamond',serif;font-size:22px;color:var(--forest);font-weight:700;margin-bottom:4px; }
        .modal-sub { color:#999;font-size:13px;margin-bottom:20px; }
        .plantation-grid { display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:20px; }
        .plantation-btn { display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 10px;border:2px solid rgba(0,0,0,0.1);border-radius:12px;background:var(--cream);cursor:pointer;font-family:'Outfit',sans-serif;transition:all 0.15s; }
        .plantation-btn.active { border-color:var(--moss);background:var(--mist); }
        .plantation-icon { font-size:28px; }
        .plantation-label { font-size:12px;font-weight:500;color:var(--ink);text-align:center;line-height:1.3; }
        .modal-actions { display:flex;flex-direction:column;gap:8px; }
        .btn-modal-confirm { background:var(--forest);color:white;border:none;border-radius:12px;padding:14px;font-family:'Outfit',sans-serif;font-size:15px;font-weight:600;cursor:pointer; }
        .btn-modal-confirm:disabled { opacity:0.4;cursor:not-allowed; }
        .btn-modal-skip { background:none;border:1px solid rgba(0,0,0,0.12);border-radius:12px;padding:12px;font-family:'Outfit',sans-serif;font-size:14px;color:#888;cursor:pointer; }
        .modal-step { font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--sage);font-weight:600;margin-bottom:6px; }
        .input-panel { background:white;border-radius:var(--r);overflow:hidden;box-shadow:var(--shadow); }
        .drop-zone { border:2px dashed rgba(58,107,58,0.25);border-radius:10px;margin:16px;padding:28px 16px;text-align:center;cursor:pointer;background:var(--mist);position:relative;overflow:hidden; }
        .drop-zone.has-image { padding:0;border-style:solid; }
        .drop-preview { width:100%;height:200px;object-fit:cover;display:block;border-radius:8px; }
        .drop-overlay { position:absolute;inset:0;background:rgba(15,31,15,0.5);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 0.2s;border-radius:8px; }
        .drop-zone:hover .drop-overlay { opacity:1; }
        .drop-overlay span { color:white;font-size:13px;font-weight:500; }
        .drop-icon { font-size:36px;display:block;margin-bottom:8px; }
        .drop-title { font-family:'Cormorant Garamond',serif;font-size:17px;color:var(--forest);font-weight:600; }
        .drop-sub { font-size:12px;color:#999;margin-top:3px; }
        .divider { display:flex;align-items:center;gap:10px;padding:0 16px; }
        .divider-line { flex:1;height:1px;background:rgba(0,0,0,0.07); }
        .divider-text { font-size:11px;color:#bbb;text-transform:uppercase;letter-spacing:1px; }
        .name-row { display:flex;gap:8px;padding:12px 16px 16px; }
        .plant-input { flex:1;border:1.5px solid rgba(0,0,0,0.12);border-radius:10px;padding:11px 14px;font-family:'Outfit',sans-serif;font-size:15px;outline:none;background:var(--cream); }
        .plant-input:focus { border-color:var(--moss); }
        .btn-analyze { background:var(--forest);color:white;border:none;border-radius:10px;padding:11px 18px;font-family:'Outfit',sans-serif;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap; }
        .error-box { background:#fff5f5;border:1px solid rgba(139,58,30,0.2);border-radius:8px;padding:12px 14px;color:var(--rust);font-size:14px;margin:0 16px 16px; }
        .loading-state { text-align:center;padding:60px 20px; }
        .leaf-spin { font-size:48px;display:inline-block;animation:spin 2s linear infinite;margin-bottom:14px; }
        @keyframes spin { from{transform:rotate(0deg)}to{transform:rotate(360deg)} }
        .loading-title { font-family:'Cormorant Garamond',serif;font-size:22px;color:var(--forest); }
        .loading-sub { color:#888;font-size:14px;margin-top:4px; }
        .result-panel { animation:fadeIn 0.4s ease; }
        @keyframes fadeIn { from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)} }
        .reset-row { display:flex;justify-content:flex-end;margin-bottom:12px; }
        .btn-reset { background:none;border:1px solid rgba(0,0,0,0.12);border-radius:8px;padding:6px 12px;font-family:'Outfit',sans-serif;font-size:13px;cursor:pointer;color:#888; }
        .plant-hero { background:var(--forest);border-radius:var(--r);overflow:hidden;box-shadow:0 8px 32px rgba(15,31,15,0.2); }
        .hero-content { padding:20px 18px 0;display:flex;gap:14px;align-items:flex-start; }
        .hero-img-wrap { width:84px;height:84px;border-radius:10px;overflow:hidden;flex-shrink:0;border:2px solid rgba(255,255,255,0.2); }
        .hero-img { width:100%;height:100%;object-fit:cover; }
        .hero-no-img { width:84px;height:84px;border-radius:10px;background:rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;font-size:38px;flex-shrink:0; }
        .hero-text { flex:1; }
        .confidence-badge { display:inline-block;padding:3px 8px;border-radius:20px;font-size:10px;font-weight:600;margin-bottom:5px; }
        .conf-élevée { background:rgba(122,173,122,0.25);color:var(--sage); }
        .conf-moyenne { background:rgba(196,150,42,0.2);color:#f0d890; }
        .conf-faible { background:rgba(139,58,30,0.2);color:#e8a080; }
        .hero-name { font-family:'Cormorant Garamond',serif;font-size:24px;font-weight:700;color:white;line-height:1.1; }
        .hero-latin { font-style:italic;color:rgba(255,255,255,0.5);font-size:12px;margin-top:2px; }
        .hero-family { color:rgba(255,255,255,0.3);font-size:10px;margin-top:2px;text-transform:uppercase;letter-spacing:0.8px; }
        .plantation-tag { display:inline-block;background:rgba(122,173,122,0.2);color:var(--sage);border-radius:20px;padding:3px 10px;font-size:11px;font-weight:500;margin-top:6px; }
        .hero-desc { color:rgba(255,255,255,0.65);font-size:13px;line-height:1.6;padding:12px 18px;font-weight:300; }
        .hero-save { padding:0 18px 12px; }
        .btn-save { background:var(--sage);color:var(--forest);border:none;border-radius:8px;padding:9px 18px;font-family:'Outfit',sans-serif;font-size:13px;font-weight:600;cursor:pointer; }
        .saved-badge { color:var(--sage);font-size:13px;font-weight:500; }
        .tabs-wrap { padding:0 18px;border-top:1px solid rgba(255,255,255,0.08); }
        .tabs { display:flex;overflow-x:auto;scrollbar-width:none; }
        .tabs::-webkit-scrollbar { display:none; }
        .tab { display:flex;flex-direction:column;align-items:center;gap:3px;padding:11px 12px 9px;color:rgba(255,255,255,0.4);cursor:pointer;border-bottom:2px solid transparent;transition:all 0.2s;white-space:nowrap;font-size:11px;font-weight:500;background:none;border-left:none;border-right:none;border-top:none;font-family:'Outfit',sans-serif; }
        .tab-icon { font-size:15px; }
        .tab.active { color:var(--sage);border-bottom-color:var(--sage); }
        .tab-content { background:white;border-radius:var(--r);margin-top:12px;padding:18px;box-shadow:var(--shadow); }
        .section-title { font-family:'Cormorant Garamond',serif;font-size:20px;color:var(--forest);margin-bottom:14px;font-weight:700; }
        .context-banner { background:var(--mist);border-radius:8px;padding:8px 12px;font-size:12px;color:var(--moss);font-weight:500;margin-bottom:14px; }
        .subsection { margin-top:14px; }
        .subsection-title { font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;color:var(--sage);margin-bottom:7px; }
        .tag-list { display:flex;flex-direction:column;gap:5px; }
        .tag { display:flex;align-items:flex-start;gap:8px;padding:8px 11px;border-radius:8px;font-size:13px;line-height:1.5; }
        .tag-dot { width:6px;height:6px;border-radius:50%;flex-shrink:0;margin-top:4px; }
        .tag-green { background:#f0f7f0;color:#2d5a2d; } .tag-green .tag-dot { background:var(--moss); }
        .tag-red { background:#fff5f3;color:#6b1e1e; } .tag-red .tag-dot { background:var(--rust); }
        .tag-gold { background:#fffbf0;color:#6b4f1e; } .tag-gold .tag-dot { background:var(--gold); }
        .highlight-box { background:var(--mist);border-left:3px solid var(--moss);border-radius:0 8px 8px 0;padding:11px 13px;margin:12px 0;font-size:13px;color:var(--forest);line-height:1.6; }
        .highlight-label { font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--sage);font-weight:600;margin-bottom:3px; }
        .info-grid { display:grid;grid-template-columns:1fr 1fr;gap:8px; }
        .info-card { background:var(--cream);border-radius:10px;padding:11px;display:flex;align-items:flex-start;gap:8px; }
        .info-icon { font-size:18px;flex-shrink:0; }
        .info-label { font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:#999;font-weight:600;margin-bottom:2px; }
        .info-value { font-size:12px;color:var(--ink);font-weight:500;line-height:1.4; }
        .empty-text { color:#bbb;font-size:13px;font-style:italic; }
        .cal-grid { display:grid;grid-template-columns:repeat(3,1fr);gap:6px; }
        .cal-cell { background:var(--cream);border-radius:8px;padding:8px 6px;text-align:center; }
        .cal-cell-active { background:var(--mist);border:1.5px solid var(--sage); }
        .cal-month { font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--sage);margin-bottom:3px; }
        .cal-text { font-size:11px;color:var(--ink);line-height:1.3; }
        .empty-jardin { text-align:center;padding:80px 20px; }
        .empty-icon { font-size:56px;margin-bottom:14px; }
        .empty-title { font-family:'Cormorant Garamond',serif;font-size:22px;color:var(--forest);margin-bottom:6px; }
        .empty-sub { color:#999;font-size:14px; }
        .mois-card { background:var(--forest);border-radius:var(--r);padding:16px 18px;margin-bottom:16px;box-shadow:var(--shadow); }
        .mois-title { font-family:'Cormorant Garamond',serif;font-size:18px;color:white;font-weight:700;margin-bottom:12px; }
        .mois-item { display:flex;flex-direction:column;gap:2px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.08); }
        .mois-item:last-child { border-bottom:none; }
        .mois-plante { font-size:13px;font-weight:600;color:var(--sage); }
        .mois-tache { font-size:13px;color:rgba(255,255,255,0.7); }
        .mois-vide { color:rgba(255,255,255,0.4);font-size:13px;font-style:italic; }
        .mois-title-row { display:flex;align-items:center;justify-content:space-between;margin-bottom:12px; }
        .mois-title-row .mois-title { margin-bottom:0; }
        .mois-collapse-btn { background:none;border:1px solid rgba(255,255,255,0.25);color:rgba(255,255,255,0.85);font-family:'Outfit',sans-serif;font-size:11px;font-weight:600;cursor:pointer;padding:4px 10px;border-radius:20px; }
        .jardin-summary { display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px; }
        .jardin-summary-chip { background:var(--cream);border:1px solid rgba(0,0,0,0.06);border-radius:20px;padding:5px 12px;font-size:12px;font-weight:600;color:var(--forest); }
        .jardin-summary-chip-btn { background:var(--cream);border:1px solid rgba(0,0,0,0.06);border-radius:20px;padding:5px 12px;font-size:12px;font-weight:600;color:var(--forest);font-family:'Outfit',sans-serif;cursor:pointer; }
        .jardin-section-toggle { width:100%;display:flex;align-items:center;justify-content:space-between;background:white;border:1px solid rgba(0,0,0,0.08);border-radius:var(--r);padding:12px 16px;font-family:'Outfit',sans-serif;font-size:13px;font-weight:600;color:var(--forest);cursor:pointer;margin-bottom:16px;box-shadow:var(--shadow); }
        .jardin-section-toggle-action { color:var(--moss);font-size:12px;font-weight:600; }
        .jardin-section { margin-bottom:16px; }
        .jardin-section-collapse-btn { background:none;border:none;color:var(--moss);font-family:'Outfit',sans-serif;font-size:12px;font-weight:600;cursor:pointer;padding:0;margin-bottom:8px;display:block; }
        .filters-row { margin-bottom:10px; }
        .search-input { width:100%;border:1.5px solid rgba(0,0,0,0.1);border-radius:10px;padding:10px 14px;font-family:'Outfit',sans-serif;font-size:14px;outline:none;background:white; }
        .cats-row { display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding-bottom:4px;margin-bottom:14px; }
        .cats-row::-webkit-scrollbar { display:none; }
        .cat-btn { border:1px solid rgba(0,0,0,0.1);background:white;border-radius:20px;padding:5px 12px;font-family:'Outfit',sans-serif;font-size:12px;cursor:pointer;white-space:nowrap;color:#666; }
        .cat-btn.active { background:var(--moss);color:white;border-color:var(--moss); }
        .jardin-grid { display:flex;flex-direction:column;gap:10px; }
        .jardin-card { background:white;border-radius:var(--r);display:flex;gap:12px;padding:12px;box-shadow:var(--shadow);cursor:pointer;position:relative;border:1px solid rgba(0,0,0,0.06); }
        .jardin-card-img { width:68px;height:68px;border-radius:10px;overflow:hidden;flex-shrink:0;background:var(--mist);display:flex;align-items:center;justify-content:center; }
        .jardin-card-body { flex:1;min-width:0; }
        .jardin-card-name { font-family:'Cormorant Garamond',serif;font-size:16px;font-weight:700;color:var(--ink); }
        .jardin-card-latin { font-size:11px;color:#aaa;font-style:italic;margin-top:1px; }
        .jardin-card-cat { display:inline-block;background:var(--mist);color:var(--moss);border-radius:20px;padding:2px 8px;font-size:10px;font-weight:500;margin-top:4px; }
        .jardin-card-plantation { font-size:11px;color:var(--gold);margin-top:3px; }
        .tache-badge { display:block;margin-top:5px;font-size:11px;color:var(--gold);font-weight:500; }
        .jardin-card-chevron { align-self:center;font-size:20px;line-height:1;color:#ccc;padding-right:26px;flex-shrink:0; }
        .jardin-delete { position:absolute;top:10px;right:10px;background:none;border:none;cursor:pointer;color:#ccc;font-size:14px;padding:4px;border-radius:4px; }
        .jardin-delete:hover { background:#ffebee;color:var(--rust); }
        .jardin-delete-confirm { position:absolute;inset:0;background:rgba(255,255,255,0.97);border-radius:var(--r);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:12px;z-index:3;text-align:center; }
        .jardin-delete-confirm-text { font-size:13px;font-weight:600;color:var(--ink); }
        .jardin-delete-confirm-actions { display:flex;gap:8px; }
        .jardin-delete-confirm-yes { background:var(--rust);color:white;border:none;border-radius:8px;padding:7px 14px;font-family:'Outfit',sans-serif;font-size:12px;font-weight:600;cursor:pointer; }
        .jardin-delete-confirm-no { background:none;border:1px solid rgba(0,0,0,0.12);border-radius:8px;padding:7px 14px;font-family:'Outfit',sans-serif;font-size:12px;color:#666;cursor:pointer; }
        .jardin-count { text-align:center;color:#bbb;font-size:12px;margin-top:14px; }
        .back-btn { display:flex;align-items:center;gap:6px;background:none;border:none;color:var(--moss);font-family:'Outfit',sans-serif;font-size:14px;cursor:pointer;padding:0;margin-bottom:16px;font-weight:500; }
        .btn-danger { background:#ffebee;color:var(--rust);border:1px solid rgba(139,58,30,0.2);border-radius:8px;padding:9px 16px;font-family:'Outfit',sans-serif;font-size:13px;cursor:pointer; }
        .auth-tabs { display:flex;gap:6px;margin-bottom:18px; }
        .auth-tab { flex:1;padding:9px;text-align:center;border-radius:10px;border:1.5px solid rgba(0,0,0,0.1);background:var(--cream);font-family:'Outfit',sans-serif;font-size:13px;font-weight:600;color:#888;cursor:pointer; }
        .auth-tab.active { border-color:var(--moss);background:var(--mist);color:var(--forest); }
        .auth-field { margin-bottom:12px; }
        .auth-field .plant-input { width:100%; }
        .auth-label { font-size:11px;font-weight:600;color:var(--forest);margin-bottom:5px;display:block; }
        .auth-success-box { background:var(--mist);border-radius:8px;padding:12px 14px;color:var(--forest);font-size:13px;margin-bottom:16px;line-height:1.5; }
        .modal .error-box { margin:0 0 16px; }
        .id-status-badge { display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;margin-bottom:5px; }
        .id-status-confirmed { background:rgba(122,173,122,0.25);color:var(--sage); }
        .id-status-uncertain { background:rgba(196,150,42,0.2);color:#f0d890; }
        .id-blocked-note { color:rgba(255,255,255,0.55);font-size:13px;font-style:italic; }
        .identification-check { padding:0 18px 12px;display:flex;gap:8px;flex-wrap:wrap; }
        .id-check-btn { flex:1;min-width:90px;padding:9px 10px;border:1.5px solid rgba(255,255,255,0.25);border-radius:20px;background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.85);font-family:'Outfit',sans-serif;font-size:12px;font-weight:600;cursor:pointer;text-align:center;transition:all 0.15s; }
        .id-check-btn.active-yes { background:var(--sage);color:var(--forest);border-color:var(--sage); }
        .id-check-btn.active-no { background:var(--rust);color:white;border-color:var(--rust); }
        .id-check-btn.active-unsure { background:var(--gold);color:var(--forest);border-color:var(--gold); }
        .jardin-select-bar { display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px; }
        .jardin-select-count { font-size:13px;color:var(--moss);font-weight:600; }
        .jardin-card-selected { border-color:var(--moss);box-shadow:0 0 0 2px var(--moss) inset; }
        .jardin-select-checkbox { position:absolute;top:8px;left:8px;width:20px;height:20px;accent-color:var(--moss);cursor:pointer;z-index:2;background:white;border-radius:5px;box-shadow:0 1px 4px rgba(0,0,0,0.25); }
        .reminder-type-row { border:1.5px solid rgba(0,0,0,0.1);border-radius:12px;padding:12px;margin-bottom:10px;background:var(--cream); }
        .reminder-type-header { display:flex;align-items:center;gap:8px;cursor:pointer;font-family:'Outfit',sans-serif; }
        .reminder-type-header input[type="checkbox"] { width:18px;height:18px;accent-color:var(--moss);cursor:pointer; }
        .reminder-type-icon { font-size:18px; }
        .reminder-type-label { font-size:14px;font-weight:600;color:var(--ink); }
        .reminder-type-config { margin-top:12px;padding-top:12px;border-top:1px solid rgba(0,0,0,0.08); }
        .reminders-overview { background:white;border-radius:var(--r);padding:16px 18px;margin-bottom:16px;box-shadow:var(--shadow); }
        .reminders-overview-title { font-family:'Cormorant Garamond',serif;font-size:18px;color:var(--forest);font-weight:700;margin-bottom:12px; }
        .reminders-empty { color:#aaa;font-size:13px;font-style:italic; }
        .reminders-date-group { margin-bottom:14px; }
        .reminders-date-group:last-child { margin-bottom:0; }
        .reminders-date-label { font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:var(--sage);margin-bottom:6px; }
        .reminders-type-group { padding:8px 0;border-bottom:1px solid rgba(0,0,0,0.06); }
        .reminders-type-group:last-child { border-bottom:none; }
        .reminders-type-line { display:flex;align-items:center;flex-wrap:wrap;gap:6px;font-size:13px;font-weight:600;color:var(--ink); }
        .reminders-snoozed-tag { font-weight:500;color:var(--gold);font-style:italic; }
        .reminders-plant-names { font-size:12px;color:#999;margin-top:2px; }
        .reminders-manage-btn { margin-left:auto;background:none;border:none;color:var(--moss);font-family:'Outfit',sans-serif;font-size:11px;font-weight:600;cursor:pointer;padding:2px 6px; }
        .reminders-item-list { margin-top:8px;display:flex;flex-direction:column;gap:10px; }
        .reminders-item-row { background:var(--cream);border-radius:8px;padding:8px 10px; }
        .reminders-item-name { font-size:13px;font-weight:600;color:var(--ink);margin-bottom:6px; }
        .reminders-item-actions { display:flex;gap:6px;flex-wrap:wrap; }
        .reminders-action-btn { background:white;border:1px solid rgba(0,0,0,0.12);border-radius:14px;padding:5px 10px;font-family:'Outfit',sans-serif;font-size:11px;font-weight:600;color:var(--ink);cursor:pointer; }
        .reminders-action-btn:disabled { opacity:0.45;cursor:not-allowed; }
        .reminders-action-confirm { background:var(--forest);color:white;border-color:var(--forest); }
        .reminders-snooze-form { display:flex;flex-direction:column;gap:6px; }
        .reminders-snooze-form .plant-input { width:100%; }
        .reminders-item-error { color:var(--rust);font-size:11px;margin-top:4px; }
        .reminders-group-actions { margin-bottom:10px;padding-bottom:10px;border-bottom:1px dashed rgba(0,0,0,0.12); }
        .reminders-group-busy { font-size:12px;color:#999;font-style:italic; }
        .reminders-group-confirm-text { display:block;font-size:12px;color:var(--ink);margin-bottom:6px; }
        .reminders-weather-location { font-size:12px;color:var(--sage);font-weight:600;margin-bottom:10px; }
        .reminders-weather-attribution { font-size:10px;color:#aaa;margin-top:-6px;margin-bottom:10px; }
        .reminders-weather-attribution a { color:#aaa;text-decoration:underline; }
        .reminders-weather-hint { margin-top:8px;padding-top:8px;border-top:1px dashed rgba(0,0,0,0.1);display:flex;flex-direction:column;gap:6px; }
        .reminders-weather-text { font-size:12px;color:var(--moss);line-height:1.4; }
        .zones-panel { background:white;border-radius:var(--r);padding:16px 18px;box-shadow:var(--shadow); }
        .zones-panel-title { font-family:'Cormorant Garamond',serif;font-size:18px;color:var(--forest);font-weight:700;margin-bottom:10px; }
        .zones-empty-text { color:#999;font-size:13px;margin-bottom:12px;line-height:1.5; }
        .zones-list { display:flex;flex-direction:column;gap:8px;margin-bottom:12px; }
        .zones-item { display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--cream);border-radius:10px;padding:10px 12px; }
        .zones-item-name { font-size:13px;font-weight:600;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
        .zones-item-actions { display:flex;gap:10px;flex-shrink:0; }
        .zones-item-action { background:none;border:none;color:var(--moss);font-family:'Outfit',sans-serif;font-size:12px;font-weight:600;cursor:pointer;padding:2px 4px; }
        .zones-item-action-danger { color:var(--rust); }
        .zones-edit-form { flex:1;display:flex;flex-direction:column;gap:6px; }
        .zones-edit-actions { display:flex;gap:8px; }
        .zones-delete-confirm { flex:1;display:flex;flex-direction:column;gap:6px; }
        .zones-delete-confirm-text { font-size:13px;font-weight:600;color:var(--ink); }
        .zones-item-error { color:var(--rust);font-size:11px; }
        .zones-create-form { display:flex;flex-direction:column;gap:8px;margin-top:4px; }
        .zones-add-btn { background:none;border:1.5px dashed rgba(58,107,58,0.3);border-radius:10px;padding:10px;width:100%;font-family:'Outfit',sans-serif;font-size:13px;font-weight:600;color:var(--moss);cursor:pointer;margin-top:4px; }
        .zone-settings-panel { background:var(--mist);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:10px; }
        @media(max-width:400px){.info-grid{grid-template-columns:1fr}}
      `}</style>

      {showAuthModal && <AuthModal auth={auth} onClose={() => setShowAuthModal(false)} initialMode={authModalMode} />}

      {activeNav === "accueil" && (
        <AccueilDashboard
          firstName={profile && profile.first_name ? profile.first_name : null}
          jardin={garden.jardin}
          gardenLoading={garden.loading}
          reminders={reminders.reminders}
          remindersLoading={reminders.loading}
          weather={weather}
          weatherLoading={weatherLoading}
          isAuthenticated={!!auth.user}
          onGoIdentifier={() => setActiveNav("identifier")}
          onGoJardin={() => setActiveNav("jardin")}
          onLogin={() => openAuthModal("login")}
          onSignup={() => openAuthModal("signup")}
        />
      )}
      {activeNav === "identifier" && <IdentifierTab addPlant={garden.addPlant} />}
      {activeNav === "jardin" && <MonJardinTab jardin={garden.jardin} deletePlant={garden.deletePlant} updateContext={garden.updateContext} updatePlantZone={garden.updatePlantZone} loading={garden.loading} migrating={garden.migrating} error={garden.error} reminders={reminders} weather={weather} weatherLoading={weatherLoading} zones={{ ...gardenZones, deleteZone: handleDeleteZone }} isAuthenticated={!!auth.user} onGoIdentifier={() => setActiveNav("identifier")} />}

      <p className="pe-ai-disclaimer">
        <IconInfo size={13} />
        <span>Conseils IA à titre indicatif. Consultez un horticulteur pour cas spécifiques.</span>
      </p>
    </AppShell>
  );
}
