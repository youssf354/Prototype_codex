// plugins/q4-facebook.js
// ✧ 2B - YoRHa Unit No.2 Type B - تحميل من فيسبوك 📘

import { theme } from '../core/theme.js';
import axios from "axios";

// دالة استخراج البيانات
function parseString(string) {
    try {
        return JSON.parse(`{"text": "${string}"}`).text;
    } catch (e) {
        return string;
    }
}

function match(data, ...patterns) {
    for (const pattern of patterns) {
        const result = data.match(pattern);
        if (result) return result;
    }
    return null;
}

async function fesnuk(postUrl, cookie = "", userAgent = "") {
    if (!postUrl || !postUrl.trim()) throw new Error("يرجى تحديد رابط فيسبوك صالح.");
    if (!/(facebook.com|fb.watch)/.test(postUrl)) throw new Error("رابط فيسبوك غير صالح.");

    const headers = {
        "sec-fetch-user": "?1",
        "sec-ch-ua-mobile": "?0",
        "sec-fetch-site": "none",
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "cache-control": "max-age=0",
        authority: "www.facebook.com",
        "upgrade-insecure-requests": "1",
        "accept-language": "en-GB,en;q=0.9",
        "sec-ch-ua": '"Google Chrome";v="89", "Chromium";v="89", ";Not A Brand";v="99"',
        "user-agent": userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4389.114 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
        cookie: cookie || "",
    };

    try {
        const { data } = await axios.get(postUrl, { headers });
        const extractData = data.replace(/"/g, '"').replace(/&/g, "&");

        const sdUrl = match(extractData, /"browser_native_sd_url":"(.*?)"/, /sd_src\s*:\s*"([^"]*)"/)?.[1];
        const hdUrl = match(extractData, /"browser_native_hd_url":"(.*?)"/, /hd_src\s*:\s*"([^"]*)"/)?.[1];
        const title = match(extractData, /<meta\sname="description"\scontent="(.*?)"/)?.[1] || "";

        if (sdUrl) {
            return {
                url: postUrl,
                title: parseString(title),
                quality: {
                    sd: parseString(sdUrl),
                    hd: parseString(hdUrl || ""),
                },
            };
        } else {
            throw new Error("تعذر جلب الوسائط في هذا الوقت. حاول مرة أخرى.");
        }
    } catch (error) {
        console.error("Error:", error);
        throw new Error("تعذر جلب الوسائط في هذا الوقت. حاول مرة أخرى.");
    }
}

let handler = async (m, { args, conn, usedPrefix }) => {
    
    // التحقق من وجود رابط
    if (!args[0]) {
        return conn.reply(m.chat, theme.build([
            { type: 'title', text: '📘 2B: "وحدة تحميل فيسبوك"' },
            { type: 'subtitle', text: 'يرجى وضع رابط فيسبوك بعد الأمر' },
            { type: 'divider' },
            { type: 'info', label: '📌 مثال', value: `${usedPrefix}فيسبوك https://fb.watch/xyz` },
            { type: 'info', label: '📌 أو', value: `${usedPrefix}fb https://facebook.com/...` }
        ]), m);
    }

    await conn.sendMessage(m.chat, { react: { text: '📥', key: m.key } });

    await conn.reply(m.chat, theme.build([
        { type: 'title', text: '📥 2B: "جاري التحميل"' },
        { type: 'subtitle', text: '⏳ يرجى الانتظار...' }
    ]), m);

    try {
        let result = await fesnuk(args[0]);

        // ✅ التحميل بأعلى جودة متاحة (HD وإلا SD)
        let videoUrl = result.quality.hd || result.quality.sd;
        let qualityLabel = result.quality.hd ? 'HD' : 'SD';

        if (videoUrl) {
            await conn.sendMessage(m.chat, {
                video: { url: videoUrl },
                mimetype: 'video/mp4',
                caption: theme.build([
                    { type: 'title', text: '✅ 2B: "تم التحميل"' },
                    { type: 'subtitle', text: result.title.substring(0, 60) },
                    { type: 'divider' },
                    { type: 'info', label: '📊 الجودة', value: qualityLabel },
                    { type: 'info', label: '📘 المصدر', value: 'فيسبوك' }
                ])
            }, { quoted: m });

            await conn.sendMessage(m.chat, { react: { text: '✅', key: m.key } });
        } else {
            await conn.reply(m.chat, theme.build([
                { type: 'title', text: '❄️ 2B: "فشل التحميل"' },
                { type: 'warning', text: 'تعذر جلب الفيديو' }
            ]), m);
            await conn.sendMessage(m.chat, { react: { text: '❌', key: m.key } });
        }
    } catch (e) {
        console.error('[2B-FB]', e);
        await conn.sendMessage(m.chat, { react: { text: '❌', key: m.key } });
        await conn.reply(m.chat, theme.build([
            { type: 'title', text: '❄️ 2B: "فشلت المهمة"' },
            { type: 'warning', text: e.message || 'حدث خطأ أثناء التحميل' },
            { type: 'divider' },
            { type: 'line', text: 'تأكد من صحة الرابط وحاول مرة أخرى' }
        ]), m);
    }
};

handler.help = ['فيسبوك', 'فيس'];
handler.tags = ['downloader'];
handler.command = /^(فيس|fb|face)$/i;

export default handler;
