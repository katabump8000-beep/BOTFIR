// ============================================================
// typo.js
// ALJESAT BOT
// تصحيح الأخطاء الإملائية الشائعة في الأوامر (معدل)
// ============================================================

"use strict";

// ============================================================
// أدوات مساعدة
// ============================================================

function normalizeText(text) {
    if (text === null || text === undefined) return "";
    return String(text)
        .trim()
        .replace(/[أإآ]/g, "ا")
        .replace(/ى/g, "ي")
        .replace(/ة/g, "ه")
        .replace(/\s+/g, " ")
        .toLowerCase();
}

async function safeSend(sock, jid, content, options = {}) {
    if (!sock || !jid) return Promise.resolve(null);
    return sock.sendMessage(jid, content, options).catch(() => null);
}

// ============================================================
// خريطة التصحيحات
// ============================================================

const TYPO_MAP = {
    // تفاصيلي
    "تفاصيل": "تفاصيلي",
    "تفاصلي": "تفاصيلي",
    "تفصيلي": "تفاصيلي",
    "معلوماتي": "تفاصيلي",
    "بياناتي": "تفاصيلي",
    "بروفايلي": "تفاصيلي",

    // رتبتي
    "رتبه": "رتبتي",
    "رتبت": "رتبتي",
    "منصبي": "رتبتي",

    // رصيد
    "رصيدي": "تفاصيلي",
    "فلوسي": "تفاصيلي",

    // القاب
    "الالقاب": "القاب",
    "لقاب": "القاب",

    // هدية
    "هديه": "هدية",
    "جائزة": "هدية",
    "جايزة": "هدية",

    // مخزوني
    "مخزنى": "مخزوني",
    "حقيبتي": "مخزوني",

    // العاب
    "الالعاب": "العاب",
    "فعاليات": "العاب",
    "فعالية": "العاب",

    // تفكيك
    "تفكيك الكلمات": "تفكيك",

    // كتابة
    "كتابه": "كتابة",

    // اعلام
    "الأعلام": "اعلام",

    // ايموجي
    "إيموجي": "ايموجي",
    "ايموجى": "ايموجي",

    // الوان
    "الألوان": "الوان",
    "لون": "الوان",

    // الحيوانات
    "حيوانات": "الحيوانات",

    // تخمين
    "التخمين": "تخمين",
    "خمن": "تخمين",

    // صراحة
    "صراحه": "صراحة",
    "الصراحة": "صراحة",

    // كازينو
    "الكازينو": "كازينو",

    // روليت
    "الروليت": "روليت",

    // كريستال
    "الكرستال": "كريستال",

    // مزاد
    "المزاد": "مزاد",

    // ابلاغ
    "الإبلاغ": "ابلاغ",
    "شكوى": "ابلاغ",

    // رتبته
    "رتبة العضو": "رتبته",

    // علاقة
    "علاقه": "علاقة",

    // تحويل
    "حول": "تحويل",

    // اوامر
    "الأوامر": "اوامر",
    "الاوامر": "اوامر",

    // نتائج
    "النتائج": "نتائج",

    // متجر
    "المتجر": "متجر",
    "store": "متجر",

    // شراء
    "اشتري": "شراء",
    "buy": "شراء",

    // من
    "مين": "من",
    "who": "من",

    // اتبع حدسك
    "حدس": "اتبع حدسك",
    "اتبع": "اتبع حدسك",
    "خمن الكرة": "اتبع حدسك"
};

// ============================================================
// استخراج الأمر المصحح
// ============================================================

function getCorrectedCommand(text) {
    if (!text) return null;

    let cleaned = String(text).trim();
    
    // إذا كان يبدأ بنقطة، أزل النقطة مؤقتاً
    let hadDot = false;
    if (cleaned.startsWith(".")) {
        hadDot = true;
        cleaned = cleaned.slice(1).trim();
    }

    if (!cleaned) return null;

    const normalized = normalizeText(cleaned);

    // البحث المباشر
    if (TYPO_MAP[normalized]) {
        return "." + TYPO_MAP[normalized];
    }

    // البحث بالكلمات المفتاحية
    for (const [key, cmd] of Object.entries(TYPO_MAP)) {
        if (normalized === key) {
            return "." + cmd;
        }
        if (normalized.startsWith(key + " ")) {
            const rest = cleaned.slice(key.length).trim();
            return "." + cmd + (rest ? " " + rest : "");
        }
    }

    return null;
}

// ============================================================
// المعالجة الرئيسية
// ============================================================

async function handleTypo(sock, jid, msg, text, db, cleanSender, isBotOwner) {
    try {
        if (!text) return false;

        // إذا كانت الرسالة تبدأ بنقطة، جرب التصحيح
        // وإلا جرب أيضاً (للأوامر بدون نقطة)
        
        const corrected = getCorrectedCommand(text);
        if (!corrected) return false;

        // إذا كان الأمر الأصلي يبدأ بنقطة، لا نعالجه هنا
        // (handleCommand سيتعامل معه)
        if (String(text).startsWith(".")) return false;

        // إرسال الأمر المصحح إلى handleCommand
        try {
            const { handleCommand } = require("./commands");

            const fakeMsg = {
                ...msg,
                message: { conversation: corrected }
            };

            const handled = await handleCommand(sock, jid, fakeMsg, {
                db,
                sender: msg?.key?.participant || msg?.key?.remoteJid,
                cleanSender,
                isGroup: true,
                isBotOwner: Boolean(isBotOwner),
                botNumber: cleanSender,
                text: corrected
            });

            return handled !== false;

        } catch (err) {
            console.error("❌ typo exec error:", err?.message);
            return false;
        }

    } catch (error) {
        console.error("❌ خطأ في handleTypo:", error?.message || error);
        return false;
    }
}

// ============================================================
// تصدير
// ============================================================

module.exports = {
    handleTypo,
    getCorrectedCommand,
    TYPO_MAP,
    normalizeText
};