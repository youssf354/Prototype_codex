// plugins/nanoedit.js
import axios from 'axios';
import FormData from 'form-data';

async function uploadImage(buffer) {
    const fd = new FormData();
    fd.append('file', buffer, { filename: 'nano_' + Date.now() + '.jpg' });
    fd.append('type', 'permanent');
    const r = await axios.post('https://tmp.malvryx.dev/upload', fd, {
        headers: fd.getHeaders(),
        timeout: 45000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity
    });
    return r.data?.cdnUrl || r.data?.directUrl || null;
}

let handler = async (m, { conn, text }) => {
    if (!text) return m.reply('🎨 *نانو*\n\n📌 .نانو <وصف> - توليد\n📌 رد على صورة + .نانو <وصف> - تعديل');

    await m.react('🎨');

    try {
        let imageBuffer = null;

        if (m.quoted?.mtype === 'imageMessage' || m.quoted?.mediaType === 'image') {
            imageBuffer = await m.quoted.download();
        }
        if (m.mtype === 'imageMessage' || m.mediaType === 'image') {
            imageBuffer = await m.download();
            if (!text) text = m.msg?.caption || '';
        }

        let result;

        if (imageBuffer) {
            const imageUrl = await uploadImage(imageBuffer);
            if (!imageUrl) throw new Error('فشل رفع الصورة');

            result = await axios.get('https://2b.hidenfree.com/api/nano/public', {
                params: { api_key: 'free_key', prompt: text, image: imageUrl },
                timeout: 180000,
                validateStatus: () => true
            });
        } else {
            result = await axios.get('https://2b.hidenfree.com/api/nano/public', {
                params: { api_key: 'free_key', prompt: text },
                timeout: 180000,
                validateStatus: () => true
            });
        }

        const data = result.data;

        if (!data?.success || !data?.fileKey) {
            throw new Error(data?.error || 'فشل');
        }

        const imageRes = await axios.get(`https://2b.hidenfree.com/api/nano/download?file=${data.fileKey}`, {
            responseType: 'arraybuffer',
            timeout: 60000
        });

        const imageBuf = Buffer.from(imageRes.data);
        if (!imageBuf.length) throw new Error('صورة فارغة');

        await conn.sendMessage(m.chat, {
            image: imageBuf,
            caption: `✅ *${imageBuffer ? 'تم التعديل' : 'تم التوليد'}*\n📝 ${text}\n🔹 ${data.source}`
        }, { quoted: m });

        await m.react('✅');

    } catch (e) {
        console.error('[Nano]', e.message);
        await m.react('❌');
        m.reply('❌ ' + e.message);
    }
};

handler.command = /^(نانو|nano|تعديل|edit)$/i;
handler.tags = ['ai'];
export default handler;
