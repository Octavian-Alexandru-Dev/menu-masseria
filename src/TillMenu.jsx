// Gestione menù for the till (a "Menù" section of TillSala.jsx, admin
// accounts only) — the same layout as the order screen, so it needs no
// training: every category at once in a grid (CategoryGrid) and dishes as
// tiles with their photo on the left, the selected
// thing edited in the side panel on the right.
//
//  - tap a dish → its editor in the side panel: name, price from the keypad
//    (or "Su richiesta"), "In comanda" (printed for the kitchen on "Invia
//    comanda", see kitchenTicket.js), visible/hidden, off-menu, description,
//    label, search tags, internal cost, photo, category, position;
//  - no dish selected → the current category: name, subtitle, visibility,
//    "In comanda" for all its dishes at once, position, delete;
//  - "Impostazioni" → everything else about the menu (MenuSettings.jsx):
//    identity and theme, cover charge and search, links, translations,
//    staff, printable menu, backup.
//
// The same screen runs on phones (PhoneApp.jsx), laid out in one column
// with the panels as full-screen pages (`compact`).
//
// Form edits apply only on "Salva"; quick commands (move, all in/out of the
// kitchen ticket, delete with confirmation) apply at once. Every save is one
// edit (menuEdit.js) applied to the menu as it is on the server right now
// (onPatch → MenuApp.jsx > handlePatch), never this device's whole copy.
import React, { useState, useEffect } from "react";
import {
  Plus, Settings2, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Trash2, Check, Keyboard, Upload, ImageOff, Ban, ChefHat, EyeOff, Utensils, FolderPlus,
} from "lucide-react";
import { uid, formatCentsAsPrice, parsePriceToCents, BackButton } from "./shared";
import { menuEdits, combineEdits } from "./menuEdit";
import MenuSettings, { useSaver } from "./MenuSettings";
import { itemGoesToKitchen, defaultKitchenTicketForCategory } from "./kitchenTicket";
import { subscribeMenuCosts, saveMenuCost } from "./menuCosts";
import { uploadMenuImage, optimizedImageUrl } from "./cloudinary";
import { confirmAction } from "./confirmDialog";
import {
  TOUCH, FONT, STATUS, SIDE_PANEL_WIDTH, TillButton, SidePanel, SectionTitle, StatusPill,
  Field, SwitchRow, PriceKeypad, Notice, tillInputStyle, useCompactLayout, CategoryGrid, DishThumb,
} from "./TillUi";

const isOnRequest = (price) => /richiesta/i.test(price || "");
const priceLabel = (price) => (isOnRequest(price) ? "Su richiesta" : `€ ${price}`);

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
      <span style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <DishThumb t={t} src={item.image ? optimizedImageUrl(item.image, { width: 96 }) : ""} size={48} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 17, fontWeight: 600, lineHeight: 1.25, overflowWrap: "anywhere" }}>{item.name || "Senza nome"}</span>
          <span style={{ display: "block", fontSize: 16, color: t.inkSoft, marginTop: 4 }}>{priceLabel(item.price)}</span>
        </span>
      </span>
      <span style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: "auto" }}>
        {!kitchen && <StatusPill color={STATUS.idle}>Non in comanda</StatusPill>}
        {hidden && <StatusPill color={STATUS.danger}>Nascosto</StatusPill>}
        {offMenu && <StatusPill color={STATUS.waiting}>Fuori menù</StatusPill>}
      </span>
    </button>
  );
}

/* ------------------------------- dish editor ------------------------------- */

// Values as the panel shows them, to tell what the user actually changed.
function dishFormValues(item, cost, categoryId) {
  return {
    name: (item.name || "").trim(), price: item.price || "0,00", kitchenTicket: itemGoesToKitchen(item),
    visible: item.visible !== false, staffOnly: item.staffOnly === true, description: (item.description || "").trim(),
    tag: (item.tag || "").trim(), searchTags: (item.searchTags || "").trim(), image: item.image || "",
    cost: cost || "", categoryId,
  };
}

