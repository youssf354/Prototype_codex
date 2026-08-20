// plugins/pinterest.js
import axios from 'axios';
import { generateWAMessageFromContent, proto, prepareWAMessageMedia } from '@whiskeysockets/baileys';

const API_URL = 'https://2b.hidenfree.com';

async function searchPinterest(query, type, limit = 10) {
    const { data } = await axios.get(`${API_URL}/api/pinterest/search`, {
        params: { q: query, type, limit },
        timeout: 30000,
        validateStatus: () => true
    });
    return data?.results || [];
}

async function downloadPinterest(url, type = 'auto') {
    const { data } = await axios.get(`${API_URL}/api/pinterest/public`, {
        params: { api_key: 'free_key', url, type },
        timeout: 300000,
        validateStatus: () => true
    });
    return data;
}

async function downloadFile(fileKey) {
    const res = await axios.get(`${API_URL}/api/pinterest/download?file=${fileKey}`, {
        responseType: 'arraybuffer',
        timeout: 300000,
        validateStatus: () => true
    });
    return Buffer.from(res.data);
}

let handler = async (m, { conn, text, command }) => {
    const cmd = command.toLowerCase();
    const react = async (emoji) => {
        try { await conn.sendMessage(m.chat, { react: { text: emoji, key: m.key } }); } catch {}
    };

    if (!text) return m.reply('📌 .بنترست <كلمة> - صور\n🎬 .بنترست_فيديو <كلمة> - فيديوهات\n🔗 .بنترست <رابط> - تحميل');

    // ✅ تحميل من رابط
    if (text.includes('pin.it') || text.includes('pinterest.com/pin/')) {
        await react('⏳');

        try {
            const dlData = await downloadPinterest(text, 'auto');
            
            if (!dlData?.success || !dlData?.fileKey) {
                await react('❌');
                return m.reply('❌ ' + (dlData?.error || 'فشل التحميل'));
            }

            const buffer = await downloadFile(dlData.fileKey);
            if (!buffer.length) throw new Error('ملف فارغ');

            const mime = dlData.mime || 'video/mp4';
            const title = dlData.title || 'Pinterest';

            if (mime.includes('video')) {
                await conn.sendMessage(m.chat, { video: buffer, caption: `✅ *${title}*` }, { quoted: m });
            } else {
                await conn.sendMessage(m.chat, { image: buffer, caption: `✅ *${title}*` }, { quoted: m });
            }

            await react('✅');
        } catch (e) {
            await react('❌');
            m.reply('❌ ' + e.message);
        }
        return;
    }

    // ✅ فيديوهات
    if (cmd === 'بنترست_فيديو' || cmd === 'بينترست_فيديو') {
        await react('⏳');
        const videos = await searchPinterest(text, 'video', 5);
        if (!videos.length) { await react('❌'); return m.reply('❌ لا توجد فيديوهات'); }

        let cards = [];
        for (let v of videos) {
            try {
                const dlData = await downloadPinterest(v.url, 'video');
                if (!dlData?.success || !dlData?.fileKey) continue;
                const buffer = await downloadFile(dlData.fileKey);
                const media = await prepareWAMessageMedia({ video: buffer }, { upload: conn.waUploadToServer });
                cards.push({
                    body: proto.Message.InteractiveMessage.Body.fromObject({ text: `🎬 ${v.title || ''}` }),
                    footer: proto.Message.InteractiveMessage.Footer.fromObject({ text: '✧ 2B' }),
                    header: proto.Message.InteractiveMessage.Header.fromObject({ title: (v.title || 'Pinterest').substring(0, 50), hasMediaAttachment: true, videoMessage: media.videoMessage }),
                    nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({ buttons: [] })
                });
            } catch {}
        }

        if (!cards.length) { await react('❌'); return m.reply('❌ فشل التحميل'); }

        const msg = generateWAMessageFromContent(m.chat, {
            viewOnceMessage: { message: { interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                body: proto.Message.InteractiveMessage.Body.create({ text: `🎬 *Pinterest: ${text}*` }),
                footer: proto.Message.InteractiveMessage.Footer.create({ text: '✧ 2B' }),
                header: proto.Message.InteractiveMessage.Header.create({ hasMediaAttachment: false }),
                carouselMessage: proto.Message.InteractiveMessage.CarouselMessage.fromObject({ cards })
            })}}
        }, { quoted: m });
        await conn.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
        await react('✅');
        return;
    }

    // ✅ صور
    await react('🔍');
    const images = await searchPinterest(text, 'image', 10);
    if (!images.length) { await react('❌'); return m.reply('❌ لا توجد صور'); }

    let imageCards = [];
    for (let img of images) {
        try {
            const media = await prepareWAMessageMedia({ image: { url: img.url } }, { upload: conn.waUploadToServer });
            imageCards.push({
                body: proto.Message.InteractiveMessage.Body.fromObject({ text: `📸 ${img.title || ''}` }),
                footer: proto.Message.InteractiveMessage.Footer.fromObject({ text: '✧ 2B' }),
                header: proto.Message.InteractiveMessage.Header.fromObject({ title: (img.title || 'Pinterest').substring(0, 50), hasMediaAttachment: true, imageMessage: media.imageMessage }),
                nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({ buttons: [] })
            });
        } catch {}
    }

    if (!imageCards.length) { await react('❌'); return m.reply('❌ فشل التحميل'); }

    const msg2 = generateWAMessageFromContent(m.chat, {
        viewOnceMessage: { message: { interactiveMessage: proto.Message.InteractiveMessage.fromObject({
            body: proto.Message.InteractiveMessage.Body.create({ text: `📸 *Pinterest: ${text}*` }),
            footer: proto.Message.InteractiveMessage.Footer.create({ text: '✧ 2B' }),
            header: proto.Message.InteractiveMessage.Header.create({ hasMediaAttachment: false }),
            carouselMessage: proto.Message.InteractiveMessage.CarouselMessage.fromObject({ cards: imageCards })
        })}}
    }, { quoted: m });
    await conn.relayMessage(m.chat, msg2.message, { messageId: msg2.key.id });
    await react('✅');
};

handler.command = /^(بنترست|بينترست|بينتر|pinterest|بنترست_فيديو|بينترست_فيديو)$/i;
export default handler;
