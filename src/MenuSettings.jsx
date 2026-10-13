// Settings of the menu editor (TillMenu.jsx > "Impostazioni"), the same on
// the till (side panel) and on phones (full-screen pages): everything about
// the menu that isn't a dish or a category.
//
//  - Locale e grafica: name, place, opening line, footer note, theme;
//  - Coperto e ricerca: cover charge per person, dish search on/off;
//  - Link e social: review buttons and social/shop links in the footer;
//  - Traduzioni: automatic translation of the missing texts, every text
//    correctable by hand, a language removed;
//  - Personale: who can sign in to the staff area, and with which role;
//  - Stampa del menù: printable version (PDF from the browser's print);
//  - Backup: download the whole menu as JSON, restore it.
//
// As everywhere in the editor: form edits apply only on "Salva" and write
// only what changed since the page opened (menuEdit.js, one transaction on
// the menu as it is on the server — MenuApp.jsx > handlePatch).
import React, { useState, useEffect } from "react";
import {
  Store, Coins, Link2, Languages, Users, Printer, DatabaseBackup, Eye, ChevronRight, Check, Keyboard,
  Download, Upload, Trash2, Sparkles, Plus, UserRound,
} from "lucide-react";
import { THEMES, LANGUAGES, BackButton, Logo, GlobalStyle, formatCentsAsPrice, parsePriceToCents, countMissingTranslations, generateMissingTranslations } from "./shared";
import { menuEdits, combineEdits } from "./menuEdit";
import { parseMenuJsonFile, downloadMenuJson } from "./menuBackup";
import { DEFAULT_PRINT_OPTIONS, buildPrintPayload, openPrintPreview } from "./menuPrint";
import { STAFF_ROLES, staffRoleLabel, subscribeStaff, saveStaffMember, removeStaffMember } from "./staffData";
import { auth } from "./firebase-auth";
import { confirmAction } from "./confirmDialog";
import {
  TOUCH, FONT, STATUS, TillButton, SidePanel, SectionTitle, Field, SwitchRow, Segmented, PriceKeypad, Notice, tillInputStyle,
} from "./TillUi";

// Saving state shared by the panels: busy flag + one-line outcome.
export function useSaver(onPatch) {
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

// Only the entries of `current` that differ from `opened`.
function changedFields(current, opened) {
  return Object.fromEntries(Object.entries(current).filter(([key, value]) => value !== opened[key]));
}

function PanelHeader({ t, title, subtitle, onBack, backLabel = "Impostazioni" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <BackButton t={t} onClick={onBack} label={backLabel} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 21, fontWeight: 700, lineHeight: 1.2 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 14, color: t.inkSoft }}>{subtitle}</div>}
      </div>
    </div>
  );
}

function SaveFooter({ t, saver, onSave, disabled, label = "Salva" }) {
  return (
    <>
      <Notice notice={saver.notice} />
      <TillButton t={t} variant="primary" size={60} icon={Check} disabled={saver.busy || disabled} onClick={onSave}>
        {saver.busy ? "Salvataggio…" : label}
      </TillButton>
    </>
  );
}

/* ----------------------------------- hub ----------------------------------- */

const PAGES = [
  { key: "identity", label: "Locale e grafica", description: "Nome, località, frasi del menù, colori", icon: Store },
  { key: "coperto", label: "Coperto e ricerca", description: "Coperto a persona, ricerca dei piatti", icon: Coins },
  { key: "links", label: "Link e social", description: "Recensioni, Instagram, Facebook, shop", icon: Link2 },
  { key: "translations", label: "Traduzioni", description: "Inglese, spagnolo, tedesco, francese", icon: Languages },
  { key: "staff", label: "Personale", description: "Chi accede all'area riservata e con quale ruolo", icon: Users },
  { key: "print", label: "Stampa del menù", description: "Versione da stampare o salvare in PDF", icon: Printer },
  { key: "backup", label: "Backup", description: "Scarica o ripristina tutto il menù", icon: DatabaseBackup },
];

function HubRow({ t, icon: Icon, label, description, badge, onClick }) {
  return (
    <button type="button" onClick={onClick} className="mdp-btn" style={{
      display: "flex", alignItems: "center", gap: 14, width: "100%", minHeight: 68, padding: "10px 14px",
      borderRadius: 14, border: `1.5px solid ${t.line}`, background: t.card, color: t.ink, textAlign: "left", cursor: "pointer", fontFamily: FONT,
    }}>
      <span style={{ width: 40, height: 40, borderRadius: 12, background: `${t.primary}14`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon size={21} color={t.primary} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 17, fontWeight: 600 }}>{label}</span>
        {description && <span style={{ display: "block", fontSize: 14, color: t.inkSoft, marginTop: 2 }}>{description}</span>}
      </span>
      {badge && <span style={{ fontSize: 13, fontWeight: 700, color: STATUS.waiting, whiteSpace: "nowrap" }}>{badge}</span>}
      <ChevronRight size={20} color={t.inkSoft} />
    </button>
  );
}

