const fs = require("fs");
const path = require("path");

loadEnvFromFile();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("Missing GEMINI_API_KEY. Set it in the environment or .env for local tests.");
  process.exit(1);
}

async function main() {
  const models = await listModels(apiKey);
  console.log(`Model count: ${models.length}`);
  console.log("First model:", models[0]);
  const model = process.env.SMOKE_MODEL || models
    .filter((item) => Array.isArray(item.supportedGenerationMethods) && item.supportedGenerationMethods.includes('generateContent'))
    .map((item) => String(item.name || '').replace(/^models\//, ''))
    .find(Boolean);
  if (!model) throw new Error('No generateContent model is available for this Gemini key.');

  const segments = [
    { id: "demo1", text: "Hello world, this is a Gemini translation smoke test." },
    { id: "demo2", text: "Translate this sentence into French while keeping punctuation." }
  ];

  const { detected_source_language, translations } = await translateSegments({
    apiKey,
    model,
    fromLang: "en",
    toLang: "vi",
    styleInstruction: "",
    segments
  });

  console.log("Detected language:", detected_source_language || "unknown");
  for (const t of translations) {
    console.log(`${t.id}: ${t.text}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

function loadEnvFromFile() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function listModels(key) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`List models failed: ${response.status}`);
  const data = await response.json();
  return data.models || [];
}

async function translateSegments({ apiKey, model, fromLang, toLang, styleInstruction, segments }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const system = [
    "You are a professional translation engine.",
    "You must return ONLY valid JSON that matches the provided schema.",
    "Do not add commentary. Do not wrap in markdown.",
    "Keep meaning, tone, and formatting (whitespace/punctuation) as close as possible.",
    "Do NOT translate code-like tokens, URLs, emails, product SKUs, or strings that look like identifiers.",
    styleInstruction ? `Extra style instruction: ${styleInstruction}` : ""
  ]
    .filter(Boolean)
    .join("\n");

  const responseSchema = {
    type: "OBJECT",
    properties: {
      detected_source_language: { type: "STRING" },
      translations: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            id: { type: "STRING" },
            text: { type: "STRING" }
          },
          required: ["id", "text"]
        }
      }
    },
    required: ["translations"]
  };

  const body = {
    systemInstruction: { role: "system", parts: [{ text: system }] },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: JSON.stringify({
              task: "translate_webpage_segments",
              source_language: fromLang || "auto",
              target_language: toLang,
              segments
            })
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      response_mime_type: "application/json",
      response_schema: responseSchema
    }
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Gemini API error ${response.status}: ${text.slice(0, 300)}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini response missing text");
  return JSON.parse(text);
}
