// plugins/انستا.js
// ✧ Instagram Downloader 🎬

import axios from 'axios'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { proto, generateWAMessageFromContent, generateWAMessageContent } from '@whiskeysockets/baileys'

const TMP = os.tmpdir()
const API_BASE = 'https://api.savefromins.com/api/contentsite_api'
const DOMAIN_VIDEO = 'api-ak.savefromins.com'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36'

let SFI_SESSION = {
    auth: null,
    domain: DOMAIN_VIDEO,
    lastFetch: 0
}

async function fetchAuth() {
    if (SFI_SESSION.auth && Date.now() - SFI_SESSION.lastFetch < 6 * 60 * 60 * 1000) {
        return SFI_SESSION.auth
    }

    try {
        const r = await axios.get('https://savefromins.com/ar', {
            headers: { 'User-Agent': UA },
            timeout: 20000
        })
        const html = String(r.data)
        const scripts = [...html.matchAll(/<script[^>]*src=["']([^"']+)["']/g)].map(m => m[1])

        for (const s of scripts) {
            if (!s.includes('_next')) continue
            try {
                const fullUrl = s.startsWith('http') ? s : 'https://savefromins.com' + s
                const rs = await axios.get(fullUrl, {
                    headers: { 'User-Agent': UA },
                    timeout: 15000
                })
                const js = String(rs.data)
                const match = js.match(/auth\s*:\s*["']([^"']+)["']/) || js.match(/2025\d{4}[a-z]+/i)
                if (match) {
                    const auth = match[1] || match[0]
                    SFI_SESSION.auth = auth
                    SFI_SESSION.lastFetch = Date.now()
                    console.log('[SaveFromIns] Auth fetched:', auth)
                    return auth
                }
            } catch (e) {}
        }
    } catch (e) {
        console.error('[SaveFromIns] Failed to fetch auth:', e.message)
    }

    if (!SFI_SESSION.auth) {
        SFI_SESSION.auth = '20250901majwlqo'
        SFI_SESSION.lastFetch = Date.now()
    }
    return SFI_SESSION.auth
}

async function parseInstagram(url) {
    const auth = await fetchAuth()
    const params = new URLSearchParams({
        auth,
        domain: DOMAIN_VIDEO,
        origin: 'source',
        link: url
    })

    const r = await axios.post(`${API_BASE}/media/parse`, params.toString(), {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': UA,
            'Origin': 'https://savefromins.com',
            'Referer': 'https://savefromins.com/'
        },
        timeout: 30000
    })

    const data = r.data?.data
    if (!data) throw new Error('فشل تحليل الرابط')

    return {
        title: data.title || 'Instagram Media',
        thumbnail: data.thumbnail || '',
        duration: data.duration || 0,
        resources: data.resources || []
    }
}

async function getDownloadLink(resource) {
    if (resource.download_url && resource.download_url.startsWith('http')) {
        return resource.download_url
    }

    const auth = await fetchAuth()

    const params = new URLSearchParams({
        auth,
        domain: DOMAIN_VIDEO,
        request: resource.resource_content
    })

    const r = await axios.post(`${API_BASE}/media/download`, params.toString(), {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': UA,
            'Origin': 'https://savefromins.com',
            'Referer': 'https://savefromins.com/'
        },
        timeout: 30000
    })

    const taskId = r.data?.data?.task_id
    if (!taskId) {
        const directLink = r.data?.data?.download_link
        if (directLink) return directLink
        throw new Error('فشل بدء التحميل')
    }

    const sseUrl = `https://api.savefromins.com/sse/contentsite_api/media/download_query?task_id=${encodeURIComponent(taskId)}&download_domain=${DOMAIN_VIDEO}&origin=content_site`

    return await new Promise((resolve, reject) => {
        let resolved = false
        let fullText = ''

        const timeout = setTimeout(() => {
            if (!resolved) { resolved = true; reject(new Error('انتهت مدة الانتظار')) }
        }, 60000)

        axios.get(sseUrl, {
            headers: {
                'Accept': 'text/event-stream',
                'User-Agent': UA,
                'Referer': 'https://savefromins.com/',
                'Cache-Control': 'no-cache'
            },
            responseType: 'stream',
            timeout: 65000
        }).then(response => {
            response.data.on('data', chunk => {
                if (resolved) return
                fullText += chunk.toString()

                const match = fullText.match(/"download_link"\s*:\s*"([^"]+)"/)
                if (match) {
                    resolved = true
                    clearTimeout(timeout)
                    response.data.destroy()
                    resolve(match[1])
                }

                if (fullText.includes('"status":"failed"')) {
                    resolved = true
                    clearTimeout(timeout)
                    response.data.destroy()
                    reject(new Error('فشل التحميل على السيرفر'))
                }
            }).on('end', () => {
                if (resolved) return
                const match = fullText.match(/"download_link"\s*:\s*"([^"]+)"/)
                if (match) {
                    resolved = true
                    clearTimeout(timeout)
                    resolve(match[1])
                }
            }).on('error', (e) => {
                if (resolved) return
                resolved = true
                clearTimeout(timeout)
                reject(new Error('خطأ في الاتصال: ' + e.message))
            })
        }).catch(e => {
            if (resolved) return
            resolved = true
            clearTimeout(timeout)
            reject(new Error('فشل الاتصال بـ SSE: ' + e.message))
        })
    })
}

