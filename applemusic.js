// plugins/applemusic.js
import sharp from 'sharp'
import { generateWAMessageFromContent, proto, prepareWAMessageMedia } from '@whiskeysockets/baileys'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'

let APPLE_TOKEN = null
let APPLE_TOKEN_EXP = 0

async function getAppleToken(force = false) {
    const now = Date.now()
    if (!force && APPLE_TOKEN && APPLE_TOKEN_EXP > now) return APPLE_TOKEN
    try {
        const htmlRes = await fetch('https://music.apple.com/us/search', { headers: { 'User-Agent': UA } })
        const html = await htmlRes.text()
        const match = html.match(/\/assets\/index~([a-z0-9]+)\.js/)
        if (!match) throw new Error('JS not found')
        const jsRes = await fetch('https://music.apple.com/assets/index~' + match[1] + '.js', { headers: { 'User-Agent': UA } })
        const js = await jsRes.text()
        const tokenMatch = js.match(/"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"/)
        if (!tokenMatch) throw new Error('Token not found')
        const token = tokenMatch[0].slice(1, -1)
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString())
        APPLE_TOKEN = token
        APPLE_TOKEN_EXP = payload.exp * 1000 - 60000
        return token
    } catch (e) {
        if (APPLE_TOKEN) return APPLE_TOKEN
        throw new Error('فشل جلب توكن Apple: ' + e.message)
    }
}

async function searchApple(query, limit = 8) {
    const token = await getAppleToken()
    const url = `https://amp-api.music.apple.com/v1/catalog/us/search?term=${encodeURIComponent(query)}&types=songs&limit=${limit}`
    const res = await fetch(url, {
        headers: {
            'User-Agent': UA,
            'Authorization': 'Bearer ' + token,
            'Origin': 'https://music.apple.com',
            'Referer': 'https://music.apple.com/'
        }
    })
    if (res.status === 401) {
        const newToken = await getAppleToken(true)
        const r2 = await fetch(url, {
            headers: {
                'User-Agent': UA,
                'Authorization': 'Bearer ' + newToken,
                'Origin': 'https://music.apple.com',
                'Referer': 'https://music.apple.com/'
            }
        })
        const d2 = await r2.json()
        return d2?.results?.songs?.data || []
    }
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const data = await res.json()
    return data?.results?.songs?.data || []
}

async function downloadFromAplmate(songUrl) {
    const baseHeaders = {
        'User-Agent': UA,
        'Referer': 'https://aplmate.com/',
        'Origin': 'https://aplmate.com'
    }

    const homeRes = await fetch('https://aplmate.com/', { headers: { 'User-Agent': UA } })
    const cookie = (homeRes.headers.get('set-cookie') || '').split(';')[0]
    if (!cookie) throw new Error('فشل الحصول على كوكي')

    const headers = { ...baseHeaders, 'Cookie': cookie }

    const vRes = await fetch('https://aplmate.com/action/userverify', {
        method: 'POST',
        headers: {
            ...headers,
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest'
        },
        body: 'url=' + encodeURIComponent(songUrl)
    })
    const vj = await vRes.json()
    if (!vj.success || !vj.token) throw new Error('فشل التحقق: ' + (vj.message || ''))

    const aRes = await fetch('https://aplmate.com/action', {
        method: 'POST',
        headers: {
            ...headers,
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest'
        },
        body: 'url=' + encodeURIComponent(songUrl) + '&cf-turnstile-response=' + encodeURIComponent(vj.token)
    })
    const aj = await aRes.json()
    if (aj.error || !aj.html) throw new Error(aj.message || 'فشل الطلب الأساسي')

    const html = aj.html
    const dataM = html.match(/name="data"\s+value='([^']+)'/)
    const tokenM = html.match(/name="token"\s+value="([^"]+)"/)
    const baseM = html.match(/name="base"\s+value="([^"]+)"/)
    if (!dataM || !tokenM || !baseM) throw new Error('فشل استخراج بيانات التحميل')

    const tRes = await fetch('https://aplmate.com/action/track', {
        method: 'POST',
        headers: {
            ...headers,
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest'
        },
        body: 'data=' + encodeURIComponent(dataM[1]) + '&token=' + encodeURIComponent(tokenM[1]) + '&base=' + encodeURIComponent(baseM[1])
    })
    const tj = await tRes.json()
    if (tj.error || !tj.data) throw new Error(tj.message || 'فشل التحميل')

    const mp3Match = tj.data.match(/href="(https:\/\/cdndl\.aplmate\.com\/mp3\?token=[^"]+)"/)
    if (!mp3Match) throw new Error('مش لاقي رابط MP3')

    const mp3Url = mp3Match[1].replace(/&amp;/g, '&')

    const mp3Res = await fetch(mp3Url, { headers: { 'User-Agent': UA, 'Referer': 'https://aplmate.com/' } })
    if (!mp3Res.ok) throw new Error('فشل تنزيل MP3: HTTP ' + mp3Res.status)

    const buffer = Buffer.from(await mp3Res.arrayBuffer())
    if (!buffer.length) throw new Error('ملف فارغ')

    return buffer
}

