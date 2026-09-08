import { expect } from "@playwright/test";
import { TEST_ADMIN } from "../test-env.js";
import { staffLogin } from "./staffLogin.js";

// Un account "admin" qualifica per tutte e 3 le aree core (StaffHome.jsx),
// quindi vede sempre la Dashboard: da lì si raggiunge il pannello Admin.
export async function openAdmin(page) {
  await page.goto("/?area=staff");
  await staffLogin(page, TEST_ADMIN);
  await page.getByRole("button", { name: /^gestione menù/i }).click();
  await expect(page.getByText("Identità del locale")).toBeVisible({ timeout: 10_000 });
}

// Carica un menù fixture nell'editor via "Importa JSON": sostituisce solo lo
// stato locale (Admin.jsx > parseMenuJsonFile > setMenu), NON scrive su
// Firestore finché non si preme "Salva modifiche" — che i test che usano
// questo helper non premono mai, per non toccare il menù demo condiviso da
// cui dipendono altri file di test in esecuzione in parallelo.
export async function importFixtureMenu(page, fixture) {
  const buffer = Buffer.from(JSON.stringify(fixture), "utf-8");
  // Il file input è display:none (stilizzato tramite il <label> che lo
  // avvolge): un elemento nascosto non ha rappresentazione nell'albero di
  // accessibilità, quindi getByLabel non lo trova nonostante l'associazione
  // HTML sia valida — setInputFiles funziona comunque su input nascosti,
  // basta selezionarlo diversamente (unico input JSON nel pannello Admin).
  await page.locator('input[type="file"][accept="application/json"]').setInputFiles({ name: "fixture-menu.json", mimeType: "application/json", buffer });
  await expect(page.getByText(fixture.restaurantName)).toBeVisible({ timeout: 10_000 });
}
