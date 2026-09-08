// Credenziali degli account di test (admin/cameriere/cucina), seminati
// nell'emulatore Firebase da scripts/seed-emulator.js prima di ogni run
// (tests/global-setup.js). Fisse e note perché l'emulatore è locale ed
// effimero: non sono segreti da proteggere come lo sarebbero su un progetto
// reale.
export const TEST_ADMIN = { email: "admin@test.local", password: "Test1234!" };
export const TEST_WAITER = { email: "waiter@test.local", password: "Test1234!" };
export const TEST_KITCHEN = { email: "kitchen@test.local", password: "Test1234!" };
// Autenticato ma senza staff/{uid} — stato "no-role" (staff-shared.jsx).
export const TEST_NO_ROLE = { email: "norole@test.local", password: "Test1234!" };
// staff/{uid}.role valorizzato ma non riconosciuto da nessuna area — stato
// "Accesso non consentito" (StaffHome.jsx).
export const TEST_INVALID_ROLE = { email: "invalidrole@test.local", password: "Test1234!" };
