// Worker entry point: receives the Telegram webhook, transcribes voice notes
// via Groq Whisper, resolves the command to a tool call via Groq's chat
// model, validates + executes it against Firestore, and replies on Telegram.
// See docs/telegram-bot.md for the full flow and account setup.
import { parseUpdate, sendMessage, downloadVoiceFile } from "./telegram.js";
import { transcribeAudio, chatCompletion } from "./groq.js";
import { resolveStaffByChatId } from "./auth.js";
import { getDocument, patchDocument, deleteDocument, queryEquals } from "./firestoreRest.js";
import {
  getToolsForRole,
  executeTool,
  describeToolCall,
  buildSystemPrompt,
  buildMenuContext,
  buildOpenOrdersContext,
  DESTRUCTIVE_TOOLS,
  ToolError,
} from "./tools.js";

const PENDING_TTL_MS = 5 * 60 * 1000;

function parseYesNo(text) {
  const t = text.trim().toLowerCase();
  if (["si", "sì", "ok", "va bene", "confermo", "yes"].includes(t)) return true;
  if (["no", "annulla", "annullato", "no grazie"].includes(t)) return false;
  return null;
}

async function getPending(env, chatId) {
  const pending = await getDocument(env, `botPending/${chatId}`);
  if (!pending) return null;
  if (Date.now() - new Date(pending.createdAt).getTime() > PENDING_TTL_MS) {
    await deleteDocument(env, `botPending/${chatId}`);
    return null;
  }
  return pending;
}

async function handleCommandText(env, { chatId, staff, text }) {
  const pending = await getPending(env, chatId);
  if (pending) {
    const answer = parseYesNo(text);
    if (answer === true) {
      await deleteDocument(env, `botPending/${chatId}`);
      try {
        const result = await executeTool(env, pending.toolName, pending.args, {
          staffUid: staff.uid,
          staffName: staff.name,
        });
        await sendMessage(env, chatId, `✅ ${result}`);
      } catch (err) {
        await sendMessage(env, chatId, err instanceof ToolError ? `⚠️ ${err.message}` : "Si è verificato un errore imprevisto, riprova.");
        if (!(err instanceof ToolError)) console.error("[bot] tool execution failed", err);
      }
      return;
    }
    if (answer === false) {
      await deleteDocument(env, `botPending/${chatId}`);
      await sendMessage(env, chatId, "Operazione annullata.");
      return;
    }
    // Neither a clear yes nor no: fall through and treat this as a brand new
    // command, silently superseding the stale pending confirmation.
    await deleteDocument(env, `botPending/${chatId}`);
  }

  const [menu, openOrders] = await Promise.all([
    getDocument(env, "menu/data"),
    queryEquals(env, "orders", [["status", "open"]], 50),
  ]);

  const systemPrompt = buildSystemPrompt({
    role: staff.role,
    staffName: staff.name,
    menuContextJson: buildMenuContext(menu),
    openOrdersContextJson: buildOpenOrdersContext(openOrders),
  });

  const message = await chatCompletion(env, {
    systemPrompt,
    userText: text,
    tools: getToolsForRole(staff.role),
  });

  const toolCall = message.tool_calls?.[0]; // one action per message, by design
  if (!toolCall) {
    await sendMessage(env, chatId, message.content || "Non ho capito, puoi riformulare?");
    return;
  }

  let args;
  try {
    args = JSON.parse(toolCall.function.arguments);
  } catch {
    await sendMessage(env, chatId, "Non sono riuscito a interpretare correttamente il comando, riprova.");
    return;
  }

  if (DESTRUCTIVE_TOOLS.has(toolCall.function.name)) {
    await patchDocument(env, `botPending/${chatId}`, {
      toolName: toolCall.function.name,
      args,
      staffUid: staff.uid,
      staffName: staff.name,
      createdAt: new Date(),
    });
    const description = describeToolCall(menu, toolCall.function.name, args);
    await sendMessage(env, chatId, `Confermi di voler ${description}? Rispondi "sì" per confermare o "no" per annullare.`);
    return;
  }

  try {
    const result = await executeTool(env, toolCall.function.name, args, { staffUid: staff.uid, staffName: staff.name });
    await sendMessage(env, chatId, `✅ ${result}`);
  } catch (err) {
    await sendMessage(env, chatId, err instanceof ToolError ? `⚠️ ${err.message}` : "Si è verificato un errore imprevisto, riprova.");
    if (!(err instanceof ToolError)) console.error("[bot] tool execution failed", err);
  }
}

async function handleUpdate(env, update) {
  const parsed = parseUpdate(update);
  if (!parsed || parsed.kind === "unsupported") return;

  const staff = await resolveStaffByChatId(env, parsed.chatId);
  if (!staff) {
    await sendMessage(
      env,
      parsed.chatId,
      `Non sei autorizzato a usare questo bot. Chiedi all'amministratore di collegare questo chat (id: ${parsed.chatId}) al tuo account staff.`
    );
    return;
  }
  if (getToolsForRole(staff.role).length === 0) {
    await sendMessage(env, parsed.chatId, "Il tuo ruolo non ha azioni disponibili via chat: usa lo schermo cucina.");
    return;
  }

  if (parsed.kind === "text" && ["/start", "/help"].includes(parsed.text.trim())) {
    await sendMessage(
      env,
      parsed.chatId,
      `Ciao ${staff.name || ""}! Scrivimi o mandami un vocale con un comando (es. "nascondi la parmigiana" o "tavolo 5, due margherite").`.trim()
    );
    return;
  }

  let text = parsed.text;
  if (parsed.kind === "voice") {
    const { buffer, filename } = await downloadVoiceFile(env, parsed.fileId);
    text = await transcribeAudio(env, buffer, filename, parsed.mimeType);
    if (!text || !text.trim()) {
      await sendMessage(env, parsed.chatId, "Non sono riuscito a capire il messaggio vocale, riprova o scrivimi in testo.");
      return;
    }
  }

  await handleCommandText(env, { chatId: parsed.chatId, staff, text });
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Menu Masseria bot attivo.", { status: 200 });
    }
    if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    const update = await request.json();
    try {
      await handleUpdate(env, update);
    } catch (err) {
      // Telegram retries webhooks that don't return 200, which would just
      // repeat the same failure — log and acknowledge instead.
      console.error("[bot] unhandled error", err);
    }
    return new Response("OK", { status: 200 });
  },
};