function SettingsHub({ t, menu, sheet, onOpen, onClose, onPreview }) {
  const missing = LANGUAGES.filter((l) => l.code !== "it").reduce((s, l) => s + countMissingTranslations(menu, menu.translations?.[l.code]), 0);
  return (
    <SidePanel t={t} sheet={sheet} label="Impostazioni del menù"
      header={<PanelHeader t={t} title="Impostazioni del menù" onBack={onClose} backLabel={sheet ? "Piatti" : "Categoria"} />}>
      <div style={{ display: "grid", gap: 10, paddingTop: 6 }}>
        {PAGES.map((p) => (
          <HubRow key={p.key} t={t} icon={p.icon} label={p.label} description={p.description}
            badge={p.key === "translations" && missing > 0 ? `${missing} da tradurre` : null}
            onClick={() => onOpen(p.key)} />
        ))}
        {onPreview && (
          <HubRow t={t} icon={Eye} label="Vedi il menù dei clienti" description="Apre il menù pubblico com'è adesso" onClick={onPreview} />
        )}
      </div>
    </SidePanel>
  );
}

/* --------------------------------- identity --------------------------------- */

function IdentityPanel({ t, menu, onPatch, onBack, sheet }) {
  const [opened, setOpened] = useState(() => ({
    restaurantName: menu.restaurantName || "", location: menu.location || "", tagline: menu.tagline || "",
    footerNote: menu.footerNote || "", theme: menu.theme || "minimal",
  }));
  const [values, setValues] = useState(opened);
  const saver = useSaver(onPatch);
  const input = tillInputStyle(t);
  const set = (key) => (e) => setValues((v) => ({ ...v, [key]: e.target.value }));
  const changed = changedFields(values, opened);

  const save = async () => {
    if (Object.keys(changed).length === 0) { saver.setNotice({ tone: "info", text: "Nessuna modifica da salvare." }); return; }
    if (await saver.run(menuEdits.updateFields(changed), "Salvato.")) setOpened(values);
  };

  return (
    <SidePanel t={t} sheet={sheet} label="Locale e grafica"
      header={<PanelHeader t={t} title="Locale e grafica" onBack={onBack} />}
      footer={<SaveFooter t={t} saver={saver} onSave={save} />}>
      <div style={{ display: "grid", gap: 18, paddingTop: 6 }}>
        <Field t={t} label="Nome del ristorante"><input aria-label="Nome del ristorante" style={input} value={values.restaurantName} onChange={set("restaurantName")} /></Field>
        <Field t={t} label="Località"><input aria-label="Località" style={input} value={values.location} onChange={set("location")} /></Field>
        <Field t={t} label="Frase di apertura" hint="Sotto il nome, in cima al menù."><input aria-label="Frase di apertura" style={input} value={values.tagline} onChange={set("tagline")} /></Field>
        <Field t={t} label="Nota a piè di pagina"><input aria-label="Nota a piè di pagina" style={input} value={values.footerNote} onChange={set("footerNote")} /></Field>
        <div>
          <SectionTitle t={t} style={{ marginBottom: 8 }}>Grafica del menù</SectionTitle>
          <div role="group" aria-label="Grafica del menù" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
            {Object.entries(THEMES).map(([key, th]) => {
              const active = values.theme === key;
              return (
                <button key={key} type="button" aria-pressed={active} onClick={() => setValues((v) => ({ ...v, theme: key }))} className="mdp-btn" style={{
                  minHeight: 64, padding: "8px 12px", borderRadius: 12, cursor: "pointer", fontFamily: FONT, textAlign: "left",
                  border: `${active ? 3 : 1.5}px solid ${active ? t.ink : t.line}`, background: th.bg, color: th.ink,
                  display: "flex", alignItems: "center", gap: 10,
                }}>
                  <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 11, background: th.primary, flexShrink: 0, border: "2px solid rgba(255,255,255,0.6)" }} />
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{th.name}{active && <span style={{ display: "block", fontSize: 12, fontWeight: 700 }}>scelta</span>}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </SidePanel>
  );
}

/* ---------------------------- coperto e ricerca ---------------------------- */

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

function CopertoPanel({ t, menu, onPatch, onBack, sheet }) {
  const [opened, setOpened] = useState(() => ({
    adults: menu.coperto?.adults || "0,00", children: menu.coperto?.children || "0,00", searchEnabled: menu.searchEnabled !== false,
  }));
  const [adults, setAdults] = useState(opened.adults);
  const [children, setChildren] = useState(opened.children);
  const [searchEnabled, setSearchEnabled] = useState(opened.searchEnabled);
  const saver = useSaver(onPatch);

  // Only what changed since the panel opened, applied to the server's menu.
  const save = async () => {
    const coperto = {
      ...(adults !== opened.adults ? { adults } : null),
      ...(children !== opened.children ? { children } : null),
    };
    const edit = (current) => ({
      ...current,
      ...(Object.keys(coperto).length > 0 ? { coperto: { ...(current.coperto || {}), ...coperto } } : null),
      ...(searchEnabled !== opened.searchEnabled ? { searchEnabled } : null),
    });
    if (await saver.run(edit, "Salvato.")) setOpened({ adults, children, searchEnabled });
  };

  return (
    <SidePanel t={t} sheet={sheet} label="Coperto e ricerca"
      header={<PanelHeader t={t} title="Coperto e ricerca" onBack={onBack} />}
      footer={<SaveFooter t={t} saver={saver} onSave={save} />}>
      <div style={{ display: "grid", gap: 18, paddingTop: 6 }}>
        <div style={{ display: "grid", gap: 12 }}>
          <SectionTitle t={t}>Coperto a persona</SectionTitle>
          <PriceSetting t={t} label="Coperto adulti" value={adults} onChange={setAdults} />
          <PriceSetting t={t} label="Coperto bambini" value={children} onChange={setChildren} />
          <div style={{ fontSize: 14, color: t.inkSoft, lineHeight: 1.4 }}>Vale per i tavoli aperti da ora in poi: quelli già aperti mantengono il coperto di quando sono stati aperti.</div>
        </div>
        <SwitchRow t={t} label="Ricerca dei piatti" checked={searchEnabled} onChange={setSearchEnabled}
          description="La barra di ricerca nel menù dei clienti e nella presa della comanda." />
      </div>
    </SidePanel>
  );
}

/* ------------------------------- link e social ------------------------------- */

const LINKS = [
  { group: "reviewLinks", key: "google", label: "Recensione Google", placeholder: "https://g.page/r/…/review" },
  { group: "reviewLinks", key: "tripadvisor", label: "Recensione TripAdvisor", placeholder: "https://www.tripadvisor.it/UserReview…" },
  { group: "socialLinks", key: "instagram", label: "Instagram", placeholder: "https://www.instagram.com/…" },
  { group: "socialLinks", key: "facebook", label: "Facebook", placeholder: "https://www.facebook.com/…" },
  { group: "socialLinks", key: "shop", label: "Shop online", placeholder: "https://…" },
];
const linkId = (l) => `${l.group}.${l.key}`;

function LinksPanel({ t, menu, onPatch, onBack, sheet }) {
  const read = () => Object.fromEntries(LINKS.map((l) => {
    const v = menu[l.group]?.[l.key] || {};
    return [linkId(l), { url: v.url || "", visible: v.visible === true }];
  }));
  const [opened, setOpened] = useState(read);
  const [values, setValues] = useState(opened);
  const saver = useSaver(onPatch);
  const input = tillInputStyle(t);
  const set = (id, fields) => setValues((v) => ({ ...v, [id]: { ...v[id], ...fields } }));

  const save = async () => {
    const edits = LINKS.map((l) => {
      const id = linkId(l);
      const changed = changedFields(values[id], opened[id]);
      return Object.keys(changed).length > 0 ? menuEdits.updateLink(l.group, l.key, changed) : null;
    }).filter(Boolean);
    if (edits.length === 0) { saver.setNotice({ tone: "info", text: "Nessuna modifica da salvare." }); return; }
    if (await saver.run(combineEdits(...edits), "Salvato.")) setOpened(values);
  };

  return (
    <SidePanel t={t} sheet={sheet} label="Link e social"
      header={<PanelHeader t={t} title="Link e social" subtitle="Pulsanti in fondo al menù dei clienti" onBack={onBack} />}
      footer={<SaveFooter t={t} saver={saver} onSave={save} />}>
      <div style={{ display: "grid", gap: 22, paddingTop: 6 }}>
        <div style={{ fontSize: 14, color: t.inkSoft, lineHeight: 1.4 }}>Un pulsante compare ai clienti solo se è acceso e ha un link.</div>
        {LINKS.map((l) => {
          const id = linkId(l);
          return (
            <div key={id} role="group" aria-label={l.label} style={{ display: "grid", gap: 8 }}>
              <Field t={t} label={l.label}>
                <input aria-label={`Link ${l.label}`} type="url" inputMode="url" style={input} placeholder={l.placeholder}
                  value={values[id].url} onChange={(e) => set(id, { url: e.target.value })} />
              </Field>
              <SwitchRow t={t} label={`Mostra ${l.label}`} checked={values[id].visible} onChange={(v) => set(id, { visible: v })}
                description={values[id].visible && !values[id].url.trim() ? "Manca il link: il pulsante non comparirà." : null} />
            </div>
          );
        })}
      </div>
    </SidePanel>
  );
}

/* -------------------------------- traduzioni -------------------------------- */

// Every text of the menu that has a translation, as [path, Italian text]:
// path is "tagline", "categories.<cat>.name", "categories.<cat>.items.<item>.description"…
function translatableTexts(menu) {
  const rows = [];
  const add = (group, path, label, source, multiline = false) => {
    if ((source || "").trim()) rows.push({ group, path, label, source, multiline });
  };
  add("Locale", "restaurantName", "Nome del ristorante", menu.restaurantName);
  add("Locale", "tagline", "Frase di apertura", menu.tagline);
  add("Locale", "footerNote", "Nota a piè di pagina", menu.footerNote);
  menu.categories.forEach((c) => {
    const g = c.name || "Senza nome";
    add(g, `categories.${c.id}.name`, "Nome della categoria", c.name);
    add(g, `categories.${c.id}.subtitle`, "Sottotitolo", c.subtitle);
    c.items.forEach((it) => {
      const base = `categories.${c.id}.items.${it.id}`;
      add(g, `${base}.name`, `${it.name} — nome`, it.name);
      add(g, `${base}.description`, `${it.name} — descrizione`, it.description, true);
      add(g, `${base}.tag`, `${it.name} — etichetta`, it.tag);
      add(g, `${base}.searchTags`, `${it.name} — tag di ricerca`, it.searchTags);
    });
  });
  return rows;
}
const getPath = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  keys.slice(0, -1).forEach((k) => { o[k] = o[k] || {}; o = o[k]; });
  o[keys[keys.length - 1]] = value;
}

function TranslationTexts({ t, menu, lang, onPatch }) {
  const rows = translatableTexts(menu);
  const read = () => Object.fromEntries(rows.map((r) => [r.path, getPath(menu.translations?.[lang], r.path) ?? ""]));
  const [opened, setOpened] = useState(read);
  const [values, setValues] = useState(opened);
  const saver = useSaver(onPatch);
  const input = tillInputStyle(t);
  const changed = changedFields(values, opened);
  const count = Object.keys(changed).length;

  const save = async () => {
    const texts = {};
    Object.entries(changed).forEach(([path, value]) => setPath(texts, path, value));
    if (await saver.run(menuEdits.updateTranslationTexts(lang, texts), "Traduzioni salvate.")) setOpened(values);
  };

  let lastGroup = null;
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {rows.map((r) => {
        const header = r.group !== lastGroup ? <SectionTitle t={t} color={t.secondary} style={{ marginTop: 8 }}>{r.group}</SectionTitle> : null;
        lastGroup = r.group;
        return (
          <React.Fragment key={r.path}>
            {header}
            <Field t={t} label={r.label} hint={`Italiano: ${r.source}`}>
              {r.multiline
                ? <textarea aria-label={`${r.label} (${lang.toUpperCase()})`} rows={2} value={values[r.path]} onChange={(e) => setValues((v) => ({ ...v, [r.path]: e.target.value }))}
                    style={{ ...input, minHeight: 80, padding: "12px 14px", resize: "vertical", lineHeight: 1.4 }} />
                : <input aria-label={`${r.label} (${lang.toUpperCase()})`} style={input} value={values[r.path]} onChange={(e) => setValues((v) => ({ ...v, [r.path]: e.target.value }))} />}
            </Field>
          </React.Fragment>
        );
      })}
      <div style={{ position: "sticky", bottom: 0, background: t.card, padding: "10px 0", display: "grid", gap: 8 }}>
        <Notice notice={saver.notice} />
        <TillButton t={t} variant="primary" size={56} icon={Check} disabled={saver.busy || count === 0} onClick={save}>
          {saver.busy ? "Salvataggio…" : count > 0 ? `Salva ${count} ${count === 1 ? "testo" : "testi"}` : "Salva i testi"}
        </TillButton>
      </div>
    </div>
  );
}

