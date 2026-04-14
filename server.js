```js
const express = require("express")
const axios = require("axios")
const cors = require("cors")

const app = express()
app.use(express.json())
app.use(cors())

const DAILY_CREDITS = 2000
const COST_PER_REQUEST = 40
const MAX_TOKENS = 800

const users = {}
const userLastRequest = {}

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

function checkAndResetCredits(user) {
  const now = Date.now()
  if (!user.lastReset || now - user.lastReset > 86400000) {
    user.credits = DAILY_CREDITS
    user.lastReset = now
  }
}

app.post("/generate", async (req, res) => {
  const { userId, prompt } = req.body

  if (!users[userId]) {
    users[userId] = {
      credits: DAILY_CREDITS,
      lastReset: Date.now(),
      planExpiresAt: Date.now() + 30 * 86400000
    }
  }

  const user = users[userId]

  if (Date.now() > user.planExpiresAt) {
    return res.status(403).send("Plano expirado")
  }

  checkAndResetCredits(user)

  if (!canRequest(userId)) {
    return res.status(429).send("Aguarde 3 segundos")
  }

  if (user.credits < COST_PER_REQUEST) {
    return res.status(403).send("Sem créditos hoje")
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
          Authorization: `Bearer ${process.env.API_KEY}`
        }
      }
    )

    user.credits -= COST_PER_REQUEST

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
