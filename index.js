require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs').promises;
const path = require('path');

const TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));

if (!TOKEN) {
    console.error('❌ Ошибка: BOT_TOKEN не найден в .env файле!');
    process.exit(1);
}

if (!CHANNEL_ID) {
    console.error('❌ Ошибка: CHANNEL_ID не найден в .env файле!');
    process.exit(1);
}

console.log('📋 Конфигурация загружена:');
console.log(`Token: ${TOKEN.substring(0, 10)}...`);
console.log(`Channel ID: ${CHANNEL_ID}`);
console.log(`Admin IDs:`, ADMIN_IDS);

const bot = new TelegramBot(TOKEN, {
    polling: true,
    request: {
        agentOptions: {
            keepAlive: true,
            family: 4,
            timeout: 60000
        },
        timeout: 60000
    }
});

bot.on('polling_error', (error) => {
    console.error('Polling error:', error.code, error.message);
});

const USERS_FILE = path.join(__dirname, 'users.json');

const States = {
    START: 0,
    CAPTCHA: 1,
    MOVE_RED_SQUARE: 2
};

const userStates = new Map();
const userData = new Map();

const emojis = [
    { emoji: '🔴', name: 'Red' },
    { emoji: '🟢', name: 'Green' },
    { emoji: '🔵', name: 'Blue' },
    { emoji: '🟡', name: 'Yellow' },
    { emoji: '🟠', name: 'Orange' },
    { emoji: '🟣', name: 'Purple' },
    { emoji: '⚪', name: 'White' },
    { emoji: '⚫', name: 'Black' },
    { emoji: '🟤', name: 'Brown' },
    { emoji: '⛷️', name: 'Skis' },
    { emoji: '🏃‍♂️', name: 'Man Running' },
    { emoji: '🚴‍♂️', name: 'Man Biking' },
    { emoji: '🤸‍♂️', name: 'Man Cartwheeling' },
    { emoji: '🏊‍♂️', name: 'Man Swimming' },
    { emoji: '🚵‍♂️', name: 'Man Mountain Biking' },
    { emoji: '🤾‍♂️', name: 'Man Playing Handball' }
];

