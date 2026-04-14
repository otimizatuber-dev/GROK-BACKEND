const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();

// ================= CORS =================
const corsOptions = {
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "apikey", "x-client-info"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json({ limit: "20mb" }));

// ================= CONFIG =================
const DAILY_CREDITS = 2000;
const COST_PER_REQUEST = 40;

// ================= ENV =================
const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  API_KEY,
  PORT = 8080,
} = process.env;

console.log("SUPABASE_URL:", SUPABASE_URL ? "OK" : "MISSING");
console.log("SUPABASE_SERVICE_ROLE_KEY:", SUPABASE_SERVICE_ROLE_KEY ? "OK" : "MISSING");
console.log("API_KEY:", API_KEY ? "OK" : "MISSING");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !API_KEY) {
  console.error("❌ ERRO: variáveis obrigatórias não configuradas.");
  process.exit(1);
}

// ================= CLIENT ADMIN =================
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

// ================= AUTH =================
async function verifySupabaseToken(rawToken) {
  const token = rawToken?.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    return { user: null, error: "missing_token" };
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data?.user) {
    console.error("Supabase auth error:", error?.message || "user_not_found");
    return { user: null, error: error?.message || "invalid_token" };
  }

  return { user: data.user, error: null };
}

// ================= MEMÓRIA =================
const users = {};
const userLastRequest = {};
const ipRequests = {};

// ================= UTIL =================
function getIP(req) {
  const forwarded = req.headers["x-forwarded-for"];

  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }

  return req.socket.remoteAddress || "unknown";
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
  const { token, prompt, duration, type } = req.body;
  const ip = getIP(req);

  if (!limitIP(ip)) {
    return res.status(429).json({ error: "Muitas requisições" });
  }

  const authToken = token || req.headers.authorization;
  const { user: userData, error: authError } = await verifySupabaseToken(authToken);

  if (!userData) {
    return res.status(403).json({
      error: "Token inválido",
      details: authError,
    });
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
    return res.status(429).json({ error: "Aguarde 3 segundos" });
  }

  if (user.credits < COST_PER_REQUEST) {
    return res.status(403).json({ error: "Sem créditos" });
  }

  if (!prompt || typeof prompt !== "string" || !prompt.trim() || prompt.length > 2000) {
    return res.status(400).json({ error: "Prompt inválido" });
  }

  try {
    let result;

    if (type === "video") {
      const response = await axios.post(
        "https://api.x.ai/v1/images/generations",
        {
          model: "grok-imagine-video",
          prompt: prompt.trim(),
          response_format: "url",
        },
        {
          headers: {
            Authorization: `Bearer ${API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );
      const url = response.data?.data?.[0]?.url;
      result = { url, creditsLeft: user.credits - COST_PER_REQUEST, duration: duration || 6, type: "video" };

    } else if (type === "image-pro") {
      const response = await axios.post(
        "https://api.x.ai/v1/images/generations",
        {
          model: "grok-imagine-image-pro",
          prompt: prompt.trim(),
          response_format: "url",
          n: 1,
        },
        {
          headers: {
            Authorization: `Bearer ${API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );
      const url = response.data?.data?.[0]?.url;
      result = { url, creditsLeft: user.credits - COST_PER_REQUEST, type: "image" };

    } else {
      const response = await axios.post(
        "https://api.x.ai/v1/images/generations",
        {
          model: "grok-imagine-image",
          prompt: prompt.trim(),
          response_format: "url",
          n: 1,
        },
        {
          headers: {
            Authorization: `Bearer ${API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );
      const url = response.data?.data?.[0]?.url;
      result = { url, creditsLeft: user.credits - COST_PER_REQUEST, type: "image" };
    }

    user.credits -= COST_PER_REQUEST;
    return res.json(result);

  } catch (err) {
    console.error("Grok error:", err?.response?.data || err.message);
    return res.status(err?.response?.status || 500).json({
      error: "Erro na geração",
      details: err?.response?.data || err.message,
    });
  }
});

// ================= START =================
app.listen(PORT, () => {
  console.log("🚀 rodando na porta " + PORT);
});
