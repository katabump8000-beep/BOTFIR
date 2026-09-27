// ============================================================
// index.js
// ALJESAT BOT
// Main Entry Point + Watchdog + Rest System + LogGuard
// + Photos + Welcome + Tahmin + Results + CommandsList + Typo
// + Store + Purchase + BotTracker + Guess + Ban + Debt + Violation
// ============================================================

"use strict";

const fs = require("fs");
const path = require("path");

// ============================================================
// LogGuard
// ============================================================

const _originalLog = console.log.bind(console);
const _originalError = console.error.bind(console);
const _originalWarn = console.warn.bind(console);

const logGuard = {
    count: 0,
    windowStart: Date.now(),
    WINDOW_MS: 1000,
    MAX_PER_WINDOW: 30,
    dropped: 0,
    silenced: false,

    canLog() {
        const now = Date.now();
        if (now - this.windowStart >= this.WINDOW_MS) {
            this.windowStart = now;
            this.count = 0;
            if (this.silenced) {
                this.silenced = false;
                _originalWarn(`⚠️ [LogGuard] تم استئناف السجلات.`);
                this.dropped = 0;
            }
        }
        this.count++;
        if (this.count > this.MAX_PER_WINDOW) {
            this.silenced = true;
            this.dropped++;
            return false;
        }
        return true;
    }
};

console.log = (...args) => { if (logGuard.canLog()) _originalLog(...args); };
console.error = (...args) => { if (logGuard.canLog()) _originalError(...args); };
console.warn = (...args) => { if (logGuard.canLog()) _originalWarn(...args); };

// ============================================================
// Core Imports
// ============================================================

const {
    startBot,
    configureHandlers,
    getDb,
    saveDb,
    jidToNumber,
    isGroupJid,
    isOwner,
    cleanNumber
} = require("./bot");

const { handleCommand } = require("./commands");

const {
    handleGroupJoin,
    startAdminMonitoring,
    stopAdminMonitoring
} = require("./admin");

const { activeGames } = require("./menu");
const { activeCasinos, isSarahaActive } = require("./duel");
const { activeSaraha, handleSarahaCommand } = require("./saraha");
const {
    activeMazads,
    handleMazadCommand,
    handleMazadBid,
    handleMazadInventory,
    handleMazadSend,
    handleMazadCancelSend
} = require("./mzad");
const { activeColors, handleColorsCommand } = require("./colors");
const { activeAnimals, handleAnimalsCommand } = require("./animals");

// ============================================================
// استيراد الملفات الجديدة
// ============================================================

let photosModule = null;
let welcomeModule = null;
let tahminModule = null;
let resultsModule = null;
let commandsListModule = null;
let typoModule = null;
let storeModule = null;
let purchaseModule = null;
let botTrackerModule = null;
let guessModule = null;
let violationModule = null;

try { photosModule = require("./photos"); } catch (e) { _originalWarn("⚠️ photos.js غير محمّل"); }
try { welcomeModule = require("./welcome"); } catch (e) { _originalWarn("⚠️ welcome.js غير محمّل"); }
try { tahminModule = require("./tahmin"); } catch (e) { _originalWarn("⚠️ tahmin.js غير محمّل"); }
try { resultsModule = require("./results"); } catch (e) { _originalWarn("⚠️ results.js غير محمّل"); }
try { commandsListModule = require("./commands_list"); } catch (e) { _originalWarn("⚠️ commands_list.js غير محمّل"); }
try { typoModule = require("./typo"); } catch (e) { _originalWarn("⚠️ typo.js غير محمّل"); }
try { storeModule = require("./store"); } catch (e) { _originalWarn("⚠️ store.js غير محمّل"); }
try { purchaseModule = require("./purchase"); } catch (e) { _originalWarn("⚠️ purchase.js غير محمّل"); }
try { botTrackerModule = require("./botTracker"); } catch (e) { _originalWarn("⚠️ botTracker.js غير محمّل"); }
try { guessModule = require("./guess"); } catch (e) { _originalWarn("⚠️ guess.js غير محمّل"); }
try { violationModule = require("./violation"); } catch (e) { _originalWarn("⚠️ violation.js غير محمّل"); }

// ============================================================
// Runtime Variables
// ============================================================

let autoSaveInterval = null;
let autoSaveEnabled = false;
let autoSaveGroupJid = null;

let watchdogInterval = null;
let lastMessageAt = Date.now();
let lastGroupUpdateAt = Date.now();
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

let lastExceptionAt = 0;
const EXCEPTION_COOLDOWN_MS = 5000;

process.on('uncaughtException', (error) => {
    const now = Date.now();
    if (now - lastExceptionAt < EXCEPTION_COOLDOWN_MS) return;
    lastExceptionAt = now;
    _originalError('❌ Uncaught Exception:', error?.message || error);
});

process.on('unhandledRejection', (reason) => {
    const now = Date.now();
    if (now - lastExceptionAt < EXCEPTION_COOLDOWN_MS) return;
    lastExceptionAt = now;
    _originalError('❌ Unhandled Rejection:', reason?.message || reason);
});

// ============================================================
// Helpers
// ============================================================

function getMessageTextFromMsg(msg) {
    if (!msg || !msg.message) return "";
    const message = msg.message;
    return (
        message.conversation ||
        message.extendedTextMessage?.text ||
        message.imageMessage?.caption ||
        message.videoMessage?.caption ||
        message.documentMessage?.caption ||
        message.buttonsResponseMessage?.selectedButtonId ||
        message.listResponseMessage?.singleSelectReply?.selectedRowId ||
        message.templateButtonReplyMessage?.selectedId ||
        ""
    ).trim();
}

function getSender(msg, sock) {
    try {
        if (msg?.key?.fromMe) return sock?.user?.id || "";
        return msg?.key?.participant || msg?.key?.remoteJid || "";
    } catch {
        return "";
    }
}

function getBotNumber(sock) {
    try {
        return jidToNumber(sock?.user?.id || "");
    } catch {
        return "";
    }
}

function shouldIgnoreMessage(msg) {
    try {
        if (!msg?.message) return true;
        const jid = msg?.key?.remoteJid;
        if (!jid) return true;
        if (jid === "status@broadcast") return true;
        if (msg?.key?.fromMe) {
            const text = getMessageTextFromMsg(msg);
            return !text || !text.startsWith(".");
        }
        return false;
    } catch {
        return true;
    }
}

function fixMention(number) {
    const clean = cleanNumber(number);
    if (!clean) return "";
    return `@${clean}`;
}

function fixMentionJid(number) {
    const clean = cleanNumber(number);
    if (!clean) return "";
    return `${clean}@s.whatsapp.net`;
}

function isUserBanned(db, userNumber) {
    if (!db || !db.bannedUsers) return false;
    const ban = db.bannedUsers[userNumber];
    if (!ban) return false;
    if (Date.now() > ban.until) {
        delete db.bannedUsers[userNumber];
        return false;
    }
    return true;
}

