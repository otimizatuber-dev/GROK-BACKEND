const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();

// ================= CORS =================
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

// ================= CONFIG =================
const DAILY_CREDITS = 2000;
const COST_PER_REQUEST = 40;
const MAX_TOKENS = 800;

// ================= DEBUG =================
console.log("SUPABASE_URL:", process.env.SUPABASE_URL);
console.log(
  "SUPABASE_ANON_KEY:",
  process.env.SUPABASE_ANON_KEY ? "OK" : "MISSING"
);
console.log("API_KEY:", process.env.API_KEY ? "OK" : "MISSING");

// ================= VALIDAR ENV VARS =================
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ ERRO: variáveis do Supabase não configuradas!");
  process.exit(1);
}

// ================= CLIENT PUBLIC =================
const supabase = createClient(supabaseUrl, supabaseKey);

// ================= CLIENT ADMIN (NOVO - CORREÇÃO JWT) =================
const supabaseAdmin = createClient(
  supabaseUrl,
  supabaseServiceKey || supabaseKey
);

// ================= AUTH (CORRIGIDO) =================
async function verifySupabaseToken(token) {
  if (!token) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data?.user) {
    console.log("Auth error:", error?.message);
    return null;
  }

  return data.user;
}

// ================= MEMÓRIA =================
const users = {};
const userLastRequest = {};
const ipRequests = {};

// ================= UTIL =================
function getIP(req) {
  return req.headers["x-forwarded-for"] || req.socket.remoteAddress;
}

// ================= ANTI-SPAM IP =================
function limitIP(ip) {
  const now = Date.now();

  if (!ipRequests[ip]) {
    ipRequests[ip] = { count: 1, last: now };
    return true;
  }

  if (now - ipRequests[ip].last > 60000) {
    ipRequests[ip] = { count: 1, last: now };
    return true;
  }

  if (ipRequests[ip].count >= 30) return false;

  ipRequests[ip].count++;
  return true;
}

// ================= RATE LIMIT USER =================
function canRequest(userId) {
  const now = Date.now();

  if (!userLastRequest[userId]) {
    userLastRequest[userId] = now;
    return true;
  }

  if (now - userLastRequest[userId] < 3000) return false;

  userLastRequest[userId] = now;
  return true;
}

// ================= RESET CRÉDITOS =================
function resetCredits(user) {
  const now = Date.now();

  if (!user.lastReset || now - user.lastReset > 86400000) {
    user.credits = DAILY_CREDITS;
    user.lastReset = now;
  }
}

// ================= HEALTH CHECK =================
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Backend rodando 🚀" });
});

// ================= MAIN =================
app.post("/generate", async (req, res) => {
  const { token, prompt } = req.body;
  const ip = getIP(req);

  if (!limitIP(ip)) {
    return res.status(429).send("Muitas requisições");
  }

  const userData = await verifySupabaseToken(token);

  if (!userData) {
    return res.status(403).send("Token inválido");
  }

  const userId = userData.email || userData.id;

  if (!users[userId]) {
    users[userId] = {
      credits: DAILY_CREDITS,
      lastReset: Date.now(),
    };
  }

  const user = users[userId];

  resetCredits(user);

  if (!canRequest(userId)) {
    return res.status(429).send("Aguarde 3 segundos");
  }

  if (user.credits < COST_PER_REQUEST) {
    return res.status(403).send("Sem créditos");
  }

  if (!prompt || prompt.length > 2000) {
    return res.status(400).send("Prompt inválido");
  }

  try {
    const response = await axios.post(
      "https://api.x.ai/v1/chat/completions",
      {
        model: "grok-4-fast-non-reasoning",
        max_tokens: MAX_TOKENS,
        messages: [{ role: "user", content: prompt }],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    user.credits -= COST_PER_REQUEST;

    res.json({
      reply: response.data.choices[0].message.content,
      creditsLeft: user.credits,
    });
  } catch (err) {
    console.error("Grok error:", err?.response?.data || err.message);
    res.status(500).send("Erro na geração");
  }
});

// ================= START =================
const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log("🚀 rodando na porta " + PORT);
});
