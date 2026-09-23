// plugins/تحميل انمي.js
// ♡ Raiden Shogun - Witanime Scraper + Download 📺

import axios from 'axios'
import cheerio from 'cheerio'
import { exec } from 'child_process'
import { prepareWAMessageMedia, generateWAMessageFromContent, proto } from '@whiskeysockets/baileys'

async function searchAnime(query) {
    try {
        const { data } = await axios.get(`https://ristoanime.me/?s=${encodeURIComponent(query)}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36' },
            timeout: 15000,
            validateStatus: () => true
        })

        if (!data || data.length === 0) return []

        const $ = cheerio.load(data)
        const results = []

        $('.MovieItem a').each((i, el) => {
            const link = $(el).attr('href') || ''
            const title = $(el).find('h4').text().trim() || $(el).text().trim().slice(0, 60)
            const posterStyle = $(el).find('.poster').attr('data-style') || $(el).find('.poster').attr('style') || ''
            const thumbMatch = posterStyle.match(/url\(([^)]+)\)/)
            const thumb = thumbMatch ? thumbMatch[1].replace(/["']/g, '').trim() : ''
            const genre = $(el).find('.genre').text().trim()
            const year = $(el).find('.release-year').text().trim()
            const quality = $(el).find('.quality').text().trim()

            if (link && title && !results.find(r => r.link === link)) {
                results.push({ title: title.slice(0, 60), link, thumb, genre, year, quality })
            }
        })

        return results
    } catch (e) {
        return []
    }
}

async function getAnimes() {
    try {
        const { data } = await axios.get('https://ristoanime.me/', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36' },
            timeout: 15000,
            validateStatus: () => true
        })

        const $ = cheerio.load(data)
        const animes = []

        $('.MovieItem a').each((i, el) => {
            const link = $(el).attr('href') || ''
            const title = $(el).find('h4').text().trim() || $(el).text().trim().slice(0, 60)
            const posterStyle = $(el).find('.poster').attr('data-style') || $(el).find('.poster').attr('style') || ''
            const thumbMatch = posterStyle.match(/url\(([^)]+)\)/)
            const thumb = thumbMatch ? thumbMatch[1].replace(/["']/g, '').trim() : ''

            if (link && title && !animes.find(a => a.link === link)) {
                animes.push({ title: title.slice(0, 60), link, thumb })
            }
        })

        return animes
    } catch (e) {
        return []
    }
}

async function getEpisodes(animeUrl) {
    try {
        const { data } = await axios.get(animeUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36' },
            timeout: 15000,
            validateStatus: () => true
        })

        const $ = cheerio.load(data)
        const episodes = []

        $('.EpisodesList a').each((i, el) => {
            const href = $(el).attr('href') || ''
            const text = $(el).text().trim()

            if (href.startsWith('http') && text) {
                episodes.push({ title: text.slice(0, 60), link: href })
            }
        })

        return [...new Map(episodes.map(e => [e.link, e])).values()]
    } catch (e) {
        return []
    }
}

async function getEpisodeInfo(episodeUrl) {
    try {
        const { data } = await axios.get(episodeUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36' },
            timeout: 15000,
            validateStatus: () => true
        })

        const $ = cheerio.load(data)
        const title = $('h1').text().trim()
        const img = $('.Poster img').attr('src') || ''
        const desc = $('.StoryArea p').text().trim() || ''
        const rating = $('.imdbRBox').text().trim() || ''

        const genres = []
        $('.TaxContent a').each((i, el) => {
            genres.push($(el).text().trim())
        })

        return { title, img, desc, rating, genres }
    } catch (e) {
        return null
    }
}

async function getServers(watchUrl) {
    try {
        let url = watchUrl
        if (!url.includes('/watch')) {
            url = url.replace(/\/$/, '') + '/watch/'
        }

        const { data } = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36' },
            timeout: 15000,
            validateStatus: () => true
        })

        const matches = [...new Set(data.match(/https?:\/\/[^"'\s]+embed-[^"'\s]+/g) || [])]

        return matches.map(url => ({
            name: url.replace(/https?:\/\/(www\.)?/, '').split('/')[0].replace(/\..*/, ''),
            url
        }))
    } catch (e) {
        return []
    }
}

async function getM3u8Url(embedUrl) {
    try {
        const { data } = await axios.get(embedUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36' },
            timeout: 15000,
            validateStatus: () => true
        })

        const m3u8 = data.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/g) || []
        return m3u8[0] || ''
    } catch (e) {
        return ''
    }
}

async function downloadVideo(m3u8Url) {
    return new Promise(async (resolve, reject) => {
        try {
            const { data } = await axios.get(m3u8Url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 })

            const qualityUrls = data.match(/https?:\/\/[^"'\s]+_l[^"'\s]*\.m3u8[^"'\s]*/g) ||
                               data.match(/https?:\/\/[^"'\s]+_480[^"'\s]*\.m3u8[^"'\s]*/g) ||
                               [m3u8Url]

            const selectedUrl = qualityUrls[0] || m3u8Url
            const outputPath = `/home/container/anime_${Date.now()}.mp4`

            exec(`cd /home/container && ffmpeg -i "${selectedUrl}" -c copy -bsf:a aac_adtstoasc -y "${outputPath}"`,
                { timeout: 300000, maxBuffer: 10 * 1024 * 1024 },
                (err, stdout, stderr) => {
                    if (err) {
                        reject(new Error(stderr.slice(-200) || err.message))
                    } else {
                        resolve(outputPath)
                    }
                }
            )
        } catch (e) {
            reject(e)
        }
    })
}

async function createImageMessage(conn, url) {
    if (!url || !url.startsWith('http')) return null
    try {
        const res = await axios.get(url, {
            responseType: 'arraybuffer',
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 10000,
            validateStatus: () => true
        })
        if (res.status !== 200 || !res.data?.length || res.data.length < 1000) return null
        const media = await prepareWAMessageMedia({ image: Buffer.from(res.data) }, { upload: conn.waUploadToServer })
        return media.imageMessage || null
    } catch {
        return null
    }
}

async function downloadEpisode(conn, m, episodeUrl) {
    const react = async (e) => {
        try { await conn.sendMessage(m.chat, { react: { text: e, key: m.key } }); } catch {}
    }

    await react('⏳')

    const info = await getEpisodeInfo(episodeUrl)

    let infoMsg = ''
    if (info) {
        infoMsg = `📺 *${info.title}*\n\n`
        if (info.desc) infoMsg += `📝 *القصة:* ${info.desc.slice(0, 200)}\n\n`
        if (info.rating) infoMsg += `⭐ ${info.rating}\n\n`
        if (info.genres.length) infoMsg += `🏷️ ${info.genres.slice(0, 5).join(' • ')}\n\n`
    }

    infoMsg += '⏳ *جاري تجهيز التحميل...*'

    if (info?.img) {
        try {
            const res = await axios.get(info.img, { responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000, validateStatus: () => true })
            if (res.status === 200 && res.data?.length > 1000) {
                await conn.sendMessage(m.chat, {
                    image: Buffer.from(res.data),
                    caption: infoMsg
                }, { quoted: m })
            } else {
                await m.reply(infoMsg)
            }
        } catch {
            await m.reply(infoMsg)
        }
    } else {
        await m.reply(infoMsg)
    }

    const servers = await getServers(episodeUrl)
    if (!servers.length) return m.reply('❌ *لا توجد سيرفرات*')

    await m.reply(`📺 *${servers.length} سيرفر*\n⏳ جاري التحميل...`)

    const errors = []

    for (const server of servers) {
        try {
            const m3u8 = await getM3u8Url(server.url)
            if (!m3u8) {
                errors.push(`${server.name}: مفيش رابط m3u8`)
                continue
            }

            await m.reply(`📥 *جاري التحميل من ${server.name}...*`)

            const videoPath = await downloadVideo(m3u8)

            const fs = await import('fs')
            const videoBuffer = fs.readFileSync(videoPath)
            const fileSizeMB = (videoBuffer.length / 1024 / 1024).toFixed(2)

            if (videoBuffer.length < 100000) {
                try { fs.unlinkSync(videoPath) } catch {}
                errors.push(`${server.name}: الملف صغير`)
                continue
            }

            await conn.sendMessage(m.chat, {
                video: videoBuffer,
                mimetype: 'video/mp4',
                fileName: `anime_${Date.now()}.mp4`,
                caption: `✅ *تم التحميل*\n📁 ${fileSizeMB} MB\n🎬 ${server.name}`
            }, { quoted: m })

            try { fs.unlinkSync(videoPath) } catch {}
            await react('✅')
            return
        } catch (e) {
            errors.push(`${server.name}: ${e.message.slice(0, 100)}`)
            continue
        }
    }

    await react('❌')

    let errorMsg = `❌ *فشل التحميل*\n\n📋 *الأسباب:*\n`
    for (const err of errors) {
        errorMsg += `• ${err}\n`
    }

    return m.reply(errorMsg)
}

let handler = async (m, { conn, text, usedPrefix, command }) => {
    const react = async (e) => {
        try { await conn.sendMessage(m.chat, { react: { text: e, key: m.key } }); } catch {}
    }

    if (command === 'تحميل_انمي') {
        if (!text || !text.startsWith('http')) return m.reply(`❌ *الاستخدام:*\n${usedPrefix}تحميل_انمي [رابط الحلقة]`)
        return downloadEpisode(conn, m, text)
    }

    if (command === 'سيرفرات_انمي') {
        if (!text || !text.startsWith('http')) return m.reply(`❌ *الاستخدام:*\n${usedPrefix}سيرفرات_انمي [رابط الحلقة]`)

        await react('🎬')

        const servers = await getServers(text)
        if (!servers.length) return m.reply('❌ لا توجد سيرفرات')

        let msg = `🎬 *سيرفرات المشاهدة*\n📊 *العدد:* ${servers.length}\n\n`

        for (let i = 0; i < servers.length; i++) {
            msg += `*${i + 1}.* ${servers[i].name}\n${servers[i].url}\n\n`
        }

        await m.reply(msg)
        await react('✅')
        return
    }

    if (command === 'حلقات_انمي') {
        if (!text || !text.startsWith('http')) return m.reply(`❌ *الاستخدام:*\n${usedPrefix}حلقات_انمي [رابط الانمي]`)

        await react('📺')

        const episodes = await getEpisodes(text)
        if (!episodes.length) return m.reply('❌ لا توجد حلقات')

        let animeImage = null
        try {
            const { data } = await axios.get(text, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36' },
                timeout: 15000,
                validateStatus: () => true
            })
            const $ = cheerio.load(data)
            const imgUrl = $('.Poster img').attr('src') || $('img').first().attr('src') || ''
            if (imgUrl) {
                animeImage = await createImageMessage(conn, imgUrl)
            }
        } catch {}

        const rows = episodes.map((ep, i) => ({
            title: `${i + 1}. ${ep.title}`,
            description: '📥 اضغط للتحميل',
            id: `${usedPrefix}تحميل_انمي ${ep.link}`
        }))

        const nativeFlowPayload = {
            body: { text: `📺 *الحلقات*\n📊 *العدد:* ${episodes.length}\n\n👇 *اختر حلقة للتحميل*` },
            footer: { text: '✧ 2B - Witanime' },
            header: { hasMediaAttachment: animeImage ? true : false, imageMessage: animeImage },
            nativeFlowMessage: {
                buttons: [{ name: 'single_select', buttonParamsJson: JSON.stringify({ title: '📥 اختر حلقة', sections: [{ title: 'الحلقات', rows }] }) }],
                messageParamsJson: JSON.stringify({})
            }
        }

        const interactiveMessage = proto.Message.InteractiveMessage.fromObject(nativeFlowPayload)
        const msg = generateWAMessageFromContent(m.chat, { interactiveMessage }, { userJid: conn.user.jid, quoted: m })
        await conn.relayMessage(m.chat, msg.message, { messageId: msg.key.id })

        await react('✅')
        return
    }

    await react('🔍')

    let results

    if (text) {
        results = await searchAnime(text)
    } else {
        results = await getAnimes()
    }

    if (!results.length) {
        await react('❌')
        return m.reply(`❌ *لا توجد نتائج*\n\n🔍 *بحثت عن:* ${text || 'الرئيسية'}`)
    }

    const rows = results.slice(0, 50).map((a, i) => ({
        title: `${i + 1}. ${a.title}`,
        description: [a.genre, a.year, a.quality].filter(Boolean).join(' | ') || '📥 اضغط للاختيار',
        id: `${usedPrefix}حلقات_انمي ${a.link}`
    }))

    let headerImage = null
    for (const a of results) {
        if (a.thumb) {
            headerImage = await createImageMessage(conn, a.thumb)
            if (headerImage) break
        }
    }

    const titleText = text ? `🔍 *نتائج البحث: ${text}*` : `📺 *أحدث الحلقات*`

    const nativeFlowPayload = {
        body: { text: `${titleText}\n📊 *العدد:* ${results.length}\n\n👇 *اختر*` },
        footer: { text: '✧ 2B - Witanime' },
        header: { hasMediaAttachment: headerImage ? true : false, imageMessage: headerImage },
        nativeFlowMessage: {
            buttons: [{ name: 'single_select', buttonParamsJson: JSON.stringify({ title: '📺 اختر', sections: [{ title: 'النتائج', rows }] }) }],
            messageParamsJson: JSON.stringify({})
        }
    }

    const interactiveMessage = proto.Message.InteractiveMessage.fromObject(nativeFlowPayload)
    const msg = generateWAMessageFromContent(m.chat, { interactiveMessage }, { userJid: conn.user.jid, quoted: m })
    await conn.relayMessage(m.chat, msg.message, { messageId: msg.key.id })

    await react('✅')
}

handler.command = /^(witanime|وايت_انمي|انمي_وايت|حلقات_انمي|تحميل_انمي|سيرفرات_انمي|انمي)$/i
handler.tags = ['anime']
export default handler
