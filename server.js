const express = require("express")
const axios = require("axios")
const cors = require("cors")

const app = express()

// 🔓 CORS (ajuste seu domínio depois)
app.use(cors({
  origin: "*"
}))

// 📦 JSON body
app.use(express.json())

// =============================
// 🔥 CONFIGURAÇÕES
// =============================
const DAILY_CREDITS = 2000
const COST_PER_REQUEST = 40
const MAX_TOKENS = 800

// =============================
// 🧠 MEMÓRIA SIMPLES (RAM)
// =============================
const users = {}
const userLastRequest = {}
const ipRequests = {}

// =============================
// 🌐 UTIL: PEGAR IP
// =============================
function getClientIP(req) {
  return (
    req.headers["x-forwarded-for"] ||
    req.socket.remoteAddress ||
    "unknown"
  )
}

// =============================
// 🚫 LIMITE POR IP
// =============================
function limitByIP(ip) {
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

// =============================
// 🔐 VERIFICAR TOKEN GOOGLE
// =============================
async function verifyGoogleToken(token) {
  try {
    const res = await axios.get(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${token}`
    )
    return res.data
  } catch (err) {
    return null
  }
}

// =============================
// 💰 RESET DE CRÉDITOS
// =============================
function checkAndResetCredits(user) {
  const now = Date.now()

  if (!user.lastReset || now - user.lastReset > 86400000) {
    user.credits = DAILY_CREDITS
    user.lastReset = now
  }
}

// =============================
// ⏳ RATE LIMIT POR USUÁRIO
// =============================
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

// =============================
// 🟢 HEALTH CHECK
// =============================
app.get("/", (req, res) => {
  res.send("Backend rodando 🚀")
})

// =============================
// 🚀 ENDPOINT PRINCIPAL
// =============================
app.post("/generate", async (req, res) => {
  const { token, prompt } = req.body

  const ip = getClientIP(req)

  // 🚫 limite IP
  if (!limitByIP(ip)) {
    return res.status(429).json({ error: "Muitas requisições" })
  }

  // 🔐 token obrigatório
  if (!token) {
    return res.status(401).json({ error: "Token ausente" })
  }

  const userData = await verifyGoogleToken(token)

  if (!userData || !userData.email) {
    return res.status(403).json({ error: "Token inválido" })
  }

  const userId = userData.email

  // 👤 cria usuário se não existir
  if (!users[userId]) {
    users[userId] = {
      credits: DAILY_CREDITS,
      lastReset: Date.now(),
      planExpiresAt: Date.now() + 30 * 86400000
    }
  }

  const user = users[userId]

  // ⛔ plano expirado
  if (Date.now() > user.planExpiresAt) {
    return res.status(403).json({ error: "Plano expirado" })
  }

  checkAndResetCredits(user)

  // ⏳ cooldown
  if (!canRequest(userId)) {
    return res.status(429).json({ error: "Aguarde 3 segundos" })
  }

  // 💰 créditos
  if (user.credits < COST_PER_REQUEST) {
    return res.status(403).json({ error: "Sem créditos" })
  }

  // ✍️ valida prompt
  if (!prompt || prompt.length > 2000) {
    return res.status(400).json({ error: "Prompt inválido" })
  }

  try {
    // 🤖 chamada IA (Grok API)
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

    res.status(500).json({
      error: "Erro na geração"
    })
  }
})

// =============================
// 🌐 START SERVER
// =============================
const PORT = process.env.PORT || 8080

app.listen(PORT, () => {
  console.log("🚀 rodando na porta " + PORT)
})
