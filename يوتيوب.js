import axios from 'axios';
import { generateWAMessageFromContent, proto, prepareWAMessageMedia } from '@whiskeysockets/baileys';

const API_URL = 'https://2b.hidenfree.com';

let handler = async (m, { conn, text, usedPrefix, command }) => {
    if (!text) return m.reply(`🎬 *YouTube*\n\n⚔️ ${usedPrefix + command} <رابط أو اسم>`);

    if (text.startsWith('dl_')) {
        let parts = text.split('_');
        let type = parts[1];
        let quality = parts[2];
        let url = parts.slice(3).join('_');
        await downloadAndSend(m, conn, url, type, quality);
        return;
    }

    if (text.startsWith('select_')) {
        let parts = text.split('_');
        let searchId = parts[1];
        let index = parseInt(parts[2]);
        let results = global.ytResults?.[searchId];
        if (!results || !results[index]) return m.reply('⏰ انتهت الصلاحية');
        await showVideoInfo(m, conn, results[index]);
        return;
    }

    if (text.includes('youtu.be') || text.includes('youtube.com')) {
        await m.react('🔍');
        try {
            const { data } = await axios.get(`${API_URL}/api/youtube/info`, {
                params: { url: text },
                timeout: 30000,
                validateStatus: () => true
            });
            
            if (data?.title) {
                await showVideoInfo(m, conn, {
                    url: text,
                    title: data.title,
                    thumbnail: data.thumbnail,
                    duration: data.duration,
                    channel: data.channel || data.uploader,
                    views: data.views
                });
            } else {
                await showVideoInfo(m, conn, { url: text, title: 'فيديو يوتيوب', thumbnail: null });
            }
        } catch (e) {
            await showVideoInfo(m, conn, { url: text, title: 'فيديو يوتيوب', thumbnail: null });
        }
        return;
    }

    await m.react('🔍');
    try {
        const { data } = await axios.get(`${API_URL}/api/youtube/search`, {
            params: { q: text, limit: 6 },
            timeout: 30000,
            validateStatus: () => true
        });

        let videos = data?.videos || data?.data || data?.results || [];

        if (!videos.length) return m.reply('❌ لا توجد نتائج');

        global.ytResults = global.ytResults || {};
        let searchId = Date.now();
        global.ytResults[searchId] = videos.map(v => ({
            url: v.url || v.link || '',
            title: v.title || v.name || 'بدون عنوان',
            thumbnail: v.thumbnail || v.thumb || '',
            duration: v.duration_string || v.duration || '',
            author: v.channel || v.author || ''
        }));
        setTimeout(() => delete global.ytResults[searchId], 120000);

        let imgMsg = null;
        try { 
            const thumb = global.ytResults[searchId][0]?.thumbnail;
            if (thumb) imgMsg = await prepareWAMessageMedia({ image: { url: thumb } }, { upload: conn.waUploadToServer }); 
        } catch {}

        let rows = global.ytResults[searchId].map((v, i) => ({
            title: `${i+1}. ${v.title.substring(0, 45)}`,
            description: `📺 ${v.author} | ⏱️ ${v.duration}`,
            id: `.yt select_${searchId}_${i}`
        }));

        const msg = generateWAMessageFromContent(m.chat, {
            viewOnceMessage: { message: { interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                body: { text: `🔍 *نتائج البحث:* ${text}` },
                footer: { text: '✧ 2B - YoRHa Unit ✧' },
                header: { hasMediaAttachment: !!imgMsg?.imageMessage, imageMessage: imgMsg?.imageMessage || null },
                nativeFlowMessage: { buttons: [{ name: 'single_select', buttonParamsJson: JSON.stringify({ title: "🎬 نتائج البحث", sections: [{ title: "اختر الفيديو", rows }] }) }], messageParamsJson: '' }
            })}}
        }, { userJid: conn.user.jid, quoted: m });

        await conn.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
    } catch (e) {
        console.error('[YT-Search]', e.message);
        await m.react('❌');
    }
};

