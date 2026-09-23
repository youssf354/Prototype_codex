import axios from 'axios'
import sharp from 'sharp'
import { generateWAMessageFromContent, proto, prepareWAMessageMedia } from '@whiskeysockets/baileys'

const BASE = 'https://spotsaver.net'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36'

const HEADERS = {
    'User-Agent': UA,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': BASE,
    'Referer': BASE + '/spotify-track-downloader/'
}

async function fetchSpotify(query) {
    const isUrl = /^https?:\/\//i.test(query)
    const params = isUrl ? { url: query } : { q: query }
    const r = await axios.get(`${BASE}/api/spotify/`, {
        params, headers: HEADERS, timeout: 30000
    })
    return {
        type: r.data?.type || 'track',
        items: r.data?.items || []
    }
}

async function getVideoId(title, artist) {
    const r = await axios.post(`${BASE}/api/get-id/`, {
        title, artist
    }, {
        headers: { ...HEADERS, 'Content-Type': 'application/json' },
        timeout: 20000
    })
    if (!r.data?.success || !r.data?.videoId) throw new Error('ما لقيناش الأغنية على YouTube')
    return r.data.videoId
}

async function getDownloadUrl(videoId, title) {
    const r = await axios.post(`${BASE}/api/download/`, {
        videoId, candidateIds: [], format: 'mp3', title, licenseKey: null
    }, {
        headers: { ...HEADERS, 'Content-Type': 'application/json' },
        timeout: 40000
    })
    if (!r.data?.success || !r.data?.downloadUrl) throw new Error('فشل تجهيز الرابط')
    return r.data.downloadUrl
}

async function downloadAudio(url) {
    const res = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: { 'User-Agent': UA, 'Referer': BASE + '/' },
        timeout: 180000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
    })
    const buf = Buffer.from(res.data)
    if (buf.length < 5000) throw new Error('الملف صغير')
    return buf
}

async function getCover(url) {
    if (!url) return null
    try {
        const res = await axios.get(url, {
            responseType: 'arraybuffer',
            headers: { 'User-Agent': UA },
            timeout: 20000
        })
        const buf = Buffer.from(res.data)
        if (buf.length < 500) return null
        return await sharp(buf).jpeg({ quality: 90 }).toBuffer()
    } catch { return null }
}