function getBanTimeLeft(db, userNumber) {
    if (!db || !db.bannedUsers) return null;
    const ban = db.bannedUsers[userNumber];
    if (!ban) return null;
    const left = ban.until - Date.now();
    if (left <= 0) return null;
    
    const seconds = Math.floor(left / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}ي`;
    if (hours > 0) return `${hours}س`;
    if (minutes > 0) return `${minutes}د`;
    return `${seconds}ث`;
}

function setupAdminMonitoring(sock) {
    try {
        const db = getDb();
        if (!db) return;
        stopAdminMonitoring();
        startAdminMonitoring(sock, db, saveDb);
    } catch (e) {
        _originalError("Admin monitoring error:", e?.message);
    }
}

function isReceiveGroup(db, jid) {
    return Boolean(db.receiveGroups && db.receiveGroups[jid]);
}

function isMainGroup(db, jid) {
    return Boolean(db.mainGroup && db.mainGroup[jid] === true);
}

function isAdsGroup(db, jid) {
    return Boolean(db.adsGroups && db.adsGroups[jid] === true);
}

async function isUserInMainGroup(sock, db, userNumber) {
    try {
        const mainJids = Object.keys(db.mainGroup || {}).filter(j => db.mainGroup[j] === true);
        if (mainJids.length === 0) return false;

        for (const mainJid of mainJids) {
            try {
                const metadata = await sock.groupMetadata(mainJid);
                const found = metadata.participants.find(p => cleanNumber(p.id) === userNumber);
                if (found) return true;
            } catch (_) {}
        }
        return false;
    } catch {
        return false;
    }
}

const DB_FILE = path.join(__dirname, "database.json");

function getDatabaseContent() {
    try {
        if (fs.existsSync(DB_FILE)) return fs.readFileSync(DB_FILE, "utf8");
        return null;
    } catch {
        return null;
    }
}

async function sendDatabaseBackup(sock) {
    if (!autoSaveEnabled || !autoSaveGroupJid || !sock) return;
    try {
        const dbContent = getDatabaseContent();
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

        const timestamp = new Date().toLocaleString('ar-EG', {
            timeZone: 'Africa/Cairo',
            hour12: false
        });

        for (let i = 0; i < parts.length; i++) {
            const isLast = i === parts.length - 1;
            const header = "📦 *نسخة احتياطية*\n🕐 " + timestamp + "\n📊 جزء " + (i + 1) + "/" + parts.length + "\n\n";
            const footer = isLast ? "\n\n✅ تم الحفظ ✅" : '';
            await sock.sendMessage(autoSaveGroupJid, {
                text: header + parts[i] + footer
            });
        }
    } catch (e) {
        _originalError("Backup error:", e?.message);
    }
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
                try {
                    await sock.sendMessage(jid, { react: { text: emoji, key: msg.key } });
                } catch (_) {}
            }
        }

        const msgContent = msg.message || {};
        if (db.protectCards && db.protectCards[jid]) {
            if (msgContent.contactMessage || msgContent.contactsArrayMessage) {
                try { await sock.sendMessage(jid, { delete: msg.key }); } catch (_) {}
                try {
                    const senderJid = msg?.key?.participant || msg?.key?.remoteJid;
                    if (senderJid) {
                        await sock.groupParticipantsUpdate(jid, [senderJid], "remove");
                    }
                } catch (_) {}
                return;
            }
        }

        if (db.repliesEnabled && db.repliesEnabled[jid]) {
            const badWords = ["كول خرا", "كول خراا", "يلعون", "يلعن امك", "يلعن ابوك"];
            const isBadWord = badWords.some(w => text.includes(w));

            if (isBadWord) {
                let isAdminUser = false;
                try {
                    const metadata = await sock.groupMetadata(jid);
                    const p = metadata.participants.find(p => p.id === sender);
                    if (p && (p.admin === "admin" || p.admin === "superadmin")) {
                        isAdminUser = true;
                    }
                } catch {}

                await sock.sendMessage(jid, {
                    text: isAdminUser
                        ? `═════════════════════\nلولا رتبتك لكنت اعطيتك درسا عن الردود\n═════════════════════`
                        : `═════════════════\nالخرا لسانه خرا مع الكل\n═════════════════`
                });
                return;
            }
        }

        if (db.ahaEnabled && db.ahaEnabled[jid]) {
            if (/احا{1,}/.test(text)) {
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
        }

        if (db.quietEnabled && db.quietEnabled[jid]) {
            db.quietTimer = db.quietTimer || {};
            if (db.quietTimer[jid]) {
                db.quietTimer[jid].lastMessageTime = Date.now();
                db.quietTimer[jid].sent = false;
                saveDb();
            }
        }
    } catch (e) {
        _originalError("AutoReplies error:", e?.message);
    }
}

function getGamesDetailed() {
    const now = Date.now();
    const details = { total: 0, stuck: 0, healthy: 0, list: [] };

    const checkGame = (jid, game, name, ownTimeout) => {
        details.total++;
        const lastActivity = game?.lastActivity || game?.startTime || 0;
        const idle = now - lastActivity;
        const isStuck = idle > ownTimeout + 60 * 1000;

        if (isStuck) {
            details.stuck++;
            details.list.push({ jid, name, idle, status: "STUCK" });
        } else {
            details.healthy++;
            details.list.push({ jid, name, idle, status: "HEALTHY" });
        }
    };

    try {
        for (const jid of Object.keys(activeGames || {})) {
            checkGame(jid, activeGames[jid], "لعبة", 5 * 60 * 1000);
        }
        for (const jid of Object.keys(activeCasinos || {})) {
            checkGame(jid, activeCasinos[jid], "روليت", 25 * 60 * 1000);
        }
        for (const jid of Object.keys(activeSaraha || {})) {
            checkGame(jid, activeSaraha[jid], "صراحة", 5 * 60 * 1000);
        }
        for (const jid of Object.keys(activeColors || {})) {
            checkGame(jid, activeColors[jid], "ألوان", 5 * 60 * 1000);
        }
        for (const jid of Object.keys(activeAnimals || {})) {
            checkGame(jid, activeAnimals[jid], "حيوانات", 5 * 60 * 1000);
        }
        for (const jid of Object.keys(activeMazads || {})) {
            checkGame(jid, activeMazads[jid], "مزاد", 35 * 60 * 1000);
        }
        if (tahminModule && tahminModule.activeTahmin) {
            for (const jid of Object.keys(tahminModule.activeTahmin)) {
                checkGame(jid, tahminModule.activeTahmin[jid], "تخمين", 5 * 60 * 1000);
            }
        }
        if (guessModule && guessModule.activeGuess) {
            for (const jid of Object.keys(guessModule.activeGuess)) {
                checkGame(jid, guessModule.activeGuess[jid], "حدسك", 5 * 60 * 1000);
            }
        }
    } catch {}

    return details;
}

function getStuckGamesInGroup() {
    const now = Date.now();
    const stuck = [];

    const check = (jid, game, name, ownTimeout) => {
        const last = game?.lastActivity || game?.startTime || 0;
        if ((now - last) > ownTimeout + 60 * 1000) {
            stuck.push({ jid, name, game });
        }
    };

    try {
        for (const jid of Object.keys(activeGames || {})) {
            check(jid, activeGames[jid], "لعبة", 5 * 60 * 1000);
        }
        for (const jid of Object.keys(activeColors || {})) {
            check(jid, activeColors[jid], "ألوان", 5 * 60 * 1000);
        }
        for (const jid of Object.keys(activeAnimals || {})) {
            check(jid, activeAnimals[jid], "حيوانات", 5 * 60 * 1000);
        }
        for (const jid of Object.keys(activeSaraha || {})) {
            check(jid, activeSaraha[jid], "صراحة", 5 * 60 * 1000);
        }
        for (const jid of Object.keys(activeCasinos || {})) {
            check(jid, activeCasinos[jid], "روليت", 25 * 60 * 1000);
        }
        for (const jid of Object.keys(activeMazads || {})) {
            check(jid, activeMazads[jid], "مزاد", 35 * 60 * 1000);
        }
        if (tahminModule && tahminModule.activeTahmin) {
            for (const jid of Object.keys(tahminModule.activeTahmin)) {
                check(jid, tahminModule.activeTahmin[jid], "تخمين", 5 * 60 * 1000);
            }
        }
        if (guessModule && guessModule.activeGuess) {
            for (const jid of Object.keys(guessModule.activeGuess)) {
                check(jid, guessModule.activeGuess[jid], "حدسك", 5 * 60 * 1000);
            }
        }
    } catch {}

    return stuck;
}

function stopSingleGame(entry) {
    try {
        const { jid, name, game } = entry;
        if (name === "مزاد") {
            try { game?.stopMazad?.(); } catch {}
            delete activeMazads[jid];
        } else if (name === "روليت") {
            try { game?.stopGame?.(); } catch {}
            delete activeCasinos[jid];
        } else if (name === "تخمين") {
            if (tahminModule && tahminModule.stopTahminGame) {
                try { tahminModule.stopTahminGame(jid); } catch {}
            }
        } else if (name === "حدسك") {
            if (guessModule && guessModule.stopGuessGame) {
                try { guessModule.stopGuessGame(jid); } catch {}
            }
        } else {
            try { game?.stopGame?.(); } catch {}
            delete activeGames[jid];
            delete activeColors[jid];
            delete activeAnimals[jid];
            delete activeSaraha[jid];
        }
        return true;
    } catch { return false; }
}

const restRequests = Object.create(null);

async function requestRestInGroup(sock, jid, reason = "ضغط هائل") {
    if (restRequests[jid]) return false;

    try {
        await sock.sendMessage(jid, {
            text: `◆━─━─━─⊱☢️⊰─━─━─━◆
ملاحظة هناك ${reason} على
 البوت يرجى ارسال امر: 
*.استراحة*
للحفاظ على عدم تعليق البوت
◆━─━─━─⊱🛑⊰─━─━─━◆`
        });

        const timeoutId = setTimeout(async () => {
            const stuck = getStuckGamesInGroup().filter(g => g.jid === jid);
            for (const entry of stuck) stopSingleGame(entry);

            if (stuck.length > 0) {
                await sock.sendMessage(jid, {
                    text: `⏰ انتهت المهلة دون استجابة.\n🛑 تم إيقاف ${stuck.length} فعالية عالقة تلقائياً.`
                }).catch(() => {});
            }

            delete restRequests[jid];
        }, 60 * 1000);

        restRequests[jid] = { timeout: timeoutId, sentAt: Date.now() };
        return true;
    } catch (e) {
        _originalError("requestRestInGroup error:", e?.message);
        return false;
    }
}

async function handleRestCommand(sock, jid, msg, db) {
    if (restRequests[jid]) {
        clearTimeout(restRequests[jid].timeout);
        delete restRequests[jid];
    }

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
            if (tahminModule && tahminModule.stopTahminGame) {
                if (tahminModule.activeTahmin && tahminModule.activeTahmin[jid]) {
                    tahminModule.stopTahminGame(jid);
                    stoppedCount++;
                }
            }
            if (guessModule && guessModule.stopGuessGame) {
                if (guessModule.activeGuess && guessModule.activeGuess[jid]) {
                    guessModule.stopGuessGame(jid);
                    stoppedCount++;
                }
            }
        } catch {}
    } else {
        for (const entry of stuck) {
            if (stopSingleGame(entry)) stoppedCount++;
        }
    }

    try {
        await sock.sendMessage(jid, {
            text: `◆━─━─━─⊱✅⊰─━─━─━◆
تم الاستجابة لطلب الاستراحة
🛑 عدد الفعاليات المتوقفة: \`${stoppedCount}\`
شكراً لتعاونكم ❤️
◆━─━─━─⊱🛑⊰─━─━─━◆`
        }, { quoted: msg });
    } catch {}

    lastMessageAt = Date.now();
    return true;
}

