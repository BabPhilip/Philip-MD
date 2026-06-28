const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const settings = require('./settings');

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './session' }),
    puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] }
});

let warns = {};
let afkUsers = {};
let tttGames = {}; // tic tac toe games
let quizGames = {}; // quiz games

client.on('ready', () => console.log(`${settings.botName} by ${settings.ownerName} is ready!`));
client.initialize();

// Pairing code
setTimeout(async () => {
    if (!client.info && settings.autoPair) {
        try {
            await client.waitForReady();
            const code = await client.requestPairingCode(settings.ownerNumber);
            console.log(`\n====== ${settings.botName} PAIRING CODE: ${code} ======\n`);
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

// Anti-delete
client.on('message_revoke_everyone', async (after, before) => {
    if (!settings.groupFeatures.antidelete ||!after) return;
    const chat = await after.getChat();
    if (!chat.isGroup) return;
    chat.sendMessage(`🗑️ Message deleted by @${after.author.split('@')[0]}\nContent: ${before.body || 'Media'}`, { mentions: [after.author] });
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

    // AFK
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
        if (!isAdmin) { await msg.delete(); msg.reply('Media not allowed'); }
    }
    if (settings.groupFeatures.antibadword && settings.badWords.some(w => msg.body.toLowerCase().includes(w))) {
        if (isGroup &&!isAdmin) { await msg.delete(); msg.reply('Bad word deleted'); }
    }

    // ALL commands must start with.
    if (!msg.body.startsWith(settings.prefix)) return;
    const args = msg.body.slice(settings.prefix.length).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();

    const getTarget = async () => {
        const quoted = await msg.getQuotedMessage();
        return quoted? quoted.author : msg.mentionedIds[0];
    };

    try {
        // ========== GROUP ADMIN ==========
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

        // ========== GROUP GAMES ==========
        if (cmd === 'tictactoe' || cmd === 'ttt') {
            if (!isGroup) return msg.reply('Group only');
            const gid = chat.id._serialized;
            tttGames[gid] = { board: [1,2,3,4,5,6,7,8,9], turn: 'X', players: {} };
            msg.reply(`TicTacToe started!\n1 2 3\n4 5 6\n7 8 9\nFirst player: X\nReply with.move 1-9`);
        }

        if (cmd === 'move') {
            if (!isGroup) return msg.reply('Group only');
            const gid = chat.id._serialized;
            if (!tttGames[gid]) return msg.reply('No game running. Use.tictactoe');
            const pos = parseInt(args[0]) - 1;
            if (pos < 0 || pos > 8) return msg.reply('Position 1-9 only');
            if (tttGames[gid].board[pos] === 'X' || tttGames[gid].board[pos] === 'O') return msg.reply('Spot taken');

            const mark = tttGames[gid].turn;
            tttGames[gid].board[pos] = mark;
            tttGames[gid].turn = mark === 'X'? 'O' : 'X';

            const b = tttGames[gid].board;
            const board = `${b[0]} ${b[1]} ${b[2]}\n${b[3]} ${b[4]} ${b[5]}\n${b[6]} ${b[7]} ${b[8]}`;
            msg.reply(board + `\nNext: ${tttGames[gid].turn}`);
        }

        if (cmd === 'quiz') {
            if (!isGroup) return msg.reply('Group only');
            const questions = [
                {q: "Capital of Nigeria?", a: "abuja"},
                {q: "2 + 2 x 2?", a: "6"},
                {q: "Largest planet?", a: "jupiter"},
                {q: "WhatsApp was founded in?", a: "2009"}
            ];
            const random = questions[Math.floor(Math.random() * questions.length)];
            quizGames[chat.id._serialized] = random.a;
            msg.reply(`🧠 Quiz Time!\n${random.q}\nReply with.answer your answer`);
        }

        if (cmd === 'answer') {
            const gid = chat.id._serialized;
            if (!quizGames[gid]) return msg.reply('No quiz running. Use.quiz');
            const userAns = args.join(' ').toLowerCase();
            if (userAns === quizGames[gid]) {
                msg.reply(`Correct! 🎉 @${sender.split('@')[0]} got it!`, { mentions: [sender] });
                delete quizGames[gid];
            } else {
                msg.reply('Wrong answer! Try again');
            }
        }

        if (cmd === 'trivia') {
            const facts = [
                "Octopuses have 3 hearts",
                "Bananas are berries, strawberries aren't",
                "A group of flamingos is called a flamboyance",
                "Honey never spoils"
            ];
            msg.reply(`📚 Trivia: ${facts[Math.floor(Math.random() * facts.length)]}`);
        }

        if (cmd === 'truth') {
            const truths = [
                "What's your biggest fear?",
                "Have you ever lied to your best friend?",
                "What's one thing you hide from everyone?",
                "Who was your first crush?"
            ];
            msg.reply(`🙈 Truth: ${truths[Math.floor(Math.random() * truths.length)]}`);
        }

        if (cmd === 'dare') {
            const dares = [
                "Send a selfie in the group",
                "Type 'I love pineapple pizza' 5 times",
                "Change your name to 'Bot Slave' for 5 min",
                "Send the last photo in your gallery"
            ];
            msg.reply(`😈 Dare: ${dares[Math.floor(Math.random() * dares.length)]}`);
        }

        if (cmd === 'rps' || cmd === 'rockpaper') {
            const choice = args[0];
            if (!['rock', 'paper', 'scissors'].includes(choice)) return msg.reply('Use.rps rock/paper/scissors');
            const bot = ['rock', 'paper', 'scissors'][Math.floor(Math.random() * 3)];
            let result = 'Tie!';
            if (choice === 'rock' && bot === 'scissors') result = 'You win!';
            if (choice === 'paper' && bot === 'rock') result = 'You win!';
            if (choice === 'scissors' && bot === 'paper') result = 'You win!';
            if (bot === 'rock' && choice === 'scissors') result = 'Bot wins!';
            if (bot === 'paper' && choice === 'rock') result = 'Bot wins!';
            if (bot === 'scissors' && choice === 'paper') result = 'Bot wins!';
            msg.reply(`You: ${choice}\nBot: ${bot}\n${result}`);
        }

        // ========== PERSONAL ==========
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
            msg.reply(`*Emoji List:*\n😀 😃 😄 😁 😆 😅 😂 🤣 🥲 🥹 ☺️ 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪`);
        }

        if (cmd === 'del' || cmd === 'delete') {
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
            msg.reply(`Anti-call: ON\nNote: WhatsApp API cannot block calls.`);
        }

        if (cmd === 'report') {
            const target = await getTarget();
            if (!target) return msg.reply('Tag or reply to user to report');
            msg.reply(`To report @${target.split('@')[0]}:\n1. Open chat > 3 dots > Report\nBots cannot auto-report`);
        }

        if (cmd === 'afk') {
            const reason = args.join(' ') || 'AFK';
            afkUsers[sender] = { time: Date.now(), reason };
            msg.reply(`AFK mode on: ${reason}`);
        }

        if (cmd === 'ping') msg.reply('pong 🏓');
        if (cmd === 'owner') msg.reply(`*${settings.botName}*\nOwner: ${settings.ownerName}\nNumber: ${settings.ownerNumber}`);

        if (cmd === 'help') {
            msg.reply(`*Philip Bot Commands*

*Group Admin:*
.kick.promote.demote.warn.mute.unmute.tagall.antidelete

*Group Games:*
.tictactoe.move.quiz.answer.trivia.truth.dare.rps

*Personal:*
.vv.s/sticker.emojis.del.afk
.autoread.autotyping.anticall.report.ping.owner

All commands start with.
Edit settings.js for ${settings.ownerName}`);
        }

    } catch (err) {
        console.log(err);
        msg.reply('Error: ' + err.message);
    }
});
