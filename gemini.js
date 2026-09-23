// plugins/jemini.js
// ♡ Raiden Shogun - Plane of Euthymia - Gemini AI 🤖

import axios from "axios";
import { theme } from '../core/theme.js';

async function gemini(input = {}) {
  const payload = typeof input === "string" ? { message: input } : input || {};
  const { message, instruction = "", sessionId = null } = payload;

  try {
    if (!message) throw new Error("الرسالة مطلوبة.");

    let resumeArray = null;
    let cookie = null;
    let savedInstruction = instruction;

    if (sessionId) {
      try {
        const sessionData = JSON.parse(
          Buffer.from(sessionId, "base64").toString(),
        );
        resumeArray = sessionData.resumeArray;
        cookie = sessionData.cookie;
        savedInstruction = instruction || sessionData.instruction || "";
      } catch (e) {
        console.error("خطأ في تحليل الجلسة:", e.message);
      }
    }

    if (!cookie) {
      const { headers } = await axios.post(
        "https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=maGuAc&source-path=%2F&bl=boq_assistant-bard-web-server_20250814.06_p1&f.sid=-7816331052118000090&hl=en-US&_reqid=173780&rt=c",
        "f.req=%5B%5B%5B%22maGuAc%22%2C%22%5B0%5D%22%2Cnull%2C%22generic%22%5D%5D%5D&",
        {
          headers: {
            "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
          },
        },
      );

      cookie = headers["set-cookie"]?.[0]?.split("; ")[0] || "";
    }

    const requestBody = [
      [message, 0, null, null, null, null, 0],
      ["en-US"],
      resumeArray || ["", "", "", null, null, null, null, null, null, ""],
      null,
      null,
      null,
      [1],
      1,
      null,
      null,
      1,
      0,
      null,
      null,
      null,
      null,
      null,
      [[0]],
      1,
      null,
      null,
      null,
      null,
      null,
      [
        "",
        "",
        savedInstruction,
        null,
        null,
        null,
        null,
        null,
        0,
        null,
        1,
        null,
        null,
        null,
        [],
      ],
      null,
      null,
      1,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
      1,
      null,
      null,
      null,
      null,
      [1],
    ];

    const payloadData = [null, JSON.stringify(requestBody)];

    const { data } = await axios.post(
      "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=boq_assistant-bard-web-server_20250729.06_p0&f.sid=4206607810970164620&hl=en-US&_reqid=2813378&rt=c",
      new URLSearchParams({ "f.req": JSON.stringify(payloadData) }).toString(),
      { 
        headers: {
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
          "x-goog-ext-525001261-jspb":
            '[1,null,null,null,"9ec249fc9ad08861",null,null,null,[4]]',
          cookie: cookie,
        },
      },
    );

    const match = Array.from(data.matchAll(/^\d+\n(.+?)\n/gm));
    const array = match.reverse();
    let parse1 = null;

    for (const item of array) {
      const selectedArray = item?.[1];
      if (!selectedArray) continue;

      try {
        const realArray = JSON.parse(selectedArray);
        const candidate = realArray?.[0]?.[2];
        if (!candidate) continue;

        const parsed = JSON.parse(candidate);
        if (parsed?.[4]?.[0]?.[1]?.[0]) {
          parse1 = parsed;
          break;
        }
      } catch {}
    }

    if (!parse1) {
      throw new Error("فشل تحليل رد Gemini.");
    }

    const newResumeArray = [...parse1[1], parse1[4][0][0]];
    const text = parse1[4][0][1][0].replace(/\*\*(.+?)\*\*/g, "*$1*");

    const newSessionId = Buffer.from(
      JSON.stringify({
        resumeArray: newResumeArray,
        cookie: cookie,
        instruction: savedInstruction,
      }),
    ).toString("base64");

    return {
      text: text,
      sessionId: newSessionId,
    };
  } catch (error) {
    if (error?.response?.data) {
      const apiMessage =
        typeof error.response.data === "string"
          ? error.response.data
          : error.response.data.message || error.response.data.error;
      if (apiMessage) {
        error.message = apiMessage;
      }
    }

    throw error;
  }
}

async function splitAndSend(conn, chat, text, quoted) {
  const MAX_LENGTH = 4000;
  if (text.length <= MAX_LENGTH) {
    return conn.sendMessage(chat, { text }, { quoted });
  }

  const parts = [];
  let remaining = text;
  while (remaining.length > 0) {
    let chunk = remaining.slice(0, MAX_LENGTH);
    const lastNewline = chunk.lastIndexOf('\n');
    if (lastNewline > MAX_LENGTH / 2) {
      chunk = chunk.slice(0, lastNewline);
    }
    parts.push(chunk);
    remaining = remaining.slice(chunk.length);
  }

  for (let i = 0; i < parts.length; i++) {
    const header = parts.length > 1 ? `📄 *جزء ${i + 1}/${parts.length}*\n\n` : '';
    await conn.sendMessage(chat, { text: header + parts[i] }, { quoted: i === 0 ? quoted : null });
  }
}

// ═══════════════════════════════════════════════════════════════
// Main Handler
// ═══════════════════════════════════════════════════════════════

let handler = async (m, { conn, text, usedPrefix, command }) => {
  const prompt = text?.trim();

  if (!prompt) {
    return conn.sendMessage(m.chat, {
      text: theme.build([
        { type: 'title', text: '🤖 Gemini AI' },
        { type: 'divider' },
        { type: 'line', text: '💬 نموذج Gemini من Google' },
        { type: 'spacer' },
        { type: 'info', label: '📌 الاستخدام', value: `${usedPrefix + command} <سؤال>` },
        { type: 'info', label: '📋 مثال', value: `${usedPrefix + command} ما هو التعلم العميق؟` },
        { type: 'divider' },
        { type: 'tip', text: '💡 يدعم المحادثات المتواصلة تلقائياً' }
      ])
    }, { quoted: m });
  }

  await conn.sendMessage(m.chat, { react: { text: '⏳', key: m.key } });

  try {
    const result = await gemini({ message: prompt });

    const replyText = result.text?.trim();

    if (!replyText) {
      await conn.sendMessage(m.chat, { react: { text: '❌', key: m.key } });
      return m.reply(theme.build([
        { type: 'title', text: '⚠️ رد فارغ' },
        { type: 'line', text: 'لم يتم استلام رد من Gemini' }
      ]));
    }

    await conn.sendMessage(m.chat, { react: { text: '✅', key: m.key } });
    await splitAndSend(conn, m.chat, replyText, m);

  } catch (e) {
    console.error('[Gemini] Error:', e);
    await conn.sendMessage(m.chat, { react: { text: '❌', key: m.key } });
    return m.reply(theme.build([
      { type: 'title', text: '❌ خطأ' },
      { type: 'error', text: e.message?.slice(0, 200) || 'حدث خطأ غير معروف' }
    ]));
  }
};

handler.help = ['jemini', 'gemini', 'جيميني', 'بارد'];
handler.tags = ['ai'];
handler.command = /^(jemini|gemini|جيميني|بارد|bard)$/i;

export default handler;

