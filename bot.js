const TelegramBot = require('node-telegram-bot-api');
const puppeteer = require('puppeteer');
const fs = require('fs');

const token = '6845291404:AAFwsPGqdbSOjx19EVXjjh4EnUQD1v1vJlc';
const bot = new TelegramBot(token, { polling: true });

const STATES = {
    IDLE: 'IDLE',
    WAITING_USERNAME: 'WAITING_USERNAME',
    WAITING_PASSWORD: 'WAITING_PASSWORD',
    WAITING_CALLER_ID: 'WAITING_CALLER_ID'
};

const userStates = new Map();
const userSessions = new Map();

let browser;
(async () => {
    browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
})();

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    userStates.set(chatId, STATES.IDLE);
    
    const opts = {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'تسجيل الدخول', callback_data: 'login' }]
            ]
        }
    };
    
    bot.sendMessage(chatId, 'مرحباً بك في بوت تغيير معرف المتصل\nاضغط على زر تسجيل الدخول للبدء', opts);
});

bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    
    if (data === 'login') {
        userStates.set(chatId, STATES.WAITING_USERNAME);
        bot.sendMessage(chatId, 'الرجاء إدخال اسم المستخدم:');
    }
});

bot.on('message', async (msg) => {
    if (msg.text && !msg.text.startsWith('/')) {
        const chatId = msg.chat.id;
        const state = userStates.get(chatId);
        
        switch (state) {
            case STATES.WAITING_USERNAME:
                userSessions.set(chatId, { username: msg.text });
                userStates.set(chatId, STATES.WAITING_PASSWORD);
                bot.sendMessage(chatId, 'الرجاء إدخال كلمة المرور:');
                break;
                
            case STATES.WAITING_PASSWORD:
                const statusMessage = await bot.sendMessage(chatId, 'جاري تسجيل الدخول... ⏳');
                const session = userSessions.get(chatId);
                session.password = msg.text;
                
                try {
                    const loginResult = await performLogin(session.username, session.password);
                    if (loginResult.success) {
                        userStates.set(chatId, STATES.WAITING_CALLER_ID);
                        session.page = loginResult.page;
                        userSessions.set(chatId, session);
                        bot.editMessageText('✅ تم تسجيل الدخول بنجاح!\nالرجاء إدخال معرف المتصل الجديد:', {
                            chat_id: chatId,
                            message_id: statusMessage.message_id
                        });
                    } else {
                        userStates.set(chatId, STATES.IDLE);
                        bot.editMessageText('❌ فشل تسجيل الدخول. يرجى التحقق من اسم المستخدم وكلمة المرور.', {
                            chat_id: chatId,
                            message_id: statusMessage.message_id
                        });
                    }
                } catch (error) {
                    console.error('خطأ في تسجيل الدخول:', error);
                    bot.editMessageText('❌ حدث خطأ أثناء محاولة تسجيل الدخول. الرجاء المحاولة مرة أخرى.', {
                        chat_id: chatId,
                        message_id: statusMessage.message_id
                    });
                    userStates.set(chatId, STATES.IDLE);
                }
                break;
                
            case STATES.WAITING_CALLER_ID:
                const updateMessage = await bot.sendMessage(chatId, 'جاري تغيير معرف المتصل... ⏳');
                const currentSession = userSessions.get(chatId);
                
                try {
                    const updateResult = await updateCallerId(currentSession.page, msg.text);
                    if (updateResult.success) {
                        bot.editMessageText(`✅ تم تغيير معرف المتصل بنجاح إلى: ${msg.text}`, {
                            chat_id: chatId,
                            message_id: updateMessage.message_id
                        });
                    } else {
                        bot.editMessageText('❌ فشل تغيير معرف المتصل. الرجاء المحاولة مرة أخرى.', {
                            chat_id: chatId,
                            message_id: updateMessage.message_id
                        });
                    }
                } catch (error) {
                    console.error('خطأ في تغيير معرف المتصل:', error);
                    bot.editMessageText('❌ حدث خطأ أثناء محاولة تغيير معرف المتصل.', {
                        chat_id: chatId,
                        message_id: updateMessage.message_id
                    });
                }
                
                userStates.set(chatId, STATES.IDLE);
                if (currentSession.page) {
                    await currentSession.page.close();
                }
                userSessions.delete(chatId);
                break;
        }
    }
});

async function performLogin(username, password) {
    const page = await browser.newPage();
    try {
        await page.goto('http://sip.vipcaller.net/mbilling/', {
            waitUntil: 'networkidle0',
            timeout: 60000
        });

        await page.waitForSelector('input[name="username"]');
        await page.waitForSelector('input[name="password"]');

        await page.type('input[name="username"]', username);
        await page.type('input[name="password"]', password);

        await Promise.all([
            page.click('button[type="submit"]'),
            page.waitForNavigation({ waitUntil: 'networkidle0' })
        ]);

        const url = page.url();
        const content = await page.content();
        
        if (url.includes('dashboard') || content.includes('welcome') || content.includes('الصفحة الرئيسية')) {
            return { success: true, page };
        } else {
            await page.close();
            return { success: false };
        }
    } catch (error) {
        console.error('خطأ في عملية تسجيل الدخول:', error);
        await page.close();
        throw error;
    }
}

async function updateCallerId(page, newCallerId) {
    try {
        await page.goto('http://sip.vipcaller.net/mbilling/user/profile', {
            waitUntil: 'networkidle0'
        });

        await page.waitForSelector('input[name="CallerID"]');

        await page.$eval('input[name="CallerID"]', el => el.value = '');
        await page.type('input[name="CallerID"]', newCallerId);

        await Promise.all([
            page.click('button[type="submit"]'),
            page.waitForNavigation({ waitUntil: 'networkidle0' })
        ]);

        const content = await page.content();
        return {
            success: content.includes('success') || content.includes('تم التحديث بنجاح')
        };
    } catch (error) {
        console.error('خطأ في تحديث معرف المتصل:', error);
        throw error;
    }
}

process.on('SIGINT', async () => {
    if (browser) {
        await browser.close();
    }
    process.exit();
});