function startWatchdog(sock) {
    lastSocketRef = sock;
    lastMessageAt = Date.now();
    lastGroupUpdateAt = Date.now();
    consecutiveIdleChecks = 0;

    if (watchdogInterval) clearInterval(watchdogInterval);

    watchdogInterval = setInterval(async () => {
        try {
            const now = Date.now();
            const idleMs = now - lastMessageAt;
            const games = getGamesDetailed();

            if (games.stuck > 0 && idleMs > GAME_STUCK_THRESHOLD_MS) {
                const stuckList = getStuckGamesInGroup();
                const affectedGroups = [...new Set(stuckList.map(g => g.jid))];

                for (const grpJid of affectedGroups) {
                    if (!restRequests[grpJid]) {
                        await requestRestInGroup(sock, grpJid, "ضغط هائل");
                    }
                }

                consecutiveIdleChecks = 0;
                return;
            }

            if (games.healthy > 0) {
                if (games.total > MAX_GAME_COUNT) {
                    _originalWarn(`⚠️ Watchdog: عدد فعاليات مرتفع (${games.total})`);
                }
                return;
            }

            if (idleMs > IDLE_THRESHOLD_MS) {
                consecutiveIdleChecks++;
                _originalWarn(`⚠️ Watchdog: خمول ${Math.round(idleMs/60000)}د (${consecutiveIdleChecks}/${MAX_IDLE_CHECKS})`);

                if (consecutiveIdleChecks >= MAX_IDLE_CHECKS) {
                    _originalWarn("🔄 Watchdog: إعادة تشغيل الاتصال قسرياً...");
                    consecutiveIdleChecks = 0;
                    try {
                        if (lastSocketRef && lastSocketRef.ws) lastSocketRef.ws.close();
                    } catch {}
                }
            } else {
                consecutiveIdleChecks = 0;
            }

        } catch (e) {
            _originalError("Watchdog error:", e?.message);
        }
    }, WATCHDOG_CHECK_MS);
}

