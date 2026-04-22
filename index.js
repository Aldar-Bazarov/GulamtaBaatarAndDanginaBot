require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs').promises;
const path = require('path');

const TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
const REQUIRED_CHANNEL_ID = process.env.REQUIRED_CHANNEL_ID;
const REQUIRED_CHANNEL_USERNAME = process.env.REQUIRED_CHANNEL_USERNAME || 'Гуламта | Студенческое объединение в Москве';

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
    { emoji: '🔴', name: 'Красный' },
    { emoji: '🟢', name: 'Зелёный' },
    { emoji: '🔵', name: 'Синий' },
    { emoji: '🟡', name: 'Жёлтый' },
    { emoji: '⚪', name: 'Белый' },
    { emoji: '⚫', name: 'Чёрный' },
    { emoji: '🏃‍♂️', name: 'Бегит' },
    { emoji: '🚴‍♂️', name: 'Велосипед' },
    { emoji: '🏊‍♂️', name: 'Пловец' },
    { emoji: '🤾‍♂️', name: 'Волейбол' }
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

async function checkChannelSubscription(userId) {
    if (!REQUIRED_CHANNEL_ID) return true;

    try {
        const chatMember = await bot.getChatMember(REQUIRED_CHANNEL_ID, userId);
        const status = chatMember.status;
        const isSubscribed = ['creator', 'administrator', 'member', 'restricted'].includes(status);

        console.log(`Проверка подписки для ${userId}: статус=${status}, подписан=${isSubscribed}`);
        return isSubscribed;
    } catch (error) {
        console.error('Ошибка проверки подписки:', error);
        return false;
    }
}

function getMainMenu(userId) {
    const keyboard = {
        reply_markup: {
            keyboard: [
                [{ text: '🔐 Пройти проверку /verify' }],
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

async function sendWelcomeOnly(chatId, userId) {
    const welcomeMessage = `👋 Добро пожаловать в бот-верификатор!

Я помогу вам получить доступ к приватному каналу Гуламты.

📌 <b>Что делать:</b>
1️⃣ Нажмите кнопку "🔐 Пройти проверку"
2️⃣ Пройдите простую проверку (выберите эмодзи или совместите красные квадраты)
3️⃣ Получите одноразовую ссылку для входа в канал
4️⃣ Используйте ссылку в течение 1 минуты

💡 <i>Совет:</i> Если что-то непонятно, нажмите "❓ Помощь"

Удачи! 🎉`;

    await bot.sendMessage(chatId, welcomeMessage, {
        parse_mode: 'HTML',
        ...getMainMenu(userId)
    });
}

async function getUserData(userId, username) {
    if (!users[userId]) {
        users[userId] = {
            joined: false,
            lastInvite: null,
            admin: ADMIN_IDS.includes(parseInt(userId)),
            welcomed: false,
            username: username || null
        };
        await saveUsers(users);
    } else if (username && users[userId].username !== username) {
        users[userId].username = username;
        await saveUsers(users);
    }
    return users[userId];
}

bot.onText(/\/verify/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const username = msg.from.username;

    console.log(`👤 Пользователь ${userId} (${username ? '@' + username : 'без username'}) вызвал /verify`);

    await getUserData(userId, username);

    if (users[userId].joined) {
        await bot.sendMessage(chatId, '✅ Вы уже верифицированы! 🎉\n\nНажмите "🔗 Получить ссылку" для входа в канал.',
            getMainMenu(userId));
        return;
    }

    // TODO: после конкурса оставить проверку с квадратами
    // if (Math.random() < 0.5) {
    await sendEmojiCaptcha(chatId, userId);
    // } else {
    //     await sendMoveRedSquareCaptcha(chatId, userId);
    // }
});

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const username = msg.from.username;

    console.log(`👤 Пользователь ${userId} (${username ? '@' + username : 'без username'}) вызвал /start`);

    const isNewUser = !users[userId];
    await getUserData(userId, username);

    if (isNewUser) {
        await sendWelcomeOnly(chatId, userId);
    } else {
        let statusMessage = '';
        if (users[userId].joined) {
            statusMessage = '✅ Вы уже верифицированы! 🎉\n\n';
        } else {
            statusMessage = '👋 С возвращением!\n\n';
        }

        await bot.sendMessage(chatId, statusMessage + 'Используйте кнопки меню для навигации:',
            getMainMenu(userId));
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
        `🛑 <b>Проверка безопасности</b>\n\nКакой эмодзи ${correctEmoji.emoji} ${correctEmoji.name}? Выберите правильный вариант:`,
        { parse_mode: 'HTML', reply_markup: keyboard }
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
        `🛑 <b>Проверка безопасности</b>\n\nСовместите красные квадраты, перемещая нижний красный квадрат влево/вправо.\n\n` +
        `${topRow.join('')}\n${bottomRow.join('')}`,
        { parse_mode: 'HTML', reply_markup: keyboard }
    );
}

async function completeVerification(chatId, userId, msg) {
    const username = msg.from.username;

    const isSubscribed = await checkChannelSubscription(userId);

    if (!isSubscribed) {
        const subscribeMessage = `⚠️ <b>Требуется подписка!</b>\n\n` +
            `Для получения доступа к каналу необходимо сначала подписаться на ${REQUIRED_CHANNEL_USERNAME}.\n\n` +
            `📌 <b>Как подписаться:</b>\n` +
            `1️⃣ Нажмите на кнопку ниже\n` +
            `2️⃣ Нажмите "Подписаться/Join"\n` +
            `3️⃣ Вернитесь и нажмите "✅ Проверить подписку"\n\n` +
            `🔗 <a href="https://t.me/${REQUIRED_CHANNEL_USERNAME.replace('@', '')}">${REQUIRED_CHANNEL_USERNAME}</a>`;

        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✅ Проверить подписку', callback_data: 'check_subscription' }]
                ]
            }
        };

        await bot.sendMessage(chatId, subscribeMessage, {
            parse_mode: 'HTML',
            disable_web_page_preview: false,
            ...keyboard
        });
        return;
    }

    if (username && users[userId].username !== username) {
        users[userId].username = username;
    }

    users[userId].joined = true;
    users[userId].lastInvite = null;
    await saveUsers(users);

    try {
        const inviteLink = await bot.createChatInviteLink(CHANNEL_ID, {
            member_limit: 1,
            expire_date: Math.floor(Date.now() / 1000) + 60
        });

        const keyboard = {
            inline_keyboard: [
                [{ text: '🔗 Присоединиться к каналу', url: inviteLink.invite_link }]
            ]
        };

        await bot.sendMessage(chatId, '✅ Верификация пройдена!\n\n👉 Нажмите кнопку для присоединения:\n\n⏰ Ссылка действительна 1 минуту', {
            reply_markup: keyboard
        });

        await bot.sendMessage(chatId, 'Также вы теперь можете получать ссылки через кнопку "🔗 Получить ссылку"',
            getMainMenu(userId));

    } catch (error) {
        console.error('Ошибка создания ссылки:', error);
        await bot.sendMessage(chatId, '❌ Ошибка при создании ссылки. Попробуйте ещё раз.',
            getMainMenu(userId));
    }

    userStates.delete(userId);
    userData.delete(userId);
}

