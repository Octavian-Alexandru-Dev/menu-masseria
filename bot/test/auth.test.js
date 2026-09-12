import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/firestoreRest.js", () => ({ queryEquals: vi.fn() }));

import { queryEquals } from "../src/firestoreRest.js";
import { resolveStaffByChatId } from "../src/auth.js";

beforeEach(() => vi.clearAllMocks());

describe("resolveStaffByChatId", () => {
  it("returns null when no staff doc is linked to this chat", async () => {
    queryEquals.mockResolvedValue([]);
    expect(await resolveStaffByChatId({}, "12345")).toBeNull();
    expect(queryEquals).toHaveBeenCalledWith({}, "staff", [["telegramChatId", "12345"]], 1);
  });

  it("returns null for a linked staff doc with no valid role (the existing 'no-role' UI state)", async () => {
    queryEquals.mockResolvedValue([{ id: "uid1", name: "Luca", telegramChatId: "12345" }]);
    expect(await resolveStaffByChatId({}, "12345")).toBeNull();
  });

  it("returns null for a linked staff doc with an unrecognized role", async () => {
    queryEquals.mockResolvedValue([{ id: "uid1", name: "Luca", role: "manager" }]);
    expect(await resolveStaffByChatId({}, "12345")).toBeNull();
  });

  it("returns uid/name/role for a recognized staff member", async () => {
    queryEquals.mockResolvedValue([{ id: "uid1", name: "Luca", role: "waiter", telegramChatId: "12345" }]);
    expect(await resolveStaffByChatId({}, "12345")).toEqual({ uid: "uid1", name: "Luca", role: "waiter" });
  });
});
