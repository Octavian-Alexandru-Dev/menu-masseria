// Pannello di gestione del menù (login + editor). Questo file viene
// scaricato SOLO quando qualcuno clicca "Gestione menù" nel sito pubblico
// (caricamento differito, vedi React.lazy in MenuApp.jsx) — così i clienti
// che guardano solo il menù non scaricano mai Firebase Authentication.
import React, { useState } from "react";
import { Plus, Trash2, Save, Lock, LogOut, Eye, ChevronDown, ChevronUp, RotateCcw, ShieldCheck, AlertCircle, Star, Upload, ImageOff, Instagram, Facebook, ShoppingBag, Languages, Sparkles, Download, Printer } from "lucide-react";
import { auth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "./firebase-auth";
import { THEMES, ital, uid, GlobalStyle, Logo, LANGUAGES, generateMissingTranslations, countMissingTranslations, applyTranslation } from "./shared";
import { uploadMenuImage, optimizedImageUrl } from "./cloudinary";

// Legge e valida un file .json scelto per l'importazione: usato sia dal
// pannello Admin normale ("Importa JSON") sia dalla schermata di bootstrap
// quando il documento del menù non esiste ancora su Firestore. Controlla
// solo la forma minima necessaria a non mandare in crash l'editor o a
// salvare dati corrotti — non valida ogni singolo campo.
function parseMenuJsonFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error("Nessun file selezionato.")); return; }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          throw new Error("Il file non ha la struttura di un menù valido.");
        }
        if (!Array.isArray(data.categories)) {
          throw new Error("Il file non ha la struttura di un menù valido (manca 'categories').");
        }
        for (const cat of data.categories) {
          if (!cat || !Array.isArray(cat.items)) {
            throw new Error("Una categoria nel file non ha un elenco di voci ('items') valido.");
          }
        }
        resolve(data);
      } catch (err) {
        reject(err instanceof SyntaxError ? new Error("Il file non è un JSON valido.") : err);
      }
    };
    reader.onerror = () => reject(new Error("Impossibile leggere il file."));
    reader.readAsText(file);
  });
}

function AdminLogin({ onBack, theme }) {
  const t = THEMES[theme] || THEMES.rustica;
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      // onAuthStateChanged nel componente App si accorgerà del login riuscito
      // e passerà automaticamente alla vista di gestione.
      await signInWithEmailAndPassword(auth, email.trim(), pass);
    } catch (err) {
      const code = err && err.code;
      if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
        setError("Email o password non corretti.");
      } else if (code === "auth/invalid-email") {
        setError("Indirizzo email non valido.");
      } else if (code === "auth/too-many-requests") {
        setError("Troppi tentativi. Riprova tra qualche minuto.");
      } else {
        setError("Accesso non riuscito. Riprova.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mdp-root" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <GlobalStyle t={t} />
      <form onSubmit={submit} style={{
        background: t.card, border: `1px solid ${t.line}`, borderRadius: 10,
        padding: "36px 30px", width: "100%", maxWidth: 340, boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
      }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
          <Logo width={140} />
        </div>
        <div className="mdp-display" style={{ textAlign: "center", fontStyle: ital(t), fontSize: 22, fontWeight: 600, color: t.primary }}>
          Gestione menù
        </div>
        <div style={{ textAlign: "center", fontSize: 12.5, color: t.inkSoft, marginTop: 6, marginBottom: 22 }}>
          Accedi per modificare il menù di Masseria della Piana
        </div>

        <label style={{ fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: t.inkSoft }}>Email</label>
        <input
          type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus
          style={{ width: "100%", padding: "10px 12px", marginTop: 6, marginBottom: 16, border: `1px solid ${t.line}`, borderRadius: 6, background: t.bg, color: t.ink, fontSize: 14 }}
        />
        <label style={{ fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: t.inkSoft }}>Password</label>
        <input
          type="password" value={pass} onChange={(e) => setPass(e.target.value)}
          style={{ width: "100%", padding: "10px 12px", marginTop: 6, marginBottom: 8, border: `1px solid ${t.line}`, borderRadius: 6, background: t.bg, color: t.ink, fontSize: 14 }}
        />

        {error && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", color: t.accent2, fontSize: 12.5, marginTop: 8 }}>
            <AlertCircle size={14} /> {error}
          </div>
        )}

        <button type="submit" disabled={busy} className="mdp-btn" style={{
          width: "100%", marginTop: 18, padding: "11px 0", background: t.primary, color: t.bg,
          border: "none", borderRadius: 6, fontSize: 13.5, letterSpacing: 1, textTransform: "uppercase",
          cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}>
          <Lock size={14} /> {busy ? "Accesso…" : "Accedi"}
        </button>

        <button type="button" onClick={onBack} className="mdp-btn" style={{
          width: "100%", marginTop: 10, padding: "9px 0", background: "none",
          border: "none", color: t.inkSoft, fontSize: 12.5, cursor: "pointer",
        }}>
          ← Torna al menù
        </button>
      </form>
    </div>
  );
}

// Mostrata dopo il login quando il documento del menù non esiste ancora su
// Firestore (prima configurazione, o database ripristinato): non c'è più un
// menù di esempio da caricare al suo posto (rimosso volutamente), quindi
// l'unico modo di procedere è importare un backup JSON esportato in
// precedenza da questo stesso pannello.
function AdminBootstrap({ onImport, onExit, importError }) {
  const t = THEMES.rustica;
  return (
    <div className="mdp-root" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 20, minHeight: "100vh" }}>
      <GlobalStyle t={t} />
      <div style={{ background: t.card, border: `1px solid ${t.line}`, borderRadius: 10, padding: "32px 28px", width: "100%", maxWidth: 420, textAlign: "center", boxShadow: "0 10px 30px rgba(0,0,0,0.08)" }}>
        <div className="mdp-display" style={{ fontStyle: ital(t), fontSize: 20, fontWeight: 600, color: t.primary, marginBottom: 10 }}>
          Nessun menù trovato
        </div>
        <div style={{ fontSize: 13, color: t.inkSoft, marginBottom: 20, lineHeight: 1.5 }}>
          Il documento del menù non esiste ancora su Firestore. Importa un backup JSON per iniziare — potrai rivedere tutto prima di salvarlo.
        </div>
        <label className="mdp-btn" style={{ ...btnPrimary(t), cursor: "pointer", margin: "0 auto", width: "fit-content" }}>
          <Upload size={13} /> Importa da JSON
          <input
            type="file" accept="application/json" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; onImport(f); }}
          />
        </label>
        {importError && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "center", color: t.accent2, fontSize: 12.5, marginTop: 14 }}>
            <AlertCircle size={14} /> {importError}
          </div>
        )}
        <button onClick={onExit} className="mdp-btn" style={{ width: "100%", marginTop: 16, padding: "9px 0", background: "none", border: "none", color: t.inkSoft, fontSize: 12.5, cursor: "pointer" }}>
          ← Torna al menù
        </button>
      </div>
    </div>
  );
}