async function loadUsers() {
    try {
        const data = await fs.readFile(USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return {};
    }
}

async function saveUsers(users) {
    await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
}

let users = {};

async function init() {
    users = await loadUsers();
    console.log('🤖 Бот запущен!');
    console.log(`Администраторы: ${ADMIN_IDS.join(', ')}`);
}

function getMainMenu(userId) {
    const isUserVerified = users[userId] && users[userId].joined;

    const keyboard = {
        reply_markup: {
            keyboard: [
                [{ text: '🚀 Начать /start' }],
                [{ text: '🔗 Получить ссылку /invite' }],
                [{ text: '❓ Помощь /help' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    };

    if (ADMIN_IDS.includes(parseInt(userId))) {
        keyboard.reply_markup.keyboard.push([{ text: '⚙️ Админ-панель /admin' }]);
    }

    return keyboard;
}

function removeKeyboard() {
    return {
        reply_markup: {
            remove_keyboard: true
        }
    };
}

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();

    console.log(`👤 Пользователь ${userId} вызвал /start`);

    if (!users[userId]) {
        users[userId] = {
            joined: false,
            lastInvite: null,
            invitesLeft: 3,
            admin: ADMIN_IDS.includes(parseInt(userId))
        };
        await saveUsers(users);
    }

    const welcomeMessage = `👋 Добро пожаловать в бот-верификатор!

Я помогу вам получить доступ к приватному каналу.

📌 *Что делать:*
1️⃣ Нажмите кнопку "🚀 Начать" или отправьте /start
2️⃣ Пройдите простую капчу (выберите эмодзи или совместите квадраты)
3️⃣ Получите одноразовую ссылку для входа в канал
4️⃣ Используйте ссылку в течение 1 минуты

💡 *Совет:* Если что-то непонятно, нажмите "❓ Помощь"

Удачи! 🎉`;

    await bot.sendMessage(chatId, welcomeMessage, {
        parse_mode: 'Markdown',
        ...getMainMenu(userId)
    });

    if (users[userId].joined) {
        await bot.sendMessage(chatId, '✅ Вы уже верифицированы! 🎉\n\nНажмите "🔗 Получить ссылку" для входа в канал.',
            getMainMenu(userId));
        return;
    }

    if (Math.random() < 0.5) {
        await sendEmojiCaptcha(chatId, userId);
    } else {
        await sendMoveRedSquareCaptcha(chatId, userId);
    }
});

async function sendEmojiCaptcha(chatId, userId) {
    const correctEmoji = emojis[Math.floor(Math.random() * emojis.length)];
    const choices = [...emojis].sort(() => 0.5 - Math.random()).slice(0, 7);

    if (!choices.includes(correctEmoji)) {
        choices[Math.floor(Math.random() * choices.length)] = correctEmoji;
    }

    const keyboard = {
        inline_keyboard: [
            choices.slice(0, 4).map(emoji => ({
                text: `${emoji.emoji} ${emoji.name}`,
                callback_data: `captcha_${emoji.name}`
            })),
            choices.slice(4, 8).map(emoji => ({
                text: `${emoji.emoji} ${emoji.name}`,
                callback_data: `captcha_${emoji.name}`
            }))
        ]
    };

    userData.set(userId, { captchaCorrect: correctEmoji.name });
    userStates.set(userId, States.CAPTCHA);

    await bot.sendMessage(chatId,
        `🛑 Какой эмодзи ${correctEmoji.emoji} ${correctEmoji.name}? Выберите правильный вариант:`,
        { reply_markup: keyboard }
    );
}

async function sendMoveRedSquareCaptcha(chatId, userId) {
    const correctPosition = Math.floor(Math.random() * 8);
    const initialPosition = 0;

    userData.set(userId, {
        correctPosition: correctPosition,
        currentPosition: initialPosition
    });
    userStates.set(userId, States.MOVE_RED_SQUARE);

    const topRow = Array(8).fill('🟩');
    topRow[correctPosition] = '🟥';

    const bottomRow = Array(8).fill('🟩');
    bottomRow[initialPosition] = '🟥';

    const keyboard = {
        inline_keyboard: [
            [
                { text: '⬅️', callback_data: 'move_left' },
                { text: '➡️', callback_data: 'move_right' }
            ],
            [
                { text: '✅ Accept', callback_data: 'move_accept' }
            ]
        ]
    };

    await bot.sendMessage(chatId,
        `🛑 Совместите красные квадраты, перемещая нижний красный квадрат влево/вправо.\n\n` +
        `${topRow.join('')}\n${bottomRow.join('')}`,
        { reply_markup: keyboard }
    );
}

async function completeVerification(chatId, userId, msg) {
    users[userId].joined = true;
    users[userId].lastInvite = new Date().toISOString();
    users[userId].invitesLeft--;
    await saveUsers(users);

    try {
        const inviteLink = await bot.createChatInviteLink(CHANNEL_ID, {
            member_limit: 1,
            expire_date: Math.floor(Date.now() / 1000) + 60
        });

        await bot.editMessageText('✅ Капча пройдена! Ваша ссылка-приглашение:', {
            chat_id: chatId,
            message_id: msg.message_id
        });

        const keyboard = {
            inline_keyboard: [
                [{ text: '🔗 Присоединиться к каналу', url: inviteLink.invite_link }]
            ]
        };

        await bot.sendMessage(chatId, '👉 Нажмите кнопку для присоединения:', {
            reply_markup: keyboard
        });

        await bot.sendMessage(chatId, '✅ Верификация завершена! Теперь вы можете получать ссылки через кнопку "🔗 Получить ссылку"',
            getMainMenu(userId));

    } catch (error) {
        console.error('Ошибка создания ссылки:', error);
        await bot.sendMessage(chatId, '❌ Ошибка при создании ссылки. Убедитесь, что бот является администратором канала.',
            getMainMenu(userId));
    }

    userStates.delete(userId);
    userData.delete(userId);
}

bot.onText(/\/invite/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();

    if (!users[userId] || !users[userId].joined) {
        await bot.sendMessage(chatId,
            '❌ Вы ещё не верифицированы!\n\nСначала нажмите "🚀 Начать" или отправьте /start, чтобы пройти капчу.',
            getMainMenu(userId));
        return;
    }

    const lastInvite = users[userId].lastInvite ? new Date(users[userId].lastInvite) : null;
    const now = new Date();

    if (lastInvite && (now - lastInvite) > 7 * 24 * 60 * 60 * 1000) {
        users[userId].invitesLeft = 3;
        await saveUsers(users);
        await bot.sendMessage(chatId, '🔄 Неделя прошла! Ваши лимиты приглашений обновлены.',
            getMainMenu(userId));
    }

    if (users[userId].invitesLeft > 0) {
        try {
            await bot.sendMessage(chatId, '⏳ Создаю одноразовую ссылку... Подождите секунду.',
                getMainMenu(userId));

            const inviteLink = await bot.createChatInviteLink(CHANNEL_ID, {
                member_limit: 1,
                expire_date: Math.floor(now / 1000) + 60
            });

            users[userId].lastInvite = now.toISOString();
            users[userId].invitesLeft--;
            await saveUsers(users);

            const remainingInvites = users[userId].invitesLeft;
            const message = `✅ *Ссылка готова!*\n\n` +
                `🔗 Ваша одноразовая ссылка:\n` +
                `${inviteLink.invite_link}\n\n` +
                `⏰ Ссылка действительна 1 минуту\n` +
                `📊 Осталось приглашений на эту неделю: ${remainingInvites}\n\n` +
                `👉 Нажмите на ссылку, чтобы присоединиться к каналу!`;

            await bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                ...getMainMenu(userId)
            });

        } catch (error) {
            console.error('Ошибка создания ссылки:', error);
            await bot.sendMessage(chatId,
                '❌ Ошибка при создании ссылки. Убедитесь, что бот является администратором канала.',
                getMainMenu(userId));
        }
    } else {
        await bot.sendMessage(chatId,
            '🚫 Вы исчерпали недельный лимит приглашений (3 штуки).\n\nПопробуйте снова на следующей неделе.',
            getMainMenu(userId));
    }
});

bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const isAdmin = ADMIN_IDS.includes(parseInt(userId));

    let helpText = '📖 *Инструкция по использованию бота*\n\n' +
        '👤 *Для обычных пользователей:*\n\n' +
        '1️⃣ *Начать верификацию*\n' +
        '   Нажмите кнопку "🚀 Начать" или отправьте команду /start\n\n' +
        '2️⃣ *Пройти капчу*\n' +
        '   • Выберите правильный эмодзи из предложенных\n' +
        '   • Или совместите красные квадраты, используя стрелки\n\n' +
        '3️⃣ *Получить ссылку*\n' +
        '   После успешной капчи нажмите "🔗 Получить ссылку" или /invite\n\n' +
        '4️⃣ *Вступить в канал*\n' +
        '   Нажмите на полученную ссылку (действительна 1 минуту)\n\n' +
        '📌 *Важно:*\n' +
        '• У вас есть 3 приглашения в неделю\n' +
        '• Ссылка одноразовая и действует 1 минуту\n' +
        '• Если ссылка истекла, просто запросите новую\n';

    if (isAdmin) {
        helpText += '\n⚙️ *Для администраторов:*\n' +
            '• Нажмите "⚙️ Админ-панель" или /admin\n' +
            '• Просмотр всех пользователей\n' +
            '• Сброс лимитов приглашений\n';
    }

    helpText += '\n❓ *Частые проблемы:*\n' +
        '• Не приходит ссылка? → Проверьте, что бот администратор канала\n' +
        '• Ссылка не работает? → Запросите новую через /invite\n' +
        '• Не можете пройти капчу? → Нажмите /start для новой попытки';

    await bot.sendMessage(chatId, helpText, {
        parse_mode: 'Markdown',
        ...getMainMenu(userId)
    });
});

bot.onText(/\/admin/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();

    if (!ADMIN_IDS.includes(parseInt(userId))) {
        await bot.sendMessage(chatId, '🚫 У вас нет доступа к админ-панели.',
            getMainMenu(userId));
        return;
    }

    const stats = {
        total: Object.keys(users).length,
        verified: Object.values(users).filter(u => u.joined).length,
        unverified: Object.values(users).filter(u => !u.joined).length
    };

    const adminMessage = `⚙️ *Админ-панель*\n\n` +
        `📊 *Статистика:*\n` +
        `• Всего пользователей: ${stats.total}\n` +
        `• Верифицировано: ${stats.verified}\n` +
        `• Не верифицировано: ${stats.unverified}\n\n` +
        `Выберите действие:`;

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '👥 Просмотр пользователей', callback_data: 'admin_view_users' }],
                [{ text: '🔄 Сбросить лимиты всем', callback_data: 'admin_reset_invites' }],
                [{ text: '📈 Подробная статистика', callback_data: 'admin_stats' }],
                [{ text: '🔙 Главное меню', callback_data: 'back_to_menu' }]
            ]
        }
    };

    await bot.sendMessage(chatId, adminMessage, {
        parse_mode: 'Markdown',
        ...keyboard
    });
});

bot.onText(/🚀 Начать/, (msg) => {
    bot.emit('text', { ...msg, text: '/start' });
});

bot.onText(/🔗 Получить ссылку/, (msg) => {
    bot.emit('text', { ...msg, text: '/invite' });
});

