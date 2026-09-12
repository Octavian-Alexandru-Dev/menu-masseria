// Groq API calls: speech-to-text (Whisper) for voice notes, and tool-calling
// chat completion (Llama) to turn a staff member's free-text command into a
// structured action. Both are free-tier endpoints — see docs/telegram-bot.md
// for the rate limits this was sized against.

const STT_MODEL = "whisper-large-v3-turbo";
const CHAT_MODEL = "llama-3.3-70b-versatile";

export async function transcribeAudio(env, arrayBuffer, filename, mimeType) {
  const form = new FormData();
  form.append("file", new Blob([arrayBuffer], { type: mimeType }), filename);
  form.append("model", STT_MODEL);
  form.append("language", "it");
  form.append("response_format", "json");

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Groq transcription failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.text;
}

// `tools` follows the OpenAI-style function-calling schema Groq's chat API
// accepts. Returns the assistant message as-is ({ content, tool_calls }) —
// the caller (tools.js/index.js) decides what to do with each shape.
export async function chatCompletion(env, { systemPrompt, userText, tools }) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      temperature: 0.1, // low: this is intent parsing, not creative writing
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
      ],
      tools,
      tool_choice: "auto",
    }),
  });
  if (!res.ok) throw new Error(`Groq chat completion failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.choices[0].message;
}
