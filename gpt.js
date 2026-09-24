// plugins/gptfree.js
// ♡ Raiden Shogun - GPTFree AI

import axios from 'axios'

const API_KEY = 'AIzaSyBdU-Np8RSh1tPSsPOWg3qIm6PnVK5PQb4'
const BASE_URL = 'https://us-central1-gptfree-2.cloudfunctions.net/agent_stream'

let cachedToken = null
let cachedTokenExpiry = 0

async function getFirebaseToken() {
  if (cachedToken && Date.now() < cachedTokenExpiry) {
    return cachedToken
  }

  try {
    const res = await axios.post(
      `https://www.googleapis.com/identitytoolkit/v3/relyingparty/signupNewUser?key=${API_KEY}`,
      { returnSecureToken: true },
      {
        timeout: 30000,
        validateStatus: () => true,
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://gptfree.com',
          'Referer': 'https://gptfree.com/'
        }
      }
    )

    if (res.data?.idToken) {
      cachedToken = res.data.idToken
      cachedTokenExpiry = Date.now() + 3000000
      return cachedToken
    }
    return ''
  } catch {
    return ''
  }
}

function parseSSE(rawBody) {
  let answer = ""
  let event = ""

  for (const line of rawBody.split(/\r?\n/)) {
    const clean = line.trim()
    if (clean.startsWith("event:")) {
      event = clean.replace("event:", "").trim()
      continue
    }
    if (!clean.startsWith("data:")) continue

    const raw = clean.replace(/^data:\s*/, "").trim()
    if (!raw || raw === "[DONE]" || raw === "{}") continue

    try {
      const json = JSON.parse(raw)
      if (event === "result" && json.response) {
        answer = json.response
      }
    } catch {}
  }

  return answer.trim()
}

async function askGPTFree(prompt) {
  const token = await getFirebaseToken()
  if (!token) return { success: false, answer: "" }

  try {
    const res = await axios.post(BASE_URL,
      { message: prompt },
      {
        timeout: 120000,
        responseType: "stream",
        validateStatus: () => true,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36',
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'Authorization': `Bearer ${token}`,
          'Origin': 'https://gptfree.com',
          'Referer': 'https://gptfree.com/'
        }
      }
    )

    let rawBody = ""
    res.data.setEncoding("utf8")
    res.data.on("data", (chunk) => { rawBody += chunk })

    return await new Promise((resolve) => {
      res.data.on("end", () => {
        const answer = parseSSE(rawBody)
        resolve({ success: Boolean(answer), answer })
      })
      res.data.on("error", () => resolve({ success: false, answer: "" }))
    })
  } catch {
    return { success: false, answer: "" }
  }
}

async function splitAndSend(conn, chat, text, quoted) {
  const MAX_LENGTH = 4000
  if (text.length <= MAX_LENGTH) {
    return conn.sendMessage(chat, { text }, { quoted })
  }
  const parts = []
  let remaining = text
  while (remaining.length > 0) {
    let chunk = remaining.slice(0, MAX_LENGTH)
    const lastNewline = chunk.lastIndexOf('\n')
    if (lastNewline > MAX_LENGTH / 2) chunk = chunk.slice(0, lastNewline)
    parts.push(chunk)
    remaining = remaining.slice(chunk.length)
  }
  for (let i = 0; i < parts.length; i++) {
    const header = parts.length > 1 ? `📄 *جزء ${i + 1}/${parts.length}*\n\n` : ''
    await conn.sendMessage(chat, { text: header + parts[i] }, { quoted: i === 0 ? quoted : null })
  }
}

let handler = async (m, { conn, text, usedPrefix, command }) => {
  if (!text) return m.reply(`🤖 *GPTFree AI*\n\n📌 ${usedPrefix + command} <سؤال>`)
  await m.react('⏳')
  try {
    const result = await askGPTFree(text)
    if (!result.success || !result.answer) {
      await m.react('❌')
      return m.reply('❌ فشل الرد من AI')
    }
    await m.react('✅')
    await splitAndSend(conn, m.chat, result.answer, m)
  } catch (e) {
    await m.react('❌')
    await m.reply(`❌ خطأ: ${e.message}`)
  }
}

handler.help = ['gptfree', 'gpt', 'شات']
handler.tags = ['ai']
handler.command = /^(جبتي|شات|ai)$/i

export default handler

