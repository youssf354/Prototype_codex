// plugins/spotify.js
import axios from 'axios';
import { generateWAMessageFromContent, proto, prepareWAMessageMedia } from '@whiskeysockets/baileys';

const API_URL = 'https://2b.hidenfree.com';

async function searchSpotify(query, limit = 10) {
    const { data } = await axios.get(`${API_URL}/api/spotify/search`, {
        params: { q: query, limit },
        timeout: 30000,
        validateStatus: () => true
    });
    return data;
}

async function downloadSpotify(query) {
    const { data } = await axios.get(`${API_URL}/api/spotify/public`, {
        params: { api_key: 'free_key', q: query },
        timeout: 300000,
        validateStatus: () => true
    });
    return data;
}

async function downloadFile(fileKey) {
    const res = await axios.get(`${API_URL}/api/spotify/download?file=${fileKey}`, {
        responseType: 'arraybuffer',
        timeout: 300000,
        validateStatus: () => true
    });
    return Buffer.from(res.data);
}

let handler = async (m, { conn, text }) => {
    if (!text) return m.reply('🎵 *Spotify*\n\n📌 .سبوتيفاي <اسم الأغنية>');

    if (text.startsWith('dl_')) {
        const encodedData = text.replace('dl_', '');
        
        await m.react('⏳');

        try {
            const decoded = decodeURIComponent(encodedData);
            const [title, artist, album, duration, explicit, thumb, url] = decoded.split('|');

            // ✅ 1. أرسل المعلومات + الصورة الأول
            let msgText = `🎵 *${title}*\n`;
            if (artist && artist !== 'undefined') msgText += `👤 *الفنان:* ${artist}\n`;
            if (album && album !== 'undefined') msgText += `💿 *الألبوم:* ${album}\n`;
            if (duration && duration !== 'undefined') msgText += `⏱️ *المدة:* ${duration}\n`;
            if (explicit === 'true') msgText += `🔞 *Explicit:* نعم\n`;

            if (thumb && thumb !== 'undefined' && thumb !== 'null') {
                await conn.sendMessage(m.chat, {
                    image: { url: thumb },
                    caption: msgText
                }, { quoted: m });
            } else {
                await m.reply(msgText);
            }

            // ✅ 2. بعدها نبدأ التحميل
            await m.reply('⏳ *جاري التحميل...*');

            const searchQuery = `${title} ${artist}`.trim();
            const dlData = await downloadSpotify(searchQuery);
            
            if (!dlData?.success || !dlData?.fileKey) throw new Error(dlData?.error || 'فشل التحميل');

            const audioBuffer = await downloadFile(dlData.fileKey);
            if (!audioBuffer.length) throw new Error('ملف فارغ');

            await conn.sendMessage(m.chat, {
                audio: audioBuffer,
                mimetype: 'audio/mpeg',
                fileName: `${title}.mp3`,
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
        const data = await searchSpotify(text, 10);
        const tracks = data?.tracks || [];
        
        if (!tracks.length) { await m.react('❌'); return m.reply('❌ لا توجد نتائج'); }

        let headerImageBuffer = null;
        for (const t of tracks) {
            if (t.thumb) {
                try {
                    const imgRes = await axios.get(t.thumb, { responseType: 'arraybuffer', timeout: 15000 });
                    headerImageBuffer = Buffer.from(imgRes.data);
                    break;
                } catch {}
            }
        }

        let header = { hasMediaAttachment: false };
        if (headerImageBuffer) {
            try {
                const media = await prepareWAMessageMedia(
                    { image: headerImageBuffer },
                    { upload: conn.waUploadToServer }
                );
                header = { hasMediaAttachment: true, imageMessage: media.imageMessage };
            } catch {}
        }

        let rows = tracks.map((t, i) => {
            const encodedData = encodeURIComponent(`${t.title}|${t.artist}|${t.album}|${t.duration}|${t.explicit}|${t.thumb}|${t.url}`);
            return {
                title: `${i + 1}. ${t.title}`,
                description: `👤 ${t.artist} | 💿 ${t.album} | ⏱️ ${t.duration}`,
                id: `.سبوتيفاي dl_${encodedData}`
            };
        });

        const msg = generateWAMessageFromContent(m.chat, {
            viewOnceMessage: {
                message: {
                    interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                        body: proto.Message.InteractiveMessage.Body.create({ text: `🎵 *نتائج: ${text}*\n📊 ${tracks.length} أغنية` }),
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
        console.error('[Spotify]', e.message);
        await m.react('❌');
    }
};

handler.command = /^(سبوتيفاي|spotify|spot)$/i;
handler.tags = ['downloader'];
export default handler;