function TranslationsPanel({ t, menu, onPatch, onBack, sheet }) {
  const langs = LANGUAGES.filter((l) => l.code !== "it");
  const [lang, setLang] = useState(langs[0].code);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  // Bumped after an automatic translation or a removal: the texts below
  // reload from the saved translation.
  const [version, setVersion] = useState(0);
  const translation = menu.translations?.[lang];
  const missing = countMissingTranslations(menu, translation);
  const label = (code) => langs.find((l) => l.code === code)?.label || code.toUpperCase();

  const generate = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const updated = await generateMissingTranslations(menu, lang, translation);
      await onPatch(menuEdits.setTranslation(lang, updated));
      setVersion((v) => v + 1);
      setNotice({ tone: "ok", text: `Traduzione ${label(lang)} aggiornata.` });
    } catch (err) {
      setNotice({ tone: "error", text: err?.message || "Traduzione non riuscita: riprova." });
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    const confirmed = await confirmAction({
      title: `Eliminare la traduzione ${label(lang)}?`,
      message: "I clienti che scelgono questa lingua vedranno il menù in italiano finché non la generi di nuovo.",
      confirmLabel: "Elimina traduzione",
      danger: true,
    });
    if (!confirmed) return;
    setBusy(true);
    setNotice(null);
    try {
      await onPatch(menuEdits.removeTranslation(lang));
      setVersion((v) => v + 1);
      setNotice({ tone: "ok", text: `Traduzione ${label(lang)} eliminata.` });
    } catch (err) {
      setNotice({ tone: "error", text: err?.message || "Eliminazione non riuscita: riprova." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel t={t} sheet={sheet} label="Traduzioni"
      header={<PanelHeader t={t} title="Traduzioni" subtitle="Il menù dei clienti nelle altre lingue" onBack={onBack} />}>
      <div style={{ display: "grid", gap: 16, paddingTop: 6 }}>
        <Segmented t={t} label="Lingua" value={lang} onChange={(v) => { setLang(v); setNotice(null); }}
          options={langs.map((l) => {
            const m = countMissingTranslations(menu, menu.translations?.[l.code]);
            return { value: l.code, label: m > 0 ? `${l.label} · ${m}` : l.label };
          })} />
        <div style={{ padding: 14, borderRadius: 14, border: `1.5px solid ${t.line}`, background: t.bg, display: "grid", gap: 10 }}>
          <div style={{ fontSize: 17, fontWeight: 600 }}>
            {!translation ? `Nessuna traduzione ${label(lang)}` : missing > 0 ? `${missing} ${missing === 1 ? "testo" : "testi"} da tradurre` : "Traduzione completa"}
          </div>
          <div style={{ fontSize: 14, color: t.inkSoft, lineHeight: 1.4 }}>
            La traduzione automatica riempie solo i testi mancanti (es. un piatto nuovo): quelli già corretti a mano restano come sono. Si salva subito.
          </div>
          {(missing > 0 || !translation) && (
            <TillButton t={t} variant="primary" icon={Sparkles} disabled={busy} onClick={generate}>
              {busy ? "Traduzione…" : `Traduci in automatico (${label(lang)})`}
            </TillButton>
          )}
          {translation && <TillButton t={t} variant="danger" icon={Trash2} disabled={busy} onClick={remove}>Elimina traduzione {label(lang)}</TillButton>}
          <Notice notice={notice} />
        </div>
        {translation && (
          <>
            <SectionTitle t={t}>Correggi i testi a mano</SectionTitle>
            <TranslationTexts key={`${lang}-${version}`} t={t} menu={menu} lang={lang} onPatch={onPatch} />
          </>
        )}
      </div>
    </SidePanel>
  );
}

/* --------------------------------- personale --------------------------------- */

function StaffPanel({ t, onBack, sheet }) {
  const [staff, setStaff] = useState(null);
  const [uidValue, setUidValue] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("waiter");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const input = tillInputStyle(t);

  useEffect(() => subscribeStaff(setStaff, (err) => {
    console.error("[menu] Lettura personale fallita:", err);
    setNotice({ tone: "error", text: "Impossibile leggere l'elenco del personale." });
  }), []);

  const add = async () => {
    if (!uidValue.trim() || !name.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      await saveStaffMember(uidValue, { name, role });
      setNotice({ tone: "ok", text: `${name.trim()} aggiunto come ${staffRoleLabel(role).toLowerCase()}.` });
      setUidValue("");
      setName("");
      setRole("waiter");
    } catch (err) {
      console.error("[menu] Salvataggio personale fallito:", err);
      setNotice({ tone: "error", text: "Salvataggio non riuscito. Verifica la connessione e riprova." });
    } finally {
      setBusy(false);
    }
  };
  const remove = async (member) => {
    const confirmed = await confirmAction({
      title: `Togliere l'accesso a ${member.name || member.uid}?`,
      message: "Non potrà più entrare nell'area riservata. L'account resta in Firebase: si può riaggiungere.",
      confirmLabel: "Togli accesso",
      danger: true,
    });
    if (!confirmed) return;
    try {
      await removeStaffMember(member.uid);
    } catch (err) {
      console.error("[menu] Eliminazione personale fallita:", err);
      setNotice({ tone: "error", text: "Eliminazione non riuscita. Riprova." });
    }
  };
  const useMine = () => {
    const me = auth.currentUser;
    if (!me) return;
    setUidValue(me.uid);
    setName((n) => n || me.email?.split("@")[0] || "Amministratore");
    setRole("admin");
  };

  return (
    <SidePanel t={t} sheet={sheet} label="Personale"
      header={<PanelHeader t={t} title="Personale" subtitle="Accesso all'area riservata" onBack={onBack} />}
      footer={(
        <>
          <Notice notice={notice} />
          <TillButton t={t} variant="primary" size={60} icon={Plus} disabled={busy || !uidValue.trim() || !name.trim()} onClick={add}>
            {busy ? "Salvataggio…" : "Aggiungi persona"}
          </TillButton>
        </>
      )}>
      <div style={{ display: "grid", gap: 16, paddingTop: 6 }}>
        <div role="list" aria-label="Persone con accesso" style={{ display: "grid", gap: 8 }}>
          {staff === null && <div style={{ color: t.inkSoft, fontSize: 16 }}>Caricamento…</div>}
          {staff?.length === 0 && <div style={{ color: t.inkSoft, fontSize: 16 }}>Nessuna persona configurata.</div>}
          {staff?.map((m) => (
            <div role="listitem" key={m.uid} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 14, border: `1.5px solid ${t.line}`, background: t.bg }}>
              <UserRound size={22} color={t.inkSoft} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 17, fontWeight: 600 }}>{m.name || "Senza nome"} <span style={{ fontWeight: 500, color: t.inkSoft, fontSize: 15 }}>· {staffRoleLabel(m.role)}</span></span>
                <span style={{ display: "block", fontSize: 12, color: t.inkSoft, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis" }}>{m.uid}</span>
              </span>
              <TillButton t={t} size={TOUCH} variant="danger" icon={Trash2} onClick={() => remove(m)} aria-label={`Togli accesso a ${m.name || m.uid}`} style={{ padding: "0 12px" }}>Togli</TillButton>
            </div>
          ))}
        </div>

        <SectionTitle t={t} style={{ marginTop: 6 }}>Aggiungi una persona</SectionTitle>
        <div style={{ fontSize: 14, color: t.inkSoft, lineHeight: 1.45 }}>
          Crea prima il suo account in Firebase Console (Authentication → Aggiungi utente), poi incolla qui il suo UID.
          Cameriere: Tavoli e Prenotazioni. Amministratore: tutto.
        </div>
        {auth.currentUser && <TillButton t={t} size={TOUCH} variant="ghost" icon={UserRound} onClick={useMine} style={{ justifySelf: "start", paddingLeft: 0 }}>Usa il mio account</TillButton>}
        <Field t={t} label="UID (da Firebase Console)"><input aria-label="UID" style={input} value={uidValue} onChange={(e) => setUidValue(e.target.value)} placeholder="es. aBc123…" autoCapitalize="off" autoCorrect="off" /></Field>
        <Field t={t} label="Nome"><input aria-label="Nome della persona" style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="es. Marco" /></Field>
        <div style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: t.inkSoft }}>Ruolo</span>
          <Segmented t={t} label="Ruolo" value={role} onChange={setRole} options={STAFF_ROLES} />
        </div>
      </div>
    </SidePanel>
  );
}

