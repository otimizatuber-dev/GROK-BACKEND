const express = require("express")
const axios = require("axios")
const cors = require("cors")
const jwt = require("jsonwebtoken")

const app = express()

// 🔥 CORS
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}))

app.use(express.json())

// ================= CONFIG =================
const DAILY_CREDITS = 2000
const COST_PER_REQUEST = 40
const MAX_TOKENS = 800

// ================= SUPABASE JWT =================
function verifySupabaseToken(token) {
  try {
    return jwt.verify(token, process.env.SUPABASE_JWT_SECRET)
  } catch {
    return null
  }
}

// ================= MEMÓRIA (SEM BANCO) =================
const users = {}
const userLastRequest = {}
const ipRequests = {}

// ================= UTIL =================
function getIP(req) {
  return req.headers["x-forwarded-for"] || req.socket.remoteAddress
}

// ================= ANTI IP SPAM =================
function limitIP(ip) {
  const now = Date.now()

  if (!ipRequests[ip]) {
    ipRequests[ip] = { count: 1, last: now }
    return true
  }

  if (now - ipRequests[ip].last > 60000) {
    ipRequests[ip] = { count: 1, last: now }
    return true
  }

  if (ipRequests[ip].count >= 30) return false

  ipRequests[ip].count++
  return true
}

// ================= RATE LIMIT USER =================
function canRequest(userId) {
  const now = Date.now()

  if (!userLastRequest[userId]) {
    userLastRequest[userId] = now
    return true
  }

  if (now - userLastRequest[userId] < 3000) return false

  userLastRequest[userId] = now
  return true
}

// ================= RESET CRÉDITOS =================
function resetCredits(user) {
  const now = Date.now()

  if (!user.lastReset || now - user.lastReset > 86400000) {
    user.credits = DAILY_CREDITS
    user.lastReset = now
  }
}

// ================= HEALTH CHECK =================
app.get("/", (req, res) => {
  res.send("Backend rodando 🚀")
})

// ================= MAIN API =================
app.post("/generate", async (req, res) => {
  const { token, prompt } = req.body
  const ip = getIP(req)

  // 🚫 IP LIMIT
  if (!limitIP(ip)) {
    return res.status(429).send("Muitas requisições")
  }

  // 🔐 SUPABASE TOKEN
  const data = verifySupabaseToken(token)
  if (!data) return res.status(403).send("Token inválido")

  const email = data.email || data.sub

  if (!email) {
    return res.status(403).send("Usuário inválido")
  }

  // 👤 cria usuário em memória
  if (!users[email]) {
    users[email] = {
      credits: DAILY_CREDITS,
      lastReset: Date.now()
    }
  }

  const user = users[email]

  resetCredits(user)

  // ⏳ rate limit
  if (!canRequest(email)) {
    return res.status(429).send("Aguarde 3 segundos")
  }

  // 💰 créditos
  if (user.credits < COST_PER_REQUEST) {
    return res.status(403).send("Sem créditos")
  }

  if (!prompt || prompt.length > 2000) {
    return res.status(400).send("Prompt inválido")
  }

  try {
    const response = await axios.post(
      "https://api.x.ai/v1/chat/completions",
      {
        model: "grok-4-fast-non-reasoning",
        max_tokens: MAX_TOKENS,
        messages: [
          { role: "user", content: prompt }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    )

    user.credits -= COST_PER_REQUEST

    res.json({
      reply: response.data.choices[0].message.content,
      creditsLeft: user.credits
    })

  } catch (err) {
    console.error(err)
    res.status(500).send("Erro na geração")
  }
})

// ================= START =================
const PORT = process.env.PORT || 8080

app.listen(PORT, () => {
  console.log("🚀 rodando na porta " + PORT)
})
