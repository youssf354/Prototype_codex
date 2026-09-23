// plugins/edit-search.js
// ✧ TikTok Search + حقوق rem 🎬

import { proto, generateWAMessageFromContent, generateWAMessageContent } from '@whiskeysockets/baileys'
import { theme } from '../core/theme.js'

const CACHE = new Map()
const CACHE_TTL = 30 * 60 * 1000
const VIDEO_CACHE = new Map()

// 🎯 العدد المطلوب
const MAX_VIDEOS = 20

async function searchTikTok(query, count = 20) {
    const cached = CACHE.get(query)
    if (cached && Date.now() - cached.time < CACHE_TTL) {
        return cached.results.slice(0, count)
    }

    const now = Math.floor(Date.now() / 1000)
    const oneYearAgo = now - 365 * 24 * 60 * 60

    const body = JSON.stringify({
        keywords: query,
        filtersFast: [
            'nbChar > 10',
            "lang = 'en'",
            `createTime >= ${oneYearAgo} AND createTime <= ${now}`
        ],
        extraParams: { sort: '' }
    })

    const res = await fetch('https://www.revid.ai/api/tiktok-search', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
            'Referer': 'https://www.revid.ai/tiktok-video-finder',
            'Accept': 'application/json'
        },
        body
    })

    if (!res.ok) throw new Error('HTTP ' + res.status)

    const data = await res.json()
    const videos = (data.videos || []).map(v => ({
        id: v.id,
        desc: v.desc || 'TikTok Video',
        url: v.url,
        videoUrl: v.urlUploaded,
        cover: v.imagePreview,
        duration: v.durationInSeconds || 0,
        author: v.userNickname || 'Unknown',
        username: v.username || '',
        likes: v.diggCount || 0,
        comments: v.commentCount || 0,
        shares: v.shareCount || 0,
        plays: v.playCount || 0
    }))

    CACHE.set(query, { results: videos, time: Date.now() })
    return videos.slice(0, count)
}

async function getVideoNoWatermark(tiktokUrl) {
    const r = await fetch('https://www.tikwm.com/api/?url=' + encodeURIComponent(tiktokUrl), {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36' }
    })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const j = await r.json()
    if (j.code !== 0) throw new Error(j.msg || 'Failed')
    const url = j.data.hdplay || j.data.play
    if (!url) throw new Error('No video URL')
    return { url, title: j.data.title || '', author: j.data.author?.nickname || '', duration: j.data.duration || 0 }
}

async function downloadVideo(url) {
    const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36', 'Referer': 'https://www.tiktok.com/' }
    })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const buf = Buffer.from(await r.arrayBuffer())
    if (!buf.length) throw new Error('Empty video')
    return buf
}

async function sendCarousel(conn, chat, m, characterName, videos) {
    const selectedVideos = videos.slice(0, MAX_VIDEOS)
    const cards = []
    const batchId = Date.now().toString(36)

    for (let i = 0; i < selectedVideos.length; i++) {
        const video = selectedVideos[i]
        try {
            if (!video.videoUrl) continue
            const buffer = await downloadVideo(video.videoUrl)
            if (!buffer || buffer.length < 10000) continue

            const videoKey = `nw_${batchId}_${i}`
            VIDEO_CACHE.set(videoKey, {
                tiktokUrl: video.url,
                title: video.desc,
                author: video.author,
                duration: video.duration,
                timestamp: Date.now()
            })

            const { videoMessage } = await generateWAMessageContent(
                { video: buffer },
                { upload: conn.waUploadToServer }
            )

            const buttons = [
                {
                    name: 'quick_reply',
                    buttonParamsJson: JSON.stringify({
                        display_text: '📥 بدون علامة',
                        id: `.dlnowm ${videoKey}`
                    })
                }
            ]

            cards.push({
                body: proto.Message.InteractiveMessage.Body.fromObject({
                    text: `❤️ ${formatNum(video.likes)} | 💬 ${formatNum(video.comments)} | 👁️ ${formatNum(video.plays)}`
                }),
                footer: proto.Message.InteractiveMessage.Footer.fromObject({
                    text: `👤 ${video.author} | ⏱️ ${video.duration}s`
                }),
                header: proto.Message.InteractiveMessage.Header.fromObject({
                    title: video.desc.length > 50 ? video.desc.substring(0, 47) + '...' : video.desc,
                    hasMediaAttachment: true,
                    videoMessage: videoMessage
                }),
                nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({ buttons })
            })
        } catch (err) {
            console.log('Card error:', err.message)
        }
    }

    if (!cards.length) throw new Error('No cards')

    const msg = generateWAMessageFromContent(chat, {
        viewOnceMessage: {
            message: {
                messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
                interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                    body: proto.Message.InteractiveMessage.Body.create({
                        text: `> ${theme.smallDivider}\n> 🜲⃝☠️ *اديـتات: ${characterName}*\n> 𖤐⃝🩸 ${cards.length} فيديو\n> ${theme.smallDivider}`
                    }),
                    footer: proto.Message.InteractiveMessage.Footer.create({ text: '⧼ 𝑷𝑹𝑶𝑻𝑶𝑻𝒀𝑷𝑬 ⧽ v2' }),
                    header: proto.Message.InteractiveMessage.Header.create({ hasMediaAttachment: false }),
                    carouselMessage: proto.Message.InteractiveMessage.CarouselMessage.fromObject({ cards })
                })
            }
        }
    }, { quoted: m })

    await conn.relayMessage(chat, msg.message, { messageId: msg.key.id })

    setTimeout(() => {
        for (const key of VIDEO_CACHE.keys()) {
            if (key.startsWith(`nw_${batchId}_`)) VIDEO_CACHE.delete(key)
        }
    }, 30 * 60 * 1000)
}

