// Menu management panel (login + editor). This file is downloaded ONLY
// when someone clicks "Gestione menù" on the public site (deferred
// loading, see React.lazy in MenuApp.jsx) — so customers just looking at
// the menu never download Firebase Authentication.
import React, { useState, useEffect } from "react";
import { Plus, Trash2, Save, Lock, LogOut, Eye, ChevronDown, ChevronUp, RotateCcw, ShieldCheck, AlertCircle, Star, Upload, ImageOff, Instagram, Facebook, ShoppingBag, Languages, Sparkles, Download, Printer, X, Users, ArrowUp, ArrowDown, GripVertical } from "lucide-react";
import { collection, doc, setDoc, deleteDoc, onSnapshot } from "firebase/firestore";
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, DragOverlay, useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { auth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "./firebase-auth";
import { db } from "./firebase-db";
import { THEMES, ital, uid, GlobalStyle, Logo, LANGUAGES, generateMissingTranslations, countMissingTranslations, applyTranslation, FALLBACK_STYLE, TYPE } from "./shared";
import { uploadMenuImage, optimizedImageUrl } from "./cloudinary";
import { subscribeMenuCosts, saveMenuCosts } from "./menuCosts";

// Reads and validates a .json file chosen for import: used both by the
// regular Admin panel ("Importa JSON") and by the bootstrap screen when the
// menu document doesn't exist yet on Firestore. Only checks the minimal
// shape needed to avoid crashing the editor or saving corrupted data — it
// doesn't validate every single field.
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

// Removes, from every saved language, the translation of an entry (or, if
// itemId is omitted, of the whole category) just deleted from the Italian
// menu — otherwise it would stay as orphaned data in `menu.translations`,
// never read again by anything (applyTranslation only walks the
// categories/entries still present) but still saved on every "Salva".
function pruneTranslations(translations, catId, itemId) {
  if (!translations) return translations;
  let changed = false;
  const next = {};
  for (const [langCode, langData] of Object.entries(translations)) {
    const cat = langData?.categories?.[catId];
    if (!cat) {
      next[langCode] = langData;
      continue;
    }
    if (itemId) {
      if (!cat.items || !(itemId in cat.items)) {
        next[langCode] = langData;
        continue;
      }
      const items = { ...cat.items };
      delete items[itemId];
      next[langCode] = { ...langData, categories: { ...langData.categories, [catId]: { ...cat, items } } };
    } else {
      const categories = { ...langData.categories };
      delete categories[catId];
      next[langCode] = { ...langData, categories };
    }
    changed = true;
  }
  return changed ? next : translations;
}

// Moves an entry's translation from one category to another in every saved
// language, when the entry itself is moved to a different category —
// without this, pruneTranslations-style logic would mistake it for orphaned
// data and lose it on the next edit.
function moveTranslationItem(translations, fromCatId, toCatId, itemId) {
  if (!translations) return translations;
  let changed = false;
  const next = {};
  for (const [langCode, langData] of Object.entries(translations)) {
    const fromCat = langData?.categories?.[fromCatId];
    const itemData = fromCat?.items?.[itemId];
    if (!itemData) {
      next[langCode] = langData;
      continue;
    }
    const fromItems = { ...fromCat.items };
    delete fromItems[itemId];
    const categories = { ...langData.categories, [fromCatId]: { ...fromCat, items: fromItems } };
    const toCat = categories[toCatId] || {};
    categories[toCatId] = { ...toCat, items: { ...(toCat.items || {}), [itemId]: itemData } };
    next[langCode] = { ...langData, categories };
    changed = true;
  }
  return changed ? next : translations;
}

// Collision detection for drag&drop (dnd-kit): restricts valid drop targets
// to the same type as the dragged element (a category can only attach to
// another category, an entry only to another entry or to an empty
// container) — otherwise dragging a category over the entries of another,
// open category would make it attach to those by mistake.
function dragCollisionDetection(args) {
  const activeType = args.active.data.current?.type;
  const droppableContainers = args.droppableContainers.filter((c) => {
    const type = c.data.current?.type;
    return activeType === "item" ? type === "item" || type === "container" : type === activeType;
  });
  return closestCenter({ ...args, droppableContainers });
}

// Generic wrapper that makes an element reorderable via drag&drop: exposes
// the handle's ref/style/listeners through a render prop, so the markup for
// categories and entries stays nearly unchanged from the up/down-buttons-only
// version.
function SortableSlot({ id, data, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, data });
  return children({
    setNodeRef,
    isDragging,
    dragHandleProps: { ...attributes, ...listeners },
    style: {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.5 : 1,
    },
  });
}

function DragHandle({ t, size, dragHandleProps, label }) {
  return (
    <button
      type="button"
      className="mdp-btn"
      {...dragHandleProps}
      style={{ ...btnGhost(t), padding: size <= 13 ? "5px 6px" : "6px 7px", cursor: "grab", touchAction: "none" }}
      aria-label={label}
      title={label}
    >
      <GripVertical size={size} />
    </button>
  );
}

// Area to drop an entry dragged from another category, shown only when the
// destination category doesn't have any entries of its own yet (otherwise
// there would be no existing entry to drop it onto).
function EmptyCategoryDropZone({ t, catId }) {
  const { setNodeRef, isOver } = useDroppable({ id: `empty-${catId}`, data: { type: "container", catId } });
  return (
    <div
      ref={setNodeRef}
      style={{
        border: `1px dashed ${isOver ? t.secondary : t.line}`,
        borderRadius: 8, padding: "14px 12px", textAlign: "center",
        fontSize: TYPE.labelPlus, color: t.inkSoft, marginBottom: 10,
        background: isOver ? t.bgAlt : "transparent", transition: "background .15s, border-color .15s",
      }}
    >
      Trascina qui una voce da un'altra categoria
    </div>
  );
}

