// ============================================================
// botTracker.js
// ALJESAT BOT
// نظام تتبع البوتات الأخرى (تعدد)
// ============================================================

"use strict";

// ============================================================
// أدوات مساعدة
// ============================================================

function cleanNumber(value) {
    if (!value) return "";
    return String(value).replace(/\D/g, "");
}

async function safeSend(sock, jid, content, options = {}) {
    if (!sock || !jid) return Promise.resolve(null);
    return sock.sendMessage(jid, content, options).catch(() => null);
}

function getMessageText(message) {
    if (!message) return "";
    return (
        message.conversation ||
        message.extendedTextMessage?.text ||
        message.imageMessage?.caption ||
        message.videoMessage?.caption ||
        ""
    ).trim();
}

// ============================================================
// رسائل التتبع
// ============================================================

function getBotRegisteredMessage(botName) {
    return `\`تم مراقبة استماراتك يا بوت ${botName}\``;
}

function getBotDeletedMessage(botName) {
    return `❆━━━━━═⏣⊰✅⊱⏣═━━━━━❆
 تم حذف اسم:  \`${botName}\`
❆━━━━━═⏣⊰🛑⊱⏣═━━━━━❆`;
}

function getPermanentSaveMessage() {
    return `◆━─━─━─⊱⊰─━─━─━◆
 📍تم حفظ العضو مؤبد 🛑
◆━─━─━─⊱⊰─━─━─━◆`;
}

function getPermanentReleaseMessage() {
    return `◆━─━─━─⊱✅⊰─━─━─━◆
 تم فك حكم المؤبد عن هذا العضو
◆━─━─━─⊱🟢⊰─━─━─━◆`;
}

function getBannedFromKingdomMessage() {
    return `*⌬━─⟐─ ⊱•♨️•⊰ ─⟐─━⌬*
  انت محفوظ لدي مملكة النار
  بأنك مؤبد..  لهذا بص تحت: 
*⌬━─⟐─ ⊱•♨️•⊰ ─⟐─━⌬*`;
}

function getAdminNotifyMessage(adminMention, userMention, botName) {
    return `❆━━━━━═⏣⊰📡⊱⏣═━━━━━❆
@${adminMention}
ايها الرتب هذا العضو : 
@${userMention}
كان موجود في نقابة { \`${botName}\` } يرجى التحقق بشأنه
❆━━━━━═⏣⊰📍⊱⏣═━━━━━❆`;
}

// ============================================================
// معالجة .انا بوت
// ============================================================

async function handleBotIdentity(sock, jid, msg, parts, db, saveDb, cleanSender) {
    try {
        // التحقق من أن هذا القروب هو قروب ورك
        const isWorkGroup = db.workGroups && db.workGroups[jid] === true;

        if (!isWorkGroup) {
            return false;
        }

        const botName = parts.join(" ").trim();

        if (!botName) {
            await safeSend(sock, jid, {
                text: "⚠️ يرجى كتابة اسمك بعد الأمر.\nمثال: .انا بوت سولار"
            }, { quoted: msg });
            return true;
        }

        // حفظ اسم البوت
        db.trackedBots = db.trackedBots || {};
        db.trackedBots[cleanSender] = {
            name: botName,
            registeredAt: Date.now()
        };

        if (typeof saveDb === "function") saveDb();

        await safeSend(sock, jid, {
            text: getBotRegisteredMessage(botName)
        }, { quoted: msg });

        return true;

    } catch (error) {
        console.error("❌ خطأ في handleBotIdentity:", error?.message || error);
        return false;
    }
}

// ============================================================
// معالجة .حذف نقابتك
// ============================================================

async function handleDeleteBotIdentity(sock, jid, msg, db, saveDb, cleanSender, isEmperor) {
    try {
        if (!isEmperor) {
            await safeSend(sock, jid, {
                text: "⛔ هذا الأمر للإمبراطور فقط."
            }, { quoted: msg });
            return true;
        }

        const mentioned = msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
        if (!mentioned) {
            await safeSend(sock, jid, {
                text: "⚠️ يرجى منشن البوت."
            }, { quoted: msg });
            return true;
        }

        const targetBot = cleanNumber(mentioned);

        if (!db.trackedBots || !db.trackedBots[targetBot]) {
            await safeSend(sock, jid, {
                text: "⚠️ هذا الرقم ليس بوتاً مسجلاً."
            }, { quoted: msg });
            return true;
        }

        const botName = db.trackedBots[targetBot].name;
        delete db.trackedBots[targetBot];

        if (typeof saveDb === "function") saveDb();

        await safeSend(sock, jid, {
            text: getBotDeletedMessage(botName),
            mentions: [mentioned]
        }, { quoted: msg });

        return true;

    } catch (error) {
        console.error("❌ خطأ في handleDeleteBotIdentity:", error?.message || error);
        return false;
    }
}

// ============================================================
// معالجة .مؤبد (بالرد على استمارة ورك)
// ============================================================

