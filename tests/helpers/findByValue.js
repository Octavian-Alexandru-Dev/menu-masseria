// Admin.jsx ripete campi identici (Nome/Prezzo/Etichetta per ogni voce,
// Nome/Sottotitolo per ogni categoria...) senza id/aria-label che li
// distinguano — e non possono averne uno statico, essendo per riga. Invece
// di indovinare la posizione nel DOM (fragile: basta un campo aggiunto
// altrove per sfalsare tutto), questo helper trova l'elemento corretto
// leggendo il valore corrente di ciascun candidato (inputValue riflette la
// proprietà DOM live, non l'attributo statico — corretto per input
// controllati React).
export async function locatorByValue(page, selector, expectedValue) {
  const all = page.locator(selector);
  const count = await all.count();
  for (let i = 0; i < count; i++) {
    const candidate = all.nth(i);
    const val = await candidate.inputValue().catch(() => null);
    if (val === expectedValue) return candidate;
  }
  throw new Error(`Nessun elemento "${selector}" con valore "${expectedValue}" (${count} candidati controllati).`);
}