function formatNum(n) {
    if (!n) return '0'
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
    return n.toString()
}

async function handleDownloadNoWM(m, { conn, videoKey }) {
    const info = VIDEO_CACHE.get(videoKey)
    if (!info) return m.reply(`> ${theme.divider}\n> ❌ *انتهت صلاحية الزر*\n> 🕐 جرب البحث من جديد\n> ${theme.endDivider}`)

    await conn.sendMessage(m.chat, { react: { text: '⏳', key: m.key } })
    try {
        const video = await getVideoNoWatermark(info.tiktokUrl)
        const buffer = await downloadVideo(video.url)
        const caption = `> ${theme.divider}\n> 🎬 *${video.title.slice(0, 100)}*\n> 👤 ${video.author}\n> ⏱️ ${video.duration}s\n> ✅ بدون علامة مائية\n> ${theme.endDivider}`
        await conn.sendMessage(m.chat, { video: buffer, caption, mimetype: 'video/mp4' }, { quoted: m })
        await conn.sendMessage(m.chat, { react: { text: '✅', key: m.key } })
    } catch (err) {
        console.error('Download error:', err)
        await conn.sendMessage(m.chat, { react: { text: '❌', key: m.key } })
        m.reply(`❌ ${err.message}`)
    }
}

let handler = async (m, { conn, args, usedPrefix, command }) => {
    const chat = m.chat

    if (command.toLowerCase() === 'dlnowm' || /^\.dlnowm/.test(m.text)) {
        const videoKey = (args[0] || m.text.replace(/^\.?dlnowm\s+/, '')).trim()
        if (!videoKey) return
        return await handleDownloadNoWM(m, { conn, videoKey })
    }

    if (!args[0]) {
        await conn.sendMessage(chat, { react: { text: '❌', key: m.key } })
        return m.reply(`> ${theme.divider}\n> \n> 🜲⃝☠️ *بـحـث الـاديـتات*\n> 𖤐⃝🩸 *بحث من تيك توك*\n> \n> ${theme.smallDivider}\n> \n> 👁️⃝🩸 الاستخدام:\n> ${usedPrefix}${command} <اسم الشخصية>\n> \n> ${theme.endDivider}`)
    }

    const characterName = args.join(' ')
    const searchQuery = `${characterName} edit`

    await conn.sendMessage(chat, { react: { text: '🔍', key: m.key } })
    await m.reply(`> ${theme.divider}\n> \n> 🜲⃝☠️ *جـاري الـبـحـث*\n> 𖤐⃝🩸 *عن: ${characterName}*\n> \n> ${theme.endDivider}`)

    try {
        const videos = await searchTikTok(searchQuery, MAX_VIDEOS)
        if (!videos || videos.length === 0) {
            await conn.sendMessage(chat, { react: { text: '❌', key: m.key } })
            return m.reply(`> ${theme.divider}\n> \n> 🜲⃝☠️ *خـطـأ*\n> 👁️⃝🩸 *ما لقيت اديتات لـ ${characterName}*\n> \n> ${theme.endDivider}`)
        }
        await sendCarousel(conn, chat, m, characterName, videos)
        await conn.sendMessage(chat, { react: { text: '✅', key: m.key } })
    } catch (err) {
        console.error('❌ Edit Search Error:', err)
        await conn.sendMessage(chat, { react: { text: '❌', key: m.key } })
        m.reply(`> ${theme.divider}\n> \n> 🜲⃝☠️ *خـطـأ*\n> 👁️🟸 *${err.message}*\n> \n> ${theme.endDivider}`)
    }
}

handler.help = ['ايديت <اسم>']
handler.tags = ['downloader']
handler.command = /^(بحثتيك|بحثتيكك|ايديت|بحث_تيك|dlnowm)$/i

export default handler

