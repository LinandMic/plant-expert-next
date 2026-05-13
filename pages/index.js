import { useState, useRef, useCallback } from "react";

const SECTIONS = [
  { key: "identite", label: "Identité", icon: "🌿" },
  { key: "maladies", label: "Maladies", icon: "🔬" },
  { key: "taille", label: "Taille", icon: "✂️" },
  { key: "nutriments", label: "Nutriments", icon: "🧪" },
  { key: "arrosage", label: "Arrosage", icon: "💧" },
  { key: "calendrier", label: "Calendrier", icon: "📅" },
];

const SYSTEM_PROMPT = `Tu es un expert botaniste et horticulteur francophone. 
Quand on te donne une photo ou un nom de plante, tu fournis une analyse complète structurée en JSON.

IMPORTANT : Réponds UNIQUEMENT en JSON valide, sans backticks, sans texte avant ou après.

Format exact attendu :
{
  "identite": {
    "nom_commun": "string",
    "nom_latin": "string",
    "famille": "string",
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
    "technique": "string (comment tailler)",
    "a_eviter": "string",
    "conseil_pro": "string"
  },
  "nutriments": {
    "besoins_principaux": ["N, P, K et autres besoins"],
    "engrais_recommande": "string",
    "periode_fertilisation": "string",
    "signes_carence": ["symptômes visibles de carences"],
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
}

Si c'est une photo et que la plante n'est pas identifiable avec certitude, indique confiance: "faible" et donne ton meilleure estimation.
Si le nom fourni est ambigu, analyse la plante la plus courante portant ce nom.`;

async function analyzeWithClaude(imageBase64, plantName) {
  const messages = [];
  const content = [];

  if (imageBase64) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: imageBase64 }
    });
    content.push({
      type: "text",
      text: plantName
        ? `Identifie et analyse cette plante. L'utilisateur pense que c'est : "${plantName}". Confirme ou corrige.`
        : "Identifie et analyse complètement cette plante."
    });
  } else {
    content.push({
      type: "text",
      text: `Analyse complète de la plante suivante : "${plantName}"`
    });
  }

  messages.push({ role: "user", content });

  const response = await fetch("/api/proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages
    })
  });

  if (!response.ok) throw new Error(`API error ${response.status}`);
  const data = await response.json();
  const text = data.content.map(b => b.text || "").join("");
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res(reader.result.split(",")[1]);
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
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

const MONTHS = [
  ["jan","Jan"],["fev","Fév"],["mar","Mar"],["avr","Avr"],["mai","Mai"],["jun","Jun"],
  ["jul","Jul"],["aou","Aoû"],["sep","Sep"],["oct","Oct"],["nov","Nov"],["dec","Déc"]
];

function CalendrierGrid({ data }) {
  return (
    <div className="cal-grid">
      {MONTHS.map(([key, label]) => (
        <div key={key} className="cal-cell">
          <div className="cal-month">{label}</div>
          <div className="cal-text">{data[key] || "—"}</div>
        </div>
      ))}
    </div>
  );
}

function TagList({ items, color = "green" }) {
  if (!items?.length) return <p className="empty-text">Aucune donnée</p>;
  return (
    <div className="tag-list">
      {items.map((item, i) => (
        <div key={i} className={`tag tag-${color}`}>
          <span className="tag-dot" />
          {item}
        </div>
      ))}
    </div>
  );
}

function InfoCard({ icon, label, value }) {
  return (
    <div className="info-card">
      <span className="info-icon">{icon}</span>
      <div>
        <div className="info-label">{label}</div>
        <div className="info-value">{value}</div>
      </div>
    </div>
  );
}

