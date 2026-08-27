// Pannello di gestione del menù (login + editor). Questo file viene
// scaricato SOLO quando qualcuno clicca "Gestione menù" nel sito pubblico
// (caricamento differito, vedi React.lazy in MenuApp.jsx) — così i clienti
// che guardano solo il menù non scaricano mai Firebase Authentication.
import React, { useState } from "react";
import { Plus, Trash2, Save, Lock, LogOut, Eye, ChevronDown, ChevronUp, RotateCcw, ShieldCheck, AlertCircle, Star, Upload, ImageOff } from "lucide-react";
import { auth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "./firebase-auth";
import { THEMES, ital, uid, GlobalStyle, Logo } from "./shared";
import { uploadMenuImage, optimizedImageUrl } from "./cloudinary";

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

/* ============================== ADMIN DASHBOARD ============================== */
function AdminPanel({ menu, setMenu, onSave, saving, savedAt, saveError, onLogout, onPreview, onReset }) {
  const t = THEMES[menu.theme] || THEMES.rustica;
  const [openCats, setOpenCats] = useState(() => new Set(menu.categories.map((c) => c.id)));
  const [confirmDelete, setConfirmDelete] = useState(null); // {type:'cat'|'item', catId, itemId}
  const [resetConfirm, setResetConfirm] = useState(false);
  const [uploadingItem, setUploadingItem] = useState(null); // id della voce con upload in corso
  const [uploadErrors, setUploadErrors] = useState({}); // { [itemId]: messaggio }

  const toggleCat = (id) => {
    setOpenCats((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const updateField = (field, value) => setMenu((m) => ({ ...m, [field]: value }));

  const updateReviewLink = (platform, field, value) => {
    setMenu((m) => {
      const current = m.reviewLinks || {};
      const currentPlatform = current[platform] || { url: "", visible: false };
      return {
        ...m,
        reviewLinks: {
          ...current,
          [platform]: { ...currentPlatform, [field]: value },
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
                  onChange={(v) => updateReviewLink("google", "visible", v)}
                  label="Visibile ai clienti"
                />
              </div>
              <input
                style={inputStyle}
                placeholder="https://g.page/r/…/review"
                value={google.url}
                onChange={(e) => updateReviewLink("google", "url", e.target.value)}
              />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={labelStyle}>Link recensione TripAdvisor</span>
                <Toggle
                  t={t}
                  checked={tripadvisor.visible === true}
                  onChange={(v) => updateReviewLink("tripadvisor", "visible", v)}
                  label="Visibile ai clienti"
                />
              </div>
              <input
                style={inputStyle}
                placeholder="https://www.tripadvisor.it/UserReview…"
                value={tripadvisor.url}
                onChange={(e) => updateReviewLink("tripadvisor", "url", e.target.value)}
              />
            </div>
          </div>
          <div style={{ fontSize: 11, color: t.inkSoft, marginTop: 12, lineHeight: 1.4 }}>
            I pulsanti compaiono nel piè di pagina del menù solo quando sono attivi e hanno un link impostato.
          </div>
        </div>

        {/* Categories */}
        {menu.categories.map((cat) => {
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

        <button onClick={addCategory} className="mdp-btn" style={{ ...btnPrimary(t), width: "100%", justifyContent: "center" }}>
          <Plus size={14} /> Aggiungi categoria
        </button>

        <div style={{ marginTop: 30, textAlign: "center" }}>
          <button
            onClick={() => (resetConfirm ? (onReset(), setResetConfirm(false)) : setResetConfirm(true))}
            className="mdp-btn"
            style={{ ...btnGhost(t), color: t.accent2, margin: "0 auto" }}
          >
            <RotateCcw size={13} /> {resetConfirm ? "Conferma ripristino menù predefinito" : "Ripristina menù predefinito"}
          </button>
        </div>
      </div>
    </div>
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
export default function Admin({ menu, setMenu, onSave, saving, savedAt, saveError, onExit, onReset }) {
  const [authed, setAuthed] = useState(false);
  const [authReady, setAuthReady] = useState(false);

  React.useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (fbUser) => {
      setAuthed(!!fbUser);
      setAuthReady(true);
    });
    return unsubscribe;
  }, []);

  if (!authReady) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "sans-serif", color: "#6E2A2A" }}>
        Caricamento…
      </div>
    );
  }

  if (!authed) {
    return <AdminLogin onBack={onExit} theme={menu.theme} />;
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
      onReset={onReset}
    />
  );
}
