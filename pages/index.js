import { useState, useRef, useCallback, useEffect } from "react";

// ─── STORAGE ────────────────────────────────────────────────────────────────
const JARDIN_KEY = "mon_jardin_v1";

function loadJardin() {
  try {
    const raw = localStorage.getItem(JARDIN_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveJardin(plantes) {
  try { localStorage.setItem(JARDIN_KEY, JSON.stringify(plantes)); } catch {}
}

// ─── CONSTANTS ──────────────────────────────────────────────────────────────
const SECTIONS = [
  { key: "identite", label: "Identité", icon: "🌿" },
  { key: "maladies", label: "Maladies", icon: "🔬" },
  { key: "taille", label: "Taille", icon: "✂️" },
  { key: "nutriments", label: "Nutriments", icon: "🧪" },
  { key: "arrosage", label: "Arrosage", icon: "💧" },
  { key: "calendrier", label: "Calendrier", icon: "📅" },
];

const CATEGORIES = ["Arbre", "Arbuste", "Plante vivace", "Annuelle", "Aromate", "Légume", "Fruit", "Rosier", "Autre"];

const MONTHS = [
  ["jan","Jan"],["fev","Fév"],["mar","Mar"],["avr","Avr"],["mai","Mai"],["jun","Jun"],
  ["jul","Jul"],["aou","Aoû"],["sep","Sep"],["oct","Oct"],["nov","Nov"],["dec","Déc"]
];

const SYSTEM_PROMPT = `Tu es un expert botaniste et horticulteur francophone spécialisé en jardinage européen (Belgique, France).
Quand on te donne une photo ou un nom de plante, tu fournis une analyse complète structurée en JSON.

IMPORTANT : Réponds UNIQUEMENT en JSON valide, sans backticks, sans texte avant ou après.

Format exact attendu :
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
    "vulnerabilites": ["liste des maladies/ravageurs courants"],
    "symptomes_alerte": ["signes à surveiller"],
    "traitements": ["remèdes et préventions"],
    "conseil_urgence": "string"
  },
  "taille": {
    "periode_ideale": "string",
    "frequence": "string",
    "technique": "string",
    "a_eviter": "string",
    "conseil_pro": "string"
  },
  "nutriments": {
    "besoins_principaux": ["N, P, K et autres besoins"],
    "engrais_recommande": "string",
    "periode_fertilisation": "string",
    "signes_carence": ["symptômes visibles"],
    "surdosage_risques": "string"
  },
  "arrosage": {
    "frequence_ete": "string",
    "frequence_hiver": "string",
    "methode": "string",
    "eau_ideale": "string",
    "signes_manque": "string",
    "signes_exces": "string"
  },
  "calendrier": {
    "jan": "string", "fev": "string", "mar": "string",
    "avr": "string", "mai": "string", "jun": "string",
    "jul": "string", "aou": "string", "sep": "string",
    "oct": "string", "nov": "string", "dec": "string"
  }
}`;

// ─── API ─────────────────────────────────────────────────────────────────────
async function analyzeWithClaude(imageBase64, plantName) {
  const content = [];
  if (imageBase64) {
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } });
    content.push({ type: "text", text: plantName ? `Identifie et analyse cette plante. L'utilisateur pense que c'est : "${plantName}". Confirme ou corrige.` : "Identifie et analyse complètement cette plante." });
  } else {
    content.push({ type: "text", text: `Analyse complète de la plante suivante : "${plantName}"` });
  }
  const response = await fetch("/api/proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 2000, system: SYSTEM_PROMPT, messages: [{ role: "user", content }] })
  });
  if (!response.ok) throw new Error(`API error ${response.status}`);
  const data = await response.json();
  const text = data.content.map(b => b.text || "").join("");
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

function resizeImage(file, maxSize = 1024) {
  return new Promise((res) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let w = img.width, h = img.height;
      if (w > maxSize || h > maxSize) {
        if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
        else { w = Math.round(w * maxSize / h); h = maxSize; }
      }
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result.split(",")[1]);
        reader.readAsDataURL(blob);
      }, "image/jpeg", 0.85);
    };
    img.src = url;
  });
}

