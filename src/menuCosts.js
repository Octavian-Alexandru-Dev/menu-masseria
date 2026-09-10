// Internal dish costs — never exposed to the public menu. They live in a
// Firestore document SEPARATE from menu/data on purpose: menu/data is
// readable by anyone without authentication (needed for the customer menu),
// and Firestore has no field-level security rules — putting the cost inside
// menu/data would make it visible to anyone inspecting network traffic,
// even if the UI didn't show it. See firestore.rules: menuCosts/data
// requires authentication, like staff/orders/reservations.
//
// The cost is "snapshotted" onto every order line at send time
// (src/orders.js, buildOrderLine), exactly like the sale price — so the
// margin computed in the statistics Dashboard stays correct even if a
// dish's cost changes later (src/statsData.js).
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "./firebase-db";

export const MENU_COSTS_DOC_PATH = ["menuCosts", "data"];

export function menuCostsRef() {
  return doc(db, ...MENU_COSTS_DOC_PATH);
}

// costs: { [menuItemId]: "3,50" } — same price format as menu item.price
// (parsePriceToCents in shared.jsx). No document created yet -> {}.
export function subscribeMenuCosts(onChange, onError) {
  return onSnapshot(menuCostsRef(), (snap) => onChange(snap.exists() ? snap.data() : {}), onError);
}

export async function saveMenuCosts(costs) {
  return setDoc(menuCostsRef(), costs);
}
