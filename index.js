// ============================================================
// index.js
// ALJESAT BOT - الجزء الأساسي
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
// Imports
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
// استيراد الملفات الاختيارية
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
        console.error("Admin monitoring error:", e?.message);
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

// ============================================================
// Auto Save
// ============================================================

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
        console.error("Backup error:", e?.message);
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
        console.error("AutoReplies error:", e?.message);
    }
}

// ============================================================
// Games Analysis
// ============================================================

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

// ============================================================
// Rest System
// ============================================================

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
        console.error("requestRestInGroup error:", e?.message);
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

// ============================================================
// Watchdog
// ============================================================

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
                    console.warn(`⚠️ Watchdog: عدد فعاليات مرتفع (${games.total})`);
                }
                return;
            }

            if (idleMs > IDLE_THRESHOLD_MS) {
                consecutiveIdleChecks++;
                console.warn(`⚠️ Watchdog: خمول ${Math.round(idleMs/60000)}د (${consecutiveIdleChecks}/${MAX_IDLE_CHECKS})`);

                if (consecutiveIdleChecks >= MAX_IDLE_CHECKS) {
                    console.warn("🔄 Watchdog: إعادة تشغيل الاتصال قسرياً...");
                    consecutiveIdleChecks = 0;
                    try {
                        if (lastSocketRef && lastSocketRef.ws) lastSocketRef.ws.close();
                    } catch {}
                }
            } else {
                consecutiveIdleChecks = 0;
            }

        } catch (e) {
            console.error("Watchdog error:", e?.message);
        }
    }, WATCHDOG_CHECK_MS);
}

function stopWatchdog() {
    if (watchdogInterval) clearInterval(watchdogInterval);
    watchdogInterval = null;
}

// ============================================================
// Exports للاستخدام في dexo.js
// ============================================================

module.exports = {
    // Helpers
    getMessageTextFromMsg,
    getSender,
    getBotNumber,
    shouldIgnoreMessage,
    fixMention,
    fixMentionJid,
    isUserBanned,
    getBanTimeLeft,
    setupAdminMonitoring,
    isReceiveGroup,
    isMainGroup,
    isAdsGroup,
    isUserInMainGroup,

    // AutoSave
    startAutoSave,
    stopAutoSave,

    // AutoReplies
    handleAutoReplies,

    // Games
    getGamesDetailed,
    getStuckGamesInGroup,
    stopSingleGame,

    // Rest
    requestRestInGroup,
    handleRestCommand,

    // Watchdog
    startWatchdog,
    stopWatchdog,

    // Modules
    photosModule,
    welcomeModule,
    tahminModule,
    resultsModule,
    commandsListModule,
    typoModule,
    storeModule,
    purchaseModule,
    botTrackerModule,
    guessModule,
    violationModule,

    // Core
    startBot,
    configureHandlers,
    getDb,
    saveDb,
    jidToNumber,
    isGroupJid,
    isOwner,
    cleanNumber,
    handleCommand,
    handleGroupJoin,
    startAdminMonitoring,
    stopAdminMonitoring,

    // Games
    activeGames,
    activeCasinos,
    isSarahaActive,
    activeSaraha,
    handleSarahaCommand,
    activeMazads,
    handleMazadCommand,
    handleMazadBid,
    handleMazadInventory,
    handleMazadSend,
    handleMazadCancelSend,
    activeColors,
    handleColorsCommand,
    activeAnimals,
    handleAnimalsCommand,

    // State
    get lastMessageAt() { return lastMessageAt; },
    set lastMessageAt(v) { lastMessageAt = v; },
    get lastGroupUpdateAt() { return lastGroupUpdateAt; },
    set lastGroupUpdateAt(v) { lastGroupUpdateAt = v; },
    get consecutiveIdleChecks() { return consecutiveIdleChecks; },
    set consecutiveIdleChecks(v) { consecutiveIdleChecks = v; },
    get lastSocketRef() { return lastSocketRef; },
    set lastSocketRef(v) { lastSocketRef = v; },
    get autoSaveEnabled() { return autoSaveEnabled; },
    get autoSaveGroupJid() { return autoSaveGroupJid; }
};

// ============================================================
// Start - تشغيل البوت
// ============================================================

const { createHandlers } = require("./dexo");

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