// ─── SUB-COMPONENTS ──────────────────────────────────────────────────────────
function TagList({ items, color = "green" }) {
  if (!items?.length) return <p className="empty-text">Aucune donnée</p>;
  return (
    <div className="tag-list">
      {items.map((item, i) => (
        <div key={i} className={`tag tag-${color}`}>
          <span className="tag-dot" />{item}
        </div>
      ))}
    </div>
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
  const keys = ["jan","fev","mar","avr","mai","jun","jul","aou","sep","oct","nov","dec"];
  return (
    <div className="cal-grid">
      {MONTHS.map(([key, label], i) => (
        <div key={key} className={`cal-cell ${i === moisActuel ? "cal-cell-active" : ""}`}>
          <div className="cal-month">{label}</div>
          <div className="cal-text">{data[key] || "—"}</div>
        </div>
      ))}
    </div>
  );
}

function PlanteFiche({ result, imagePreview, onSave, alreadySaved }) {
  const [activeTab, setActiveTab] = useState("maladies");
  return (
    <div className="result-panel">
      <div className="plant-hero">
        <div className="hero-content">
          {imagePreview
            ? <div className="hero-img-wrap"><img src={imagePreview} alt="" className="hero-img" /></div>
            : <div className="hero-no-img">🌱</div>
          }
          <div className="hero-text">
            <div className={`confidence-badge conf-${result.identite?.confiance}`}>
              Confiance : {result.identite?.confiance}
            </div>
            <div className="hero-name">{result.identite?.nom_commun}</div>
            <div className="hero-latin">{result.identite?.nom_latin}</div>
            <div className="hero-family">{result.identite?.famille}</div>
          </div>
        </div>
        <div className="hero-desc">{result.identite?.description}</div>
        {!alreadySaved && (
          <div className="hero-save">
            <button className="btn-save" onClick={onSave}>＋ Ajouter à Mon Jardin</button>
          </div>
        )}
        {alreadySaved && (
          <div className="hero-save">
            <span className="saved-badge">✓ Dans Mon Jardin</span>
          </div>
        )}
        <div className="tabs-wrap">
          <div className="tabs">
            {SECTIONS.slice(1).map(s => (
              <button key={s.key} className={`tab ${activeTab === s.key ? "active" : ""}`} onClick={() => setActiveTab(s.key)}>
                <span className="tab-icon">{s.icon}</span>{s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="tab-content">
        {activeTab === "maladies" && result.maladies && (
          <>
            <div className="section-title">🔬 Maladies & Ravageurs</div>
            <div className="subsection"><div className="subsection-title">Vulnérabilités</div><TagList items={result.maladies.vulnerabilites} color="red" /></div>
            <div className="subsection"><div className="subsection-title">Symptômes à surveiller</div><TagList items={result.maladies.symptomes_alerte} color="gold" /></div>
            <div className="subsection"><div className="subsection-title">Traitements</div><TagList items={result.maladies.traitements} color="green" /></div>
            {result.maladies.conseil_urgence && <div className="highlight-box"><div className="highlight-label">⚡ Conseil d'urgence</div>{result.maladies.conseil_urgence}</div>}
          </>
        )}
        {activeTab === "taille" && result.taille && (
          <>
            <div className="section-title">✂️ Taille</div>
            <div className="info-grid">
              <InfoCard icon="📅" label="Période idéale" value={result.taille.periode_ideale} />
              <InfoCard icon="🔄" label="Fréquence" value={result.taille.frequence} />
            </div>
            <div className="highlight-box"><div className="highlight-label">🛠 Technique</div>{result.taille.technique}</div>
            {result.taille.a_eviter && <div className="subsection"><div className="subsection-title">À éviter</div><TagList items={[result.taille.a_eviter]} color="red" /></div>}
            {result.taille.conseil_pro && <div className="highlight-box" style={{borderLeftColor:"#c4962a",background:"#fffbf0"}}><div className="highlight-label" style={{color:"#c4962a"}}>💡 Conseil pro</div>{result.taille.conseil_pro}</div>}
          </>
        )}
        {activeTab === "nutriments" && result.nutriments && (
          <>
            <div className="section-title">🧪 Nutriments & Engrais</div>
            <div className="subsection"><div className="subsection-title">Besoins principaux</div><TagList items={result.nutriments.besoins_principaux} color="green" /></div>
            <div className="info-grid" style={{marginTop:16}}>
              <InfoCard icon="🌱" label="Engrais recommandé" value={result.nutriments.engrais_recommande} />
              <InfoCard icon="⏰" label="Période" value={result.nutriments.periode_fertilisation} />
            </div>
            {result.nutriments.signes_carence?.length > 0 && <div className="subsection"><div className="subsection-title">Signes de carence</div><TagList items={result.nutriments.signes_carence} color="gold" /></div>}
            {result.nutriments.surdosage_risques && <div className="highlight-box" style={{borderLeftColor:"#8b3a1e",background:"#fff8f6"}}><div className="highlight-label" style={{color:"#8b3a1e"}}>⚠️ Risque surdosage</div>{result.nutriments.surdosage_risques}</div>}
          </>
        )}
        {activeTab === "arrosage" && result.arrosage && (
          <>
            <div className="section-title">💧 Arrosage</div>
            <div className="info-grid">
              <InfoCard icon="☀️" label="Été" value={result.arrosage.frequence_ete} />
              <InfoCard icon="❄️" label="Hiver" value={result.arrosage.frequence_hiver} />
            </div>
            <div className="highlight-box"><div className="highlight-label">💧 Méthode</div>{result.arrosage.methode}</div>
            {result.arrosage.eau_ideale && <InfoCard icon="🚿" label="Eau idéale" value={result.arrosage.eau_ideale} />}
            <div className="info-grid" style={{marginTop:12}}>
              {result.arrosage.signes_manque && <InfoCard icon="🥀" label="Manque d'eau" value={result.arrosage.signes_manque} />}
              {result.arrosage.signes_exces && <InfoCard icon="🟡" label="Excès d'eau" value={result.arrosage.signes_exces} />}
            </div>
          </>
        )}
        {activeTab === "calendrier" && result.calendrier && (
          <>
            <div className="section-title">📅 Calendrier annuel</div>
            <CalendrierGrid data={result.calendrier} />
          </>
        )}
      </div>
    </div>
  );
}

// ─── IDENTIFIER TAB ──────────────────────────────────────────────────────────
function IdentifierTab({ jardin, setJardin }) {
  const [plantName, setPlantName] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef();

  const handleFile = useCallback((file) => {
    if (!file || !file.type.startsWith("image/")) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setResult(null); setError(null); setSaved(false);
  }, []);

  const handleAnalyze = async () => {
    if (!imageFile && !plantName.trim()) { setError("Fournis une photo ou un nom de plante."); return; }
    setLoading(true); setError(null); setResult(null); setSaved(false);
    try {
      let b64 = null;
      if (imageFile) b64 = await resizeImage(imageFile);
      const data = await analyzeWithClaude(b64, plantName.trim());
      setResult(data);
    } catch (e) {
      setError("Erreur d'analyse. Vérifie ta connexion ou réessaie.");
    } finally { setLoading(false); }
  };

  const handleSave = () => {
    if (!result) return;
    const plante = {
      id: Date.now(),
      dateAjout: new Date().toISOString(),
      imagePreview: imagePreview,
      data: result,
    };
    const updated = [plante, ...jardin];
    setJardin(updated);
    saveJardin(updated);
    setSaved(true);
  };

  const reset = () => {
    setResult(null); setError(null);
    setImageFile(null); setImagePreview(null);
    setPlantName(""); setSaved(false);
  };

  return (
    <div className="tab-page">
      {!result && (
        <div className="input-panel">
          <div
            className={`drop-zone ${imagePreview ? "has-image" : ""}`}
            onClick={() => !imagePreview && fileRef.current.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
          >
            {imagePreview ? (
              <>
                <img src={imagePreview} alt="Plante" className="drop-preview" />
                <div className="drop-overlay" onClick={e => { e.stopPropagation(); fileRef.current.click(); }}>
                  <span>📷 Changer</span>
                </div>
              </>
            ) : (
              <>
                <span className="drop-icon">📸</span>
                <div className="drop-title">Dépose une photo ici</div>
                <div className="drop-sub">ou clique pour choisir</div>
              </>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={e => handleFile(e.target.files[0])} />
          <div className="divider"><div className="divider-line" /><span className="divider-text">ou</span><div className="divider-line" /></div>
          <div className="name-row">
            <input className="plant-input" placeholder="Nom de la plante (ex: Lavande, Chêne...)" value={plantName} onChange={e => setPlantName(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAnalyze()} />
            <button className="btn-analyze" onClick={handleAnalyze} disabled={loading}>
              {loading ? "⏳" : "🔍"} Analyser
            </button>
          </div>
          {error && <div className="error-box">⚠️ {error}</div>}
        </div>
      )}

      {loading && (
        <div className="loading-state">
          <div className="leaf-spin">🌿</div>
          <div className="loading-title">Analyse en cours</div>
          <div className="loading-sub">Identification, maladies, soins<span className="loading-dots"><span>.</span><span>.</span><span>.</span></span></div>
        </div>
      )}

      {result && !loading && (
        <>
          <div className="reset-row">
            <button className="btn-reset" onClick={reset}>← Nouvelle analyse</button>
          </div>
          <PlanteFiche result={result} imagePreview={imagePreview} onSave={handleSave} alreadySaved={saved} />
        </>
      )}
    </div>
  );
}

// ─── MON JARDIN TAB ───────────────────────────────────────────────────────────
function MonJardinTab({ jardin, setJardin }) {
  const [selected, setSelected] = useState(null);
  const [filterCat, setFilterCat] = useState("Tout");
  const [searchQ, setSearchQ] = useState("");

  const handleDelete = (id) => {
    const updated = jardin.filter(p => p.id !== id);
    setJardin(updated);
    saveJardin(updated);
    if (selected?.id === id) setSelected(null);
  };

  const moisActuel = MONTHS[new Date().getMonth()][0];
  const moisLabel = MONTHS[new Date().getMonth()][1];

  const filtered = jardin.filter(p => {
    const nom = p.data?.identite?.nom_commun?.toLowerCase() || "";
    const cat = p.data?.identite?.categorie || "";
    const matchCat = filterCat === "Tout" || cat === filterCat;
    const matchQ = !searchQ || nom.includes(searchQ.toLowerCase());
    return matchCat && matchQ;
  });

  if (selected) {
    return (
      <div className="tab-page">
        <button className="back-btn" onClick={() => setSelected(null)}>← Mon Jardin</button>
        <PlanteFiche result={selected.data} imagePreview={selected.imagePreview} onSave={() => {}} alreadySaved={true} />
        <div style={{padding:"16px 0"}}>
          <button className="btn-danger" onClick={() => handleDelete(selected.id)}>🗑 Retirer du jardin</button>
        </div>
      </div>
    );
  }

  return (
    <div className="tab-page">
      {jardin.length === 0 ? (
        <div className="empty-jardin">
          <div className="empty-icon">🌾</div>
          <div className="empty-title">Ton jardin est vide</div>
          <div className="empty-sub">Identifie une plante et clique "Ajouter à Mon Jardin"</div>
        </div>
      ) : (
        <>
          {/* Tâches du mois */}
          <div className="mois-card">
            <div className="mois-title">📅 À faire en {moisLabel}</div>
            <div className="mois-list">
              {jardin.map(p => {
                const tache = p.data?.calendrier?.[moisActuel];
                if (!tache || tache === "—") return null;
                return (
                  <div key={p.id} className="mois-item">
                    <span className="mois-plante">{p.data?.identite?.nom_commun}</span>
                    <span className="mois-tache">{tache}</span>
                  </div>
                );
              }).filter(Boolean)}
              {jardin.every(p => !p.data?.calendrier?.[moisActuel] || p.data?.calendrier?.[moisActuel] === "—") && (
                <div className="mois-vide">Rien de particulier ce mois-ci 🌿</div>
              )}
            </div>
          </div>

          {/* Filtres */}
          <div className="filters-row">
            <input className="search-input" placeholder="🔍 Rechercher..." value={searchQ} onChange={e => setSearchQ(e.target.value)} />
          </div>
          <div className="cats-row">
            {["Tout", ...CATEGORIES].map(c => (
              <button key={c} className={`cat-btn ${filterCat === c ? "active" : ""}`} onClick={() => setFilterCat(c)}>{c}</button>
            ))}
          </div>

          {/* Liste */}
          <div className="jardin-grid">
            {filtered.map(p => (
              <div key={p.id} className="jardin-card" onClick={() => setSelected(p)}>
                <div className="jardin-card-img">
                  {p.imagePreview
                    ? <img src={p.imagePreview} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} />
                    : <span style={{fontSize:40}}>🌱</span>
                  }
                </div>
                <div className="jardin-card-body">
                  <div className="jardin-card-name">{p.data?.identite?.nom_commun}</div>
                  <div className="jardin-card-latin">{p.data?.identite?.nom_latin}</div>
                  <div className="jardin-card-cat">{p.data?.identite?.categorie || "Plante"}</div>
                  <div className="jardin-card-tache">
                    {p.data?.calendrier?.[moisActuel] && p.data?.calendrier?.[moisActuel] !== "—"
                      ? <span className="tache-badge">📅 {p.data.calendrier[moisActuel]}</span>
                      : null
                    }
                  </div>
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

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function Home() {
  const [activeNav, setActiveNav] = useState("identifier");
  const [jardin, setJardin] = useState([]);

  useEffect(() => { setJardin(loadJardin()); }, []);

  return (
    <div className="app">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=Outfit:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --ink: #0f1f0f; --forest: #1e3a1e; --moss: #3a6b3a; --sage: #7aad7a;
          --mist: #e8f0e8; --paper: #f4f2ed; --cream: #faf8f3;
          --gold: #c4962a; --gold-light: #f0d890; --rust: #8b3a1e; --sky: #2a5a8b;
          --r: 14px; --shadow: 0 4px 24px rgba(15,31,15,0.1);
        }
        body { font-family: 'Outfit', sans-serif; background: var(--paper); color: var(--ink); }
        .app { min-height: 100vh; padding-bottom: 80px; }

        /* HEADER */
        .header { background: var(--forest); padding: 24px 20px 16px; }
        .header h1 { font-family: 'Cormorant Garamond', serif; font-size: 32px; font-weight: 700; color: white; }
        .header h1 em { color: var(--sage); font-style: normal; }
        .header p { color: rgba(255,255,255,0.5); font-size: 13px; margin-top: 4px; }

        /* BOTTOM NAV */
        .bottom-nav {
          position: fixed; bottom: 0; left: 0; right: 0;
          background: white; border-top: 1px solid rgba(0,0,0,0.1);
          display: flex; z-index: 100;
          box-shadow: 0 -4px 20px rgba(0,0,0,0.08);
        }
        .nav-item {
          flex: 1; display: flex; flex-direction: column; align-items: center;
          padding: 10px 4px 12px; cursor: pointer; border: none; background: none;
          font-family: 'Outfit', sans-serif; color: #aaa; font-size: 11px;
          transition: color 0.2s; gap: 3px;
        }
        .nav-item.active { color: var(--moss); }
        .nav-icon { font-size: 22px; }
        .nav-badge {
          background: var(--moss); color: white; border-radius: 10px;
          padding: 1px 6px; font-size: 10px; font-weight: 600;
          position: absolute; top: 6px; right: calc(50% - 22px);
        }
        .nav-item { position: relative; }

        /* CONTENT */
        .tab-page { padding: 16px 16px 20px; max-width: 680px; margin: 0 auto; }

        /* INPUT PANEL */
        .input-panel { background: white; border-radius: var(--r); overflow: hidden; box-shadow: var(--shadow); border: 1px solid rgba(0,0,0,0.07); }
        .drop-zone { border: 2px dashed rgba(58,107,58,0.25); border-radius: 10px; margin: 16px; padding: 28px 16px; text-align: center; cursor: pointer; background: var(--mist); position: relative; overflow: hidden; transition: all 0.2s; }
        .drop-zone:hover { border-color: var(--moss); }
        .drop-zone.has-image { padding: 0; border-style: solid; }
        .drop-preview { width: 100%; height: 200px; object-fit: cover; display: block; border-radius: 8px; }
        .drop-overlay { position: absolute; inset: 0; background: rgba(15,31,15,0.5); display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.2s; border-radius: 8px; }
        .drop-zone:hover .drop-overlay { opacity: 1; }
        .drop-overlay span { color: white; font-size: 13px; font-weight: 500; }
        .drop-icon { font-size: 36px; display: block; margin-bottom: 8px; }
        .drop-title { font-family: 'Cormorant Garamond', serif; font-size: 17px; color: var(--forest); font-weight: 600; }
        .drop-sub { font-size: 12px; color: #999; margin-top: 3px; }
        .divider { display: flex; align-items: center; gap: 10px; padding: 0 16px; margin-bottom: 2px; }
        .divider-line { flex: 1; height: 1px; background: rgba(0,0,0,0.07); }
        .divider-text { font-size: 11px; color: #bbb; text-transform: uppercase; letter-spacing: 1px; }
        .name-row { display: flex; gap: 8px; padding: 12px 16px 16px; }
        .plant-input { flex: 1; border: 1.5px solid rgba(0,0,0,0.12); border-radius: 10px; padding: 11px 14px; font-family: 'Outfit', sans-serif; font-size: 15px; outline: none; background: var(--cream); transition: border-color 0.2s; }
        .plant-input:focus { border-color: var(--moss); }
        .btn-analyze { background: var(--forest); color: white; border: none; border-radius: 10px; padding: 11px 18px; font-family: 'Outfit', sans-serif; font-size: 14px; font-weight: 600; cursor: pointer; white-space: nowrap; transition: all 0.2s; }
        .btn-analyze:hover:not(:disabled) { background: var(--moss); }
        .btn-analyze:disabled { opacity: 0.6; cursor: not-allowed; }
        .error-box { background: #fff5f5; border: 1px solid rgba(139,58,30,0.2); border-radius: 8px; padding: 12px 14px; color: var(--rust); font-size: 14px; margin: 0 16px 16px; }

        /* LOADING */
        .loading-state { text-align: center; padding: 60px 20px; }
        .leaf-spin { font-size: 48px; display: inline-block; animation: spin 2s linear infinite; margin-bottom: 14px; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .loading-title { font-family: 'Cormorant Garamond', serif; font-size: 22px; color: var(--forest); }
        .loading-sub { color: #888; font-size: 14px; margin-top: 4px; }
        .loading-dots span { animation: blink 1.4s infinite both; }
        .loading-dots span:nth-child(2) { animation-delay: 0.2s; }
        .loading-dots span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes blink { 0%,80%,100% { opacity: 0; } 40% { opacity: 1; } }

        /* RESULT */
        .result-panel { animation: fadeIn 0.4s ease; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .reset-row { display: flex; justify-content: flex-end; margin-bottom: 12px; }
        .btn-reset { background: none; border: 1px solid rgba(0,0,0,0.12); border-radius: 8px; padding: 6px 12px; font-family: 'Outfit', sans-serif; font-size: 13px; cursor: pointer; color: #888; }

        /* HERO */
        .plant-hero { background: var(--forest); border-radius: var(--r); overflow: hidden; box-shadow: 0 8px 32px rgba(15,31,15,0.2); }
        .hero-content { padding: 24px 20px 0; display: flex; gap: 16px; align-items: flex-start; }
        .hero-img-wrap { width: 90px; height: 90px; border-radius: 10px; overflow: hidden; flex-shrink: 0; border: 2px solid rgba(255,255,255,0.2); }
        .hero-img { width: 100%; height: 100%; object-fit: cover; }
        .hero-no-img { width: 90px; height: 90px; border-radius: 10px; background: rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: center; font-size: 40px; flex-shrink: 0; }
        .hero-text { flex: 1; }
        .confidence-badge { display: inline-block; padding: 3px 8px; border-radius: 20px; font-size: 11px; font-weight: 600; margin-bottom: 6px; }
        .conf-élevée { background: rgba(122,173,122,0.25); color: var(--sage); }
        .conf-moyenne { background: rgba(196,150,42,0.2); color: var(--gold-light); }
        .conf-faible { background: rgba(139,58,30,0.2); color: #e8a080; }
        .hero-name { font-family: 'Cormorant Garamond', serif; font-size: 26px; font-weight: 700; color: white; line-height: 1.1; }
        .hero-latin { font-style: italic; color: rgba(255,255,255,0.5); font-size: 13px; margin-top: 3px; }
        .hero-family { color: rgba(255,255,255,0.3); font-size: 11px; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.8px; }
        .hero-desc { color: rgba(255,255,255,0.65); font-size: 13px; line-height: 1.6; padding: 14px 20px; font-weight: 300; }
        .hero-save { padding: 0 20px 14px; }
        .btn-save { background: var(--sage); color: var(--forest); border: none; border-radius: 8px; padding: 9px 18px; font-family: 'Outfit', sans-serif; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
        .btn-save:hover { background: #8fc48f; }
        .saved-badge { color: var(--sage); font-size: 13px; font-weight: 500; }

        /* TABS */
        .tabs-wrap { padding: 0 20px; border-top: 1px solid rgba(255,255,255,0.08); }
        .tabs { display: flex; overflow-x: auto; scrollbar-width: none; }
        .tabs::-webkit-scrollbar { display: none; }
        .tab { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 12px 14px 10px; color: rgba(255,255,255,0.4); cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.2s; white-space: nowrap; font-size: 11px; font-weight: 500; background: none; border-left: none; border-right: none; border-top: none; font-family: 'Outfit', sans-serif; }
        .tab-icon { font-size: 16px; }
        .tab.active { color: var(--sage); border-bottom-color: var(--sage); }

        /* TAB CONTENT */
        .tab-content { background: white; border-radius: var(--r); margin-top: 12px; padding: 20px; box-shadow: var(--shadow); }
        .section-title { font-family: 'Cormorant Garamond', serif; font-size: 20px; color: var(--forest); margin-bottom: 16px; font-weight: 700; }
        .subsection { margin-top: 16px; }
        .subsection-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; color: var(--sage); margin-bottom: 8px; }
        .tag-list { display: flex; flex-direction: column; gap: 6px; }
        .tag { display: flex; align-items: flex-start; gap: 8px; padding: 9px 12px; border-radius: 8px; font-size: 13px; line-height: 1.5; }
        .tag-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; margin-top: 4px; }
        .tag-green { background: #f0f7f0; color: #2d5a2d; } .tag-green .tag-dot { background: var(--moss); }
        .tag-red { background: #fff5f3; color: #6b1e1e; } .tag-red .tag-dot { background: var(--rust); }
        .tag-gold { background: #fffbf0; color: #6b4f1e; } .tag-gold .tag-dot { background: var(--gold); }
        .highlight-box { background: var(--mist); border-left: 3px solid var(--moss); border-radius: 0 8px 8px 0; padding: 12px 14px; margin: 14px 0; font-size: 13px; color: var(--forest); line-height: 1.6; }
        .highlight-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: var(--sage); font-weight: 600; margin-bottom: 3px; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .info-card { background: var(--cream); border-radius: 10px; padding: 12px; display: flex; align-items: flex-start; gap: 8px; }
        .info-icon { font-size: 20px; flex-shrink: 0; }
        .info-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; color: #999; font-weight: 600; margin-bottom: 2px; }
        .info-value { font-size: 13px; color: var(--ink); font-weight: 500; }
        .empty-text { color: #bbb; font-size: 13px; font-style: italic; }
        .cal-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
        .cal-cell { background: var(--cream); border-radius: 8px; padding: 8px 6px; text-align: center; }
        .cal-cell-active { background: var(--mist); border: 1.5px solid var(--sage); }
        .cal-month { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--sage); margin-bottom: 3px; }
        .cal-text { font-size: 11px; color: var(--ink); line-height: 1.3; }

        /* MON JARDIN */
        .empty-jardin { text-align: center; padding: 80px 20px; }
        .empty-icon { font-size: 56px; margin-bottom: 14px; }
        .empty-title { font-family: 'Cormorant Garamond', serif; font-size: 22px; color: var(--forest); margin-bottom: 6px; }
        .empty-sub { color: #999; font-size: 14px; }

        .mois-card { background: var(--forest); border-radius: var(--r); padding: 16px 18px; margin-bottom: 16px; box-shadow: var(--shadow); }
        .mois-title { font-family: 'Cormorant Garamond', serif; font-size: 18px; color: white; font-weight: 700; margin-bottom: 12px; }
        .mois-item { display: flex; flex-direction: column; gap: 2px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.08); }
        .mois-item:last-child { border-bottom: none; }
        .mois-plante { font-size: 13px; font-weight: 600; color: var(--sage); }
        .mois-tache { font-size: 13px; color: rgba(255,255,255,0.7); }
        .mois-vide { color: rgba(255,255,255,0.4); font-size: 13px; font-style: italic; }

        .filters-row { margin-bottom: 10px; }
        .search-input { width: 100%; border: 1.5px solid rgba(0,0,0,0.1); border-radius: 10px; padding: 10px 14px; font-family: 'Outfit', sans-serif; font-size: 14px; outline: none; background: white; }
        .search-input:focus { border-color: var(--moss); }
        .cats-row { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; padding-bottom: 4px; margin-bottom: 14px; }
        .cats-row::-webkit-scrollbar { display: none; }
        .cat-btn { border: 1px solid rgba(0,0,0,0.1); background: white; border-radius: 20px; padding: 5px 12px; font-family: 'Outfit', sans-serif; font-size: 12px; cursor: pointer; white-space: nowrap; color: #666; transition: all 0.15s; }
        .cat-btn.active { background: var(--moss); color: white; border-color: var(--moss); }

        .jardin-grid { display: flex; flex-direction: column; gap: 10px; }
        .jardin-card { background: white; border-radius: var(--r); display: flex; gap: 14px; padding: 14px; box-shadow: var(--shadow); cursor: pointer; position: relative; transition: transform 0.15s; border: 1px solid rgba(0,0,0,0.06); }
        .jardin-card:hover { transform: translateY(-1px); }
        .jardin-card-img { width: 72px; height: 72px; border-radius: 10px; overflow: hidden; flex-shrink: 0; background: var(--mist); display: flex; align-items: center; justify-content: center; }
        .jardin-card-body { flex: 1; min-width: 0; }
        .jardin-card-name { font-family: 'Cormorant Garamond', serif; font-size: 17px; font-weight: 700; color: var(--ink); }
        .jardin-card-latin { font-size: 12px; color: #aaa; font-style: italic; margin-top: 1px; }
        .jardin-card-cat { display: inline-block; background: var(--mist); color: var(--moss); border-radius: 20px; padding: 2px 8px; font-size: 11px; font-weight: 500; margin-top: 5px; }
        .tache-badge { display: block; margin-top: 6px; font-size: 11px; color: var(--gold); font-weight: 500; }
        .jardin-delete { position: absolute; top: 10px; right: 10px; background: none; border: none; cursor: pointer; color: #ccc; font-size: 14px; padding: 4px; border-radius: 4px; transition: all 0.15s; }
        .jardin-delete:hover { background: #ffebee; color: var(--rust); }
        .jardin-count { text-align: center; color: #bbb; font-size: 12px; margin-top: 16px; }

        .back-btn { display: flex; align-items: center; gap: 6px; background: none; border: none; color: var(--moss); font-family: 'Outfit', sans-serif; font-size: 14px; cursor: pointer; padding: 0; margin-bottom: 16px; font-weight: 500; }
        .btn-danger { background: #ffebee; color: var(--rust); border: 1px solid rgba(139,58,30,0.2); border-radius: 8px; padding: 9px 16px; font-family: 'Outfit', sans-serif; font-size: 13px; cursor: pointer; }

        @media (max-width: 480px) {
          .info-grid { grid-template-columns: 1fr; }
          .cal-grid { grid-template-columns: repeat(3, 1fr); }
        }
      `}</style>

      <div className="header">
        <h1>Plante <em>Expert</em></h1>
        <p>Botaniste IA · Identification & Mon Jardin</p>
      </div>

      {activeNav === "identifier" && <IdentifierTab jardin={jardin} setJardin={setJardin} />}
      {activeNav === "jardin" && <MonJardinTab jardin={jardin} setJardin={setJardin} />}

      <nav className="bottom-nav">
        <button className={`nav-item ${activeNav === "identifier" ? "active" : ""}`} onClick={() => setActiveNav("identifier")}>
          <span className="nav-icon">🔍</span>
          Identifier
        </button>
        <button className={`nav-item ${activeNav === "jardin" ? "active" : ""}`} onClick={() => setActiveNav("jardin")}>
          <span className="nav-icon">🌳</span>
          Mon Jardin
          {jardin.length > 0 && <span className="nav-badge">{jardin.length}</span>}
        </button>
      </nav>
    </div>
  );
}
