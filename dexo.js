// ============================================================
// dexo.js
// ALJESAT BOT - كل المنطق والمعالجات (نسخة محدثة)
// ============================================================

"use strict";

const fs = require("fs");
const path = require("path");

// ============================================================
// Imports
// ============================================================

const {
    startBot, configureHandlers, getDb, saveDb,
    jidToNumber, isGroupJid, isOwner, cleanNumber
} = require("./bot");

const { handleCommand } = require("./commands");
const { handleGroupJoin, startAdminMonitoring, stopAdminMonitoring } = require("./admin");
const { activeGames } = require("./menu");
const { activeCasinos, isSarahaActive } = require("./duel");
const { activeSaraha, handleSarahaCommand } = require("./saraha");
const {
    activeMazads, handleMazadCommand, handleMazadBid,
    handleMazadInventory, handleMazadSend, handleMazadCancelSend
} = require("./mzad");
const { activeColors, handleColorsCommand } = require("./colors");
const { activeAnimals, handleAnimalsCommand } = require("./animals");

// ============================================================
// استيراد الملفات الاختيارية
// ============================================================

let photosModule = null, welcomeModule = null, tahminModule = null;
let resultsModule = null, commandsListModule = null, typoModule = null;
let storeModule = null, purchaseModule = null, botTrackerModule = null;
let guessModule = null, violationModule = null;

try { photosModule = require("./photos"); } catch (e) {}
try { welcomeModule = require("./welcome"); } catch (e) {}
try { tahminModule = require("./tahmin"); } catch (e) {}
try { resultsModule = require("./results"); } catch (e) {}
try { commandsListModule = require("./commands_list"); } catch (e) {}
try { typoModule = require("./typo"); } catch (e) {}
try { storeModule = require("./store"); } catch (e) {}
try { purchaseModule = require("./purchase"); } catch (e) {}
try { botTrackerModule = require("./botTracker"); } catch (e) {}
try { guessModule = require("./guess"); } catch (e) {}
try { violationModule = require("./violation"); } catch (e) {}

// ============================================================
// المتغيرات العامة
// ============================================================

let autoSaveInterval = null;
let autoSaveEnabled = false;
let autoSaveGroupJid = null;
let watchdogInterval = null;
let lastMessageAt = Date.now();
let lastSocketRef = null;
let consecutiveIdleChecks = 0;

const WATCHDOG_CHECK_MS = 60 * 1000;
const IDLE_THRESHOLD_MS = 15 * 60 * 1000;
const GAME_STUCK_THRESHOLD_MS = 25 * 60 * 1000;
const MAX_IDLE_CHECKS = 15;
const MAX_GAME_COUNT = 8;

const pendingGamesMenu = Object.create(null);
global.pendingGamesMenu = pendingGamesMenu;

if (!global.messageCounters) global.messageCounters = {};
if (!global.reactCounters) global.reactCounters = {};

const REACT_EMOJIS = [
    "🥀", "🫟", "🔥", "🎀", "🍁", "🥲", "🙂", "⭐", "🐦‍⬛",
    "🍀", "🐱", "🕯", "🎉", "🍿", "🫠", "🍭", "🍒", "🍫",
    "🍯", "🐥", "👻", "🍅"
];

// ============================================================
// Helpers
// ============================================================

function getMessageTextFromMsg(msg) {
    if (!msg || !msg.message) return "";
    const m = msg.message;
    return (m.conversation || m.extendedTextMessage?.text ||
        m.imageMessage?.caption || m.videoMessage?.caption ||
        m.documentMessage?.caption ||
        m.buttonsResponseMessage?.selectedButtonId ||
        m.listResponseMessage?.singleSelectReply?.selectedRowId ||
        m.templateButtonReplyMessage?.selectedId || "").trim();
}

function getSender(msg, sock) {
    try {
        if (msg?.key?.fromMe) return sock?.user?.id || "";
        return msg?.key?.participant || msg?.key?.remoteJid || "";
    } catch { return ""; }
}

function getBotNumber(sock) {
    try { return jidToNumber(sock?.user?.id || ""); } catch { return ""; }
}

function shouldIgnoreMessage(msg) {
    try {
        if (!msg?.message) return true;
        const jid = msg?.key?.remoteJid;
        if (!jid) return true;
        if (jid === "status@broadcast") return true;
        return false;
    } catch { return true; }
}

function fixMention(number) {
    const c = cleanNumber(number);
    return c ? `@${c}` : "";
}

function fixMentionJid(number) {
    const c = cleanNumber(number);
    return c ? `${c}@s.whatsapp.net` : "";
}

function isUserBanned(db, userNumber) {
    if (!db?.bannedUsers) return false;
    const ban = db.bannedUsers[userNumber];
    if (!ban) return false;
    if (Date.now() > ban.until) { delete db.bannedUsers[userNumber]; return false; }
    return true;
}

