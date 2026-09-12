// Telegram Bot API helpers (https://core.telegram.org/bots/api). No SDK
// dependency: the API is plain HTTPS/JSON, small enough to call directly.

function apiUrl(env, method) {
  return `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
}

// Only the two update shapes the bot understands: a text message, or a
// voice note. Anything else (edited messages, stickers, group events,
// callback queries — MVP confirms actions with a plain-text "sì"/"no"
// reply, not inline keyboards) is reported as unsupported so the caller can
// decide whether to ignore it silently or reply.
export function parseUpdate(update) {
  const message = update.message;
  if (!message || !message.chat || !message.from) return null;

  const chatId = String(message.chat.id);
  const fromId = String(message.from.id);

  if (typeof message.text === "string") {
    return { kind: "text", chatId, fromId, text: message.text };
  }
  if (message.voice) {
    return {
      kind: "voice",
      chatId,
      fromId,
      fileId: message.voice.file_id,
      mimeType: message.voice.mime_type || "audio/ogg",
    };
  }
  return { kind: "unsupported", chatId, fromId };
}

export async function sendMessage(env, chatId, text) {
  const res = await fetch(apiUrl(env, "sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) {
    throw new Error(`Telegram sendMessage failed: ${res.status} ${await res.text()}`);
  }
}

// Voice notes must be downloaded (Telegram gives you a file_id, not bytes)
// before they can be forwarded to Groq for transcription.
export async function downloadVoiceFile(env, fileId) {
  const infoRes = await fetch(`${apiUrl(env, "getFile")}?file_id=${encodeURIComponent(fileId)}`);
  if (!infoRes.ok) throw new Error(`Telegram getFile failed: ${infoRes.status} ${await infoRes.text()}`);
  const info = await infoRes.json();
  const filePath = info.result.file_path;

  const fileRes = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`);
  if (!fileRes.ok) throw new Error(`Telegram file download failed: ${fileRes.status}`);

  return { buffer: await fileRes.arrayBuffer(), filename: filePath.split("/").pop() };
}