function AdminLogin({ onBack, theme }) {
  const t = THEMES[theme] || THEMES.minimal;
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      // onAuthStateChanged in the App component will notice the successful
      // login and automatically switch to the management view.
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
        ...cardStyle(t),
        padding: "36px 30px", width: "100%", maxWidth: 340, boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
      }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
          <Logo width={140} />
        </div>
        <div className="mdp-display" style={{ textAlign: "center", fontStyle: ital(t), fontSize: TYPE.modalTitle, fontWeight: 600, color: t.primary }}>
          Gestione menù
        </div>
        <div style={{ textAlign: "center", fontSize: TYPE.smallPlus, color: t.inkSoft, marginTop: 6, marginBottom: 22 }}>
          Accedi per modificare il menù di Masseria della Piana
        </div>

        <label style={{ fontSize: TYPE.label, letterSpacing: 1, textTransform: "uppercase", color: t.inkSoft }}>Email</label>
        <input
          type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus
          style={{ width: "100%", padding: "10px 12px", marginTop: 6, marginBottom: 16, border: `1px solid ${t.line}`, borderRadius: 6, background: t.bg, color: t.ink, fontSize: TYPE.bodyLg }}
        />
        <label style={{ fontSize: TYPE.label, letterSpacing: 1, textTransform: "uppercase", color: t.inkSoft }}>Password</label>
        <input
          type="password" value={pass} onChange={(e) => setPass(e.target.value)}
          style={{ width: "100%", padding: "10px 12px", marginTop: 6, marginBottom: 8, border: `1px solid ${t.line}`, borderRadius: 6, background: t.bg, color: t.ink, fontSize: TYPE.bodyLg }}
        />

        {error && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", color: t.accent2, fontSize: TYPE.smallPlus, marginTop: 8 }}>
            <AlertCircle size={14} /> {error}
          </div>
        )}

        <button type="submit" disabled={busy} className="mdp-btn" style={{
          width: "100%", marginTop: 18, padding: "11px 0", background: t.primary, color: t.bg,
          border: "none", borderRadius: 6, fontSize: TYPE.bodyPlus, letterSpacing: 1, textTransform: "uppercase",
          cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}>
          <Lock size={14} /> {busy ? "Accesso…" : "Accedi"}
        </button>

        <button type="button" onClick={onBack} className="mdp-btn" style={{
          width: "100%", marginTop: 10, padding: "9px 0", background: "none",
          border: "none", color: t.inkSoft, fontSize: TYPE.smallPlus, cursor: "pointer",
        }}>
          ← Torna al menù
        </button>
      </form>
    </div>
  );
}

// Shown after login when the menu document doesn't exist yet on Firestore
// (first-time setup, or a restored database): there's no longer a sample
// menu to load in its place (removed on purpose), so the only way forward
// is importing a JSON backup previously exported from this same panel.
function AdminBootstrap({ onImport, onExit, importError }) {
  const t = THEMES.minimal;
  return (
    <div className="mdp-root" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 20, minHeight: "100vh" }}>
      <GlobalStyle t={t} />
      <div style={{ ...cardStyle(t), padding: "32px 28px", width: "100%", maxWidth: 420, textAlign: "center", boxShadow: "0 10px 30px rgba(0,0,0,0.08)" }}>
        <div className="mdp-display" style={{ fontStyle: ital(t), fontSize: TYPE.heading, fontWeight: 600, color: t.primary, marginBottom: 10 }}>
          Nessun menù trovato
        </div>
        <div style={{ fontSize: TYPE.body, color: t.inkSoft, marginBottom: 20, lineHeight: 1.5 }}>
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
          <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "center", color: t.accent2, fontSize: TYPE.smallPlus, marginTop: 14 }}>
            <AlertCircle size={14} /> {importError}
          </div>
        )}
        <button onClick={onExit} className="mdp-btn" style={{ width: "100%", marginTop: 16, padding: "9px 0", background: "none", border: "none", color: t.inkSoft, fontSize: TYPE.smallPlus, cursor: "pointer" }}>
          ← Torna al menù
        </button>
      </div>
    </div>
  );
}

const STAFF_ROLES = [
  { value: "waiter", label: "Cameriere" },
  { value: "kitchen", label: "Cucina" },
  { value: "admin", label: "Amministratore" },
];

