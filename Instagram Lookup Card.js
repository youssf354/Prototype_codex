// plugins/insta-lookup.js
// ♡ PROTOTYPE - Instagram Lookup Card ♡

let handler = async (m, { conn, args, usedPrefix, command }) => {
    const username = args[0]
    
    if (!username) {
        return m.reply(`📌 *طريقة الاستخدام:*\n\n${usedPrefix}${command} <username>\n\nمثال:\n${usedPrefix}${command} go24.q`)
    }
    
    const cleanUser = username.replace(/^@/, '').replace(/https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/.*$/, '')
    const IMAGE_URL = 'https://files.catbox.moe/vasgzu.jpg'
    const FOOTER = '𝑷𝑹𝑶𝑻𝑶𝑻𝒀𝑷𝑬'
    
    const payload = {
        botForwardedMessage: {
            message: {
                richResponseMessage: {
                    messageType: 1,
                    submessages: [],
                    unifiedResponse: {
                        data: Buffer.from(JSON.stringify({
                            sections: [
                                {
                                    view_model: {
                                        primitives: [{
                                            title: 'Ai insta lookup',
                                            subtitle: FOOTER,
                                            secondary_subtitle: '',
                                            image: { url: IMAGE_URL, mime_type: 'image/jpeg' },
                                            entity_id: '123456',
                                            entity_url: 'https://instagram.com/' + cleanUser,
                                            entity_type: 'WEBSITE',
                                            action_type: 'OPEN_URL',
                                            is_verified: true,
                                            __typename: 'GenAICompactEntityPrimitive'
                                        }],
                                        __typename: 'GenAIActionRowLayoutViewModel'
                                    }
                                },
                                {
                                    view_model: {
                                        primitives: [{
                                            type: 'HORIZONTAL_LINE',
                                            __typename: 'GenAIDividerPrimitive'
                                        }],
                                        __typename: 'GenAIVStackLayoutViewModel'
                                    }
                                },
                                {
                                    view_model: {
                                        primitives: [
                                            { __typename: 'GenAISpacerPrimitive' },
                                            {
                                                text: '# {{social_entity_1}}See results\0{{/social_entity_1}}    ',
                                                inline_entities: [{
                                                    key: 'social_entity_1',
                                                    metadata: {
                                                        __typename: 'GenAISocialEntityItem',
                                                        entity_id: cleanUser,
                                                        entity_name: cleanUser,
                                                        entity_full_name: 'NOT found',
                                                        entity_picture_url: IMAGE_URL,
                                                        entity_url: 'https://www.instagram.com/' + cleanUser,
                                                        entity_type: 'IG_PROFILE',
                                                        is_verified: true
                                                    }
                                                }],
                                                __typename: 'GenAIMarkdownTextUXPrimitive'
                                            },
                                            { __typename: 'GenAISpacerPrimitive' }
                                        ],
                                        __typename: 'GenAIActionRowLayoutViewModel'
                                    }
                                }
                            ]
                        })).toString('base64')
                    },
                    contextInfo: { isForwarded: true, forwardOrigin: 4 }
                }
            }
        }
    }
    
    try {
        const { generateWAMessageFromContent } = await import('@whiskeysockets/baileys')
        const waMsg = await generateWAMessageFromContent(m.chat, payload, { userJid: conn.user?.jid })
        await conn.relayMessage(m.chat, waMsg.message, { messageId: waMsg.key.id })
    } catch (e) {
        m.reply('❌ خطأ: ' + String(e.stack || e.message))
    }
}

handler.help = ['insta <username>']
handler.tags = ['tools']
handler.command = /^(insta|انستا|ig)$/i
handler.owner = false

export default handler