/* ============================== ADMIN DASHBOARD ============================== */
function AdminPanel({ menu, setMenu, onSave, saving, savedAt, saveError, onLogout, onPreview, onUndo, canUndo }) {
  const t = THEMES[menu.theme] || THEMES.rustica;
  const [openCats, setOpenCats] = useState(() => new Set());
  const [confirmDelete, setConfirmDelete] = useState(null); // {type:'cat'|'item', catId, itemId}
  const [uploadingItem, setUploadingItem] = useState(null); // id della voce con upload in corso
  const [uploadErrors, setUploadErrors] = useState({}); // { [itemId]: messaggio }
  const [lang, setLang] = useState("it"); // lingua correntemente mostrata/editata nell'editor
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [confirmDeleteTranslation, setConfirmDeleteTranslation] = useState(false);
  const [importError, setImportError] = useState("");
  const [pdfLang, setPdfLang] = useState("it");
  const [pdfImages, setPdfImages] = useState(false);
  const [pdfError, setPdfError] = useState("");
  // Opzioni di impaginazione/contenuto del PDF, lasciate all'amministratore
  // che stampa (non c'è un unico layout giusto per tutti: dipende da quante
  // pagine si vogliono, se serve un menù senza prezzi per un evento, ecc.).
  // Di default una categoria può continuare su una nuova pagina se non entra
  // tutta in quella corrente (le voci che entrano restano al loro posto,
  // niente spazio bianco lasciato apposta). Attivando questa opzione si
  // torna al comportamento "una categoria non si spezza mai": se non entra
  // tutta, salta per intero alla pagina dopo, lasciando eventualmente spazio
  // vuoto in quella precedente.
  const [pdfAvoidCategorySplit, setPdfAvoidCategorySplit] = useState(false);
  const [pdfColumns, setPdfColumns] = useState(1); // 1 o 2 colonne per le voci di ogni categoria
  const [pdfPaperSize, setPdfPaperSize] = useState("A4");
  const [pdfShowPrices, setPdfShowPrices] = useState(true);
  const [pdfShowTags, setPdfShowTags] = useState(true);
  const [pdfShowSubtitles, setPdfShowSubtitles] = useState(true);
  const [pdfShowFooter, setPdfShowFooter] = useState(true); // nota a piè di pagina + contatti social
  const [pdfShowDate, setPdfShowDate] = useState(false);
  const [pdfExcludedCats, setPdfExcludedCats] = useState(() => new Set()); // categorie deselezionate per l'export

  const togglePdfCat = (catId) => {
    setPdfExcludedCats((prev) => {
      const next = new Set(prev);
      next.has(catId) ? next.delete(catId) : next.add(catId);
      return next;
    });
  };

  const changeLang = (code) => {
    setLang(code);
    setConfirmDeleteTranslation(false);
  };

  const toggleCat = (id) => {
    setOpenCats((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const updateField = (field, value) => setMenu((m) => ({ ...m, [field]: value }));

  // Aggiorna un link esterno (url o visibilità) dentro un gruppo di link del
  // menù, es. group="reviewLinks", key="google" oppure group="socialLinks", key="instagram".
  const updateLink = (group, key, field, value) => {
    setMenu((m) => {
      const current = m[group] || {};
      const currentEntry = current[key] || { url: "", visible: false };
      return {
        ...m,
        [group]: {
          ...current,
          [key]: { ...currentEntry, [field]: value },
        },
      };
    });
  };

  const updateCategory = (catId, field, value) => {
    setMenu((m) => ({
      ...m,
      categories: m.categories.map((c) => (c.id === catId ? { ...c, [field]: value } : c)),
    }));
  };

  const updateItem = (catId, itemId, field, value) => {
    setMenu((m) => ({
      ...m,
      categories: m.categories.map((c) =>
        c.id === catId
          ? { ...c, items: c.items.map((it) => (it.id === itemId ? { ...it, [field]: value } : it)) }
          : c
      ),
    }));
  };

  // Aggiorna un campo tradotto (lingua correntemente selezionata, mai l'italiano).
  const updateTranslationField = (field, value) => {
    setMenu((m) => ({
      ...m,
      translations: { ...m.translations, [lang]: { ...(m.translations?.[lang] || {}), [field]: value } },
    }));
  };

  const updateTranslationCategory = (catId, field, value) => {
    setMenu((m) => {
      const langData = m.translations?.[lang] || {};
      const categories = langData.categories || {};
      const cat = categories[catId] || {};
      return {
        ...m,
        translations: {
          ...m.translations,
          [lang]: { ...langData, categories: { ...categories, [catId]: { ...cat, [field]: value } } },
        },
      };
    });
  };

  const updateTranslationItem = (catId, itemId, field, value) => {
    setMenu((m) => {
      const langData = m.translations?.[lang] || {};
      const categories = langData.categories || {};
      const cat = categories[catId] || {};
      const items = cat.items || {};
      const item = items[itemId] || {};
      return {
        ...m,
        translations: {
          ...m.translations,
          [lang]: {
            ...langData,
            categories: {
              ...categories,
              [catId]: { ...cat, items: { ...items, [itemId]: { ...item, [field]: value } } },
            },
          },
        },
      };
    });
  };

  const handleGenerateTranslation = async () => {
    setGenerating(true);
    setGenerateError("");
    try {
      const updated = await generateMissingTranslations(menu, lang, menu.translations?.[lang]);
      setMenu((m) => ({ ...m, translations: { ...m.translations, [lang]: updated } }));
    } catch (err) {
      setGenerateError("Generazione non riuscita. Riprova.");
    } finally {
      setGenerating(false);
    }
  };

  // Elimina l'intera bozza di traduzione della lingua corrente (in modo che si
  // possa rigenerare da capo con "Genera traduzione automatica"). Non tocca
  // l'italiano: il pulsante è disponibile solo quando lang !== "it".
  const handleDeleteTranslation = () => {
    setMenu((m) => {
      if (!m.translations || !(lang in m.translations)) return m;
      const next = { ...m.translations };
      delete next[lang];
      return { ...m, translations: next };
    });
    setConfirmDeleteTranslation(false);
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(menu, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `menu-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleImportJsonFile = (file) => {
    if (!file) return;
    setImportError("");
    parseMenuJsonFile(file)
      .then((data) => setMenu(data))
      .catch((err) => setImportError(err.message || "File non valido."));
  };

  // Apre in una nuova scheda l'anteprima di stampa (src/PrintMenu.jsx) con
  // solo le voci visibili ai clienti, nella lingua e con le immagini scelte
  // qui. Il menù viene passato tramite sessionStorage (condiviso con la
  // nuova scheda perché aperta via window.open dalla stessa origine) invece
  // che rileggendolo da Firestore, così riflette anche modifiche non ancora
  // salvate.
  const handleExportPdf = () => {
    const translated = pdfLang === "it" ? menu : applyTranslation(menu, menu.translations?.[pdfLang]);
    const categories = translated.categories
      .filter((c) => c.visible !== false && !pdfExcludedCats.has(c.id))
      .map((c) => ({
        id: c.id,
        name: c.name,
        subtitle: pdfShowSubtitles ? c.subtitle : "",
        items: c.items
          .filter((it) => it.visible !== false)
          .map((it) => ({
            id: it.id,
            name: it.name,
            price: pdfShowPrices ? it.price : "",
            tag: pdfShowTags ? (it.tag || "") : "",
            description: it.description || "",
            image: pdfImages ? (it.image || "") : "",
          })),
      }))
      .filter((c) => c.items.length > 0);

    const payload = {
      restaurantName: translated.restaurantName,
      tagline: translated.tagline,
      location: menu.location,
      footerNote: pdfShowFooter ? translated.footerNote : "",
      theme: menu.theme,
      lang: pdfLang,
      socialLinks: pdfShowFooter ? menu.socialLinks : null,
      includeImages: pdfImages,
      avoidCategorySplit: pdfAvoidCategorySplit,
      columns: pdfColumns,
      paperSize: pdfPaperSize,
      generatedDate: pdfShowDate ? new Date().toLocaleDateString(pdfLang === "it" ? "it-IT" : pdfLang) : "",
      categories,
    };

    setPdfError("");
    if (categories.length === 0) {
      setPdfError("Nessuna voce da stampare con le opzioni scelte (controlla le categorie selezionate).");
      return;
    }
    try {
      sessionStorage.setItem("mdp-print-payload", JSON.stringify(payload));
    } catch (err) {
      setPdfError("Impossibile preparare l'anteprima di stampa (memoria del browser piena).");
      return;
    }
    window.open(window.location.pathname + "?print=1", "_blank");
  };

  const handleImageUpload = async (catId, itemId, file) => {
    if (!file) return;
    setUploadingItem(itemId);
    setUploadErrors((prev) => ({ ...prev, [itemId]: undefined }));
    try {
      const url = await uploadMenuImage(file);
      updateItem(catId, itemId, "image", url);
    } catch (err) {
      setUploadErrors((prev) => ({ ...prev, [itemId]: err.message || "Caricamento non riuscito." }));
    } finally {
      setUploadingItem(null);
    }
  };

  const addItem = (catId) => {
    setMenu((m) => ({
      ...m,
      categories: m.categories.map((c) =>
        c.id === catId
          ? { ...c, items: [...c.items, { id: uid(), name: "Nuova voce", price: "0,00", description: "", image: "", visible: true }] }
          : c
      ),
    }));
  };

  const removeItem = (catId, itemId) => {
    setMenu((m) => ({
      ...m,
      categories: m.categories.map((c) =>
        c.id === catId ? { ...c, items: c.items.filter((it) => it.id !== itemId) } : c
      ),
    }));
    setConfirmDelete(null);
  };

  const addCategory = () => {
    const id = "cat-" + uid();
    setMenu((m) => ({ ...m, categories: [...m.categories, { id, name: "Nuova categoria", subtitle: "", visible: true, items: [] }] }));
    setOpenCats((prev) => new Set(prev).add(id));
  };

  const removeCategory = (catId) => {
    setMenu((m) => ({ ...m, categories: m.categories.filter((c) => c.id !== catId) }));
    setConfirmDelete(null);
  };

  const google = menu.reviewLinks?.google || { url: "", visible: false };
  const tripadvisor = menu.reviewLinks?.tripadvisor || { url: "", visible: false };
  const instagram = menu.socialLinks?.instagram || { url: "", visible: false };
  const facebook = menu.socialLinks?.facebook || { url: "", visible: false };
  const shop = menu.socialLinks?.shop || { url: "", visible: false };

  const inputStyle = {
    width: "100%", padding: "8px 10px", border: `1px solid ${t.line}`, borderRadius: 6,
    background: t.bg, color: t.ink, fontSize: 13.5,
  };
  const labelStyle = { fontSize: 10, letterSpacing: 0.8, textTransform: "uppercase", color: t.inkSoft, display: "block", marginBottom: 4 };

  return (
    <div className="mdp-root">
      <GlobalStyle t={t} />

      {/* Top bar */}
      <div style={{
        position: "sticky", top: 0, zIndex: 20, background: t.card, borderBottom: `1px solid ${t.line}`,
        padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Logo width={56} />
          <div>
            <div className="mdp-display" style={{ fontStyle: ital(t), fontSize: 17, fontWeight: 600 }}>Gestione menù</div>
            <div style={{ fontSize: 10.5, color: t.inkSoft }}>{menu.restaurantName}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className="mdp-btn"
            style={{ ...btnGhost(t), opacity: canUndo ? 1 : 0.5, cursor: canUndo ? "pointer" : "default" }}
            title="Annulla l'ultima modifica"
          >
            <RotateCcw size={13} /> Annulla
          </button>
          <button onClick={onPreview} className="mdp-btn" style={btnGhost(t)}>
            <Eye size={13} /> Anteprima
          </button>
          <button onClick={onSave} disabled={saving} className="mdp-btn" style={btnPrimary(t)}>
            <Save size={13} /> {saving ? "Salvataggio…" : "Salva modifiche"}
          </button>
          <button onClick={onLogout} className="mdp-btn" style={btnGhost(t)}>
            <LogOut size={13} /> Esci
          </button>
        </div>
      </div>

 {(savedAt || saveError) && (
        <div style={{
          padding: saveError ? "12px 20px" : "8px 20px",
          fontSize: saveError ? 13 : 12,
          display: "flex", alignItems: "flex-start", gap: 8,
          color: saveError ? "#fff" : t.secondary,
          background: saveError ? t.accent2 : "transparent",
          fontWeight: saveError ? 500 : 400,
          lineHeight: 1.4,
        }}>
          {saveError ? <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} /> : <ShieldCheck size={13} />}
          <span>{saveError ? saveError : `Salvato alle ${savedAt}`}</span>
        </div>
      )}

      <div style={{ maxWidth: 780, margin: "0 auto", padding: "24px 20px 100px" }}>
        {/* Identity + theme */}
        <div style={{ background: t.card, border: `1px solid ${t.line}`, borderRadius: 10, padding: 20, marginBottom: 24 }}>
          <div style={{ fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: t.secondary, marginBottom: 14 }}>
            Identità del locale
          </div>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <span style={labelStyle}>Nome del ristorante</span>
              <input style={inputStyle} value={menu.restaurantName} onChange={(e) => updateField("restaurantName", e.target.value)} />
            </div>
            <div>
              <span style={labelStyle}>Località</span>
              <input style={inputStyle} value={menu.location} onChange={(e) => updateField("location", e.target.value)} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <span style={labelStyle}>Frase di apertura</span>
              <input style={inputStyle} value={menu.tagline} onChange={(e) => updateField("tagline", e.target.value)} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <span style={labelStyle}>Nota a piè di pagina</span>
              <input style={inputStyle} value={menu.footerNote || ""} onChange={(e) => updateField("footerNote", e.target.value)} />
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <span style={labelStyle}>Grafica</span>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
              {Object.entries(THEMES).map(([key, th]) => (
                <button
                  key={key}
                  onClick={() => updateField("theme", key)}
                  className="mdp-btn"
                  style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
                    borderRadius: 8, cursor: "pointer",
                    border: menu.theme === key ? `2px solid ${t.primary}` : `1px solid ${t.line}`,
                    background: th.bg,
                  }}
                >
                  <span style={{ width: 14, height: 14, borderRadius: "50%", background: th.primary, display: "inline-block" }} />
                  <span style={{ fontSize: 12, color: th.ink }}>{th.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Recensioni */}
        <div style={{ background: t.card, border: `1px solid ${t.line}`, borderRadius: 10, padding: 20, marginBottom: 24 }}>
          <div style={{ fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: t.secondary, marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
            <Star size={13} /> Pulsanti recensioni
          </div>
          <div style={{ display: "grid", gap: 18 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={labelStyle}>Link recensione Google</span>
                <Toggle
                  t={t}
                  checked={google.visible === true}
                  onChange={(v) => updateLink("reviewLinks", "google", "visible", v)}
                  label="Visibile ai clienti"
                />
              </div>
              <input
                style={inputStyle}
                placeholder="https://g.page/r/…/review"
                value={google.url}
                onChange={(e) => updateLink("reviewLinks", "google", "url", e.target.value)}
              />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={labelStyle}>Link recensione TripAdvisor</span>
                <Toggle
                  t={t}
                  checked={tripadvisor.visible === true}
                  onChange={(v) => updateLink("reviewLinks", "tripadvisor", "visible", v)}
                  label="Visibile ai clienti"
                />
              </div>
              <input
                style={inputStyle}
                placeholder="https://www.tripadvisor.it/UserReview…"
                value={tripadvisor.url}
                onChange={(e) => updateLink("reviewLinks", "tripadvisor", "url", e.target.value)}
              />
            </div>
          </div>
          <div style={{ fontSize: 11, color: t.inkSoft, marginTop: 12, lineHeight: 1.4 }}>
            I pulsanti compaiono nel piè di pagina del menù solo quando sono attivi e hanno un link impostato.
          </div>
        </div>

        {/* Social e shop */}
        <div style={{ background: t.card, border: `1px solid ${t.line}`, borderRadius: 10, padding: 20, marginBottom: 24 }}>
          <div style={{ fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: t.secondary, marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
            <ShoppingBag size={13} /> Social e shop online
          </div>
          <div style={{ display: "grid", gap: 18 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={labelStyle}><Instagram size={11} style={{ verticalAlign: -1, marginRight: 4 }} />Link profilo Instagram</span>
                <Toggle
                  t={t}
                  checked={instagram.visible === true}
                  onChange={(v) => updateLink("socialLinks", "instagram", "visible", v)}
                  label="Visibile ai clienti"
                />
              </div>
              <input
                style={inputStyle}
                placeholder="https://www.instagram.com/…"
                value={instagram.url}
                onChange={(e) => updateLink("socialLinks", "instagram", "url", e.target.value)}
              />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={labelStyle}><Facebook size={11} style={{ verticalAlign: -1, marginRight: 4 }} />Link pagina Facebook</span>
                <Toggle
                  t={t}
                  checked={facebook.visible === true}
                  onChange={(v) => updateLink("socialLinks", "facebook", "visible", v)}
                  label="Visibile ai clienti"
                />
              </div>
              <input
                style={inputStyle}
                placeholder="https://www.facebook.com/…"
                value={facebook.url}
                onChange={(e) => updateLink("socialLinks", "facebook", "url", e.target.value)}
              />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={labelStyle}><ShoppingBag size={11} style={{ verticalAlign: -1, marginRight: 4 }} />Link shop online</span>
                <Toggle
                  t={t}
                  checked={shop.visible === true}
                  onChange={(v) => updateLink("socialLinks", "shop", "visible", v)}
                  label="Visibile ai clienti"
                />
              </div>
              <input
                style={inputStyle}
                placeholder="https://…"
                value={shop.url}
                onChange={(e) => updateLink("socialLinks", "shop", "url", e.target.value)}
              />
            </div>
          </div>
          <div style={{ fontSize: 11, color: t.inkSoft, marginTop: 12, lineHeight: 1.4 }}>
            I pulsanti compaiono nel piè di pagina del menù, insieme a quelli delle recensioni, solo quando sono attivi e hanno un link impostato.
          </div>
        </div>

        {/* Selettore lingua: sceglie se sotto si edita il testo italiano (sorgente,
            struttura completa) o la traduzione di una lingua (solo testo). */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: t.inkSoft }}>
            <Languages size={13} /> Lingua:
          </span>
          {LANGUAGES.map((l) => {
            const missing = l.code === "it" ? 0 : countMissingTranslations(menu, menu.translations?.[l.code]);
            const hasTranslation = l.code === "it" || !!menu.translations?.[l.code];
            return (
              <button
                key={l.code}
                onClick={() => changeLang(l.code)}
                className="mdp-btn"
                style={{
                  border: `1px solid ${t.line}`,
                  background: lang === l.code ? t.primary : "transparent",
                  color: lang === l.code ? t.bg : t.inkSoft,
                  borderRadius: 20, padding: "5px 12px", fontSize: 12, cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 5,
                }}
              >
                {l.label}
                {hasTranslation && missing > 0 && (
                  <span style={{
                    fontSize: 9.5, minWidth: 14, height: 14, borderRadius: 8, padding: "0 4px",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    background: lang === l.code ? t.bg : t.accent2, color: lang === l.code ? t.primary : "#fff",
                  }}>
                    {missing}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {lang !== "it" && (
          <TranslationEditor
            t={t}
            menu={menu}
            lang={lang}
            translation={menu.translations?.[lang]}
            generating={generating}
            generateError={generateError}
            onGenerate={handleGenerateTranslation}
            confirmDelete={confirmDeleteTranslation}
            onRequestDelete={() => setConfirmDeleteTranslation(true)}
            onCancelDelete={() => setConfirmDeleteTranslation(false)}
            onConfirmDelete={handleDeleteTranslation}
            updateTranslationField={updateTranslationField}
            updateTranslationCategory={updateTranslationCategory}
            updateTranslationItem={updateTranslationItem}
            inputStyle={inputStyle}
            labelStyle={labelStyle}
          />
        )}

        {/* Categories (testo sorgente in italiano + struttura: aggiungere/eliminare
            voci, caricare foto, riordinare la visibilità — tutto ciò che le
            traduzioni condividono per riferimento tramite id) */}
        {lang === "it" && menu.categories.map((cat) => {
          const isOpen = openCats.has(cat.id);
          const catDelete = confirmDelete?.type === "cat" && confirmDelete.catId === cat.id;
          return (
            <div key={cat.id} style={{ background: t.card, border: `1px solid ${t.line}`, borderRadius: 10, marginBottom: 16, overflow: "hidden", opacity: cat.visible === false ? 0.6 : 1 }}>
              <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, cursor: "pointer" }} onClick={() => toggleCat(cat.id)}>
                  {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  <div style={{ flex: 1 }}>
                    <div className="mdp-display" style={{ fontStyle: ital(t), fontSize: 16, fontWeight: 600 }}>{cat.name || "Senza nome"}</div>
                    <div style={{ fontSize: 11, color: t.inkSoft }}>{cat.items.length} voci {cat.visible === false && "· nascosta ai clienti"}</div>
                  </div>
                </div>
                <Toggle
                  t={t}
                  checked={cat.visible !== false}
                  onChange={(v) => updateCategory(cat.id, "visible", v)}
                  label="Visibile ai clienti"
                />
                <button
                  onClick={(e) => { e.stopPropagation(); catDelete ? removeCategory(cat.id) : setConfirmDelete({ type: "cat", catId: cat.id }); }}
                  className="mdp-btn"
                  style={{ ...btnGhost(t), color: t.accent2, fontSize: 11 }}
                >
                  <Trash2 size={13} /> {catDelete ? "Conferma?" : ""}
                </button>
              </div>

              {isOpen && (
                <div style={{ padding: "0 16px 16px" }}>
                  <hr className="mdp-hairline" style={{ marginBottom: 14 }} />
                  <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr", marginBottom: 14 }}>
                    <div>
                      <span style={labelStyle}>Nome categoria</span>
                      <input style={inputStyle} value={cat.name} onChange={(e) => updateCategory(cat.id, "name", e.target.value)} />
                    </div>
                    <div>
                      <span style={labelStyle}>Sottotitolo</span>
                      <input style={inputStyle} value={cat.subtitle} onChange={(e) => updateCategory(cat.id, "subtitle", e.target.value)} />
                    </div>
                  </div>

                  {cat.items.map((item) => {
                    const itDelete = confirmDelete?.type === "item" && confirmDelete.itemId === item.id;
                    return (
                      <div key={item.id} style={{ border: `1px solid ${t.line}`, borderRadius: 8, padding: 12, marginBottom: 10, background: t.bg, opacity: item.visible === false ? 0.6 : 1 }}>
                        <div style={{ display: "flex", gap: 12, marginBottom: 10, alignItems: "flex-start" }}>
                          {item.image ? (
                            <img src={optimizedImageUrl(item.image, { width: 112 })} alt={item.name} style={{ width: 56, height: 56, borderRadius: 8, objectFit: "contain", background: t.bgAlt, border: `1px solid ${t.line}`, flexShrink: 0 }} />
                          ) : (
                            <div style={{ width: 56, height: 56, borderRadius: 8, border: `1px dashed ${t.line}`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: t.inkSoft, textAlign: "center" }}>
                              nessuna foto
                            </div>
                          )}
                          <div style={{ flex: 1 }}>
                            <span style={labelStyle}>Foto del piatto</span>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <label
                                className="mdp-btn"
                                style={{ ...btnGhost(t), cursor: uploadingItem === item.id ? "default" : "pointer", opacity: uploadingItem === item.id ? 0.6 : 1 }}
                              >
                                <Upload size={12} />
                                {uploadingItem === item.id ? "Caricamento…" : item.image ? "Sostituisci foto" : "Carica foto"}
                                <input
                                  type="file" accept="image/*" style={{ display: "none" }}
                                  disabled={uploadingItem === item.id}
                                  onChange={(e) => {
                                    const file = e.target.files && e.target.files[0];
                                    e.target.value = ""; // permette di ricaricare lo stesso file
                                    handleImageUpload(cat.id, item.id, file);
                                  }}
                                />
                              </label>
                              {item.image && (
                                <button
                                  type="button"
                                  onClick={() => updateItem(cat.id, item.id, "image", "")}
                                  className="mdp-btn"
                                  style={{ ...btnGhost(t), color: t.accent2 }}
                                >
                                  <ImageOff size={12} /> Rimuovi
                                </button>
                              )}
                            </div>
                            {uploadErrors[item.id] && (
                              <div style={{ display: "flex", gap: 5, alignItems: "center", color: t.accent2, fontSize: 11.5, marginTop: 6 }}>
                                <AlertCircle size={12} /> {uploadErrors[item.id]}
                              </div>
                            )}
                          </div>
                        </div>

                        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "2fr 1fr 1fr" }}>
                          <div>
                            <span style={labelStyle}>Nome piatto</span>
                            <input style={inputStyle} value={item.name} onChange={(e) => updateItem(cat.id, item.id, "name", e.target.value)} />
                          </div>
                          <div>
                            <span style={labelStyle}>Prezzo (o "SU RICHIESTA")</span>
                            <input style={inputStyle} value={item.price} onChange={(e) => updateItem(cat.id, item.id, "price", e.target.value)} />
                          </div>
                          <div>
                            <span style={labelStyle}>Etichetta (facolt.)</span>
                            <input style={inputStyle} placeholder="es. ROSSO" value={item.tag || ""} onChange={(e) => updateItem(cat.id, item.id, "tag", e.target.value)} />
                          </div>
                        </div>
                        <div style={{ marginTop: 10 }}>
                          <span style={labelStyle}>Descrizione</span>
                          <textarea rows={2} style={{ ...inputStyle, resize: "vertical" }} value={item.description || ""} onChange={(e) => updateItem(cat.id, item.id, "description", e.target.value)} />
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                          <Toggle
                            t={t}
                            checked={item.visible !== false}
                            onChange={(v) => updateItem(cat.id, item.id, "visible", v)}
                            label={item.visible === false ? "Nascosto ai clienti" : "Visibile ai clienti"}
                          />
                          <button
                            onClick={() => (itDelete ? removeItem(cat.id, item.id) : setConfirmDelete({ type: "item", itemId: item.id, catId: cat.id }))}
                            className="mdp-btn"
                            style={{ ...btnGhost(t), color: t.accent2 }}
                          >
                            <Trash2 size={12} /> {itDelete ? "Conferma eliminazione" : "Elimina voce"}
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  <button onClick={() => addItem(cat.id)} className="mdp-btn" style={btnGhost(t)}>
                    <Plus size={13} /> Aggiungi voce
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {lang === "it" && (
          <button onClick={addCategory} className="mdp-btn" style={{ ...btnPrimary(t), width: "100%", justifyContent: "center" }}>
            <Plus size={14} /> Aggiungi categoria
          </button>
        )}

        {/* Esportazione/importazione JSON (backup manuale) e versione
            stampabile in PDF (tramite la finestra di stampa del browser,
            vedi src/PrintMenu.jsx). */}
        <div style={{ background: t.card, border: `1px solid ${t.line}`, borderRadius: 10, padding: 20, marginTop: 24 }}>
          <div style={{ fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: t.secondary, marginBottom: 14 }}>
            Esportazione e backup
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={handleExportJson} className="mdp-btn" style={btnGhost(t)}>
              <Download size={13} /> Esporta JSON
            </button>
            <label className="mdp-btn" style={{ ...btnGhost(t), cursor: "pointer" }}>
              <Upload size={13} /> Importa JSON
              <input
                type="file" accept="application/json" style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; handleImportJsonFile(f); }}
              />
            </label>
          </div>
          {importError && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", color: t.accent2, fontSize: 12.5, marginTop: 10 }}>
              <AlertCircle size={14} /> {importError}
            </div>
          )}
          <div style={{ fontSize: 11, color: t.inkSoft, marginTop: 10, lineHeight: 1.4 }}>
            L'importazione sostituisce il menù nell'editor (non salva subito): rivedi le modifiche e premi "Salva modifiche" quando sei pronto.
          </div>

          <hr className="mdp-hairline" style={{ margin: "18px 0" }} />

          <div style={{ fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", color: t.inkSoft, marginBottom: 14 }}>
            Versione stampabile (PDF)
          </div>

          <PdfOptionsGroup title="Contenuto" t={t}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: t.inkSoft }}>
              Lingua:
              <select
                value={pdfLang}
                onChange={(e) => setPdfLang(e.target.value)}
                style={{ ...inputStyle, width: "auto", padding: "5px 8px" }}
              >
                {LANGUAGES.filter((l) => l.code === "it" || !!menu.translations?.[l.code]).map((l) => (
                  <option key={l.code} value={l.code}>{l.label}</option>
                ))}
              </select>
            </label>
            <Toggle t={t} checked={pdfImages} onChange={setPdfImages} label="Immagini dei piatti" />
            <Toggle t={t} checked={pdfShowPrices} onChange={setPdfShowPrices} label="Prezzi" />
            <Toggle t={t} checked={pdfShowTags} onChange={setPdfShowTags} label="Etichette (es. ROSSO)" />
            <Toggle t={t} checked={pdfShowSubtitles} onChange={setPdfShowSubtitles} label="Sottotitoli categoria" />
            <Toggle t={t} checked={pdfShowFooter} onChange={setPdfShowFooter} label="Nota e contatti in fondo" />
            <Toggle t={t} checked={pdfShowDate} onChange={setPdfShowDate} label="Data di generazione" />
          </PdfOptionsGroup>

          <PdfOptionsGroup title="Impaginazione" t={t}>
            <Toggle
              t={t} checked={pdfAvoidCategorySplit} onChange={setPdfAvoidCategorySplit}
              label="Non spezzare una categoria tra due pagine"
            />
            <PdfPillGroup
              t={t} label="Colonne"
              options={[{ value: 1, label: "1 colonna" }, { value: 2, label: "2 colonne" }]}
              value={pdfColumns} onChange={setPdfColumns}
            />
            <PdfPillGroup
              t={t} label="Formato"
              options={[{ value: "A4", label: "A4" }, { value: "Letter", label: "Letter" }]}
              value={pdfPaperSize} onChange={setPdfPaperSize}
            />
          </PdfOptionsGroup>

          <PdfOptionsGroup title="Categorie da includere" t={t}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {menu.categories.filter((c) => c.visible !== false).map((cat) => {
                const included = !pdfExcludedCats.has(cat.id);
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => togglePdfCat(cat.id)}
                    className="mdp-btn"
                    style={{
                      border: `1px solid ${t.line}`,
                      background: included ? t.primary : "transparent",
                      color: included ? t.bg : t.inkSoft,
                      borderRadius: 20, padding: "4px 11px", fontSize: 11.5, cursor: "pointer",
                    }}
                  >
                    {cat.name || "Senza nome"}
                  </button>
                );
              })}
            </div>
          </PdfOptionsGroup>

          <button onClick={handleExportPdf} className="mdp-btn" style={{ ...btnPrimary(t), marginTop: 6 }}>
            <Printer size={13} /> Esporta PDF / Stampa
          </button>
          {pdfError && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", color: t.accent2, fontSize: 12.5, marginTop: 10 }}>
              <AlertCircle size={14} /> {pdfError}
            </div>
          )}
          <div style={{ fontSize: 11, color: t.inkSoft, marginTop: 10, lineHeight: 1.4 }}>
            Si apre una scheda con l'anteprima di stampa: usa "Salva come PDF" nella finestra di stampa del browser per ottenere un file.
          </div>
        </div>
      </div>
    </div>
  );
}

// Editor di una lingua di traduzione: stessa struttura dell'editor italiano
// (identità, categorie, voci), ma solo testo — niente prezzo, foto, visibilità
// o aggiunta/eliminazione: quelle sono decisioni strutturali che valgono per
// tutte le lingue insieme e si prendono nella scheda "IT". Se la lingua non ha
// ancora nessuna traduzione salvata, mostra solo il pulsante di generazione.
function TranslationEditor({
  t, menu, lang, translation, generating, generateError, onGenerate,
  confirmDelete, onRequestDelete, onCancelDelete, onConfirmDelete,
  updateTranslationField, updateTranslationCategory, updateTranslationItem,
  inputStyle, labelStyle,
}) {
  const langLabel = (LANGUAGES.find((l) => l.code === lang) || {}).label || lang.toUpperCase();
  const missing = countMissingTranslations(menu, translation);

  if (!translation) {
    return (
      <div style={{ background: t.card, border: `1px solid ${t.line}`, borderRadius: 10, padding: 24, marginBottom: 24, textAlign: "center" }}>
        <div style={{ fontSize: 13, color: t.inkSoft, marginBottom: 14 }}>
          Nessuna traduzione {langLabel} presente per questo menù.
        </div>
        <button onClick={onGenerate} disabled={generating} className="mdp-btn" style={{ ...btnPrimary(t), margin: "0 auto" }}>
          <Sparkles size={13} /> {generating ? "Generazione…" : `Genera traduzione automatica (${langLabel})`}
        </button>
        {generateError && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "center", color: t.accent2, fontSize: 12.5, marginTop: 12 }}>
            <AlertCircle size={14} /> {generateError}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <button
          onClick={confirmDelete ? onConfirmDelete : onRequestDelete}
          onBlur={onCancelDelete}
          className="mdp-btn"
          style={{ ...btnGhost(t), color: t.accent2, fontSize: 11.5 }}
        >
          <Trash2 size={12} /> {confirmDelete ? `Conferma eliminazione traduzione ${langLabel}` : `Elimina traduzione ${langLabel}`}
        </button>
      </div>
      {missing > 0 && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap",
          background: t.card, border: `1px solid ${t.line}`, borderRadius: 10, padding: "12px 16px", marginBottom: 16,
        }}>
          <span style={{ fontSize: 12.5, color: t.inkSoft }}>
            {missing} {missing === 1 ? "voce non ancora tradotta" : "voci non ancora tradotte"} in {langLabel}.
          </span>
          <button onClick={onGenerate} disabled={generating} className="mdp-btn" style={btnGhost(t)}>
            <Sparkles size={12} /> {generating ? "Generazione…" : "Genera traduzione mancante"}
          </button>
        </div>
      )}
      {generateError && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", color: t.accent2, fontSize: 12.5, marginBottom: 16 }}>
          <AlertCircle size={14} /> {generateError}
        </div>
      )}

      <div style={{ background: t.card, border: `1px solid ${t.line}`, borderRadius: 10, padding: 20, marginBottom: 24 }}>
        <div style={{ fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: t.secondary, marginBottom: 14 }}>
          Identità del locale — {langLabel}
        </div>
        <div style={{ display: "grid", gap: 14 }}>
          <div>
            <span style={labelStyle}>Nome del ristorante</span>
            <input style={inputStyle} placeholder={menu.restaurantName} value={translation.restaurantName ?? ""} onChange={(e) => updateTranslationField("restaurantName", e.target.value)} />
          </div>
          <div>
            <span style={labelStyle}>Frase di apertura</span>
            <input style={inputStyle} placeholder={menu.tagline} value={translation.tagline ?? ""} onChange={(e) => updateTranslationField("tagline", e.target.value)} />
          </div>
          <div>
            <span style={labelStyle}>Nota a piè di pagina</span>
            <input style={inputStyle} placeholder={menu.footerNote} value={translation.footerNote ?? ""} onChange={(e) => updateTranslationField("footerNote", e.target.value)} />
          </div>
        </div>
      </div>

      {menu.categories.map((cat) => {
        const tCat = translation.categories?.[cat.id] || {};
        return (
          <div key={cat.id} style={{ background: t.card, border: `1px solid ${t.line}`, borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr", marginBottom: 14 }}>
              <div>
                <span style={labelStyle}>Nome categoria</span>
                <input style={inputStyle} placeholder={cat.name} value={tCat.name ?? ""} onChange={(e) => updateTranslationCategory(cat.id, "name", e.target.value)} />
              </div>
              <div>
                <span style={labelStyle}>Sottotitolo</span>
                <input style={inputStyle} placeholder={cat.subtitle} value={tCat.subtitle ?? ""} onChange={(e) => updateTranslationCategory(cat.id, "subtitle", e.target.value)} />
              </div>
            </div>

            {cat.items.map((item) => {
              const tItem = tCat.items?.[item.id] || {};
              return (
                <div key={item.id} style={{ border: `1px solid ${t.line}`, borderRadius: 8, padding: 12, marginBottom: 10, background: t.bg }}>
                  <div style={{ display: "grid", gap: 10, gridTemplateColumns: item.tag !== undefined ? "2fr 1fr" : "1fr" }}>
                    <div>
                      <span style={labelStyle}>Nome piatto</span>
                      <input style={inputStyle} placeholder={item.name} value={tItem.name ?? ""} onChange={(e) => updateTranslationItem(cat.id, item.id, "name", e.target.value)} />
                    </div>
                    {item.tag !== undefined && (
                      <div>
                        <span style={labelStyle}>Etichetta</span>
                        <input style={inputStyle} placeholder={item.tag} value={tItem.tag ?? ""} onChange={(e) => updateTranslationItem(cat.id, item.id, "tag", e.target.value)} />
                      </div>
                    )}
                  </div>
                  {item.description && (
                    <div style={{ marginTop: 10 }}>
                      <span style={labelStyle}>Descrizione</span>
                      <textarea rows={2} style={{ ...inputStyle, resize: "vertical" }} placeholder={item.description} value={tItem.description ?? ""} onChange={(e) => updateTranslationItem(cat.id, item.id, "description", e.target.value)} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// Piccolo raggruppamento con etichetta per le opzioni di esportazione PDF
// (Contenuto / Impaginazione / Categorie da includere): stessa idea visiva
// delle sezioni della pagina, ma più compatta perché sono tutte nella stessa
// card "Esportazione e backup".
function PdfOptionsGroup({ title, t, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 10, letterSpacing: 0.8, textTransform: "uppercase", color: t.secondary, marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
        {children}
      </div>
    </div>
  );
}

// Selettore a pillole per una scelta esclusiva tra poche opzioni (colonne,
// formato carta): stesso stile pill già usato per il selettore di lingua.
function PdfPillGroup({ t, label, options, value, onChange }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: t.inkSoft }}>
      {label}:
      <span style={{ display: "flex", gap: 4 }}>
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className="mdp-btn"
            style={{
              border: `1px solid ${t.line}`,
              background: value === opt.value ? t.primary : "transparent",
              color: value === opt.value ? t.bg : t.inkSoft,
              borderRadius: 20, padding: "3px 10px", fontSize: 11.5, cursor: "pointer",
            }}
          >
            {opt.label}
          </button>
        ))}
      </span>
    </label>
  );
}

function Toggle({ t, checked, onChange, label }) {
  // Un solo elemento interattivo (l'input) copre l'intera area del cursore;
  // gli span decorativi sotto sono puramente visivi (pointer-events: none),
  // così il click viene gestito una volta sola in modo affidabile.
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5, cursor: "pointer", color: t.inkSoft }}>
      <span style={{ position: "relative", width: 36, height: 21, flexShrink: 0, display: "inline-block" }}>
        <span
          style={{
            position: "absolute", inset: 0, borderRadius: 22, pointerEvents: "none",
            background: checked ? t.secondary : t.line, transition: "background .2s",
          }}
        />
        <span
          style={{
            position: "absolute", width: 15, height: 15, left: checked ? 18 : 3, top: 3,
            background: t.card, borderRadius: "50%", transition: "left .2s", pointerEvents: "none",
          }}
        />
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          style={{
            position: "absolute", inset: 0, width: "100%", height: "100%",
            margin: 0, opacity: 0, cursor: "pointer",
          }}
        />
      </span>
      {label}
    </label>
  );
}

function btnPrimary(t) {
  return {
    display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 14px",
    background: t.primary, color: t.bg, border: "none", borderRadius: 6,
    fontSize: 12.5, letterSpacing: 0.5, cursor: "pointer",
  };
}
function btnGhost(t) {
  return {
    display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px",
    background: "none", color: t.ink, border: `1px solid ${t.line}`, borderRadius: 6,
    fontSize: 12.5, cursor: "pointer",
  };
}

/* ============================== ADMIN (login + pannello) ============================== */
// Componente unico esportato: gestisce da sé lo stato di accesso (login/logout)
// e mostra il modulo di accesso o il pannello di gestione a seconda dei casi.
export default function Admin({ menu, setMenu, onSave, saving, savedAt, saveError, onExit, onUndo, canUndo }) {
  const [authed, setAuthed] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [bootstrapError, setBootstrapError] = useState("");

  React.useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (fbUser) => {
      setAuthed(!!fbUser);
      setAuthReady(true);
    });
    return unsubscribe;
  }, []);

  // Si arriva qui dal link "Gestione menù" in fondo alla pagina pubblica:
  // senza questo reset, il pannello Admin comparirebbe a metà pagina invece
  // che dall'inizio.
  React.useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  if (!authReady) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "sans-serif", color: "#6E2A2A" }}>
        Caricamento…
      </div>
    );
  }

  if (!authed) {
    return <AdminLogin onBack={onExit} theme={menu?.theme} />;
  }

  // Il documento non esiste ancora su Firestore (vedi MenuApp.jsx): niente
  // menù di esempio da mostrare al suo posto, solo un modo di importarne uno.
  if (!menu) {
    return (
      <AdminBootstrap
        importError={bootstrapError}
        onExit={() => { signOut(auth); onExit(); }}
        onImport={(file) => {
          setBootstrapError("");
          parseMenuJsonFile(file).then(setMenu).catch((err) => setBootstrapError(err.message || "File non valido."));
        }}
      />
    );
  }

  return (
    <AdminPanel
      menu={menu}
      setMenu={setMenu}
      onSave={onSave}
      saving={saving}
      savedAt={savedAt}
      saveError={saveError}
      onLogout={() => { signOut(auth); onExit(); }}
      onPreview={onExit}
      onUndo={onUndo}
      canUndo={canUndo}
    />
  );
}