// Staff role management (docs/comande-camerieri.md, §3). A separate
// collection from the menu (staff/{uid}), so it reads/writes Firestore on
// its own instead of going through menu/setMenu/onSave.
//
// Firebase Auth accounts must be created by hand from the Firebase console
// (Authentication → Aggiungi utente): this section only assigns a name and
// role to an already-existing uid.
function StaffSection({ t }) {
  const [staff, setStaff] = useState(null);
  const [uidInput, setUidInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [roleInput, setRoleInput] = useState("waiter");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDeleteUid, setConfirmDeleteUid] = useState(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "staff"),
      (snap) => setStaff(snap.docs.map((d) => ({ uid: d.id, ...d.data() }))),
      (err) => {
        console.error("[admin] Errore lettura staff:", err);
        setError("Impossibile leggere l'elenco del personale.");
      }
    );
    return unsubscribe;
  }, []);

  const addStaff = async (e) => {
    e.preventDefault();
    setError("");
    const cleanUid = uidInput.trim();
    if (!cleanUid || !nameInput.trim()) return;
    setSaving(true);
    try {
      await setDoc(doc(db, "staff", cleanUid), { name: nameInput.trim(), role: roleInput });
      setUidInput("");
      setNameInput("");
      setRoleInput("waiter");
    } catch (err) {
      console.error("[admin] Salvataggio staff fallito:", err);
      setError("Salvataggio non riuscito. Verifica di aver effettuato l'accesso e riprova.");
    } finally {
      setSaving(false);
    }
  };

  const removeStaff = async (uidToRemove) => {
    try {
      await deleteDoc(doc(db, "staff", uidToRemove));
    } catch (err) {
      console.error("[admin] Eliminazione staff fallita:", err);
      setError("Eliminazione non riuscita. Riprova.");
    } finally {
      setConfirmDeleteUid(null);
    }
  };

  const roleLabel = (role) => STAFF_ROLES.find((r) => r.value === role)?.label || role;
  const inputStyle = { width: "100%", padding: "9px 11px", border: `1px solid ${t.line}`, borderRadius: 6, background: t.bg, color: t.ink, fontSize: TYPE.smallPlus };
  const labelStyle = { fontSize: TYPE.tiny, letterSpacing: 0.8, textTransform: "uppercase", color: t.inkSoft, display: "block", marginBottom: 4 };

  return (
    <div style={{ ...cardStyle(t), marginBottom: 24 }}>
      <div style={{ fontSize: TYPE.small, letterSpacing: 1, textTransform: "uppercase", color: t.secondary, marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
        <Users size={13} /> Personale — accesso a comande/cucina
      </div>
      <div style={{ fontSize: TYPE.labelPlus, color: t.inkSoft, marginBottom: 16, lineHeight: 1.4 }}>
        Per aggiungere una persona, crea prima il suo account in Firebase Console
        (Authentication → Aggiungi utente), poi incolla qui il suo UID per
        assegnargli un ruolo e abilitarlo su /cameriere o /cucina.
      </div>

      {auth.currentUser && (
        <button
          type="button"
          onClick={() => {
            setUidInput(auth.currentUser.uid);
            setNameInput(nameInput || auth.currentUser.email?.split("@")[0] || "Amministratore");
            setRoleInput("admin");
          }}
          className="mdp-btn"
          style={{ ...btnGhost(t), marginBottom: 16 }}
        >
          <Plus size={12} /> Usa il mio account (accesso admin completo)
        </button>
      )}

      {error && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", color: t.accent2, fontSize: TYPE.smallPlus, marginBottom: 12 }}>
          <AlertCircle size={14} /> {error}
        </div>
      )}

      <div style={{ display: "grid", gap: 8 }}>
        {staff === null && <div style={{ fontSize: TYPE.smallPlus, color: t.inkSoft }}>Caricamento…</div>}
        {staff !== null && staff.length === 0 && (
          <div style={{ fontSize: TYPE.smallPlus, color: t.inkSoft }}>Nessun membro dello staff configurato.</div>
        )}
        {staff !== null && staff.map((s) => (
          <div key={s.uid} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, border: `1px solid ${t.line}`, borderRadius: 6, padding: "8px 12px", background: t.bg }}>
            <div>
              <div style={{ fontSize: TYPE.smallPlus, fontWeight: 600 }}>{s.name} <span style={{ fontWeight: 400, color: t.inkSoft }}>· {roleLabel(s.role)}</span></div>
              <div style={{ fontSize: TYPE.micro, color: t.inkSoft, fontFamily: "monospace" }}>{s.uid}</div>
            </div>
            <button
              onClick={() => (confirmDeleteUid === s.uid ? removeStaff(s.uid) : setConfirmDeleteUid(s.uid))}
              className="mdp-btn"
              style={btnDanger(t)}
            >
              <Trash2 size={12} /> {confirmDeleteUid === s.uid ? "Conferma" : "Rimuovi"}
            </button>
          </div>
        ))}
      </div>

      <form onSubmit={addStaff} style={{ display: "grid", gap: 10, gridTemplateColumns: "1.4fr 1fr 0.9fr auto", alignItems: "end", marginTop: 16 }}>
        <div>
          <span style={labelStyle}>UID (da Firebase Console)</span>
          <input style={inputStyle} value={uidInput} onChange={(e) => setUidInput(e.target.value)} placeholder="es. aBc123…" />
        </div>
        <div>
          <span style={labelStyle}>Nome</span>
          <input style={inputStyle} value={nameInput} onChange={(e) => setNameInput(e.target.value)} placeholder="es. Marco" />
        </div>
        <div>
          <span style={labelStyle}>Ruolo</span>
          <select style={inputStyle} value={roleInput} onChange={(e) => setRoleInput(e.target.value)}>
            {STAFF_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <button type="submit" disabled={saving || !uidInput.trim() || !nameInput.trim()} className="mdp-btn" style={{ ...btnPrimary(t), opacity: saving || !uidInput.trim() || !nameInput.trim() ? 0.6 : 1 }}>
          <Plus size={13} /> Aggiungi
        </button>
      </form>
    </div>
  );
}

