import React, { useState, useRef, useCallback, useEffect } from "react";
import { useAuth } from "@/lib/useAuth";
import { useGarden } from "@/lib/useGarden";
import { useReminders } from "@/lib/useReminders";
import { fetchProfile } from "@/lib/profileApi";
import { fetchWeatherForProfile } from "@/lib/weatherApi";
import { evaluateWateringWeather } from "@/lib/weatherEngine";
import AuthModal from "@/components/AuthModal";
import PlantContextEditor from "@/components/PlantContextEditor";
import ReminderBulkModal from "@/components/ReminderBulkModal";
import RemindersOverview from "@/components/RemindersOverview";

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
    <div className="modal-overlay">
      <div className="modal">
        {step === 1 && (
          <>
            <div className="modal-step">Étape 1/2</div>
            <div className="modal-title">Contexte de plantation</div>
            <div className="modal-sub">Les quantités eau et engrais seront adaptées</div>
            <div className="plantation-grid">
              {PLANTATION_TYPES.map(p => (
                <button key={p.id} className={"plantation-btn" + (plantation && plantation.id === p.id ? " active" : "")} onClick={() => setPlantation(p)}>
                  <span className="plantation-icon">{p.icon}</span>
                  <span className="plantation-label">{p.label}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <div className="modal-step">Étape 2/2</div>
            <div className="modal-title">Usage de la plante</div>
            <div className="modal-sub">Les conseils de taille seront adaptés à cet usage</div>
            <div className="plantation-grid">
              {USAGE_TYPES.map(u => (
                <button key={u.id} className={"plantation-btn" + (usageSelected && usageSelected.id === u.id ? " active" : "")} onClick={() => setUsageSelected(u)}>
                  <span className="plantation-icon">{u.icon}</span>
                  <span className="plantation-label">{u.label}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="modal-actions">
          <button className="btn-modal-confirm"
            disabled={step === 1 ? !plantation : false}
            onClick={handleConfirm}>
            {step === 1 ? "Suivant →" : "Obtenir les conseils adaptés"}
          </button>
          <button className="btn-modal-skip" onClick={() => onSkip()}>
            Passer (conseils généraux)
          </button>
        </div>
      </div>
    </div>
  );
}

function TagList({ items, color }) {
  const c = color || "green";
  if (!items || !items.length) return React.createElement("p", {className:"empty-text"}, "Aucune donnée");
  return React.createElement("div", {className:"tag-list"},
    items.map((item, i) => React.createElement("div", {key:i, className:"tag tag-"+c},
      React.createElement("span", {className:"tag-dot"}), item
    ))
  );
}

function InfoCard({ icon, label, value }) {
  return (
    <div className="info-card">
      <span className="info-icon">{icon}</span>
      <div><div className="info-label">{label}</div><div className="info-value">{value}</div></div>
    </div>
  );
}

function CalendrierGrid({ data }) {
  const moisActuel = new Date().getMonth();
  return (
    <div className="cal-grid">
      {MONTHS.map(([key, label], i) => (
        <div key={key} className={"cal-cell" + (i === moisActuel ? " cal-cell-active" : "")}>
          <div className="cal-month">{label}</div>
          <div className="cal-text">{data[key] || "—"}</div>
        </div>
      ))}
    </div>
  );
}

function PlanteFiche({ result, imagePreview, plantation, usage, onSave, alreadySaved, context, onSaveContext, identificationStatus, identificationActions }) {
  const [activeTab, setActiveTab] = useState("maladies");
  const tabs = [
    { key: "maladies", label: "Maladies", icon: "🔬" },
    { key: "taille", label: "Taille", icon: "✂️" },
    { key: "nutriments", label: "Nutriments", icon: "🧪" },
    { key: "arrosage", label: "Arrosage", icon: "💧" },
    { key: "calendrier", label: "Calendrier", icon: "📅" },
  ];
  if (onSaveContext) tabs.push({ key: "jardin", label: "Jardin", icon: "🪴" });
  const r = result;
  return (
    <div className="result-panel">
      <div className="plant-hero">
        <div className="hero-content">
          {imagePreview ? <div className="hero-img-wrap"><img src={imagePreview} alt="" className="hero-img" /></div> : <div className="hero-no-img">🌱</div>}
          <div className="hero-text">
            <div className={"confidence-badge conf-" + (r.identite && r.identite.confiance)}>{r.identite && "Confiance : " + r.identite.confiance}</div>
            <div className="hero-name">{r.identite && r.identite.nom_commun}</div>
            <div className="hero-latin">{r.identite && r.identite.nom_latin}</div>
            <div className="hero-family">{r.identite && r.identite.famille}</div>
            {alreadySaved && identificationStatus === "confirmed" && <div className="id-status-badge id-status-confirmed">✓ Identification confirmée</div>}
            {alreadySaved && identificationStatus === "uncertain" && <div className="id-status-badge id-status-uncertain">🤔 Identification à confirmer</div>}
            {plantation && <div className="plantation-tag">{plantation.icon} {plantation.label}</div>}
            {usage && <div className="plantation-tag" style={{marginLeft:4}}>{usage.icon} {usage.label}</div>}
          </div>
        </div>
        <div className="hero-desc">{r.identite && r.identite.description}</div>
        <div className="hero-save">
          {alreadySaved ? (
            <span className="saved-badge">✓ Dans Mon Jardin</span>
          ) : identificationStatus === "rejected" ? (
            <span className="id-blocked-note">Ajout à Mon Jardin bloqué — identification rejetée</span>
          ) : (
            <button className="btn-save" onClick={onSave}>+ Ajouter à Mon Jardin</button>
          )}
        </div>
        {identificationActions && identificationStatus && !alreadySaved && (
          <div className="identification-check">
            <button
              type="button"
              className={"id-check-btn" + (identificationStatus === "confirmed" ? " active-yes" : "")}
              onClick={identificationActions.onConfirm}
            >
              ✅ Oui, c&apos;est ça
            </button>
            <button
              type="button"
              className={"id-check-btn" + (identificationStatus === "rejected" ? " active-no" : "")}
              onClick={identificationActions.onReject}
            >
              ❌ Non
            </button>
            <button
              type="button"
              className={"id-check-btn" + (identificationStatus === "uncertain" ? " active-unsure" : "")}
              onClick={identificationActions.onUncertain}
            >
              🤷 Je ne sais pas
            </button>
          </div>
        )}
        <div className="tabs-wrap">
          <div className="tabs">
            {tabs.map(s => (
              <button key={s.key} className={"tab" + (activeTab === s.key ? " active" : "")} onClick={() => setActiveTab(s.key)}>
                <span className="tab-icon">{s.icon}</span>{s.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {identificationStatus === "rejected" && identificationActions && !alreadySaved && (
        <div className="tab-content" style={{marginBottom:12}}>
          <div className="section-title">❌ Identification rejetée</div>
          <div className="error-box" style={{margin:"0 0 16px"}}>
            Vous avez indiqué que ce résultat n&apos;était pas correct. Il ne peut pas être ajouté à Mon Jardin tel quel.
          </div>
          <div className="modal-actions">
            <button type="button" className="btn-modal-confirm" onClick={identificationActions.onRetakePhoto}>📷 Reprendre une photo</button>
            <button type="button" className="btn-modal-skip" onClick={identificationActions.onSwitchToNameSearch}>🔍 Identifier par nom</button>
          </div>
        </div>
      )}
      {identificationStatus === "uncertain" && !alreadySaved && (
        <div className="tab-content" style={{marginBottom:12}}>
          <div className="section-title">🤔 Identification à confirmer</div>
          <div className="highlight-box">
            Pour confirmer cette identification, essaie une nouvelle photo : la plante entière, une feuille, une fleur ou un fruit si disponible, et l&apos;écorce ou la tige si pertinent.
          </div>
        </div>
      )}
      <div className="tab-content">
        {activeTab === "maladies" && r.maladies && (
          <div>
            <div className="section-title">🔬 Maladies & Ravageurs</div>
            <div className="subsection"><div className="subsection-title">Vulnérabilités</div><TagList items={r.maladies.vulnerabilites} color="red" /></div>
            <div className="subsection"><div className="subsection-title">Symptômes</div><TagList items={r.maladies.symptomes_alerte} color="gold" /></div>
            <div className="subsection"><div className="subsection-title">Traitements</div><TagList items={r.maladies.traitements} color="green" /></div>
            {r.maladies.conseil_urgence && <div className="highlight-box"><div className="highlight-label">Urgence</div>{r.maladies.conseil_urgence}</div>}
          </div>
        )}
        {activeTab === "taille" && r.taille && (
          <div>
            <div className="section-title">✂️ Taille</div>
            <div className="info-grid">
              <InfoCard icon="📅" label="Période" value={r.taille.periode_ideale} />
              <InfoCard icon="🔄" label="Fréquence" value={r.taille.frequence} />
            </div>
            <div className="highlight-box"><div className="highlight-label">Technique</div>{r.taille.technique}</div>
            {r.taille.a_eviter && <div className="highlight-box" style={{borderLeftColor:"#8b3a1e",background:"#fff8f6"}}><div className="highlight-label" style={{color:"#8b3a1e"}}>À éviter</div>{r.taille.a_eviter}</div>}
            {r.taille.conseil_pro && <div className="highlight-box" style={{borderLeftColor:"#c4962a",background:"#fffbf0"}}><div className="highlight-label" style={{color:"#c4962a"}}>Conseil pro</div>{r.taille.conseil_pro}</div>}
          </div>
        )}
        {activeTab === "nutriments" && r.nutriments && (
          <div>
            <div className="section-title">🧪 Nutriments & Engrais</div>
            {plantation && <div className="context-banner">{plantation.icon} Conseils adaptés : {plantation.label}</div>}
            <div className="subsection"><div className="subsection-title">Besoins</div><TagList items={r.nutriments.besoins_principaux} color="green" /></div>
            <div className="info-grid" style={{marginTop:14}}>
              <InfoCard icon="🌱" label="Engrais recommandé" value={r.nutriments.engrais_recommande} />
              <InfoCard icon="⏰" label="Période" value={r.nutriments.periode_fertilisation} />
            </div>
            {r.nutriments.frequence_apport && <div className="highlight-box"><div className="highlight-label">Quantités et fréquence</div>{r.nutriments.frequence_apport}</div>}
            {r.nutriments.signes_carence && r.nutriments.signes_carence.length > 0 && <div className="subsection"><div className="subsection-title">Signes de carence</div><TagList items={r.nutriments.signes_carence} color="gold" /></div>}
            {r.nutriments.surdosage_risques && <div className="highlight-box" style={{borderLeftColor:"#8b3a1e",background:"#fff8f6"}}><div className="highlight-label" style={{color:"#8b3a1e"}}>Risque surdosage</div>{r.nutriments.surdosage_risques}</div>}
          </div>
        )}
        {activeTab === "arrosage" && r.arrosage && (
          <div>
            <div className="section-title">💧 Arrosage</div>
            {plantation && <div className="context-banner">{plantation.icon} Conseils adaptés : {plantation.label}</div>}
            <div className="info-grid">
              <InfoCard icon="☀️" label="Été" value={r.arrosage.frequence_ete} />
              <InfoCard icon="❄️" label="Hiver" value={r.arrosage.frequence_hiver} />
            </div>
            <div className="highlight-box"><div className="highlight-label">Méthode</div>{r.arrosage.methode}</div>
            {r.arrosage.conseil_pratique && <div className="highlight-box" style={{borderLeftColor:"#c4962a",background:"#fffbf0"}}><div className="highlight-label" style={{color:"#c4962a"}}>Conseil pratique</div>{r.arrosage.conseil_pratique}</div>}
            <div className="info-grid" style={{marginTop:10}}>
              {r.arrosage.signes_manque && <InfoCard icon="🥀" label="Manque" value={r.arrosage.signes_manque} />}
              {r.arrosage.signes_exces && <InfoCard icon="🟡" label="Excès" value={r.arrosage.signes_exces} />}
            </div>
          </div>
        )}
        {activeTab === "calendrier" && r.calendrier && (
          <div>
            <div className="section-title">📅 Calendrier annuel</div>
            <CalendrierGrid data={r.calendrier} />
          </div>
        )}
        {activeTab === "jardin" && onSaveContext && (
          <div>
            <div className="section-title">🪴 Contexte du jardin</div>
            <PlantContextEditor context={context} onSave={onSaveContext} />
          </div>
        )}
      </div>
    </div>
  );
}

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
    <div className="tab-page">
      {showModal && (
        <PlantationModal
          onConfirm={(p, u) => { setPlantation(p); setUsage(u); doAnalyze(p, u); }}
          onSkip={() => { setPlantation(null); doAnalyze(null); }}
        />
      )}
      {!result && !loading && (
        <div className="input-panel">
          <div className={"drop-zone" + (imagePreview ? " has-image" : "")}
            onClick={() => !imagePreview && fileRef.current && fileRef.current.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}>
            {imagePreview ? (
              <>{/* eslint-disable-next-line */}<img src={imagePreview} alt="" className="drop-preview" />
                <div className="drop-overlay" onClick={e => { e.stopPropagation(); fileRef.current && fileRef.current.click(); }}><span>📷 Changer</span></div></>
            ) : (
              <><span className="drop-icon">📸</span><div className="drop-title">Dépose une photo ici</div><div className="drop-sub">ou clique pour choisir</div></>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={e => e.target.files && handleFile(e.target.files[0])} />
          <div className="divider"><div className="divider-line" /><span className="divider-text">ou</span><div className="divider-line" /></div>
          <div className="name-row">
            <input ref={nameInputRef} className="plant-input" placeholder="Nom de la plante..." value={plantName} onChange={e => setPlantName(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAnalyze()} />
            <button className="btn-analyze" onClick={handleAnalyze}>🔍 Analyser</button>
          </div>
          {error && <div className="error-box">⚠️ {error}</div>}
        </div>
      )}
      {loading && (
        <div className="loading-state">
          <div className="leaf-spin">🌿</div>
          <div className="loading-title">Analyse en cours</div>
          <div className="loading-sub">{plantation ? "Adaptation pour " + plantation.label : "Identification et conseils..."}...</div>
        </div>
      )}
      {result && !loading && (
        <>
          <div className="reset-row"><button className="btn-reset" onClick={reset}>← Nouvelle analyse</button></div>
          <PlanteFiche result={result} imagePreview={imagePreview} plantation={plantation} usage={usage} onSave={handleSave} alreadySaved={saved} identificationStatus={identificationStatus} identificationActions={identificationActions} />
          {saveError && <div className="error-box" style={{marginTop:12}}>⚠️ {saveError}</div>}
        </>
      )}
    </div>
  );
}

// Local calendar day only — never UTC — same convention duplicated in
// lib/reminderApi.js and components/RemindersOverview.js.
function todayLocalDateString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function MonJardinTab({ jardin, deletePlant, updateContext, loading, migrating, error, reminders, weather, weatherLoading }) {
  const [selected, setSelected] = useState(null);
  const [filterCat, setFilterCat] = useState("Tout");
  const [searchQ, setSearchQ] = useState("");
  const [deleteError, setDeleteError] = useState(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [reminderNotice, setReminderNotice] = useState(null);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [aFaireOpen, setAFaireOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const handleDelete = async (id) => {
    setDeleteError(null);
    const { error: err } = await deletePlant(id);
    if (err) { setDeleteError(err); return; }
    if (selected && selected.id === id) setSelected(null);
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
    return (filterCat === "Tout" || cat === filterCat) && (!searchQ || nom.includes(searchQ.toLowerCase()));
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
    for (const reminder of wateringReminders) {
      const plant = jardin.find((p) => p.id === reminder.plantId);
      weatherRecommendationsByReminderId[reminder.id] = evaluateWateringWeather({
        weather,
        reminder,
        plantContext: plant ? plant.context : null,
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

  if (selected) {
    return (
      <div className="tab-page">
        <button className="back-btn" onClick={() => setSelected(null)}>← Mon Jardin</button>
        <PlanteFiche result={selected.data} imagePreview={selected.imagePreview} plantation={selected.plantation} usage={selected.usage} onSave={() => {}} alreadySaved={true} context={selected.context} onSaveContext={(ctx) => updateContext(selected.id, ctx)} identificationStatus={selected.identificationStatus} />
        {deleteError && <div className="error-box">⚠️ {deleteError}</div>}
        <div style={{padding:"16px 0"}}><button className="btn-danger" onClick={() => handleDelete(selected.id)}>🗑 Retirer du jardin</button></div>
      </div>
    );
  }

  return (
    <div className="tab-page">
      {migrating && <div className="context-banner">🔄 Synchronisation de votre jardin avec votre compte...</div>}
      {error && <div className="error-box">⚠️ {error}</div>}
      {deleteError && <div className="error-box">⚠️ {deleteError}</div>}
      {loading && jardin.length === 0 ? (
        <div className="loading-state">
          <div className="leaf-spin">🌿</div>
          <div className="loading-title">Chargement de votre jardin</div>
        </div>
      ) : jardin.length === 0 ? (
        <div className="empty-jardin">
          <div className="empty-icon">🌾</div>
          <div className="empty-title">Ton jardin est vide</div>
          <div className="empty-sub">Identifie une plante et clique Ajouter à Mon Jardin</div>
        </div>
      ) : (
        <>
          <div className="jardin-summary">
            <span className="jardin-summary-chip">🌿 {jardin.length} plante{jardin.length > 1 ? "s" : ""}</span>
            <span className="jardin-summary-chip">📋 {tasksCount} tâche{tasksCount > 1 ? "s" : ""}</span>
            <span className="jardin-summary-chip">💧 {wateringTasksCount} arrosage{wateringTasksCount > 1 ? "s" : ""}</span>
            {weatherLoading ? (
              <span className="jardin-summary-chip">🌦️ Météo…</span>
            ) : weatherLocationName ? (
              <span className="jardin-summary-chip">🌦️ {weatherLocationName}</span>
            ) : null}
          </div>

          <div className="filters-row">
            <input className="search-input" placeholder="🔍 Rechercher..." value={searchQ} onChange={e => setSearchQ(e.target.value)} />
          </div>
          <div className="cats-row">
            {["Tout", ...CATEGORIES].map(c => (
              <button key={c} className={"cat-btn" + (filterCat === c ? " active" : "")} onClick={() => setFilterCat(c)}>{c}</button>
            ))}
          </div>

          {!tasksOpen ? (
            <button type="button" className="jardin-section-toggle" onClick={() => setTasksOpen(true)}>
              <span>📋 Tâches — {tasksCount} à venir</span>
              <span className="jardin-section-toggle-action">Voir</span>
            </button>
          ) : (
            <div className="jardin-section">
              <button type="button" className="jardin-section-collapse-btn" onClick={() => setTasksOpen(false)}>Masquer les tâches</button>
              <RemindersOverview
                reminders={reminders}
                garden={{ jardin }}
                actions={{ markDone: reminders.markDone, markSkipped: reminders.markSkipped, snooze: reminders.snooze }}
                weatherRecommendations={weatherRecommendationsByReminderId}
                weatherLocationName={weatherLocationName}
              />
            </div>
          )}

          {!aFaireOpen ? (
            <button type="button" className="jardin-section-toggle" onClick={() => setAFaireOpen(true)}>
              <span>
                📅 À faire en {moisLabel} — {moisTasks.length > 0 ? `${moisTasks.length} plante${moisTasks.length > 1 ? "s" : ""}` : "rien de particulier"}
              </span>
              <span className="jardin-section-toggle-action">Voir</span>
            </button>
          ) : (
            <div className="mois-card">
              <div className="mois-title-row">
                <div className="mois-title">📅 À faire en {moisLabel}</div>
                <button type="button" className="mois-collapse-btn" onClick={() => setAFaireOpen(false)}>Masquer</button>
              </div>
              <div className="mois-list">
                {moisTasks.length === 0 ? (
                  <div className="mois-vide">Rien de particulier ce mois-ci 🌿</div>
                ) : (
                  moisTasks.map(p => (
                    <div key={p.id} className="mois-item">
                      <span className="mois-plante">{p.data && p.data.identite && p.data.identite.nom_commun}</span>
                      <span className="mois-tache">{p.data.calendrier[moisActuel]}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          <div className="jardin-select-bar">
            {!selectionMode ? (
              <button type="button" className="cat-btn" onClick={() => setSelectionMode(true)}>☑️ Sélectionner</button>
            ) : (
              <>
                <button type="button" className="cat-btn" onClick={handleSelectAll}>
                  {allVisibleSelected ? "Tout désélectionner" : "Tout sélectionner"}
                </button>
                <span className="jardin-select-count">
                  {selectedIds.size} plante{selectedIds.size > 1 ? "s" : ""} sélectionnée{selectedIds.size > 1 ? "s" : ""}
                </span>
                <button type="button" className="cat-btn" onClick={handleCancelSelection}>Annuler</button>
                {selectedIds.size > 0 && (
                  <button type="button" className="btn-analyze" onClick={handleOpenReminderModal}>🔔 Créer des rappels</button>
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

          <div className="jardin-grid">
            {filtered.map(p => (
              <div
                key={p.id}
                className={"jardin-card" + (selectionMode && selectedIds.has(p.id) ? " jardin-card-selected" : "")}
                onClick={() => selectionMode ? toggleSelected(p.id) : setSelected(p)}
              >
                {selectionMode && (
                  <input
                    type="checkbox"
                    className="jardin-select-checkbox"
                    checked={selectedIds.has(p.id)}
                    onChange={() => toggleSelected(p.id)}
                    onClick={e => e.stopPropagation()}
                  />
                )}
                <div className="jardin-card-img">
                  {p.imagePreview ? <img src={p.imagePreview} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} /> : <span style={{fontSize:36}}>🌱</span>}
                </div>
                <div className="jardin-card-body">
                  <div className="jardin-card-name">{p.data && p.data.identite && p.data.identite.nom_commun}</div>
                  <div className="jardin-card-latin">{p.data && p.data.identite && p.data.identite.nom_latin}</div>
                  <div className="jardin-card-cat">{(p.data && p.data.identite && p.data.identite.categorie) || "Plante"}</div>
                  {p.plantation && <div className="jardin-card-plantation">{p.plantation.icon} {p.plantation.label}</div>}
                </div>
                {!selectionMode && <span className="jardin-card-chevron" aria-hidden="true">›</span>}
                {!selectionMode && (
                  confirmDeleteId === p.id ? (
                    <div className="jardin-delete-confirm" onClick={e => e.stopPropagation()}>
                      <span className="jardin-delete-confirm-text">Supprimer cette plante ?</span>
                      <div className="jardin-delete-confirm-actions">
                        <button type="button" className="jardin-delete-confirm-yes" onClick={(e) => handleConfirmDeleteClick(e, p.id)}>Supprimer</button>
                        <button type="button" className="jardin-delete-confirm-no" onClick={handleCancelDeleteClick}>Annuler</button>
                      </div>
                    </div>
                  ) : (
                    <button className="jardin-delete" onClick={(e) => handleRequestDelete(e, p.id)}>✕</button>
                  )
                )}
              </div>
            ))}
          </div>
          <div className="jardin-count">{jardin.length} plante{jardin.length > 1 ? "s" : ""} dans ton jardin</div>
        </>
      )}
    </div>
  );
}

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

export default function Home() {
  const [activeNav, setActiveNav] = useState("identifier");
  const auth = useAuth();
  const garden = useGarden(auth.user, auth.loading, PLANTATION_TYPES, USAGE_TYPES);
  const reminders = useReminders(auth.user, auth.loading);
  const [showAuthModal, setShowAuthModal] = useState(false);

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

  return (
    <div className="app">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=Outfit:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root { --ink:#0f1f0f;--forest:#1e3a1e;--moss:#3a6b3a;--sage:#7aad7a;--mist:#e8f0e8;--paper:#f4f2ed;--cream:#faf8f3;--gold:#c4962a;--rust:#8b3a1e;--r:14px;--shadow:0 4px 20px rgba(15,31,15,0.1); }
        body { font-family:'Outfit',sans-serif;background:var(--paper);color:var(--ink); }
        .app { min-height:100vh;padding-bottom:80px; }
        .header { background:var(--forest);padding:24px 20px 16px; }
        .header h1 { font-family:'Cormorant Garamond',serif;font-size:30px;font-weight:700;color:white; }
        .header h1 em { color:var(--sage);font-style:normal; }
        .header p { color:rgba(255,255,255,0.45);font-size:12px;margin-top:3px; } .disclaimer { color:rgba(255,255,255,0.35);font-size:11px;margin-top:6px;line-height:1.4;background:rgba(255,255,255,0.08);border-radius:6px;padding:6px 10px; }
        .bottom-nav { position:fixed;bottom:0;left:0;right:0;background:white;border-top:1px solid rgba(0,0,0,0.1);display:flex;z-index:100;box-shadow:0 -4px 20px rgba(0,0,0,0.08); }
        .nav-item { flex:1;display:flex;flex-direction:column;align-items:center;padding:10px 4px 12px;cursor:pointer;border:none;background:none;font-family:'Outfit',sans-serif;color:#bbb;font-size:11px;transition:color 0.2s;gap:3px;position:relative; }
        .nav-item.active { color:var(--moss); }
        .nav-icon { font-size:22px; }
        .nav-badge { background:var(--moss);color:white;border-radius:10px;padding:1px 6px;font-size:10px;font-weight:600;position:absolute;top:6px;right:calc(50% - 22px); }
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
        .auth-bar { display:flex;align-items:center;gap:10px;margin-top:8px;font-size:12px; }
        .auth-email { color:rgba(255,255,255,0.55);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px; }
        .auth-link { background:none;border:none;color:var(--sage);font-family:'Outfit',sans-serif;font-size:12px;font-weight:600;cursor:pointer;padding:0; }
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
        @media(max-width:400px){.info-grid{grid-template-columns:1fr}}
      `}</style>

      <div className="header">
        <h1>Plante <em>Expert</em></h1>
        <p>Botaniste IA · Identification & Mon Jardin</p><p className="disclaimer">⚠️ Conseils IA à titre indicatif. Consultez un horticulteur pour cas spécifiques.</p>
        {!auth.loading && (
          <div className="auth-bar">
            {auth.user ? (
              <>
                <span className="auth-email">{auth.user.email}</span>
                <a className="auth-link" href="/profile" style={{textDecoration:"none"}}>Mon profil</a>
                <button className="auth-link" onClick={() => auth.signOut()}>Se déconnecter</button>
              </>
            ) : (
              <button className="auth-link" onClick={() => setShowAuthModal(true)}>Se connecter</button>
            )}
          </div>
        )}
      </div>

      {showAuthModal && <AuthModal auth={auth} onClose={() => setShowAuthModal(false)} />}

      {activeNav === "identifier" && <IdentifierTab addPlant={garden.addPlant} />}
      {activeNav === "jardin" && <MonJardinTab jardin={garden.jardin} deletePlant={garden.deletePlant} updateContext={garden.updateContext} loading={garden.loading} migrating={garden.migrating} error={garden.error} reminders={reminders} weather={weather} weatherLoading={weatherLoading} />}

      <nav className="bottom-nav">
        <button className={"nav-item" + (activeNav === "identifier" ? " active" : "")} onClick={() => setActiveNav("identifier")}>
          <span className="nav-icon">🔍</span>Identifier
        </button>
        <button className={"nav-item" + (activeNav === "jardin" ? " active" : "")} onClick={() => setActiveNav("jardin")}>
          <span className="nav-icon">🌳</span>Mon Jardin
          {garden.jardin.length > 0 && <span className="nav-badge">{garden.jardin.length}</span>}
        </button>
      </nav>
    </div>
  );
}
