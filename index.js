const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.status(200).send('Bot Alive!');
});

app.listen(port, '0.0.0.0', () => {
    console.log(`🌐 Web Server active on port ${port}`);
});

const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    Browsers, 
    downloadMediaMessage 
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const yts = require('yt-search');
const axios = require('axios');
const fs = require('fs');

const CONFIG_FILE = './config.json';
const defaultConfig = {
    BOT_NAME: 'Gulaam',
    OWNER_NAME: 'Ali',
    OWNER_NUMBER: '923109094031',
    BOT_PIC: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop'
};

if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));
}

let CONFIG = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));

function saveConfig() {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(CONFIG, null, 2));
}

const messageStore = new Map();
const startTime = Date.now();

function getUptime() {
    const totalSeconds = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}h ${minutes}m ${seconds}s`;
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: state,
        browser: Browsers.macOS('Desktop'),
        syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n📌 SCAN THIS QR CODE WITH WHATSAPP:\n');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                console.log('🔄 Reconnecting in 3 seconds...');
                setTimeout(() => startBot(), 3000);
            } else {
                console.log('❌ Logged out! Clear auth_info and restart.');
            }
        } else if (connection === 'open') {
            console.log('\n🟢 BOT IS ONLINE & READY! ⚡\n');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message) continue;

            const myJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
            const from = msg.key.remoteJid;
            const msgId = msg.key.id;
            const sender = msg.key.participant || from;
            const senderNumber = sender.split('@')[0];
            const isOwner = msg.key.fromMe || senderNumber === CONFIG.OWNER_NUMBER;

            if (messageStore.size > 3000) {
                messageStore.delete(messageStore.keys().next().value);
            }
            messageStore.set(msgId, msg);

            // Auto Status View & React ❤️
            if (from === 'status@broadcast') {
                try {
                    await sock.readMessages([msg.key]);
                    await sock.sendMessage('status@broadcast', {
                        react: { text: '❤️', key: msg.key }
                    }, { statusJidList: [msg.key.participant] });
                } catch (e) {}
                continue;
            }

            const messageType = Object.keys(msg.message)[0];

            // 🚨 Anti-Delete (Private Inbox)
            if (messageType === 'protocolMessage' && msg.message.protocolMessage.type === 0) {
                const deletedKey = msg.message.protocolMessage.key;
                const originalMsg = messageStore.get(deletedKey.id);

                if (originalMsg) {
                    const deletedUser = deletedKey.participant || deletedKey.remoteJid;
                    const senderName = deletedUser.split('@')[0];

                    let targetMsg = originalMsg.message;
                    if (targetMsg.viewOnceMessage) targetMsg = targetMsg.viewOnceMessage.message;
                    if (targetMsg.viewOnceMessageV2) targetMsg = targetMsg.viewOnceMessageV2.message;

                    const deletedText = targetMsg.conversation || 
                                        targetMsg.extendedTextMessage?.text || 
                                        targetMsg.imageMessage?.caption || 
                                        targetMsg.videoMessage?.caption || '';

                    const isMedia = targetMsg.imageMessage || targetMsg.videoMessage || targetMsg.audioMessage || targetMsg.documentMessage;
                    const report = `🚨 *DELETED MESSAGE RECOVERED* 🚨\n\n👤 *User:* @${senderName}\n💬 *Text:* ${deletedText || 'None'}`;

                    if (isMedia) {
                        try {
                            const buffer = await downloadMediaMessage(originalMsg, 'buffer', {});
                            if (targetMsg.imageMessage) {
                                await sock.sendMessage(myJid, { image: buffer, caption: report, mentions: [deletedUser] });
                            } else if (targetMsg.videoMessage) {
                                await sock.sendMessage(myJid, { video: buffer, caption: report, mentions: [deletedUser] });
                            } else if (targetMsg.audioMessage) {
                                await sock.sendMessage(myJid, { text: report, mentions: [deletedUser] });
                                await sock.sendMessage(myJid, { audio: buffer, mimetype: 'audio/mp4', ptt: true });
                            } else if (targetMsg.documentMessage) {
                                await sock.sendMessage(myJid, { text: report, mentions: [deletedUser] });
                                await sock.sendMessage(myJid, { document: buffer, mimetype: targetMsg.documentMessage.mimetype, fileName: targetMsg.documentMessage.fileName || 'file' });
                            }
                        } catch (e) {}
                    } else {
                        await sock.sendMessage(myJid, { text: report, mentions: [deletedUser] });
                    }
                }
            }

            // ✏️ Anti-Edit
            if (messageType === 'protocolMessage' && msg.message.protocolMessage.type === 14) {
                const editedKey = msg.message.protocolMessage.key;
                const originalMsg = messageStore.get(editedKey.id);
                const newText = msg.message.protocolMessage.editedMessage?.extendedTextMessage?.text || 
                                msg.message.protocolMessage.editedMessage?.conversation;

                if (originalMsg) {
                    const oldText = originalMsg.message.conversation || 
                                    originalMsg.message.extendedTextMessage?.text || 'Unknown';
                    const editedUser = editedKey.participant || editedKey.remoteJid;

                    const report = `✏️ *EDITED MESSAGE DETECTED* ✏️\n\n👤 *User:* @${editedUser.split('@')[0]}\n📜 *Purana:* ${oldText}\n🆕 *Naya:* ${newText}`;
                    await sock.sendMessage(myJid, { text: report, mentions: [editedUser] });
                }
            }

            const body = msg.message.conversation || 
                         msg.message.extendedTextMessage?.text || 
                         msg.message.imageMessage?.caption || '';

            const lowerBody = body.trim().toLowerCase();

            // 👁️ View-Once Saver
            const viewOnceTriggers = ['.good', '.nice', '.excellent', '.wah', '.jeoo'];
            if (viewOnceTriggers.includes(lowerBody)) {
                const quotedContext = msg.message.extendedTextMessage?.contextInfo;
                const quotedId = quotedContext?.stanzaId;

                if (quotedId) {
                    const quotedMsg = messageStore.get(quotedId) || {
                        key: {
                            remoteJid: from,
                            id: quotedId,
                            participant: quotedContext?.participant
                        },
                        message: quotedContext?.quotedMessage
                    };

                    if (quotedMsg && quotedMsg.message) {
                        let targetMsg = quotedMsg.message;

                        if (targetMsg.viewOnceMessage) targetMsg = targetMsg.viewOnceMessage.message;
                        if (targetMsg.viewOnceMessageV2) targetMsg = targetMsg.viewOnceMessageV2.message;

                        const isImage = targetMsg.imageMessage;
                        const isVideo = targetMsg.videoMessage;

                        if (isImage || isVideo) {
                            try {
                                const downloadObj = { key: quotedMsg.key, message: targetMsg };
                                const buffer = await downloadMediaMessage(downloadObj, 'buffer', {});
                                const targetSender = quotedContext?.participant || from;

                                if (isImage) {
                                    await sock.sendMessage(myJid, { 
                                        image: buffer, 
                                        caption: `📸 *VIEW-ONCE RECOVERED*\n👤 Sender: @${targetSender.split('@')[0]}`,
                                        mentions: [targetSender]
                                    });
                                } else if (isVideo) {
                                    await sock.sendMessage(myJid, { 
                                        video: buffer, 
                                        caption: `🎥 *VIEW-ONCE RECOVERED*\n👤 Sender: @${targetSender.split('@')[0]}`,
                                        mentions: [targetSender]
                                    });
                                }
                            } catch (err) {}
                        }
                    }
                }
                continue;
            }

            if (!body.startsWith('.')) continue;

            const args = body.slice(1).trim().split(/ +/);
            const command = args.shift().toLowerCase();

            // Edit Commands (Owner Only)
            if (command === 'setbotname') {
                if (!isOwner) return sock.sendMessage(from, { text: '❌ Owner command!' }, { quoted: msg });
                const newName = args.join(' ');
                if (!newName) return sock.sendMessage(from, { text: '⚠️ Naya naam likhein!' }, { quoted: msg });
                CONFIG.BOT_NAME = newName;
                saveConfig();
                return sock.sendMessage(from, { text: `✅ Bot Name: ${newName}` }, { quoted: msg });
            }

            if (command === 'setowner') {
                if (!isOwner) return sock.sendMessage(from, { text: '❌ Owner command!' }, { quoted: msg });
                const newOwner = args.join(' ');
                if (!newOwner) return sock.sendMessage(from, { text: '⚠️ Naya owner naam likhein!' }, { quoted: msg });
                CONFIG.OWNER_NAME = newOwner;
                saveConfig();
                return sock.sendMessage(from, { text: `✅ Owner Name: ${newOwner}` }, { quoted: msg });
            }

            if (command === 'setnum') {
                if (!isOwner) return sock.sendMessage(from, { text: '❌ Owner command!' }, { quoted: msg });
                const newNum = args.join('').replace(/[^0-9]/g, '');
                if (!newNum) return sock.sendMessage(from, { text: '⚠️ Naya number likhein!' }, { quoted: msg });
                CONFIG.OWNER_NUMBER = newNum;
                saveConfig();
                return sock.sendMessage(from, { text: `✅ Owner Number: +${newNum}` }, { quoted: msg });
            }

            if (command === 'setpic') {
                if (!isOwner) return sock.sendMessage(from, { text: '❌ Owner command!' }, { quoted: msg });
                const newUrl = args[0];
                if (!newUrl) return sock.sendMessage(from, { text: '⚠️ URL link bhejen!' }, { quoted: msg });
                CONFIG.BOT_PIC = newUrl;
                saveConfig();
                return sock.sendMessage(from, { text: `✅ Bot Pic Updated!` }, { quoted: msg });
            }

            // Public Commands
            if (command === 'owner') {
                const vcard = 'BEGIN:VCARD\n'
                    + 'VERSION:3.0\n'
                    + `FN:${CONFIG.OWNER_NAME}\n`
                    + 'ORG:Bot Owner;\n'
                    + `TEL;type=CELL;type=VOICE;waid=${CONFIG.OWNER_NUMBER}:+${CONFIG.OWNER_NUMBER}\n`
                    + 'END:VCARD';

                await sock.sendMessage(from, { contacts: { displayName: CONFIG.OWNER_NAME, contacts: [{ vcard }] } }, { quoted: msg });
                await sock.sendMessage(from, { text: `👑 *Owner:* ${CONFIG.OWNER_NAME}\n📞 *Number:* +${CONFIG.OWNER_NUMBER}` }, { quoted: msg });
            }

            else if (command === 'ping') {
                const start = Date.now();
                await sock.sendMessage(from, { text: '⚡ *Testing Speed...*' }, { quoted: msg });
                const latency = Date.now() - start;
                await sock.sendMessage(from, { text: `🚀 *Latency:* ${latency} ms` });
            } 

            else if (command === 'play') {
                const query = args.join(' ');
                if (!query) return sock.sendMessage(from, { text: '❌ Usage: `.play song_name`' }, { quoted: msg });

                await sock.sendMessage(from, { text: '🔎 *Searching...*' }, { quoted: msg });

                try {
                    const search = await yts(query);
                    const video = search.videos[0];
                    if (!video) return sock.sendMessage(from, { text: '❌ Song nahi mila!' }, { quoted: msg });

                    const apiUrl = `https://api.vreden.web.id/api/ytmp3?url=${encodeURIComponent(video.url)}`;
                    const res = await axios.get(apiUrl);
                    const downloadUrl = res.data?.result?.download?.url || res.data?.result?.url;

                    if (downloadUrl) {
                        await sock.sendMessage(from, { image: { url: video.thumbnail }, caption: `🎶 *${video.title}*` }, { quoted: msg });
                        await sock.sendMessage(from, { audio: { url: downloadUrl }, mimetype: 'audio/mp4', ptt: false }, { quoted: msg });
                    } else {
                        await sock.sendMessage(from, { text: `🎶 *${video.title}*\n🔗 Link: ${video.url}` }, { quoted: msg });
                    }
                } catch (err) {
                    await sock.sendMessage(from, { text: '❌ Audio download error!' }, { quoted: msg });
                }
            } 

            else if (command === 'menu' || command === 'help') {
                const menuText = `
╭━━━〔 *${CONFIG.BOT_NAME.toUpperCase()} BOT* 〕━━━┈
┃ 👤 *Owner:* ${CONFIG.OWNER_NAME}
┃ ⏱️ *Uptime:* ${getUptime()}
┃ ⚙️ *Total Commands:* 9
╰━━━━━━━━━━━━━━━━━━┈

╭━━━〔 *COMMANDS* 〕━━━┈
┃ ▫️ \`.menu\` - Main Menu
┃ ▫️ \`.ping\` - Speed Test
┃ ▫️ \`.play [song]\` - Download Music
┃ ▫️ \`.owner\` - Contact Details
╰━━━━━━━━━━━━━━━━━━┈

╭━━━〔 *OWNER SETTINGS* 〕━━━┈
┃ ▫️ \`.setbotname <name>\`
┃ ▫️ \`.setowner <name>\`
┃ ▫️ \`.setnum <number>\`
┃ ▫️ \`.setpic <url>\`
╰━━━━━━━━━━━━━━━━━━┈
`;
                try {
                    await sock.sendMessage(from, { image: { url: CONFIG.BOT_PIC }, caption: menuText.trim() }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: menuText.trim() }, { quoted: msg });
                }
            }
        }
    });
}

startBot();