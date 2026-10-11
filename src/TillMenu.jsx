// Gestione menù for the till (a "Menù" section of TillSala.jsx, admin
// accounts only) — the same layout as the order screen, so it needs no
// training: categories as tabs and dishes as tiles on the left, the selected
// thing edited in the side panel on the right.
//
//  - tap a dish → its editor in the side panel: name, price from the keypad
//    (or "Su richiesta"), "In comanda" (printed for the kitchen on "Invia
//    comanda", see kitchenTicket.js), visible/hidden, off-menu, description,
//    label, search tags, internal cost, photo, category, position;
//  - no dish selected → the current category: name, subtitle, visibility,
//    "In comanda" for all its dishes at once, position, delete;
//  - "Impostazioni" → coperto, dish search, automatic translations;
//  - "Gestione completa" → the full editor (Admin.jsx) for what a till
//    rarely needs: per-field translations, PDF, JSON backup, links, staff.
//
// Form edits apply only on "Salva"; quick commands (move, all in/out of the
// kitchen ticket, delete with confirmation) apply at once. Every save is one
// edit (menuEdit.js) applied to the menu as it is on the server right now
// (onPatch → MenuApp.jsx > handlePatch), never this device's whole copy.
import React, { useState, useEffect, Suspense, lazy } from "react";
import {
  Plus, Settings2, SlidersHorizontal, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Trash2, Check,
  Keyboard, Upload, ImageOff, Languages, Ban, ChefHat, EyeOff, Utensils, FolderPlus,
} from "lucide-react";
import { uid, formatCentsAsPrice, parsePriceToCents, LANGUAGES, countMissingTranslations, generateMissingTranslations, BackButton } from "./shared";
import { menuEdits, combineEdits } from "./menuEdit";
import { itemGoesToKitchen, defaultKitchenTicketForCategory } from "./kitchenTicket";
import { subscribeMenuCosts, saveMenuCost } from "./menuCosts";
import { uploadMenuImage, optimizedImageUrl } from "./cloudinary";
import { confirmAction } from "./confirmDialog";
import {
  TOUCH, FONT, STATUS, SIDE_PANEL_WIDTH, TillButton, SidePanel, SectionTitle, StatusPill,
  Field, SwitchRow, PriceKeypad, Notice, tillInputStyle,
} from "./TillUi";

const Admin = lazy(() => import("./Admin"));

const isOnRequest = (price) => /richiesta/i.test(price || "");
const priceLabel = (price) => (isOnRequest(price) ? "Su richiesta" : `€ ${price}`);

// Saving state shared by the panels: busy flag + one-line outcome.
function useSaver(onPatch) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const run = async (edit, okText) => {
    setBusy(true);
    setNotice(null);
    try {
      await onPatch(edit);
      if (okText) setNotice({ tone: "ok", text: okText });
      return true;
    } catch (err) {
      setNotice({ tone: "error", text: err?.message || "Salvataggio non riuscito." });
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, notice, setNotice, run };
}

/* -------------------------------- dish tile -------------------------------- */

function DishAdminTile({ t, item, selected, onSelect }) {
  const hidden = item.visible === false;
  const offMenu = item.staffOnly === true;
  const kitchen = itemGoesToKitchen(item);
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected} aria-label={`Modifica ${item.name}`} className="mdp-btn" style={{
      display: "flex", flexDirection: "column", alignItems: "stretch", gap: 6, textAlign: "left", minHeight: 120,
      padding: "12px 14px", borderRadius: 14, cursor: "pointer", fontFamily: FONT, color: t.ink,
      border: `${selected ? 2.5 : 1.5}px solid ${selected ? t.primary : t.line}`, background: selected ? `${t.primary}12` : t.card,
      opacity: hidden ? 0.7 : 1,
    }}>
      <span style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.25 }}>{item.name || "Senza nome"}</span>
      <span style={{ fontSize: 16, color: t.inkSoft }}>{priceLabel(item.price)}</span>
      <span style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: "auto" }}>
        {!kitchen && <StatusPill color={STATUS.idle}>Non in comanda</StatusPill>}
        {hidden && <StatusPill color={STATUS.danger}>Nascosto</StatusPill>}
        {offMenu && <StatusPill color={STATUS.waiting}>Fuori menù</StatusPill>}
      </span>
    </button>
  );
}