function stopWatchdog() {
    if (watchdogInterval) clearInterval(watchdogInterval);
    watchdogInterval = null;
}

// ============================================================
// معالجة انضمام العضو للقروب الأساسي
// ============================================================

async function handleMainGroupJoin(sock, groupJid, participant, db, saveDb) {
    try {
        if (!isMainGroup(db, groupJid)) return;

        const userNumber = cleanNumber(participant);
        if (!userNumber) return;

        // التحقق من المؤبد
        if (botTrackerModule && botTrackerModule.isUserPermanent && botTrackerModule.isUserPermanent(db, userNumber)) {
            await sock.sendMessage(groupJid, {
                text: botTrackerModule.getBannedFromKingdomMessage(),
                mentions: [fixMentionJid(userNumber)]
            }).catch(() => {});

            try {
                await sock.groupParticipantsUpdate(groupJid, [fixMentionJid(userNumber)], "remove");
            } catch (_) {}
            return;
        }

        const photoEntry = db.userPhotos ? db.userPhotos[userNumber] : null;

        // إرسال الترحيب
        if (welcomeModule && typeof welcomeModule.sendWelcome === "function") {
            try {
                await welcomeModule.sendWelcome(sock, groupJid, userNumber, photoEntry, db);
            } catch (e) {
                _originalError("sendWelcome error:", e?.message);
            }
        }

        // إرسال هدية الترحيب بعد دقيقة
        setTimeout(async () => {
            try {
                const user = db.users && db.users[userNumber];
                if (user) {
                    user.balance = (Number(user.balance) || 0) + 100;
                    if (typeof saveDb === "function") saveDb();
                }

                await sock.sendMessage(groupJid, {
                    text: `♢┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈♢
👤 العضو: @${userNumber}
لقد حصلت على 100 رصيد كهدية
ترحيب خاصة بك يمكنك ان تكتب: 
*.تفاصيلي*
لرؤية ملفك التعريفي ورصيدك... 
♢┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈♢`,
                    mentions: [fixMentionJid(userNumber)]
                }).catch(() => {});
            } catch (_) {}
        }, 60 * 1000);

        // إرسال تفاصيله بعد 5 دقائق
        setTimeout(async () => {
            try {
                const user = db.users && db.users[userNumber];
                if (!user) return;

                const dn = String(user.nickname || "").trim() || "غير مسجل";
                const fn = String(user.friend || "").trim() || "لا يوجد";

                const text = `╗═════『   بياناتك  』═════╔

💰 رصـــيـــــــدك:     \`{${user.balance || 0}}\`

🏷️ لقبك:    \`{${dn}}\`

🎖️ رتبتك:   \`{${user.rank || "عضو"}}\`

📈 أعلى تفاعل لك: \`{${user.maxInteraction || 0}}\`

🫂 صـــديق:  \`{${fn}}\`
╝════════════════════╚`;

                await sock.sendMessage(groupJid, {
                    text,
                    mentions: [fixMentionJid(userNumber)]
                }).catch(() => {});
            } catch (_) {}
        }, 5 * 60 * 1000);

        // إشعار الإدارة إذا كان العضو موجود في نقابة أخرى
        if (botTrackerModule && botTrackerModule.notifyAdmins && db.multiBotEnabled && db.multiBotEnabled[groupJid]) {
            try {
                await botTrackerModule.notifyAdmins(sock, groupJid, userNumber, db);
            } catch (_) {}
        }

    } catch (e) {
        _originalError("handleMainGroupJoin error:", e?.message);
    }
}

// ============================================================
// معالج أوامر المزاد
// ============================================================

async function handleMazadFlow(sock, jid, msg, text, db, saveDb, cleanSender, owner) {
    if (text === ".مزاد") {
        if (db.mazadBlocked) {
            await sock.sendMessage(jid, {
                text: `◆━─━─━─⊱⚠️⊰─━─━─━◆
*عذرا الإمبراطور قام بمنع هذا!*
◆━─━─━─⊱⛔⊰─━─━─━◆`
            }, { quoted: msg });
            return true;
        }
        await handleMazadCommand(sock, jid, msg, db, saveDb, cleanSender, owner);
        return true;
    }

    if (text.startsWith(".ادفع")) {
        const parts = text.split(/\s+/);
        const amount = parseInt(parts[1]);
        if (!isNaN(amount) && amount > 0) {
            await handleMazadBid(sock, jid, msg, db, saveDb, cleanSender, amount);
            return true;
        }
    }

    if (text === ".مخزوني") {
        await handleMazadInventory(sock, jid, msg, db, cleanSender);
        return true;
    }

    if (text.startsWith(".ارسال")) {
        await handleMazadSend(sock, jid, msg, text, db, saveDb, cleanSender);
        return true;
    }

    if (text === ".الغاء") {
        await handleMazadCancelSend(sock, jid, msg, db, saveDb, cleanSender);
        return true;
    }

    return false;
}

// ============================================================
// معالج أوامر الإمبراطور والمتجر والشراء والتعدد
// ============================================================

