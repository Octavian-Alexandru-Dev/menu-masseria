// Pure value-conversion round-trips — no network involved.
import { describe, it, expect } from "vitest";
import { toFirestoreValue, fromFirestoreValue, toFirestoreFields, fromFirestoreFields } from "../src/firestoreRest.js";

describe("Firestore value conversion", () => {
  it.each([
    ["string", "Parmigiana"],
    ["integer", 5],
    ["double", 3.5],
    ["boolean true", true],
    ["boolean false", false],
    ["null", null],
  ])("round-trips a %s", (_label, value) => {
    expect(fromFirestoreValue(toFirestoreValue(value))).toEqual(value);
  });

  it("round-trips an array of mixed primitives", () => {
    const value = ["a", 1, true, null];
    expect(fromFirestoreValue(toFirestoreValue(value))).toEqual(value);
  });

  it("round-trips a nested object (map)", () => {
    const value = { adults: 2, children: 0, note: "vicino alla finestra" };
    expect(fromFirestoreValue(toFirestoreValue(value))).toEqual(value);
  });

  it("round-trips a deeply nested structure (menu-shaped)", () => {
    const value = {
      categories: [
        { id: "c1", name: "Antipasti", items: [{ id: "i1", name: "Bruschetta", price: "6,00", visible: true }] },
      ],
    };
    expect(fromFirestoreValue(toFirestoreValue(value))).toEqual(value);
  });

  it("encodes a Date as a Firestore timestampValue and decodes back to an equivalent Date", () => {
    const date = new Date("2026-01-01T12:00:00.000Z");
    const wire = toFirestoreValue(date);
    expect(wire).toHaveProperty("timestampValue");
    expect(fromFirestoreValue(wire).toISOString()).toBe(date.toISOString());
  });

  it("drops undefined fields, matching the client SDK's rejection of nested undefined", () => {
    const fields = toFirestoreFields({ a: 1, b: undefined, c: "x" });
    expect(fields).toHaveProperty("a");
    expect(fields).toHaveProperty("c");
    expect(fields).not.toHaveProperty("b");
  });

  it("toFirestoreFields/fromFirestoreFields round-trip an object", () => {
    const obj = { name: "Tavolo 5", covers: { adults: 2, children: 1 } };
    expect(fromFirestoreFields(toFirestoreFields(obj))).toEqual(obj);
  });
});