/* ------------------------------ stampa del menù ------------------------------ */

function PrintPanel({ t, menu, onBack, sheet }) {
  const [o, setO] = useState(DEFAULT_PRINT_OPTIONS);
  const [notice, setNotice] = useState(null);
  const set = (key) => (value) => setO((cur) => ({ ...cur, [key]: value }));
  const langs = LANGUAGES.filter((l) => l.code === "it" || menu.translations?.[l.code]);
  const visibleCats = menu.categories.filter((c) => c.visible !== false);
  const toggleCat = (id) => setO((cur) => ({
    ...cur,
    excludedCategoryIds: cur.excludedCategoryIds.includes(id) ? cur.excludedCategoryIds.filter((x) => x !== id) : [...cur.excludedCategoryIds, id],
  }));

  const open = () => {
    setNotice(null);
    const payload = buildPrintPayload(menu, o);
    if (!payload) { setNotice({ tone: "error", text: "Nessun piatto da stampare con queste scelte (controlla le categorie)." }); return; }
    try {
      openPrintPreview(payload);
      setNotice({ tone: "ok", text: "Anteprima aperta in una nuova scheda: usa «Salva come PDF» nella stampa per ottenere un file." });
    } catch (err) {
      setNotice({ tone: "error", text: err.message });
    }
  };

  return (
    <SidePanel t={t} sheet={sheet} label="Stampa del menù"
      header={<PanelHeader t={t} title="Stampa del menù" subtitle="Da stampare o salvare in PDF" onBack={onBack} />}
      footer={(
        <>
          <Notice notice={notice} />
          <TillButton t={t} variant="primary" size={60} icon={Printer} onClick={open}>Apri anteprima di stampa</TillButton>
        </>
      )}>
      <div style={{ display: "grid", gap: 16, paddingTop: 6 }}>
        <div style={{ display: "grid", gap: 6 }}>
          <SectionTitle t={t}>Lingua</SectionTitle>
          <Segmented t={t} label="Lingua del menù stampato" value={o.lang} onChange={set("lang")} options={langs.map((l) => ({ value: l.code, label: l.label }))} />
        </div>
        <SectionTitle t={t}>Contenuto</SectionTitle>
        <SwitchRow t={t} label="Prezzi" checked={o.prices} onChange={set("prices")} />
        <SwitchRow t={t} label="Foto dei piatti" checked={o.images} onChange={set("images")} />
        <SwitchRow t={t} label="Etichette (es. ROSSO)" checked={o.tags} onChange={set("tags")} />
        <SwitchRow t={t} label="Sottotitoli delle categorie" checked={o.subtitles} onChange={set("subtitles")} />
        <SwitchRow t={t} label="Nota e contatti in fondo" checked={o.footer} onChange={set("footer")} />
        <SwitchRow t={t} label="Data di stampa" checked={o.date} onChange={set("date")} />
        <SectionTitle t={t}>Impaginazione</SectionTitle>
        <SwitchRow t={t} label="Non spezzare una categoria tra due pagine" checked={o.avoidCategorySplit} onChange={set("avoidCategorySplit")}
          description="Acceso: una categoria che non ci sta passa tutta alla pagina dopo." />
        <div style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: t.inkSoft }}>Colonne</span>
          <Segmented t={t} label="Colonne" value={o.columns} onChange={set("columns")} options={[{ value: 1, label: "1 colonna" }, { value: 2, label: "2 colonne" }]} />
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: t.inkSoft }}>Formato</span>
          <Segmented t={t} label="Formato" value={o.paperSize} onChange={set("paperSize")} options={[{ value: "A4", label: "A4" }, { value: "Letter", label: "Letter" }]} />
        </div>
        <SectionTitle t={t}>Categorie da stampare</SectionTitle>
        <div role="group" aria-label="Categorie da stampare" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {visibleCats.map((c) => {
            const included = !o.excludedCategoryIds.includes(c.id);
            return (
              <button key={c.id} type="button" aria-pressed={included} onClick={() => toggleCat(c.id)} className="mdp-btn" style={{
                minHeight: TOUCH, padding: "0 14px", borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: FONT,
                border: `1.5px solid ${included ? t.primary : t.line}`, background: included ? t.primary : t.card, color: included ? t.bg : t.ink,
                display: "inline-flex", alignItems: "center", gap: 6,
              }}>{included && <Check size={16} />}{c.name || "Senza nome"}</button>
            );
          })}
        </div>
      </div>
    </SidePanel>
  );
}