function getBanTimeLeft(db, userNumber) {
    if (!db?.bannedUsers) return null;
    const ban = db.bannedUsers[userNumber];
    if (!ban) return null;
    const left = ban.until - Date.now();
    if (left <= 0) return null;
    const s = Math.floor(left / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (d > 0) return `${d}ي`;
    if (h > 0) return `${h}س`;
    if (m > 0) return `${m}د`;
    return `${s}ث`;
}

function isMainGroup(db, jid) {
    return Boolean(db.mainGroup && db.mainGroup[jid] === true);
}

function isAdsGroup(db, jid) {
    return Boolean(db.adsGroups && db.adsGroups[jid] === true);
}

function setupAdminMonitoring(sock) {
    try {
        const db = getDb();
        if (!db) return;
        stopAdminMonitoring();
        startAdminMonitoring(sock, db, saveDb);
    } catch (e) { console.error("Admin monitoring error:", e?.message); }
}

// ============================================================
// كشف الأمر داخل الرسالة
// ============================================================

const KNOWN_COMMANDS = [
    "اعلام", "تخمين", "الحيوانات", "كتابة", "تفكيك", "الوان",
    "ايموجي", "روليت", "كريستال", "الكرستال", "صراحة", "كازينو",
    "العاب", "اتبع حدسك", "مزاد", "تفاصيلي", "تفاصيله", "رصيد",
    "هدية", "القاب", "اوامر", "نتائج", "مخزوني", "متجر", "شراء",
    "من", "وقف", "كمل", "ايقاف", "استراحة", "الاباطرة"
];

function extractCommand(text) {
    if (!text) return null;
    const str = String(text);

    // إذا الرسالة كاملة أمر
    if (str.trim().startsWith(".")) {
        return str.trim();
    }

    // البحث عن أي أمر معروف داخل الرسالة
    for (const cmd of KNOWN_COMMANDS) {
        const regex = new RegExp(`\\.${cmd}(?:\\s|$)`, "i");
        const match = str.match(regex);
        if (match) {
            const idx = str.indexOf(match[0]);
            return str.slice(idx).trim();
        }
    }

    return null;
}

// ============================================================
// Auto Save
// ============================================================

const DB_FILE = path.join(__dirname, "database.json");

async function sendDatabaseBackup(sock) {
    if (!autoSaveEnabled || !autoSaveGroupJid || !sock) return;
    try {
        if (!fs.existsSync(DB_FILE)) return;
        const dbContent = fs.readFileSync(DB_FILE, "utf8");
        if (!dbContent) return;

        const maxLength = 65536;
        const parts = [];
        if (dbContent.length > maxLength) {
            for (let i = 0; i < dbContent.length; i += maxLength) {
                parts.push(dbContent.substring(i, i + maxLength));
            }
        } else {
            parts.push(dbContent);
        }

        const ts = new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', hour12: false });
        for (let i = 0; i < parts.length; i++) {
            const isLast = i === parts.length - 1;
            const header = `📦 *نسخة احتياطية*\n🕐 ${ts}\n📊 جزء ${i + 1}/${parts.length}\n\n`;
            const footer = isLast ? "\n\n✅ تم الحفظ ✅" : '';
            await sock.sendMessage(autoSaveGroupJid, { text: header + parts[i] + footer });
        }
    } catch (e) { console.error("Backup error:", e?.message); }
}

function startAutoSave(sock, jid) {
    if (autoSaveInterval) clearInterval(autoSaveInterval);
    autoSaveEnabled = true;
    autoSaveGroupJid = jid;
    setTimeout(() => sendDatabaseBackup(sock), 3000);
    autoSaveInterval = setInterval(() => sendDatabaseBackup(sock), 4 * 60 * 60 * 1000);
}

function stopAutoSave() {
    if (autoSaveInterval) clearInterval(autoSaveInterval);
    autoSaveInterval = null;
    autoSaveEnabled = false;
    autoSaveGroupJid = null;
}

// ============================================================
// Auto Replies
// ============================================================

async function handleAutoReplies(sock, jid, msg, text, sender, cleanSender, db, saveDb) {
    try {
        if (isSarahaActive && isSarahaActive(jid)) return;

        if (db.hisbaEnabled && db.hisbaEnabled[jid]) {
            if (!global.messageCounters[jid]) global.messageCounters[jid] = {};
            if (!global.messageCounters[jid][cleanSender]) global.messageCounters[jid][cleanSender] = 0;
            global.messageCounters[jid][cleanSender]++;
        }

        if (db.reactEnabled && db.reactEnabled[jid]) {
            if (!global.reactCounters[jid]) global.reactCounters[jid] = 0;
            global.reactCounters[jid]++;
            if (global.reactCounters[jid] >= 13) {
                global.reactCounters[jid] = 0;
                const emoji = REACT_EMOJIS[Math.floor(Math.random() * REACT_EMOJIS.length)];
                try { await sock.sendMessage(jid, { react: { text: emoji, key: msg.key } }); } catch (_) {}
            }
        }

        const msgContent = msg.message || {};
        if (db.protectCards && db.protectCards[jid]) {
            if (msgContent.contactMessage || msgContent.contactsArrayMessage) {
                try { await sock.sendMessage(jid, { delete: msg.key }); } catch (_) {}
                try {
                    const sJid = msg?.key?.participant || msg?.key?.remoteJid;
                    if (sJid) await sock.groupParticipantsUpdate(jid, [sJid], "remove");
                } catch (_) {}
                return;
            }
        }

        if (db.repliesEnabled && db.repliesEnabled[jid]) {
            const badWords = ["كول خرا", "كول خراا", "يلعون", "يلعن امك", "يلعن ابوك"];
            if (badWords.some(w => text.includes(w))) {
                let isAdminUser = false;
                try {
                    const md = await sock.groupMetadata(jid);
                    const p = md.participants.find(p => p.id === sender);
                    if (p && (p.admin === "admin" || p.admin === "superadmin")) isAdminUser = true;
                } catch {}
                await sock.sendMessage(jid, {
                    text: isAdminUser
                        ? `═════════════════════\nلولا رتبتك لكنت اعطيتك درسا عن الردود\n═════════════════════`
                        : `═════════════════\nالخرا لسانه خرا مع الكل\n═════════════════`
                });
                return;
            }
        }

        if (db.ahaEnabled && db.ahaEnabled[jid] && /احا{1,}/.test(text)) {
            db.ahaCooldown = db.ahaCooldown || {};
            const now = Date.now();
            if (now - (db.ahaCooldown[jid] || 0) > 5 * 60 * 1000) {
                db.ahaCooldown[jid] = now;
                saveDb();
                await sock.sendMessage(jid, {
                    text: `═════ احا وأخواتها ═════\nاحا. احيه. احوه. احات. احاوات.اح\n══════════════════`
                });
            }
            return;
        }

        if (db.quietEnabled && db.quietEnabled[jid]) {
            db.quietTimer = db.quietTimer || {};
            if (db.quietTimer[jid]) {
                db.quietTimer[jid].lastMessageTime = Date.now();
                db.quietTimer[jid].sent = false;
                saveDb();
            }
        }
    } catch (e) { console.error("AutoReplies error:", e?.message); }
}

// ============================================================
// Games Analysis
// ============================================================

function getGamesDetailed() {
    const now = Date.now();
    const d = { total: 0, stuck: 0, healthy: 0, list: [] };
    const check = (jid, game, name, t) => {
        d.total++;
        const idle = now - (game?.lastActivity || game?.startTime || 0);
        if (idle > t + 60000) { d.stuck++; d.list.push({ jid, name, idle, status: "STUCK" }); }
        else { d.healthy++; d.list.push({ jid, name, idle, status: "HEALTHY" }); }
    };
    try {
        Object.keys(activeGames || {}).forEach(j => check(j, activeGames[j], "لعبة", 300000));
        Object.keys(activeCasinos || {}).forEach(j => check(j, activeCasinos[j], "روليت", 1500000));
        Object.keys(activeSaraha || {}).forEach(j => check(j, activeSaraha[j], "صراحة", 300000));
        Object.keys(activeColors || {}).forEach(j => check(j, activeColors[j], "ألوان", 300000));
        Object.keys(activeAnimals || {}).forEach(j => check(j, activeAnimals[j], "حيوانات", 300000));
        Object.keys(activeMazads || {}).forEach(j => check(j, activeMazads[j], "مزاد", 2100000));
        if (tahminModule?.activeTahmin) Object.keys(tahminModule.activeTahmin).forEach(j => check(j, tahminModule.activeTahmin[j], "تخمين", 300000));
        if (guessModule?.activeGuess) Object.keys(guessModule.activeGuess).forEach(j => check(j, guessModule.activeGuess[j], "حدسك", 300000));
    } catch {}
    return d;
}

function getStuckGamesInGroup() {
    const now = Date.now();
    const stuck = [];
    const check = (jid, game, name, t) => {
        const last = game?.lastActivity || game?.startTime || 0;
        if ((now - last) > t + 60000) stuck.push({ jid, name, game });
    };
    try {
        Object.keys(activeGames || {}).forEach(j => check(j, activeGames[j], "لعبة", 300000));
        Object.keys(activeColors || {}).forEach(j => check(j, activeColors[j], "ألوان", 300000));
        Object.keys(activeAnimals || {}).forEach(j => check(j, activeAnimals[j], "حيوانات", 300000));
        Object.keys(activeSaraha || {}).forEach(j => check(j, activeSaraha[j], "صراحة", 300000));
        Object.keys(activeCasinos || {}).forEach(j => check(j, activeCasinos[j], "روليت", 1500000));
        Object.keys(activeMazads || {}).forEach(j => check(j, activeMazads[j], "مزاد", 2100000));
        if (tahminModule?.activeTahmin) Object.keys(tahminModule.activeTahmin).forEach(j => check(j, tahminModule.activeTahmin[j], "تخمين", 300000));
        if (guessModule?.activeGuess) Object.keys(guessModule.activeGuess).forEach(j => check(j, guessModule.activeGuess[j], "حدسك", 300000));
    } catch {}
    return stuck;
}

function stopSingleGame(entry) {
    try {
        const { jid, name, game } = entry;
        if (name === "مزاد") { try { game?.stopMazad?.(); } catch {} delete activeMazads[jid]; }
        else if (name === "روليت") { try { game?.stopGame?.(); } catch {} delete activeCasinos[jid]; }
        else if (name === "تخمين") { if (tahminModule?.stopTahminGame) { try { tahminModule.stopTahminGame(jid); } catch {} } }
        else if (name === "حدسك") { if (guessModule?.stopGuessGame) { try { guessModule.stopGuessGame(jid); } catch {} } }
        else {
            try { game?.stopGame?.(); } catch {}
            delete activeGames[jid]; delete activeColors[jid];
            delete activeAnimals[jid]; delete activeSaraha[jid];
        }
        return true;
    } catch { return false; }
}

// ============================================================
// Rest System
// ============================================================

const restRequests = Object.create(null);

async function requestRestInGroup(sock, jid, reason = "ضغط هائل") {
    if (restRequests[jid]) return false;
    try {
        await sock.sendMessage(jid, {
            text: `◆━─━─━─⊱☢️⊰─━─━─━◆\nملاحظة هناك ${reason} على\n البوت يرجى ارسال امر: \n*.استراحة*\nللحفاظ على عدم تعليق البوت\n◆━─━─━─⊱🛑⊰─━─━─━◆`
        });
        const tid = setTimeout(async () => {
            const stuck = getStuckGamesInGroup().filter(g => g.jid === jid);
            for (const e of stuck) stopSingleGame(e);
            if (stuck.length > 0) {
                await sock.sendMessage(jid, { text: `⏰ انتهت المهلة دون استجابة.\n🛑 تم إيقاف ${stuck.length} فعالية عالقة.` }).catch(() => {});
            }
            delete restRequests[jid];
        }, 60000);
        restRequests[jid] = { timeout: tid, sentAt: Date.now() };
        return true;
    } catch (e) { console.error("requestRestInGroup error:", e?.message); return false; }
}

async function handleRestCommand(sock, jid, msg, db) {
    if (restRequests[jid]) { clearTimeout(restRequests[jid].timeout); delete restRequests[jid]; }
    const stuck = getStuckGamesInGroup().filter(g => g.jid === jid);
    let stoppedCount = 0;
    if (stuck.length === 0) {
        try {
            if (activeGames[jid]) { activeGames[jid]?.stopGame?.(); delete activeGames[jid]; stoppedCount++; }
            if (activeColors[jid]) { activeColors[jid]?.stopGame?.(); delete activeColors[jid]; stoppedCount++; }
            if (activeAnimals[jid]) { activeAnimals[jid]?.stopGame?.(); delete activeAnimals[jid]; stoppedCount++; }
            if (activeSaraha[jid]) { activeSaraha[jid]?.stopGame?.(); delete activeSaraha[jid]; stoppedCount++; }
            if (activeCasinos[jid]) { activeCasinos[jid]?.stopGame?.(); delete activeCasinos[jid]; stoppedCount++; }
            if (activeMazads[jid]) { activeMazads[jid]?.stopMazad?.(); delete activeMazads[jid]; stoppedCount++; }
            if (tahminModule?.stopTahminGame && tahminModule.activeTahmin?.[jid]) { tahminModule.stopTahminGame(jid); stoppedCount++; }
            if (guessModule?.stopGuessGame && guessModule.activeGuess?.[jid]) { guessModule.stopGuessGame(jid); stoppedCount++; }
        } catch {}
    } else {
        for (const e of stuck) if (stopSingleGame(e)) stoppedCount++;
    }
    try {
        await sock.sendMessage(jid, {
            text: `◆━─━─━─⊱✅⊰─━─━─━◆\nتم الاستجابة لطلب الاستراحة\n🛑 عدد الفعاليات المتوقفة: \`${stoppedCount}\`\nشكراً لتعاونكم ❤️\n◆━─━─━─⊱🛑⊰─━─━─━◆`
        }, { quoted: msg });
    } catch {}
    lastMessageAt = Date.now();
    return true;
}

// ============================================================
// Watchdog
// ============================================================

function startWatchdog(sock) {
    lastSocketRef = sock;
    lastMessageAt = Date.now();
    consecutiveIdleChecks = 0;
    if (watchdogInterval) clearInterval(watchdogInterval);
    watchdogInterval = setInterval(async () => {
        try {
            const now = Date.now();
            const idleMs = now - lastMessageAt;
            const games = getGamesDetailed();
            if (games.stuck > 0 && idleMs > GAME_STUCK_THRESHOLD_MS) {
                const stuckList = getStuckGamesInGroup();
                const groups = [...new Set(stuckList.map(g => g.jid))];
                for (const g of groups) if (!restRequests[g]) await requestRestInGroup(sock, g, "ضغط هائل");
                consecutiveIdleChecks = 0;
                return;
            }
            if (games.healthy > 0) return;
            if (idleMs > IDLE_THRESHOLD_MS) {
                consecutiveIdleChecks++;
                if (consecutiveIdleChecks >= MAX_IDLE_CHECKS) {
                    consecutiveIdleChecks = 0;
                    try { if (lastSocketRef?.ws) lastSocketRef.ws.close(); } catch {}
                }
            } else consecutiveIdleChecks = 0;
        } catch (e) { console.error("Watchdog error:", e?.message); }
    }, WATCHDOG_CHECK_MS);
}

function stopWatchdog() {
    if (watchdogInterval) clearInterval(watchdogInterval);
    watchdogInterval = null;
}

// ============================================================
// Main Group Join
// ============================================================

async function handleMainGroupJoin(sock, groupJid, participant, db, saveDb) {
    try {
        if (!isMainGroup(db, groupJid)) return;
        const userNumber = cleanNumber(participant);
        if (!userNumber) return;

        if (botTrackerModule?.isUserPermanent?.(db, userNumber)) {
            await sock.sendMessage(groupJid, {
                text: botTrackerModule.getBannedFromKingdomMessage(),
                mentions: [fixMentionJid(userNumber)]
            }).catch(() => {});
            try { await sock.groupParticipantsUpdate(groupJid, [fixMentionJid(userNumber)], "remove"); } catch (_) {}
            return;
        }

        const photoEntry = db.userPhotos?.[userNumber];

        if (welcomeModule?.sendWelcome) {
            try { await welcomeModule.sendWelcome(sock, groupJid, userNumber, photoEntry, db); } catch (e) { console.error(e?.message); }
        }

        setTimeout(async () => {
            try {
                const user = db.users?.[userNumber];
                if (user) { user.balance = (Number(user.balance) || 0) + 100; saveDb(); }
                await sock.sendMessage(groupJid, {
                    text: `♢┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈♢\n👤 العضو: @${userNumber}\nلقد حصلت على 100 رصيد كهدية\nترحيب خاصة بك يمكنك ان تكتب: \n*.تفاصيلي*\nلرؤية ملفك التعريفي ورصيدك... \n♢┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈♢`,
                    mentions: [fixMentionJid(userNumber)]
                }).catch(() => {});
            } catch (_) {}
        }, 60000);

        setTimeout(async () => {
            try {
                const user = db.users?.[userNumber];
                if (!user) return;
                const dn = String(user.nickname || "").trim() || "غير مسجل";
                const fn = String(user.friend || "").trim() || "لا يوجد";
                const text = `╗═════『   بياناتك  』═════╔\n\n💰 رصـــيـــــــدك:     \`{${user.balance || 0}}\`\n\n🏷️ لقبك:    \`{${dn}}\`\n\n🎖️ رتبتك:   \`{${user.rank || "عضو"}}\`\n\n📈 أعلى تفاعل لك: \`{${user.maxInteraction || 0}}\`\n\n🫂 صـــديق:  \`{${fn}}\`\n╝════════════════════╚`;
                await sock.sendMessage(groupJid, { text, mentions: [fixMentionJid(userNumber)] }).catch(() => {});
            } catch (_) {}
        }, 300000);

        if (botTrackerModule?.notifyAdmins && db.multiBotEnabled?.[groupJid]) {
            try { await botTrackerModule.notifyAdmins(sock, groupJid, userNumber, db); } catch (_) {}
        }
    } catch (e) { console.error("handleMainGroupJoin error:", e?.message); }
}

// ============================================================
// تنظيف الرسائل
// ============================================================

async function handleCleanCommand(sock, jid, msg, cleanSender, owner, isEmperor) {
    if (!owner && !isEmperor) {
        await sock.sendMessage(jid, { text: "⛔ هذا الأمر للمطور أو الإمبراطور فقط." }, { quoted: msg });
        return true;
    }

    try {
        const count = 40;
        // جلب آخر 40 رسالة من القروب
        // استخدام groupFetchAllParticipating أو fetchMessageHistory حسب الإصدار

        let deletedCount = 0;

        try {
            // محاولة استخدام fetchMessageHistory إذا متوفرة
            if (typeof sock.fetchMessageHistory === "function") {
                const history = await sock.fetchMessageHistory(count, msg.key, Math.floor(Date.now() / 1000));
                if (Array.isArray(history)) {
                    for (const m of history) {
                        if (!m?.key) continue;
                        if (m.key.id === msg.key.id) continue;
                        try {
                            await sock.sendMessage(jid, { delete: m.key });
                            deletedCount++;
                            await new Promise(r => setTimeout(r, 300));
                        } catch (_) {}
                    }
                }
            }
        } catch (e) {
            console.error("fetchMessageHistory error:", e?.message);
        }

        // إذا لم تُحذف رسائل، نبلغ المستخدم
        if (deletedCount === 0) {
            await sock.sendMessage(jid, {
                text: `⚠️ لم يتمكن البوت من حذف الرسائل.\nتأكد من أن البوت مشرف في القروب.`
            }, { quoted: msg });
        } else {
            await sock.sendMessage(jid, {
                text: `🧹 تم حذف ${deletedCount} رسالة بنجاح.`
            }, { quoted: msg });
        }

    } catch (error) {
        console.error("Clean command error:", error?.message);
        await sock.sendMessage(jid, {
            text: `❌ فشل حذف الرسائل: ${error?.message}`
        }, { quoted: msg });
    }

    return true;
}

// ============================================================
// Mazad Flow
// ============================================================

async function handleMazadFlow(sock, jid, msg, text, db, saveDb, cleanSender, owner) {
    if (text === ".مزاد") {
        if (db.mazadBlocked) {
            await sock.sendMessage(jid, { text: `◆━─━─━─⊱⚠️⊰─━─━─━◆\n*عذرا الإمبراطور قام بمنع هذا!*\n◆━─━─━─⊱⛔⊰─━─━─━◆` }, { quoted: msg });
            return true;
        }
        await handleMazadCommand(sock, jid, msg, db, saveDb, cleanSender, owner);
        return true;
    }
    if (text.startsWith(".ادفع")) {
        const parts = text.split(/\s+/);
        const amount = parseInt(parts[1]);
        if (!isNaN(amount) && amount > 0) { await handleMazadBid(sock, jid, msg, db, saveDb, cleanSender, amount); return true; }
    }
    if (text === ".مخزوني") { await handleMazadInventory(sock, jid, msg, db, cleanSender); return true; }
    if (text.startsWith(".ارسال")) { await handleMazadSend(sock, jid, msg, text, db, saveDb, cleanSender); return true; }
    if (text === ".الغاء") { await handleMazadCancelSend(sock, jid, msg, db, saveDb, cleanSender); return true; }
    return false;
}

// ============================================================
// Special Commands
// ============================================================

async function handleSpecialCommands(sock, jid, msg, text, db, saveDb, cleanSender, owner, isGroup) {
    // فحص الإمبراطور
    const isEmperor = db.emperors && db.emperors[cleanSender] === true;

    // الإمبراطور = owner (تجاوز كل الصلاحيات)
    const hasFullAccess = owner || isEmperor;

    // ============================================
    // .امبراطور @user - تعيين إمبراطور
    // ============================================
    if (text.startsWith(".امبراطور ") && !text.startsWith(".ازالة")) {
        if (!owner) {
            await sock.sendMessage(jid, { text: "⛔ هذا الأمر للمطور فقط." }, { quoted: msg });
            return true;
        }
        const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        if (mentioned.length === 0) {
            await sock.sendMessage(jid, { text: "⚠️ يرجى منشن الشخص.\nمثال: .امبراطور @user" }, { quoted: msg });
            return true;
        }
        const target = cleanNumber(mentioned[0]);
        db.emperors = db.emperors || {};
        db.emperors[target] = true;
        saveDb();
        await sock.sendMessage(jid, {
            text: `👑 تم تعيين @${target} كامبراطور.\n✅ جميع الصلاحيات مفتوحة له.`,
            mentions: mentioned
        }, { quoted: msg });
        return true;
    }

    // ============================================
    // .ازالة امبراطور @user
    // ============================================
    if (text.startsWith(".ازالة امبراطور ") || text.startsWith(".إزالة امبراطور ")) {
        if (!owner) {
            await sock.sendMessage(jid, { text: "⛔ هذا الأمر للمطور فقط." }, { quoted: msg });
            return true;
        }
        const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        if (mentioned.length === 0) {
            await sock.sendMessage(jid, { text: "⚠️ يرجى منشن الشخص." }, { quoted: msg });
            return true;
        }
        const target = cleanNumber(mentioned[0]);
        db.emperors = db.emperors || {};
        delete db.emperors[target];
        saveDb();
        await sock.sendMessage(jid, {
            text: `✅ تم إزالة @${target} من قائمة الأباطرة.`,
            mentions: mentioned
        }, { quoted: msg });
        return true;
    }

    // ============================================
    // .الاباطرة - عرض قائمة الأباطرة
    // ============================================
    if (text === ".الاباطرة" || text === ".الإباطرة") {
        db.emperors = db.emperors || {};
        const emperors = Object.keys(db.emperors).filter(k => db.emperors[k] === true);
        if (emperors.length === 0) {
            await sock.sendMessage(jid, { text: "👑 لا يوجد أباطرة حالياً." }, { quoted: msg });
            return true;
        }
        let listText = "👑 *قائمة الأباطرة:*\n\n";
        const mentions = [];
        let i = 1;
        for (const emp of emperors) {
            const user = db.users?.[emp];
            const nickname = user?.nickname || "غير مسجل";
            listText += `${i}. ${nickname} - @${emp}\n`;
            mentions.push(fixMentionJid(emp));
            i++;
        }
        await sock.sendMessage(jid, {
            text: listText,
            mentions
        }, { quoted: msg });
        return true;
    }

    // ============================================
    // .تنظيف - حذف آخر 40 رسالة
    // ============================================
    if (text === ".تنظيف" || text === ".تنضيف") {
        return handleCleanCommand(sock, jid, msg, cleanSender, owner, isEmperor);
    }

    // ============================================
    // .من لقب
    // ============================================
    if (text.startsWith(".من ")) {
        const nickname = text.slice(4).trim();
        const { findUserByNickname } = require("./commands");
        const found = findUserByNickname(db, nickname);
        if (found) {
            await sock.sendMessage(jid, {
                text: `*⌬━─⟐─👤─⟐─━⌬* \n هذا هو صاحب اللقب: \n@${found.number}\n*⌬━─⟐─👤─⟐─━⌬*`,
                mentions: [fixMentionJid(found.number)]
            }, { quoted: msg });
        } else {
            await sock.sendMessage(jid, {
                text: `*⌬━─⟐─❗─⟐─━⌬* \n   العضو ليس موجود هنا\n*⌬━─⟐─📛─⟐─━⌬*`
            }, { quoted: msg });
        }
        return true;
    }

    // .حظر @user مدة
    if (text.startsWith(".حظر ")) {
        if (!hasFullAccess) { await sock.sendMessage(jid, { text: "⛔ ليس لديك صلاحية." }, { quoted: msg }); return true; }
        const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        if (mentioned.length === 0) { await sock.sendMessage(jid, { text: "⚠️ يرجى منشن الشخص." }, { quoted: msg }); return true; }
        const target = cleanNumber(mentioned[0]);
        const parts = text.split(/\s+/);
        const timeStr = parts[parts.length - 1];
        let duration = 0;
        const numMatch = timeStr.match(/(\d+)/);
        if (numMatch) {
            const num = parseInt(numMatch[1]);
            if (timeStr.includes("ي")) duration = num * 86400000;
            else if (timeStr.includes("س")) duration = num * 3600000;
            else if (timeStr.includes("د")) duration = num * 60000;
            else if (timeStr.includes("ث")) duration = num * 1000;
            else duration = num * 60000;
        }
        if (duration <= 0) { await sock.sendMessage(jid, { text: "⚠️ مدة غير صحيحة.\nمثال: .حظر @user 40د" }, { quoted: msg }); return true; }
        db.bannedUsers = db.bannedUsers || {};
        db.bannedUsers[target] = { until: Date.now() + duration, reason: "حظر إداري", bannedBy: cleanSender };
        saveDb();
        await sock.sendMessage(jid, { text: `✅ تم حظر @${target} لمدة \`${timeStr}\``, mentions: [fixMentionJid(target)] }, { quoted: msg });
        return true;
    }

    // .مراقب
    if (text === ".مراقب" || text.startsWith(".مراقب ")) {
        if (violationModule) { await violationModule.handleAddMonitor(sock, jid, msg, db, saveDb, cleanSender, hasFullAccess); return true; }
    }

    // .متجر
    if (text === ".متجر") {
        if (storeModule) { await storeModule.handleStoreCommand(sock, jid, msg, db, cleanSender); return true; }
    }

    // .بيع
    if (text.startsWith(".بيع ")) {
        if (storeModule) { await storeModule.handleSellCommand(sock, jid, msg, text.split(/\s+/).slice(1), db, saveDb, cleanSender); return true; }
    }

    // .تعديل متجر
    if (text.startsWith(".تعديل متجر")) {
        if (storeModule) { await storeModule.handleEditStore(sock, jid, msg, text.split(/\s+/).slice(2), db, saveDb, cleanSender, hasFullAccess, isEmperor); return true; }
    }

    // .شراء
    if (text.startsWith(".شراء ")) {
        if (purchaseModule) { await purchaseModule.handlePurchaseCommand(sock, jid, msg, text.split(/\s+/).slice(1), db, cleanSender); return true; }
    }

    // .طلبات
    if (text === ".طلبات on" || text === ".طلبات off") {
        const action = text.includes("on") ? "on" : "off";
        if (purchaseModule) { await purchaseModule.handleOrdersToggle(sock, jid, msg, action, db, saveDb, cleanSender, hasFullAccess); return true; }
    }

    // .انا بوت
    if (text.startsWith(".انا بوت")) {
        if (botTrackerModule) { const h = await botTrackerModule.handleBotIdentity(sock, jid, msg, text.split(/\s+/).slice(2), db, saveDb, cleanSender); if (h) return true; }
    }

    // .مؤبد
    if (text === ".مؤبد") {
        if (botTrackerModule) { const h = await botTrackerModule.handlePermanentSave(sock, jid, msg, db, saveDb, cleanSender); if (h) return true; }
    }

    // .اعفاء
    if (text === ".اعفاء") {
        if (botTrackerModule) { const h = await botTrackerModule.handlePermanentRelease(sock, jid, msg, db, saveDb, cleanSender); if (h) return true; }
    }

    // .حذف نقابتك
    if (text === ".حذف نقابتك") {
        if (botTrackerModule) { const h = await botTrackerModule.handleDeleteBotIdentity(sock, jid, msg, db, saveDb, cleanSender, hasFullAccess); if (h) return true; }
    }

    // .تعدد
    if (text === ".تعدد on" || text === ".تعدد off") {
        const action = text.includes("on") ? "on" : "off";
        if (botTrackerModule) { const h = await botTrackerModule.handleMultiBotToggle(sock, jid, msg, action, db, saveDb, cleanSender, hasFullAccess); if (h) return true; }
    }

    // .اتبع حدسك
    if (text === ".اتبع حدسك") {
        if (guessModule) { await guessModule.handleGuessCommand(sock, jid, msg, db, saveDb, cleanSender, hasFullAccess); return true; }
    }

    // .مشاركة
    if (text.startsWith(".مشاركة ") || text.startsWith(".اشارك ")) {
        if (guessModule) { const h = await guessModule.handleGuessJoin(sock, jid, msg, text.split(/\s+/).slice(1), db, saveDb, cleanSender); if (h) return true; }
    }

    // .بدأ
    if (text === ".بدأ" || text === ".ابدا") {
        const gg = guessModule?.activeGuess?.[jid];
        if (gg && !gg.isStarted) { const h = await guessModule.handleGuessStart(sock, jid, msg, db, saveDb, cleanSender); if (h) return true; }
        const casino = activeCasinos[jid];
        if (casino && !casino.started) { const { handleRouletteStart } = require("./duel"); await handleRouletteStart(sock, jid, msg, cleanSender, hasFullAccess, db); return true; }
    }

    // اختيار الكرة
    if (guessModule?.activeGuess?.[jid]?.isOpen) {
        const h = await guessModule.handleGuessChoice(sock, jid, msg, text, db, saveDb, cleanSender);
        if (h) return true;
    }

    // .انهاء مزاد
    if (text === ".انهاء مزاد") {
        if (!hasFullAccess) { await sock.sendMessage(jid, { text: "⛔ هذا الأمر للإمبراطور أو المطور فقط." }, { quoted: msg }); return true; }
        const mazad = activeMazads[jid];
        if (!mazad) { await sock.sendMessage(jid, { text: "⚠️ لا يوجد مزاد نشط." }, { quoted: msg }); return true; }
        if (mazad.highestBidder) {
            const winner = mazad.highestBidder;
            const amount = mazad.highestBid;
            const item = mazad.item;
            const user = db.users?.[winner];
            if (user) user.balance = (Number(user.balance) || 0) - amount;
            db.inventory = db.inventory || {};
            if (!db.inventory[winner]) db.inventory[winner] = [];
            db.inventory[winner].push({ emoji: item.emoji, name: item.name, description: item.description, acquiredAt: Date.now() });
            saveDb();
            await sock.sendMessage(jid, {
                text: `*⌬━─⟐─ 🧾 ─⟐─━⌬*\nالعضو @${winner}\nكسب: ${item.emoji} ${item.name}\n${item.description}\nالسعر: \`${amount}\`\n*⌬━─⟐─ 🔥 ─⟐─━⌬*`,
                mentions: [fixMentionJid(winner)]
            });
        } else {
            await sock.sendMessage(jid, { text: "⚠️ لا يوجد عروض في المزاد." });
        }
        try { mazad.stopMazad?.(); } catch {}
        delete activeMazads[jid];
        return true;
    }

    // .سحب مزاد
    if (text === ".سحب مزاد") {
        if (!hasFullAccess) { await sock.sendMessage(jid, { text: "⛔ هذا الأمر للإمبراطور أو المطور فقط." }, { quoted: msg }); return true; }
        db.mazadBlocked = true;
        saveDb();
        await sock.sendMessage(jid, { text: `◆━─━─━─⊱⚠️⊰─━─━─━◆\n*عذرا الإمبراطور قام بمنع هذا!*\n◆━─━─━─⊱⛔⊰─━─━─━◆` }, { quoted: msg });
        return true;
    }

    // .مزاد @منشن
    if (text.startsWith(".مزاد ") && hasFullAccess) {
        const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        if (mentioned.length > 0) {
            const target = cleanNumber(mentioned[0]);
            db.mazadCreator = target;
            db.mazadBlocked = false;
            saveDb();
            await sock.sendMessage(jid, { text: `✅ تم منح @${target} صلاحية إنشاء المزاد.`, mentions: [fixMentionJid(target)] }, { quoted: msg });
            return true;
        }
    }

    // .حذف شامل
    if (text === ".حذف شامل") {
        if (!hasFullAccess) { await sock.sendMessage(jid, { text: "⛔ هذا الأمر للإمبراطور أو المطور فقط." }, { quoted: msg }); return true; }
        const mainJids = Object.keys(db.mainGroup || {}).filter(j => db.mainGroup[j] === true);
        if (mainJids.length === 0) { await sock.sendMessage(jid, { text: "⚠️ لا يوجد قروب أساسي." }, { quoted: msg }); return true; }
        const mainMembers = new Set();
        for (const mj of mainJids) {
            try { const md = await sock.groupMetadata(mj); for (const p of md.participants) mainMembers.add(cleanNumber(p.id)); } catch (_) {}
        }
        const deleted = [];
        for (const un of Object.keys(db.users || {})) {
            const u = db.users[un];
            if (u && String(u.nickname || "").trim() && !mainMembers.has(un)) {
                deleted.push({ number: un, nickname: u.nickname });
                u.nickname = "";
            }
        }
        saveDb();
        await sock.sendMessage(jid, { text: `*⌬━─⟐─ 🟢 ─⟐─━⌬*\n تم حذف الالقاب التي ليس\n لديها عضو يملكها هنا  ! \n*⌬━─⟐─ ✅ ─⟐─━⌬*` }, { quoted: msg });
        if (deleted.length > 0) {
            let listText = `*⌬━─⟐─ 📜 ─⟐─━⌬*\n الاعضاء الغير مسجلة: \n`;
            const mentions = [];
            for (const d of deleted) { listText += `@${d.number}\n`; mentions.push(fixMentionJid(d.number)); }
            listText += `\nالى اخره....\n\n*⌬━─⟐─ 🪪 ─⟐─━⌬*`;
            await sock.sendMessage(jid, { text: listText, mentions });
        }
        return true;
    }

    // .رابط
    if (text.startsWith(".رابط الاعلانات ") || text.startsWith(".رابط المتجر ")) {
        if (!hasFullAccess) { await sock.sendMessage(jid, { text: "⛔ هذا الأمر للمطور أو الإمبراطور فقط." }, { quoted: msg }); return true; }
        const parts = text.split(/\s+/);
        const isAdsLink = text.startsWith(".رابط الاعلانات");
        const url = parts.slice(2).join(" ").trim();
        if (!url) { await sock.sendMessage(jid, { text: "⚠️ يرجى كتابة الرابط." }, { quoted: msg }); return true; }
        db.welcomeLinks = db.welcomeLinks || { link1: "", link2: "" };
        if (isAdsLink) { db.welcomeLinks.link1 = url; await sock.sendMessage(jid, { text: "✅ تم حفظ رابط الإعلانات." }, { quoted: msg }); }
        else { db.welcomeLinks.link2 = url; await sock.sendMessage(jid, { text: "✅ تم حفظ رابط المتجر." }, { quoted: msg }); }
        saveDb();
        return true;
    }

    // .اساسي
    if (text === ".اساسي on" || text === ".اساسي off") {
        if (!hasFullAccess) { await sock.sendMessage(jid, { text: "⛔ هذا الأمر للمطور أو الإمبراطور فقط." }, { quoted: msg }); return true; }
        db.mainGroup = db.mainGroup || {};
        db.organizedGroups = db.organizedGroups || {};
        if (text === ".اساسي on") {
            db.mainGroup[jid] = true;
            db.organizedGroups[jid] = true;
            saveDb();
            await sock.sendMessage(jid, { text: "✅ تم تعيين هذا القروب كقروب أساسي.\n✅ تم تفعيل مراقبة المغادرين تلقائياً." }, { quoted: msg });
        } else {
            delete db.mainGroup[jid]; delete db.organizedGroups[jid];
            saveDb();
            await sock.sendMessage(jid, { text: "❌ تم إلغاء تعيين هذا القروب كقروب أساسي." }, { quoted: msg });
        }
        return true;
    }

    // .548484
    if (text === ".548484") {
        try { await sock.sendMessage(jid, { delete: msg.key }); } catch {}
        if (!hasFullAccess) { await sock.sendMessage(jid, { text: "⛔ هذا الأمر للمطور أو الإمبراطور فقط." }, { quoted: msg }); return true; }
        if (db.mazadBlocked) { await sock.sendMessage(jid, { text: `◆━─━─━─⊱⚠️⊰─━─━─━◆\n*عذرا الإمبراطور قام بمنع هذا!*\n◆━─━─━─⊱⛔⊰─━─━─━◆` }, { quoted: msg }); return true; }
        db.mazadCreator = cleanSender;
        saveDb();
        await sock.sendMessage(jid, { text: "✅ تم تفعيل وضع منشئ المزاد." }, { quoted: msg });
        return true;
    }

    // .حفظ
    if (text === ".حفظ" || text.startsWith(".حفظ ")) {
        const parts = text.split(/\s+/);
        const action = parts.length > 1 ? parts[1].toLowerCase() : "";
        if (!hasFullAccess) { await sock.sendMessage(jid, { text: "⛔ هذا الأمر للمطور أو الإمبراطور فقط." }, { quoted: msg }); return true; }
        if (action === "on") {
            db.autoSaveEnabled = true; db.autoSaveGroupJid = jid;
            saveDb(); startAutoSave(sock, jid);
            await sock.sendMessage(jid, { text: "✅ *تم تفعيل الحفظ التلقائي*\n🕐 كل 4 ساعات" }, { quoted: msg });
        } else if (action === "off") {
            db.autoSaveEnabled = false; db.autoSaveGroupJid = null;
            saveDb(); stopAutoSave();
            await sock.sendMessage(jid, { text: "❌ تم إيقاف الحفظ التلقائي" }, { quoted: msg });
        } else {
            const status = db.autoSaveEnabled ? "🟢 مفعّل" : "🔴 غير مفعّل";
            await sock.sendMessage(jid, { text: "📊 الحالة: " + status + "\n.حفظ on / off" }, { quoted: msg });
        }
        return true;
    }

    // .استراحة
    if (text === ".استراحة") { await handleRestCommand(sock, jid, msg, db); return true; }

    // .stop everything
    if (text.trim().toLowerCase() === ".stop everything") {
        if (!hasFullAccess) return true;
        try { await sock.sendMessage(jid, { delete: msg.key }); } catch {}
        for (const j of Object.keys(activeGames || {})) { try { activeGames[j]?.stopGame?.(); } catch {} delete activeGames[j]; }
        for (const j of Object.keys(activeCasinos || {})) { try { activeCasinos[j]?.stopGame?.(); } catch {} delete activeCasinos[j]; }
        for (const j of Object.keys(activeSaraha || {})) { try { activeSaraha[j]?.stopGame?.(); } catch {} delete activeSaraha[j]; }
        for (const j of Object.keys(activeColors || {})) { try { activeColors[j]?.stopGame?.(); } catch {} delete activeColors[j]; }
        for (const j of Object.keys(activeAnimals || {})) { try { activeAnimals[j]?.stopGame?.(); } catch {} delete activeAnimals[j]; }
        for (const j of Object.keys(activeMazads || {})) { try { activeMazads[j]?.stopMazad?.(); } catch {} delete activeMazads[j]; }
        if (tahminModule?.activeTahmin) for (const j of Object.keys(tahminModule.activeTahmin)) { try { tahminModule.stopTahminGame(j); } catch {} }
        if (guessModule?.activeGuess) for (const j of Object.keys(guessModule.activeGuess)) { try { guessModule.stopGuessGame(j); } catch {} }
        await sock.sendMessage(jid, { text: "🛑 تم إيقاف جميع الفعاليات." }, { quoted: msg });
        return true;
    }

    return false;
}

// ============================================================
// List Response
// ============================================================

async function handleListResponse(sock, jid, msg, db, cleanSender, owner) {
    const listResponse = msg.message?.listResponseMessage;
    if (!listResponse) return false;
    const selectedRowId = String(listResponse.singleSelectReply?.selectedRowId || "");
    let matchedCmd = null;
    const gameKeywords = [
        { k: "تفكيك", c: "تفكيك" }, { k: "كتابة", c: "كتابة" },
        { k: "ألوان", c: "الوان" }, { k: "الوان", c: "الوان" },
        { k: "صراحة", c: "صراحة" }, { k: "الحيوانات", c: "الحيوانات" },
        { k: "حيوانات", c: "الحيوانات" }, { k: "أعلام", c: "اعلام" },
        { k: "اعلام", c: "اعلام" }, { k: "إيموجي", c: "ايموجي" },
        { k: "ايموجي", c: "ايموجي" }, { k: "روليت", c: "روليت" },
        { k: "كريستال", c: "كريستال" }, { k: "تخمين", c: "تخمين" },
        { k: "اتبع حدسك", c: "اتبع حدسك" }
    ];
    for (const item of gameKeywords) {
        if (selectedRowId.includes(item.k)) { matchedCmd = item.c; break; }
    }
    if (!matchedCmd && selectedRowId.startsWith("game_")) matchedCmd = selectedRowId.replace("game_", "");
    if (!matchedCmd) return false;

    const pending = global.pendingGamesMenu?.[jid];
    if (!pending || pending.sender !== cleanSender) {
        await sock.sendMessage(jid, { text: "⚠️ هذه القائمة خاصة بصاحب الأمر `.العاب` فقط." }, { quoted: msg }).catch(() => {});
        return true;
    }
    if (Date.now() - pending.timestamp > 300000) {
        delete global.pendingGamesMenu[jid];
        await sock.sendMessage(jid, { text: "⚠️ انتهت صلاحية القائمة، أعد كتابة `.العاب`." }, { quoted: msg }).catch(() => {});
        return true;
    }
    delete global.pendingGamesMenu[jid];
    const cmd = matchedCmd;
    try { await sock.sendMessage(jid, { delete: msg.key }); } catch (_) {}
    if (cmd === "كريستال") {
        await sock.sendMessage(jid, { text: "*❉▬▬▬▬🎰▬▬▬▬❉*\n رجاءا اكتب امر: \n*كريستال 00*\nضع عدد الرهان بدلا من 00\nمثال:  `.كريستال 50`\n*✥▬▬▬▬🎰▬▬▬▬✥*" }, { quoted: msg }).catch(() => {});
        return true;
    }
    const fakeText = "." + cmd;
    try {
        const fakeMsg = { ...msg, message: { conversation: fakeText } };
        await handleCommand(sock, jid, fakeMsg, {
            db, sender: msg?.key?.participant || msg?.key?.remoteJid,
            cleanSender, isGroup: true, isBotOwner: Boolean(owner),
            botNumber: cleanSender, text: fakeText
        });
    } catch (e) { console.error("List response exec error:", e?.message); }
    return true;
}

// ============================================================
// On Message Handler
// ============================================================

async function onMessageHandler(sock, event, context) {
    try {
        lastMessageAt = Date.now();
        const { messages, type } = event || {};
        if (type !== "notify") return;
        if (!Array.isArray(messages) || !messages.length) return;
        const db = context.db || getDb();

        for (const msg of messages) {
            try {
                if (shouldIgnoreMessage(msg)) continue;
                const jid = msg?.key?.remoteJid;
                if (!jid) continue;
                const sender = getSender(msg, sock);
                const cleanSender = jidToNumber(sender);
                const isGroup = isGroupJid(jid);
                const botNumber = getBotNumber(sock);
                const owner = isOwner(cleanSender, sock, msg);
                const isEmperor = db.emperors && db.emperors[cleanSender] === true;
                const hasFullAccess = owner || isEmperor;

                if (isUserBanned(db, cleanSender)) {
                    const timeLeft = getBanTimeLeft(db, cleanSender);
                    await sock.sendMessage(jid, {
                        text: `━━━━━═⏣⊰⛔⊱⏣═━━━━━\n@${cleanSender} انت محظور لمدة  \`${timeLeft || "غير محدد"}\`\n━━━━━═⏣⊰🛑⊱⏣═━━━━━`,
                        mentions: [fixMentionJid(cleanSender)]
                    }).catch(() => {});
                    continue;
                }

                const originalText = getMessageTextFromMsg(msg);
                if (!originalText) continue;

                // استخراج الأمر داخل الرسالة (إذا وجد)
                const extractedCmd = extractCommand(originalText);
                const text = extractedCmd || originalText;

                if (violationModule) {
                    try { const h = await violationModule.handleViolationMessage(sock, jid, msg, text, db, saveDb); if (h) continue; } catch (_) {}
                }

                if (resultsModule?.isAdsGroup?.(db, jid)) {
                    try { await resultsModule.handleAdsMessage(sock, jid, msg, text, db, saveDb); } catch (_) {}
                }

                if (msg.message?.listResponseMessage) {
                    const h = await handleListResponse(sock, jid, msg, db, cleanSender, hasFullAccess);
                    if (h) continue;
                }

                if (violationModule && text.startsWith(".")) {
                    try { const hasDebt = await violationModule.checkUserDebtBeforeUse(sock, jid, db, saveDb, cleanSender); if (hasDebt) continue; } catch (_) {}
                }

                if (text.startsWith(".")) {
                    const h = await handleSpecialCommands(sock, jid, msg, text, db, saveDb, cleanSender, hasFullAccess, isGroup);
                    if (h) continue;
                }

                if (text === ".مزاد" || text.startsWith(".ادفع") || text === ".مخزوني" || text.startsWith(".ارسال") || text === ".الغاء") {
                    const h = await handleMazadFlow(sock, jid, msg, text, db, saveDb, cleanSender, hasFullAccess);
                    if (h) continue;
                }
                
                if (text === ".صراحة" && await handleSarahaCommand(sock, jid, msg, db, saveDb, cleanSender, hasFullAccess)) continue;
                if (text === ".الوان" && await handleColorsCommand(sock, jid, msg, db, saveDb, cleanSender, hasFullAccess)) continue;
                if (text === ".الحيوانات" && await handleAnimalsCommand(sock, jid, msg, db, saveDb, cleanSender, hasFullAccess)) continue;

                if (text === ".تخمين" && tahminModule?.handleTahminCommand) {
                    try { const h = await tahminModule.handleTahminCommand(sock, jid, msg, db, saveDb, cleanSender, hasFullAccess); if (h) continue; } catch (e) { console.error(e?.message); }
                }

                if (text === ".اوامر" && commandsListModule?.handleCommandsList) {
                    try { const h = await commandsListModule.handleCommandsList(sock, jid, msg, db, cleanSender, hasFullAccess); if (h) continue; } catch (e) { console.error(e?.message); }
                }

                if ((text === ".نتائج" || text.startsWith(".نتائج ")) && resultsModule?.handleResults) {
                    try { const h = await resultsModule.handleResults(sock, jid, msg, text, db, saveDb, cleanSender, hasFullAccess); if (h) continue; } catch (e) { console.error(e?.message); }
                }

                if (!text.startsWith(".")) {
                    if (typoModule?.handleTypo && db.typoEnabled?.[jid]) {
                        try { const h = await typoModule.handleTypo(sock, jid, msg, text, db, cleanSender, hasFullAccess); if (h) continue; } catch (_) {}
                    }
                    await handleAutoReplies(sock, jid, msg, text, sender, cleanSender, db, saveDb);
                    continue;
                }

                await handleCommand(sock, jid, msg, {
                    db, sender, cleanSender, isGroup,
                    isBotOwner: Boolean(hasFullAccess), botNumber, text
                });
            } catch (e) { console.error("Message error:", e?.message); }
        }
    } catch (e) { console.error("onMessage error:", e?.message); }
}

// ============================================================
// On Group Update Handler
// ============================================================

async function onGroupUpdateHandler(sock, update, context) {
    try {
        const db = context.db || getDb();
        await handleGroupJoin(sock, update, db, saveDb);
        if (update?.action === "add" && Array.isArray(update.participants)) {
            for (const p of update.participants) {
                await handleMainGroupJoin(sock, update.id, p, db, saveDb);
            }
        }
    } catch (e) { console.error("GroupUpdate error:", e?.message); }
}

// ============================================================
// Create Handlers
// ============================================================

function createHandlers() {
    return {
        onConnectionOpen: async (sock) => {
            setupAdminMonitoring(sock);
            const db = getDb();
            if (db?.autoSaveEnabled && db?.autoSaveGroupJid) startAutoSave(sock, db.autoSaveGroupJid);
            startWatchdog(sock);
            console.log("✅ البوت جاهز.");
        },
        onConnectionClose: async () => {
            stopAdminMonitoring();
            stopWatchdog();
        },
        onMessage: onMessageHandler,
        onGroupUpdate: onGroupUpdateHandler
    };
}

// ============================================================
// Exports
// ============================================================

module.exports = {
    createHandlers,
    handleMainGroupJoin,
    handleMazadFlow,
    handleSpecialCommands,
    handleListResponse,
    onMessageHandler,
    onGroupUpdateHandler,
    stopWatchdog,
    stopAutoSave
};
