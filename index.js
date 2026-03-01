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
- If asked about anything unrelated to PW, politely say you only help with PW stuff
`;
}

const MODELS = [
  "stepfun/step-3.5-flash:free",
  "arcee-ai/trinity-large-preview:free",
  "nvidia/nemotron-3-nano-30b-a3b:free",
  "upstage/solar-pro-3:free",
  "liquid/lfm-2.5-1.2b-thinking:free",
  // "nvidia/nemotron-3-nano-30b-a3b:free",
];
const ADMIN_PASS = process.env.ADMIN_PASS || "admin123";
const logs = [];
const MAX_LOGS = 200;

// SSE clients — { sessionId -> res }
const studentClients = {};  // student SSE connections
const adminClients = [];    // admin SSE connections

// Takeover state — set of sessionIds under admin control
const takenOver = new Set();

// Pending admin replies — sessionId -> resolve function
const pendingReplies = {};

// ── SSE: Student listens for admin messages ──
app.get("/sse/student/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  studentClients[sessionId] = res;
  console.log(`📡 Student connected: ${sessionId}`);

  // Send takeover status immediately on connect
  if (takenOver.has(sessionId)) {
    res.write(`data: ${JSON.stringify({ type: "takeover", active: true })}\n\n`);
  }

  req.on("close", () => {
    delete studentClients[sessionId];
    console.log(`📴 Student disconnected: ${sessionId}`);
  });
});

// ── SSE: Admin listens for new messages ──
app.get("/sse/admin", (req, res) => {
  const pass = req.query.pass;
  if (pass !== ADMIN_PASS) return res.status(403).send("Unauthorized");

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  adminClients.push(res);
  console.log("🛡️ Admin SSE connected");

  // Send current takeover list
  res.write(`data: ${JSON.stringify({ type: "init", takenOver: [...takenOver], logs: logs.slice(0, 50) })}\n\n`);

  req.on("close", () => {
    const idx = adminClients.indexOf(res);
    if (idx > -1) adminClients.splice(idx, 1);
  });
});

// Helper — broadcast to all admins
function notifyAdmins(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  adminClients.forEach(c => c.write(msg));
}

// Helper — send to specific student
function notifyStudent(sessionId, data) {
  const client = studentClients[sessionId];
  if (client) client.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ── Admin: Toggle takeover for a session ──
app.post("/admin/takeover", (req, res) => {
  const { pass, sessionId, active } = req.body;
  if (pass !== ADMIN_PASS) return res.status(403).json({ error: "Unauthorized" });

  if (active) {
    takenOver.add(sessionId);
    notifyStudent(sessionId, { type: "takeover", active: true });
    console.log(`🎮 Admin took over: ${sessionId}`);
  } else {
    takenOver.delete(sessionId);
    notifyStudent(sessionId, { type: "takeover", active: false });
    // Resolve any pending reply with null to let AI handle
    if (pendingReplies[sessionId]) {
      pendingReplies[sessionId](null);
      delete pendingReplies[sessionId];
    }
    console.log(`🤖 AI restored: ${sessionId}`);
  }

  notifyAdmins({ type: "takeover_update", sessionId, active });
  res.json({ ok: true });
});

// ── Admin: Send message to student ──
app.post("/admin/send", (req, res) => {
  const { pass, sessionId, message } = req.body;
  if (pass !== ADMIN_PASS) return res.status(403).json({ error: "Unauthorized" });

  notifyStudent(sessionId, { type: "admin_message", message });

  // Resolve pending reply if waiting
  if (pendingReplies[sessionId]) {
    pendingReplies[sessionId](message);
    delete pendingReplies[sessionId];
  }

  // Log it
  logs.unshift({
    time: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
    sessionId,
    ip: "admin",
    userMsg: "— (admin reply)",
    botReply: message,
    model: "👤 ADMIN",
    isAdmin: true,
  });

  console.log(`💬 Admin → ${sessionId}: "${message}"`);
  res.json({ ok: true });
});

// ── Chat endpoint ──
app.post("/chat", async (req, res) => {
  const { history, sessionId } = req.body;
  const userMsg = history[history.length - 1]?.content || "";
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  const ist = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  console.log(`📨 [${ist}] ${sessionId?.slice(0,8)} | "${userMsg}"`);

  // Notify admins of new message
  notifyAdmins({
    type: "new_message",
    sessionId,
    ip,
    time: ist,
    userMsg,
    takenOver: takenOver.has(sessionId),
  });

  // If admin has taken over, wait for admin reply (max 30s)
  if (takenOver.has(sessionId)) {
    console.log(`⏳ Waiting for admin reply for ${sessionId}...`);
    const adminReply = await new Promise((resolve) => {
      pendingReplies[sessionId] = resolve;
      setTimeout(() => {
        if (pendingReplies[sessionId]) {
          delete pendingReplies[sessionId];
          resolve(null); // timeout — fall through to AI
        }
      }, 30000);
    });

    if (adminReply) {
      logs.unshift({ time: ist, sessionId, ip, userMsg, botReply: adminReply, model: "👤 ADMIN", isAdmin: true });
      if (logs.length > MAX_LOGS) logs.pop();
      return res.json({ reply: adminReply });
    }
    // If admin didn't reply in time, fall through to AI
  }

  // AI reply
  const messages = [
    { role: "system", content: `${brain}\n\nIMPORTANT: Reply in 1-3 lines only. Be friendly and short. If you want to send the channel link write [SEND_CHANNEL_LINK] on a new line at the end.` },
    ...history,
  ];

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

      logs.unshift({ time: ist, sessionId, ip, userMsg, botReply: reply.replace("[SEND_CHANNEL_LINK]", "").trim(), model });
      if (logs.length > MAX_LOGS) logs.pop();

      // Notify admins of bot reply
      notifyAdmins({ type: "bot_reply", sessionId, reply: reply.replace("[SEND_CHANNEL_LINK]", "").trim(), model });

      return res.json({ reply });
    } catch (err) {
      console.warn(`❌ ${model}: ${err.message}`);
      lastError = err;
    }
  }

  res.status(500).json({ error: "All models failed" });
});

// ── Admin dashboard ──
app.get("/logs", (req, res) => {
  const pass = req.query.pass;
  if (pass !== ADMIN_PASS) {
    return res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
    <title>Admin Login</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:sans-serif;background:#0f1923;min-height:100vh;display:flex;align-items:center;justify-content:center}
    .box{background:#1a2632;padding:40px;border-radius:16px;text-align:center;width:90%;max-width:360px}
    h2{color:#00a884;margin-bottom:8px;font-size:22px}p{color:#8696a0;margin-bottom:24px;font-size:14px}
    input{width:100%;padding:12px 16px;border-radius:10px;border:1.5px solid #2d3f4e;background:#0f1923;color:#fff;font-size:15px;margin-bottom:14px;outline:none}
    input:focus{border-color:#00a884}
    button{width:100%;padding:13px;background:#00a884;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer}
    button:hover{background:#008069}</style></head>
    <body><div class="box"><h2>🛡️ Admin Panel</h2><p>Coupon Lelo Dashboard</p>
    <form onsubmit="location.href='/logs?pass='+document.getElementById('p').value;return false">
    <input id="p" type="password" placeholder="Enter password" autofocus/>
    <button type="submit">Login →</button></form></div></body></html>`);
  }
  res.sendFile(path.join(__dirname, "admin.html"));
});

// Serve admin panel data
app.get("/admin/data", (req, res) => {
  const pass = req.query.pass;
  if (pass !== ADMIN_PASS) return res.status(403).json({ error: "Unauthorized" });
  res.json({ logs: logs.slice(0, 100), takenOver: [...takenOver], onlineStudents: Object.keys(studentClients) });
});

app.get("/ping", (req, res) => res.send("ok"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server on port ${PORT}`));
