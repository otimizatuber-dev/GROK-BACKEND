```js
const express = require("express")
const axios = require("axios")
const cors = require("cors")
const mongoose = require("mongoose")

const app = express()

// 🔥 CORS CORRIGIDO (SEU ERRO DO LOVEABLE)
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

// ================= DATABASE =================
mongoose.connect(process.env.MONGO_URI)

const userSchema = new mongoose.Schema({
  email: String,
  credits: Number,
  lastReset: Number,
  planExpiresAt: Number
})

const User = mongoose.model("User", userSchema)

// ================= ANTI ABUSO =================
const userLastRequest = {}
const ipRequests = {}

function getIP(req) {
  return req.headers["x-forwarded-for"] || req.socket.remoteAddress
}

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

  if (ipRequests[ip].count > 30) return false

  ipRequests[ip].count++
  return true
}

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

// ================= GOOGLE TOKEN =================
async function verifyToken(token) {
  try {
    const res = await axios.get(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${token}`
    )
    return res.data
  } catch {
    return null
  }
}

// ================= RESET =================
function resetCredits(user) {
  const now = Date.now()
  if (!user.lastReset || now - user.lastReset > 86400000) {
    user.credits = DAILY_CREDITS
    user.lastReset = now
  }
}

// ================= API =================
app.post("/generate", async (req, res) => {
  const { token, prompt } = req.body
  const ip = getIP(req)

  if (!limitIP(ip)) {
    return res.status(429).send("Muitas requisições")
  }

  const data = await verifyToken(token)
  if (!data) return res.status(403).send("Token inválido")

  const email = data.email

  let user = await User.findOne({ email })

  if (!user) {
    user = await User.create({
      email,
      credits: DAILY_CREDITS,
      lastReset: Date.now(),
      planExpiresAt: Date.now() + 30 * 86400000
    })
  }

  if (Date.now() > user.planExpiresAt) {
    return res.status(403).send("Plano expirado")
  }

  resetCredits(user)

  if (!canRequest(email)) {
    return res.status(429).send("Aguarde 3 segundos")
  }

  if (user.credits < COST_PER_REQUEST) {
    return res.status(403).send("Sem créditos")
  }

  try {
    const response = await axios.post(
      "https://api.x.ai/v1/chat/completions",
      {
        model: "grok-4-fast-non-reasoning",
        max_tokens: MAX_TOKENS,
        messages: [{ role: "user", content: prompt }]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.API_KEY}`
        }
      }
    )

    user.credits -= COST_PER_REQUEST
    await user.save()

    res.json({
      reply: response.data.choices[0].message.content,
      creditsLeft: user.credits
    })

  } catch (err) {
    res.status(500).send("Erro na geração")
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log("rodando"))
```