function DishEditor({ t, menu, item, categoryId, isNew, cost, onPatch, onClose, onSaved, sheet = false }) {
  // What the panel opened with: "Salva" writes only the fields changed since
  // then, so it never puts back what another device changed meanwhile.
  const [opened, setOpened] = useState(() => dishFormValues(item, cost, categoryId));
  const [name, setName] = useState(opened.name);
  const [price, setPrice] = useState(opened.price);
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [kitchenTicket, setKitchenTicket] = useState(opened.kitchenTicket);
  const [kitchenTouched, setKitchenTouched] = useState(false);
  const [visible, setVisible] = useState(opened.visible);
  const [staffOnly, setStaffOnly] = useState(opened.staffOnly);
  const [description, setDescription] = useState(opened.description);
  const [tag, setTag] = useState(opened.tag);
  const [searchTags, setSearchTags] = useState(opened.searchTags);
  const [costValue, setCostValue] = useState(opened.cost);
  // The costs arrive on their own (menuCosts.js): a panel opened before they
  // did shows the cost as soon as it arrives, unless it's been changed here.
  useEffect(() => {
    if (isNew || (cost || "") === opened.cost) return;
    setCostValue((current) => (current === opened.cost ? cost || "" : current));
    setOpened((o) => ({ ...o, cost: cost || "" }));
  }, [cost]); // eslint-disable-line react-hooks/exhaustive-deps
  const [costKeypadOpen, setCostKeypadOpen] = useState(false);
  const [image, setImage] = useState(opened.image);
  const [targetCatId, setTargetCatId] = useState(categoryId);
  const [uploading, setUploading] = useState(false);
  const saver = useSaver(onPatch);
  const input = tillInputStyle(t);

  // A new dish takes "In comanda" from the category it goes into, until the
  // switch is touched by hand.
  const chooseCategory = (cat) => {
    setTargetCatId(cat.id);
    if (isNew && !kitchenTouched) setKitchenTicket(defaultKitchenTicketForCategory(cat));
  };

  const save = async () => {
    if (!name.trim()) { saver.setNotice({ tone: "error", text: "Scrivi il nome del piatto." }); return; }
    const current = {
      name: name.trim(), price, kitchenTicket, visible, staffOnly,
      description: description.trim(), tag: tag.trim(), searchTags: searchTags.trim(), image,
    };
    const costChanged = costValue !== opened.cost;
    let edit;
    if (isNew) {
      edit = menuEdits.addItem(targetCatId, { id: item.id, ...current });
    } else {
      const changed = Object.fromEntries(Object.entries(current).filter(([key, value]) => value !== opened[key]));
      const moved = targetCatId !== opened.categoryId;
      if (Object.keys(changed).length === 0 && !moved) {
        if (!costChanged) { saver.setNotice({ tone: "info", text: "Nessuna modifica da salvare." }); return; }
      } else {
        edit = combineEdits(
          Object.keys(changed).length > 0 ? menuEdits.updateItem(item.id, changed) : null,
          moved ? menuEdits.moveItemToCategory(item.id, targetCatId) : null,
        );
      }
    }
    if (edit) {
      const ok = await saver.run(edit, isNew ? null : "Salvato.");
      if (!ok) return;
    }
    if (costChanged) {
      try {
        await saveMenuCost(item.id, costValue);
        if (!edit) saver.setNotice({ tone: "ok", text: "Salvato." });
      } catch (err) {
        console.error("[till] Salvataggio costo fallito:", err);
        saver.setNotice({ tone: "error", text: edit ? "Piatto salvato, ma il costo interno no: riprova." : "Costo interno non salvato: riprova." });
        setOpened({ ...current, cost: opened.cost, categoryId: targetCatId });
        if (edit) onSaved(item.id, targetCatId);
        return;
      }
    }
    setOpened({ ...current, cost: costValue, categoryId: targetCatId });
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
      sheet={sheet}
      label={isNew ? "Nuovo piatto" : "Modifica piatto"}
      header={(
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <BackButton t={t} onClick={onClose} label={sheet ? "Piatti" : "Categoria"} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 21, fontWeight: 700, lineHeight: 1.2 }}>{isNew ? "Nuovo piatto" : item.name}</div>
            <div style={{ fontSize: 14, color: t.inkSoft }}>{category?.name}</div>
          </div>
        </div>
      )}
      footer={(
        <>
          <Notice notice={saver.notice} />
          {(keypadOpen || costKeypadOpen) && (
            <div style={{ fontSize: 15, color: t.inkSoft, textAlign: "center" }}>Conferma l'importo con «Usa» (o «Annulla») prima di salvare.</div>
          )}
          <TillButton t={t} variant="primary" size={60} icon={isNew ? Plus : Check} disabled={saver.busy || uploading || keypadOpen || costKeypadOpen} onClick={save}>
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
          <SwitchRow t={t} label="In comanda" checked={kitchenTicket} onChange={(v) => { setKitchenTicket(v); setKitchenTouched(true); }}
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
        <Field t={t} label="Etichetta">
          <input aria-label="Etichetta" value={tag} onChange={(e) => setTag(e.target.value)} style={input} placeholder="es. ROSSO" />
        </Field>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <SectionTitle t={t}>Costo interno</SectionTitle>
            <span data-testid="till-dish-cost" style={{ fontSize: 20, fontWeight: 700 }}>{costValue ? `€ ${costValue}` : "non indicato"}</span>
          </div>
          {costKeypadOpen ? (
            <PriceKeypad t={t} label="Costo interno" initialCents={parsePriceToCents(costValue)}
              onCancel={() => setCostKeypadOpen(false)}
              onUse={(cents) => { setCostValue(cents > 0 ? formatCentsAsPrice(cents) : ""); setCostKeypadOpen(false); }} />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <TillButton t={t} icon={Keyboard} size={TOUCH} onClick={() => setCostKeypadOpen(true)}>Cambia costo</TillButton>
              <TillButton t={t} size={TOUCH} disabled={!costValue} onClick={() => setCostValue("")}>Nessun costo</TillButton>
            </div>
          )}
          <div style={{ fontSize: 13, color: t.inkSoft, marginTop: 6 }}>Solo per le statistiche (margine), mai mostrato ai clienti.</div>
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
                <button key={c.id} type="button" aria-pressed={active} onClick={() => chooseCategory(c)} className="mdp-btn" style={{
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

function CategoryPanel({ t, menu, category, isNew, onPatch, onCreated, onDeleted, sheet = false, onClose }) {
  // As in DishEditor: "Salva" writes only what changed since the panel opened.
  const [opened, setOpened] = useState(() => ({
    name: category?.name || "", subtitle: category?.subtitle || "", visible: category ? category.visible !== false : true,
  }));
  const [name, setName] = useState(opened.name);
  const [subtitle, setSubtitle] = useState(opened.subtitle);
  const [visible, setVisible] = useState(opened.visible);
  const [newId] = useState(() => `cat-${uid()}`); // one id per new category: a retry can't make two
  const saver = useSaver(onPatch);
  const input = tillInputStyle(t);

  if (!category && !isNew) {
    return (
      <SidePanel t={t} label="Categoria">
        <div style={{ color: t.inkSoft, fontSize: 17, padding: "28px 0" }}>Il menù non ha ancora categorie: creane una con "Nuova categoria".</div>
      </SidePanel>
    );
  }

  const fields = { name: name.trim(), subtitle: subtitle.trim(), visible };
  const changed = Object.fromEntries(Object.entries(fields).filter(([key, value]) => value !== opened[key]));
  const dirty = isNew || Object.keys(changed).length > 0;
  const save = async () => {
    if (!name.trim()) { saver.setNotice({ tone: "error", text: "Scrivi il nome della categoria." }); return; }
    if (isNew) {
      if (await saver.run(menuEdits.addCategory({ id: newId, ...fields, items: [] }))) onCreated(newId);
    } else if (await saver.run(menuEdits.updateCategory(category.id, changed), "Salvato.")) {
      setOpened(fields);
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
      sheet={sheet}
      label={isNew ? "Nuova categoria" : "Categoria"}
      header={(
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {sheet && <BackButton t={t} onClick={onClose} label="Piatti" />}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{isNew ? "Nuova categoria" : category.name || "Senza nome"}</div>
            {!isNew && (
              <div style={{ fontSize: 14, color: t.inkSoft, marginTop: 2 }}>
                {items.length} {items.length === 1 ? "piatto" : "piatti"} · {inKitchen} in comanda{sheet ? "" : " · tocca un piatto per modificarlo"}
              </div>
            )}
          </div>
        </div>
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

/* ---------------------------------- shell ---------------------------------- */

// admin: { onPatch, onRestore, onExit? } (MenuApp.jsx). On phones
// (useCompactLayout) the same screen in one column — category chips and
// dish tiles in two columns — and the side panel's editors open as
// full-screen pages with "Salva" at the bottom.
export default function TillMenu({ t, menu, admin }) {
  const compact = useCompactLayout();
  const [categoryId, setCategoryId] = useState(null);
  // null (the category) | { type: "dish", itemId } | { type: "newDish", item } | { type: "newCategory" } | { type: "settings", page }
  // | { type: "category" } (phone only: on the till the category is what the panel shows by default)
  const [selection, setSelection] = useState(null);
  const [costs, setCosts] = useState({});

  useEffect(() => subscribeMenuCosts(setCosts, (err) => console.error("[till] Errore lettura costi piatti:", err)), []);

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

  const newDish = () => {
    if (!activeCat) return;
    setSelection({
      type: "newDish",
      item: { id: uid(), name: "", price: "0,00", visible: true, staffOnly: false, kitchenTicket: defaultKitchenTicketForCategory(activeCat) },
    });
  };
  const close = () => setSelection(null);

  let panel;
  if (selection?.type === "settings") {
    panel = <MenuSettings t={t} menu={menu} admin={admin} page={selection.page || null} sheet={compact}
      onPage={(page) => setSelection({ type: "settings", page })} onClose={close} />;
  } else if (selection?.type === "newCategory") {
    panel = <CategoryPanel key="new-category" t={t} menu={menu} isNew onPatch={admin.onPatch} sheet={compact} onClose={close}
      onCreated={(id) => { setCategoryId(id); setSelection(null); }} onDeleted={close} />;
  } else if (selection?.type === "newDish" && activeCat) {
    panel = <DishEditor key={selection.item.id} t={t} menu={menu} item={selection.item} categoryId={activeCat.id} isNew sheet={compact}
      onPatch={admin.onPatch} onClose={close}
      onSaved={(itemId, catId) => { setCategoryId(catId); setSelection({ type: "dish", itemId }); }} />;
  } else if (selectedItem) {
    panel = <DishEditor key={selectedItem.id} t={t} menu={menu} item={selectedItem} categoryId={selectedItemCatId} sheet={compact}
      cost={costs[selectedItem.id] || ""} onPatch={admin.onPatch} onClose={close}
      onSaved={(itemId, catId) => setCategoryId(catId)} />;
  } else if (!compact || selection?.type === "category") {
    panel = <CategoryPanel key={activeCat?.id || "none"} t={t} menu={menu} category={activeCat} onPatch={admin.onPatch} sheet={compact} onClose={close}
      onCreated={() => {}} onDeleted={() => { setCategoryId(null); setSelection(null); }} />;
  }

  const tiles = activeCat && (
    <div style={{ display: "grid", gridTemplateColumns: compact ? "repeat(2, minmax(0, 1fr))" : "repeat(auto-fill, minmax(180px, 1fr))", gap: compact ? 10 : 12 }}>
      <button type="button" onClick={newDish} aria-label={`Nuovo piatto in ${activeCat.name || "questa categoria"}`} className="mdp-btn" style={{
        minHeight: compact ? 100 : 120, borderRadius: 14, border: `2px dashed ${t.primary}`, background: t.bg, color: t.primary,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6,
        fontSize: compact ? 16 : 17, fontWeight: 700, cursor: "pointer", fontFamily: FONT,
      }}>
        <Plus size={compact ? 28 : 32} strokeWidth={2.5} /> Nuovo piatto
      </button>
      {activeCat.items.map((item) => (
        <DishAdminTile key={item.id} t={t} item={item} selected={item.id === selectedItemId}
          onSelect={() => setSelection({ type: "dish", itemId: item.id })} />
      ))}
    </div>
  );
  const emptyNote = activeCat && activeCat.items.length === 0 && (
    <div style={{ color: t.inkSoft, fontSize: 16, marginTop: 14, display: "flex", alignItems: "center", gap: 8 }}>
      <Utensils size={18} /> Nessun piatto in questa categoria.
    </div>
  );
  const categoryTabs = (
    <div style={{ padding: compact ? "10px 16px" : "12px 20px 4px", flexShrink: 0 }}>
      <CategoryGrid t={t} label="Categorie del menù" minWidth={compact ? 110 : 150} activeId={activeCat?.id}
        onSelect={(id) => { setCategoryId(id); setSelection(null); }}
        categories={categories.map((c) => ({
          id: c.id, name: c.name || "Senza nome",
          icon: c.visible === false ? <EyeOff size={16} aria-label="nascosta" /> : null,
          detail: `${c.items.length} ${c.items.length === 1 ? "piatto" : "piatti"}${c.visible === false ? " · nascosta" : ""}`,
        }))} />
    </div>
  );

  if (compact) {
    const items = activeCat?.items || [];
    return (
      <div style={{ fontFamily: FONT, color: t.ink }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: "12px 16px 4px" }}>
          <TillButton t={t} size={TOUCH} icon={FolderPlus} onClick={() => setSelection({ type: "newCategory" })} style={{ padding: "0 10px", fontSize: 16 }}>Nuova categoria</TillButton>
          <TillButton t={t} size={TOUCH} icon={Settings2} onClick={() => setSelection({ type: "settings", page: null })} style={{ padding: "0 10px", fontSize: 16 }}>Impostazioni</TillButton>
        </div>
        <div style={{ borderBottom: `1px solid ${t.line}` }}>
          {categoryTabs}
        </div>
        {activeCat && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px 0" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 19, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{activeCat.name || "Senza nome"}</div>
              <div style={{ fontSize: 13, color: t.inkSoft }}>
                {items.length} {items.length === 1 ? "piatto" : "piatti"} · {items.filter(itemGoesToKitchen).length} in comanda{activeCat.visible === false ? " · nascosta ai clienti" : ""}
              </div>
            </div>
            <TillButton t={t} size={TOUCH} icon={Settings2} onClick={() => setSelection({ type: "category" })} style={{ fontSize: 15, padding: "0 12px" }}>
              Categoria
            </TillButton>
          </div>
        )}
        {!activeCat && (
          <div style={{ color: t.inkSoft, fontSize: 16, padding: "24px 16px" }}>Il menù non ha ancora categorie: creane una con "Nuova categoria".</div>
        )}
        <div style={{ padding: "12px 16px 24px" }}>
          {tiles}
          {emptyNote}
        </div>
        {panel}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: `minmax(0, 1fr) ${SIDE_PANEL_WIDTH}`, fontFamily: FONT, color: t.ink }}>
      <section aria-label="Piatti del menù" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 20px", borderBottom: `1px solid ${t.line}`, flexWrap: "wrap" }}>
          <div style={{ fontSize: 24, fontWeight: 700, marginRight: "auto" }}>Menù</div>
          <TillButton t={t} size={TOUCH} icon={FolderPlus} onClick={() => setSelection({ type: "newCategory" })}>Nuova categoria</TillButton>
          <TillButton t={t} size={TOUCH} icon={Settings2} aria-pressed={selection?.type === "settings"} onClick={() => setSelection({ type: "settings", page: null })}>Impostazioni</TillButton>
        </div>

        {categoryTabs}

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 20px 96px" }}>
          {tiles}
          {emptyNote}
        </div>
      </section>
      {panel}
    </div>
  );
}
