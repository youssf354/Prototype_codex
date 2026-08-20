// plugins/soundcloud.js
import axios from 'axios';
import { generateWAMessageFromContent, proto, prepareWAMessageMedia } from '@whiskeysockets/baileys';

const API_URL = 'https://2b.hidenfree.com';

async function searchSoundCloud(query, limit = 10) {
    const { data } = await axios.get(`${API_URL}/api/soundcloud/search`, {
        params: { q: query, limit },
        timeout: 30000,
        validateStatus: () => true
    });
    return data?.results || data?.data || [];
}

async function downloadSoundCloud(url) {
    const { data } = await axios.get(`${API_URL}/api/soundcloud/public`, {
        params: { api_key: 'free_key', url },
        timeout: 300000,
        validateStatus: () => true
    });
    return data;
}

async function downloadFile(fileKey) {
    const res = await axios.get(`${API_URL}/api/soundcloud/download?file=${fileKey}`, {
        responseType: 'arraybuffer',
        timeout: 300000,
        validateStatus: () => true
    });
    return Buffer.from(res.data);
}

let handler = async (m, { conn, text }) => {
    // ✅ تحميل من رابط
    if (text && text.includes('soundcloud.com')) {
        await m.react('⏳');
        try {
            const dlData = await downloadSoundCloud(text);
            if (!dlData?.success || !dlData?.fileKey) throw new Error('فشل التحميل');

            const audioBuffer = await downloadFile(dlData.fileKey);
            if (!audioBuffer.length) throw new Error('ملف فارغ');

            await conn.sendMessage(m.chat, {
                audio: audioBuffer,
                mimetype: 'audio/mpeg',
                fileName: dlData.filename || 'soundcloud.mp3',
                ptt: false
            }, { quoted: m });

            await m.react('✅');
        } catch (e) {
            await m.react('❌');
            m.reply('❌ ' + e.message);
        }
        return;
    }

    if (!text) return m.reply('🎵 *الأغاني*\n\n📌 .اغنية <اسم الأغنية>\n📌 .اغنية <رابط>');

    await m.react('🔍');

    try {
        const tracks = await searchSoundCloud(text, 10);
        if (!tracks.length) { await m.react('❌'); return m.reply('❌ لا توجد نتائج'); }

        let headerImage = null;
        for (const track of tracks) {
            if (track.thumbnail) {
                try {
                    const imgRes = await axios.get(track.thumbnail, { responseType: 'arraybuffer', timeout: 15000 });
                    headerImage = Buffer.from(imgRes.data);
                    break;
                } catch {}
            }
        }

        let rows = [];
        for (let i = 0; i < tracks.length; i++) {
            const t = tracks[i];
            rows.push({
                title: `${i + 1}. ${t.title.substring(0, 40)}`,
                description: `👤 ${t.artist || ''} | ⏱️ ${t.duration || ''}`,
                id: `.اغنية ${t.url}`
            });
        }

        let header = { hasMediaAttachment: false };
        if (headerImage) {
            const media = await prepareWAMessageMedia(
                { image: headerImage },
                { upload: conn.waUploadToServer }
            );
            header = { hasMediaAttachment: true, imageMessage: media.imageMessage };
        }

        const msg = generateWAMessageFromContent(m.chat, {
            viewOnceMessage: {
                message: {
                    interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                        body: proto.Message.InteractiveMessage.Body.create({
                            text: `🎵 *نتائج:* ${text}\n📊 ${tracks.length} أغنية`
                        }),
                        footer: proto.Message.InteractiveMessage.Footer.create({ text: '✧ 2B' }),
                        header: proto.Message.InteractiveMessage.Header.fromObject(header),
                        nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
                            buttons: [{
                                name: 'single_select',
                                buttonParamsJson: JSON.stringify({
                                    title: "🎵 اختر الأغنية",
                                    sections: [{ title: "نتائج البحث", rows }]
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
        console.error('[SC]', e.message);
        await m.react('❌');
    }
};

handler.command = /^(اغنية|اغنيه|song|soundcloud|sc)$/i;
handler.tags = ['downloader'];
export default handler;