async function handleSpecialCommands(sock, jid, msg, text, db, saveDb, cleanSender, owner, isGroup) {
    const isEmperor = db.emperors && db.emperors[cleanSender] === true;

    // .من لقب
    if (text.startsWith(".من ")) {
        const nickname = text.slice(4).trim();
        const { findUserByNickname } = require("./commands");
        const found = findUserByNickname(db, nickname);
        
        if (found) {
            await sock.sendMessage(jid, {
                text: `*⌬━─⟐─👤─⟐─━⌬* 
 هذا هو صاحب اللقب: 
@${found.number}
*⌬━─⟐─👤─⟐─━⌬*`,
                mentions: [fixMentionJid(found.number)]
            }, { quoted: msg });
        } else {
            await sock.sendMessage(jid, {
                text: `*⌬━─⟐─❗─⟐─━⌬* 
   العضو ليس موجود هنا
*⌬━─⟐─📛─⟐─━⌬*`
            }, { quoted: msg });
        }
        return true;
    }

    // .حظر @user مدة
    if (text.startsWith(".حظر ")) {
        const hasPerm1 = owner || (db.permissions && db.permissions["1"] && db.permissions["1"].includes(cleanSender)) || isEmperor;
        
        if (!hasPerm1) {
            await sock.sendMessage(jid, { text: "⛔ ليس لديك صلاحية." }, { quoted: msg });
            return true;
        }

        const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        if (mentioned.length === 0) {
            await sock.sendMessage(jid, { text: "⚠️ يرجى منشن الشخص." }, { quoted: msg });
            return true;
        }

        const target = cleanNumber(mentioned[0]);
        const parts = text.split(/\s+/);
        const timeStr = parts[parts.length - 1];

        let duration = 0;
        const numMatch = timeStr.match(/(\d+)/);
        if (numMatch) {
            const num = parseInt(numMatch[1]);
            if (timeStr.includes("ي")) duration = num * 24 * 60 * 60 * 1000;
            else if (timeStr.includes("س")) duration = num * 60 * 60 * 1000;
            else if (timeStr.includes("د")) duration = num * 60 * 1000;
            else if (timeStr.includes("ث")) duration = num * 1000;
            else duration = num * 60 * 1000;
        }

        if (duration <= 0) {
            await sock.sendMessage(jid, { text: "⚠️ مدة غير صحيحة.\nمثال: .حظر @user 40د" }, { quoted: msg });
            return true;
        }

        db.bannedUsers = db.bannedUsers || {};
        db.bannedUsers[target] = {
            until: Date.now() + duration,
            reason: "حظر إداري",
            bannedBy: cleanSender
        };
        saveDb();

        await sock.sendMessage(jid, {
            text: `✅ تم حظر @${target} لمدة \`${timeStr}\``,
            mentions: [fixMentionJid(target)]
        }, { quoted: msg });
        return true;
    }

    // .مراقب @user
    if (text === ".مراقب" || text.startsWith(".مراقب ")) {
        if (violationModule) {
            await violationModule.handleAddMonitor(sock, jid, msg, db, saveDb, cleanSender, owner);
            return true;
        }
    }

    // .متجر
    if (text === ".متجر") {
        if (storeModule) {
            await storeModule.handleStoreCommand(sock, jid, msg, db, cleanSender);
            return true;
        }
    }

    // .بيع
    if (text.startsWith(".بيع ")) {
        const parts = text.split(/\s+/).slice(1);
        if (storeModule) {
            await storeModule.handleSellCommand(sock, jid, msg, parts, db, saveDb, cleanSender);
            return true;
        }
    }

    // .تعديل متجر
    if (text.startsWith(".تعديل متجر")) {
        const parts = text.split(/\s+/).slice(2);
        if (storeModule) {
            await storeModule.handleEditStore(sock, jid, msg, parts, db, saveDb, cleanSender, owner, isEmperor);
            return true;
        }
    }

    // .شراء
    if (text.startsWith(".شراء ")) {
        const parts = text.split(/\s+/).slice(1);
        if (purchaseModule) {
            await purchaseModule.handlePurchaseCommand(sock, jid, msg, parts, db, cleanSender);
            return true;
        }
    }

    // .طلبات on/off
    if (text === ".طلبات on" || text === ".طلبات off") {
        const action = text.includes("on") ? "on" : "off";
        if (purchaseModule) {
            await purchaseModule.handleOrdersToggle(sock, jid, msg, action, db, saveDb, cleanSender, owner);
            return true;
        }
    }

    // .انا بوت
    if (text.startsWith(".انا بوت")) {
        const parts = text.split(/\s+/).slice(2);
        if (botTrackerModule) {
            const handled = await botTrackerModule.handleBotIdentity(sock, jid, msg, parts, db, saveDb, cleanSender);
            if (handled) return true;
        }
    }

    // .مؤبد
    if (text === ".مؤبد") {
        if (botTrackerModule) {
            const handled = await botTrackerModule.handlePermanentSave(sock, jid, msg, db, saveDb, cleanSender);
            if (handled) return true;
        }
    }

    // .اعفاء
    if (text === ".اعفاء") {
        if (botTrackerModule) {
            const handled = await botTrackerModule.handlePermanentRelease(sock, jid, msg, db, saveDb, cleanSender);
            if (handled) return true;
        }
    }

    // .حذف نقابتك
    if (text === ".حذف نقابتك") {
        if (botTrackerModule) {
            const handled = await botTrackerModule.handleDeleteBotIdentity(sock, jid, msg, db, saveDb, cleanSender, isEmperor || owner);
            if (handled) return true;
        }
    }

    // .تعدد on/off
    if (text === ".تعدد on" || text === ".تعدد off") {
        const action = text.includes("on") ? "on" : "off";
        if (botTrackerModule) {
            const handled = await botTrackerModule.handleMultiBotToggle(sock, jid, msg, action, db, saveDb, cleanSender, owner);
            if (handled) return true;
        }
    }

    // .اتبع حدسك
    if (text === ".اتبع حدسك") {
        if (guessModule) {
            await guessModule.handleGuessCommand(sock, jid, msg, db, saveDb, cleanSender, owner);
            return true;
        }
    }

    // .مشاركة / .اشارك
    if (text.startsWith(".مشاركة ") || text.startsWith(".اشارك ")) {
        const parts = text.split(/\s+/).slice(1);
        if (guessModule) {
            const handled = await guessModule.handleGuessJoin(sock, jid, msg, parts, db, saveDb, cleanSender);
            if (handled) return true;
        }
    }

    // .بدأ / .ابدا
    if (text === ".بدأ" || text === ".ابدا") {
        const guessGame = guessModule && guessModule.activeGuess && guessModule.activeGuess[jid];
        if (guessGame && !guessGame.isStarted) {
            const handled = await guessModule.handleGuessStart(sock, jid, msg, db, saveDb, cleanSender);
            if (handled) return true;
        }
        const casino = activeCasinos[jid];
        if (casino && !casino.started) {
            await handleRouletteStart(sock, jid, msg, cleanSender, owner, db);
            return true;
        }
    }

    // اختيار الكرة في حدسك
    if (guessModule && guessModule.activeGuess && guessModule.activeGuess[jid] && guessModule.activeGuess[jid].isOpen) {
        const handled = await guessModule.handleGuessChoice(sock, jid, msg, text, db, saveDb, cleanSender);
        if (handled) return true;
    }

    // .انهاء مزاد
    if (text === ".انهاء مزاد") {
        if (!owner && !isEmperor) {
            await sock.sendMessage(jid, { text: "⛔ هذا الأمر للإمبراطور فقط." }, { quoted: msg });
            return true;
        }

        const mazad = activeMazads[jid];
        if (!mazad) {
            await sock.sendMessage(jid, { text: "⚠️ لا يوجد مزاد نشط." }, { quoted: msg });
            return true;
        }

        if (mazad.highestBidder) {
            const winner = mazad.highestBidder;
            const amount = mazad.highestBid;
            const item = mazad.item;

            const user = db.users && db.users[winner];
            if (user) {
                user.balance = (Number(user.balance) || 0) - amount;
            }

            db.inventory = db.inventory || {};
            if (!db.inventory[winner]) db.inventory[winner] = [];
            db.inventory[winner].push({
                emoji: item.emoji,
                name: item.name,
                description: item.description,
                acquiredAt: Date.now()
            });

            saveDb();

            await sock.sendMessage(jid, {
                text: `*⌬━─⟐─ 🧾 ─⟐─━⌬*
العضو @${winner}
كسب: ${item.emoji} ${item.name}
${item.description}
السعر: \`${amount}\`
*⌬━─⟐─ 🔥 ─⟐─━⌬*`,
                mentions: [fixMentionJid(winner)]
            });
        } else {
            await sock.sendMessage(jid, { text: "⚠️ لا يوجد عروض في المزاد." });
        }

        try { mazad.stopMazad && mazad.stopMazad(); } catch {}
        delete activeMazads[jid];
        return true;
    }

    // .سحب مزاد
    if (text === ".سحب مزاد") {
        if (!isEmperor) {
            await sock.sendMessage(jid, { text: "⛔ هذا الأمر للإمبراطور فقط." }, { quoted: msg });
            return true;
        }

        db.mazadBlocked = true;
        saveDb();

        await sock.sendMessage(jid, {
            text: `◆━─━─━─⊱⚠️⊰─━─━─━◆
*عذرا الإمبراطور قام بمنع هذا!*
◆━─━─━─⊱⛔⊰─━─━─━◆`
        }, { quoted: msg });
        return true;
    }

    // .مزاد @منشن (منح صلاحية)
    if (text.startsWith(".مزاد ") && isEmperor) {
        const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        if (mentioned.length > 0) {
            const target = cleanNumber(mentioned[0]);
            db.mazadCreator = target;
            db.mazadBlocked = false;
            saveDb();

            await sock.sendMessage(jid, {
                text: `✅ تم منح @${target} صلاحية إنشاء المزاد.`,
                mentions: [fixMentionJid(target)]
            }, { quoted: msg });
            return true;
        }
    }

    // .حذف شامل
    if (text === ".حذف شامل") {
        if (!owner && !isEmperor) {
            await sock.sendMessage(jid, { text: "⛔ هذا الأمر للإمبراطور فقط." }, { quoted: msg });
            return true;
        }

        const mainJids = Object.keys(db.mainGroup || {}).filter(j => db.mainGroup[j] === true);
        if (mainJids.length === 0) {
            await sock.sendMessage(jid, { text: "⚠️ لا يوجد قروب أساسي." }, { quoted: msg });
            return true;
        }

        const mainMembers = new Set();
        for (const mainJid of mainJids) {
            try {
                const metadata = await sock.groupMetadata(mainJid);
                for (const p of metadata.participants) {
                    mainMembers.add(cleanNumber(p.id));
                }
            } catch (_) {}
        }

        const deleted = [];
        for (const userNum of Object.keys(db.users || {})) {
            const user = db.users[userNum];
            if (user && String(user.nickname || "").trim()) {
                if (!mainMembers.has(userNum)) {
                    deleted.push({ number: userNum, nickname: user.nickname });
                    user.nickname = "";
                }
            }
        }

        saveDb();

        await sock.sendMessage(jid, {
            text: `*⌬━─⟐─ 🟢 ─⟐─━⌬*
 تم حذف الالقاب التي ليس
 لديها عضو يملكها هنا  ! 
*⌬━─⟐─ ✅ ─⟐─━⌬*`
        }, { quoted: msg });

        if (deleted.length > 0) {
            let listText = `*⌬━─⟐─ 📜 ─⟐─━⌬*\n الاعضاء الغير مسجلة: \n`;
            const mentions = [];
            for (const d of deleted) {
                listText += `@${d.number}\n`;
                mentions.push(fixMentionJid(d.number));
            }
            listText += `\nالى اخره....\n\n*⌬━─⟐─ 🪪 ─⟐─━⌬*`;

            await sock.sendMessage(jid, {
                text: listText,
                mentions
            });
        }
        return true;
    }

    // .رابط الاعلانات / .رابط المتجر
    if (text.startsWith(".رابط الاعلانات ") || text.startsWith(".رابط المتجر ")) {
        if (!owner) {
            await sock.sendMessage(jid, { text: "⛔ هذا الأمر للمطور فقط." }, { quoted: msg });
            return true;
        }
        const parts = text.split(/\s+/);
        const isAdsLink = text.startsWith(".رابط الاعلانات");
        const url = parts.slice(2).join(" ").trim();
        
        if (!url) {
            await sock.sendMessage(jid, { text: "⚠️ يرجى كتابة الرابط." }, { quoted: msg });
            return true;
        }

        db.welcomeLinks = db.welcomeLinks || { link1: "", link2: "" };
        if (isAdsLink) {
            db.welcomeLinks.link1 = url;
            await sock.sendMessage(jid, { text: "✅ تم حفظ رابط الإعلانات." }, { quoted: msg });
        } else {
            db.welcomeLinks.link2 = url;
            await sock.sendMessage(jid, { text: "✅ تم حفظ رابط المتجر." }, { quoted: msg });
        }
        saveDb();
        return true;
    }

    // .اساسي on/off
    if (text === ".اساسي on" || text === ".اساسي off") {
        if (!owner) {
            await sock.sendMessage(jid, { text: "⛔ هذا الأمر للمطور فقط." }, { quoted: msg });
            return true;
        }
        db.mainGroup = db.mainGroup || {};
        db.organizedGroups = db.organizedGroups || {};
        
        if (text === ".اساسي on") {
            db.mainGroup[jid] = true;
            db.organizedGroups[jid] = true;
            saveDb();
            await sock.sendMessage(jid, { 
                text: "✅ تم تعيين هذا القروب كقروب أساسي.\n✅ تم تفعيل مراقبة المغادرين تلقائياً." 
            }, { quoted: msg });
        } else {
            delete db.mainGroup[jid];
            delete db.organizedGroups[jid];
            saveDb();
            await sock.sendMessage(jid, { text: "❌ تم إلغاء تعيين هذا القروب كقروب أساسي." }, { quoted: msg });
        }
        return true;
    }

    // .548484
    if (text === ".548484") {
        try { await sock.sendMessage(jid, { delete: msg.key }); } catch {}
        if (!owner) {
            await sock.sendMessage(jid, { text: "⛔ هذا الأمر للمطور فقط." }, { quoted: msg });
            return true;
        }

        if (db.mazadBlocked) {
            await sock.sendMessage(jid, {
                text: `◆━─━─━─⊱⚠️⊰─━─━─━◆
*عذرا الإمبراطور قام بمنع هذا!*
◆━─━─━─⊱⛔⊰─━─━─━◆`
            }, { quoted: msg });
            return true;
        }

        db.mazadCreator = cleanSender;
        saveDb();
        await sock.sendMessage(jid, { text: "✅ تم تفعيل وضع منشئ المزاد." }, { quoted: msg });
        return true;
    }

    // .حفظ on/off
    if (text === ".حفظ" || text.startsWith(".حفظ ")) {
        const parts = text.split(/\s+/);
        const action = parts.length > 1 ? parts[1].toLowerCase() : "";

        if (!owner) {
            await sock.sendMessage(jid, { text: "⛔ هذا الأمر للمطور فقط." }, { quoted: msg });
            return true;
        }

        if (action === "on") {
            db.autoSaveEnabled = true;
            db.autoSaveGroupJid = jid;
            saveDb();
            startAutoSave(sock, jid);
            await sock.sendMessage(jid, {
                text: "✅ *تم تفعيل الحفظ التلقائي*\n🕐 كل 4 ساعات"
            }, { quoted: msg });
        } else if (action === "off") {
            db.autoSaveEnabled = false;
            db.autoSaveGroupJid = null;
            saveDb();
            stopAutoSave();
            await sock.sendMessage(jid, { text: "❌ تم إيقاف الحفظ التلقائي" }, { quoted: msg });
        } else {
            const status = db.autoSaveEnabled ? "🟢 مفعّل" : "🔴 غير مفعّل";
            await sock.sendMessage(jid, {
                text: "📊 الحالة: " + status + "\n.حفظ on / off"
            }, { quoted: msg });
        }
        return true;
    }

    // .استراحة
    if (text === ".استراحة") {
        await handleRestCommand(sock, jid, msg, db);
        return true;
    }

    // .stop everything
    if (text.trim().toLowerCase() === ".stop everything") {
        if (!owner) return true;
        try { await sock.sendMessage(jid, { delete: msg.key }); } catch {}
        
        for (const j of Object.keys(activeGames || {})) {
            try { activeGames[j]?.stopGame?.(); } catch {}
            delete activeGames[j];
        }
        for (const j of Object.keys(activeCasinos || {})) {
            try { activeCasinos[j]?.stopGame?.(); } catch {}
            delete activeCasinos[j];
        }
        for (const j of Object.keys(activeSaraha || {})) {
            try { activeSaraha[j]?.stopGame?.(); } catch {}
            delete activeSaraha[j];
        }
        for (const j of Object.keys(activeColors || {})) {
            try { activeColors[j]?.stopGame?.(); } catch {}
            delete activeColors[j];
        }
        for (const j of Object.keys(activeAnimals || {})) {
            try { activeAnimals[j]?.stopGame?.(); } catch {}
            delete activeAnimals[j];
        }
        for (const j of Object.keys(activeMazads || {})) {
            try { activeMazads[j]?.stopMazad?.(); } catch {}
            delete activeMazads[j];
        }
        if (tahminModule && tahminModule.activeTahmin) {
            for (const j of Object.keys(tahminModule.activeTahmin)) {
                try { tahminModule.stopTahminGame(j); } catch {}
            }
        }
        if (guessModule && guessModule.activeGuess) {
            for (const j of Object.keys(guessModule.activeGuess)) {
                try { guessModule.stopGuessGame(j); } catch {}
            }
        }
        
        await sock.sendMessage(jid, { text: "🛑 تم إيقاف جميع الفعاليات." }, { quoted: msg });
        return true;
    }

    return false;
}