bot.onText(/\/invite/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const username = msg.from.username;

    await getUserData(userId, username);

    if (!users[userId] || !users[userId].joined) {
        await bot.sendMessage(chatId,
            '❌ Вы ещё не верифицированы!\n\nСначала нажмите "🔐 Пройти проверку" или отправьте /verify, чтобы пройти капчу.',
            getMainMenu(userId));
        return;
    }

    const isSubscribed = await checkChannelSubscription(userId);

    if (!isSubscribed) {
        const subscribeMessage = `⚠️ <b>Требуется подписка!</b>\n\n` +
            `Для получения ссылки необходимо быть подписанным на ${REQUIRED_CHANNEL_USERNAME}.\n\n` +
            `📌 <b>Как подписаться:</b>\n` +
            `1️⃣ Нажмите на кнопку ниже\n` +
            `2️⃣ Нажмите "Подписаться/Join"\n` +
            `3️⃣ Вернитесь и нажмите "✅ Проверить подписку"\n\n` +
            `🔗 <a href="https://t.me/${REQUIRED_CHANNEL_USERNAME.replace('@', '')}">${REQUIRED_CHANNEL_USERNAME}</a>`;

        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✅ Проверить подписку', callback_data: 'check_subscription' }]
                ]
            }
        };

        await bot.sendMessage(chatId, subscribeMessage, {
            parse_mode: 'HTML',
            ...keyboard
        });
        return;
    }

    try {
        await bot.sendMessage(chatId, '⏳ Создаю одноразовую ссылку... Подождите секунду.',
            getMainMenu(userId));

        const inviteLink = await bot.createChatInviteLink(CHANNEL_ID, {
            member_limit: 1,
            expire_date: Math.floor(Date.now() / 1000) + 60
        });

        users[userId].lastInvite = new Date().toISOString();
        await saveUsers(users);

        const message = `✅ <b>Ссылка готова!</b>\n\n` +
            `🔗 Ваша одноразовая ссылка:\n` +
            `${inviteLink.invite_link}\n\n` +
            `⏰ Ссылка действительна 1 минуту\n` +
            `🔒 Ссылка может быть использована только один раз\n\n` +
            `👉 Нажмите на ссылку, чтобы присоединиться к каналу!`;

        await bot.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            ...getMainMenu(userId)
        });

    } catch (error) {
        console.error('Ошибка создания ссылки:', error);
        await bot.sendMessage(chatId,
            '❌ Ошибка при создании ссылки. Убедитесь, что бот является администратором канала.',
            getMainMenu(userId));
    }
});

bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();

    let helpText = '📖 <b>Инструкция по использованию бота</b>\n\n' +
        '1️⃣ <b>Начать верификацию</b>\n' +
        '   Нажмите кнопку "🔐 Пройти проверку" или отправьте команду /verify\n\n' +
        '2️⃣ <b>Пройти капчу</b>\n' +
        '   • Выберите правильный эмодзи из предложенных\n' +
        '   • Или совместите красные квадраты, используя стрелки\n\n' +
        '3️⃣ <b>Получить ссылку</b>\n' +
        '   После успешной капчи нажмите "🔗 Получить ссылку" или /invite\n\n' +
        '4️⃣ <b>Вступить в канал</b>\n' +
        '   Нажмите на полученную ссылку (действительна 1 минуту)\n\n' +
        '📌 <b>Важно:</b>\n' +
        '• Ссылка одноразовая и действует 1 минуту\n' +
        '• Если ссылка истекла, запросите новую через /invite\n\n' +
        '❓ <b>Частые проблемы:</b>\n' +
        '• Ссылка не работает? → Запросите новую через /invite\n' +
        '• Не можете пройти проверку? → Нажмите /verify для новой попытки';

    await bot.sendMessage(chatId, helpText, {
        parse_mode: 'HTML',
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

    const adminMessage = `⚙️ <b>Админ-панель</b>\n\n` +
        `📊 <b>Статистика:</b>\n` +
        `• Всего пользователей: ${stats.total}\n` +
        `• Верифицировано: ${stats.verified}\n` +
        `• Не верифицировано: ${stats.unverified}\n\n` +
        `Выберите действие:`;

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '👥 Просмотр пользователей', callback_data: 'admin_view_users' }],
                [{ text: '📈 Подробная статистика', callback_data: 'admin_stats' }],
                [{ text: '🔙 Главное меню', callback_data: 'back_to_menu' }]
            ]
        }
    };

    await bot.sendMessage(chatId, adminMessage, {
        parse_mode: 'HTML',
        ...keyboard
    });
});

