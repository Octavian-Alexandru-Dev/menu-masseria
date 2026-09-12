import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/firestoreRest.js", () => ({
  getDocument: vi.fn(),
  patchDocument: vi.fn(),
  createDocument: vi.fn(),
  queryEquals: vi.fn(),
}));

import { getDocument, patchDocument, createDocument, queryEquals } from "../src/firestoreRest.js";
import { executeTool, ToolError, getToolsForRole, describeToolCall } from "../src/tools.js";

function sampleMenu() {
  return {
    id: "data",
    coperto: { adults: "2,00", children: "1,00" },
    categories: [
      {
        id: "cat1",
        name: "Antipasti",
        items: [
          { id: "item1", name: "Bruschetta", price: "6,00", visible: true },
          { id: "item2", name: "Parmigiana di melanzane", price: "9,50", visible: true },
        ],
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getToolsForRole", () => {
  it("gives the admin every tool", () => {
    expect(getToolsForRole("admin")).toHaveLength(6);
  });
  it("gives a waiter only the order-related tools", () => {
    const names = getToolsForRole("waiter").map((t) => t.function.name);
    expect(names).toEqual(["open_table", "add_order_items", "close_table"]);
  });
  it("gives kitchen no chat tools", () => {
    expect(getToolsForRole("kitchen")).toEqual([]);
  });
});

describe("hide_menu_item / show_menu_item", () => {
  it("hides a real item and writes back the whole categories array", async () => {
    const menu = sampleMenu();
    getDocument.mockResolvedValue(menu);

    const result = await executeTool({}, "hide_menu_item", { categoryId: "cat1", itemId: "item2" }, {});

    expect(result).toContain("Parmigiana di melanzane");
    expect(patchDocument).toHaveBeenCalledWith({}, "menu/data", { categories: menu.categories });
    expect(menu.categories[0].items[1].visible).toBe(false);
  });

  it("rejects an itemId that doesn't exist in the given category", async () => {
    getDocument.mockResolvedValue(sampleMenu());
    await expect(executeTool({}, "hide_menu_item", { categoryId: "cat1", itemId: "nope" }, {})).rejects.toThrow(
      ToolError
    );
    expect(patchDocument).not.toHaveBeenCalled();
  });

  it("rejects a categoryId that doesn't exist at all", async () => {
    getDocument.mockResolvedValue(sampleMenu());
    await expect(executeTool({}, "hide_menu_item", { categoryId: "nope", itemId: "item1" }, {})).rejects.toThrow(
      ToolError
    );
  });

  it("shows a previously hidden item", async () => {
    const menu = sampleMenu();
    menu.categories[0].items[0].visible = false;
    getDocument.mockResolvedValue(menu);

    const result = await executeTool({}, "show_menu_item", { categoryId: "cat1", itemId: "item1" }, {});
    expect(result).toContain("Reso visibile");
    expect(menu.categories[0].items[0].visible).toBe(true);
  });
});

describe("update_menu_item_price", () => {
  it("rejects a price not in Italian format", async () => {
    await expect(
      executeTool({}, "update_menu_item_price", { categoryId: "cat1", itemId: "item1", newPrice: "6.00" }, {})
    ).rejects.toThrow(ToolError);
    expect(getDocument).not.toHaveBeenCalled();
  });

  it("updates the price of a real item", async () => {
    const menu = sampleMenu();
    getDocument.mockResolvedValue(menu);
    const result = await executeTool(
      {},
      "update_menu_item_price",
      { categoryId: "cat1", itemId: "item1", newPrice: "7,50" },
      {}
    );
    expect(result).toContain("7,50");
    expect(menu.categories[0].items[0].price).toBe("7,50");
  });
});

describe("open_table", () => {
  it("refuses to open a table that's already open", async () => {
    queryEquals.mockResolvedValue([{ id: "order1", tableNumber: 5 }]);
    await expect(executeTool({}, "open_table", { tableNumber: 5, adults: 2 }, {})).rejects.toThrow(ToolError);
    expect(createDocument).not.toHaveBeenCalled();
  });

  it("opens a new table, snapshotting the coperto from the current menu", async () => {
    queryEquals.mockResolvedValue([]);
    getDocument.mockResolvedValue(sampleMenu());

    await executeTool({}, "open_table", { tableNumber: 5, adults: 2, children: 1 }, { staffUid: "u1", staffName: "Mario" });

    expect(createDocument).toHaveBeenCalledWith(
      {},
      "orders",
      expect.objectContaining({
        tableNumber: 5,
        covers: { adults: 2, children: 1 },
        coperto: { adults: "2,00", children: "1,00" },
        status: "open",
        waiterUid: "u1",
        waiterName: "Mario",
        items: [],
        closedAt: null,
      })
    );
  });
});

describe("add_order_items", () => {
  it("refuses to add items to a table that isn't open", async () => {
    queryEquals.mockResolvedValue([]);
    await expect(
      executeTool({}, "add_order_items", { tableNumber: 9, items: [{ categoryId: "cat1", itemId: "item1", quantity: 1 }] }, {})
    ).rejects.toThrow(ToolError);
  });

  it("fails the whole call (no partial write) when one item doesn't exist", async () => {
    queryEquals.mockResolvedValue([{ id: "order1", tableNumber: 5, items: [] }]);
    getDocument.mockImplementation((_env, path) => (path === "menu/data" ? sampleMenu() : {}));

    await expect(
      executeTool(
        {},
        "add_order_items",
        { tableNumber: 5, items: [{ categoryId: "cat1", itemId: "item1", quantity: 1 }, { categoryId: "cat1", itemId: "ghost", quantity: 1 }] },
        {}
      )
    ).rejects.toThrow(ToolError);
    expect(patchDocument).not.toHaveBeenCalled();
  });

  it("appends correctly-shaped lines, snapshotting name/price/cost", async () => {
    queryEquals.mockResolvedValue([{ id: "order1", tableNumber: 5, items: [] }]);
    getDocument.mockImplementation((_env, path) => {
      if (path === "menu/data") return sampleMenu();
      if (path === "menuCosts/data") return { item1: "2,50" };
      return null;
    });

    const result = await executeTool(
      {},
      "add_order_items",
      { tableNumber: 5, items: [{ categoryId: "cat1", itemId: "item1", quantity: 2, notes: "senza aglio" }] },
      {}
    );

    expect(result).toContain("2x Bruschetta");
    const [, path, data] = patchDocument.mock.calls[0];
    expect(path).toBe("orders/order1");
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({
      menuItemId: "item1",
      name: "Bruschetta",
      price: "6,00",
      quantity: 2,
      categoryId: "cat1",
      categoryName: "Antipasti",
      notes: "senza aglio",
      cost: "2,50",
      status: "sent",
      outAt: null,
    });
    expect(typeof data.items[0].lineId).toBe("string");
  });
});

describe("close_table", () => {
  it("refuses to close a table that isn't open", async () => {
    queryEquals.mockResolvedValue([]);
    await expect(executeTool({}, "close_table", { tableNumber: 5 }, {})).rejects.toThrow(ToolError);
  });

  it("closes an open table", async () => {
    queryEquals.mockResolvedValue([{ id: "order1", tableNumber: 5 }]);
    const result = await executeTool({}, "close_table", { tableNumber: 5 }, {});
    expect(result).toContain("Tavolo 5 chiuso");
    const [, path, data] = patchDocument.mock.calls[0];
    expect(path).toBe("orders/order1");
    expect(data.status).toBe("closed");
    expect(data.expireAt).toBeNull();
    expect(data.closedAt).toBeInstanceOf(Date);
  });
});

describe("describeToolCall", () => {
  it("resolves the real dish name for a confirmation prompt", () => {
    const description = describeToolCall(sampleMenu(), "hide_menu_item", { categoryId: "cat1", itemId: "item2" });
    expect(description).toContain("Parmigiana di melanzane");
  });

  it("falls back to the raw id if the item can't be found (defensive, shouldn't happen post-validation)", () => {
    const description = describeToolCall(sampleMenu(), "hide_menu_item", { categoryId: "cat1", itemId: "ghost" });
    expect(description).toContain("ghost");
  });
});