/* ============================== ADMIN DASHBOARD ============================== */
function AdminPanel({ menu, setMenu, onSave, saving, savedAt, saveError, onLogout, onPreview, onUndo, canUndo }) {
  const t = THEMES[menu.theme] || THEMES.minimal;
  const [openCats, setOpenCats] = useState(() => new Set());
  const [confirmDelete, setConfirmDelete] = useState(null); // {type:'cat'|'item', catId, itemId}
  const [uploadingItem, setUploadingItem] = useState(null); // id of the entry with an upload in progress
  const [uploadErrors, setUploadErrors] = useState({}); // { [itemId]: message }
  const [lang, setLang] = useState("it"); // language currently shown/edited in the editor
  const [newItemId, setNewItemId] = useState(null); // last entry added: shows the "missing translation" notice until another language is picked or it's closed by hand
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [confirmDeleteTranslation, setConfirmDeleteTranslation] = useState(false);
  const [importError, setImportError] = useState("");
  const [pdfLang, setPdfLang] = useState("it");
  const [pdfImages, setPdfImages] = useState(false);
  const [pdfError, setPdfError] = useState("");
  // PDF layout/content options, left to the admin who's printing (there's
  // no single right layout for everyone: it depends on how many pages are
  // wanted, whether a price-less menu is needed for an event, etc.).
  // By default a category can continue on a new page if it doesn't all fit
  // on the current one (the entries that fit stay in place, no whitespace
  // left on purpose). Enabling this option reverts to "a category never
  // splits" behavior: if it doesn't all fit, the whole thing jumps to the
  // next page, possibly leaving empty space on the previous one.
  const [pdfAvoidCategorySplit, setPdfAvoidCategorySplit] = useState(false);
  const [pdfColumns, setPdfColumns] = useState(1); // 1 or 2 columns for each category's entries
  const [pdfPaperSize, setPdfPaperSize] = useState("A4");
  const [pdfShowPrices, setPdfShowPrices] = useState(true);
  const [pdfShowTags, setPdfShowTags] = useState(true);
  const [pdfShowSubtitles, setPdfShowSubtitles] = useState(true);
  const [pdfShowFooter, setPdfShowFooter] = useState(true); // footer note + social contacts
  const [pdfShowDate, setPdfShowDate] = useState(false);
  const [pdfExcludedCats, setPdfExcludedCats] = useState(() => new Set()); // categories deselected for the export
  const [menuCosts, setMenuCosts] = useState(null); // null = still loading; {} = no cost set

  // Dish costs (src/menuCosts.js): a document separate from menu/data,
  // never read by the public menu (see firestore.rules). Saved immediately
  // on every edit, not with the menu's Salva button below — this avoids
  // tying sensitive data to the menu's same draft/undo cycle.
  useEffect(() => {
    const unsubscribe = subscribeMenuCosts(setMenuCosts, (err) => console.error("[admin] Errore lettura costi piatti:", err));
    return unsubscribe;
  }, []);

  const updateCost = (itemId, value) => {
    setMenuCosts((prev) => {
      const next = { ...(prev || {}), [itemId]: value };
      saveMenuCosts(next).catch((err) => console.error("[admin] Salvataggio costo fallito:", err));
      return next;
    });
  };

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
    setNewItemId(null);
  };

  const toggleCat = (id) => {
    setOpenCats((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const updateField = (field, value) => setMenu((m) => ({ ...m, [field]: value }));
  const updateCoperto = (key, value) => setMenu((m) => ({ ...m, coperto: { ...(m.coperto || {}), [key]: value } }));

  // Updates an external link (url or visibility) inside a menu link group,
  // e.g. group="reviewLinks", key="google" or group="socialLinks", key="instagram".
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

  // Updates a translated field (the currently selected language, never Italian).
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
    } catch {
      setGenerateError("Generazione non riuscita. Riprova.");
    } finally {
      setGenerating(false);
    }
  };

  // Deletes the entire translation draft for the current language (so it can
  // be regenerated from scratch with "Genera traduzione automatica"). Never
  // touches Italian: the button is only available when lang !== "it".
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

  // Opens the print preview (src/PrintMenu.jsx) in a new tab with only the
  // entries visible to customers, in the language and with the images
  // chosen here. The menu is passed via sessionStorage (shared with the new
  // tab because it's opened via window.open from the same origin) instead
  // of rereading it from Firestore, so it also reflects unsaved changes.
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
    } catch {
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
    const id = uid();
    setMenu((m) => ({
      ...m,
      categories: m.categories.map((c) =>
        c.id === catId
          ? { ...c, items: [...c.items, { id, name: "Nuova voce", price: "0,00", description: "", image: "", visible: true, staffOnly: false }] }
          : c
      ),
    }));
    setNewItemId(id);
  };

  const removeItem = (catId, itemId) => {
    setMenu((m) => ({
      ...m,
      categories: m.categories.map((c) =>
        c.id === catId ? { ...c, items: c.items.filter((it) => it.id !== itemId) } : c
      ),
      translations: pruneTranslations(m.translations, catId, itemId),
    }));
    setConfirmDelete(null);
    setNewItemId((prev) => (prev === itemId ? null : prev));
  };

  const addCategory = () => {
    const id = "cat-" + uid();
    setMenu((m) => ({ ...m, categories: [...m.categories, { id, name: "Nuova categoria", subtitle: "", visible: true, items: [] }] }));
    setOpenCats((prev) => new Set(prev).add(id));
  };

  const removeCategory = (catId) => {
    setMenu((m) => ({
      ...m,
      categories: m.categories.filter((c) => c.id !== catId),
      translations: pruneTranslations(m.translations, catId),
    }));
    setConfirmDelete(null);
  };

  // direction: -1 (up) or +1 (down). No effect if already at the edge of the list.
  const moveCategory = (catId, direction) => {
    setMenu((m) => {
      const idx = m.categories.findIndex((c) => c.id === catId);
      const newIdx = idx + direction;
      if (idx < 0 || newIdx < 0 || newIdx >= m.categories.length) return m;
      const categories = [...m.categories];
      [categories[idx], categories[newIdx]] = [categories[newIdx], categories[idx]];
      return { ...m, categories };
    });
  };

  const moveItem = (catId, itemId, direction) => {
    setMenu((m) => ({
      ...m,
      categories: m.categories.map((c) => {
        if (c.id !== catId) return c;
        const idx = c.items.findIndex((it) => it.id === itemId);
        const newIdx = idx + direction;
        if (idx < 0 || newIdx < 0 || newIdx >= c.items.length) return c;
        const items = [...c.items];
        [items[idx], items[newIdx]] = [items[newIdx], items[idx]];
        return { ...c, items };
      }),
    }));
  };

  // Moves an entry from category fromCatId to the end of toCatId, carrying
  // along any translations already present.
  const moveItemToCategory = (fromCatId, itemId, toCatId) => {
    if (!toCatId || fromCatId === toCatId) return;
    setMenu((m) => {
      let movedItem = null;
      const withoutItem = m.categories.map((c) => {
        if (c.id !== fromCatId) return c;
        movedItem = c.items.find((it) => it.id === itemId) || null;
        return { ...c, items: c.items.filter((it) => it.id !== itemId) };
      });
      if (!movedItem) return m;
      const categories = withoutItem.map((c) =>
        c.id === toCatId ? { ...c, items: [...c.items, movedItem] } : c
      );
      return {
        ...m,
        categories,
        translations: moveTranslationItem(m.translations, fromCatId, toCatId, itemId),
      };
    });
    setOpenCats((prev) => new Set(prev).add(toCatId));
  };

  // Reordering via drag&drop (dnd-kit), an alternative to the up/down
  // buttons above. PointerSensor with a small movement threshold, so a
  // normal click on the handle doesn't start as a drag.
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [activeDrag, setActiveDrag] = useState(null); // { label } of the dragged element, for the DragOverlay

  const handleDragStart = (event) => {
    const data = event.active.data.current;
    if (data?.type === "category") {
      const cat = menu.categories.find((c) => c.id === event.active.id);
      setActiveDrag({ label: cat?.name || "Categoria" });
    } else if (data?.type === "item") {
      const cat = menu.categories.find((c) => c.id === data.catId);
      const item = cat?.items.find((it) => it.id === event.active.id);
      setActiveDrag({ label: item?.name || "Voce" });
    }
  };

  const handleDragEnd = ({ active, over }) => {
    setActiveDrag(null);
    if (!over || active.id === over.id) return;
    const activeData = active.data.current;
    const overData = over.data.current;

    if (activeData?.type === "category") {
      setMenu((m) => {
        const oldIndex = m.categories.findIndex((c) => c.id === active.id);
        const newIndex = m.categories.findIndex((c) => c.id === over.id);
        if (oldIndex === -1 || newIndex === -1) return m;
        return { ...m, categories: arrayMove(m.categories, oldIndex, newIndex) };
      });
      return;
    }

    if (activeData?.type === "item") {
      const fromCatId = activeData.catId;
      const toCatId = overData?.catId;
      if (!toCatId) return;

      if (fromCatId === toCatId) {
        setMenu((m) => ({
          ...m,
          categories: m.categories.map((c) => {
            if (c.id !== fromCatId) return c;
            const oldIndex = c.items.findIndex((it) => it.id === active.id);
            const newIndex = c.items.findIndex((it) => it.id === over.id);
            if (oldIndex === -1 || newIndex === -1) return c;
            return { ...c, items: arrayMove(c.items, oldIndex, newIndex) };
          }),
        }));
        return;
      }

      setMenu((m) => {
        const categories = m.categories.map((c) => ({ ...c, items: [...c.items] }));
        const fromCat = categories.find((c) => c.id === fromCatId);
        const toCat = categories.find((c) => c.id === toCatId);
        if (!fromCat || !toCat) return m;
        const activeIndex = fromCat.items.findIndex((it) => it.id === active.id);
        if (activeIndex === -1) return m;
        const [movedItem] = fromCat.items.splice(activeIndex, 1);
        let insertIndex = toCat.items.length;
        if (overData.type === "item") {
          const idx = toCat.items.findIndex((it) => it.id === over.id);
          if (idx !== -1) insertIndex = idx;
        }
        toCat.items.splice(insertIndex, 0, movedItem);
        return {
          ...m,
          categories,
          translations: moveTranslationItem(m.translations, fromCatId, toCatId, movedItem.id),
        };
      });
    }
  };

  const google = menu.reviewLinks?.google || { url: "", visible: false };
  const tripadvisor = menu.reviewLinks?.tripadvisor || { url: "", visible: false };
  const instagram = menu.socialLinks?.instagram || { url: "", visible: false };
  const facebook = menu.socialLinks?.facebook || { url: "", visible: false };
  const shop = menu.socialLinks?.shop || { url: "", visible: false };

  const inputStyle = {
    width: "100%", padding: "8px 10px", border: `1px solid ${t.line}`, borderRadius: 6,
    background: t.bg, color: t.ink, fontSize: TYPE.bodyPlus,
  };
  const labelStyle = { fontSize: TYPE.tiny, letterSpacing: 0.8, textTransform: "uppercase", color: t.inkSoft, display: "block", marginBottom: 4 };

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
            <div className="mdp-display" style={{ fontStyle: ital(t), fontSize: TYPE.subhead, fontWeight: 600 }}>Gestione menù</div>
            <div style={{ fontSize: TYPE.tinyPlus, color: t.inkSoft }}>{menu.restaurantName}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className="mdp-btn"
            style={btnGhost(t)}
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
          fontSize: saveError ? TYPE.body : TYPE.small,
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
        <div style={{ ...cardStyle(t), marginBottom: 24 }}>
          <div style={{ fontSize: TYPE.small, letterSpacing: 1, textTransform: "uppercase", color: t.secondary, marginBottom: 14 }}>
            Identità del locale
          </div>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <span style={labelStyle}>Nome del ristorante</span>
              <input aria-label="Nome del ristorante" style={inputStyle} value={menu.restaurantName} onChange={(e) => updateField("restaurantName", e.target.value)} />
            </div>
            <div>
              <span style={labelStyle}>Località</span>
              <input aria-label="Località" style={inputStyle} value={menu.location} onChange={(e) => updateField("location", e.target.value)} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <span style={labelStyle}>Frase di apertura</span>
              <input aria-label="Frase di apertura" style={inputStyle} value={menu.tagline} onChange={(e) => updateField("tagline", e.target.value)} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <span style={labelStyle}>Nota a piè di pagina</span>
              <input aria-label="Nota a piè di pagina" style={inputStyle} value={menu.footerNote || ""} onChange={(e) => updateField("footerNote", e.target.value)} />
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
                  <span style={{ fontSize: TYPE.small, color: th.ink }}>{th.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <span style={labelStyle}>Coperto (a persona, per le comande — vedi area cameriere)</span>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 6 }}>
              <div>
                <span style={{ ...labelStyle, textTransform: "none", letterSpacing: 0 }}>Adulti</span>
                <input style={inputStyle} placeholder="0,00" value={menu.coperto?.adults || ""} onChange={(e) => updateCoperto("adults", e.target.value)} />
              </div>
              <div>
                <span style={{ ...labelStyle, textTransform: "none", letterSpacing: 0 }}>Bambini</span>
                <input style={inputStyle} placeholder="0,00" value={menu.coperto?.children || ""} onChange={(e) => updateCoperto("children", e.target.value)} />
              </div>
            </div>
          </div>

          <div style={{ marginTop: 18, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={labelStyle}>Barra di ricerca piatti</span>
            <Toggle
              t={t}
              checked={menu.searchEnabled !== false}
              onChange={(v) => updateField("searchEnabled", v)}
              label="Attiva su menù cliente e comande"
            />
          </div>
        </div>

        {/* Recensioni */}
        <div style={{ ...cardStyle(t), marginBottom: 24 }}>
          <div style={{ fontSize: TYPE.small, letterSpacing: 1, textTransform: "uppercase", color: t.secondary, marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
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
          <div style={{ fontSize: TYPE.label, color: t.inkSoft, marginTop: 12, lineHeight: 1.4 }}>
            I pulsanti compaiono nel piè di pagina del menù solo quando sono attivi e hanno un link impostato.
          </div>
        </div>

        {/* Social e shop */}
        <div style={{ ...cardStyle(t), marginBottom: 24 }}>
          <div style={{ fontSize: TYPE.small, letterSpacing: 1, textTransform: "uppercase", color: t.secondary, marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
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
          <div style={{ fontSize: TYPE.label, color: t.inkSoft, marginTop: 12, lineHeight: 1.4 }}>
            I pulsanti compaiono nel piè di pagina del menù, insieme a quelli delle recensioni, solo quando sono attivi e hanno un link impostato.
          </div>
        </div>

        <StaffSection t={t} />

        {/* Language selector: chooses whether the Italian text (source,
            full structure) or a language's translation (text only) gets
            edited below. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: TYPE.label, color: t.inkSoft }}>
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
                  borderRadius: 20, padding: "5px 12px", fontSize: TYPE.small, cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 5,
                }}
              >
                {l.label}
                {hasTranslation && missing > 0 && (
                  <span style={{
                    fontSize: TYPE.micro, minWidth: 14, height: 14, borderRadius: 8, padding: "0 4px",
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

        {/* Categories (Italian source text + structure: adding/deleting
            entries, uploading photos, visibility, reordering — everything
            translations share by reference via id). Reordering both with
            the up/down buttons and by dragging the ⠿ handle — entries can
            also move between categories, as long as the destination one is
            open (otherwise use "Sposta in categoria…"). */}
        {lang === "it" && (
          <DndContext sensors={dndSensors} collisionDetection={dragCollisionDetection} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <SortableContext items={menu.categories.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              {menu.categories.map((cat, catIdx) => {
                const isOpen = openCats.has(cat.id);
                const catDelete = confirmDelete?.type === "cat" && confirmDelete.catId === cat.id;
                return (
                  <SortableSlot key={cat.id} id={cat.id} data={{ type: "category" }}>
                    {({ setNodeRef, style, dragHandleProps, isDragging }) => (
            <div ref={setNodeRef} style={{ ...cardStyle(t), ...style, background: t.bgAlt, padding: 0, marginBottom: 16, overflow: "hidden", opacity: cat.visible === false ? 0.6 : 1, boxShadow: isDragging ? "0 10px 24px rgba(0,0,0,0.18)" : undefined }}>
              <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 10 }}>
                <DragHandle t={t} size={16} dragHandleProps={dragHandleProps} label="Trascina per riordinare la categoria" />
                <div style={{ display: "flex", gap: 2 }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); moveCategory(cat.id, -1); }}
                    disabled={catIdx === 0}
                    className="mdp-btn"
                    style={{ ...btnGhost(t), padding: "6px 7px", opacity: catIdx === 0 ? 0.35 : 1, cursor: catIdx === 0 ? "default" : "pointer" }}
                    aria-label="Sposta categoria su"
                    title="Sposta categoria su"
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); moveCategory(cat.id, 1); }}
                    disabled={catIdx === menu.categories.length - 1}
                    className="mdp-btn"
                    style={{ ...btnGhost(t), padding: "6px 7px", opacity: catIdx === menu.categories.length - 1 ? 0.35 : 1, cursor: catIdx === menu.categories.length - 1 ? "default" : "pointer" }}
                    aria-label="Sposta categoria giù"
                    title="Sposta categoria giù"
                  >
                    <ArrowDown size={14} />
                  </button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, cursor: "pointer" }} onClick={() => toggleCat(cat.id)}>
                  {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  <div style={{ flex: 1 }}>
                    <div className="mdp-display" style={{ fontStyle: ital(t), fontSize: TYPE.itemName, fontWeight: 600 }}>{cat.name || "Senza nome"}</div>
                    <div style={{ fontSize: TYPE.label, color: t.inkSoft }}>{cat.items.length} voci {cat.visible === false && "· nascosta ai clienti"}</div>
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
                  style={{ ...btnDanger(t), fontSize: TYPE.label }}
                  aria-label={catDelete ? "Conferma eliminazione categoria" : "Elimina categoria"}
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

                  <SortableContext items={cat.items.map((it) => it.id)} strategy={verticalListSortingStrategy}>
                  {cat.items.map((item, itemIdx) => {
                    const itDelete = confirmDelete?.type === "item" && confirmDelete.itemId === item.id;
                    const otherCats = menu.categories.filter((c) => c.id !== cat.id);
                    return (
                      <SortableSlot key={item.id} id={item.id} data={{ type: "item", catId: cat.id }}>
                        {({ setNodeRef: setItemRef, style: itemStyle, dragHandleProps, isDragging }) => (
                      <React.Fragment>
                      <div ref={setItemRef} style={{ ...itemStyle, border: `1px solid ${t.line}`, borderRadius: 8, padding: 12, marginBottom: 10, background: t.bg, opacity: item.visible === false ? 0.6 : itemStyle.opacity, boxShadow: isDragging ? "0 8px 18px rgba(0,0,0,0.18)" : undefined }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                          <DragHandle t={t} size={13} dragHandleProps={dragHandleProps} label="Trascina per riordinare la voce" />
                          <div style={{ display: "flex", gap: 2 }}>
                            <button
                              onClick={() => moveItem(cat.id, item.id, -1)}
                              disabled={itemIdx === 0}
                              className="mdp-btn"
                              style={{ ...btnGhost(t), padding: "5px 6px", opacity: itemIdx === 0 ? 0.35 : 1, cursor: itemIdx === 0 ? "default" : "pointer" }}
                              aria-label="Sposta voce su"
                              title="Sposta voce su"
                            >
                              <ArrowUp size={13} />
                            </button>
                            <button
                              onClick={() => moveItem(cat.id, item.id, 1)}
                              disabled={itemIdx === cat.items.length - 1}
                              className="mdp-btn"
                              style={{ ...btnGhost(t), padding: "5px 6px", opacity: itemIdx === cat.items.length - 1 ? 0.35 : 1, cursor: itemIdx === cat.items.length - 1 ? "default" : "pointer" }}
                              aria-label="Sposta voce giù"
                              title="Sposta voce giù"
                            >
                              <ArrowDown size={13} />
                            </button>
                          </div>
                          {otherCats.length > 0 && (
                            <select
                              value=""
                              onChange={(e) => moveItemToCategory(cat.id, item.id, e.target.value)}
                              style={{ ...inputStyle, width: "auto", padding: "6px 8px", fontSize: TYPE.labelPlus }}
                              aria-label="Sposta voce in un'altra categoria"
                            >
                              <option value="">Sposta in categoria…</option>
                              {otherCats.map((c) => (
                                <option key={c.id} value={c.id}>{c.name || "Senza nome"}</option>
                              ))}
                            </select>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: 12, marginBottom: 10, alignItems: "flex-start" }}>
                          {item.image ? (
                            <img src={optimizedImageUrl(item.image, { width: 112 })} alt={item.name} style={{ width: 56, height: 56, borderRadius: 8, objectFit: "contain", background: t.bgAlt, border: `1px solid ${t.line}`, flexShrink: 0 }} />
                          ) : (
                            <div style={{ width: 56, height: 56, borderRadius: 8, border: `1px dashed ${t.line}`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: TYPE.micro, color: t.inkSoft, textAlign: "center" }}>
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
                                  style={btnDanger(t)}
                                >
                                  <ImageOff size={12} /> Rimuovi
                                </button>
                              )}
                            </div>
                            {uploadErrors[item.id] && (
                              <div style={{ display: "flex", gap: 5, alignItems: "center", color: t.accent2, fontSize: TYPE.labelPlus, marginTop: 6 }}>
                                <AlertCircle size={12} /> {uploadErrors[item.id]}
                              </div>
                            )}
                          </div>
                        </div>

                        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "2fr 1fr 1fr 1fr" }}>
                          <div>
                            <span style={labelStyle}>Nome piatto</span>
                            <input style={inputStyle} value={item.name} onChange={(e) => updateItem(cat.id, item.id, "name", e.target.value)} />
                          </div>
                          <div>
                            <span style={labelStyle}>Prezzo (o "SU RICHIESTA")</span>
                            <input style={inputStyle} value={item.price} onChange={(e) => updateItem(cat.id, item.id, "price", e.target.value)} />
                          </div>
                          <div>
                            <span style={labelStyle} title="Usato solo per calcolare il margine in Statistiche — mai mostrato ai clienti">
                              Costo interno <Lock size={9} style={{ verticalAlign: -1 }} />
                            </span>
                            <input
                              data-testid={`item-cost-${item.id}`}
                              style={inputStyle} placeholder="0,00" disabled={menuCosts === null}
                              value={menuCosts?.[item.id] || ""}
                              onChange={(e) => updateCost(item.id, e.target.value)}
                            />
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
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, flexWrap: "wrap", gap: 10 }}>
                          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                            <Toggle
                              t={t}
                              checked={item.visible !== false}
                              onChange={(v) => updateItem(cat.id, item.id, "visible", v)}
                              label={item.visible === false ? "Nascosto ai clienti" : "Visibile ai clienti"}
                            />
                            <Toggle
                              t={t}
                              checked={item.staffOnly === true}
                              onChange={(v) => updateItem(cat.id, item.id, "staffOnly", v)}
                              label={item.staffOnly === true ? "Riservato allo staff (fuori menù)" : "Nel menù pubblico"}
                            />
                          </div>
                          <button
                            onClick={() => (itDelete ? removeItem(cat.id, item.id) : setConfirmDelete({ type: "item", itemId: item.id, catId: cat.id }))}
                            className="mdp-btn"
                            style={btnDanger(t)}
                          >
                            <Trash2 size={12} /> {itDelete ? "Conferma eliminazione" : "Elimina voce"}
                          </button>
                        </div>
                      </div>
                      {item.id === newItemId && (
                        <div style={{
                          ...cardStyle(t), borderColor: t.accent2, padding: "10px 14px", marginTop: -4, marginBottom: 10,
                          display: "flex", alignItems: "flex-start", gap: 8, flexWrap: "wrap",
                        }}>
                          <AlertCircle size={14} color={t.accent2} style={{ flexShrink: 0, marginTop: 2 }} />
                          <div style={{ flex: 1, minWidth: 200 }}>
                            <div style={{ fontSize: TYPE.smallPlus, color: t.ink }}>
                              Questa voce non ha ancora una traduzione: ai clienti che leggono il menù in un'altra lingua verrà mostrata in italiano finché non generi la traduzione.
                            </div>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                              {LANGUAGES.filter((l) => l.code !== "it").map((l) => (
                                <button key={l.code} onClick={() => changeLang(l.code)} className="mdp-btn" style={btnGhost(t)}>
                                  <Sparkles size={12} /> Traduci in {l.label}
                                </button>
                              ))}
                            </div>
                          </div>
                          <button
                            onClick={() => setNewItemId(null)}
                            className="mdp-btn"
                            aria-label="Chiudi avviso"
                            style={{ background: "none", border: "none", cursor: "pointer", color: t.inkSoft, padding: 2 }}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      )}
                      </React.Fragment>
                        )}
                      </SortableSlot>
                    );
                  })}
                  </SortableContext>

                  {cat.items.length === 0 && <EmptyCategoryDropZone t={t} catId={cat.id} />}

                  <button onClick={() => addItem(cat.id)} className="mdp-btn" style={btnGhost(t)}>
                    <Plus size={13} /> Aggiungi voce
                  </button>
                </div>
              )}
            </div>
                    )}
                  </SortableSlot>
                );
              })}
            </SortableContext>
            <DragOverlay>
              {activeDrag ? (
                <div style={{ ...cardStyle(t), padding: "10px 16px", background: t.card, boxShadow: "0 12px 28px rgba(0,0,0,0.22)", display: "flex", alignItems: "center", gap: 8, fontSize: TYPE.smallPlus, fontWeight: 600 }}>
                  <GripVertical size={14} /> {activeDrag.label}
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}

        {lang === "it" && (
          <button onClick={addCategory} className="mdp-btn" style={{ ...btnPrimary(t), width: "100%", justifyContent: "center" }}>
            <Plus size={14} /> Aggiungi categoria
          </button>
        )}

        {/* JSON export/import (manual backup) and the printable PDF
            version (via the browser's print dialog, see src/PrintMenu.jsx). */}
        <div style={{ ...cardStyle(t), marginTop: 24 }}>
          <div style={{ fontSize: TYPE.small, letterSpacing: 1, textTransform: "uppercase", color: t.secondary, marginBottom: 14 }}>
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
            <div style={{ display: "flex", gap: 6, alignItems: "center", color: t.accent2, fontSize: TYPE.smallPlus, marginTop: 10 }}>
              <AlertCircle size={14} /> {importError}
            </div>
          )}
          <div style={{ fontSize: TYPE.label, color: t.inkSoft, marginTop: 10, lineHeight: 1.4 }}>
            L'importazione sostituisce il menù nell'editor (non salva subito): rivedi le modifiche e premi "Salva modifiche" quando sei pronto.
          </div>

          <hr className="mdp-hairline" style={{ margin: "18px 0" }} />

          <div style={{ fontSize: TYPE.label, letterSpacing: 0.8, textTransform: "uppercase", color: t.inkSoft, marginBottom: 14 }}>
            Versione stampabile (PDF)
          </div>

          <PdfOptionsGroup title="Contenuto" t={t}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: TYPE.smallPlus, color: t.inkSoft }}>
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
                      borderRadius: 20, padding: "4px 11px", fontSize: TYPE.labelPlus, cursor: "pointer",
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
            <div style={{ display: "flex", gap: 6, alignItems: "center", color: t.accent2, fontSize: TYPE.smallPlus, marginTop: 10 }}>
              <AlertCircle size={14} /> {pdfError}
            </div>
          )}
          <div style={{ fontSize: TYPE.label, color: t.inkSoft, marginTop: 10, lineHeight: 1.4 }}>
            Si apre una scheda con l'anteprima di stampa: usa "Salva come PDF" nella finestra di stampa del browser per ottenere un file.
          </div>
        </div>
      </div>
    </div>
  );
}

