// ============================================================
// results.js
// ALJESAT BOT
// نظام النتائج - عرض إحصائيات الفعاليات (معدل)
// ============================================================

"use strict";

// ============================================================
// أدوات مساعدة
// ============================================================

function cleanNumber(value) {
    if (!value) return "";
    return String(value).replace(/[^0-9]/g, "");
}

async function safeSend(sock, jid, content, options = {}) {
    if (!sock || !jid) return Promise.resolve(null);
    return sock.sendMessage(jid, content, options).catch(() => null);
}

function isAdsGroup(db, jid) {
    return Boolean(db.adsGroups && db.adsGroups[jid] === true);
}

function hasAdminPerm(db, cleanSender, isBotOwner) {
    if (isBotOwner) return true;

    const permissions = db.permissions || {};
    // صلاحية 5 = جميع الصلاحيات
    if (Array.isArray(permissions["5"]) && permissions["5"].includes(cleanSender)) return true;
    for (const level of ["1", "2", "3", "4"]) {
        if (Array.isArray(permissions[level]) && permissions[level].includes(cleanSender)) {
            return true;
        }
    }
    return false;
}

// ============================================================
// حفظ نتيجة فعالية
// ============================================================

function recordResult(db, saveDb, entry) {
    try {
        if (!db || !entry || !entry.playerNumber) return false;

        db.resultsData = db.resultsData && typeof db.resultsData === "object" ? db.resultsData : {};
        
        const playerNumber = cleanNumber(entry.playerNumber);
        if (!playerNumber) return false;

        if (!db.resultsData[playerNumber]) {
            db.resultsData[playerNumber] = {
                nickname: entry.nickname || "",
                wins: 0,
                losses: 0,
                totalPrize: 0,
                totalLoss: 0,
                lastGame: entry.gameType || "",
                firstSeen: Date.now()
            };
        }

        const data = db.resultsData[playerNumber];

        if (entry.nickname && String(entry.nickname).trim()) {
            data.nickname = String(entry.nickname).trim();
        }

        if (entry.result === "win") {
            data.wins = (data.wins || 0) + 1;
            data.totalPrize = (data.totalPrize || 0) + (Number(entry.prize) || 0);
        } else if (entry.result === "lose") {
            data.losses = (data.losses || 0) + 1;
            data.totalLoss = (data.totalLoss || 0) + (Number(entry.prize) || 0);
        }

        data.lastGame = entry.gameType || data.lastGame;

        if (typeof saveDb === "function") saveDb();

        return true;

    } catch (error) {
        console.error("❌ خطأ في recordResult:", error?.message || error);
        return false;
    }
}

// ============================================================
// استخراج نتيجة من رسالة إعلان
// ============================================================

function parseResultFromAd(text) {
    try {
        if (!text) return null;

        // البحث عن نمط إعلان الفوز
        // نمط: _*█ إنــتــهــت█*_ ... نوع الفعالية ... الجائزة ... الفائز
        
        const typeMatch = text.match(/نـــــــوع الفعالية:\s*\*\{([^}]+)\}\*/);
        const prizeMatch = text.match(/آلَــــجَــــآئـزَة:\s*\*\{\s*(\d+)\s*\$\s*\}\*/);
        const winnerMatch = text.match(/آلَفــــــآئــز:\s*\*([^*]+)\*/);

        if (typeMatch && winnerMatch) {
            return {
                type: "win",
                gameType: typeMatch[1].trim(),
                prize: prizeMatch ? parseInt(prizeMatch[1]) : 0,
                nickname: winnerMatch[1].trim()
            };
        }

        // البحث عن نمط إعلان الخسارة
        // نمط: اللاعب *اسم* خسر في لعبة الكرستال بمبلغ
        const lossMatch = text.match(/اللاعب\s+\*([^*]+)\*\s+خسر/);
        const lossAmountMatch = text.match(/﴿\s*(\d+)\s*﴾/);

        if (lossMatch) {
            return {
                type: "lose",
                gameType: "كريستال",
                prize: lossAmountMatch ? parseInt(lossAmountMatch[1]) : 0,
                nickname: lossMatch[1].trim()
            };
        }

        return null;

    } catch {
        return null;
    }
}

// ============================================================
// البحث عن رقم العضو باللقب
// ============================================================

function findUserByNickname(db, nickname) {
    if (!db || !db.users) return null;
    const norm = String(nickname).trim().toLowerCase();
    for (const number of Object.keys(db.users)) {
        const user = db.users[number];
        if (user && String(user.nickname || "").trim().toLowerCase() === norm) {
            return { number, user };
        }
    }
    return null;
}

