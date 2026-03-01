import "dotenv/config";
import fs from "fs";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Load brain
let brain;
try {
  brain = fs.readFileSync("./brain.txt", "utf-8");
  console.log("✅ brain.txt loaded");
} catch(e) {
  brain = process.env.BRAIN || `You are a friendly Physics Wallah (PW) coupon assistant called Coupon Lelo. Talk like a helpful Indian friend in Hinglish. Keep messages SHORT. Max 2-3 lines per reply.

COUPON CODES:
- Batch codes (give one randomly each time): SURSIN0002, RAHRAJ0001, PIYKUM0001
- Book/PW Store code: FTT200 (only on orders above Rs 500)

VISHWAS DIWAS OFFER:
- All batch prices drop by Rs 600-800 during Vishwas Diwas
- Coupon gives Rs 50 extra. Total saving = Rs 600-850

CHANNEL LINK:
- If someone asks for max discount or codes, add [SEND_CHANNEL_LINK] at end of reply

RULES:
- Talk in Hinglish, be friendly, 1-3 lines only
- Randomize between the 3 batch codes
- For books/modules always give FTT200
- If only Rs 50 complaint, tell about Vishwas Diwas
- Only help with PW stuff`;
  console.log("⚠️ Using default brain");
}

const MODELS = [
  "stepfun/step-3.5-flash:free",
  "google/gemini-2.0-flash-exp:free",
  "meta-llama/llama-4-scout:free",
  "mistralai/mistral-small-3.1-24b-instruct:free",
  "deepseek/deepseek-chat-v3-0324:free",
];

// Proxy endpoint — browser calls this, this calls OpenRouter
app.post("/chat", async (req, res) => {
  const { history } = req.body;

  const messages = [
    {
      role: "system",
      content: `${brain}\n\nIMPORTANT: Reply in 1-3 lines only. Be friendly and short. If you want to send the channel link write [SEND_CHANNEL_LINK] on a new line at the end.`,
    },
    ...history,
  ];

  console.log("📨 Incoming msg, trying models...");
  let lastError;
  for (const model of MODELS) {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, messages }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err?.error?.message || response.statusText);
      }

      const data = await response.json();
      const reply = data.choices[0].message.content.trim();
      console.log(`✅ ${model}`);
      return res.json({ reply });
    } catch (err) {
      console.warn(`❌ ${model}: ${err.message}`);
      lastError = err;
    }
  }

  res.status(500).json({ error: "All models failed: " + lastError?.message });
});

// Health check for UptimeRobot
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));