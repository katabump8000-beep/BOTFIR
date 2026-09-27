// ============================================================
// violation.js
// ALJESAT BOT
// نظام المخالفات وخصم الرصيد التلقائي
// ============================================================

"use strict";

// ============================================================
// إعدادات
// ============================================================

const VIOLATION_DEDUCTION = 100; // خصم ثابت لكل مخالفة
const DEBT_THRESHOLD = 3000;     // حد الكسر الأقصى
const DEBT_BAN_TIME = 8 * 60 * 60 * 1000; // 8 ساعات حظر
const DEBT_REDUCTION = 500;      // تقليل الكسر بعد الحظر

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

function getUserNickname(db, jid) {
    const user = getUser(db, jid);
    return (user && String(user.nickname || "").trim()) || "مجهول";
}

async function safeSend(sock, jid, content, options = {}) {
    if (!sock || !jid) return Promise.resolve(null);
    return sock.sendMessage(jid, content, options).catch(() => null);
}

// ============================================================
// رسائل الكسر
// ============================================================

function getHeavyDebtMessage(mention, debt, banTime = "8س") {
    return `*-$* ══════♨️══════ *-$*
    العضو ${mention}
   لقد اصبح عليك: 
   كسر رصيد ${debt}- تم حظرك من 
  استعمال البوت حتى ${banTime} 
  عند انتهاء الوقت سيكون الكسر عليك
  فقط ${Math.max(0, debt - 500)}- يرجى محاولة استعادة 
  المال وعدم تراكم الكسر وتجاوز      3000-  والا ستحظر مجددا 
═════════════════`;
}

function getLightDebtMessage(mention, debt) {
    return `━━━━━═⏣⊰📛⊱⏣═━━━━━
العضو ${mention} 
نود اعلامك بأن عليك دفع سلفة في رصيدك  لانه قد اصبح عليك كسر
بقيمة: \`${debt}-\`
═════════════════`;
}

function getViolationDeductedMessage(nickname, amount) {
    return `•┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈•
تم خصم رصيد من العضو: 
[ \`${nickname}\` ]  قيمة الضريبة:  ${amount}
السبب:  ارتكاب مخالفة
•┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈•`;
}

// ============================================================
// فحص رسالة المخالفة
// ============================================================

function parseViolationMessage(text) {
    try {
        if (!text) return null;

        // البحث عن نمط المخالفة
        const hasViolation = text.includes("مــخــالــفــة") || 
                            text.includes("مخالفة") ||
                            text.includes("عدد المخالفات");

        if (!hasViolation) return null;

        // البحث عن العضو الممنشن
        // النمط: 👤 العضو: @⁨...⁩
        const memberMatch = text.match(/👤\s*العضو:\s*@[⁨]?([^⁩\s]+)[⁩]?/);
        
        if (!memberMatch) return null;

        // استخراج الرقم من المنشن
        let memberNumber = memberMatch[1];
        // إزالة أي رموز غريبة
        memberNumber = cleanNumber(memberNumber);

        // البحث عن عدد المخالفات
        const countMatch = text.match(/عدد المخالفات:\s*\*?(\d+)\*?/);
        const violationCount = countMatch ? parseInt(countMatch[1]) : 1;

        return {
            memberNumber,
            violationCount
        };

    } catch (error) {
        console.error("❌ خطأ في parseViolationMessage:", error?.message);
        return null;
    }
}

// ============================================================
// خصم الرصيد من العضو
// ============================================================

function deductBalance(db, saveDb, userNumber, amount) {
    try {
        db.users = db.users || {};
        
        if (!db.users[userNumber]) {
            db.users[userNumber] = {
                balance: 0,
                nickname: "",
                rank: "",
                maxInteraction: 0,
                friend: ""
            };
        }

        const user = db.users[userNumber];
        user.balance = (Number(user.balance) || 0) - amount;

        // تسجيل الكسر إذا وجد
        if (user.balance < 0) {
            db.debtUsers = db.debtUsers || {};
            db.debtUsers[userNumber] = Math.abs(user.balance);
        }

        if (typeof saveDb === "function") saveDb();

        return true;

    } catch (error) {
        console.error("❌ خطأ في deductBalance:", error?.message);
        return false;
    }
}

// ============================================================
// فحص وإدارة الكسر
// ============================================================

async function checkAndHandleDebt(sock, jid, db, saveDb, userNumber) {
    try {
        const user = getUser(db, userNumber);
        if (!user) return null;

        const balance = Number(user.balance) || 0;
        
        if (balance >= 0) {
            // لا يوجد كسر
            // إزالة من قائمة الكسر إذا كان موجوداً
            if (db.debtUsers && db.debtUsers[userNumber]) {
                delete db.debtUsers[userNumber];
                if (typeof saveDb === "function") saveDb();
            }
            return null;
        }

        const debt = Math.abs(balance);
        const mention = `@${userNumber}`;

        // إذا تجاوز الكسر الحد الأقصى
        if (debt >= DEBT_THRESHOLD) {
            // حظر 8 ساعات
            db.bannedUsers = db.bannedUsers || {};
            db.bannedUsers[userNumber] = {
                until: Date.now() + DEBT_BAN_TIME,
                reason: "كسر رصيد",
                bannedBy: "SYSTEM",
                debt: debt
            };

            if (typeof saveDb === "function") saveDb();

            await safeSend(sock, jid, {
                text: getHeavyDebtMessage(mention, debt, "8س"),
                mentions: [`${userNumber}@s.whatsapp.net`]
            });

            return { type: "heavy", debt };

        } else {
            // كسر خفيف - إرسال تنبيه مرة واحدة فقط
            db.notifiedDebt = db.notifiedDebt || {};
            
            if (!db.notifiedDebt[userNumber] || 
                Date.now() - db.notifiedDebt[userNumber] > 60 * 60 * 1000) {
                
                db.notifiedDebt[userNumber] = Date.now();
                if (typeof saveDb === "function") saveDb();

                await safeSend(sock, jid, {
                    text: getLightDebtMessage(mention, debt),
                    mentions: [`${userNumber}@s.whatsapp.net`]
                });
            }

            return { type: "light", debt };
        }

    } catch (error) {
        console.error("❌ خطأ في checkAndHandleDebt:", error?.message);
        return null;
    }
}