async function downloadBuffer(url) {
    const r = await axios.get(url, {
        headers: {
            'User-Agent': UA,
            'Referer': 'https://savefromins.com/',
            'Accept': '*/*'
        },
        timeout: 120000,
        responseType: 'arraybuffer',
        maxRedirects: 10
    })
    return Buffer.from(r.data)
}

async function handleDownload(m, conn, url) {
    const react = async (emoji) => {
        try { await conn.sendMessage(m.chat, { react: { text: emoji, key: m.key } }) } catch {}
    }

    await react('⏳')
    const statusMsg = await m.reply('⏳ *جاري التحميل...*')

    try {
        const parsed = await parseInstagram(url)
        try { await conn.sendMessage(m.chat, { delete: statusMsg.key }) } catch {}

        if (!parsed.resources.length) throw new Error('مفيش محتوى')

        const videos = parsed.resources.filter(r => r.type === 'video')
        const audios = parsed.resources.filter(r => r.type === 'audio')
        const images = parsed.resources.filter(r => {
            if (r.type === 'video' || r.type === 'audio') return false
            if (r.type === 'picture' || r.type === 'image' || r.type === 'photo') return true
            if (r.format && ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic'].includes(String(r.format).toLowerCase())) return true
            return false
        })

        // ✅ بعت الـ thumbnail أول (لو موجود ولو مش نفس الصورة)
        if (parsed.thumbnail && !images.length) {
            try {
                const thumbBuf = await downloadBuffer(parsed.thumbnail)
                if (thumbBuf.length > 500) {
                    await conn.sendMessage(m.chat, {
                        image: thumbBuf,
                        caption: `🎬 ${parsed.title.slice(0, 80)}`
                    }, { quoted: m })
                }
            } catch (e) {
                console.error('[thumbnail]', e.message)
            }
        }

        let sent = 0

        // ═══ فيديوهات ═══
        for (let i = 0; i < videos.length; i++) {
            try {
                const link = await getDownloadLink(videos[i])
                const buffer = await downloadBuffer(link)
                if (buffer.length < 10000) continue
                const outFile = path.join(TMP, `ig_v_${Date.now()}_${i}.mp4`)
                fs.writeFileSync(outFile, buffer)
                await conn.sendMessage(m.chat, {
                    video: { url: outFile },
                    mimetype: 'video/mp4',
                    caption: `🎬 ${parsed.title.slice(0, 80)}\n📦 ${(buffer.length / 1048576).toFixed(2)} MB`
                }, { quoted: m })
                setTimeout(() => { try { fs.unlinkSync(outFile) } catch {} }, 60000)
                sent++
            } catch (e) { console.error('[video]', e.message) }
        }

        // ═══ صور ═══
        for (let i = 0; i < images.length; i++) {
            try {
                const link = await getDownloadLink(images[i])
                const buffer = await downloadBuffer(link)
                if (buffer.length < 500) continue
                const caption = images.length > 1
                    ? `📷 ${parsed.title.slice(0, 80)} (${i + 1}/${images.length})`
                    : `📷 ${parsed.title.slice(0, 80)}`
                await conn.sendMessage(m.chat, { image: buffer, caption }, { quoted: m })
                sent++
            } catch (e) { console.error('[image]', e.message) }
        }

        // ═══ أصوات ═══
        for (let i = 0; i < audios.length; i++) {
            try {
                const link = await getDownloadLink(audios[i])
                const buffer = await downloadBuffer(link)
                if (buffer.length < 1000) continue
                const mp3File = path.join(TMP, `ig_a_${Date.now()}_${i}.mp3`)
                fs.writeFileSync(mp3File, buffer)
                await conn.sendMessage(m.chat, {
                    audio: { url: mp3File },
                    mimetype: 'audio/mpeg',
                    fileName: `${parsed.title.slice(0, 60)}.mp3`,
                    ptt: false
                }, { quoted: m })
                setTimeout(() => { try { fs.unlinkSync(mp3File) } catch {} }, 60000)
                sent++
            } catch (e) { console.error('[audio]', e.message) }
        }

        if (sent === 0) {
            let debug = `❌ *فشل التحميل*\n\n📋 *الموارد:*\n`
            parsed.resources.forEach((r, i) => {
                debug += `${i + 1}. type=${r.type} | format=${r.format}\n`
            })
            throw new Error(debug)
        }

        await react('✅')
    } catch (e) {
        console.error('Instagram error:', e.message)
        try { await conn.sendMessage(m.chat, { delete: statusMsg.key }) } catch {}
        await react('❌')
        m.reply('❌ ' + e.message)
    }
}

let handler = async (m, { conn, text, usedPrefix, command }) => {
    const input = (text || '').trim()

    if (!input) {
        return m.reply(`📷 *Instagram*\n\n${usedPrefix}${command} <رابط>`)
    }

    if (input.includes('instagram.com')) {
        return handleDownload(m, conn, input)
    }

    return m.reply('❌ ابعت رابط Instagram')
}

handler.help = ['انستا <رابط>']
handler.tags = ['downloader']
handler.command = /^(انستا|انستجرام|instagram|ig)$/i

export default handler
