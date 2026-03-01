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
  brain = process.env.BRAIN || `You are a friendly Physics Wallah (PW) customer support assistant. You talk like a helpful Indian friend in Hinglish (mix of Hindi and English). Keep messages SHORT and natural. Never send long paragraphs. Max 2-3 lines per reply.
- Note: always If you see any message like pw webiste coupon code or any new message first time from a user send a "seperate" message saying "Bolo bhai kya chaheye???"
- Note : If anyone ask coupon code or discount for lakshya send them ABHSIN0002 and this link https://youtu.be/0uxmUcr4f_Y?si=X6MF_pnGtsAHqawJ
- Note :  For RTS or Real Test series if anyone ask give them FCT100 , and told them to apply from test series option not from search bar in pw app

=== COUPON CODES ===
- Batch coupon codes (randomly give one): SAMNA00001, RAHRAJ0001, PIYKUM0001, ABHSIN0002
- Book / PW Store coupon code: FTT200 (works on orders above ₹500 only)

=== VISHWAS DIWAS OFFER ===
- During Vishwas Diwas, all batch prices drop by ₹600-800
- On top of that, coupon gives ₹50 extra discount
- Total saving = ₹600-850

- If someone msg like pw webiste coupon code , then reply him short "Apko Kisi Bhi Taraha ka Doubt hai Aap Mere Se Puch skte ho 💯

Coupon kaise lagana hai, Batch kaise lena hai , Koi bhi doubt ho msg krna 

Batch lene k baad ppt kaise dekhna hai class kaise Krna koi bhi doubt hai msg krna

Free of Cost ♥️"

=== CHANNEL LINK ===
- If someone asks for max discount or coupon codes, also send this in a SEPARATE message:
  "Sb Codes yaha se Lelo Maximum Hai 👇👇👇🔥
  https://whatsapp.com/channel/0029Vb2MYEqBA1f44sSAdY2G"

=== TONE & RULES ===
- Talk like a friend, use Hinglish
- Keep replies short (1-3 lines max)
- For any new/unknown message say: "Koi bhi help chahiye pehle mujhse puchna 😊"
- If someone says thanks, say you're always available
- If someone says coupon is only ₹50 or wants more discount, tell them about Vishwas Diwas
- Never make up codes or offers not listed above
- If asked about anything unrelated to PW, politely say you only help with PW stuff`;
  console.log("⚠️ Using default brain");
}

const MODELS = [
  "stepfun/step-3.5-flash:free",
  "arcee-ai/trinity-large-preview:free",
  "nvidia/nemotron-3-nano-30b-a3b:free",
  "upstage/solar-pro-3:free",
  "liquid/lfm-2.5-1.2b-thinking:free",
  // "nvidia/nemotron-3-nano-30b-a3b:free",
];

// === In-memory logs store ===
const logs = []; // { time, userMsg, botReply, ip, sessionId }
const MAX_LOGS = 200;

// === Admin password (set in env or default) ===
const ADMIN_PASS = process.env.ADMIN_PASS || "admin123";

// Chat endpoint
app.post("/chat", async (req, res) => {
  const { history, sessionId } = req.body;
  const userMsg = history[history.length - 1]?.content || "";
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

  const messages = [
    {
      role: "system",
      content: `${brain}\n\nIMPORTANT: Reply in 1-3 lines only. Be friendly and short. If you want to send the channel link write [SEND_CHANNEL_LINK] on a new line at the end.`,
    },
    ...history,
  ];

  console.log(`📨 [${new Date().toLocaleTimeString()}] IP:${ip} | "${userMsg}"`);

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
      console.log(`✅ ${model} → "${reply.slice(0,60)}..."`);

      // Save to logs
      logs.unshift({
        time: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        sessionId: sessionId || "unknown",
        ip,
        userMsg,
        botReply: reply.replace("[SEND_CHANNEL_LINK]", "").trim(),
        model,
      });
      if (logs.length > MAX_LOGS) logs.pop();

      return res.json({ reply });
    } catch (err) {
      console.warn(`❌ ${model}: ${err.message}`);
      lastError = err;
    }
  }

  res.status(500).json({ error: "All models failed: " + lastError?.message });
});

// Admin logs page
app.get("/logs", (req, res) => {
  const pass = req.query.pass;
  if (pass !== ADMIN_PASS) {
    return res.send(`
      <html><body style="font-family:sans-serif;padding:40px;background:#111;color:#fff">
        <h2>🔐 Admin Login</h2>
        <form onsubmit="location.href='/logs?pass='+document.getElementById('p').value;return false">
          <input id="p" type="password" placeholder="Password" style="padding:10px;font-size:16px;border-radius:8px;border:none;margin-right:10px"/>
          <button type="submit" style="padding:10px 20px;background:#00a884;color:#fff;border:none;border-radius:8px;font-size:16px;cursor:pointer">Login</button>
        </form>
      </body></html>
    `);
  }

  const rows = logs.map(l => `
    <tr>
      <td>${l.time}</td>
      <td><code style="background:#e8f5e9;padding:2px 6px;border-radius:4px">${l.sessionId.slice(0,8)}</code></td>
      <td>${l.ip}</td>
      <td style="color:#1a1a1a;font-weight:500">${l.userMsg}</td>
      <td style="color:#00695c">${l.botReply.slice(0,120)}${l.botReply.length>120?'...':''}</td>
      <td style="color:#888;font-size:11px">${l.model.split('/')[1]?.split(':')[0] || l.model}</td>
    </tr>
  `).join('');

  res.send(`
    <html>
    <head>
      <title>Coupon Lelo — Logs</title>
      <meta charset="UTF-8"/>
      <style>
        body { font-family: sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
        h2 { color: #00a884; margin-bottom: 16px; }
        .stats { display:flex; gap:16px; margin-bottom:20px; }
        .stat { background:#fff; padding:16px 24px; border-radius:12px; box-shadow:0 2px 8px rgba(0,0,0,0.08); }
        .stat .n { font-size:28px; font-weight:700; color:#00a884; }
        .stat .l { font-size:13px; color:#888; }
        table { width:100%; border-collapse:collapse; background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.08); }
        th { background:#00a884; color:#fff; padding:12px 14px; text-align:left; font-size:13px; }
        td { padding:11px 14px; border-bottom:1px solid #f0f0f0; font-size:13.5px; vertical-align:top; }
        tr:hover td { background:#f9fff9; }
        .refresh { float:right; background:#00a884; color:#fff; border:none; padding:8px 16px; border-radius:8px; cursor:pointer; font-size:13px; }
      </style>
    </head>
    <body>
      <h2>🎟️ Coupon Lelo — Admin Logs</h2>
      <div class="stats">
        <div class="stat"><div class="n">${logs.length}</div><div class="l">Total Chats</div></div>
        <div class="stat"><div class="n">${new Set(logs.map(l=>l.sessionId)).size}</div><div class="l">Unique Users</div></div>
        <div class="stat"><div class="n">${logs[0]?.time || 'N/A'}</div><div class="l">Last Chat</div></div>
      </div>
      <button class="refresh" onclick="location.reload()">🔄 Refresh</button>
      <table>
        <thead><tr><th>Time (IST)</th><th>Session</th><th>IP</th><th>User Asked</th><th>Bot Replied</th><th>Model</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#888;padding:40px">No chats yet</td></tr>'}</tbody>
      </table>
      <script>setTimeout(()=>location.reload(), 30000)</script>
    </body>
    </html>
  `);
});

// Health check
app.get("/ping", (req, res) => res.send("ok"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