// ============================================================
// فحص العضو قبل استخدام البوت
// ============================================================

async function checkUserDebtBeforeUse(sock, jid, db, saveDb, userNumber) {
    try {
        const user = getUser(db, userNumber);
        if (!user) return false;

        const balance = Number(user.balance) || 0;
        
        // إذا كان الرصيد سالباً (عليه كسر)
        if (balance < 0) {
            const debt = Math.abs(balance);
            
            // إذا كان الكسر كبيراً جداً
            if (debt >= DEBT_THRESHOLD) {
                await safeSend(sock, jid, {
                    text: getHeavyDebtMessage(`@${userNumber}`, debt, "8س"),
                    mentions: [`${userNumber}@s.whatsapp.net`]
                });
                return true; // محظور
            }

            // كسر خفيف - ننبهه لكن لا نمنعه
            return false;
        }

        return false;

    } catch (error) {
        console.error("❌ خطأ في checkUserDebtBeforeUse:", error?.message);
        return false;
    }
}

// ============================================================
// معالجة رسالة المخالفة
// ============================================================

async function handleViolationMessage(sock, jid, msg, text, db, saveDb) {
    try {
        // التحقق من أن المرسل هو المراقب
        const sender = msg?.key?.participant || msg?.key?.remoteJid;
        const senderNumber = cleanNumber(sender);

        // التحقق من قائمة المراقبين
        const monitored = db.monitoredNumbers || [];
        if (!monitored.includes(senderNumber)) {
            return false;
        }

        const violation = parseViolationMessage(text);
        if (!violation) return false;

        const { memberNumber, violationCount } = violation;

        if (!memberNumber || memberNumber.length < 6) {
            return false;
        }

        // خصم الرصيد
        deductBalance(db, saveDb, memberNumber, VIOLATION_DEDUCTION);

        // الحصول على اللقب
        const nickname = getUserNickname(db, memberNumber);

        // إرسال رسالة الخصم كرد على الرسالة
        await safeSend(sock, jid, {
            text: getViolationDeductedMessage(nickname, VIOLATION_DEDUCTION)
        }, { quoted: msg });

        // فحص الكسر
        await checkAndHandleDebt(sock, jid, db, saveDb, memberNumber);

        return true;

    } catch (error) {
        console.error("❌ خطأ في handleViolationMessage:", error?.message);
        return false;
    }
}

// ============================================================
// إضافة مراقب
// ============================================================

async function handleAddMonitor(sock, jid, msg, db, saveDb, cleanSender, isBotOwner) {
    try {
        if (!isBotOwner) {
            await safeSend(sock, jid, {
                text: "⛔ هذا الأمر للمطور فقط."
            }, { quoted: msg });
            return true;
        }

        const mentioned = msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
        if (!mentioned) {
            await safeSend(sock, jid, {
                text: "⚠️ يرجى منشن المراقب."
            }, { quoted: msg });
            return true;
        }

        const target = cleanNumber(mentioned);

        db.monitoredNumbers = Array.isArray(db.monitoredNumbers) ? db.monitoredNumbers : [];

        if (!db.monitoredNumbers.includes(target)) {
            db.monitoredNumbers.push(target);
            if (typeof saveDb === "function") saveDb();

            await safeSend(sock, jid, {
                text: `✅ تم إضافة @${target} كمراقب.`,
                mentions: [`${target}@s.whatsapp.net`]
            }, { quoted: msg });
        } else {
            db.monitoredNumbers = db.monitoredNumbers.filter(n => n !== target);
            if (typeof saveDb === "function") saveDb();

            await safeSend(sock, jid, {
                text: `✅ تم إزالة @${target} من المراقبين.`,
                mentions: [`${target}@s.whatsapp.net`]
            }, { quoted: msg });
        }

        return true;

    } catch (error) {
        console.error("❌ خطأ في handleAddMonitor:", error?.message);
        return false;
    }
}

// ============================================================
// تصدير
// ============================================================

module.exports = {
    parseViolationMessage,
    handleViolationMessage,
    checkAndHandleDebt,
    checkUserDebtBeforeUse,
    handleAddMonitor,
    deductBalance,
    getHeavyDebtMessage,
    getLightDebtMessage,
    getViolationDeductedMessage,
    VIOLATION_DEDUCTION,
    DEBT_THRESHOLD
};