bot.onText(/🔐 Пройти проверку/, (msg) => {
    bot.emit('text', { ...msg, text: '/verify' });
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

    if (data === 'check_subscription') {
        const isSubscribed = await checkChannelSubscription(userId, 3);

        if (isSubscribed) {
            await bot.sendMessage(chatId, '✅ Отлично! Вы подписаны на канал. Завершаю верификацию...', getMainMenu(userId));

            const userInfo = userData.get(userId);
            if (userInfo && userInfo.captchaCorrect) {
                const fakeMsg = {
                    chat: { id: chatId },
                    from: { id: parseInt(userId), username: callbackQuery.from.username }
                };
                await completeVerification(chatId, userId, fakeMsg);
            } else {
                await bot.sendMessage(chatId, '⚠️ Пожалуйста, начните верификацию заново через /verify', getMainMenu(userId));
            }
        } else {
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: '❌ Вы ещё не подписались на канал. Пожалуйста, подпишитесь и нажмите проверку снова.',
                show_alert: true
            });
        }
        return;
    }

    if (data === 'back_to_menu') {
        await bot.sendMessage(chatId, '🔙 Возврат в главное меню', getMainMenu(userId));
        return;
    }

    if (data === 'admin_stats' && ADMIN_IDS.includes(parseInt(userId))) {
        const stats = {
            total: Object.keys(users).length,
            verified: Object.values(users).filter(u => u.joined).length,
            totalInvites: Object.values(users).filter(u => u.lastInvite !== null).length
        };

        await bot.editMessageText(
            `📈 <b>Детальная статистика</b>\n\n` +
            `📊 Всего пользователей: ${stats.total}\n` +
            `✅ Верифицировано: ${stats.verified}\n` +
            `⏳ Ожидают: ${stats.total - stats.verified}\n` +
            `🔗 Всего выдано ссылок: ${stats.totalInvites}\n\n` +
            `Нажмите "🔙 Главное меню" для возврата`,
            {
                chat_id: chatId,
                message_id: msg.message_id,
                parse_mode: 'HTML'
            }
        );
        return;
    }

    if (data === 'admin_view_users' && ADMIN_IDS.includes(parseInt(userId))) {
        const usersList = Object.entries(users)
            .sort(([, a], [, b]) => {
                const dateA = a.lastInvite ? new Date(a.lastInvite) : new Date(0);
                const dateB = b.lastInvite ? new Date(b.lastInvite) : new Date(0);

                if (!a.lastInvite && !b.lastInvite) return 0;
                if (!a.lastInvite) return -1;
                if (!b.lastInvite) return 1;

                return dateA - dateB;
            })
            .map(([id, data]) => {
                const username = data.username ? `@${data.username}` : 'нет username';
                const status = data.joined ? '✅' : '❌';
                const lastInviteStr = data.lastInvite ?
                    new Date(data.lastInvite).toLocaleString() : 'никогда';

                let recencyIndicator = '';
                if (data.lastInvite) {
                    const daysAgo = Math.floor((Date.now() - new Date(data.lastInvite)) / (1000 * 60 * 60 * 24));
                    if (daysAgo === 0) recencyIndicator = ' 🔥 (сегодня)';
                    else if (daysAgo === 1) recencyIndicator = ' 📆 (вчера)';
                    else if (daysAgo < 7) recencyIndicator = ` 📅 (${daysAgo} дн. назад)`;
                    else if (daysAgo < 30) recencyIndicator = ` 📅 (${Math.floor(daysAgo / 7)} нед. назад)`;
                    else recencyIndicator = ` 🕒 (${Math.floor(daysAgo / 30)} мес. назад)`;
                }

                return `${status} ${username} (ID: ${id})\n   📅 Последняя ссылка: ${lastInviteStr}${recencyIndicator}`;
            })
            .join('\n\n');

        const totalUsers = Object.keys(users).length;
        const verifiedUsers = Object.values(users).filter(u => u.joined).length;
        const usersWithInvites = Object.values(users).filter(u => u.lastInvite !== null).length;

        const message = usersList ?
            `👥 <b>Список пользователей</b>\n\n` +
            `📊 Всего: ${totalUsers} | ✅ Верифицировано: ${verifiedUsers} | 🔗 Получали ссылку: ${usersWithInvites}\n` +
            `📌 <i>Пользователи отсортированы по дате получения ссылки (старые сверху, новые снизу)</i>\n\n` +
            `${usersList}` :
            'Нет пользователей';

        if (message.length > 4000) {
            await bot.sendMessage(chatId, '⚠️ Список слишком длинный. Отправляю частями...');

            const chunks = [];
            let currentChunk = '';

            for (const line of usersList.split('\n\n')) {
                if ((currentChunk + '\n\n' + line).length > 4000) {
                    chunks.push(currentChunk);
                    currentChunk = line;
                } else {
                    currentChunk += (currentChunk ? '\n\n' : '') + line;
                }
            }
            if (currentChunk) chunks.push(currentChunk);

            for (let i = 0; i < chunks.length; i++) {
                await bot.sendMessage(chatId,
                    `<b>Часть ${i + 1}/${chunks.length}</b>\n\n${chunks[i]}`,
                    { parse_mode: 'HTML' }
                );
            }
        } else {
            if (msg.text && msg.text.includes('Админ-панель')) {
                await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
            } else {
                await bot.editMessageText(message, {
                    chat_id: chatId,
                    message_id: msg.message_id,
                    parse_mode: 'HTML'
                });
            }
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
            await bot.editMessageText('❌ <b>Неправильный ответ!</b>\n\nВы выбрали неверный эмодзи.\nОтправьте /verify для новой попытки.', {
                chat_id: chatId,
                message_id: msg.message_id,
                parse_mode: 'HTML'
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
                await bot.answerCallbackQuery(callbackQuery.id, {
                    text: '❌ Позиции не совпадают! Попробуйте ещё раз.',
                    show_alert: true
                });
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
                `🛑 <b>Проверка безопасности</b>\n\nСовместите красные квадраты:\n\n${topRow.join('')}\n${bottomRow.join('')}`,
                {
                    chat_id: chatId,
                    message_id: msg.message_id,
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                }
            );
        } catch (error) {
            console.error('Ошибка обновления сообщения:', error);
        }
    }
});

init().catch(console.error);