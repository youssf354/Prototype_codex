// plugins/manhwa.js
// ♡ Raiden Shogun - Plane of Euthymia - Manhwa 📚

import axios from 'axios';
import cheerio from 'cheerio';
import { 
    prepareWAMessageMedia, 
    generateWAMessageFromContent, 
    proto 
} from '@whiskeysockets/baileys';
import JSZip from 'jszip';
import { Buffer } from 'buffer';

const DEFAULT_IMAGE = 'https://i3.wp.com/despair-manga.net/wp-content/uploads/2025/08/0001-1-1.jpg?w=720';
const CACHE_DURATION = 2 * 60 * 1000;
const MAX_IMAGES_PER_CHAPTER = 50;
const REQUEST_TIMEOUT = 30000;
const RETRY_COUNT = 3;
const BASE_URL = 'https://despair-manga.net';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📦 Cache System
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const cache = new Map();

function getCached(key) {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        return cached.data;
    }
    return null;
}

function setCached(key, data) {
    cache.set(key, { data, timestamp: Date.now() });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔧 Utility Functions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function fetchWithRetry(url, retries = RETRY_COUNT) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await axios.get(url, {
                timeout: REQUEST_TIMEOUT,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'ar,en;q=0.9',
                    'Referer': BASE_URL
                }
            });
            return response;
        } catch (err) {
            if (i === retries - 1) throw err;
            await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
    }
}