/* ---------------------------------- backup ---------------------------------- */

function RestoreButton({ t, label, busy, onFile }) {
  return (
    <label className="mdp-btn" style={{
      minHeight: 56, borderRadius: 12, border: `1.5px solid ${t.line}`, background: t.card, color: t.ink,
      display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 17, fontWeight: 600,
      cursor: busy ? "default" : "pointer", opacity: busy ? 0.5 : 1, fontFamily: FONT,
    }}>
      <Upload size={20} /> {busy ? "Ripristino…" : label}
      <input type="file" accept="application/json" disabled={busy} style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; onFile(f); }} />
    </label>
  );
}

// Reads a backup file and, after a confirmation, replaces the menu with it.
function useRestore(onRestore, { confirmFirst = true } = {}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const restore = async (file) => {
    setNotice(null);
    let data;
    try {
      data = await parseMenuJsonFile(file);
    } catch (err) {
      setNotice({ tone: "error", text: err.message });
      return;
    }
    if (confirmFirst) {
      const confirmed = await confirmAction({
        title: "Sostituire tutto il menù con il backup?",
        message: `Il menù attuale viene sostituito da «${data.restaurantName || "backup"}» (${data.categories.length} categorie), subito e su tutti i dispositivi. Scarica prima un backup di quello attuale se ti può servire.`,
        confirmLabel: "Ripristina",
        danger: true,
      });
      if (!confirmed) return;
    }
    setBusy(true);
    try {
      await onRestore(data);
      setNotice({ tone: "ok", text: "Menù ripristinato dal backup." });
    } catch (err) {
      setNotice({ tone: "error", text: err?.message || "Ripristino non riuscito." });
    } finally {
      setBusy(false);
    }
  };
  return { busy, notice, restore };
}

