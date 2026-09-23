import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'
import https from 'https'
import zlib from 'zlib'
import { generateWAMessageFromContent, generateWAMessageContent, proto } from '@whiskeysockets/baileys'

const TMP = os.tmpdir()

const CHROME_CIPHERS = [
    'TLS_AES_128_GCM_SHA256','TLS_AES_256_GCM_SHA384','TLS_CHACHA20_POLY1305_SHA256',
    'ECDHE-ECDSA-AES128-GCM-SHA256','ECDHE-RSA-AES128-GCM-SHA256','ECDHE-ECDSA-AES256-GCM-SHA384',
    'ECDHE-RSA-AES256-GCM-SHA384','ECDHE-ECDSA-CHACHA20-POLY1305','ECDHE-RSA-CHACHA20-POLY1305',
    'ECDHE-RSA-AES128-SHA','ECDHE-RSA-AES256-SHA','AES128-GCM-SHA256','AES256-GCM-SHA384','AES128-SHA','AES256-SHA'
].join(':')

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

function request(url, { method = 'GET', maxRedirects = 8, headers = {}, binary = false } = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(url)
        const req = https.request({
            hostname: u.hostname,
            path: u.pathname + u.search,
            method,
            headers: {
                'User-Agent': UA,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Upgrade-Insecure-Requests': '1',
                ...headers
            },
            timeout: 30000,
            ciphers: CHROME_CIPHERS,
            minVersion: 'TLSv1.2',
            maxVersion: 'TLSv1.3'
        }, async res => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
                res.resume()
                let next = res.headers.location
                if (!next.startsWith('http')) next = new URL(next, url).href
                try {
                    return resolve(await request(next, { method, maxRedirects: maxRedirects - 1, headers, binary }))
                } catch (e) { return reject(e) }
            }
            const chunks = []
            res.on('data', c => chunks.push(c))
            res.on('end', () => {
                let buf = Buffer.concat(chunks)
                try {
                    const enc = res.headers['content-encoding'] || ''
                    if (enc.includes('gzip')) buf = zlib.gunzipSync(buf)
                    else if (enc.includes('deflate')) buf = zlib.inflateSync(buf)
                    else if (enc.includes('br')) buf = zlib.brotliDecompressSync(buf)
                } catch {}
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    buffer: buf,
                    text: binary ? '' : buf.toString('utf-8')
                })
            })
        })
        req.on('error', reject)
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')) })
        req.end()
    })
}

async function searchFacebookVideo(query) {
    const url = `https://www.facebook.com/watch/search/?q=${encodeURIComponent(query)}`
    const r = await request(url)
    if (r.status !== 200 || r.text.length < 1000) throw new Error('فيسبوك رفض البحث')
    const html = r.text

    const ids = []
    const seen = new Set()
    const idRegex = /"video_id":"(\d+)"/g
    let m
    while ((m = idRegex.exec(html)) !== null) {
        if (!seen.has(m[1])) {
            seen.add(m[1])
            ids.push(m[1])
        }
    }

    const titles = []
    const titleRegex = /"message":\{"text":"([^"]{5,150})"/g
    const seenT = new Set()
    while ((m = titleRegex.exec(html)) !== null) {
        const t = m[1].replace(/\\n/g, ' ').replace(/\\"/g, '"').trim()
        if (!seenT.has(t)) {
            seenT.add(t)
            titles.push(t)
        }
    }

    const all = ids.map((id, i) => ({
        id,
        title: titles[i] || titles[0] || `Facebook Video ${i + 1}`,
        url: `https://www.facebook.com/watch/?v=${id}`
    }))

    for (let i = all.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        const tmp = all[i]
        all[i] = all[j]
        all[j] = tmp
    }

    return all
}