bot.onText(/❓ Помощь/, (msg) => {
    bot.emit('text', { ...msg, text: '/help' });
});

bot.onText(/⚙️ Админ-панель/, (msg) => {
    bot.emit('text', { ...msg, text: '/admin' });
});

bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const userId = callbackQuery.from.id.toString();
    const data = callbackQuery.data;

    await bot.answerCallbackQuery(callbackQuery.id);

    if (data === 'back_to_menu') {
        await bot.sendMessage(chatId, '🔙 Возврат в главное меню', getMainMenu(userId));
        return;
    }

    if (data === 'admin_stats' && ADMIN_IDS.includes(parseInt(userId))) {
        const stats = {
            total: Object.keys(users).length,
            verified: Object.values(users).filter(u => u.joined).length,
            totalInvites: Object.values(users).reduce((sum, u) => sum + (3 - u.invitesLeft), 0)
        };

        await bot.editMessageText(
            `📈 *Детальная статистика*\n\n` +
            `📊 Всего пользователей: ${stats.total}\n` +
            `✅ Верифицировано: ${stats.verified}\n` +
            `⏳ Ожидают: ${stats.total - stats.verified}\n` +
            `🔗 Всего использовано приглашений: ${stats.totalInvites}\n\n` +
            `Нажмите "🔙 Главное меню" для возврата`,
            {
                chat_id: chatId,
                message_id: msg.message_id,
                parse_mode: 'Markdown'
            }
        );
        return;
    }

    if (data === 'admin_view_users' && ADMIN_IDS.includes(parseInt(userId))) {
        const usersList = Object.entries(users).map(([id, data]) =>
            `${id}: joined=${data.joined}, invitesLeft=${data.invitesLeft}`
        ).join('\n');

        const message = usersList ? `👥 Пользователи:\n${usersList}` : 'Нет пользователей';

        if (msg.text && msg.text.includes('Админ-панель')) {
            await bot.sendMessage(chatId, message);
        } else {
            await bot.editMessageText(message, {
                chat_id: chatId,
                message_id: msg.message_id
            });
        }
        return;
    }

    if (data === 'admin_reset_invites' && ADMIN_IDS.includes(parseInt(userId))) {
        for (const uid in users) {
            users[uid].invitesLeft = 3;
        }
        await saveUsers(users);

        if (msg.text && msg.text.includes('Админ-панель')) {
            await bot.sendMessage(chatId, '♻️ Лимиты приглашений сброшены для всех пользователей.');
        } else {
            await bot.editMessageText('♻️ Лимиты приглашений сброшены для всех пользователей.', {
                chat_id: chatId,
                message_id: msg.message_id
            });
        }
        return;
    }

    const state = userStates.get(userId);
    const userInfo = userData.get(userId);

    if (state === States.CAPTCHA && data.startsWith('captcha_')) {
        const selectedEmoji = data.replace('captcha_', '');

        if (selectedEmoji === userInfo.captchaCorrect) {
            await completeVerification(chatId, userId, msg);
        } else {
            await bot.editMessageText('❌ Неправильно. Отправьте /start для новой попытки.', {
                chat_id: chatId,
                message_id: msg.message_id
            });
            userStates.delete(userId);
            userData.delete(userId);
        }
    }
    else if (state === States.MOVE_RED_SQUARE && userInfo) {
        let { currentPosition, correctPosition } = userInfo;

        if (data === 'move_left' && currentPosition > 0) {
            currentPosition--;
        } else if (data === 'move_right' && currentPosition < 7) {
            currentPosition++;
        } else if (data === 'move_accept') {
            if (currentPosition === correctPosition) {
                await completeVerification(chatId, userId, msg);
                return;
            } else {
                await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Позиции не совпадают!' });
                return;
            }
        }

        userData.set(userId, { ...userInfo, currentPosition });

        const topRow = Array(8).fill('🟩');
        topRow[correctPosition] = '🟥';

        const bottomRow = Array(8).fill('🟩');
        bottomRow[currentPosition] = '🟥';

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '⬅️', callback_data: 'move_left' },
                    { text: '➡️', callback_data: 'move_right' }
                ],
                [
                    { text: '✅ Accept', callback_data: 'move_accept' }
                ]
            ]
        };

        try {
            await bot.editMessageText(
                `🛑 Совместите красные квадраты:\n\n${topRow.join('')}\n${bottomRow.join('')}`,
                {
                    chat_id: chatId,
                    message_id: msg.message_id,
                    reply_markup: keyboard
                }
            );
        } catch (error) {
            console.error('Ошибка обновления сообщения:', error);
        }
    }
});

init().catch(console.error);