// Editor for one translation language: same structure as the Italian
// editor (identity, categories, entries), but text only — no price, photo,
// visibility, or add/delete: those are structural decisions that apply to
// all languages together and are made in the "IT" tab. If the language has
// no saved translation yet, only the generation button is shown.
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
      <div style={{ ...cardStyle(t), padding: 24, marginBottom: 24, textAlign: "center" }}>
        <div style={{ fontSize: TYPE.body, color: t.inkSoft, marginBottom: 14 }}>
          Nessuna traduzione {langLabel} presente per questo menù.
        </div>
        <button onClick={onGenerate} disabled={generating} className="mdp-btn" style={{ ...btnPrimary(t), margin: "0 auto" }}>
          <Sparkles size={13} /> {generating ? "Generazione…" : `Genera traduzione automatica (${langLabel})`}
        </button>
        {generateError && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "center", color: t.accent2, fontSize: TYPE.smallPlus, marginTop: 12 }}>
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
          style={{ ...btnDanger(t), fontSize: TYPE.labelPlus }}
        >
          <Trash2 size={12} /> {confirmDelete ? `Conferma eliminazione traduzione ${langLabel}` : `Elimina traduzione ${langLabel}`}
        </button>
      </div>
      {missing > 0 && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap",
          ...cardStyle(t), padding: "12px 16px", marginBottom: 16,
        }}>
          <span style={{ fontSize: TYPE.smallPlus, color: t.inkSoft }}>
            {missing} {missing === 1 ? "voce non ancora tradotta" : "voci non ancora tradotte"} in {langLabel}.
          </span>
          <button onClick={onGenerate} disabled={generating} className="mdp-btn" style={btnGhost(t)}>
            <Sparkles size={12} /> {generating ? "Generazione…" : "Genera traduzione mancante"}
          </button>
        </div>
      )}
      {generateError && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", color: t.accent2, fontSize: TYPE.smallPlus, marginBottom: 16 }}>
          <AlertCircle size={14} /> {generateError}
        </div>
      )}

      <div style={{ ...cardStyle(t), marginBottom: 24 }}>
        <div style={{ fontSize: TYPE.small, letterSpacing: 1, textTransform: "uppercase", color: t.secondary, marginBottom: 14 }}>
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
          <div key={cat.id} style={{ ...cardStyle(t), background: t.bgAlt, padding: 16, marginBottom: 16 }}>
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

