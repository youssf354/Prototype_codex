// plugins/tts.js
import axios from 'axios';

const API_URL = 'https://2b.hidenfree.com';

const VOICES = {
    'منى': 'woman1',
    'سارة': 'woman2',
    'ليلى': 'woman3',
    'أحمد': 'man1',
    'عمر': 'man2',
    'خالد': 'man3'
};

let handler = async (m, { conn, text }) => {
    if (!text) {
        return m.reply(`🔊 *صوت*\n\n📌 .صوت <النص>\n📌 .صوت منى <النص>\n\n👥 الأصوات: منى، سارة، ليلى، أحمد، عمر، خالد`);
    }

    let voice = 'woman1';
    let speechText = text;

    const firstWord = text.split(' ')[0];
    if (VOICES[firstWord]) {
        voice = VOICES[firstWord];
        speechText = text.split(' ').slice(1).join(' ');
    }

    if (!speechText) return m.reply('❌ اكتب النص');

    await m.react('🔊');

    try {
        const result = await axios.get(`${API_URL}/api/tts/public`, {
            params: { api_key: 'free_key', text: speechText, voice },
            timeout: 120000,
            validateStatus: () => true
        });

        if (!result.data?.success || !result.data?.fileKey) {
            throw new Error(result.data?.error || 'فشل');
        }

        // ✦ تحميل الصوت مباشرة من fileHandler
        const fileRes = await axios.get(`${API_URL}/api/tts/download?file=${result.data.fileKey}`, {
            responseType: 'arraybuffer',
            timeout: 60000,
            validateStatus: () => true
        });

        const audioBuffer = Buffer.from(fileRes.data);

        if (!audioBuffer.length || audioBuffer.length < 500) {
            throw new Error('صوت فارغ');
        }

        await conn.sendMessage(m.chat, {
            audio: audioBuffer,
            mimetype: 'audio/mpeg',
            ptt: false,
            fileName: `${speechText.substring(0, 30)}.mp3`
        }, { quoted: m });

        await m.react('✅');

    } catch (e) {
        console.error('[TTS]', e.message);
        await m.react('❌');
        m.reply('❌ ' + e.message);
    }
};

handler.command = /^(صوت|tts|speak|قول)$/i;
handler.tags = ['tools'];
export default handler;