function BackupPanel({ t, menu, onRestore, onBack, sheet }) {
  const r = useRestore(onRestore);
  return (
    <SidePanel t={t} sheet={sheet} label="Backup"
      header={<PanelHeader t={t} title="Backup" subtitle="Tutto il menù in un file" onBack={onBack} />}>
      <div style={{ display: "grid", gap: 16, paddingTop: 6 }}>
        <div style={{ fontSize: 15, color: t.inkSoft, lineHeight: 1.45 }}>
          Il file contiene piatti, categorie, traduzioni, link e impostazioni (non i costi interni né il personale).
        </div>
        <TillButton t={t} variant="primary" icon={Download} onClick={() => downloadMenuJson(menu)}>Scarica backup (JSON)</TillButton>
        <SectionTitle t={t} style={{ marginTop: 8 }}>Ripristina</SectionTitle>
        <div style={{ fontSize: 15, color: t.inkSoft, lineHeight: 1.45 }}>
          Sostituisce tutto il menù con quello del file, subito e su tutti i dispositivi. Chiede conferma prima.
        </div>
        <RestoreButton t={t} label="Ripristina da un backup" busy={r.busy} onFile={r.restore} />
        <Notice notice={r.notice} />
      </div>
    </SidePanel>
  );
}

// No menu on the server yet (first setup, or a restored database): the only
// way forward is creating it from a backup file.
export function MenuBootstrap({ t = THEMES.minimal, onRestore }) {
  const r = useRestore(onRestore, { confirmFirst: false });
  return (
    <div className="mdp-root" style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: t.bg, fontFamily: FONT, color: t.ink }}>
      <GlobalStyle t={t} />
      <div style={{ width: "100%", maxWidth: 420, padding: 24, borderRadius: 20, border: `1.5px solid ${t.line}`, background: t.card, display: "grid", gap: 14, textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center" }}><Logo width={110} /></div>
        <div style={{ fontSize: 24, fontWeight: 700 }}>Nessun menù trovato</div>
        <div style={{ fontSize: 16, color: t.inkSoft, lineHeight: 1.5 }}>
          Il menù non esiste ancora sul server. Crealo da un backup JSON (scaricato da Impostazioni → Backup).
        </div>
        <RestoreButton t={t} label="Crea il menù da un backup" busy={r.busy} onFile={r.restore} />
        <Notice notice={r.notice} />
      </div>
    </div>
  );
}

/* ---------------------------------- export ---------------------------------- */

// page: null (the list) or one of PAGES' keys. admin: { onPatch, onRestore, onExit? }.
export default function MenuSettings({ t, menu, admin, page, onPage, onClose, sheet }) {
  const back = () => onPage(null);
  const common = { t, menu, onPatch: admin.onPatch, onBack: back, sheet };
  switch (page) {
    case "identity": return <IdentityPanel {...common} />;
    case "coperto": return <CopertoPanel {...common} />;
    case "links": return <LinksPanel {...common} />;
    case "translations": return <TranslationsPanel {...common} />;
    case "staff": return <StaffPanel t={t} onBack={back} sheet={sheet} />;
    case "print": return <PrintPanel t={t} menu={menu} onBack={back} sheet={sheet} />;
    case "backup": return <BackupPanel t={t} menu={menu} onRestore={admin.onRestore} onBack={back} sheet={sheet} />;
    default: return <SettingsHub t={t} menu={menu} sheet={sheet} onOpen={onPage} onClose={onClose} onPreview={admin.onExit} />;
  }
}
