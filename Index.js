const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const settings = require('./settings');

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './session' }),
    puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] }
});

let warns = {};
let afkUsers = {};

client.on('ready', () => console.log(`${settings.botName} by ${settings.ownerName} is ready!`));
client.initialize();

// Pairing code
setTimeout(async () => {
    if (!client.info && settings.autoPair) {
        try {
            await client.waitForReady();
            const code = await client.requestPairingCode(settings.ownerNumber);
            console.log(`\n====== ${settings.botName} PAIRING CODE: ${code} ======\n`);
            console.log(`WhatsApp > Settings > Linked Devices > Link with phone number`);
        } catch (e) { console.log(e); }
    }
}, 5000);

// Welcome/Goodbye
client.on('group_join', async notif => {
    if (!settings.groupFeatures.welcome) return;
    const chat = await notif.getChat();
    chat.sendMessage(settings.messages.welcome.replace('@user', `@${notif.id.participant.split('@')[0]}`).replace('@group', chat.name));
});

client.on('group_leave', async notif => {
    if (!settings.groupFeatures.goodbye) return;
    const chat = await notif.getChat();
    chat.sendMessage(settings.messages.goodbye.replace('@user', `@${notif.id.participant.split('@')[0]}`));
});

// Anti-delete detection
client.on('message_revoke_everyone', async (after, before) => {
    if (!settings.groupFeatures.antidelete ||!after) return;
    const chat = await after.getChat();
    if (!chat.isGroup) return;
    chat.sendMessage(`🗑️ Message deleted by @${after.author.split('@')[0]}\nContent: ${before.body || 'Media/Sticker'}`, { mentions: [after.author] });
});

