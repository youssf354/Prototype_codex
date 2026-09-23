// plugins/wallpapers.js
// 🖼️ 4K Wallpapers - أمر الخلفيات

import axios from 'axios'
import { generateWAMessageFromContent, proto, prepareWAMessageMedia } from '@whiskeysockets/baileys'

const BASE_URL = 'https://4kwallpapers.com'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

if (!global.wallpaperCache) global.wallpaperCache = {}

// البحث في الموقع
async function searchWallpapers(query, page = 1) {
    let slug = query.trim().toLowerCase().replace(/\s+/g, '-')
    
    const url = page > 1 
        ? `${BASE_URL}/search/?q=${slug}&page=${page}` 
        : `${BASE_URL}/search/?q=${slug}`
    
    const res = await axios.get(url, { 
        headers: { 'User-Agent': UA },
        timeout: 30000,
        validateStatus: () => true
    })
    
    if (res.status !== 200) return []
    
    const text = res.data
    
    // روابط نسبية: /anime/xxx-12345.html
    const links = text.match(/href="(\/[a-z0-9-]+\/[a-z0-9-]+-\d+\.html)"/g) || []
    const unique = [...new Set(links.map(l => l.replace(/href="|"/g, '')))]
    
    return unique.map(l => BASE_URL + l)
}

