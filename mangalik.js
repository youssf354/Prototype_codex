// plugins/mangalik.js
// ♡ Raiden Shogun - Mangalik Scraper 📚

import axios from 'axios'
import cheerio from 'cheerio'
import { prepareWAMessageMedia, generateWAMessageFromContent, proto } from '@whiskeysockets/baileys'
import JSZip from 'jszip'

async function searchManga(query) {
    try {
        const { data } = await axios.get(`https://mangalik.net/?s=${encodeURIComponent(query)}&post_type=wp-manga`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36' },
            timeout: 15000,
            validateStatus: () => true
        })
        
        if (!data || data.length === 0) return []
        
        const $ = cheerio.load(data)
        const results = []
        
        $('a[href*="/manga/"]').each((i, el) => {
            const href = $(el).attr('href') || ''
            const img = $(el).find('img').first()
            const thumb = img.attr('src') || ''
            
            if (href.includes('/manga/') && !href.match(/\/\d+\/$/) && thumb.includes('uploads') && !thumb.includes('new.gif')) {
                const slug = href.split('/')[4].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
                const alt = img.attr('alt') || ''
                const isHash = /^[0-9a-f]{8,}$/i.test(alt) || /^large_\d+/i.test(alt) || /^download~?\d*$/i.test(alt) || /^\d{4}-\d{2}-\d{2}/.test(alt) || /^\(\d+\)/.test(alt)
                const title = !isHash && alt.length > 3 ? alt : slug
                
                results.push({ title: title.slice(0, 60), link: href, thumb })
            }
        })
        
        return [...new Map(results.map(r => [r.link, r])).values()]
    } catch (e) {
        return []
    }
}

async function getHomeManga() {
    try {
        const { data } = await axios.get('https://mangalik.net/', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36' },
            timeout: 15000,
            validateStatus: () => true
        })
        
        const $ = cheerio.load(data)
        const results = []
        
        $('a[href*="/manga/"]').each((i, el) => {
            const href = $(el).attr('href') || ''
            const img = $(el).find('img').first()
            const thumb = img.attr('src') || ''
            
            if (href.includes('/manga/') && !href.match(/\/\d+\/$/) && thumb.includes('uploads') && !thumb.includes('new.gif')) {
                const slug = href.split('/')[4].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
                const alt = img.attr('alt') || ''
                const isHash = /^[0-9a-f]{8,}$/i.test(alt) || /^large_\d+/i.test(alt) || /^download~?\d*$/i.test(alt) || /^\d{4}-\d{2}-\d{2}/.test(alt) || /^\(\d+\)/.test(alt)
                const title = !isHash && alt.length > 3 ? alt : slug
                
                results.push({ title: title.slice(0, 60), link: href, thumb })
            }
        })
        
        return [...new Map(results.map(r => [r.link, r])).values()]
    } catch (e) {
        return []
    }
}

async function getMangaInfo(mangaUrl) {
    try {
        const { data } = await axios.get(mangaUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36' },
            timeout: 15000
        })
        
        const $ = cheerio.load(data)
        const title = $('h1').text().trim()
        const img = $('.summary_image img').attr('src') || $('.summary_image img').attr('data-src') || ''
        const desc = $('.summary__content').text().trim() || ''
        
        const chapters = []
        $('a[href*="/manga/"]').each((i, el) => {
            const href = $(el).attr('href') || ''
            const text = $(el).text().trim()
            const slug = mangaUrl.split('/')[4]
            if (href.includes(slug) && /\/\d+\/$/.test(href) && text) {
                chapters.push({ title: text.slice(0, 40), link: href })
            }
        })
        
        return { title, img, desc, chapters }
    } catch (e) {
        return null
    }
}

async function getChapterImages(chapterUrl) {
    try {
        const { data } = await axios.get(chapterUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36' },
            timeout: 15000
        })
        
        const $ = cheerio.load(data)
        const images = []
        
        $('img').each((i, el) => {
            const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-original') || ''
            if (src.includes('solo.mangalik.net') || src.includes('tempsolo.mangalik.net') || src.includes('s7solo.mangalik.net')) {
                images.push(src)
            }
        })
        
        return [...new Set(images)]
    } catch (e) {
        return []
    }
}

async function createImageMessage(conn, url) {
    if (!url || !url.startsWith('http')) return null
    try {
        const originalUrl = url.replace(/-\d+x\d+\.(jpg|jpeg|png|webp)/i, '.$1')
        const res = await fetch(originalUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36', 'Referer': 'https://mangalik.net/', 'Accept': 'image/*' }
        })
        if (res.status !== 200) return null
        const buf = await res.arrayBuffer()
        if (!buf || buf.byteLength < 1000) return null
        const media = await prepareWAMessageMedia({ image: Buffer.from(buf) }, { upload: conn.waUploadToServer })
        return media.imageMessage || null
    } catch {
        return null
    }
}