/* ------------------------------- dish editor ------------------------------- */

function DishEditor({ t, menu, item, categoryId, isNew, cost, onPatch, onClose, onSaved }) {
  const [name, setName] = useState(item.name || "");
  const [price, setPrice] = useState(item.price || "0,00");
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [kitchenTicket, setKitchenTicket] = useState(itemGoesToKitchen(item));
  const [visible, setVisible] = useState(item.visible !== false);
  const [staffOnly, setStaffOnly] = useState(item.staffOnly === true);
  const [description, setDescription] = useState(item.description || "");
  const [tag, setTag] = useState(item.tag || "");
  const [searchTags, setSearchTags] = useState(item.searchTags || "");
  const [costValue, setCostValue] = useState(cost || "");
  const [image, setImage] = useState(item.image || "");
  const [targetCatId, setTargetCatId] = useState(categoryId);
  const [uploading, setUploading] = useState(false);
  const saver = useSaver(onPatch);
  const input = tillInputStyle(t);

  const save = async () => {
    if (!name.trim()) { saver.setNotice({ tone: "error", text: "Scrivi il nome del piatto." }); return; }
    const fields = {
      name: name.trim(), price, kitchenTicket, visible, staffOnly,
      description: description.trim(), tag: tag.trim(), searchTags: searchTags.trim(), image,
    };
    let edit;
    if (isNew) {
      edit = menuEdits.addItem(targetCatId, { id: item.id, ...fields });
    } else {
      edit = combineEdits(
        menuEdits.updateItem(item.id, fields),
        targetCatId !== categoryId ? menuEdits.moveItemToCategory(item.id, targetCatId) : null,
      );
    }
    const ok = await saver.run(edit, isNew ? null : "Salvato.");
    if (!ok) return;
    if (costValue.trim() !== (cost || "")) {
      saveMenuCost(item.id, costValue.trim()).catch((err) => {
        console.error("[till] Salvataggio costo fallito:", err);
        saver.setNotice({ tone: "error", text: "Piatto salvato, ma il costo interno no: riprova." });
      });
    }
    onSaved(item.id, targetCatId);
  };

  const remove = async () => {
    const confirmed = await confirmAction({
      title: `Eliminare ${item.name || "questo piatto"}?`,
      message: "Sparisce dal menù dei clienti e dai piatti da ordinare. Le comande già fatte non cambiano.",
      confirmLabel: "Elimina piatto",
      danger: true,
    });
    if (confirmed && await saver.run(menuEdits.removeItem(item.id))) onClose();
  };

  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    saver.setNotice(null);
    try {
      setImage(await uploadMenuImage(file));
    } catch (err) {
      saver.setNotice({ tone: "error", text: err?.message || "Caricamento della foto non riuscito." });
    } finally {
      setUploading(false);
    }
  };

  const category = menu.categories.find((c) => c.id === categoryId);
  const index = category ? category.items.findIndex((it) => it.id === item.id) : -1;

  return (
    <SidePanel
      t={t}
      label={isNew ? "Nuovo piatto" : "Modifica piatto"}
      header={(
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <BackButton t={t} onClick={onClose} label="Categoria" />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 21, fontWeight: 700, lineHeight: 1.2 }}>{isNew ? "Nuovo piatto" : item.name}</div>
            <div style={{ fontSize: 14, color: t.inkSoft }}>{category?.name}</div>
          </div>
        </div>
      )}
      footer={(
        <>
          <Notice notice={saver.notice} />
          <TillButton t={t} variant="primary" size={60} icon={isNew ? Plus : Check} disabled={saver.busy || uploading} onClick={save}>
            {saver.busy ? "Salvataggio…" : isNew ? "Aggiungi piatto" : "Salva"}
          </TillButton>
        </>
      )}
    >
      <div style={{ display: "grid", gap: 18, paddingTop: 6 }}>
        <Field t={t} label="Nome">
          <input aria-label="Nome del piatto" value={name} onChange={(e) => setName(e.target.value)} style={input} placeholder="es. Orecchiette alle cime di rapa" />
        </Field>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <SectionTitle t={t}>Prezzo</SectionTitle>
            <span data-testid="till-dish-price" style={{ fontSize: 22, fontWeight: 700 }}>{priceLabel(price)}</span>
          </div>
          {keypadOpen ? (
            <PriceKeypad t={t} initialCents={isOnRequest(price) ? 0 : parsePriceToCents(price)}
              onCancel={() => setKeypadOpen(false)}
              onUse={(cents) => { setPrice(formatCentsAsPrice(cents)); setKeypadOpen(false); }} />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <TillButton t={t} icon={Keyboard} size={TOUCH} onClick={() => setKeypadOpen(true)}>Cambia prezzo</TillButton>
              <TillButton t={t} size={TOUCH} aria-pressed={isOnRequest(price)}
                onClick={() => setPrice(isOnRequest(price) ? "0,00" : "SU RICHIESTA")}
                style={isOnRequest(price) ? { borderColor: t.primary, background: `${t.primary}14` } : null}>
                Su richiesta
              </TillButton>
            </div>
          )}
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <SwitchRow t={t} label="In comanda" checked={kitchenTicket} onChange={setKitchenTicket}
            description="Stampato per la cucina quando si invia la comanda. Spegnilo per bibite e piatti che non passano dalla cucina." />
          <SwitchRow t={t} label="Disponibile" checked={visible} onChange={setVisible}
            description="Spento: non compare nel menù dei clienti né tra i piatti da ordinare (es. piatto finito)." />
          <SwitchRow t={t} label="Fuori menù" checked={staffOnly} onChange={setStaffOnly}
            description="Si ordina dalla cassa e dai telefoni, ma non compare nel menù dei clienti." />
        </div>

        <Field t={t} label="Descrizione">
          <textarea aria-label="Descrizione" rows={3} value={description} onChange={(e) => setDescription(e.target.value)}
            style={{ ...input, minHeight: 96, padding: "12px 14px", resize: "vertical", lineHeight: 1.4 }} />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field t={t} label="Etichetta">
            <input aria-label="Etichetta" value={tag} onChange={(e) => setTag(e.target.value)} style={input} placeholder="es. ROSSO" />
          </Field>
          <Field t={t} label="Costo interno">
            <input aria-label="Costo interno" inputMode="decimal" value={costValue} onChange={(e) => setCostValue(e.target.value)} style={input} placeholder="0,00" />
          </Field>
        </div>
        <Field t={t} label="Tag di ricerca" hint="Separati da virgola, mai mostrati ai clienti (es. Bibita, Alcolico).">
          <input aria-label="Tag di ricerca" value={searchTags} onChange={(e) => setSearchTags(e.target.value)} style={input} />
        </Field>

        <div>
          <SectionTitle t={t} style={{ marginBottom: 8 }}>Foto</SectionTitle>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {image
              ? <img src={optimizedImageUrl(image, { width: 160 })} alt="" style={{ width: 80, height: 80, borderRadius: 12, objectFit: "contain", background: t.bgAlt, border: `1px solid ${t.line}` }} />
              : <div style={{ width: 80, height: 80, borderRadius: 12, border: `1.5px dashed ${t.line}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: t.inkSoft, textAlign: "center" }}>nessuna foto</div>}
            <div style={{ display: "grid", gap: 8, flex: 1 }}>
              <label className="mdp-btn" style={{
                minHeight: TOUCH, borderRadius: 12, border: `1.5px solid ${t.line}`, background: t.card, color: t.ink,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 16, fontWeight: 600,
                cursor: uploading ? "default" : "pointer", opacity: uploading ? 0.5 : 1, fontFamily: FONT,
              }}>
                <Upload size={18} /> {uploading ? "Caricamento…" : image ? "Sostituisci foto" : "Carica foto"}
                <input type="file" accept="image/*" disabled={uploading} style={{ display: "none" }}
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; upload(f); }} />
              </label>
              {image && <TillButton t={t} variant="danger" size={TOUCH} icon={ImageOff} onClick={() => setImage("")}>Rimuovi foto</TillButton>}
            </div>
          </div>
        </div>

        <div>
          <SectionTitle t={t} style={{ marginBottom: 8 }}>Categoria</SectionTitle>
          <div role="group" aria-label="Categoria del piatto" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {menu.categories.map((c) => {
              const active = c.id === targetCatId;
              return (
                <button key={c.id} type="button" aria-pressed={active} onClick={() => setTargetCatId(c.id)} className="mdp-btn" style={{
                  minHeight: TOUCH, padding: "0 14px", borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: FONT,
                  border: `1.5px solid ${active ? t.primary : t.line}`, background: active ? t.primary : t.card, color: active ? t.bg : t.ink,
                }}>{c.name || "Senza nome"}</button>
              );
            })}
          </div>
        </div>

        {!isNew && (
          <div>
            <SectionTitle t={t} style={{ marginBottom: 8 }}>Posizione nel menù</SectionTitle>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <TillButton t={t} size={TOUCH} icon={ArrowUp} disabled={saver.busy || index <= 0} onClick={() => saver.run(menuEdits.moveItem(item.id, -1))}>Sposta prima</TillButton>
              <TillButton t={t} size={TOUCH} icon={ArrowDown} disabled={saver.busy || index < 0 || index >= category.items.length - 1} onClick={() => saver.run(menuEdits.moveItem(item.id, 1))}>Sposta dopo</TillButton>
            </div>
          </div>
        )}

        {!isNew && <TillButton t={t} variant="danger" icon={Trash2} disabled={saver.busy} onClick={remove}>Elimina piatto</TillButton>}
      </div>
    </SidePanel>
  );
}

/* ----------------------------- category panel ----------------------------- */

function CategoryPanel({ t, menu, category, isNew, onPatch, onCreated, onDeleted }) {
  const [name, setName] = useState(category?.name || "");
  const [subtitle, setSubtitle] = useState(category?.subtitle || "");
  const [visible, setVisible] = useState(category ? category.visible !== false : true);
  const saver = useSaver(onPatch);
  const input = tillInputStyle(t);

  if (!category && !isNew) {
    return (
      <SidePanel t={t} label="Categoria">
        <div style={{ color: t.inkSoft, fontSize: 17, padding: "28px 0" }}>Il menù non ha ancora categorie: creane una con "Nuova categoria".</div>
      </SidePanel>
    );
  }

  const dirty = isNew || name !== (category.name || "") || subtitle !== (category.subtitle || "") || visible !== (category.visible !== false);
  const save = async () => {
    if (!name.trim()) { saver.setNotice({ tone: "error", text: "Scrivi il nome della categoria." }); return; }
    const fields = { name: name.trim(), subtitle: subtitle.trim(), visible };
    if (isNew) {
      const id = `cat-${uid()}`;
      if (await saver.run(menuEdits.addCategory({ id, ...fields, items: [] }))) onCreated(id);
    } else {
      await saver.run(menuEdits.updateCategory(category.id, fields), "Salvato.");
    }
  };

  const items = category?.items || [];
  const inKitchen = items.filter(itemGoesToKitchen).length;
  const catIndex = category ? menu.categories.findIndex((c) => c.id === category.id) : -1;

  const remove = async () => {
    const confirmed = await confirmAction({
      title: `Eliminare la categoria ${category.name || ""}?`,
      message: items.length > 0
        ? `Vengono eliminati anche i suoi ${items.length} piatti. Le comande già fatte non cambiano.`
        : "La categoria è vuota.",
      confirmLabel: "Elimina categoria",
      danger: true,
    });
    if (confirmed && await saver.run(menuEdits.removeCategory(category.id))) onDeleted();
  };

  return (
    <SidePanel
      t={t}
      label={isNew ? "Nuova categoria" : "Categoria"}
      header={(
        <>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{isNew ? "Nuova categoria" : category.name || "Senza nome"}</div>
          {!isNew && (
            <div style={{ fontSize: 14, color: t.inkSoft, marginTop: 2 }}>
              {items.length} {items.length === 1 ? "piatto" : "piatti"} · {inKitchen} in comanda · tocca un piatto per modificarlo
            </div>
          )}
        </>
      )}
      footer={(
        <>
          <Notice notice={saver.notice} />
          <TillButton t={t} variant="primary" size={60} icon={isNew ? FolderPlus : Check} disabled={saver.busy || !dirty} onClick={save}>
            {saver.busy ? "Salvataggio…" : isNew ? "Crea categoria" : "Salva"}
          </TillButton>
        </>
      )}
    >
      <div style={{ display: "grid", gap: 18, paddingTop: 6 }}>
        <Field t={t} label="Nome">
          <input aria-label="Nome della categoria" value={name} onChange={(e) => setName(e.target.value)} style={input} placeholder="es. Antipasti" />
        </Field>
        <Field t={t} label="Sottotitolo (facoltativo)">
          <input aria-label="Sottotitolo" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} style={input} />
        </Field>
        <SwitchRow t={t} label="Visibile ai clienti" checked={visible} onChange={setVisible}
          description="Spenta: tutta la categoria sparisce dal menù dei clienti." />

        {!isNew && items.length > 0 && (
          <div>
            <SectionTitle t={t} style={{ marginBottom: 4 }}>Comanda in cucina</SectionTitle>
            <div style={{ fontSize: 14, color: t.inkSoft, marginBottom: 8, lineHeight: 1.4 }}>
              Per tutti i piatti della categoria, subito. Si può cambiare poi piatto per piatto.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <TillButton t={t} size={TOUCH} icon={ChefHat} disabled={saver.busy || inKitchen === items.length}
                onClick={() => saver.run(menuEdits.setCategoryKitchenTicket(category.id, true), "Tutti i piatti vanno in comanda.")}>
                Tutti in comanda
              </TillButton>
              <TillButton t={t} size={TOUCH} icon={Ban} disabled={saver.busy || inKitchen === 0}
                onClick={() => saver.run(menuEdits.setCategoryKitchenTicket(category.id, false), "Nessun piatto va in comanda.")}>
                Nessuno in comanda
              </TillButton>
            </div>
          </div>
        )}

        {!isNew && (
          <div>
            <SectionTitle t={t} style={{ marginBottom: 8 }}>Posizione nel menù</SectionTitle>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <TillButton t={t} size={TOUCH} icon={ArrowLeft} disabled={saver.busy || catIndex <= 0} onClick={() => saver.run(menuEdits.moveCategory(category.id, -1))}>Sposta prima</TillButton>
              <TillButton t={t} size={TOUCH} icon={ArrowRight} disabled={saver.busy || catIndex >= menu.categories.length - 1} onClick={() => saver.run(menuEdits.moveCategory(category.id, 1))}>Sposta dopo</TillButton>
            </div>
          </div>
        )}

        {!isNew && <TillButton t={t} variant="danger" icon={Trash2} disabled={saver.busy} onClick={remove}>Elimina categoria</TillButton>}
      </div>
    </SidePanel>
  );
}

/* ----------------------------- settings panel ----------------------------- */

function PriceSetting({ t, label, value, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <span style={{ fontSize: 17, fontWeight: 600 }}>{label}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20, fontWeight: 700 }}>€ {value || "0,00"}</span>
          {!open && <TillButton t={t} size={TOUCH} icon={Keyboard} onClick={() => setOpen(true)} aria-label={`Cambia ${label.toLowerCase()}`}>Cambia</TillButton>}
        </span>
      </div>
      {open && (
        <div style={{ marginTop: 10 }}>
          <PriceKeypad t={t} label={label} initialCents={parsePriceToCents(value)} onCancel={() => setOpen(false)}
            onUse={(cents) => { onChange(formatCentsAsPrice(cents)); setOpen(false); }} />
        </div>
      )}
    </div>
  );
}

function SettingsPanel({ t, menu, onPatch, onClose }) {
  const [adults, setAdults] = useState(menu.coperto?.adults || "0,00");
  const [children, setChildren] = useState(menu.coperto?.children || "0,00");
  const [searchEnabled, setSearchEnabled] = useState(menu.searchEnabled !== false);
  const saver = useSaver(onPatch);
  const [translating, setTranslating] = useState(null); // lang code in progress
  const [translateNotice, setTranslateNotice] = useState(null);

  const save = () => saver.run(menuEdits.updateFields({
    coperto: { ...(menu.coperto || {}), adults, children },
    searchEnabled,
  }), "Salvato.");

  const translate = async (lang) => {
    setTranslating(lang);
    setTranslateNotice(null);
    try {
      const updated = await generateMissingTranslations(menu, lang, menu.translations?.[lang]);
      await onPatch(menuEdits.setTranslation(lang, updated));
      setTranslateNotice({ tone: "ok", text: `Traduzione ${lang.toUpperCase()} aggiornata.` });
    } catch (err) {
      setTranslateNotice({ tone: "error", text: err?.message || "Traduzione non riuscita: riprova." });
    } finally {
      setTranslating(null);
    }
  };

  return (
    <SidePanel
      t={t}
      label="Impostazioni del menù"
      header={(
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <BackButton t={t} onClick={onClose} label="Categoria" />
          <div style={{ fontSize: 21, fontWeight: 700 }}>Impostazioni del menù</div>
        </div>
      )}
      footer={(
        <>
          <Notice notice={saver.notice} />
          <TillButton t={t} variant="primary" size={60} icon={Check} disabled={saver.busy} onClick={save}>{saver.busy ? "Salvataggio…" : "Salva"}</TillButton>
        </>
      )}
    >
      <div style={{ display: "grid", gap: 18, paddingTop: 6 }}>
        <div style={{ display: "grid", gap: 12 }}>
          <SectionTitle t={t}>Coperto a persona</SectionTitle>
          <PriceSetting t={t} label="Coperto adulti" value={adults} onChange={setAdults} />
          <PriceSetting t={t} label="Coperto bambini" value={children} onChange={setChildren} />
          <div style={{ fontSize: 14, color: t.inkSoft, lineHeight: 1.4 }}>Vale per i tavoli aperti da ora in poi: quelli già aperti mantengono il coperto di quando sono stati aperti.</div>
        </div>
        <SwitchRow t={t} label="Ricerca dei piatti" checked={searchEnabled} onChange={setSearchEnabled}
          description="La barra di ricerca nel menù dei clienti e nella presa della comanda." />

        <div>
          <SectionTitle t={t} style={{ marginBottom: 4 }}><Languages size={14} style={{ verticalAlign: "-2px" }} /> Traduzioni del menù</SectionTitle>
          <div style={{ fontSize: 14, color: t.inkSoft, marginBottom: 8, lineHeight: 1.4 }}>
            Traduce in automatico solo i testi mancanti (es. un piatto nuovo); quelli già corretti a mano restano come sono. Si salva subito.
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {LANGUAGES.filter((l) => l.code !== "it").map((l) => {
              const missing = countMissingTranslations(menu, menu.translations?.[l.code]);
              return (
                <div key={l.code} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: TOUCH }}>
                  <span style={{ fontSize: 17, fontWeight: 600 }}>
                    {l.label} <span style={{ fontSize: 15, fontWeight: 500, color: missing ? STATUS.waiting : STATUS.ok }}>· {missing ? `${missing} da tradurre` : "completa"}</span>
                  </span>
                  {missing > 0 && (
                    <TillButton t={t} size={TOUCH} disabled={translating !== null} onClick={() => translate(l.code)} aria-label={`Traduci in ${l.label}`}>
                      {translating === l.code ? "Traduzione…" : "Traduci"}
                    </TillButton>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 8 }}><Notice notice={translateNotice} /></div>
        </div>
      </div>
    </SidePanel>
  );
}

/* ------------------------------ full editor ------------------------------ */

// The complete editor (Admin.jsx) inside the till, for the rare tasks: it
// keeps its own draft + "Salva modifiche"; leaving with unsaved changes asks
// to save first (otherwise they'd stay on this screen only).
function FullEditor({ t, menu, admin, onBack }) {
  const back = async () => {
    if (admin.hasUnsavedChanges) {
      const save = await confirmAction({
        title: "Ci sono modifiche non salvate",
        message: "Salvale prima di tornare al menù della cassa, altrimenti restano solo su questo schermo.",
        confirmLabel: "Salva e torna",
        cancelLabel: "Resta qui",
      });
      if (!save) return;
      await admin.onSave();
    }
    onBack();
  };
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 20px", borderBottom: `1px solid ${t.line}`, background: t.bgAlt, fontFamily: FONT }}>
        <BackButton t={t} onClick={back} label="Menù della cassa" />
        <span style={{ fontSize: 15, color: t.inkSoft }}>Gestione completa: traduzioni testo per testo, PDF, backup, link e personale.</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <Suspense fallback={<div style={{ padding: 40, color: t.inkSoft, fontSize: 18, fontFamily: FONT }}>Caricamento…</div>}>
          <Admin
            menu={menu} setMenu={admin.setMenu} onSave={admin.onSave} saving={admin.saving} savedAt={admin.savedAt}
            saveError={admin.saveError} onExit={onBack} onUndo={admin.onUndo} canUndo={admin.canUndo}
          />
        </Suspense>
      </div>
    </div>
  );
}

/* ---------------------------------- shell ---------------------------------- */

export default function TillMenu({ t, menu, admin }) {
  const [categoryId, setCategoryId] = useState(null);
  // null (the category) | { type: "dish", itemId } | { type: "newDish", item } | { type: "newCategory" } | { type: "settings" }
  const [selection, setSelection] = useState(null);
  const [full, setFull] = useState(false);
  const [costs, setCosts] = useState({});

  useEffect(() => subscribeMenuCosts(setCosts, (err) => console.error("[till] Errore lettura costi piatti:", err)), []);

  if (full) return <FullEditor t={t} menu={menu} admin={admin} onBack={() => setFull(false)} />;

  const categories = menu?.categories || [];
  const activeCat = categories.find((c) => c.id === categoryId) || categories[0] || null;
  const selectedItemId = selection?.type === "dish" ? selection.itemId : null;
  let selectedItem = null;
  let selectedItemCatId = null;
  if (selectedItemId) {
    for (const c of categories) {
      const it = c.items.find((i) => i.id === selectedItemId);
      if (it) { selectedItem = it; selectedItemCatId = c.id; break; }
    }
  }

  const chip = (active) => ({
    flexShrink: 0, minHeight: 52, padding: "0 20px", borderRadius: 12, fontSize: 17, fontWeight: 600, cursor: "pointer", fontFamily: FONT,
    border: `1.5px solid ${active ? t.primary : t.line}`, background: active ? t.primary : t.card, color: active ? t.bg : t.ink,
    display: "inline-flex", alignItems: "center", gap: 6,
  });

  const newDish = () => {
    if (!activeCat) return;
    setSelection({
      type: "newDish",
      item: { id: uid(), name: "", price: "0,00", visible: true, staffOnly: false, kitchenTicket: defaultKitchenTicketForCategory(activeCat) },
    });
  };

  let panel;
  if (selection?.type === "settings") {
    panel = <SettingsPanel t={t} menu={menu} onPatch={admin.onPatch} onClose={() => setSelection(null)} />;
  } else if (selection?.type === "newCategory") {
    panel = <CategoryPanel key="new-category" t={t} menu={menu} isNew onPatch={admin.onPatch}
      onCreated={(id) => { setCategoryId(id); setSelection(null); }} onDeleted={() => setSelection(null)} />;
  } else if (selection?.type === "newDish" && activeCat) {
    panel = <DishEditor key={selection.item.id} t={t} menu={menu} item={selection.item} categoryId={activeCat.id} isNew
      onPatch={admin.onPatch} onClose={() => setSelection(null)}
      onSaved={(itemId, catId) => { setCategoryId(catId); setSelection({ type: "dish", itemId }); }} />;
  } else if (selectedItem) {
    panel = <DishEditor key={selectedItem.id} t={t} menu={menu} item={selectedItem} categoryId={selectedItemCatId}
      cost={costs[selectedItem.id] || ""} onPatch={admin.onPatch} onClose={() => setSelection(null)}
      onSaved={(itemId, catId) => setCategoryId(catId)} />;
  } else {
    panel = <CategoryPanel key={activeCat?.id || "none"} t={t} menu={menu} category={activeCat} onPatch={admin.onPatch}
      onCreated={() => {}} onDeleted={() => { setCategoryId(null); setSelection(null); }} />;
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: `minmax(0, 1fr) ${SIDE_PANEL_WIDTH}`, fontFamily: FONT, color: t.ink }}>
      <section aria-label="Piatti del menù" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 20px", borderBottom: `1px solid ${t.line}`, flexWrap: "wrap" }}>
          <div style={{ fontSize: 24, fontWeight: 700, marginRight: "auto" }}>Menù</div>
          <TillButton t={t} size={TOUCH} icon={FolderPlus} onClick={() => setSelection({ type: "newCategory" })}>Nuova categoria</TillButton>
          <TillButton t={t} size={TOUCH} icon={Settings2} aria-pressed={selection?.type === "settings"} onClick={() => setSelection({ type: "settings" })}>Impostazioni</TillButton>
          <TillButton t={t} size={TOUCH} variant="ghost" icon={SlidersHorizontal} onClick={() => setFull(true)}>Gestione completa</TillButton>
        </div>

        <div role="tablist" aria-label="Categorie del menù" style={{ display: "flex", gap: 8, overflowX: "auto", padding: "12px 20px 4px", flexShrink: 0 }}>
          {categories.map((c) => {
            const active = activeCat?.id === c.id;
            return (
              <button key={c.id} type="button" role="tab" aria-selected={active}
                onClick={() => { setCategoryId(c.id); setSelection(null); }} className="mdp-btn" style={chip(active)}>
                {c.visible === false && <EyeOff size={16} aria-label="nascosta" />}
                {c.name || "Senza nome"}
              </button>
            );
          })}
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 20px 96px" }}>
          {activeCat && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
              <button type="button" onClick={newDish} aria-label={`Nuovo piatto in ${activeCat.name || "questa categoria"}`} className="mdp-btn" style={{
                minHeight: 120, borderRadius: 14, border: `2px dashed ${t.primary}`, background: t.bg, color: t.primary,
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6,
                fontSize: 17, fontWeight: 700, cursor: "pointer", fontFamily: FONT,
              }}>
                <Plus size={32} strokeWidth={2.5} /> Nuovo piatto
              </button>
              {activeCat.items.map((item) => (
                <DishAdminTile key={item.id} t={t} item={item} selected={item.id === selectedItemId}
                  onSelect={() => setSelection({ type: "dish", itemId: item.id })} />
              ))}
            </div>
          )}
          {activeCat && activeCat.items.length === 0 && (
            <div style={{ color: t.inkSoft, fontSize: 16, marginTop: 14, display: "flex", alignItems: "center", gap: 8 }}>
              <Utensils size={18} /> Nessun piatto in questa categoria.
            </div>
          )}
        </div>
      </section>
      {panel}
    </div>
  );
}