async function createImageMessage(conn, url) {
    if (!url || typeof url !== "string" || !url.startsWith("http")) return null;
    try {
        const media = await prepareWAMessageMedia({ image: { url } }, { upload: conn.waUploadToServer });
        return media.imageMessage || null;
    } catch {
        return null;
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ℹ️ جلب معلومات المانهوا
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function getMangaInfoData(mangaUrl) {
    const cacheKey = `manga_info_${mangaUrl}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const { data } = await fetchWithRetry(mangaUrl);
    const $ = cheerio.load(data);
    
    const title = $('h1.entry-title').text().trim();
    const altTitle = $('.alternative').text().trim();
    const coverImg = $('.thumb img').attr('src');
    const status = $('.imptdt:contains("Status") i').text().trim();
    const type = $('.imptdt:contains("Type") a').text().trim();
    const views = $('.imptdt:contains("Views") i').text().trim() || 'غير معروف';
    const followers = $('.bmc').text().trim().replace('Followed by ', '').replace(' people', '');
    const rating = $('.rating .num').text().trim() || 'N/A';
    const translationTeam = $('.imptdt:contains("فريق الترجمة") a').text().trim() || 'غير معروف';
    
    const genres = [];
    $('.mgen a').each((i, el) => { genres.push($(el).text().trim()); });
    
    const synopsis = $('.entry-content.entry-content-single').text().trim();
    
    const chapters = [];
    $('#chapterlist ul li').each((i, el) => {
        const chapterNum = $(el).attr('data-num');
        const chapterUrl = $(el).find('a').attr('href');
        const chapterName = $(el).find('.chapternum').text().trim();
        const chapterDate = $(el).find('.chapterdate').text().trim();
        
        if (chapterUrl && chapterName) {
            chapters.push({
                number: chapterNum,
                name: chapterName,
                url: chapterUrl,
                date: chapterDate || 'تاريخ غير معروف'
            });
        }
    });
    chapters.reverse();
    
    const result = {
        title, altTitle, coverImg, status, type, views, followers, rating,
        translationTeam, genres, synopsis, chapters, totalChapters: chapters.length
    };
    
    setCached(cacheKey, result);
    return result;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🏆 جلب أشهر المانهوات
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function getPopularManga() {
    const cacheKey = 'popular_manga';
    const cached = getCached(cacheKey);
    if (cached) {
        return shuffleArray(cached);
    }

    try {
        const sources = [
            `${BASE_URL}/page/1/`,
            `${BASE_URL}/page/2/`,
            `${BASE_URL}/page/3/`,
            `${BASE_URL}/page/4/`,
            `${BASE_URL}/page/5/`
        ];
        
        const allResults = [];
        
        for (const source of sources) {
            try {
                const { data } = await fetchWithRetry(source);
                const $ = cheerio.load(data);
                
                $('.listupd .bs').each((i, el) => {
                    const title = $(el).find('.bsx .tt').text().trim();
                    const link = $(el).find('a').attr('href');
                    const cover = $(el).find('img').attr('src');
                    const status = $(el).find('.bsx .bt .sts').text().trim() || 'جاري';
                    const type = $(el).find('.bsx .bt .bts').text().trim() || 'مانهوا';
                    
                    if (title && link && !allResults.find(r => r.title === title)) {
                        allResults.push({
                            title: title,
                            link: link,
                            cover: cover || DEFAULT_IMAGE,
                            status: status,
                            type: type
                        });
                    }
                });
            } catch (e) {
                console.error(`Error fetching from ${source}:`, e.message);
            }
        }
        
        if (allResults.length > 0) {
            setCached(cacheKey, allResults);
            return shuffleArray(allResults);
        }
    } catch (error) {
        console.error('Error fetching popular manga:', error);
    }

    const defaultList = [
        { title: 'Solo Leveling Ragnarok', link: 'https://despair-manga.net/manga/solo-leveling-ragnarok/', cover: DEFAULT_IMAGE, status: 'جاري', type: 'مانهوا' },
        { title: 'Omniscient Reader', link: 'https://despair-manga.net/manga/omniscient-reader/', cover: DEFAULT_IMAGE, status: 'جاري', type: 'مانهوا' },
        { title: 'Tower of God', link: 'https://despair-manga.net/manga/tower-of-god/', cover: DEFAULT_IMAGE, status: 'جاري', type: 'مانهوا' },
        { title: 'The Beginning After The End', link: 'https://despair-manga.net/manga/the-beginning-after-the-end/', cover: DEFAULT_IMAGE, status: 'جاري', type: 'مانهوا' }
    ];
    
    setCached(cacheKey, defaultList);
    return shuffleArray(defaultList);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔀 دالة ترتيب عشوائي
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔍 البحث أو عرض الأشهر
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function searchManga(conn, m, query) {
    const react = async (e) => {
        try { await conn.sendMessage(m.chat, { react: { text: e, key: m.key } }); } catch {}
    };

    await react('🔍');

    try {
        let results = [];
        let isPopular = false;

        if (!query || query.trim() === '') {
            results = await getPopularManga();
            isPopular = true;
        } else {
            const searchUrl = `${BASE_URL}/wp-admin/admin-ajax.php`;
            const formData = new URLSearchParams();
            formData.append('action', 'ts_ac_do_search');
            formData.append('ts_ac_query', query);

            const { data } = await axios.post(searchUrl, formData, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });

            results = data.series?.[0]?.all || [];

            if (results.length === 0) {
                results = await getPopularManga();
                isPopular = true;
            }
        }

        if (results.length === 0) {
            await react('❌');
            return m.reply('❌ لا توجد نتائج');
        }

        const randomIndex = Math.floor(Math.random() * results.length);
        const randomResult = results[randomIndex];
        const firstCover = randomResult?.cover || randomResult?.post_image?.match(/https?:\/\/[^"']+\.(jpg|png|webp)/i)?.[0] || DEFAULT_IMAGE;
        const imageMsg = await createImageMessage(conn, firstCover);

        const shuffledResults = shuffleArray(results);
        
        const rows = shuffledResults.slice(0, 20).map((manga) => ({
            title: manga.title || manga.post_title || 'بدون عنوان',
            // ✅ إزالة التاريخ من الوصف
            description: `📊 ${manga.status || manga.post_status || 'جاري'} | ${manga.type || manga.post_type || 'مانهوا'}`,
            id: `.عرض_مانهوا ${manga.link || manga.post_link}`
        }));

        const titleText = isPopular ? '🏆 *أشهر المانهوات*' : `🔍 *نتائج البحث عن:* ${query}`;
        const subText = isPopular ? '📚 *المانهوات الأكثر شهرة الآن*' : `📚 *تم العثور على:* ${results.length} نتيجة`;

        const nativeFlowPayload = {
            body: { 
                text: `${titleText}\n${subText}\n\n👇 *اختر المانجا*` 
            },
            footer: { text: global.watermark || 'Raiden Shogun' },
            header: {
                hasMediaAttachment: true,
                imageMessage: imageMsg
            },
            nativeFlowMessage: {
                buttons: [
                    {
                        name: 'single_select',
                        buttonParamsJson: JSON.stringify({
                            title: `📚 اختر المانجا`,
                            sections: [
                                {
                                    title: isPopular ? '🏆 الأكثر شهرة' : `🔍 نتائج البحث: ${query}`,
                                    rows: rows
                                }
                            ]
                        })
                    }
                ],
                messageParamsJson: JSON.stringify({})
            }
        };

        const interactiveMessage = proto.Message.InteractiveMessage.fromObject(nativeFlowPayload);

        const msg = generateWAMessageFromContent(m.chat, {
            viewOnceMessage: {
                message: {
                    interactiveMessage: interactiveMessage
                }
            }
        }, { userJid: conn.user.jid, quoted: m });

        await conn.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
        await react('✅');

    } catch (error) {
        console.error('Search error:', error);
        await react('❌');
        await m.reply(`❌ فشل في البحث: ${error.message}`);
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📖 عرض المانجا مع قائمة الفصول (ZIP مباشر) - بدون تاريخ
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function showMangaInfoWithChapters(conn, m, mangaUrl) {
    const react = async (e) => {
        try { await conn.sendMessage(m.chat, { react: { text: e, key: m.key } }); } catch {}
    };

    await react('ℹ️');

    try {
        const manga = await getMangaInfoData(mangaUrl);
        
        const statusText = manga.status === 'Ongoing' ? '🟢 جاري' : manga.status === 'Completed' ? '🔴 مكتمل' : manga.status;
        
        let infoText = `📚 *${manga.title}*\n\n`;
        if (manga.altTitle) infoText += `📝 *الاسم البديل:* ${manga.altTitle}\n`;
        infoText += `📖 *النوع:* ${manga.type}\n`;
        infoText += `📊 *الحالة:* ${statusText}\n`;
        infoText += `⭐ *التقييم:* ${manga.rating}\n`;
        infoText += `👥 *المتابعون:* ${manga.followers}\n`;
        infoText += `👁️ *المشاهدات:* ${manga.views}\n`;
        infoText += `📚 *عدد الفصول:* ${manga.totalChapters}\n`;
        if (manga.translationTeam && manga.translationTeam !== 'غير معروف') {
            infoText += `🖋️ *فريق الترجمة:* ${manga.translationTeam}\n`;
        }
        if (manga.genres.length > 0) {
            infoText += `🏷️ *التصنيفات:* ${manga.genres.join(' • ')}\n`;
        }
        infoText += `\n📖 *القصة:*\n${manga.synopsis ? manga.synopsis.substring(0, 300) + '...' : 'لا يوجد وصف'}`;

        let coverBuffer = null;
        if (manga.coverImg) {
            try {
                const coverRes = await axios.get(manga.coverImg, { responseType: 'arraybuffer' });
                coverBuffer = coverRes.data;
            } catch(e) {}
        }
        
        const imageMsg = coverBuffer ? await createImageMessage(conn, manga.coverImg) : null;

        if (manga.chapters.length === 0) {
            await react('⚠️');
            return m.reply('⚠️ لا توجد فصول متاحة حالياً');
        }

        const CHAPTERS_PER_SECTION = 50;
        const sections = [];
        
        for (let i = 0; i < manga.chapters.length; i += CHAPTERS_PER_SECTION) {
            const chunk = manga.chapters.slice(i, i + CHAPTERS_PER_SECTION);
            const sectionTitle = `📖 الفصول ${i + 1} - ${Math.min(i + CHAPTERS_PER_SECTION, manga.chapters.length)}`;
            
            const rows = chunk.map((ch) => ({
                title: ch.name || `الفصل ${ch.number}`,
                // ✅ إزالة التاريخ نهائياً من الوصف
                description: `📥 اضغط للتحميل ZIP`,
                id: `.تحميل_فصل ${ch.url}`
            }));
            
            sections.push({
                title: sectionTitle,
                rows: rows
            });
        }

        const nativeFlowPayload = {
            body: { text: infoText },
            footer: { text: global.watermark || 'Raiden Shogun' },
            header: {
                hasMediaAttachment: true,
                imageMessage: imageMsg
            },
            nativeFlowMessage: {
                buttons: [
                    {
                        name: 'single_select',
                        buttonParamsJson: JSON.stringify({
                            title: `📖 قائمة الفصول (${manga.totalChapters})`,
                            sections: sections
                        })
                    }
                ],
                messageParamsJson: JSON.stringify({})
            }
        };

        const interactiveMessage = proto.Message.InteractiveMessage.fromObject(nativeFlowPayload);

        const msg = generateWAMessageFromContent(m.chat, {
            viewOnceMessage: {
                message: {
                    interactiveMessage: interactiveMessage
                }
            }
        }, { userJid: conn.user.jid, quoted: m });

        await conn.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
        await react('✅');
        
    } catch (error) {
        console.error('Manga info error:', error);
        await react('❌');
        await m.reply(`❌ فشل في جلب المعلومات: ${error.message}`);
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📸 جلب صور الفصل
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function getChapterImages(chapterUrl) {
    const cacheKey = `chapter_images_${chapterUrl}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    try {
        const { data } = await fetchWithRetry(chapterUrl);
        
        const tsReaderMatch = data.match(/ts_reader\.run\((\{[\s\S]+?\})\)/);
        if (!tsReaderMatch) return [];
        
        const imagesMatch = tsReaderMatch[1].match(/"images":\s*\[([^\]]+)\]/);
        if (!imagesMatch) return [];
        
        let imagesStr = imagesMatch[1].replace(/\n/g, '').replace(/\\/g, '');
        const images = JSON.parse(`[${imagesStr}]`);
        const fullUrls = images.map(img => img.startsWith('http') ? img : `${BASE_URL}${img}`);
        
        setCached(cacheKey, fullUrls);
        return fullUrls;
        
    } catch (error) {
        console.error('Chapter images error:', error);
        return [];
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📦 تحميل الفصل ZIP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function downloadFullChapter(conn, m, chapterUrl) {
    const react = async (e) => {
        try { await conn.sendMessage(m.chat, { react: { text: e, key: m.key } }); } catch {}
    };

    await react('⏳');
    await m.reply('📦 *جاري تجهيز الفصل للتحميل...*');

    try {
        const images = await getChapterImages(chapterUrl);

        if (!images || images.length === 0) {
            throw new Error('لم يتم العثور على صور');
        }

        await m.reply(`📸 *تم العثور على ${images.length} صفحة*\n🔄 جاري إنشاء ملف ZIP...`);

        const zip = new JSZip();
        let pagesAdded = 0;
        
        for (let i = 0; i < images.length; i++) {
            try {
                const imgRes = await axios.get(images[i], { 
                    responseType: 'arraybuffer',
                    timeout: 30000
                });
                
                if (!imgRes || !imgRes.data) continue;
                
                const imgBuffer = Buffer.from(imgRes.data);
                if (imgBuffer.length < 100) continue;
                
                zip.file(`page_${String(i + 1).padStart(3, '0')}.jpg`, imgBuffer);
                pagesAdded++;
            } catch (err) {
                console.error(`Failed to download page ${i + 1}:`, err.message);
            }
        }
        
        if (pagesAdded === 0) {
            throw new Error('لم يتم إضافة أي صفحة إلى ZIP');
        }
        
        const fileBuffer = await zip.generateAsync({ type: 'nodebuffer' });
        const fileName = `chapter_${Date.now()}.zip`;
        const fileSizeMB = (fileBuffer.length / 1024 / 1024).toFixed(2);

        await conn.sendMessage(m.chat, {
            document: fileBuffer,
            mimetype: 'application/zip',
            fileName: fileName,
            caption: `📦 *الفصل ZIP*\n📄 عدد الصفحات: ${pagesAdded}\n📁 الحجم: ${fileSizeMB} MB`
        }, { quoted: m });

        await react('✅');

    } catch (err) {
        console.error('[Download Chapter] Error:', err);
        await react('❌');
        await m.reply(`❌ فشل التحميل: ${err.message}`);
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎯 الأمر الرئيسي
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
let handler = async (m, { conn, text, command, usedPrefix }) => {
    const react = async (e) => {
        try { await conn.sendMessage(m.chat, { react: { text: e, key: m.key } }); } catch {}
    };

    if (command === 'مساعدة' || command === 'help') {
        await react('📚');
        return m.reply(`📚 *أوامر المانهوا*\n\n` +
            `🏆 *عرض أشهر المانهوات:*\n${usedPrefix}مانهوا\n\n` +
            `🔍 *بحث:*\n${usedPrefix}مانهوا <اسم>\n\n` +
            `📖 *عرض المانجا:*\n${usedPrefix}عرض_مانهوا <رابط>\n\n` +
            `⚡ *مثال:*\n${usedPrefix}مانهوا\n${usedPrefix}مانهوا solo leveling`);
    }

    if (command === 'مانهوا') {
        return searchManga(conn, m, text || '');
    }
    
    if (command === 'عرض_مانهوا') {
        if (!text || !text.startsWith('http')) {
            return m.reply(`⚠️ *الاستخدام:*\n${usedPrefix}عرض_مانهوا <رابط المانهوا>\n\n📌 *مثال:*\n${usedPrefix}عرض_مانهوا https://despair-manga.net/manga/solo-leveling-ragnarok/`);
        }
        return showMangaInfoWithChapters(conn, m, text);
    }
    
    if (command === 'تحميل_فصل' || command === 'zip') {
        if (!text || !text.startsWith('http')) {
            return m.reply(`⚠️ *الاستخدام:*\n${usedPrefix}تحميل_فصل <رابط الفصل>`);
        }
        return downloadFullChapter(conn, m, text);
    }
};

handler.command = ['مانهوا', 'عرض_مانهوا', 'تحميل_فصل', 'zip'];
handler.tags = ['manhwa'];
handler.help = ['مانهوا <اسم/رابط>', 'عرض_مانهوا <رابط>'];

export default handler;