function formatDuration(seconds) {
    if (!seconds) return '—'
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${String(s).padStart(2, '0')}`
}

function formatSize(bytes) {
    if (!bytes) return '—'
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / 1048576).toFixed(1) + ' MB'
}

async function downloadOne(conn, m, item) {
    await m.react('⏳')
    const wait = await m.reply(`🎵 *${item.title}*\n👤 ${item.artist}\n\n⏳ *جاري التحميل...*`)

    try {
        const videoId = await getVideoId(item.title, item.artist)
        const dlUrl = await getDownloadUrl(videoId, `${item.title} - ${item.artist}`)
        const audioBuffer = await downloadAudio(dlUrl)
        const cover = await getCover(item.thumbnail)

        try { await conn.sendMessage(m.chat, { delete: wait.key }) } catch {}

        let caption = `🎵 *${item.title}*\n`
        caption += `👤 *الفنان:* ${item.artist}\n`
        if (item.album) caption += `💿 *الألبوم:* ${item.album}\n`
        if (item.duration) caption += `⏱️ *المدة:* ${formatDuration(item.duration)}\n`
        caption += `📦 *الحجم:* ${formatSize(audioBuffer.length)}\n\n✧ 2B`

        if (cover) {
            await conn.sendMessage(m.chat, {
                image: cover,
                mimetype: 'image/jpeg',
                caption
            }, { quoted: m })
        } else {
            await m.reply(caption)
        }

        await conn.sendMessage(m.chat, {
            audio: audioBuffer,
            mimetype: 'audio/mpeg',
            fileName: `${item.title} - ${item.artist}.mp3`,
            ptt: false
        }, { quoted: m })

        await m.react('✅')
    } catch (e) {
        console.error('[Spotify DL]', e.message)
        try { await conn.sendMessage(m.chat, { delete: wait.key }) } catch {}
        await m.react('❌')
        m.reply('❌ ' + e.message)
    }
}

async function downloadMany(conn, m, items, title, type) {
    await m.react('⏳')
    const wait = await m.reply(`📦 *${title}*\n📊 *${items.length}* أغنية\n\n⏳ *جاري تجهيز ZIP...*`)

    try {
        const JSZip = (await import('jszip')).default
        const zip = new JSZip()
        let success = 0

        for (let i = 0; i < items.length; i++) {
            const item = items[i]
            try {
                await conn.sendMessage(m.chat, {
                    text: `📦 *${title}*\n\n⏳ جاري تحميل ${i + 1}/${items.length}\n🎵 ${item.title}`,
                    edit: wait.key
                })
                const videoId = await getVideoId(item.title, item.artist)
                const dlUrl = await getDownloadUrl(videoId, `${item.title} - ${item.artist}`)
                const buf = await downloadAudio(dlUrl)
                const safeName = `${String(i + 1).padStart(2, '0')} - ${item.title} - ${item.artist}.mp3`.replace(/[\/\\:*?"<>|]/g, '_').slice(0, 150)
                zip.file(safeName, buf)
                success++
            } catch (e) {
                console.error('Item failed:', item.title, e.message)
            }
            await new Promise(r => setTimeout(r, 1000))
        }

        if (!success) throw new Error('فشل تحميل كل الأغاني')

        const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' })
        const sizeMB = (buffer.length / 1048576).toFixed(2)
        const fileName = `${type}_${Date.now()}.zip`

        try { await conn.sendMessage(m.chat, { delete: wait.key }) } catch {}

        await conn.sendMessage(m.chat, {
            document: buffer,
            mimetype: 'application/zip',
            fileName,
            caption: `📦 *${title}*\n✅ *تم التحميل:* ${success}/${items.length}\n📁 *الحجم:* ${sizeMB} MB\n\n✧ 2B`
        }, { quoted: m })

        await m.react('✅')
    } catch (e) {
        console.error('[Spotify Bulk]', e.message)
        try { await conn.sendMessage(m.chat, { delete: wait.key }) } catch {}
        await m.react('❌')
        m.reply('❌ ' + e.message)
    }
}

const CACHE = new Map()
const CACHE_TTL = 10 * 60 * 1000

let handler = async (m, { conn, text, usedPrefix, command }) => {
    if (!text) {
        return m.reply(`🎵 *Spotify Downloader*\n\n` +
            `📌 *الاستخدام:*\n` +
            `• \`${usedPrefix}${command} <اسم الأغنية>\`\n` +
            `• \`${usedPrefix}${command} <رابط Spotify>\`\n\n` +
            `💡 *أمثلة:*\n` +
            `• \`${usedPrefix}${command} imagine dragons\`\n` +
            `• \`${usedPrefix}${command} عمرو دياب\`\n` +
            `• \`${usedPrefix}${command} https://open.spotify.com/track/...\``)
    }

    if (text.startsWith('dl_')) {
        const idx = parseInt(text.slice(3))
        const cache = CACHE.get(m.sender)
        if (!cache || !cache.items[idx]) {
            await m.react('❌')
            return m.reply('❌ انتهت صلاحية النتائج')
        }
        if (Date.now() - cache.time > CACHE_TTL) {
            CACHE.delete(m.sender)
            await m.react('❌')
            return m.reply('⏰ انتهت صلاحية النتائج')
        }
        return downloadOne(conn, m, cache.items[idx])
    }

    if (text.startsWith('all_')) {
        const cache = CACHE.get(m.sender)
        if (!cache || !cache.items.length) {
            await m.react('❌')
            return m.reply('❌ انتهت صلاحية النتائج')
        }
        return downloadMany(conn, m, cache.items, cache.title || 'Spotify', cache.type)
    }

    await m.react('🔍')
    try {
        const result = await fetchSpotify(text.trim())
        const items = result.items

        if (!items.length) {
            await m.react('❌')
            return m.reply('❌ مفيش نتايج')
        }

        if (result.type === 'track' && items.length === 1) {
            CACHE.set(m.sender, { items, type: 'track', time: Date.now() })
            return downloadOne(conn, m, items[0])
        }

        if (result.type === 'album' || result.type === 'playlist') {
            const title = result.type === 'album' ? 'الألبوم' : 'قائمة التشغيل'
            CACHE.set(m.sender, { items, type: result.type, title: text.slice(0, 50), time: Date.now() })

            const coverImg = await getCover(items[0].thumbnail)
            let header = { hasMediaAttachment: false }
            if (coverImg) {
                try {
                    const media = await prepareWAMessageMedia(
                        { image: coverImg, mimetype: 'image/jpeg' },
                        { upload: conn.waUploadToServer }
                    )
                    header = { hasMediaAttachment: true, imageMessage: media.imageMessage }
                } catch {}
            }

            const rows = [
                { title: `📦 تحميل الكل (${items.length})`, description: 'ZIP بكل الأغاني', id: `.${command} all_` },
                ...items.slice(0, 20).map((s, i) => ({
                    title: `${i + 1}. ${s.title}`,
                    description: `👤 ${s.artist}${s.duration ? ` | ⏱️ ${formatDuration(s.duration)}` : ''}`,
                    id: `.${command} dl_${i}`
                }))
            ]

            const msg = generateWAMessageFromContent(m.chat, {
                viewOnceMessage: {
                    message: {
                        interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                            body: proto.Message.InteractiveMessage.Body.create({
                                text: `📦 *${title}*\n📊 ${items.length} أغنية`
                            }),
                            footer: proto.Message.InteractiveMessage.Footer.create({ text: '✧ 2B' }),
                            header: proto.Message.InteractiveMessage.Header.fromObject(header),
                            nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
                                buttons: [{
                                    name: 'single_select',
                                    buttonParamsJson: JSON.stringify({
                                        title: '🎵 اختر أغنية',
                                        sections: [{ title: 'الخيارات', rows }]
                                    })
                                }],
                                messageParamsJson: ''
                            })
                        })
                    }
                }
            }, { userJid: conn.user.jid, quoted: m })

            await conn.relayMessage(m.chat, msg.message, { messageId: msg.key.id })
            await m.react('✅')
            return
        }

        const shown = items.slice(0, 10)
        CACHE.set(m.sender, { items: shown, type: 'search', title: text.slice(0, 50), time: Date.now() })

        const coverImg = await getCover(shown[0].thumbnail)
        let header = { hasMediaAttachment: false }
        if (coverImg) {
            try {
                const media = await prepareWAMessageMedia(
                    { image: coverImg, mimetype: 'image/jpeg' },
                    { upload: conn.waUploadToServer }
                )
                header = { hasMediaAttachment: true, imageMessage: media.imageMessage }
            } catch {}
        }

        const rows = shown.map((s, i) => ({
            title: `${i + 1}. ${s.title}`,
            description: `👤 ${s.artist}${s.album ? ` | 💿 ${s.album}` : ''}${s.duration ? ` | ⏱️ ${formatDuration(s.duration)}` : ''}`,
            id: `.${command} dl_${i}`
        }))

        const msg = generateWAMessageFromContent(m.chat, {
            viewOnceMessage: {
                message: {
                    interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                        body: proto.Message.InteractiveMessage.Body.create({
                            text: `🎵 *نتائج البحث: ${text.slice(0, 50)}*\n📊 ${shown.length} أغنية`
                        }),
                        footer: proto.Message.InteractiveMessage.Footer.create({ text: '✧ 2B' }),
                        header: proto.Message.InteractiveMessage.Header.fromObject(header),
                        nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
                            buttons: [{
                                name: 'single_select',
                                buttonParamsJson: JSON.stringify({
                                    title: '🎵 اختر الأغنية',
                                    sections: [{ title: 'النتائج', rows }]
                                })
                            }],
                            messageParamsJson: ''
                        })
                    })
                }
            }
        }, { userJid: conn.user.jid, quoted: m })

        await conn.relayMessage(m.chat, msg.message, { messageId: msg.key.id })
        await m.react('✅')
    } catch (e) {
        console.error('[Spotify Search]', e.message)
        await m.react('❌')
        m.reply('❌ ' + e.message)
    }
}

handler.help = ['سبوتيفاي <اسم أو رابط>']
handler.tags = ['downloader']
handler.command = /^(سبوتيفاي|spotify|سبوتي)$/i

export default handler
