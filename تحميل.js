// plugins/universal.js
import axios from 'axios';

const API_URL = 'https://2b.hidenfree.com';

async function getInfo(url) {
    const { data } = await axios.get(`${API_URL}/api/universal/info`, {
        params: { url },
        timeout: 30000,
        validateStatus: () => true
    });
    return data;
}

async function download(url, type = 'video') {
    const { data } = await axios.get(`${API_URL}/api/universal/public`, {
        params: { api_key: 'free_key', url, type },
        timeout: 300000,
        validateStatus: () => true
    });
    return data;
}

async function downloadFile(fileKey) {
    const res = await axios.get(`${API_URL}/api/universal/download?file=${fileKey}`, {
        responseType: 'arraybuffer',
        timeout: 300000,
        validateStatus: () => true
    });
    return Buffer.from(res.data);
}

let handler = async (m, { conn, text }) => {
    if (!text) return m.reply('📥 *تحميل عام*\n\n📌 .تحميل <رابط>');

    if (!text.includes('http')) return m.reply('❌ أرسل رابط صالح');

    await m.react('⏳');

    try {
        // ✅ 1. جلب المعلومات
        const info = await getInfo(text);

        // ✅ 2. إرسال معلومات + صورة
        let msgText = `📥 *${info.title || 'فيديو'}*\n`;
        if (info.uploader || info.author) msgText += `👤 ${info.uploader || info.author}\n`;
        if (info.duration) msgText += `⏱️ ${info.duration}\n`;
        if (info.views) msgText += `👁 ${info.views}\n`;
        msgText += `\n⏳ *جاري التحميل...*`;

        if (info.thumbnail || info.cover) {
            await conn.sendMessage(m.chat, {
                image: { url: info.thumbnail || info.cover },
                caption: msgText
            }, { quoted: m });
        } else {
            await m.reply(msgText);
        }

        // ✅ 3. التحميل
        const dlData = await download(text, 'video');
        if (!dlData?.success || !dlData?.fileKey) throw new Error(dlData?.error || 'فشل التحميل');

        const buffer = await downloadFile(dlData.fileKey);
        if (!buffer.length) throw new Error('ملف فارغ');

        const mime = dlData.mime || 'video/mp4';

        if (mime.includes('video')) {
            await conn.sendMessage(m.chat, {
                video: buffer,
                caption: `✅ *${dlData.title || info.title || 'تم التحميل'}*`
            }, { quoted: m });
        } else if (mime.includes('audio')) {
            await conn.sendMessage(m.chat, {
                audio: buffer,
                mimetype: 'audio/mpeg',
                fileName: dlData.filename || 'audio.mp3',
                ptt: false
            }, { quoted: m });
        } else {
            await conn.sendMessage(m.chat, {
                document: buffer,
                fileName: dlData.filename || 'file',
                mimetype: mime
            }, { quoted: m });
        }

        await m.react('✅');

    } catch (e) {
        console.error('[Universal]', e.message);
        await m.react('❌');
        m.reply('❌ ' + e.message);
    }
};

handler.command = /^(تحميل|universal|download)$/i;
handler.tags = ['downloader'];
export default handler;