async function downloadChapterZip(conn, m, chapterUrl, chapterTitle) {
    const react = async (e) => {
        try { await conn.sendMessage(m.chat, { react: { text: e, key: m.key } }); } catch {}
    }
    
    await react('⏳')
    await m.reply('📦 *جاري تجهيز الفصل ZIP...*')
    
    try {
        const images = await getChapterImages(chapterUrl)
        if (!images.length) return m.reply('❌ لا توجد صور')
        
        const zip = new JSZip()
        let pagesAdded = 0
        
        for (let i = 0; i < images.length; i++) {
            try {
                const res = await fetch(images[i], {
                    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://mangalik.net/' }
                })
                if (res.status !== 200) continue
                const buf = await res.arrayBuffer()
                const buffer = Buffer.from(buf)
                if (buffer.length > 100) {
                    zip.file(`page_${String(i + 1).padStart(3, '0')}.jpg`, buffer)
                    pagesAdded++
                }
            } catch {}
        }
        
        if (!pagesAdded) return m.reply('❌ فشل التحميل')
        
        const fileBuffer = await zip.generateAsync({ type: 'nodebuffer' })
        const fileName = `${chapterTitle || 'chapter'}_${Date.now()}.zip`
        const fileSizeMB = (fileBuffer.length / 1024 / 1024).toFixed(2)
        
        await conn.sendMessage(m.chat, {
            document: fileBuffer,
            mimetype: 'application/zip',
            fileName,
            caption: `📦 *${chapterTitle || 'الفصل'}*\n📄 ${pagesAdded} صفحة\n📁 ${fileSizeMB} MB`
        }, { quoted: m })
        
        await react('✅')
    } catch (e) {
        await react('❌')
        m.reply('❌ ' + e.message)
    }
}

let handler = async (m, { conn, text, usedPrefix, command }) => {
    const react = async (e) => {
        try { await conn.sendMessage(m.chat, { react: { text: e, key: m.key } }); } catch {}
    }
    
    if (command === 'مانجا_ليك') {
        if (!text || !text.startsWith('http')) return m.reply(`❌ *الاستخدام:*\n${usedPrefix}مانجا_ليك [رابط المانجا]`)
        
        await react('📖')
        
        const info = await getMangaInfo(text)
        if (!info) return m.reply('❌ فشل جلب المعلومات')
        
        let msg = `📚 *${info.title}*\n\n`
        if (info.desc) msg += `📝 ${info.desc.slice(0, 300)}...\n\n`
        msg += `📖 *الفصول:* ${info.chapters.length}\n\n👇 *اختر فصل للتحميل*`
        
        let headerImage = null
        if (info.img) {
            headerImage = await createImageMessage(conn, info.img)
        }
        
        const rows = info.chapters.map((ch, i) => ({
            title: `${i + 1}. ${ch.title}`,
            description: '📦 ZIP',
            id: `${usedPrefix}تحميل_مانجا ${ch.link} | ${ch.title}`
        }))
        
        const nativeFlowPayload = {
            body: { text: msg },
            footer: { text: '✧ 2B - Mangalik' },
            header: { hasMediaAttachment: headerImage ? true : false, imageMessage: headerImage },
            nativeFlowMessage: {
                buttons: [{ name: 'single_select', buttonParamsJson: JSON.stringify({ title: '📖 الفصول', sections: [{ title: 'الفصول', rows }] }) }],
                messageParamsJson: JSON.stringify({})
            }
        }
        
        const im = proto.Message.InteractiveMessage.fromObject(nativeFlowPayload)
        const msg2 = generateWAMessageFromContent(m.chat, { interactiveMessage: im }, { userJid: conn.user.jid, quoted: m })
        await conn.relayMessage(m.chat, msg2.message, { messageId: msg2.key.id })
        
        await react('✅')
        return
    }
    
    if (command === 'تحميل_مانجا') {
        if (!text || !text.includes('http')) return m.reply(`❌ *الاستخدام:*\n${usedPrefix}تحميل_مانجا [رابط الفصل]`)
        const parts = text.split('|')
        return downloadChapterZip(conn, m, parts[0].trim(), parts[1]?.trim() || 'chapter')
    }
    
    await react('🔍')
    
    let results
    
    if (text) {
        results = await searchManga(text)
    } else {
        results = await getHomeManga()
    }
    
    if (!results.length) {
        await react('❌')
        return m.reply(`❌ *لا توجد نتائج*`)
    }
    
    const rows = results.map((r, i) => ({
        title: `${i + 1}. ${r.title}`,
        description: '📚 مانجا',
        id: `${usedPrefix}مانجا_ليك ${r.link}`
    }))
    
    let headerImage = null
    for (const r of results) {
        if (r.thumb) {
            headerImage = await createImageMessage(conn, r.thumb)
            if (headerImage) break
        }
    }
    
    const titleText = text ? `🔍 *نتائج: ${text}*` : `📚 *أشهر المانجا*`
    
    const nativeFlowPayload = {
        body: { text: `${titleText}\n📊 *العدد:* ${results.length}\n\n👇 *اختر مانجا*` },
        footer: { text: '✧ 2B - Mangalik' },
        header: { hasMediaAttachment: headerImage ? true : false, imageMessage: headerImage },
        nativeFlowMessage: {
            buttons: [{ name: 'single_select', buttonParamsJson: JSON.stringify({ title: '📚 اختر مانجا', sections: [{ title: 'النتائج', rows }] }) }],
            messageParamsJson: JSON.stringify({})
        }
    }
    
    const im = proto.Message.InteractiveMessage.fromObject(nativeFlowPayload)
    const msg = generateWAMessageFromContent(m.chat, { interactiveMessage: im }, { userJid: conn.user.jid, quoted: m })
    await conn.relayMessage(m.chat, msg.message, { messageId: msg.key.id })
    
    await react('✅')
}

handler.command = /^(مانجا|mangalik|مانجا_ليك|تحميل_مانجا)$/i
handler.tags = ['manga']
export default handler
