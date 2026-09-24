// ═══════════════════════════════════════════════════════════════
// 🤖 DeepSeek AI Plugin
// ═══════════════════════════════════════════════════════════════
// 📌 𝑷𝑹𝑶𝑻𝑶𝑻𝒀𝑷𝑬
// 📢 https://whatsapp.com/channel/0029VbDPydu5kg7EarEXXg3e
// ═══════════════════════════════════════════════════════════════
//
// 📝 الإعداد:
//
// 1️⃣ التوكن (Token):
//    • افتح chat.deepseek.com وسجّل دخول
//    • اضغط F12 لفتح Developer Tools
//    • اذهب إلى Console واكتب:
//      copy(JSON.parse(localStorage.getItem('userToken')).value)
//    • التوكن اتنسخ تلقائياً
//
// 2️⃣ Device ID:
//    • في نفس الـ Console واكتب:
//      copy(localStorage.getItem('deepseek-device-id:chat'))
//    • القيمة اتنسخت تلقائياً
//
// 3️⃣ HIF LEIM:
//
//    •
//    • ابحث عن الطلب: /api/v0/chat/completion
//    • انسخ قيمة header: x-hif-leim
//
// 4️⃣ بعد تجميع القيم:
//    • .ds-setup token <التوكن>
//    • .ds-setup device <device-id>
//    • .ds-setup hif <hif-leim>
//
// ═══════════════════════════════════════════════════════════════

import axios from 'axios'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = path.join(__dirname, 'deepseek-config.json')
const WASM_URL = 'https://fe-static.deepseek.com/chat/static/sha3_wasm_bg.7b9ca65ddd.wasm'

const defaultConfig = { token: '', device_id: '', hif_leim: '' }
let config = { ...defaultConfig }
try {
    if (fs.existsSync(CONFIG_PATH)) {
        config = { ...defaultConfig, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }
    } else {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 4))
    }
} catch (e) {
    console.error('[DeepSeek] Config error:', e.message)
}

let wasmPromise = null
function getWasm() {
    if (!wasmPromise) {
        wasmPromise = axios.get(WASM_URL, { responseType: 'arraybuffer', timeout: 30000 })
            .then(r => WebAssembly.compile(Buffer.from(r.data)))
            .then(m => WebAssembly.instantiate(m, { wbg: {} }))
            .catch(e => { wasmPromise = null; throw e })
    }
    return wasmPromise
}

async function solvePow(challenge) {
    const inst = await getWasm()
    const e = inst.exports
    const encoder = new TextEncoder()
    const cBytes = encoder.encode(challenge.challenge)
    const pBytes = encoder.encode(challenge.salt + '_' + challenge.expire_at + '_')
    const cP = e.__wbindgen_export_0(cBytes.length, 1) >>> 0
    const pP = e.__wbindgen_export_0(pBytes.length, 1) >>> 0
    new Uint8Array(e.memory.buffer).set(cBytes, cP)
    new Uint8Array(e.memory.buffer).set(pBytes, pP)
    const sp = e.__wbindgen_add_to_stack_pointer(-16)
    e.wasm_solve(sp, cP, cBytes.length, pP, pBytes.length, Number(challenge.difficulty))
    const dv = new DataView(e.memory.buffer)
    const answer = Math.floor(dv.getFloat64(sp + 8, true))
    e.__wbindgen_add_to_stack_pointer(16)
    return answer
}

function getHeaders(powBase64 = null) {
    const h = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
        'Authorization': 'Bearer ' + config.token,
        'Content-Type': 'application/json',
        'Accept': '*/*',
        'Origin': 'https://chat.deepseek.com',
        'Referer': 'https://chat.deepseek.com/',
        'x-client-bundle-id': 'com.deepseek.chat',
        'x-client-locale': 'en_US',
        'x-client-platform': 'web',
        'x-client-timezone-offset': '0',
        'x-client-version': '2.5.0',
        'x-device-id': config.device_id,
        'x-device-model': '',
        'x-hif-leim': config.hif_leim
    }
    if (powBase64) h['x-ds-pow-response'] = powBase64
    return h
}

async function createSession() {
    const r = await axios.post('https://chat.deepseek.com/api/v0/chat_session/create', {},
        { headers: getHeaders(), validateStatus: () => true, timeout: 30000 })
    return r.data?.data?.biz_data?.chat_session?.id
}

async function deleteSession(sessionId) {
    if (!sessionId) return
    try {
        await axios.post('https://chat.deepseek.com/api/v0/chat_session/delete',
            { chat_session_id: sessionId },
            { headers: getHeaders(), validateStatus: () => true, timeout: 15000 })
    } catch {}
}