async function showVideoInfo(m, conn, data) {
    await m.react('⏳');

    let title = data.title || 'فيديو يوتيوب';
    let url = data.url;
    let infoText = `🎬 *${title?.substring(0, 80)}*`;

    if (data.duration) infoText += `\n⏱️ *المدة:* ${data.duration}`;
    if (data.channel) infoText += `\n👤 *القناة:* ${data.channel}`;
    if (data.views) infoText += `\n👁️ *المشاهدات:* ${Number(data.views).toLocaleString()}`;

    let imgMsg = null;
    try { 
        if (data.thumbnail) imgMsg = await prepareWAMessageMedia({ image: { url: data.thumbnail } }, { upload: conn.waUploadToServer }); 
    } catch {}

    let rows = [
        { title: "🎵 MP3 128k", description: "صوت", id: `.yt dl_audio_128_${url}` },
        { title: "🎵 MP3 320k", description: "صوت عالي", id: `.yt dl_audio_320_${url}` },
        { title: "🎬 360p", description: "فيديو", id: `.yt dl_video_360_${url}` },
        { title: "🎬 720p", description: "HD", id: `.yt dl_video_720_${url}` },
        { title: "🎬 1080p", description: "Full HD", id: `.yt dl_video_1080_${url}` }
    ];

    const msg = generateWAMessageFromContent(m.chat, {
        viewOnceMessage: { message: { interactiveMessage: proto.Message.InteractiveMessage.fromObject({
            body: { text: `${infoText}\n\n🎚️ اختر الجودة:` },
            footer: { text: '✧ 2B - YoRHa Unit ✧' },
            header: { hasMediaAttachment: !!imgMsg?.imageMessage, imageMessage: imgMsg?.imageMessage || null },
            nativeFlowMessage: { buttons: [{ name: 'single_select', buttonParamsJson: JSON.stringify({ title: "اختر الجودة", sections: [{ title: "جودات التحميل", rows }] }) }], messageParamsJson: '' }
        })}}
    }, { userJid: conn.user.jid, quoted: m });

    await conn.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
}

async function downloadAndSend(m, conn, url, type, quality) {
    await m.react('⏳');
    let statusMsg = await m.reply('⏳ *جاري التحميل...*');

    try {
        const { data } = await axios.get(`${API_URL}/api/youtube/public`, {
            params: { api_key: 'free_key', url, type, quality },
            timeout: 300000,
            validateStatus: () => true
        });

        if (!data?.success) throw new Error(data?.error || 'فشل التحميل');

        const downloadUrl = `${API_URL}/api/youtube/download?file=${data.fileKey}`;
        const mediaRes = await axios.get(downloadUrl, {
            responseType: 'arraybuffer',
            timeout: 300000,
            validateStatus: () => true
        });

        const buffer = Buffer.from(mediaRes.data);
        if (!buffer.length) throw new Error('ملف فارغ');

        const sizeMB = (buffer.length / 1024 / 1024).toFixed(2);
        try { await conn.sendMessage(m.chat, { delete: statusMsg.key }); } catch {}

        if (type === 'audio') {
            await conn.sendMessage(m.chat, {
                audio: buffer,
                mimetype: 'audio/mpeg',
                fileName: data.filename || 'youtube.mp3',
                ptt: false
            }, { quoted: m });
        } else {
            await conn.sendMessage(m.chat, {
                video: buffer,
                caption: `✅ *${data.title || 'تم التحميل'}*\n📁 ${sizeMB} MB`
            }, { quoted: m });
        }

        await m.react('✅');

    } catch (e) {
        console.error('[YT]', e.message);
        try { await conn.sendMessage(m.chat, { delete: statusMsg.key }); } catch {}
        await m.react('❌');
        m.reply(`❌ ${e.message || 'فشل التحميل'}`);
    }
}

handler.command = /^(يوتيوب|yt|youtube)$/i;
handler.tags = ['downloader'];
export default handler;