async function handlePermanentSave(sock, jid, msg, db, saveDb, cleanSender) {
    try {
        // التحقق من أن هذا القروب هو قروب ورك
        const isWorkGroup = db.workGroups && db.workGroups[jid] === true;

        if (!isWorkGroup) {
            return false;
        }

        // الحصول على الرسالة المقتبسة
        const contextInfo = msg?.message?.extendedTextMessage?.contextInfo;
        if (!contextInfo || !contextInfo.quotedMessage) {
            await safeSend(sock, jid, {
                text: "⚠️ يرجى الرد على استمارة الوورك."
            }, { quoted: msg });
            return true;
        }

        const quotedText = getMessageText(contextInfo.quotedMessage);

        // البحث عن المنشن في الاستمارة
        const mentionMatch = quotedText.match(/@(\d+)/);
        if (!mentionMatch) {
            await safeSend(sock, jid, {
                text: "⚠️ لم يتم العثور على منشن في الاستمارة."
            }, { quoted: msg });
            return true;
        }

        const targetUser = mentionMatch[1];

        // حفظ العضو مؤبد
        db.permanentUsers = db.permanentUsers || {};
        db.permanentUsers[targetUser] = {
            savedBy: cleanSender,
            savedAt: Date.now(),
            sourceBot: db.trackedBots?.[cleanSender]?.name || "غير معروف"
        };

        if (typeof saveDb === "function") saveDb();

        await safeSend(sock, jid, {
            text: getPermanentSaveMessage()
        }, { quoted: msg });

        return true;

    } catch (error) {
        console.error("❌ خطأ في handlePermanentSave:", error?.message || error);
        return false;
    }
}

// ============================================================
// معالجة .اعفاء
// ============================================================

async function handlePermanentRelease(sock, jid, msg, db, saveDb, cleanSender) {
    try {
        // الحصول على الرسالة المقتبسة
        const contextInfo = msg?.message?.extendedTextMessage?.contextInfo;
        if (!contextInfo || !contextInfo.quotedMessage) {
            await safeSend(sock, jid, {
                text: "⚠️ يرجى الرد على استمارة الوورك."
            }, { quoted: msg });
            return true;
        }

        const quotedText = getMessageText(contextInfo.quotedMessage);

        const mentionMatch = quotedText.match(/@(\d+)/);
        if (!mentionMatch) {
            await safeSend(sock, jid, {
                text: "⚠️ لم يتم العثور على منشن في الاستمارة."
            }, { quoted: msg });
            return true;
        }

        const targetUser = mentionMatch[1];

        if (!db.permanentUsers || !db.permanentUsers[targetUser]) {
            await safeSend(sock, jid, {
                text: "⚠️ هذا العضو ليس محفوظاً مؤبداً."
            }, { quoted: msg });
            return true;
        }

        delete db.permanentUsers[targetUser];

        if (typeof saveDb === "function") saveDb();

        await safeSend(sock, jid, {
            text: getPermanentReleaseMessage()
        }, { quoted: msg });

        return true;

    } catch (error) {
        console.error("❌ خطأ في handlePermanentRelease:", error?.message || error);
        return false;
    }
}

// ============================================================
// التحقق من العضو المؤبد (تُستدعى من الاستقبال)
// ============================================================

function isUserPermanent(db, userNumber) {
    if (!db || !db.permanentUsers) return false;
    return Boolean(db.permanentUsers[userNumber]);
}

// ============================================================
// إرسال تنبيهات للادمن (عند دخول عضو استقبال)
// ============================================================

async function notifyAdmins(sock, jid, userNumber, db) {
    try {
        // البحث عن البوت الذي سجل العضو
        // (يتم البحث في قاعدة البيانات عن أي بوت سجل هذا العضو)

        // هذا يحتاج لتخزين معلومات إضافية
        // سنرسل إشعار لجميع من لديهم صلاحية .سجل

        const permissions = db.permissions || {};
        const registerAdmins = permissions["2"] || [];

        if (registerAdmins.length === 0) return false;

        for (const adminNum of registerAdmins) {
            await safeSend(sock, jid, {
                text: getAdminNotifyMessage(
                    adminNum,
                    userNumber,
                    "نقابة غير معروفة"
                ),
                mentions: [
                    `${adminNum}@s.whatsapp.net`,
                    `${userNumber}@s.whatsapp.net`
                ]
            });
        }

        return true;

    } catch (error) {
        console.error("❌ خطأ في notifyAdmins:", error?.message || error);
        return false;
    }
}

// ============================================================
// معالجة .تعدد on/off
// ============================================================

async function handleMultiBotToggle(sock, jid, msg, action, db, saveDb, cleanSender, isBotOwner) {
    try {
        // التحقق من أن هذا القروب هو قروب ورك
        const isWorkGroup = db.workGroups && db.workGroups[jid] === true;

        if (!isWorkGroup) {
            await safeSend(sock, jid, {
                text: "⚠️ هذا الأمر يعمل فقط في قروب الورك."
            }, { quoted: msg });
            return true;
        }

        if (!isBotOwner) {
            await safeSend(sock, jid, {
                text: "⛔ هذا الأمر للمطور فقط."
            }, { quoted: msg });
            return true;
        }

        db.multiBotEnabled = db.multiBotEnabled || {};

        if (action === "on") {
            db.multiBotEnabled[jid] = true;
            if (typeof saveDb === "function") saveDb();
            await safeSend(sock, jid, {
                text: "✅ تم تفعيل نظام تعدد البوتات."
            }, { quoted: msg });
        } else if (action === "off") {
            delete db.multiBotEnabled[jid];
            if (typeof saveDb === "function") saveDb();
            await safeSend(sock, jid, {
                text: "❌ تم إيقاف نظام تعدد البوتات."
            }, { quoted: msg });
        } else {
            await safeSend(sock, jid, {
                text: "⚠️ الاستخدام: .تعدد on/off"
            }, { quoted: msg });
        }

        return true;

    } catch (error) {
        console.error("❌ خطأ في handleMultiBotToggle:", error?.message || error);
        return false;
    }
}

// ============================================================
// تصدير
// ============================================================

module.exports = {
    handleBotIdentity,
    handleDeleteBotIdentity,
    handlePermanentSave,
    handlePermanentRelease,
    handleMultiBotToggle,
    isUserPermanent,
    notifyAdmins,
    getBannedFromKingdomMessage
};