export default function Home() {
  const [plantName, setPlantName] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("identite");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();

  const handleFile = useCallback(async (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setResult(null);
    setError(null);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    handleFile(file);
  }, [handleFile]);

  const handleAnalyze = async () => {
    if (!imageFile && !plantName.trim()) {
      setError("Fournis une photo ou un nom de plante.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      let b64 = null;
      if (imageFile) b64 = await resizeImage(imageFile);
      const data = await analyzeWithClaude(b64, plantName.trim());
      setResult(data);
      setActiveTab("identite");
    } catch (e) {
      setError("Erreur d'analyse. Vérifie ta connexion ou réessaie.");
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setResult(null); setError(null);
    setImageFile(null); setImagePreview(null);
    setPlantName("");
  };

  return (
    <div className="app">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=Outfit:wght@300;400;500;600&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --ink: #0f1f0f;
          --forest: #1e3a1e;
          --moss: #3a6b3a;
          --sage: #7aad7a;
          --mist: #e8f0e8;
          --paper: #f4f2ed;
          --cream: #faf8f3;
          --gold: #c4962a;
          --gold-light: #f0d890;
          --rust: #8b3a1e;
          --sky: #2a5a8b;
          --r: 14px;
          --shadow-sm: 0 2px 8px rgba(15,31,15,0.08);
          --shadow-md: 0 6px 24px rgba(15,31,15,0.12);
          --shadow-lg: 0 16px 48px rgba(15,31,15,0.16);
        }

        body {
          font-family: 'Outfit', sans-serif;
          background: var(--paper);
          min-height: 100vh;
          color: var(--ink);
        }

        .app {
          min-height: 100vh;
          background: var(--paper);
          background-image:
            url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%233a6b3a' fill-opacity='0.03'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
        }

        /* HEADER */
        .header {
          background: var(--forest);
          padding: 36px 28px 28px;
          position: relative;
          overflow: hidden;
        }
        .header::after {
          content: '';
          position: absolute;
          bottom: -1px; left: 0; right: 0;
          height: 24px;
          background: var(--paper);
          clip-path: ellipse(55% 100% at 50% 100%);
        }
        .header-inner { max-width: 700px; margin: 0 auto; position: relative; z-index: 1; }
        .header-badge {
          display: inline-block;
          background: rgba(196,150,42,0.2);
          color: var(--gold-light);
          border: 1px solid rgba(196,150,42,0.3);
          padding: 4px 12px;
          border-radius: 20px;
          font-size: 11px;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          font-weight: 600;
          margin-bottom: 14px;
        }
        .header h1 {
          font-family: 'Cormorant Garamond', serif;
          font-size: 42px;
          font-weight: 700;
          color: white;
          line-height: 1.1;
          letter-spacing: -1px;
        }
        .header h1 em { color: var(--sage); font-style: normal; }
        .header p { color: rgba(255,255,255,0.55); font-size: 14px; margin-top: 8px; font-weight: 300; }

        /* MAIN */
        .main { max-width: 700px; margin: 0 auto; padding: 32px 20px 80px; }

        /* INPUT PANEL */
        .input-panel {
          background: white;
          border-radius: var(--r);
          overflow: hidden;
          box-shadow: var(--shadow-md);
          border: 1px solid rgba(15,31,15,0.07);
        }

        .drop-zone {
          border: 2px dashed rgba(58,107,58,0.25);
          border-radius: 10px;
          margin: 20px;
          padding: 32px 20px;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s;
          background: var(--mist);
          position: relative;
          overflow: hidden;
        }
        .drop-zone.drag-over { border-color: var(--moss); background: rgba(122,173,122,0.1); }
        .drop-zone:hover { border-color: var(--moss); }
        .drop-zone.has-image { padding: 0; border-style: solid; }

        .drop-preview {
          width: 100%;
          height: 220px;
          object-fit: cover;
          display: block;
          border-radius: 8px;
        }
        .drop-overlay {
          position: absolute;
          inset: 0;
          background: rgba(15,31,15,0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          transition: opacity 0.2s;
          border-radius: 8px;
        }
        .drop-zone:hover .drop-overlay { opacity: 1; }
        .drop-overlay span { color: white; font-size: 13px; font-weight: 500; }

        .drop-icon { font-size: 40px; margin-bottom: 10px; display: block; }
        .drop-title { font-family: 'Cormorant Garamond', serif; font-size: 18px; color: var(--forest); font-weight: 600; }
        .drop-sub { font-size: 12px; color: #888; margin-top: 4px; }

        .divider {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 0 20px;
          margin-bottom: 4px;
        }
        .divider-line { flex: 1; height: 1px; background: rgba(0,0,0,0.07); }
        .divider-text { font-size: 12px; color: #aaa; text-transform: uppercase; letter-spacing: 1px; }

        .name-row {
          display: flex;
          gap: 10px;
          padding: 16px 20px 20px;
        }
        .plant-input {
          flex: 1;
          border: 1.5px solid rgba(0,0,0,0.12);
          border-radius: 10px;
          padding: 12px 16px;
          font-family: 'Outfit', sans-serif;
          font-size: 15px;
          outline: none;
          transition: border-color 0.2s;
          background: var(--cream);
        }
        .plant-input:focus { border-color: var(--moss); }
        .plant-input::placeholder { color: #bbb; }

        .btn-analyze {
          background: var(--forest);
          color: white;
          border: none;
          border-radius: 10px;
          padding: 12px 24px;
          font-family: 'Outfit', sans-serif;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          white-space: nowrap;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .btn-analyze:hover:not(:disabled) { background: var(--moss); transform: translateY(-1px); box-shadow: var(--shadow-sm); }
        .btn-analyze:disabled { opacity: 0.6; cursor: not-allowed; }

        /* LOADING */
        .loading-state {
          text-align: center;
          padding: 60px 20px;
          animation: fadeIn 0.4s ease;
        }
        .leaf-spin {
          font-size: 52px;
          display: inline-block;
          animation: spin 2s linear infinite;
          margin-bottom: 16px;
        }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .loading-title {
          font-family: 'Cormorant Garamond', serif;
          font-size: 22px;
          color: var(--forest);
          margin-bottom: 6px;
        }
        .loading-sub { color: #888; font-size: 14px; }
        .loading-dots span { animation: blink 1.4s infinite both; }
        .loading-dots span:nth-child(2) { animation-delay: 0.2s; }
        .loading-dots span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes blink { 0%,80%,100% { opacity: 0; } 40% { opacity: 1; } }

        /* ERROR */
        .error-box {
          background: #fff5f5;
          border: 1px solid rgba(139,58,30,0.2);
          border-radius: 10px;
          padding: 14px 16px;
          color: var(--rust);
          font-size: 14px;
          margin: 16px 20px;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        /* RESULT */
        .result-panel {
          margin-top: 24px;
          animation: fadeIn 0.5s ease;
        }

        .plant-hero {
          background: var(--forest);
          border-radius: var(--r);
          overflow: hidden;
          box-shadow: var(--shadow-lg);
          position: relative;
        }
        .hero-content {
          padding: 28px 28px 0;
          display: flex;
          align-items: flex-start;
          gap: 20px;
        }
        .hero-img-wrap {
          width: 100px;
          height: 100px;
          border-radius: 12px;
          overflow: hidden;
          flex-shrink: 0;
          border: 2px solid rgba(255,255,255,0.2);
        }
        .hero-img { width: 100%; height: 100%; object-fit: cover; }
        .hero-no-img {
          width: 100px;
          height: 100px;
          border-radius: 12px;
          background: rgba(255,255,255,0.08);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 44px;
          flex-shrink: 0;
        }
        .hero-text { flex: 1; }
        .confidence-badge {
          display: inline-block;
          padding: 3px 10px;
          border-radius: 20px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.5px;
          margin-bottom: 8px;
        }
        .conf-élevée { background: rgba(122,173,122,0.25); color: var(--sage); }
        .conf-moyenne { background: rgba(196,150,42,0.2); color: var(--gold-light); }
        .conf-faible { background: rgba(139,58,30,0.2); color: #e8a080; }
        .hero-name {
          font-family: 'Cormorant Garamond', serif;
          font-size: 32px;
          font-weight: 700;
          color: white;
          line-height: 1.1;
        }
        .hero-latin {
          font-style: italic;
          color: rgba(255,255,255,0.5);
          font-size: 14px;
          margin-top: 4px;
        }
        .hero-family {
          color: rgba(255,255,255,0.35);
          font-size: 12px;
          margin-top: 2px;
          text-transform: uppercase;
          letter-spacing: 0.8px;
        }
        .hero-desc {
          color: rgba(255,255,255,0.7);
          font-size: 14px;
          line-height: 1.6;
          padding: 18px 28px;
          font-weight: 300;
        }

        /* TABS */
        .tabs-wrap {
          padding: 0 28px;
          border-top: 1px solid rgba(255,255,255,0.08);
        }
        .tabs {
          display: flex;
          gap: 0;
          overflow-x: auto;
          scrollbar-width: none;
        }
        .tabs::-webkit-scrollbar { display: none; }
        .tab {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding: 14px 16px 12px;
          color: rgba(255,255,255,0.4);
          cursor: pointer;
          border-bottom: 2px solid transparent;
          transition: all 0.2s;
          white-space: nowrap;
          font-size: 12px;
          font-weight: 500;
          background: none;
          border-left: none;
          border-right: none;
          border-top: none;
          font-family: 'Outfit', sans-serif;
        }
        .tab-icon { font-size: 18px; }
        .tab:hover { color: rgba(255,255,255,0.7); }
        .tab.active { color: var(--sage); border-bottom-color: var(--sage); }

        /* TAB CONTENT */
        .tab-content {
          background: white;
          border-radius: var(--r);
          margin-top: 16px;
          padding: 24px;
          box-shadow: var(--shadow-md);
          border: 1px solid rgba(15,31,15,0.07);
          animation: fadeIn 0.3s ease;
        }

        .section-title {
          font-family: 'Cormorant Garamond', serif;
          font-size: 22px;
          color: var(--forest);
          margin-bottom: 18px;
          font-weight: 700;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .tag-list { display: flex; flex-direction: column; gap: 6px; }
        .tag {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 10px 14px;
          border-radius: 8px;
          font-size: 14px;
          line-height: 1.5;
        }
        .tag-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          flex-shrink: 0;
          margin-top: 5px;
        }
        .tag-green { background: #f0f7f0; color: #2d5a2d; }
        .tag-green .tag-dot { background: var(--moss); }
        .tag-red { background: #fff5f3; color: #6b1e1e; }
        .tag-red .tag-dot { background: var(--rust); }
        .tag-gold { background: #fffbf0; color: #6b4f1e; }
        .tag-gold .tag-dot { background: var(--gold); }
        .tag-sky { background: #f0f5ff; color: #1e3a6b; }
        .tag-sky .tag-dot { background: var(--sky); }

        .highlight-box {
          background: var(--mist);
          border-left: 3px solid var(--moss);
          border-radius: 0 8px 8px 0;
          padding: 14px 16px;
          margin: 16px 0;
          font-size: 14px;
          color: var(--forest);
          line-height: 1.6;
        }
        .highlight-label {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 1px;
          color: var(--sage);
          font-weight: 600;
          margin-bottom: 4px;
        }

        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
        .info-card {
          background: var(--cream);
          border-radius: 10px;
          padding: 14px;
          display: flex;
          align-items: flex-start;
          gap: 10px;
        }
        .info-icon { font-size: 22px; flex-shrink: 0; }
        .info-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; color: #888; font-weight: 600; margin-bottom: 3px; }
        .info-value { font-size: 14px; color: var(--ink); font-weight: 500; }

        .subsection { margin-top: 20px; }
        .subsection-title { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; color: var(--sage); margin-bottom: 10px; }

        /* CALENDAR */
        .cal-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 8px;
        }
        .cal-cell {
          background: var(--cream);
          border-radius: 10px;
          padding: 10px 8px;
          text-align: center;
        }
        .cal-month { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--sage); margin-bottom: 4px; }
        .cal-text { font-size: 12px; color: var(--ink); line-height: 1.4; }

        .empty-text { color: #aaa; font-size: 14px; font-style: italic; }

        /* RESET */
        .reset-row { display: flex; justify-content: flex-end; margin-bottom: 16px; }
        .btn-reset {
          background: none;
          border: 1px solid rgba(0,0,0,0.12);
          border-radius: 8px;
          padding: 7px 14px;
          font-family: 'Outfit', sans-serif;
          font-size: 13px;
          cursor: pointer;
          color: #888;
          transition: all 0.15s;
        }
        .btn-reset:hover { background: rgba(0,0,0,0.04); color: var(--ink); }

        @media (max-width: 480px) {
          .info-grid { grid-template-columns: 1fr; }
          .cal-grid { grid-template-columns: repeat(3, 1fr); }
          .hero-name { font-size: 26px; }
          .header h1 { font-size: 32px; }
        }
      `}</style>

      <div className="header">
        <div className="header-inner">
          <div className="header-badge">Botaniste IA</div>
          <h1>Plante <em>Expert</em></h1>
          <p>Photo ou nom → diagnostic complet en quelques secondes</p>
        </div>
      </div>

      <div className="main">

        {!result && (
          <div className="input-panel">
            {/* DROP ZONE */}
            <div
              className={`drop-zone ${dragOver ? "drag-over" : ""} ${imagePreview ? "has-image" : ""}`}
              onClick={() => !imagePreview && fileRef.current.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              {imagePreview ? (
                <>
                  <img src={imagePreview} alt="Plante" className="drop-preview" />
                  <div className="drop-overlay" onClick={e => { e.stopPropagation(); fileRef.current.click(); }}>
                    <span>📷 Changer la photo</span>
                  </div>
                </>
              ) : (
                <>
                  <span className="drop-icon">📸</span>
                  <div className="drop-title">Dépose une photo ici</div>
                  <div className="drop-sub">ou clique pour choisir un fichier</div>
                </>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
              onChange={e => handleFile(e.target.files[0])} />

            <div className="divider">
              <div className="divider-line" />
              <span className="divider-text">ou</span>
              <div className="divider-line" />
            </div>

            <div className="name-row">
              <input
                className="plant-input"
                placeholder="Nom de la plante (ex: Rosier, Lavande, Chêne...)"
                value={plantName}
                onChange={e => setPlantName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAnalyze()}
              />
              <button className="btn-analyze" onClick={handleAnalyze} disabled={loading}>
                {loading ? "⏳" : "🔍"} Analyser
              </button>
            </div>

            {error && (
              <div className="error-box">⚠️ {error}</div>
            )}
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
          <div className="result-panel">
            <div className="reset-row">
              <button className="btn-reset" onClick={reset}>← Nouvelle analyse</button>
            </div>

            {/* HERO */}
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

              {/* TABS */}
              <div className="tabs-wrap">
                <div className="tabs">
                  {SECTIONS.slice(1).map(s => (
                    <button key={s.key} className={`tab ${activeTab === s.key ? "active" : ""}`} onClick={() => setActiveTab(s.key)}>
                      <span className="tab-icon">{s.icon}</span>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* TAB CONTENT */}
            <div className="tab-content">

              {activeTab === "maladies" && result.maladies && (
                <>
                  <div className="section-title">🔬 Maladies & Ravageurs</div>
                  <div className="subsection">
                    <div className="subsection-title">Vulnérabilités courantes</div>
                    <TagList items={result.maladies.vulnerabilites} color="red" />
                  </div>
                  <div className="subsection">
                    <div className="subsection-title">Symptômes à surveiller</div>
                    <TagList items={result.maladies.symptomes_alerte} color="gold" />
                  </div>
                  <div className="subsection">
                    <div className="subsection-title">Traitements</div>
                    <TagList items={result.maladies.traitements} color="green" />
                  </div>
                  {result.maladies.conseil_urgence && (
                    <div className="highlight-box">
                      <div className="highlight-label">⚡ Conseil d'urgence</div>
                      {result.maladies.conseil_urgence}
                    </div>
                  )}
                </>
              )}

              {activeTab === "taille" && result.taille && (
                <>
                  <div className="section-title">✂️ Taille</div>
                  <div className="info-grid">
                    <InfoCard icon="📅" label="Période idéale" value={result.taille.periode_ideale} />
                    <InfoCard icon="🔄" label="Fréquence" value={result.taille.frequence} />
                  </div>
                  <div className="highlight-box">
                    <div className="highlight-label">🛠 Technique</div>
                    {result.taille.technique}
                  </div>
                  {result.taille.a_eviter && (
                    <div className="subsection">
                      <div className="subsection-title">À éviter</div>
                      <TagList items={[result.taille.a_eviter]} color="red" />
                    </div>
                  )}
                  {result.taille.conseil_pro && (
                    <div className="highlight-box" style={{ borderLeftColor: "var(--gold)", background: "#fffbf0" }}>
                      <div className="highlight-label" style={{ color: "var(--gold)" }}>💡 Conseil pro</div>
                      {result.taille.conseil_pro}
                    </div>
                  )}
                </>
              )}

              {activeTab === "nutriments" && result.nutriments && (
                <>
                  <div className="section-title">🧪 Nutriments & Engrais</div>
                  <div className="subsection">
                    <div className="subsection-title">Besoins principaux</div>
                    <TagList items={result.nutriments.besoins_principaux} color="green" />
                  </div>
                  <div className="info-grid" style={{ marginTop: 16 }}>
                    <InfoCard icon="🌱" label="Engrais recommandé" value={result.nutriments.engrais_recommande} />
                    <InfoCard icon="⏰" label="Période" value={result.nutriments.periode_fertilisation} />
                  </div>
                  {result.nutriments.signes_carence?.length > 0 && (
                    <div className="subsection">
                      <div className="subsection-title">Signes de carence</div>
                      <TagList items={result.nutriments.signes_carence} color="gold" />
                    </div>
                  )}
                  {result.nutriments.surdosage_risques && (
                    <div className="highlight-box" style={{ borderLeftColor: "var(--rust)", background: "#fff8f6" }}>
                      <div className="highlight-label" style={{ color: "var(--rust)" }}>⚠️ Risque surdosage</div>
                      {result.nutriments.surdosage_risques}
                    </div>
                  )}
                </>
              )}

              {activeTab === "arrosage" && result.arrosage && (
                <>
                  <div className="section-title">💧 Arrosage</div>
                  <div className="info-grid">
                    <InfoCard icon="☀️" label="Été" value={result.arrosage.frequence_ete} />
                    <InfoCard icon="❄️" label="Hiver" value={result.arrosage.frequence_hiver} />
                  </div>
                  <div className="highlight-box">
                    <div className="highlight-label">💧 Méthode</div>
                    {result.arrosage.methode}
                  </div>
                  {result.arrosage.eau_ideale && (
                    <InfoCard icon="🚿" label="Eau idéale" value={result.arrosage.eau_ideale} />
                  )}
                  <div className="info-grid" style={{ marginTop: 12 }}>
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
        )}

      </div>
    </div>
  );
}
