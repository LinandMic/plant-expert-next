import React, { useState, useRef, useCallback, useEffect } from "react";

const JARDIN_KEY = "mon_jardin_v2";
function loadJardin() { try { const r = localStorage.getItem(JARDIN_KEY); return r ? JSON.parse(r) : []; } catch { return []; } }
function saveJardin(p) { try { localStorage.setItem(JARDIN_KEY, JSON.stringify(p)); } catch {} }

const CATEGORIES = ["Arbre", "Arbuste", "Plante vivace", "Annuelle", "Aromate", "Légume", "Fruit", "Rosier", "Autre"];
const MONTHS = [["jan","Jan"],["fev","Fév"],["mar","Mar"],["avr","Avr"],["mai","Mai"],["jun","Jun"],["jul","Jul"],["aou","Aoû"],["sep","Sep"],["oct","Oct"],["nov","Nov"],["dec","Déc"]];

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
- Pour haie taillée : conseils de taille adaptés à la haie (pas à l'arbre isolé), fréquence de taille pour maintien de forme
- Pour haie libre : conseils naturalistes, taille minimale
- Pour arbre isolé : conseils pour port naturel, taille de formation uniquement
- Pour palissé/espalier : techniques de palissage, taille en vert
- Pour massif : conseils de cohabitation, espacement
Les conseils de taille en particulier doivent être radicalement différents selon l'usage.` : "";

  return `Tu es un expert botaniste et horticulteur francophone spécialisé en jardinage européen (Belgique, France).
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
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 2000, system: buildSystemPrompt(plantation), messages: [{ role: "user", content }] })
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
  const [usage, setUsage] = useState(null);

  const handleConfirm = () => {
    if (step === 1 && plantation) { setStep(2); return; }
    if (step === 2) { onConfirm(plantation, usage); }
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
                <button key={u.id} className={"plantation-btn" + (usage && usage.id === u.id ? " active" : "")} onClick={() => setUsage(u)}>
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

function PlanteFiche({ result, imagePreview, plantation, onSave, alreadySaved }) {
  const [activeTab, setActiveTab] = useState("maladies");
  const tabs = [
    { key: "maladies", label: "Maladies", icon: "🔬" },
    { key: "taille", label: "Taille", icon: "✂️" },
    { key: "nutriments", label: "Nutriments", icon: "🧪" },
    { key: "arrosage", label: "Arrosage", icon: "💧" },
    { key: "calendrier", label: "Calendrier", icon: "📅" },
  ];
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
            {plantation && <div className="plantation-tag">{plantation.icon} {plantation.label}</div>}
            {usage && <div className="plantation-tag" style={{marginLeft:4}}>{usage.icon} {usage.label}</div>}
          </div>
        </div>
        <div className="hero-desc">{r.identite && r.identite.description}</div>
        <div className="hero-save">
          {!alreadySaved ? <button className="btn-save" onClick={onSave}>+ Ajouter à Mon Jardin</button> : <span className="saved-badge">✓ Dans Mon Jardin</span>}
        </div>
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
      </div>
    </div>
  );
}

function IdentifierTab({ jardin, setJardin }) {
  const [plantName, setPlantName] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [usage, setUsage] = useState(null);
  const [plantation, setPlantation] = useState(null);
  const fileRef = useRef();

  const handleFile = useCallback((file) => {
    if (!file || !file.type.startsWith("image/")) return;
    setImageFile(file); setImagePreview(URL.createObjectURL(file));
    setResult(null); setError(null); setSaved(false);
  }, []);

  const doAnalyze = async (plantationCtx, usageCtx) => {
    setLoading(true); setError(null); setResult(null); setSaved(false); setShowModal(false);
    try {
      let b64 = null;
      if (imageFile) b64 = await resizeImage(imageFile);
      const data = await analyzeWithClaude(b64, plantName.trim(), plantationCtx, usageCtx);
      setResult(data);
    } catch (e) {
      setError("Erreur d analyse. Vérifie ta connexion ou réessaie.");
    } finally { setLoading(false); }
  };

  const handleAnalyze = () => {
    if (!imageFile && !plantName.trim()) { setError("Fournis une photo ou un nom de plante."); return; }
    setShowModal(true);
  };

  const handleSave = () => {
    if (!result) return;
    const plante = { id: Date.now(), dateAjout: new Date().toISOString(), imagePreview, plantation, data: result };
    const updated = [plante, ...jardin];
    setJardin(updated); saveJardin(updated); setSaved(true);
  };

  const reset = () => {
    setResult(null); setError(null); setImageFile(null);
    setImagePreview(null); setPlantName(""); setSaved(false); setPlantation(null);
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
            <input className="plant-input" placeholder="Nom de la plante..." value={plantName} onChange={e => setPlantName(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAnalyze()} />
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
          <PlanteFiche result={result} imagePreview={imagePreview} plantation={plantation} onSave={handleSave} alreadySaved={saved} />
        </>
      )}
    </div>
  );
}

function MonJardinTab({ jardin, setJardin }) {
  const [selected, setSelected] = useState(null);
  const [filterCat, setFilterCat] = useState("Tout");
  const [searchQ, setSearchQ] = useState("");

  const handleDelete = (id) => {
    const updated = jardin.filter(p => p.id !== id);
    setJardin(updated); saveJardin(updated);
    if (selected && selected.id === id) setSelected(null);
  };

  const moisIdx = new Date().getMonth();
  const moisActuel = MONTHS[moisIdx][0];
  const moisLabel = MONTHS[moisIdx][1];

  const filtered = jardin.filter(p => {
    const nom = (p.data && p.data.identite && p.data.identite.nom_commun || "").toLowerCase();
    const cat = (p.data && p.data.identite && p.data.identite.categorie) || "";
    return (filterCat === "Tout" || cat === filterCat) && (!searchQ || nom.includes(searchQ.toLowerCase()));
  });

  if (selected) {
    return (
      <div className="tab-page">
        <button className="back-btn" onClick={() => setSelected(null)}>← Mon Jardin</button>
        <PlanteFiche result={selected.data} imagePreview={selected.imagePreview} plantation={selected.plantation} onSave={() => {}} alreadySaved={true} />
        <div style={{padding:"16px 0"}}><button className="btn-danger" onClick={() => handleDelete(selected.id)}>🗑 Retirer du jardin</button></div>
      </div>
    );
  }

  return (
    <div className="tab-page">
      {jardin.length === 0 ? (
        <div className="empty-jardin">
          <div className="empty-icon">🌾</div>
          <div className="empty-title">Ton jardin est vide</div>
          <div className="empty-sub">Identifie une plante et clique Ajouter à Mon Jardin</div>
        </div>
      ) : (
        <>
          <div className="mois-card">
            <div className="mois-title">📅 À faire en {moisLabel}</div>
            <div className="mois-list">
              {jardin.map(p => {
                const tache = p.data && p.data.calendrier && p.data.calendrier[moisActuel];
                if (!tache || tache === "—") return null;
                return (
                  <div key={p.id} className="mois-item">
                    <span className="mois-plante">{p.data && p.data.identite && p.data.identite.nom_commun}</span>
                    <span className="mois-tache">{tache}</span>
                  </div>
                );
              }).filter(Boolean)}
              {jardin.every(p => !(p.data && p.data.calendrier && p.data.calendrier[moisActuel]) || (p.data.calendrier[moisActuel] === "—")) && (
                <div className="mois-vide">Rien de particulier ce mois-ci 🌿</div>
              )}
            </div>
          </div>
          <div className="filters-row">
            <input className="search-input" placeholder="🔍 Rechercher..." value={searchQ} onChange={e => setSearchQ(e.target.value)} />
          </div>
          <div className="cats-row">
            {["Tout", ...CATEGORIES].map(c => (
              <button key={c} className={"cat-btn" + (filterCat === c ? " active" : "")} onClick={() => setFilterCat(c)}>{c}</button>
            ))}
          </div>
          <div className="jardin-grid">
            {filtered.map(p => (
              <div key={p.id} className="jardin-card" onClick={() => setSelected(p)}>
                <div className="jardin-card-img">
                  {p.imagePreview ? <img src={p.imagePreview} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} /> : <span style={{fontSize:36}}>🌱</span>}
                </div>
                <div className="jardin-card-body">
                  <div className="jardin-card-name">{p.data && p.data.identite && p.data.identite.nom_commun}</div>
                  <div className="jardin-card-latin">{p.data && p.data.identite && p.data.identite.nom_latin}</div>
                  <div className="jardin-card-cat">{(p.data && p.data.identite && p.data.identite.categorie) || "Plante"}</div>
                  {p.plantation && <div className="jardin-card-plantation">{p.plantation.icon} {p.plantation.label}</div>}
                  {p.data && p.data.calendrier && p.data.calendrier[moisActuel] && p.data.calendrier[moisActuel] !== "—" && (
                    <span className="tache-badge">📅 {p.data.calendrier[moisActuel]}</span>
                  )}
                </div>
                <button className="jardin-delete" onClick={e => { e.stopPropagation(); handleDelete(p.id); }}>✕</button>
              </div>
            ))}
          </div>
          <div className="jardin-count">{jardin.length} plante{jardin.length > 1 ? "s" : ""} dans ton jardin</div>
        </>
      )}
    </div>
  );
}

export default function Home() {
  const [activeNav, setActiveNav] = useState("identifier");
  const [jardin, setJardin] = useState([]);
  useEffect(() => { setJardin(loadJardin()); }, []);

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
        .header p { color:rgba(255,255,255,0.45);font-size:12px;margin-top:3px; }
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
        .jardin-delete { position:absolute;top:10px;right:10px;background:none;border:none;cursor:pointer;color:#ccc;font-size:14px;padding:4px;border-radius:4px; }
        .jardin-delete:hover { background:#ffebee;color:var(--rust); }
        .jardin-count { text-align:center;color:#bbb;font-size:12px;margin-top:14px; }
        .back-btn { display:flex;align-items:center;gap:6px;background:none;border:none;color:var(--moss);font-family:'Outfit',sans-serif;font-size:14px;cursor:pointer;padding:0;margin-bottom:16px;font-weight:500; }
        .btn-danger { background:#ffebee;color:var(--rust);border:1px solid rgba(139,58,30,0.2);border-radius:8px;padding:9px 16px;font-family:'Outfit',sans-serif;font-size:13px;cursor:pointer; }
        @media(max-width:400px){.info-grid{grid-template-columns:1fr}}
      `}</style>

      <div className="header">
        <h1>Plante <em>Expert</em></h1>
        <p>Botaniste IA · Identification & Mon Jardin</p>
      </div>

      {activeNav === "identifier" && <IdentifierTab jardin={jardin} setJardin={setJardin} />}
      {activeNav === "jardin" && <MonJardinTab jardin={jardin} setJardin={setJardin} />}

      <nav className="bottom-nav">
        <button className={"nav-item" + (activeNav === "identifier" ? " active" : "")} onClick={() => setActiveNav("identifier")}>
          <span className="nav-icon">🔍</span>Identifier
        </button>
        <button className={"nav-item" + (activeNav === "jardin" ? " active" : "")} onClick={() => setActiveNav("jardin")}>
          <span className="nav-icon">🌳</span>Mon Jardin
          {jardin.length > 0 && <span className="nav-badge">{jardin.length}</span>}
        </button>
      </nav>
    </div>
  );
}