// Main handler
client.on('message', async msg => {
    const chat = await msg.getChat();
    const isGroup = chat.isGroup;
    const sender = msg.author || msg.from;
    const isOwner = sender.split('@')[0] === settings.ownerNumber;

    let isAdmin = false;
    if (isGroup) {
        const participant = chat.participants.find(p => p.id._serialized === sender);
        isAdmin = participant? participant.isAdmin || participant.isSuperAdmin : false;
    }

    // Auto features
    if (settings.autoRead &&!msg.isStatus) await msg.sendSeen();
    if (settings.autoTyping &&!msg.isStatus) {
        await chat.sendStateTyping();
        await new Promise(r => setTimeout(r, 1000));
        await chat.clearState();
    }
    if (settings.autoReact &&!msg.isStatus && Math.random() > 0.6) await msg.react(settings.reactEmoji);
    if (settings.autoViewStatus && msg.isStatus) await msg.sendSeen();

    // AFK system
    if (msg.mentionedIds.length > 0) {
        msg.mentionedIds.forEach(id => {
            if (afkUsers[id]) {
                const mins = Math.floor((Date.now() - afkUsers[id].time)/60000);
                msg.reply(`@${id.split('@')[0]} AFK ${mins}min: ${afkUsers[id].reason}`);
            }
        });
    }
    if (afkUsers[sender]) {
        delete afkUsers[sender];
        msg.reply('Welcome back! AFK removed');
    }

    // Anti features
    if (isGroup && settings.groupFeatures.antitagall && /@all|@everyone/i.test(msg.body)) {
        if (!isAdmin) { await msg.delete(); return msg.reply('Only admins can use tagall'); }
    }
    if (isGroup && settings.groupFeatures.antilink && /chat\.whatsapp\.com/i.test(msg.body)) {
        if (!isAdmin) { await msg.delete(); msg.reply('No group links allowed!'); }
    }
    if (isGroup && settings.groupFeatures.antistatus && msg.hasMedia) {
        if (!isAdmin) { await msg.delete(); msg.reply('Media not allowed in this group'); }
    }
    if (settings.groupFeatures.antibadword && settings.badWords.some(w => msg.body.toLowerCase().includes(w))) {
        if (isGroup &&!isAdmin) { await msg.delete(); msg.reply('Bad word detected and deleted'); }
    }

    // Commands
    if (!msg.body.startsWith(settings.prefix)) return;
    const args = msg.body.slice(settings.prefix.length).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();

    const getTarget = async () => {
        const quoted = await msg.getQuotedMessage();
        return quoted? quoted.author : msg.mentionedIds[0];
    };

    try {
        // Group Admin
        if (cmd === 'kick') {
            if (!isGroup ||!isAdmin) return msg.reply(settings.messages.notAdmin);
            const target = await getTarget();
            if (!target) return msg.reply('Tag or reply to user');
            await chat.removeParticipants([target]);
            msg.reply(settings.messages.kick.replace('@user', `@${target.split('@')[0]}`));
        }

        if (cmd === 'promote') {
            if (!isGroup ||!isAdmin) return msg.reply(settings.messages.notAdmin);
            const target = await getTarget();
            if (!target) return msg.reply('Tag or reply to user');
            await chat.promoteParticipants([target]);
            msg.reply(settings.messages.promote.replace('@user', `@${target.split('@')[0]}`));
        }

        if (cmd === 'demote') {
            if (!isGroup ||!isAdmin) return msg.reply(settings.messages.notAdmin);
            const target = await getTarget();
            if (!target) return msg.reply('Tag or reply to user');
            await chat.demoteParticipants([target]);
            msg.reply(settings.messages.demote.replace('@user', `@${target.split('@')[0]}`));
        }

        if (cmd === 'mute') {
            if (!isGroup ||!isAdmin) return msg.reply(settings.messages.notAdmin);
            await chat.setMessagesAdminsOnly(true);
            msg.reply(settings.messages.mute);
        }

        if (cmd === 'unmute') {
            if (!isGroup ||!isAdmin) return msg.reply(settings.messages.notAdmin);
            await chat.setMessagesAdminsOnly(false);
            msg.reply(settings.messages.unmute);
        }

        if (cmd === 'warn') {
            if (!isGroup ||!isAdmin) return msg.reply(settings.messages.notAdmin);
            const target = await getTarget();
            if (!target) return msg.reply('Tag or reply to user');
            warns[target] = (warns[target] || 0) + 1;
            if (warns[target] >= 3) {
                await chat.removeParticipants([target]);
                delete warns[target];
                msg.reply(`@user kicked after 3 warns`.replace('@user', `@${target.split('@')[0]}`));
            } else {
                msg.reply(settings.messages.warn.replace('@user', `@${target.split('@')[0]}`).replace('@warns', warns[target]));
            }
        }

        if (cmd === 'tagall' || cmd === 'all') {
            if (!isGroup ||!isAdmin) return msg.reply(settings.messages.notAdmin);
            const text = args.join(' ') || 'Attention everyone!';
            const mentions = chat.participants.map(p => p.id._serialized);
            await client.sendMessage(chat.id._serialized, text, { mentions });
        }

        if (cmd === 'antidelete') {
            if (!isGroup ||!isAdmin) return msg.reply(settings.messages.notAdmin);
            settings.groupFeatures.antidelete =!settings.groupFeatures.antidelete;
            msg.reply(`Anti-delete: ${settings.groupFeatures.antidelete? 'ON ✅' : 'OFF ❌'}`);
        }

        // Personal/Utility
        if (cmd === 'vv') {
            const quoted = await msg.getQuotedMessage();
            if (quoted && quoted.hasMedia && quoted.isViewOnce) {
                const media = await quoted.downloadMedia();
                await client.sendMessage(msg.from, media, { caption: 'View Once → Normal' });
            } else {
                msg.reply('Reply to a view once photo/video');
            }
        }

        if (cmd === 's' || cmd === 'sticker') {
            const quoted = await msg.getQuotedMessage();
            if (quoted && quoted.hasMedia) {
                const media = await quoted.downloadMedia();
                await client.sendMessage(msg.from, media, {
                    sendMediaAsSticker: true,
                    stickerName: settings.botName,
                    stickerAuthor: settings.ownerName
                });
            } else {
                msg.reply(`Reply to image/video with ${settings.prefix}sticker`);
            }
        }

        if (cmd === 'emojis') {
            const emojiList = '😀 😃 😄 😁 😆 😅 😂 🤣 🥲 🥹 ☺️ 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥳 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🫣 🤭 🫡 🤫 🫢 😐 😑 😶';
            msg.reply(`*Emoji List:*\n${emojiList}\n\nCopy any emoji and send`);
        }

        if (cmd === 'del' || cmd === 'delete' || cmd === 'd') {
            const quoted = await msg.getQuotedMessage();
            if (quoted && quoted.fromMe) await quoted.delete(true);
            else msg.reply('Reply to my message to delete it');
        }

        if (cmd === 'autoread') {
            settings.autoRead =!settings.autoRead;
            msg.reply(`Auto read: ${settings.autoRead? 'ON ✅' : 'OFF ❌'}`);
        }

        if (cmd === 'autotyping') {
            settings.autoTyping =!settings.autoTyping;
            msg.reply(`Auto typing: ${settings.autoTyping? 'ON ✅' : 'OFF ❌'}`);
        }

        if (cmd === 'anticall') {
            msg.reply(`Anti-call: ON\nNote: WhatsApp API cannot block calls. This is just a notice.`);
        }

        if (cmd === 'report') {
            const target = await getTarget();
            if (!target) return msg.reply('Tag or reply to user to report');
            msg.reply(`To report @${target.split('@')[0]}:\n1. Open their chat\n2. Tap 3 dots > More > Report\nBots cannot auto-report due to WhatsApp policy`);
        }

        if (cmd === 'afk') {
            const reason = args.join(' ') || 'AFK';
            afkUsers[sender] = { time: Date.now(), reason };
            msg.reply(`AFK mode on: ${reason}`);
        }

        if (cmd === 'ping') msg.reply('pong 🏓');
        if (cmd === 'owner' || cmd === 'botinfo') {
            msg.reply(`*${settings.botName}*\nOwner: ${settings.ownerName}\nNumber: ${settings.ownerNumber}\nPrefix: ${settings.prefix}\nStatus: Online ✅`);
        }

        // Games
        if (cmd === 'guess') msg.reply(`Guess 1-10. You have 3 tries. Reply with number`);
        if (cmd === 'tictactoe' || cmd === 'ttt') msg.reply(`TicTacToe\n1 2 3\n4 5 6\n7 8 9\nReply with position 1-9`);

        if (cmd === 'help') {
            msg.reply(`*Philip Bot Commands*

*Group Admin:*
.kick.promote.demote.warn.mute.unmute.tagall.antidelete
Toggle in settings.js: antilink, antibadword, antistatus, antitagall, welcome, goodbye

*Personal:*
.vv.s/sticker.emojis.del.afk
.autoread.autotyping.anticall.report
Toggle in settings.js: autoViewStatus, autoReact

*Fun:*
.guess.tictactoe.ping.owner

Bot by ${settings.ownerName}`);
        }

    } catch (err) {
        console.log(err);
        msg.reply('Error: ' + err.message);
    }
});