async function getThumbnail(wallpaperUrl) {
    try {
        const res = await axios.get(wallpaperUrl, {
            headers: { 'User-Agent': UA },
            timeout: 30000,
            validateStatus: () => true
        })
        
        if (res.status !== 200) return null
        
        const text = res.data
        const title = text.match(/<title>([^<]+)<\/title>/)?.[1]?.replace(' Wallpaper 4K', '').replace(' Wallpaper', '').trim() || 'Wallpaper'
        
        let thumb = null
        const thumbMatch = text.match(/https:\/\/4kwallpapers\.com\/images\/walls\/thumbs_3t\/\d+\.jpg/)
        if (thumbMatch) {
            thumb = thumbMatch[0]
        } else {
            const anyThumb = text.match(/https:\/\/4kwallpapers\.com\/images\/walls\/thumbs[^"'\s]+\.jpg/)
            if (anyThumb) thumb = anyThumb[0]
        }
        
        if (!thumb) return null
        
        return { title, thumb, pageUrl: wallpaperUrl }
    } catch (e) {
        return null
    }
}

// جلب أعلى جودة - بنختار الأكبر بالأبعاد
async function getHighestQuality(pageUrl) {
    try {
        const res = await axios.get(pageUrl, {
            headers: { 'User-Agent': UA },
            timeout: 30000,
            validateStatus: () => true
        })
        
        if (res.status !== 200) return null
        
        const text = res.data
        const links = text.match(/href="(\/images\/wallpapers\/[^"]+)"/g) || []
        const unique = [...new Set(links.map(l => l.replace(/href="|"/g, '')))]
        
        if (!unique.length) return null
        
        let bestImage = unique[0]
        let maxPixels = 0
        
        for (let link of unique) {
            const match = link.match(/-(\d+)x(\d+)-/)
            if (match) {
                const pixels = parseInt(match[1]) * parseInt(match[2])
                if (pixels > maxPixels) {
                    maxPixels = pixels
                    bestImage = link
                }
            }
        }
        
        return BASE_URL + bestImage
    } catch (e) {
        return null
    }
}

async function downloadImage(url) {
    try {
        const res = await axios.get(url, {
            headers: { 'User-Agent': UA },
            responseType: 'arraybuffer',
            timeout: 120000,
            validateStatus: () => true
        })
        return Buffer.from(res.data)
    } catch (e) {
        return null
    }
}

export async function before(m, { conn }) {
    try {
        if (!m.text || !m.text.startsWith('.تحميل_خلفية')) return false
        
        const userId = m.sender.split('@')[0]
        const parts = m.text.trim().split(/\s+/)
        const index = parseInt(parts[1])
        
        if (isNaN(index)) return false
        
        const cached = global.wallpaperCache[userId]
        if (!cached || !cached[index]) {
            await m.reply('❌ الخلفية مش موجودة. اكتب الأمر تاني.')
            return true
        }
        
        await m.react('⏳')
        
        const wallpaper = cached[index]
        const highQualityUrl = await getHighestQuality(wallpaper.pageUrl)
        
        if (!highQualityUrl) {
            await m.react('❌')
            return m.reply('❌ فشل جلب الجودة العالية')
        }
        
        const buffer = await downloadImage(highQualityUrl)
        if (!buffer || buffer.length < 1000) {
            await m.react('❌')
            return m.reply('❌ فشل تحميل الصورة')
        }
        
        await conn.sendMessage(m.chat, {
            document: buffer,
            mimetype: 'image/jpeg',
            fileName: wallpaper.title + '.jpg',
            caption: `🖼️ *${wallpaper.title}*\n📐 جودة عالية\n💾 ${(buffer.length / 1048576).toFixed(2)} MB`
        }, { quoted: m })
        
        await m.react('✅')
        return true
    } catch (e) {
        console.error('[Wallpaper-Download]', e)
        return false
    }
}

let handler = async (m, { conn, text, command }) => {
    const react = async (emoji) => {
        try { await conn.sendMessage(m.chat, { react: { text: emoji, key: m.key } }) } catch {}
    }

    if (!text) {
        return m.reply(`🖼️ *أمر الخلفيات 4K*\n\n📌 *الاستخدام:*\n.خلفيات <كلمة البحث> [رقم الصفحة]\n\n💡 *أمثلة:*\n.خلفيات anime girl\n.خلفيات naruto\n.خلفيات car 2\n.خلفيات demon slayer 3\n\n🔍 البحث من موقع 4kwallpapers.com`)
    }

    const parts = text.trim().split(/\s+/)
    let page = 1
    
    const lastPart = parts[parts.length - 1]
    if (/^\d+$/.test(lastPart) && parts.length > 1) {
        page = parseInt(lastPart)
        parts.pop()
    }
    
    const query = parts.join(' ')
    
    if (!query) {
        return m.reply('❌ اكتب كلمة البحث')
    }

    await react('🔍')

    try {
        const wallpaperLinks = await searchWallpapers(query, page)
        
        if (!wallpaperLinks.length) {
            await react('❌')
            return m.reply(`❌ مفيش نتايج لـ "${query}" في الصفحة ${page}`)
        }

        await react('⏳')

        const wallpapers = []
        for (let i = 0; i < wallpaperLinks.length; i++) {
            try {
                const data = await getThumbnail(wallpaperLinks[i])
                if (data) wallpapers.push(data)
            } catch (e) {}
        }

        if (!wallpapers.length) {
            await react('❌')
            return m.reply('❌ فشل جلب الخلفيات')
        }

        const userId = m.sender.split('@')[0]
        global.wallpaperCache[userId] = wallpapers

        const cards = []
        for (let i = 0; i < wallpapers.length; i++) {
            try {
                const media = await prepareWAMessageMedia(
                    { image: { url: wallpapers[i].thumb } },
                    { upload: conn.waUploadToServer }
                )

                const buttons = [
                    {
                        name: 'quick_reply',
                        buttonParamsJson: JSON.stringify({
                            display_text: '⬇️ تحميل أعلى جودة',
                            id: '.تحميل_خلفية ' + i
                        })
                    }
                ]

                if (i === wallpapers.length - 1) {
                    buttons.push({
                        name: 'quick_reply',
                        buttonParamsJson: JSON.stringify({
                            display_text: `📄 الصفحة ${page + 1}`,
                            id: `.خلفيات ${query} ${page + 1}`
                        })
                    })
                }

                cards.push({
                    body: proto.Message.InteractiveMessage.Body.fromObject({
                        text: `🖼️ ${wallpapers[i].title.substring(0, 60)}`
                    }),
                    footer: proto.Message.InteractiveMessage.Footer.fromObject({
                        text: `📄 صفحة ${page} • ${i + 1}/${wallpapers.length}`
                    }),
                    header: proto.Message.InteractiveMessage.Header.fromObject({
                        title: wallpapers[i].title.substring(0, 50),
                        hasMediaAttachment: true,
                        imageMessage: media.imageMessage
                    }),
                    nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
                        buttons
                    })
                })
            } catch (e) {
                continue
            }
        }

        if (!cards.length) {
            await react('❌')
            return m.reply('❌ فشل تجهيز الخلفيات')
        }

        const msg = generateWAMessageFromContent(m.chat, {
            viewOnceMessage: {
                message: {
                    messageContextInfo: {
                        deviceListMetadata: {},
                        deviceListMetadataVersion: 2
                    },
                    interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                        body: proto.Message.InteractiveMessage.Body.create({
                            text: `🔍 *نتايج البحث: ${query}*\n📄 الصفحة: ${page}\n📸 عدد الصور: ${cards.length}`
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
        }, { userJid: conn.user.jid, quoted: m })

        await conn.relayMessage(m.chat, msg.message, { messageId: msg.key.id })

        await react('✅')

    } catch (e) {
        console.error('[Wallpapers]', e)
        await react('❌')
        m.reply('❌ خطأ: ' + e.message)
    }
}

handler.command = /^(خلفيات|خلفية|wallpapers|wallpaper)$/i
handler.tags = ['downloader']
handler.help = ['خلفيات <بحث> [صفحة]']
handler.before = before

export default handler

