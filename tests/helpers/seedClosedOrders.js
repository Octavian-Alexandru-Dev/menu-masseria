// Crea/elimina comande già chiuse direttamente su Firestore (emulatore), per
// testare la paginazione di OrderHistory.jsx (HISTORY_PAGE_SIZE = 20, vedi
// orders.js) senza dover aprire e chiudere 20+ tavoli dall'interfaccia — che
// sarebbe troppo lento per un singolo test e comunque non aggiungerebbe
// copertura oltre a quella già data dal flusso completo testato altrove
// (waiter-order.spec.js, kitchen-view.spec.js).
import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc, collection, query, where, getDocs, deleteDoc, Timestamp } from "firebase/firestore";
import { TEST_WAITER } from "../test-env.js";
import { auth, db } from "./emulatorApp.js";

let signInPromise = null;
function ensureSignedIn() {
  if (!signInPromise) {
    signInPromise = signInWithEmailAndPassword(auth, TEST_WAITER.email, TEST_WAITER.password);
  }
  return signInPromise;
}

// `marker` identifica il batch (usato sia come waiterName sia come prefisso
// id) così la pulizia può trovare ed eliminare esattamente questi documenti,
// senza toccare comande reali o di altri test.
export async function seedClosedOrders(count, marker) {
  await ensureSignedIn();
  const base = 20000 + Math.floor(Math.random() * 1000);
  const now = Date.now();
  await Promise.all(Array.from({ length: count }).map((_, i) => {
    const closedAt = Timestamp.fromMillis(now - i * 1000); // ordine decrescente stabile
    return setDoc(doc(db, "orders", `${marker}-${i}`), {
      tableNumber: base + i,
      status: "closed",
      waiterName: marker,
      notes: "",
      covers: { adults: 0, children: 0 },
      coperto: { adults: "0,00", children: "0,00" },
      items: [{
        lineId: `l-${i}`, menuItemId: "item-test", name: "Voce di test", price: "1,00", quantity: 1,
        categoryId: "cat-test", categoryName: "Test", status: "out",
        sentAt: Timestamp.fromMillis(now - i * 1000 - 1000), outAt: closedAt,
      }],
      openedAt: Timestamp.fromMillis(now - i * 1000 - 60000),
      closedAt,
    });
  }));
}

export async function deleteOrdersByWaiterName(marker) {
  await ensureSignedIn();
  const q = query(collection(db, "orders"), where("waiterName", "==", marker));
  const snap = await getDocs(q);
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
}
