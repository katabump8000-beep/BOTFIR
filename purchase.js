// ============================================================
// purchase.js
// ALJESAT BOT
// نظام طلبات الشراء
// ============================================================

"use strict";

// ============================================================
// أدوات مساعدة
// ============================================================

function cleanNumber(value) {
    if (!value) return "";
    return String(value).replace(/\D/g, "");
}

function getUser(db, jid) {
    if (!db || !db.users) return null;
    return db.users[jid] || null;
}

async function safeSend(sock, jid, content, options = {}) {
    if (!sock || !jid) return Promise.resolve(null);
    return sock.sendMessage(jid, content, options).catch(() => null);
}

function getUserNickname(db, jid) {
    const user = getUser(db, jid);
    return (user && String(user.nickname || "").trim()) || "مجهول";
}

// ============================================================
// رسائل الطلبات
// ============================================================

function getPurchaseRequestMessage(nickname, orderText) {
    return `❆━━━━━═⏣⊰🛒⊱⏣═━━━━━❆
 طَلَبَ \`${nickname}\` شراء ${orderText}
❆━━━━━═⏣⊰🏦⊱⏣═━━━━━❆`;
}

function getPurchaseSuccessMessage() {
    return `✅ تم إرسال طلبك بنجاح!
سيتم التواصل معك قريباً.`;
}

function getPurchaseNoGroup() {
    return `⚠️ قروب الطلبات غير مفعل حالياً.
يرجى التواصل مع الإدارة.`;
}

function getPurchaseEmpty() {
    return `⚠️ يرجى كتابة طلبك بعد الأمر.
مثال: .شراء بطاقة ترقية`;
}

function getOrdersEnabled() {
    return `✅ تم تفعيل قروب الطلبات.`;
}

function getOrdersDisabled() {
    return `❌ تم إيقاف قروب الطلبات.`;
}

// ============================================================
// معالجة أمر .شراء
// ============================================================

async function handlePurchaseCommand(sock, jid, msg, parts, db, cleanSender) {
    try {
        const orderText = parts.join(" ").trim();

        if (!orderText) {
            await safeSend(sock, jid, {
                text: getPurchaseEmpty()
            }, { quoted: msg });
            return true;
        }

        // البحث عن قروب الطلبات
        db.ordersGroups = db.ordersGroups || {};
        const ordersJids = Object.keys(db.ordersGroups).filter(j => db.ordersGroups[j] === true);

        if (ordersJids.length === 0) {
            await safeSend(sock, jid, {
                text: getPurchaseNoGroup()
            }, { quoted: msg });
            return true;
        }

        const nickname = getUserNickname(db, cleanSender);

        // إرسال الطلب لقروب الطلبات
        for (const ordersJid of ordersJids) {
            await safeSend(sock, ordersJid, {
                text: getPurchaseRequestMessage(nickname, orderText)
            });
        }

        // تأكيد للعضو
        await safeSend(sock, jid, {
            text: getPurchaseSuccessMessage()
        }, { quoted: msg });

        return true;

    } catch (error) {
        console.error("❌ خطأ في handlePurchaseCommand:", error?.message || error);
        return false;
    }
}

// ============================================================
// معالجة أمر .طلبات on/off
// ============================================================

async function handleOrdersToggle(sock, jid, msg, action, db, saveDb, cleanSender, isBotOwner) {
    try {
        if (!isBotOwner) {
            await safeSend(sock, jid, {
                text: "⛔ هذا الأمر للمطور فقط."
            }, { quoted: msg });
            return true;
        }

        db.ordersGroups = db.ordersGroups || {};

        if (action === "on") {
            db.ordersGroups[jid] = true;
            if (typeof saveDb === "function") saveDb();
            await safeSend(sock, jid, {
                text: getOrdersEnabled()
            }, { quoted: msg });
        } else if (action === "off") {
            delete db.ordersGroups[jid];
            if (typeof saveDb === "function") saveDb();
            await safeSend(sock, jid, {
                text: getOrdersDisabled()
            }, { quoted: msg });
        } else {
            await safeSend(sock, jid, {
                text: "⚠️ الاستخدام: .طلبات on/off"
            }, { quoted: msg });
        }

        return true;

    } catch (error) {
        console.error("❌ خطأ في handleOrdersToggle:", error?.message || error);
        return false;
    }
}

// ============================================================
// تصدير
// ============================================================

module.exports = {
    handlePurchaseCommand,
    handleOrdersToggle,
    getPurchaseRequestMessage
};