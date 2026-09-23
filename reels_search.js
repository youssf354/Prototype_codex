// plugins/ريلز.js
import axios from 'axios'
import { generateWAMessageFromContent, generateWAMessageContent, proto } from '@whiskeysockets/baileys'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36'
const CSE_CX = 'e500c3a7a523b49df'

async function searchReels(query, num = 6) {
    const js = await axios.get(`https://cse.google.com/cse.js?cx=${CSE_CX}`, {
        headers: { 'User-Agent': UA },
        timeout: 20000
    }).then(r => r.data)

    const tokenMatch = js.match(/"cse_token":\s*"([^"]+)"/)
    const cselibv = (js.match(/"cselibVersion":\s*"([^"]+)"/) || [])[1]
    if (!tokenMatch) throw new Error('فشل جلب توكن البحث')

    const token = tokenMatch[1]
    const url = `https://cse.google.com/cse/element/v1?rsz=filtered_cse&num=${num}&hl=en&source=gcsc&cselibv=${cselibv}&cx=${CSE_CX}&q=${encodeURIComponent(query)}&safe=off&cse_tok=${encodeURIComponent(token)}&filter=0&callback=cb&rurl=https%3A%2F%2Freelsfinder.satishyadav.com%2F`

    const r = await axios.get(url, {
        headers: {
            'User-Agent': UA,
            'Referer': 'https://reelsfinder.satishyadav.com/',
            'Origin': 'https://reelsfinder.satishyadav.com'
        },
        timeout: 25000,
        transformResponse: [d => d]
    })

    let t = String(r.data)
    t = t.replace(/^\/\*O_o\*\/\s*cb\(/, '').replace(/\);\s*$/, '')
    const j = JSON.parse(t)

    return (j.results || []).map(x => ({
        title: (x.title || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim(),
        url: x.url
    })).filter(x => x.url && x.url.includes('instagram.com'))
}

async function getVideoData(igUrl) {
    const api = `https://igexport.com/api/ig-reels/?url=${encodeURIComponent(igUrl)}&videoOnly=1`
    const r = await axios.get(api, {
        headers: {
            'User-Agent': UA,
            'Accept': 'application/json',
            'Referer': 'https://igexport.com/ar/video-download/',
            'Origin': 'https://igexport.com'
        },
        timeout: 30000
    })
    if (!r.data?.ok || !r.data?.media?.videoUrl) throw new Error('فشل جلب الفيديو')
    return r.data.media
}

async function downloadVideo(url) {
    const r = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 120000,
        maxContentLength: 100 * 1024 * 1024,
        headers: { 'User-Agent': UA, 'Accept': '*/*' }
    })
    return Buffer.from(r.data)
}

async function processItem(it, conn) {
    const media = await getVideoData(it.url)
    const buf = await downloadVideo(media.videoUrl)
    if (buf.length < 10000) throw new Error('صغير')
    const mediaMsg = await generateWAMessageContent(
        { video: buf, mimetype: 'video/mp4' },
        { upload: conn.waUploadToServer }
    )
    const title = (it.title || 'Instagram Reel').slice(0, 80)
    return {
        body: proto.Message.InteractiveMessage.Body.fromObject({ text: title }),
        footer: proto.Message.InteractiveMessage.Footer.fromObject({ text: '✧ 2B' }),
        header: proto.Message.InteractiveMessage.Header.fromObject({
            title: title.slice(0, 40),
            hasMediaAttachment: true,
            videoMessage: mediaMsg.videoMessage
        }),
        nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({ buttons: [] })
    }
}

async function parallelMap(items, fn, concurrency = 3) {
    const results = new Array(items.length).fill(null)
    let idx = 0
    const workers = Array.from({ length: concurrency }, async () => {
        while (true) {
            const i = idx++
            if (i >= items.length) break
            try {
                results[i] = await fn(items[i])
            } catch (e) {
                console.error('[card ' + i + ']', e.message)
                results[i] = null
            }
        }
    })
    await Promise.all(workers)
    return results.filter(Boolean)
}

let handler = async (m, { conn, text, usedPrefix, command }) => {
    if (!text) return m.reply(`🔍 *بحث ريلز إنستجرام*\n\n${usedPrefix}${command} <كلمة>\n\n💡 مثال:\n${usedPrefix}${command} anime edit`)

    await m.react('⏳')
    const wait = await m.reply('🔍 *جاري البحث...*')

    const updateStatus = async (txt) => {
        try { await conn.sendMessage(m.chat, { text: txt, edit: wait.key }) } catch {}
    }

    try {
        const items = await searchReels(text.trim(), 6)
        if (!items.length) throw new Error('مفيش نتايج')

        await updateStatus(`⬇️ *جاري تحميل ${items.length} فيديو...*`)

        let done = 0
        const cards = await parallelMap(items, async (it) => {
            const card = await processItem(it, conn)
            done++
            updateStatus(`⬇️ *جاري التحميل...*\n✅ ${done}/${items.length}`)
            return card
        }, 3)

        if (!cards.length) throw new Error('فشل تحميل الفيديوهات')

        const msg = generateWAMessageFromContent(m.chat, {
            viewOnceMessage: {
                message: {
                    messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
                    interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                        body: proto.Message.InteractiveMessage.Body.create({ text: `🔍 *${text}*` }),
                        footer: proto.Message.InteractiveMessage.Footer.create({ text: '✧ 2B' }),
                        header: proto.Message.InteractiveMessage.Header.create({ hasMediaAttachment: false }),
                        carouselMessage: proto.Message.InteractiveMessage.CarouselMessage.fromObject({ cards })
                    })
                }
            }
        }, { quoted: m })

        await conn.relayMessage(m.chat, msg.message, { messageId: msg.key.id })
        try { await conn.sendMessage(m.chat, { delete: wait.key }) } catch {}
        await m.react('✅')
    } catch (e) {
        console.error('[reels]', e.message)
        try { await conn.sendMessage(m.chat, { delete: wait.key }) } catch {}
        await m.react('❌')
        m.reply('❌ ' + e.message)
    }
}

handler.help = ['ريلز <كلمة>']
handler.tags = ['downloader']
handler.command = /^(ريلز|reels|reels_search)$/i

export default handler