// ============================================================
// بناء قائمة النتائج
// ============================================================

function buildResultsList(db) {
    try {
        const resultsData = db.resultsData || {};
        const entries = [];

        for (const playerNumber of Object.keys(resultsData)) {
            const data = resultsData[playerNumber];
            if (!data) continue;

            entries.push({
                playerNumber,
                nickname: data.nickname || playerNumber,
                wins: Number(data.wins) || 0,
                losses: Number(data.losses) || 0,
                totalPrize: Number(data.totalPrize) || 0,
                totalLoss: Number(data.totalLoss) || 0
            });
        }

        entries.sort((a, b) => b.totalPrize - a.totalPrize);

        if (entries.length === 0) {
            return "⚠️ لا توجد نتائج مسجلة حتى الآن.";
        }

        let text = "";
        let index = 1;

        for (const entry of entries) {
            text += `═══════ _*${index}*_ ═══════\n`;
            text += ` \`•\` اللقب: \`${entry.nickname}\`\n`;
            text += ` \`•\` عدد الانتصارات: \`${entry.wins}\`\n`;
            text += ` \`•\` عدد الخسائر: \`${entry.losses}\`\n`;
            text += ` \`•\` المرابح: \`${entry.totalPrize}\`\n`;
            text += ` \`•\` الخسائر: \`${entry.totalLoss}\`\n`;
            index++;
        }

        return text;

    } catch (error) {
        console.error("❌ خطأ في buildResultsList:", error?.message || error);
        return "❌ حدث خطأ أثناء بناء النتائج.";
    }
}

// ============================================================
// معالجة أمر .نتائج
// ============================================================

async function handleResults(sock, jid, msg, text, db, saveDb, cleanSender, isBotOwner) {
    try {
        if (!hasAdminPerm(db, cleanSender, isBotOwner)) {
            await safeSend(sock, jid, {
                text: "⛔ هذا الأمر يحتاج صلاحيات إدارية (.سماح)."
            }, { quoted: msg });
            return true;
        }

        if (!isAdsGroup(db, jid)) {
            await safeSend(sock, jid, {
                text: `❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆
  *هذا الأمر يعمل فقط في*
  *قروب الإعلانات (ADS)*
❆━━━━━═⏣⊰⚠️⊱⏣═━━━━━❆`
            }, { quoted: msg });
            return true;
        }

        const parts = text.split(/\s+/);
        const subCommand = parts[1] || "";

        if (subCommand === "0") {
            db.resultsData = {};
            if (typeof saveDb === "function") saveDb();

            await safeSend(sock, jid, {
                text: `❆━━━━━═⏣⊰✅⊱⏣═━━━━━❆
  *تم تصفير جميع النتائج*
  *وسيتم بدء المراقبة من جديد*
❆━━━━━═⏣⊰✅⊱⏣═━━━━━❆`
            }, { quoted: msg });
            return true;
        }

        const resultsText = buildResultsList(db);

        await safeSend(sock, jid, {
            text: resultsText
        }, { quoted: msg });

        return true;

    } catch (error) {
        console.error("❌ خطأ في handleResults:", error?.message || error);
        return false;
    }
}

// ============================================================
// معالجة رسائل ADS تلقائياً
// ============================================================

async function handleAdsMessage(sock, jid, msg, text, db, saveDb) {
    try {
        // التحقق من أن هذه رسالة إعلان
        if (!text.includes("إنــتــهــت") && !text.includes("خسر في")) {
            return false;
        }

        const result = parseResultFromAd(text);
        if (!result) return false;

        // البحث عن رقم العضو باللقب
        const foundUser = findUserByNickname(db, result.nickname);

        if (!foundUser) {
            console.log(`⚠️ لم يتم العثور على عضو باللقب: ${result.nickname}`);
            return false;
        }

        // تسجيل النتيجة
        recordResult(db, saveDb, {
            playerNumber: foundUser.number,
            nickname: result.nickname,
            gameType: result.gameType,
            prize: result.prize,
            result: result.type,
            timestamp: Date.now()
        });

        console.log(`✅ تم تسجيل ${result.type} للعضو ${result.nickname}`);
        return true;

    } catch (error) {
        console.error("❌ خطأ في handleAdsMessage:", error?.message || error);
        return false;
    }
}

// ============================================================
// تصدير
// ============================================================

module.exports = {
    handleResults,
    recordResult,
    parseResultFromAd,
    handleAdsMessage,
    buildResultsList,
    isAdsGroup,
    hasAdminPerm
};