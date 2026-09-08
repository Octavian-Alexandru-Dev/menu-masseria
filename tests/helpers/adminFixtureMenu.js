// Menù "fixture" minimo, usato per popolare l'editor Admin via "Importa
// JSON" durante i test strutturali (categorie/voci, riordino, spostamento
// tra categorie, traduzioni, opzioni PDF...): l'importazione sostituisce
// solo lo stato locale dell'editor (Admin.jsx, parseMenuJsonFile → setMenu),
// SENZA scrivere su Firestore finché non si preme "Salva modifiche" — che
// questi test non premono mai. Così si evita di toccare il menù demo
// condiviso (scripts/seed-emulator.js) da cui dipendono i test di altri file
// (es. waiter-order.spec.js cerca "Bruschetta" per nome), anche se questi
// test girano in parallelo con quelli.
export function makeFixtureMenu(suffix = "") {
  return {
    theme: "rustica",
    restaurantName: `Fixture Ristorante ${suffix}`,
    location: "Fixture Località",
    tagline: "Fixture tagline",
    footerNote: "Fixture footer",
    searchEnabled: true,
    coperto: { adults: "2,00", children: "1,00" },
    categories: [
      {
        id: `fx-cat-a-${suffix}`,
        name: `Fixture Categoria A ${suffix}`,
        subtitle: "Sottotitolo A",
        visible: true,
        items: [
          { id: `fx-item-a1-${suffix}`, name: `Fixture Voce A1 ${suffix}`, price: "3,00", tag: "", description: "Descrizione A1", visible: true, staffOnly: false },
          { id: `fx-item-a2-${suffix}`, name: `Fixture Voce A2 ${suffix}`, price: "4,00", tag: "", description: "Descrizione A2", visible: true, staffOnly: false },
        ],
      },
      {
        id: `fx-cat-b-${suffix}`,
        name: `Fixture Categoria B ${suffix}`,
        subtitle: "Sottotitolo B",
        visible: true,
        items: [
          { id: `fx-item-b1-${suffix}`, name: `Fixture Voce B1 ${suffix}`, price: "5,00", tag: "", description: "Descrizione B1", visible: true, staffOnly: false },
        ],
      },
    ],
    translations: {},
  };
}