// ============================================================
// معالجة الأزرار التفاعلية
// ============================================================

async function handleListResponse(sock, jid, msg, db, cleanSender, owner) {
    const listResponse = msg.message?.listResponseMessage;
    if (!listResponse) return false;

    const selectedRowId = String(listResponse.singleSelectReply?.selectedRowId || "");

    let matchedCmd = null;
    const gameKeywords = [
        { keyword: "تفكيك", cmd: "تفكيك" },
        { keyword: "كتابة", cmd: "كتابة" },
        { keyword: "ألوان", cmd: "الوان" },
        { keyword: "الوان", cmd: "الوان" },
        { keyword: "صراحة", cmd: "صراحة" },
        { keyword: "الحيوانات", cmd: "الحيوانات" },
        { keyword: "حيوانات", cmd: "الحيوانات" },
        { keyword: "أعلام", cmd: "اعلام" },
        { keyword: "اعلام", cmd: "اعلام" },
        { keyword: "إيموجي", cmd: "ايموجي" },
        { keyword: "ايموجي", cmd: "ايموجي" },
        { keyword: "روليت", cmd: "روليت" },
        { keyword: "كريستال", cmd: "كريستال" },
        { keyword: "تخمين", cmd: "تخمين" },
        { keyword: "اتبع حدسك", cmd: "اتبع حدسك" }
    ];

    for (const item of gameKeywords) {
        if (selectedRowId.includes(item.keyword)) {
            matchedCmd = item.cmd;
            break;
        }
    }

    if (!matchedCmd && selectedRowId.startsWith("game_")) {
        matchedCmd = selectedRowId.replace("game_", "");
    }

    if (!matchedCmd) return false;

    const pending = global.pendingGamesMenu && global.pendingGamesMenu[jid];

    if (!pending || pending.sender !== cleanSender) {
        await sock.sendMessage(jid, {
            text: "⚠️ هذه القائمة خاصة بصاحب الأمر `.العاب` فقط."
        }, { quoted: msg }).catch(() => {});
        return true;
    }

    if (Date.now() - pending.timestamp > 5 * 60 * 1000) {
        delete global.pendingGamesMenu[jid];
        await sock.sendMessage(jid, {
            text: "⚠️ انتهت صلاحية القائمة، أعد كتابة `.العاب`."
        }, { quoted: msg }).catch(() => {});
        return true;
    }

    delete global.pendingGamesMenu[jid];
    const cmd = matchedCmd;

    try {
        await sock.sendMessage(jid, { delete: msg.key });
    } catch (_) {}

    if (cmd === "كريستال") {
        await sock.sendMessage(jid, {
            text: "*❉▬▬▬▬🎰▬▬▬▬❉*\n رجاءا اكتب امر: \n*كريستال 00*\nضع عدد الرهان بدلا من 00\nمثال:  `.كريستال 50`\n*✥▬▬▬▬🎰▬▬▬▬✥*"
        }, { quoted: msg }).catch(() => {});
        return true;
    }

    const fakeText = "." + cmd;
    try {
        const fakeMsg = {
            ...msg,
            message: { conversation: fakeText }
        };
        await handleCommand(sock, jid, fakeMsg, {
            db,
            sender: msg?.key?.participant || msg?.key?.remoteJid,
            cleanSender,
            isGroup: true,
            isBotOwner: Boolean(owner),
            botNumber: cleanSender,
            text: fakeText
        });
    } catch (e) {
        _originalError("List response exec error:", e?.message);
    }

    return true;
}

