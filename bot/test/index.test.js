import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/telegram.js", () => ({
  parseUpdate: vi.fn(),
  sendMessage: vi.fn(),
  downloadVoiceFile: vi.fn(),
}));
vi.mock("../src/groq.js", () => ({ transcribeAudio: vi.fn(), chatCompletion: vi.fn() }));
vi.mock("../src/auth.js", () => ({ resolveStaffByChatId: vi.fn() }));
vi.mock("../src/firestoreRest.js", () => ({
  getDocument: vi.fn(),
  patchDocument: vi.fn(),
  createDocument: vi.fn(),
  deleteDocument: vi.fn(),
  queryEquals: vi.fn(),
}));

import { parseUpdate, sendMessage, downloadVoiceFile } from "../src/telegram.js";
import { transcribeAudio, chatCompletion } from "../src/groq.js";
import { resolveStaffByChatId } from "../src/auth.js";
import { getDocument, patchDocument, deleteDocument, queryEquals } from "../src/firestoreRest.js";
import worker from "../src/index.js";

const env = { TELEGRAM_WEBHOOK_SECRET: "correct-secret" };

function webhookRequest(update, secret = "correct-secret") {
  return new Request("https://bot.example/telegram-webhook", {
    method: "POST",
    headers: { "X-Telegram-Bot-Api-Secret-Token": secret, "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
}

const sampleMenu = () => ({
  coperto: { adults: "2,00", children: "1,00" },
  categories: [{ id: "cat1", name: "Antipasti", items: [{ id: "item1", name: "Bruschetta", price: "6,00", visible: true }] }],
});

beforeEach(() => {
  vi.clearAllMocks();
  queryEquals.mockResolvedValue([]); // "no open tables" by default
  getDocument.mockImplementation(async (_env, path) => (path === "menu/data" ? sampleMenu() : null));
});

describe("Worker.fetch — transport-level guards", () => {
  it("GET returns a plain health-check response without touching Telegram/Firestore", async () => {
    const res = await worker.fetch(new Request("https://bot.example/", { method: "GET" }), env);
    expect(res.status).toBe(200);
    expect(parseUpdate).not.toHaveBeenCalled();
  });

  it("rejects a webhook call with the wrong secret token", async () => {
    const res = await worker.fetch(webhookRequest({}, "wrong-secret"), env);
    expect(res.status).toBe(401);
    expect(parseUpdate).not.toHaveBeenCalled();
  });

  it("ignores an update it doesn't understand (e.g. edited_message) but still replies 200 to Telegram", async () => {
    parseUpdate.mockReturnValue(null);
    const res = await worker.fetch(webhookRequest({ edited_message: {} }), env);
    expect(res.status).toBe(200);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe("Worker.fetch — authorization", () => {
  it("tells an unrecognized chat it isn't authorized, including its chat id for the admin to link", async () => {
    parseUpdate.mockReturnValue({ kind: "text", chatId: "999", fromId: "999", text: "ciao" });
    resolveStaffByChatId.mockResolvedValue(null);

    await worker.fetch(webhookRequest({}), env);

    expect(sendMessage).toHaveBeenCalledWith(env, "999", expect.stringContaining("999"));
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it("tells a role with no chat tools (kitchen) that nothing is available", async () => {
    parseUpdate.mockReturnValue({ kind: "text", chatId: "1", fromId: "1", text: "ciao" });
    resolveStaffByChatId.mockResolvedValue({ uid: "u1", name: "Anna", role: "kitchen" });

    await worker.fetch(webhookRequest({}), env);

    expect(sendMessage).toHaveBeenCalledWith(env, "1", expect.stringContaining("non ha azioni"));
    expect(chatCompletion).not.toHaveBeenCalled();
  });
});

describe("Worker.fetch — /start", () => {
  it("replies with a greeting without calling the LLM", async () => {
    parseUpdate.mockReturnValue({ kind: "text", chatId: "1", fromId: "1", text: "/start" });
    resolveStaffByChatId.mockResolvedValue({ uid: "u1", name: "Mario", role: "waiter" });

    await worker.fetch(webhookRequest({}), env);

    expect(sendMessage).toHaveBeenCalledWith(env, "1", expect.stringContaining("Mario"));
    expect(chatCompletion).not.toHaveBeenCalled();
  });
});

describe("Worker.fetch — voice notes", () => {
  it("transcribes voice via Groq before running the command pipeline", async () => {
    parseUpdate.mockReturnValue({ kind: "voice", chatId: "1", fromId: "1", fileId: "f1", mimeType: "audio/ogg" });
    resolveStaffByChatId.mockResolvedValue({ uid: "u1", name: "Mario", role: "waiter" });
    downloadVoiceFile.mockResolvedValue({ buffer: new ArrayBuffer(4), filename: "voice.oga" });
    transcribeAudio.mockResolvedValue("apri il tavolo 5 per due persone");
    chatCompletion.mockResolvedValue({ content: "ok", tool_calls: undefined });

    await worker.fetch(webhookRequest({}), env);

    expect(transcribeAudio).toHaveBeenCalledWith(env, expect.any(ArrayBuffer), "voice.oga", "audio/ogg");
    expect(chatCompletion).toHaveBeenCalledWith(
      env,
      expect.objectContaining({ userText: "apri il tavolo 5 per due persone" })
    );
  });

  it("tells the user when transcription comes back empty, without calling the LLM", async () => {
    parseUpdate.mockReturnValue({ kind: "voice", chatId: "1", fromId: "1", fileId: "f1", mimeType: "audio/ogg" });
    resolveStaffByChatId.mockResolvedValue({ uid: "u1", name: "Mario", role: "waiter" });
    downloadVoiceFile.mockResolvedValue({ buffer: new ArrayBuffer(4), filename: "voice.oga" });
    transcribeAudio.mockResolvedValue("   ");

    await worker.fetch(webhookRequest({}), env);

    expect(chatCompletion).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(env, "1", expect.stringContaining("Non sono riuscito"));
  });
});

describe("Worker.fetch — non-destructive tool executes immediately", () => {
  it("opens a table straight away (open_table isn't in DESTRUCTIVE_TOOLS)", async () => {
    parseUpdate.mockReturnValue({ kind: "text", chatId: "1", fromId: "1", text: "apri il tavolo 5, due persone" });
    resolveStaffByChatId.mockResolvedValue({ uid: "u1", name: "Mario", role: "waiter" });
    chatCompletion.mockResolvedValue({
      content: null,
      tool_calls: [{ function: { name: "open_table", arguments: JSON.stringify({ tableNumber: 5, adults: 2 }) } }],
    });

    await worker.fetch(webhookRequest({}), env);

    expect(patchDocument).not.toHaveBeenCalledWith(env, "botPending/1", expect.anything());
    expect(sendMessage).toHaveBeenCalledWith(env, "1", expect.stringContaining("Tavolo 5 aperto"));
  });

  it("relays a ToolError message instead of a raw exception (table already open)", async () => {
    parseUpdate.mockReturnValue({ kind: "text", chatId: "1", fromId: "1", text: "apri il tavolo 5" });
    resolveStaffByChatId.mockResolvedValue({ uid: "u1", name: "Mario", role: "waiter" });
    queryEquals.mockImplementation(async (_env, collection, filters) =>
      collection === "orders" && filters.length === 2 ? [{ id: "o1", tableNumber: 5 }] : []
    );
    chatCompletion.mockResolvedValue({
      content: null,
      tool_calls: [{ function: { name: "open_table", arguments: JSON.stringify({ tableNumber: 5, adults: 2 }) } }],
    });

    await worker.fetch(webhookRequest({}), env);

    expect(sendMessage).toHaveBeenCalledWith(env, "1", expect.stringContaining("già aperto"));
  });

  it("falls back to relaying the model's plain-text reply when no tool was called", async () => {
    parseUpdate.mockReturnValue({ kind: "text", chatId: "1", fromId: "1", text: "che tempo fa oggi?" });
    resolveStaffByChatId.mockResolvedValue({ uid: "u1", name: "Mario", role: "waiter" });
    chatCompletion.mockResolvedValue({ content: "Non posso aiutarti con questo.", tool_calls: [] });

    await worker.fetch(webhookRequest({}), env);

    expect(sendMessage).toHaveBeenCalledWith(env, "1", "Non posso aiutarti con questo.");
  });
});

describe("Worker.fetch — destructive tools require confirmation", () => {
  it("stores a pending confirmation and asks before hiding a dish", async () => {
    parseUpdate.mockReturnValue({ kind: "text", chatId: "1", fromId: "1", text: "nascondi la bruschetta" });
    resolveStaffByChatId.mockResolvedValue({ uid: "u1", name: "Anna", role: "admin" });
    chatCompletion.mockResolvedValue({
      content: null,
      tool_calls: [{ function: { name: "hide_menu_item", arguments: JSON.stringify({ categoryId: "cat1", itemId: "item1" }) } }],
    });

    await worker.fetch(webhookRequest({}), env);

    expect(patchDocument).toHaveBeenCalledWith(
      env,
      "botPending/1",
      expect.objectContaining({ toolName: "hide_menu_item", args: { categoryId: "cat1", itemId: "item1" } })
    );
    expect(sendMessage).toHaveBeenCalledWith(env, "1", expect.stringContaining("Bruschetta"));
    expect(sendMessage).toHaveBeenCalledWith(env, "1", expect.stringContaining("Confermi"));
  });

  it("executes the pending action on a 'sì' reply and clears it", async () => {
    parseUpdate.mockReturnValue({ kind: "text", chatId: "1", fromId: "1", text: "sì" });
    resolveStaffByChatId.mockResolvedValue({ uid: "u1", name: "Anna", role: "admin" });
    getDocument.mockImplementation(async (_env, path) => {
      if (path === "botPending/1") {
        return { toolName: "hide_menu_item", args: { categoryId: "cat1", itemId: "item1" }, createdAt: new Date().toISOString() };
      }
      if (path === "menu/data") return sampleMenu();
      return null;
    });

    await worker.fetch(webhookRequest({}), env);

    expect(deleteDocument).toHaveBeenCalledWith(env, "botPending/1");
    expect(patchDocument).toHaveBeenCalledWith(env, "menu/data", expect.anything());
    expect(sendMessage).toHaveBeenCalledWith(env, "1", expect.stringContaining("✅"));
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it("cancels the pending action on a 'no' reply", async () => {
    parseUpdate.mockReturnValue({ kind: "text", chatId: "1", fromId: "1", text: "no" });
    resolveStaffByChatId.mockResolvedValue({ uid: "u1", name: "Anna", role: "admin" });
    getDocument.mockImplementation(async (_env, path) =>
      path === "botPending/1"
        ? { toolName: "hide_menu_item", args: { categoryId: "cat1", itemId: "item1" }, createdAt: new Date().toISOString() }
        : null
    );

    await worker.fetch(webhookRequest({}), env);

    expect(deleteDocument).toHaveBeenCalledWith(env, "botPending/1");
    expect(patchDocument).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(env, "1", expect.stringContaining("annullata"));
  });

  it("discards a stale (expired) pending confirmation and treats the message as a new command", async () => {
    parseUpdate.mockReturnValue({ kind: "text", chatId: "1", fromId: "1", text: "apri il tavolo 5, due persone" });
    resolveStaffByChatId.mockResolvedValue({ uid: "u1", name: "Mario", role: "waiter" });
    getDocument.mockImplementation(async (_env, path) => {
      if (path === "botPending/1") {
        return {
          toolName: "close_table",
          args: { tableNumber: 1 },
          createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 minutes ago, past the 5-minute TTL
        };
      }
      if (path === "menu/data") return sampleMenu();
      return null;
    });
    chatCompletion.mockResolvedValue({
      content: null,
      tool_calls: [{ function: { name: "open_table", arguments: JSON.stringify({ tableNumber: 5, adults: 2 }) } }],
    });

    await worker.fetch(webhookRequest({}), env);

    expect(sendMessage).toHaveBeenCalledWith(env, "1", expect.stringContaining("Tavolo 5 aperto"));
  });
});