async function getArtwork(url) {
    if (!url) return null
    try {
        const fixed = url.replace('{w}x{h}', '600x600').replace('60x60', '600x600')
        const res = await fetch(fixed, { headers: { 'User-Agent': UA } })
        const buffer = Buffer.from(await res.arrayBuffer())
        if (buffer.length < 500) return null
        return await sharp(buffer).jpeg({ quality: 90 }).toBuffer()
    } catch {
        return null
    }
}

let handler = async (m, { conn, text, usedPrefix, command }) => {
    if (!text) return m.reply(`🎵 *Apple Music*\n\n${usedPrefix}${command} <اسم الأغنية>`)

    if (text.startsWith('dl_')) {
        const songUrl = text.slice(3).trim()
        await m.react('⏳')
        try {
            const audioBuffer = await downloadFromAplmate(songUrl)
            await conn.sendMessage(m.chat, {
                audio: audioBuffer,
                mimetype: 'audio/mpeg',
                fileName: 'Apple Music.mp3',
                ptt: false
            }, { quoted: m })
            await m.react('✅')
        } catch (e) {
            console.error('Apple download error:', e)
            await m.react('❌')
            m.reply('❌ ' + e.message)
        }
        return
    }

    await m.react('🔍')
    try {
        const songs = await searchApple(text)
        if (!songs.length) {
            await m.react('❌')
            return m.reply('❌ مفيش نتايج')
        }

        const firstArt = songs[0]?.attributes?.artwork?.url
        const headerImg = await getArtwork(firstArt)

        let header = { hasMediaAttachment: false }
        if (headerImg) {
            try {
                const media = await prepareWAMessageMedia(
                    { image: headerImg, mimetype: 'image/jpeg' },
                    { upload: conn.waUploadToServer }
                )
                header = { hasMediaAttachment: true, imageMessage: media.imageMessage }
            } catch {}
        }

        const rows = songs.map((s, i) => {
            const a = s.attributes
            const dur = a.durationInMillis ? Math.floor(a.durationInMillis / 1000) : 0
            const durStr = dur ? `${Math.floor(dur / 60)}:${(dur % 60).toString().padStart(2, '0')}` : ''
            return {
                title: `${i + 1}. ${a.name}`,
                description: `👤 ${a.artistName}${durStr ? ` | ⏱️ ${durStr}` : ''}`,
                id: `.${command} dl_${a.url}`
            }
        })

        const msg = generateWAMessageFromContent(m.chat, {
            viewOnceMessage: {
                message: {
                    interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                        body: proto.Message.InteractiveMessage.Body.create({
                            text: `🎵 *نتائج: ${text}*\n📊 ${songs.length} أغنية`
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
        console.error('Apple search error:', e)
        await m.react('❌')
        m.reply('❌ ' + e.message)
    }
}

handler.help = ['ابل']
handler.tags = ['downloader']
handler.command = /^(ابل|applemusic|apple)$/i

export default handler
