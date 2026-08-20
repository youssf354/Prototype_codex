// plugins/applemusic.js
import axios from 'axios';
import sharp from 'sharp';
import { generateWAMessageFromContent, proto, prepareWAMessageMedia } from '@whiskeysockets/baileys';

const API_URL = 'https://2b.hidenfree.com';

async function searchAppleMusic(query, limit = 10) {
    const { data } = await axios.get(`${API_URL}/api/applemusic/search`, {
        params: { q: query, limit },
        timeout: 30000,
        validateStatus: () => true
    });
    return data?.results || [];
}

async function downloadAppleMusic(url) {
    const { data } = await axios.get(`${API_URL}/api/applemusic/public`, {
        params: { api_key: 'free_key', url },
        timeout: 300000,
        validateStatus: () => true
    });
    return data;
}

async function downloadFile(fileKey) {
    const res = await axios.get(`${API_URL}/api/applemusic/download?file=${fileKey}`, {
        responseType: 'arraybuffer',
        timeout: 300000,
        validateStatus: () => true
    });
    return Buffer.from(res.data);
}

// ✅ تحميل الصورة + تحويلها لـ JPEG عشان واتساب يقبلها
async function getValidImageBuffer(url) {
    try {
        const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
        const buffer = Buffer.from(res.data);
        if (buffer.length < 1000) return null;
        
        // ✅ تحويل لـ JPEG
        const jpegBuffer = await sharp(buffer)
            .jpeg({ quality: 90 })
            .resize(600, 600, { fit: 'cover' })
            .toBuffer();
        
        return jpegBuffer;
    } catch {
        return null;
    }
}

let handler = async (m, { conn, text }) => {
    if (!text) return m.reply('🎵 *Apple Music*\n\n📌 .ابل <اسم الأغنية>');

    // ✅ اختيار من زر
    if (text.startsWith('dl_')) {
        const parts = text.split('_');
        const url = parts.slice(1, -1).join('_');
        const artist = decodeURIComponent(parts[parts.length - 1] || '');

        await m.react('⏳');

        try {
            const downloadRes = await downloadAppleMusic(url);

            if (!downloadRes?.success || !downloadRes?.fileKey) {
                throw new Error(downloadRes?.error || 'فشل التحميل');
            }

            let msgText = `🎵 *${downloadRes.title || 'Apple Music'}*\n`;
            if (downloadRes.artist) msgText += `👤 *الفنان:* ${downloadRes.artist}\n`;
            if (downloadRes.album) msgText += `💿 *الألبوم:* ${downloadRes.album}\n`;
            msgText += `\n⏳ *جاري التحميل...*`;

            const coverUrl = downloadRes.thumbnail || downloadRes.cover || downloadRes.artwork;
            if (coverUrl) {
                const imgBuffer = await getValidImageBuffer(coverUrl);
                if (imgBuffer) {
                    await conn.sendMessage(m.chat, {
                        image: imgBuffer,
                        mimetype: 'image/jpeg',
                        caption: msgText
                    }, { quoted: m });
                }
            }

            const audioBuffer = await downloadFile(downloadRes.fileKey);
            if (!audioBuffer.length) throw new Error('ملف فارغ');

            await conn.sendMessage(m.chat, {
                audio: audioBuffer,
                mimetype: 'audio/mpeg',
                fileName: `${downloadRes.title || 'song'}.mp3`,
                ptt: false
            }, { quoted: m });

            await m.react('✅');
        } catch (e) {
            await m.react('❌');
            m.reply('❌ ' + e.message);
        }
        return;
    }

    // ✅ بحث
    await m.react('🔍');

    try {
        const songs = await searchAppleMusic(text, 10);
        if (!songs.length) { await m.react('❌'); return m.reply('❌ لا توجد نتائج'); }

        let headerImageBuffer = null;
        for (const s of songs) {
            if (s.cover) {
                headerImageBuffer = await getValidImageBuffer(s.cover);
                if (headerImageBuffer) break;
            }
        }

        let header = { hasMediaAttachment: false };
        if (headerImageBuffer) {
            try {
                const media = await prepareWAMessageMedia(
                    { image: headerImageBuffer, mimetype: 'image/jpeg' },
                    { upload: conn.waUploadToServer }
                );
                header = { hasMediaAttachment: true, imageMessage: media.imageMessage };
            } catch {}
        }

        let rows = songs.map((s, i) => ({
            title: `${i + 1}. ${s.title}`,
            description: `👤 ${s.artist}${s.explicit ? ' | 🔞' : ''}`,
            id: `.ابل dl_${s.url}_${encodeURIComponent(s.artist)}`
        }));

        const msg = generateWAMessageFromContent(m.chat, {
            viewOnceMessage: {
                message: {
                    interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                        body: proto.Message.InteractiveMessage.Body.create({ text: `🎵 *نتائج: ${text}*\n📊 ${songs.length} أغنية` }),
                        footer: proto.Message.InteractiveMessage.Footer.create({ text: '✧ 2B' }),
                        header: proto.Message.InteractiveMessage.Header.fromObject(header),
                        nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
                            buttons: [{
                                name: 'single_select',
                                buttonParamsJson: JSON.stringify({
                                    title: "🎵 اختر الأغنية",
                                    sections: [{ title: "النتائج", rows }]
                                })
                            }],
                            messageParamsJson: ''
                        })
                    })
                }
            }
        }, { userJid: conn.user.jid, quoted: m });

        await conn.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
        await m.react('✅');

    } catch (e) {
        console.error('[AppleMusic]', e.message);
        await m.react('❌');
    }
};

handler.command = /^(ابل|applemusic|apple)$/i;
handler.tags = ['downloader'];
export default handler;
