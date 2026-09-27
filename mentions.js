// ============================================================
// mentions.js
// ALJESAT BOT
// إصلاح المنشن في الرسائل
// ============================================================

"use strict";

// ============================================================
// أدوات مساعدة
// ============================================================

function cleanNumber(value) {
    if (!value) return "";
    return String(value).replace(/\D/g, "");
}

/**
 * تنسيق المنشن الصحيح
 * بدلاً من @⁨+1 31469804621891⁩
 * نستخدم @1234567890
 */
function formatMention(number) {
    const clean = cleanNumber(number);
    if (!clean) return "";
    return `@${clean}`;
}

/**
 * تنسيق JID للمنشن
 */
function formatMentionJid(number) {
    const clean = cleanNumber(number);
    if (!clean) return "";
    return `${clean}@s.whatsapp.net`;
}

/**
 * تنظيف النص من المنشنات الخاطئة
 */
function cleanMentions(text) {
    if (!text) return "";
    // إزالة الرموز الغريبة من المنشنات
    return String(text)
        .replace(/@⁨[^⁩]*⁩/g, "")
        .replace(/@\+1\s*/g, "@")
        .trim();
}

/**
 * إنشاء كائن mentions صحيح
 */
function createMentions(numbers) {
    if (!Array.isArray(numbers)) {
        numbers = [numbers];
    }
    return numbers
        .map(formatMentionJid)
        .filter(Boolean);
}

// ============================================================
// تصدير
// ============================================================

module.exports = {
    formatMention,
    formatMentionJid,
    cleanMentions,
    createMentions
};