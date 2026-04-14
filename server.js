const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(cors({ origin: "*" }));
app.use(express.json());

// ================= CONFIG =================
const DAILY_CREDITS = 2000;

const COST = {
  text: 0,     // 🔥 grátis
  image: 0,    // 🔥 grátis
  video: 40,   // 💰 pago
};

const MAX_TOKENS = 800;

// ================= SUPABASE =================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ================= AUTH =================
async function verifyToken(token) {
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) return null;

  return data.user;
}

// ================= MEMORY =================
const users = {};
const lastRequest = {};
const ipCount = {};

// ================= UTIL =================
function getIP(req) {
  return req.headers["x-forwarded-for"] || req.socket.remoteAddress;
}

// ================= RATE LIMIT IP =================
function limitIP(ip) {
  const now = Date.now();

  if (!ipCount[ip]) {
    ipCount[ip] = { count: 1, last: now };
    return true;
  }

  if (now - ipCount[ip].last > 60000) {
    ipCount[ip] = { count: 1, last: now };
    return true;
  }

  if (ipCount[ip].count > 30) return false;

  ipCount[ip].count++;
  return true;
}

// ================= RATE LIMIT USER =================
function limitUser(userId) {
  const now = Date.now();

  if (!lastRequest[userId]) {
    lastRequest[userId] = now;
    return true;
  }

  if (now - lastRequest[userId] < 3000) return false;

  lastRequest[userId] = now;
  return true;
}

// ================= RESET CREDITS =================
function reset(user) {
  const now = Date.now();

  if (!user.lastReset || now - user.lastReset > 86400000) {
    user.credits = DAILY_CREDITS;
    user.lastReset = now;
  }
}

// ================= HEALTH =================
app.get("/", (req, res) => {
  res.json({ ok: true });
});

// ================= MAIN =================
app.post("/generate", async (req, res) => {
  const { token, prompt, type } = req.body;

  const ip = getIP(req);

  if (!limitIP(ip)) {
    return res.status(429).send("Muitas requisições");
  }

  const userData = await verifyToken(token);

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

  reset(user);

  if (!limitUser(userId)) {
    return res.status(429).send("Aguarde 3 segundos");
  }

  const cost = COST[type] ?? 0;

  if (user.credits < cost) {
    return res.status(403).send("Sem créditos");
  }

  if (!prompt) {
    return res.status(400).send("Prompt inválido");
  }

  try {
    let result;

    // ================= TEXT (GRÁTIS) =================
    if (!type || type === "text") {
      const r = await axios.post(
        "https://api.x.ai/v1/chat/completions",
        {
          model: "grok-3",
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

      result = { text: r.data.choices[0].message.content };
    }

    // ================= IMAGE (GRÁTIS) =================
    if (type === "image") {
      const r = await axios.post(
        "https://api.x.ai/v1/images/generations",
        {
          model: "grok-2-image",
          prompt,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.API_KEY}`,
          },
        }
      );

      result = { url: r.data?.data?.[0]?.url };
    }

    // ================= VIDEO (40 CREDITS) =================
    if (type === "video") {
      const r = await axios.post(
        "https://api.x.ai/v1/videos/generations",
        {
          model: "grok-imagine-video",
          prompt,
          response_format: "url",
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.API_KEY}`,
          },
        }
      );

      result = { url: r.data?.data?.[0]?.url };
    }

    user.credits -= cost;

    return res.json({
      ...result,
      type,
      creditsLeft: user.credits,
    });
  } catch (err) {
    console.error(err?.response?.data || err.message);
    return res.status(500).send("Erro na geração");
  }
});

// ================= START =================
const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log("🚀 rodando na porta " + PORT);
});
