import { test, expect } from "@playwright/test";
import { menuEdits, combineEdits, MenuEditError, withTranslations } from "../src/menuEdit.js";

// Modifiche al menù come funzioni pure (src/menuEdit.js), condivise dalla
// gestione menù della cassa (TillMenu.jsx, una modifica alla volta in una
// transazione) e in parte da Admin.jsx. Senza browser né emulatore.

const baseMenu = () => ({
  restaurantName: "Prova",
  categories: [
    { id: "a", name: "Antipasti", items: [{ id: "x", name: "Bruschetta" }, { id: "y", name: "Caprese" }] },
    { id: "b", name: "Bevande", items: [{ id: "z", name: "Acqua", kitchenTicket: false }] },
  ],
});

test("un menù senza traduzioni non riceve mai 'translations: undefined' (Firestore lo rifiuterebbe)", () => {
  const menu = baseMenu();
  for (const edited of [
    menuEdits.removeItem("x")(menu),
    menuEdits.removeCategory("a")(menu),
    menuEdits.moveItemToCategory("x", "b")(menu),
  ]) {
    expect("translations" in edited).toBe(false);
    expect(JSON.stringify(edited)).not.toContain("undefined");
  }
  expect(withTranslations(menu, undefined)).toBe(menu);
});

test("le traduzioni seguono il piatto spostato e spariscono con quello eliminato", () => {
  const menu = { ...baseMenu(), translations: { en: { categories: { a: { items: { x: { name: "Bruschetta EN" } } } } } } };
  const moved = menuEdits.moveItemToCategory("x", "b")(menu);
  expect(moved.translations.en.categories.b.items.x.name).toBe("Bruschetta EN");
  expect(moved.translations.en.categories.a.items.x).toBeUndefined();
  const removed = menuEdits.removeItem("x")(menu);
  expect(removed.translations.en.categories.a.items).toEqual({});
});

test("le modifiche trovano piatti e categorie per id e segnalano quelli spariti nel frattempo", () => {
  const menu = baseMenu();
  const updated = menuEdits.updateItem("z", { kitchenTicket: true, price: "2,50" })(menu);
  expect(updated.categories[1].items[0]).toEqual({ id: "z", name: "Acqua", kitchenTicket: true, price: "2,50" });
  expect(menu.categories[1].items[0].kitchenTicket).toBe(false); // l'originale non cambia
  expect(() => menuEdits.updateItem("gone", {})(menu)).toThrow(MenuEditError);
  expect(() => menuEdits.addItem("gone", { id: "n" })(menu)).toThrow(MenuEditError);
  expect(() => menuEdits.removeCategory("gone")(menu)).toThrow(MenuEditError);
});

test("spostamenti, 'In comanda' per categoria e più modifiche insieme", () => {
  const menu = baseMenu();
  expect(menuEdits.moveItem("y", -1)(menu).categories[0].items.map((i) => i.id)).toEqual(["y", "x"]);
  expect(menuEdits.moveItem("x", -1)(menu)).toBe(menu); // già primo: nessun cambiamento
  expect(menuEdits.moveCategory("b", -1)(menu).categories.map((c) => c.id)).toEqual(["b", "a"]);
  const allOff = menuEdits.setCategoryKitchenTicket("a", false)(menu);
  expect(allOff.categories[0].items.every((i) => i.kitchenTicket === false)).toBe(true);
  const both = combineEdits(menuEdits.updateItem("x", { name: "Bruschetta al pomodoro" }), menuEdits.moveItemToCategory("x", "b"))(menu);
  expect(both.categories[1].items.map((i) => i.name)).toEqual(["Acqua", "Bruschetta al pomodoro"]);
});
