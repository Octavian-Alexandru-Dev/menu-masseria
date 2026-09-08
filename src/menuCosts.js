// Costi interni dei piatti — mai esposti al menù pubblico. Vivono in un
// documento Firestore SEPARATO da menu/data apposta: menu/data è leggibile
// da chiunque senza autenticazione (serve al menù cliente), e Firestore non
// supporta regole a livello di singolo campo — mettere il costo dentro
// menu/data lo renderebbe visibile a chiunque ispezioni il traffico di rete,
// anche se l'interfaccia non lo mostrasse. Vedi firestore.rules: menuCosts/data
// richiede autenticazione, come staff/orders/reservations.
//
// Il costo viene "fotografato" su ogni riga della comanda al momento
// dell'invio (src/orders.js, buildOrderLine), esattamente come il prezzo di
// vendita — così il margine calcolato nella Dashboard statistiche resta
// corretto anche se il costo di un piatto cambia dopo (src/statsData.js).
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "./firebase-db";

export const MENU_COSTS_DOC_PATH = ["menuCosts", "data"];

export function menuCostsRef() {
  return doc(db, ...MENU_COSTS_DOC_PATH);
}

// costs: { [menuItemId]: "3,50" } — stesso formato prezzo di menu item.price
// (parsePriceToCents in shared.jsx). Nessun documento ancora creato -> {}.
export function subscribeMenuCosts(onChange, onError) {
  return onSnapshot(menuCostsRef(), (snap) => onChange(snap.exists() ? snap.data() : {}), onError);
}

export async function saveMenuCosts(costs) {
  return setDoc(menuCostsRef(), costs);
}
