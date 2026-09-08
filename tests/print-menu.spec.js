import { test, expect } from "@playwright/test";

// Anteprima di stampa (?print=1): il menù arriva via sessionStorage,
// scritto da Admin.jsx subito prima di aprire la scheda (vedi
// src/PrintMenu.jsx). Qui si semina sessionStorage direttamente prima della
// navigazione (page.addInitScript) invece di passare per il flusso
// window.open da Admin — stesso contratto osservabile, senza dover gestire
// l'apertura di una scheda per ogni test.
const PAYLOAD = {
  restaurantName: "Ristorante Stampa Demo",
  tagline: "Tagline di stampa",
  location: "Località Stampa",
  footerNote: "Nota a piè di pagina di stampa",
  theme: "rustica",
  lang: "it",
  socialLinks: { instagram: { visible: true, url: "https://instagram.com/ristorante_demo" } },
  includeImages: false,
  avoidCategorySplit: false,
  columns: 1,
  paperSize: "A4",
  generatedDate: "08/09/2026",
  categories: [
    {
      id: "cat-1",
      name: "Antipasti Stampa",
      subtitle: "Sottotitolo stampa",
      items: [
        { id: "item-1", name: "Bruschetta Stampa", price: "6,00", tag: "ROSSO", description: "Descrizione stampa 1" },
        { id: "item-2", name: "Piatto su richiesta", price: "SU RICHIESTA", tag: "", description: "" },
      ],
    },
  ],
};

test.describe("Anteprima di stampa (?print=1)", () => {
  test("senza un menù in sessionStorage mostra lo stato vuoto", async ({ page }) => {
    await page.goto("/?print=1");
    await expect(page.getByText(/nessun menù da stampare/i)).toBeVisible();
  });

  test("con un payload in sessionStorage mostra il menù stampabile con tutti i dettagli", async ({ page }) => {
    await page.addInitScript((payload) => {
      sessionStorage.setItem("mdp-print-payload", JSON.stringify(payload));
    }, PAYLOAD);
    await page.goto("/?print=1");

    await expect(page.getByText("Ristorante Stampa Demo")).toBeVisible();
    await expect(page.getByText("Tagline di stampa")).toBeVisible();
    await expect(page.getByText("Località Stampa")).toBeVisible();
    await expect(page.getByText("Antipasti Stampa")).toBeVisible();
    await expect(page.getByText("Sottotitolo stampa")).toBeVisible();

    await expect(page.getByText("Bruschetta Stampa")).toBeVisible();
    await expect(page.getByText("ROSSO")).toBeVisible();
    await expect(page.getByText("Descrizione stampa 1")).toBeVisible();
    await expect(page.getByText("€ 6,00")).toBeVisible();

    // Prezzo "SU RICHIESTA" mostrato tradotto (ui.onRequest), non il testo
    // italiano letterale del campo.
    await expect(page.getByText("Piatto su richiesta")).toBeVisible();
    await expect(page.getByText("Su richiesta", { exact: true })).toBeVisible();

    await expect(page.getByText("Nota a piè di pagina di stampa")).toBeVisible();
    await expect(page.getByText(/instagram/i)).toBeVisible();
    await expect(page.getByText(/@ristorante_demo/i)).toBeVisible();
    await expect(page.getByText(/aggiornato al 08\/09\/2026/i)).toBeVisible();

    await expect(page).toHaveTitle("Ristorante Stampa Demo — menù");
    await expect(page.getByRole("button", { name: /^stampa$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^chiudi$/i })).toBeVisible();
  });

  // Non testato: che "Chiudi" chiuda davvero la scheda (window.close()).
  // Verificato che il popup si apre correttamente (test sopra, via il
  // flusso reale window.open in Admin.jsx — vedi admin.spec.js "opzioni
  // PDF"), ma window.close() su una finestra aperta da script è
  // notoriamente inaffidabile da automatizzare in Chromium headless anche
  // quando la relazione opener/popup è corretta (limite dell'ambiente di
  // test, non della funzionalità: è un singolo onClick={() =>
  // window.close()}, rischio di bug trascurabile).
});
