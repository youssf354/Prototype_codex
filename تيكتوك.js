// plugins/tiktok.js
import axios from 'axios';
import { generateWAMessageFromContent, proto, prepareWAMessageMedia } from '@whiskeysockets/baileys';

const API_URL = 'https://2b.hidenfree.com';

let handler = async (m, { conn, text, usedPrefix, command }) => {
    if (!text) return m.reply(`🎬 *TikTok / ايديت*\n\n⚔️ ${usedPrefix + command} <رابط أو اسم>`);

    if (text.includes('tiktok.com') || text.includes('vt.tiktok')) {
        await processVideo(m, conn, text);
        return;
    }

    let searchQuery = text;
    if (command === 'ايديت' || command === 'edit') {
        searchQuery = text + ' edit';
    }

    await m.react('🔍');
    try {
        const { data } = await axios.get(`${API_URL}/api/tiktok/search`, {
            params: { q: searchQuery, limit: 12 },
            timeout: 30000,
            validateStatus: () => true
        });

        let videos = data?.results || data?.data || [];
        if (!videos.length) return m.reply('❌ لا توجد نتائج');

        let cards = [];

        for (let i = 0; i < Math.min(videos.length, 12); i++) {
            const v = videos[i];
            if (!v.id) continue;

            try {
                const videoMedia = await prepareWAMessageMedia(
                    { video: { url: `https://2b.hidenfree.com/api/tiktok/download-proxy?id=${v.id}` } },
                    { upload: conn.waUploadToServer }
                );

                cards.push({
                    body: proto.Message.InteractiveMessage.Body.fromObject({ text: `👤 ${v.channel || v.author || 'مجهول'}` }),
                    footer: proto.Message.InteractiveMessage.Footer.fromObject({ text: '✧ 2B' }),
                    header: proto.Message.InteractiveMessage.Header.fromObject({
                        title: (v.title || 'TikTok').substring(0, 50),
                        hasMediaAttachment: true,
                        videoMessage: videoMedia.videoMessage
                    }),
                    nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({ buttons: [] })
                });
            } catch {}
        }

        if (!cards.length) return m.reply('❌ فشل إنشاء البطاقات');

        const msg = generateWAMessageFromContent(m.chat, {
            viewOnceMessage: {
                message: {
                    interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                        body: proto.Message.InteractiveMessage.Body.create({ text: `🎬 *${text}*` }),
                        footer: proto.Message.InteractiveMessage.Footer.create({ text: '✧ 2B' }),
                        header: proto.Message.InteractiveMessage.Header.create({ hasMediaAttachment: false }),
                        carouselMessage: proto.Message.InteractiveMessage.CarouselMessage.fromObject({ cards })
                    })
                }
            }
        }, { quoted: m });

        await conn.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
        await m.react('✅');

    } catch (e) {
        console.error(e.message);
        await m.react('❌');
    }
};

async function processVideo(m, conn, url) {
    await m.react('⏳');

    try {
        let info = { title: '', thumbnail: '', uploader: '' };

        try {
            const { data } = await axios.get(`${API_URL}/api/tiktok/info`, {
                params: { url },
                timeout: 30000,
                validateStatus: () => true
            });
            if (data?.title) info = data;
        } catch {}

        let msgText = `🎬 *${info.title?.substring(0, 60) || 'TikTok'}*\n`;
        if (info.uploader) msgText += `👤 ${info.uploader}\n`;

        if (info.thumbnail) {
            await conn.sendMessage(m.chat, {
                image: { url: info.thumbnail },
                caption: msgText
            }, { quoted: m });
        }

        try {
            const videoData = await axios.get(`${API_URL}/api/tiktok/public`, {
                params: { api_key: 'free_key', url, type: 'video' },
                timeout: 300000,
                validateStatus: () => true
            });

            if (videoData.data?.success) {
                const videoBuffer = await downloadFile(videoData.data.fileKey);
                await conn.sendMessage(m.chat, { video: videoBuffer }, { quoted: m });
            }
        } catch {}

        try {
            const audioData = await axios.get(`${API_URL}/api/tiktok/public`, {
                params: { api_key: 'free_key', url, type: 'audio' },
                timeout: 300000,
                validateStatus: () => true
            });

            if (audioData.data?.success) {
                const audioBuffer = await downloadFile(audioData.data.fileKey);
                await conn.sendMessage(m.chat, {
                    audio: audioBuffer,
                    mimetype: 'audio/mpeg',
                    fileName: 'tiktok.mp3',
                    ptt: false
                }, { quoted: m });
            }
        } catch {}

        await m.react('✅');

    } catch {
        await m.react('❌');
    }
}

async function downloadFile(fileKey) {
    const res = await axios.get(`${API_URL}/api/tiktok/download?file=${fileKey}`, {
        responseType: 'arraybuffer',
        timeout: 300000,
        validateStatus: () => true
    });
    return Buffer.from(res.data);
}

handler.command = /^(تيك|tiktok|tik|ايديت|edit)$/i;
handler.tags = ['downloader'];
export default handler;