async function getVideoUrl(videoId, preferHD = true) {
    const r = await request(`https://www.facebook.com/watch/?v=${videoId}`)
    if (r.status !== 200 || r.text.length < 1000) throw new Error('فشل فتح الفيديو')
    const html = r.text
    const sdMatch = html.match(/browser_native_sd_url":"([^"]+)"/)
    const hdMatch = html.match(/browser_native_hd_url":"([^"]+)"/)
    const clean = (s) => s ? s.replace(/\\u0025/g, '%').replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/\\/g, '') : null
    const sd = clean(sdMatch?.[1])
    const hd = clean(hdMatch?.[1])
    if (!sd && !hd) throw new Error('ما لقيناش رابط الفيديو')
    if (preferHD && hd) return hd
    return sd || hd
}

async function downloadVideoToFile(url) {
    const outFile = path.join(TMP, `fb_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`)
    const cmd = `ffmpeg -y -user_agent "${UA}" -headers "Referer: https://www.facebook.com/\\r\\n" -i "${url}" -c copy -movflags +faststart -t 60 "${outFile}" 2>&1`
    try {
        execSync(cmd, { timeout: 180000, stdio: 'pipe' })
    } catch (e) {
        const err = ((e.stderr || e.stdout || e.message) + '').slice(-500)
        throw new Error('فشل التحميل: ' + err)
    }
    if (!fs.existsSync(outFile)) throw new Error('ملف الفيديو غير موجود')
    const stats = fs.statSync(outFile)
    if (!stats.size || stats.size < 10000) {
        try { fs.unlinkSync(outFile) } catch {}
        throw new Error('ملف صغير')
    }
    return outFile
}

async function processBatch(items, fn, batchSize = 5) {
    const results = []
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize)
        const batchResults = await Promise.all(batch.map(item => fn(item).catch(() => null)))
        results.push(...batchResults)
    }
    return results
}

let handler = async (m, { conn, text, command }) => {
    const react = async (emoji) => {
        try { await conn.sendMessage(m.chat, { react: { text: emoji, key: m.key } }) } catch {}
    }

    if (!text) {
        return m.reply(`📘 *بحث فيسبوك*\n\n🔍 *بحث:*\n.فيس_فيديو <كلمة>\n\n📥 *تحميل:*\n.فيس <رابط>`)
    }

    if (/^https?:\/\/(www\.|m\.)?(facebook\.com|fb\.watch)/i.test(text.trim())) {
        await react('⏳')
        try {
            const input = text.trim()
            let videoId = null
            const idMatch = input.match(/(?:v=|\/videos\/|reel\/)(\d+)/)
            if (idMatch) videoId = idMatch[1]
            if (!videoId) throw new Error('ما لقيناش ID الفيديو')

            const videoUrl = await getVideoUrl(videoId, true)
            const file = await downloadVideoToFile(videoUrl)
            await conn.sendMessage(m.chat, { video: { url: file }, mimetype: 'video/mp4', caption: '✅ Facebook Video' }, { quoted: m })
            setTimeout(() => { try { fs.unlinkSync(file) } catch {} }, 60000)
            await react('✅')
        } catch (e) {
            await react('❌')
            m.reply('❌ ' + e.message)
        }
        return
    }

    await react('⏳')

    try {
        const videos = await searchFacebookVideo(text.trim())
        if (!videos.length) {
            await react('❌')
            return m.reply('❌ مفيش نتايج')
        }

        const toDownload = videos.slice(0, 10)

        const videoUrls = await processBatch(
            toDownload,
            async (v) => await getVideoUrl(v.id, true),
            5
        )

        const filePromises = videoUrls.map(url => url ? downloadVideoToFile(url).catch(() => null) : null)
        const files = await Promise.all(filePromises)

        const cards = []
        const tempFiles = []
        for (let i = 0; i < toDownload.length; i++) {
            const file = files[i]
            if (!file) continue
            tempFiles.push(file)
            try {
                const { videoMessage } = await generateWAMessageContent(
                    { video: { url: file }, mimetype: 'video/mp4' },
                    { upload: conn.waUploadToServer }
                )
                const v = toDownload[i]
                cards.push({
                    body: proto.Message.InteractiveMessage.Body.fromObject({
                        text: `🎬 ${v.title.slice(0, 100)}`
                    }),
                    footer: proto.Message.InteractiveMessage.Footer.fromObject({
                        text: '✧ 2B'
                    }),
                    header: proto.Message.InteractiveMessage.Header.fromObject({
                        title: v.title.length > 50 ? v.title.substring(0, 47) + '...' : v.title,
                        hasMediaAttachment: true,
                        videoMessage: videoMessage
                    }),
                    nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
                        buttons: []
                    })
                })
            } catch (err) {
                console.error('card error:', err.message)
            }
        }

        if (!cards.length) {
            tempFiles.forEach(f => { try { fs.unlinkSync(f) } catch {} })
            await react('❌')
            return m.reply('❌ فشل التحميل')
        }

        const msg = generateWAMessageFromContent(m.chat, {
            viewOnceMessage: {
                message: {
                    messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
                    interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                        body: proto.Message.InteractiveMessage.Body.create({
                            text: `📘 *Facebook: ${text}*`
                        }),
                        footer: proto.Message.InteractiveMessage.Footer.create({
                            text: '✧ 2B'
                        }),
                        header: proto.Message.InteractiveMessage.Header.create({
                            hasMediaAttachment: false
                        }),
                        carouselMessage: proto.Message.InteractiveMessage.CarouselMessage.fromObject({
                            cards
                        })
                    })
                }
            }
        }, { quoted: m })

        await conn.relayMessage(m.chat, msg.message, { messageId: msg.key.id })
        setTimeout(() => {
            tempFiles.forEach(f => { try { fs.unlinkSync(f) } catch {} })
        }, 120000)
        await react('✅')
    } catch (e) {
        console.error('[FB]', e.message)
        await react('❌')
        m.reply('❌ ' + e.message)
    }
}

handler.help = ['فيس_فيديو <كلمة>', 'فيس <رابط>']
handler.tags = ['downloader']
handler.command = /^(فيس_فيديو|فيسبوك_فيديو|fb_video|بحث_فيس)$/i

export default handler