async function sendMessage(question, sessionId, parentId) {
    const chalRes = await axios.post('https://chat.deepseek.com/api/v0/chat/create_pow_challenge',
        { target_path: '/api/v0/chat/completion' },
        { headers: getHeaders(), validateStatus: () => true, timeout: 30000 })
    const ch = chalRes.data?.data?.biz_data?.challenge
    if (!ch) throw new Error('فشل جلب PoW challenge')

    const answer = await solvePow(ch)
    const powBase64 = Buffer.from(JSON.stringify({
        algorithm: ch.algorithm, challenge: ch.challenge, salt: ch.salt,
        answer, signature: ch.signature, target_path: ch.target_path
    }), 'utf8').toString('base64')

    const body = {
        chat_session_id: sessionId,
        parent_message_id: parentId,
        model_type: 'default',
        prompt: question,
        ref_file_ids: [],
        thinking_enabled: false,
        search_enabled: false,
        action: null,
        preempt: false
    }

    const r = await axios.post('https://chat.deepseek.com/api/v0/chat/completion', body,
        { headers: getHeaders(powBase64), responseType: 'stream', timeout: 90000 })

    return await new Promise((resolve, reject) => {
        let full = ''
        r.data.on('data', c => { full += c.toString() })
        r.data.on('end', () => {
            let reply = '', responseId = null
            for (const line of full.split('\n')) {
                if (!line.startsWith('data: ')) continue
                try {
                    const j = JSON.parse(line.slice(6))
                    if (j.response_message_id) responseId = j.response_message_id
                    if (typeof j.v === 'string' && !j.p) reply += j.v
                } catch {}
            }
            resolve({ reply: reply.trim(), responseId })
        })
        r.data.on('error', reject)
        setTimeout(() => reject(new Error('Timeout')), 90000)
    })
}

const userSessions = new Map()

async function askDeepSeek(userId, question) {
    if (!config.token || !config.device_id || !config.hif_leim) {
        throw new Error('⚠️ لم يتم الإعداد. راجع التعليمات في أعلى الملف.')
    }

    let s = userSessions.get(userId)
    if (!s || !s.sessionId) {
        const sessionId = await createSession()
        if (!sessionId) throw new Error('فشل إنشاء المحادثة')
        s = { sessionId, parentId: null }
        userSessions.set(userId, s)
    }

    try {
        const { reply, responseId } = await sendMessage(question, s.sessionId, s.parentId)
        s.parentId = responseId
        return reply
    } catch (e) {
        await deleteSession(s.sessionId)
        userSessions.delete(userId)
        throw e
    }
}

let handler = async (m, { conn, text, usedPrefix, command }) => {
    if (!text) return m.reply(
        `🤖 *DeepSeek AI*\n\n` +
        `📝 *الاستخدام:*\n${usedPrefix}${command} <سؤالك>\n\n` +
        `🔧 *الأوامر:*\n` +
        `${usedPrefix}${command} reset - محادثة جديدة\n` +
        `${usedPrefix}${command} status - حالة الإعدادات`
    )

    const cmd = text.trim().toLowerCase()
    if (cmd === 'reset' || cmd === 'جديد') {
        const s = userSessions.get(m.sender)
        if (s) { await deleteSession(s.sessionId); userSessions.delete(m.sender) }
        return m.reply('✅ محادثة جديدة')
    }
    if (cmd === 'status' || cmd === 'حالة') {
        return m.reply(`🔧 *حالة DeepSeek*\n\n` +
            `Token: ${config.token ? '✅' : '❌'}\n` +
            `Device ID: ${config.device_id ? '✅' : '❌'}\n` +
            `HIF LEIM: ${config.hif_leim ? '✅' : '❌'}`)
    }

    await m.react('💭')
    const wait = await m.reply('🤔 *جاري التفكير...*')
    try {
        const reply = await askDeepSeek(m.sender, text.trim())
        try { await conn.sendMessage(m.chat, { delete: wait.key }) } catch {}
        await m.reply(`🤖 *DeepSeek:*\n\n${reply}`)
        await m.react('✅')
    } catch (e) {
        console.error('[DeepSeek]', e.message)
        try { await conn.sendMessage(m.chat, { delete: wait.key }) } catch {}
        await m.react('❌')
        m.reply('❌ ' + e.message)
    }
}

handler.help = ['deepseek <سؤال>']
handler.tags = ['ai']
handler.command = /^(deepseek|ds|دس|ديب)$/i

let setupHandler = async (m, { conn, text, usedPrefix, command }) => {
    if (!text) return m.reply(
        `🛠️ *إعداد DeepSeek*\n\n` +
        `استخدم أحد الأوامر:\n` +
        `${usedPrefix}${command} token <التوكن>\n` +
        `${usedPrefix}${command} device <device-id>\n` +
        `${usedPrefix}${command} hif <hif-leim>\n\n` +
        `📖 راجع التعليمات في أعلى ملف: deepseek.js`
    )

    const [key, ...rest] = text.trim().split(/\s+/)
    const value = rest.join(' ').trim()
    if (!value) return m.reply('❌ اكتب القيمة')

    const k = key.toLowerCase()

    if (k === 'token') config.token = value
    else if (k === 'device' || k === 'device_id') config.device_id = value
    else if (k === 'hif' || k === 'hif_leim') config.hif_leim = value
    else return m.reply('❌ مفتاح غير معروف. استخدم: token / device / hif')

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 4))
    m.reply(`✅ تم حفظ ${k}`)
}

setupHandler.help = ['ds-setup']
setupHandler.tags = ['ai']
setupHandler.command = /^(ds-setup|deepseek-setup|اعداد)$/i

export { setupHandler }
export default handler