// Small labeled grouping for the PDF export options (Contenuto /
// Impaginazione / Categorie da includere): the same visual idea as the
// page's sections, but more compact since they're all within the same
// "Esportazione e backup" card.
function PdfOptionsGroup({ title, t, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: TYPE.tiny, letterSpacing: 0.8, textTransform: "uppercase", color: t.secondary, marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
        {children}
      </div>
    </div>
  );
}

// Pill selector for an exclusive choice among a few options (columns, paper
// size): the same pill style already used for the language selector.
function PdfPillGroup({ t, label, options, value, onChange }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: TYPE.smallPlus, color: t.inkSoft }}>
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
              borderRadius: 20, padding: "3px 10px", fontSize: TYPE.labelPlus, cursor: "pointer",
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
  // A single interactive element (the input) covers the whole clickable
  // area; the decorative spans below are purely visual (pointer-events:
  // none), so the click is handled exactly once, reliably.
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: TYPE.smallPlus, cursor: "pointer", color: t.inkSoft }}>
      <span className="mdp-toggle" style={{ position: "relative", width: 36, height: 21, flexShrink: 0, display: "inline-block" }}>
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
    fontSize: TYPE.smallPlus, letterSpacing: 0.5, cursor: "pointer",
  };
}
function btnGhost(t) {
  return {
    display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px",
    background: "none", color: t.ink, border: `1px solid ${t.line}`, borderRadius: 6,
    fontSize: TYPE.smallPlus, cursor: "pointer",
  };
}
function btnDanger(t) {
  return { ...btnGhost(t), color: t.accent2 };
}
function cardStyle(t) {
  return { background: t.card, border: `1px solid ${t.line}`, borderRadius: 10, padding: 20 };
}

/* ============================== ADMIN (login + pannello) ============================== */
// Single exported component: manages its own auth state (login/logout) and
// shows the login form or the management panel depending on the case.
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

  // Reached from the "Gestione menù" link at the bottom of the public page:
  // without this reset, the Admin panel would show up mid-page instead of
  // from the top.
  React.useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  if (!authReady) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", ...FALLBACK_STYLE }}>
        Caricamento…
      </div>
    );
  }

  if (!authed) {
    return <AdminLogin onBack={onExit} theme={menu?.theme} />;
  }

  // The document doesn't exist yet on Firestore (see MenuApp.jsx): no
  // sample menu to show in its place, only a way to import one.
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