// ============================================================
// Handlers
// ============================================================

function createHandlers() {
    return {
        onConnectionOpen: async (sock) => {
            setupAdminMonitoring(sock);

            const db = getDb();
            if (db && db.autoSaveEnabled && db.autoSaveGroupJid) {
                startAutoSave(sock, db.autoSaveGroupJid);
            }

            startWatchdog(sock);
            _originalLog("✅ البوت جاهز.");
        },

        onConnectionClose: async () => {
            stopAdminMonitoring();
            stopWatchdog();
        },

        onMessage: async (sock, event, context) => {
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

                        // فحص الحظر
                        if (isUserBanned(db, cleanSender)) {
                            const timeLeft = getBanTimeLeft(db, cleanSender);
                            await sock.sendMessage(jid, {
                                text: `━━━━━═⏣⊰⛔⊱⏣═━━━━━
@${cleanSender} انت محظور لمدة  \`${timeLeft || "غير محدد"}\`
━━━━━═⏣⊰🛑⊱⏣═━━━━━`,
                                mentions: [fixMentionJid(cleanSender)]
                            }).catch(() => {});
                            continue;
                        }

                        const text = getMessageTextFromMsg(msg);
                        if (!text) continue;

                        // معالجة رسائل المخالفات
                        if (violationModule) {
                            try {
                                const handled = await violationModule.handleViolationMessage(sock, jid, msg, text, db, saveDb);
                                if (handled) continue;
                            } catch (_) {}
                        }

                        // معالجة رسائل ADS
                        if (resultsModule && resultsModule.isAdsGroup && resultsModule.isAdsGroup(db, jid)) {
                            try {
                                await resultsModule.handleAdsMessage(sock, jid, msg, text, db, saveDb);
                            } catch (_) {}
                        }

                        // معالجة List Response
                        if (msg.message?.listResponseMessage) {
                            const handled = await handleListResponse(sock, jid, msg, db, cleanSender, owner);
                            if (handled) continue;
                        }

                        // فحص الكسر
                        if (violationModule && text.startsWith(".")) {
                            try {
                                const hasDebt = await violationModule.checkUserDebtBeforeUse(sock, jid, db, saveDb, cleanSender);
                                if (hasDebt) continue;
                            } catch (_) {}
                        }

                        // الأوامر الخاصة
                        if (text.startsWith(".")) {
                            const handled = await handleSpecialCommands(sock, jid, msg, text, db, saveDb, cleanSender, owner, isGroup);
                            if (handled) continue;
                        }

                        // المزاد
                        if (text === ".مزاد" || text.startsWith(".ادفع") || text === ".مخزوني" ||
                            text.startsWith(".ارسال") || text === ".الغاء") {
                            const handled = await handleMazadFlow(sock, jid, msg, text, db, saveDb, cleanSender, owner);
                            if (handled) continue;
                        }

                        // الألعاب الأخرى
                        if (text === ".صراحة") {
                            if (await handleSarahaCommand(sock, jid, msg, db, saveDb, cleanSender, owner)) continue;
                        }

                        if (text === ".الوان") {
                            if (await handleColorsCommand(sock, jid, msg, db, saveDb, cleanSender, owner)) continue;
                        }

                        if (text === ".الحيوانات") {
                            if (await handleAnimalsCommand(sock, jid, msg, db, saveDb, cleanSender, owner)) continue;
                        }

                        if (text === ".تخمين") {
                            if (tahminModule && typeof tahminModule.handleTahminCommand === "function") {
                                try {
                                    const handled = await tahminModule.handleTahminCommand(sock, jid, msg, db, saveDb, cleanSender, owner);
                                    if (handled) continue;
                                } catch (e) {
                                    _originalError("tahmin error:", e?.message);
                                }
                            }
                        }

                        // .اوامر
                        if (text === ".اوامر") {
                            if (commandsListModule && typeof commandsListModule.handleCommandsList === "function") {
                                try {
                                    const handled = await commandsListModule.handleCommandsList(sock, jid, msg, db, cleanSender, owner);
                                    if (handled) continue;
                                } catch (e) {
                                    _originalError("commandsList error:", e?.message);
                                }
                            }
                        }

                        // .نتائج
                        if (text === ".نتائج" || text.startsWith(".نتائج ")) {
                            if (resultsModule && typeof resultsModule.handleResults === "function") {
                                try {
                                    const handled = await resultsModule.handleResults(sock, jid, msg, text, db, saveDb, cleanSender, owner);
                                    if (handled) continue;
                                } catch (e) {
                                    _originalError("results error:", e?.message);
                                }
                            }
                        }

                        // إذا لم يبدأ بنقطة
                        if (!text.startsWith(".")) {
                            if (typoModule && typeof typoModule.handleTypo === "function") {
                                if (db.typoEnabled && db.typoEnabled[jid]) {
                                    try {
                                        const handled = await typoModule.handleTypo(sock, jid, msg, text, db, cleanSender, owner);
                                        if (handled) continue;
                                    } catch (_) {}
                                }
                            }

                            await handleAutoReplies(sock, jid, msg, text, sender, cleanSender, db, saveDb);
                            continue;
                        }

                        // تمرير لـ handleCommand
                        await handleCommand(sock, jid, msg, {
                            db,
                            sender,
                            cleanSender,
                            isGroup,
                            isBotOwner: Boolean(owner),
                            botNumber,
                            text
                        });

                    } catch (e) {
                        _originalError("Message error:", e?.message);
                    }
                }
            } catch (e) {
                _originalError("onMessage error:", e?.message);
            }
        },

        onGroupUpdate: async (sock, update, context) => {
            try {
                lastGroupUpdateAt = Date.now();
                const db = context.db || getDb();

                await handleGroupJoin(sock, update, db, saveDb);

                if (update && update.action === "add" && Array.isArray(update.participants)) {
                    for (const participant of update.participants) {
                        await handleMainGroupJoin(sock, update.id, participant, db, saveDb);
                    }
                }
            } catch (e) {
                _originalError("GroupUpdate error:", e?.message);
            }
        }
    };
}

// ============================================================
// Start
// ============================================================

async function main() {
    try {
        _originalLog("╔════════════════════════════════════╗");
        _originalLog("║        🤖 ALJESAT BOT START       ║");
        _originalLog("╚════════════════════════════════════╝");

        configureHandlers(createHandlers());
        const sock = await startBot();
        if (!sock) throw new Error("فشل بدء البوت");
        return sock;
    } catch (e) {
        _originalError("فشل تشغيل البوت:", e?.message);
        return null;
    }
}

main().catch(e => _originalError("Fatal:", e?.message));

process.once("SIGINT", () => {
    stopWatchdog();
    stopAutoSave();
    process.exit(0);
});

process.once("SIGTERM", () => {
    stopWatchdog();
    stopAutoSave();
    process.exit(0);
});

module.exports = { main };
