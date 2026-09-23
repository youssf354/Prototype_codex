import axios from 'axios'

const API = 'https://api.v02.savethevideo.com/tasks'
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
    'Content-Type': 'application/json',
    'Origin': 'https://www.savethevideo.com',
    'Referer': 'https://www.savethevideo.com/'
}

function formatSize(bytes) {
    if (!bytes) return '—'
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB'
    return (bytes / 1073741824).toFixed(2) + ' GB'
}

async function createTask(url) {
    const res = await axios.post(API, { type: 'info', url }, {
        headers: HEADERS,
        timeout: 30000,
        validateStatus: () => true
    })

    if (res.status === 429) throw new Error('⏱️ السيرفر مشغول - جرب تاني بعد شوية')
    if (res.status === 400) {
        const msg = res.data?.error?.message || res.data?.message || 'الرابط مش مدعوم'
        throw new Error(`❌ ${msg}`)
    }
    if (res.status === 410) throw new Error('❌ الرابط ده مش متاح أو انتهت صلاحيته')
    if (!res.data?.id) {
        const msg = res.data?.error?.message || res.data?.message || 'فشل إنشاء المهمة'
        throw new Error(`❌ ${msg}`)
    }
    return res.data.id
}

async function pollTask(taskId, maxAttempts = 100) {
    for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, 3000))

        try {
            const res = await axios.get(`${API}/${taskId}`, {
                headers: HEADERS,
                timeout: 15000,
                validateStatus: () => true
            })

            if (res.data?.state === 'completed') return res.data.result || res.data

            if (res.data?.state === 'failed') {
                const err = res.data.error
                const msg = err?.message || 'فشل التحميل'

                if (msg === 'Login required') throw new Error('🔒 الرابط ده محتاج تسجيل دخول')
                if (msg === 'Unknown error') throw new Error('❌ فشل تحميل الفيديو')
                if (/not supported|unsupported/i.test(msg)) throw new Error('❌ الموقع ده مش مدعوم')
                if (/private|restricted/i.test(msg)) throw new Error('🔒 الفيديو خاص أو محظور')
                throw new Error(`❌ ${msg}`)
            }
        } catch (e) {
            if (e.message.startsWith('❌') || e.message.startsWith('🔒') || e.message.startsWith('⏱️')) throw e
        }
    }
    throw new Error('⏱️ الفيديو كبير أو السيرفر بطيء - جرب رابط أصغر أو انتظر')
}

async function downloadBuffer(url) {
    const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 300000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        headers: {
            'User-Agent': HEADERS['User-Agent'],
            'Accept': '*/*',
            'Accept-Encoding': 'identity'
        }
    })
    return Buffer.from(res.data)
}

function selectBestFormat(video) {
    const formats = video.formats || [{ url: video.url, format_id: video.format_id || 'default', format: video.format }]
    if (!formats.length) return null

    // نرتب حسب الجودة: بندور على أفضل جودة موجودة
    const qualityOrder = ['2160', '1440', '1080', 'hd', '720', 'sd', '480', '360', '240']

    const sorted = [...formats].sort((a, b) => {
        const aQ = qualityOrder.findIndex(q => String(a.format_id || '').toLowerCase().includes(q) || String(a.format || '').toLowerCase().includes(q))
        const bQ = qualityOrder.findIndex(q => String(b.format_id || '').toLowerCase().includes(q) || String(b.format || '').toLowerCase().includes(q))
        const aScore = aQ === -1 ? 999 : aQ
        const bScore = bQ === -1 ? 999 : bQ
        return aScore - bScore
    })

    return sorted[0]
}

let handler = async (m, { conn, text, usedPrefix, command }) => {
    if (!text) {
        return m.reply(`📥 *تحميل فيديو*\n\n${usedPrefix}${command} <رابط الفيديو>\n\n💡 *مثال:*\n${usedPrefix}${command} https://www.facebook.com/watch/?v=...\n\n✅ *المواقع المدعومة:*\nFacebook, TikTok, Twitter/X, Instagram, Vimeo وغيرها`)
    }

    const url = text.trim()
    if (!/^https?:\/\//i.test(url)) {
        return m.reply('❌ لازم تبعت رابط صحيح (يبدأ بـ http)')
    }

    await m.react('⏳')
    const wait = await m.reply('🔍 *جاري فحص الرابط...*')

    try {
        const taskId = await createTask(url)
        await conn.sendMessage(m.chat, { text: '📥 *جاري تحضير الفيديو...*\n⏱️ ممكن ياخد دقيقة أو أكتر', edit: wait.key })

        const result = await pollTask(taskId)
        const videos = Array.isArray(result) ? result : [result]

        if (!videos.length) throw new Error('❌ ما فيش فيديو في الرابط ده')

        const video = videos[0]
        const title = video.title || 'فيديو'
        const best = selectBestFormat(video)

        if (!best?.url) throw new Error('❌ ما فيش روابط تحميل متاحة')

        await conn.sendMessage(m.chat, {
            text: `⬇️ *جاري التحميل...*\n\n📹 ${title.slice(0, 80)}\n🎬 الجودة: ${best.format_id || 'HD'}`,
            edit: wait.key
        })

        const buffer = await downloadBuffer(best.url)
        if (buffer.length < 5000) throw new Error('❌ الملف صغير جداً')

        try { await conn.sendMessage(m.chat, { delete: wait.key }) } catch {}

        await conn.sendMessage(m.chat, {
            video: buffer,
            mimetype: 'video/mp4',
            caption: `✅ *${title.slice(0, 100)}*\n\n🎬 *الجودة:* ${best.format_id || 'HD'}\n📦 *الحجم:* ${formatSize(buffer.length)}\n\n✧ 2B`
        }, { quoted: m })

        await m.react('✅')
    } catch (e) {
        console.error('[SaveTheVideo]', e.message)
        try { await conn.sendMessage(m.chat, { delete: wait.key }) } catch {}
        await m.react('❌')
        m.reply(e.message)
    }
}

handler.help = ['تحميل_فيديو <رابط>']
handler.tags = ['downloader']
handler.command = /^(تحميل|savethevideo|stv|sv)$/i

export default handler
