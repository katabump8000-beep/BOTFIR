// ============================================================
// guess.js
// ALJESAT BOT
// فعالية اتبع حدسك - اختيار الكرة الفائزة (نسخة كاملة)
// ============================================================

"use strict";

// ============================================================
// الكرات المتاحة
// ============================================================

const BALLS = ["🟢", "🟡", "🔵", "🟣", "🔴", "🟤", "🟠"];

// ============================================================
// الحالة النشطة
// ============================================================

const activeGuess = Object.create(null);

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

function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function formatDate(date) {
    const days = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
    const months = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
    return `${days[date.getDay()]} | ${date.getDate()} | ${months[date.getMonth()]}`;
}

// ============================================================
// رسائل اللعبة
// ============================================================

function getGuessStartMessage() {
    return `╗🔵══════شرح═══════🟣╔
 بكل بساطة البوت يرسل كرات ملونة
ويجب على كل عضو ان يرسل لون كرة
يشك بأنها الكرة الفائزة... لو ارسل 
كرة ولم تكن هي الفائزة سيتم خصم
الرهان الذي يضعه من رصيده....  

\`للمشاركة اكتب:\`.مشاركة او .اشارك 
مثلا:  .مشاركة 50
ملاحظة:  هناك كرة واحد رابحة من بين الكرات التي عددها على نفس
عدد المشاركين...
╝🟡════════════════🟢╚`;
}

function getGuessBalls(balls) {
    return `\`ايها المشاركين الحقو حدسكم:\`
◆━─━─━─⊱⊰─━─━─━◆
${balls.join(" ")}
◆━─━─━─⊱⊰─━─━─━◆`;
}

function getGuessAfterBalls() {
    return `✧سيتم فتح الشات بعد 20ث... يرجى ارسال لون الكرة التي تعتقد انها الفائزة وعندما تصيب سيتم إضافة 
رهان الجميع الى رصيدك✧`;
}

function getGuessOpenChat() {
    return `◆━─━─━─⊱⚫⊰─━─━─━◆
 تفضلو وارسلو كرات حدسكم: 
◆━─━─━─⊱⚪⊰─━─━─━◆`;
}

function getGuessRegistered() {
    return `√ \`تم تسجيل اختيارك\` √`;
}

function getGuessWinnerBall(ball) {
    return `⚪⫘⫘⫘⫘⫘⫘⫘⫘⚫
 \`الكرة الصحيحة هي:\`
       
            *☜ ${ball} ☞*

⚪⫘⫘⫘⫘⫘⫘⫘⫘⚫`;
}

function getGuessWinner(nickname, amount) {
    return `🏆┈┈┈┈┈┈┈┈┈┈┈┈┈🪙
 الشخص الذي اصاب حدسه: 
 \`${nickname}\`
تم إضافة الرصيد: \`${amount}\`
🪙┈┈┈┈┈┈┈┈┈┈┈┈┈🏆`;
}

function getGuessMultipleWinners(winners, totalPrize) {
    let text = `🏆┈┈┈┈┈┈┈┈┈┈┈┈┈🪙\n الشخص الذي اصاب حدسه: \n`;
    let index = 1;
    const share = Math.floor(totalPrize / winners.length);

    for (const w of winners) {
        text += `${index} \`${w.nickname}\` او: @${w.number}\n`;
        index++;
    }

    text += `تم إضافة الرصيد: \`${totalPrize}\`\n`;
    for (const w of winners) {
        text += `\`${w.nickname}\`: *${share}*\n`;
    }

    text += `🪙┈┈┈┈┈┈┈┈┈┈┈┈┈🏆`;
    return text;
}

function getGuessNoWinner() {
    return `🏆┈┈┈┈┈┈┈┈┈┈┈┈┈🪙
 الشخص الذي اصاب حدسه: 
  \`جدي\`...  ههه امزح ولا واحد 
  منكم = كلكم مخطئين 🙂😂
🪙┈┈┈┈┈┈┈┈┈┈┈┈┈🏆`;
}

function getGuessInactiveStop() {
    return "⚠️ تم إيقاف الفعالية بسبب الخمول.";
}

function getGuessNeedThird(creatorNum) {
    return `◆━─━─━─⊱⊰─━─━─━◆
ايها المنشئ @${creatorNum}
 ارجوك قم بالغاء الفعالية 
لانه لم يتم العثور على مشارك
ثالث..  ارسل:  .وقف
لإيقاف هذه الفعالية او يجب 
على مشارك ثالث المشاركة وان
لم تغلقها او تكملوها سيتم ايقافها
بعد 75 ثانية وشكرا لكم 🔥
◆━─━─━─⊱⊰─━─━─━◆`;
}

function getGuessPlayerWarning(playerNum) {
    return `◆━─━─━─⊱⊰─━─━─━◆
*العضو  :* @${playerNum}
رجاءا حدد كرة والا سيتم
 استبعادك من اللعبة  وخصم 
رصيدك.  *امامك 30 ثانية*
◆━─━─━─⊱⊰─━─━─━◆`;
}

function getGuessPlayerEliminated(playerNum) {
    return `◆━─━─━─⊱⊰─━─━─━◆
تم استبعاد @${playerNum}
◆━─━─━─⊱⊰─━─━─━◆`;
}

function getGuessWinnerAd(creator, totalPrize, date) {
    return `_*█ إنــتــهــت█*_

◇🎮 نـــــــوع الفعالية:
*{اتبع حدسك}*

◇🪎 آلَــــجَــــآئـزَة:
*{ ${totalPrize}$ }*

◇🎖️ آلَفــــــآئــز:
*${creator}*

◇⏰ بّـــــــدأت:
*{${date}}*

*صـــآنـــــــٌع الفعالية:*
\`━✦❘༻𝐵𝑜𝑡 𝑨𝑳𝑱𝑬𝑺𝐴𝑇༺❘✦━\``;
}

// ============================================================
// بدء الفعالية
// ============================================================

async function handleGuessCommand(sock, jid, msg, db, saveDb, cleanSender, isBotOwner) {
    try {
        if (activeGuess[jid]) {
            await safeSend(sock, jid, {
                text: "⚠️ هناك فعالية اتبع حدسك قائمة بالفعل!"
            }, { quoted: msg });
            return true;
        }

        db.gamePermissions = Array.isArray(db.gamePermissions) ? db.gamePermissions : [];
        const hasPermission = Boolean(isBotOwner) || db.gamePermissions.includes(cleanSender);

        if (!hasPermission) {
            await safeSend(sock, jid, {
                text: "⚠️ ليس لديك صلاحية لاستخدام هذا الأمر."
            }, { quoted: msg });
            return true;
        }

        const user = getUser(db, cleanSender);
        if (!user || !String(user.nickname || "").trim()) {
            await safeSend(sock, jid, {
                text: "❌ يجب أن يكون لديك لقب مسجل عبر .سجل."
            }, { quoted: msg });
            return true;
        }

        // فحص cooldown
        const now = Date.now();
        const cooldownTime = 5 * 60 * 1000;
        db.gameCooldown = db.gameCooldown || {};
        const previousTime = Number(db.gameCooldown[jid]) || 0;

        if (previousTime > 0) {
            const elapsed = now - previousTime;
            if (elapsed < cooldownTime) {
                const remainingMin = Math.ceil((cooldownTime - elapsed) / 60000);
                await safeSend(sock, jid, {
                    text: `⏳ يرجى الانتظار ${remainingMin} دقائق قبل بدء فعالية جديدة.`
                }, { quoted: msg });
                return true;
            }
        }

        db.gameCooldown[jid] = now;
        if (typeof saveDb === "function") saveDb();

        const gameState = {
            creator: cleanSender,
            creatorNickname: user.nickname,
            players: {},
            isActive: true,
            isOpen: false,
            isStarted: false,
            balls: [],
            winnerBall: null,
            totalPrize: 0,
            startTime: new Date(),
            lastActivity: Date.now(),
            timers: {
                inactivity: null,
                start: null,
                warning: null,
                elimination: null
            },
            stopGame: function() {
                this.isActive = false;
                if (this.timers.inactivity) clearTimeout(this.timers.inactivity);
                if (this.timers.start) clearTimeout(this.timers.start);
                if (this.timers.warning) clearTimeout(this.timers.warning);
                if (this.timers.elimination) clearTimeout(this.timers.elimination);
                delete activeGuess[jid];
            }
        };

        activeGuess[jid] = gameState;

        // إرسال الشرح
        await safeSend(sock, jid, {
            text: getGuessStartMessage()
        }, { quoted: msg });

        // مؤقت الخمول (3 دقائق)
        gameState.timers.inactivity = setTimeout(async () => {
            if (!gameState.isActive) return;
            if (Object.keys(gameState.players).length < 3) {
                gameState.stopGame();
                await safeSend(sock, jid, {
                    text: getGuessInactiveStop()
                });
            }
        }, 3 * 60 * 1000);

        return true;

    } catch (error) {
        console.error("❌ خطأ في handleGuessCommand:", error?.message || error);
        return false;
    }
}

// ============================================================
// الانضمام للفعالية
// ============================================================

async function handleGuessJoin(sock, jid, msg, parts, db, saveDb, cleanSender) {
    try {
        const game = activeGuess[jid];
        if (!game || !game.isActive) {
            await safeSend(sock, jid, {
                text: "⚠️ لا توجد فعالية اتبع حدسك نشطة."
            }, { quoted: msg });
            return true;
        }

        if (game.isStarted) {
            await safeSend(sock, jid, {
                text: "⚠️ الفعالية بدأت بالفعل."
            }, { quoted: msg });
            return true;
        }

        const user = getUser(db, cleanSender);
        if (!user || !String(user.nickname || "").trim()) {
            await safeSend(sock, jid, {
                text: "❌ يجب أن يكون لديك لقب مسجل."
            }, { quoted: msg });
            return true;
        }

        if (game.players[cleanSender]) {
            await safeSend(sock, jid, {
                text: "⚠️ أنت مشارك بالفعل."
            }, { quoted: msg });
            return true;
        }

        if (Object.keys(game.players).length >= 7) {
            await safeSend(sock, jid, {
                text: "⚠️ اكتمل العدد الأقصى (7 مشاركين)."
            }, { quoted: msg });
            return true;
        }

        const bet = parseInt(parts[0]) || 0;
        if (bet < 1) {
            await safeSend(sock, jid, {
                text: "⚠️ يرجى تحديد رهان صحيح.\nمثال: .مشاركة 50"
            }, { quoted: msg });
            return true;
        }

        const balance = Number(user.balance) || 0;
        if (balance < bet) {
            await safeSend(sock, jid, {
                text: `⚠️ رصيدك غير كافي. رصيدك: ${balance}$`
            }, { quoted: msg });
            return true;
        }

        // إضافة المشارك
        game.players[cleanSender] = {
            nickname: user.nickname,
            bet: bet,
            choice: null
        };
        game.totalPrize += bet;
        game.lastActivity = Date.now();

        await safeSend(sock, jid, {
            text: `✅ تم تسجيل مشاركتك برهان ${bet}$`
        }, { quoted: msg });

        return true;

    } catch (error) {
        console.error("❌ خطأ في handleGuessJoin:", error?.message || error);
        return false;
    }
}

// ============================================================
// بدء اللعبة
// ============================================================

async function handleGuessStart(sock, jid, msg, db, saveDb, cleanSender) {
    try {
        const game = activeGuess[jid];
        if (!game || !game.isActive) {
            await safeSend(sock, jid, {
                text: "⚠️ لا توجد فعالية نشطة."
            }, { quoted: msg });
            return true;
        }

        if (game.isStarted) {
            await safeSend(sock, jid, {
                text: "⚠️ الفعالية بدأت بالفعل."
            }, { quoted: msg });
            return true;
        }

        const playerCount = Object.keys(game.players).length;

        if (playerCount < 3) {
            await safeSend(sock, jid, {
                text: `⚠️ يجب أن يكون هناك 3 مشاركين على الأقل.\nالعدد الحالي: ${playerCount}`
            }, { quoted: msg });
            return true;
        }

        game.isStarted = true;

        // قفل الشات
        try {
            await sock.groupSettingUpdate(jid, "announcement");
        } catch (_) {}

        // اختيار الكرات
        game.balls = shuffleArray([...BALLS]).slice(0, playerCount);
        game.winnerBall = game.balls[Math.floor(Math.random() * game.balls.length)];

        // إرسال الكرات
        await safeSend(sock, jid, {
            text: getGuessBalls(game.balls)
        });

        await safeSend(sock, jid, {
            text: getGuessAfterBalls()
        });

        // مؤقت 20 ثانية
        game.timers.start = setTimeout(async () => {
            if (!game.isActive) return;

            // فتح الشات
            try {
                await sock.groupSettingUpdate(jid, "not_announcement");
            } catch (_) {}

            await safeSend(sock, jid, {
                text: getGuessOpenChat()
            });

            game.isOpen = true;
            game.lastActivity = Date.now();

            // مؤقت التحقق من الاختيارات (30 ثانية)
            game.timers.warning = setTimeout(async () => {
                if (!game.isActive) return;

                // التحقق من من لم يختر
                let allChosen = true;
                for (const playerNum of Object.keys(game.players)) {
                    const player = game.players[playerNum];
                    if (!player.choice) {
                        allChosen = false;
                        // إرسال تحذير
                        await safeSend(sock, jid, {
                            text: getGuessPlayerWarning(playerNum),
                            mentions: [`${playerNum}@s.whatsapp.net`]
                        });
                    }
                }

                // إذا اختار الجميع، انتهت اللعبة
                if (allChosen) {
                    await endGuessGame(sock, jid, db, saveDb, game);
                    return;
                }

                // مؤقت 30 ثانية للاستبعاد
                game.timers.elimination = setTimeout(async () => {
                    if (!game.isActive) return;

                    // استبعاد من لم يختر
                    for (const playerNum of Object.keys(game.players)) {
                        const player = game.players[playerNum];
                        if (!player.choice) {
                            delete game.players[playerNum];
                            await safeSend(sock, jid, {
                                text: getGuessPlayerEliminated(playerNum),
                                mentions: [`${playerNum}@s.whatsapp.net`]
                            });
                        }
                    }

                    // إعلان النتيجة
                    await endGuessGame(sock, jid, db, saveDb, game);

                }, 30000);

            }, 30000);

        }, 20000);

        return true;

    } catch (error) {
        console.error("❌ خطأ في handleGuessStart:", error?.message || error);
        return false;
    }
}

// ============================================================
// معالجة اختيار الكرة
// ============================================================

async function handleGuessChoice(sock, jid, msg, text, db, saveDb, cleanSender) {
    try {
        const game = activeGuess[jid];
        if (!game || !game.isActive || !game.isOpen) return false;

        const player = game.players[cleanSender];
        if (!player) return false;

        // التحقق من أن النص هو كرة
        const ball = text.trim();
        if (!BALLS.includes(ball)) return false;

        if (player.choice) {
            await safeSend(sock, jid, {
                text: "⚠️ لقد اخترت بالفعل."
            }, { quoted: msg });
            return true;
        }

        player.choice = ball;
        game.lastActivity = Date.now();

        await safeSend(sock, jid, {
            text: getGuessRegistered()
        }, { quoted: msg });

        // التحقق إذا اختار الجميع
        const allChosen = Object.values(game.players).every(p => p.choice);

        if (allChosen) {
            // إلغاء المؤقتات
            if (game.timers.warning) clearTimeout(game.timers.warning);
            if (game.timers.elimination) clearTimeout(game.timers.elimination);

            // قفل الشات وإعلان النتيجة
            try {
                await sock.groupSettingUpdate(jid, "announcement");
            } catch (_) {}

            await endGuessGame(sock, jid, db, saveDb, game);
        }

        return true;

    } catch (error) {
        console.error("❌ خطأ في handleGuessChoice:", error?.message || error);
        return false;
    }
}

// ============================================================
// إنهاء اللعبة
// ============================================================

async function endGuessGame(sock, jid, db, saveDb, game) {
    try {
        if (!game.isActive) return;
        game.isActive = false;

        if (game.timers.warning) clearTimeout(game.timers.warning);
        if (game.timers.elimination) clearTimeout(game.timers.elimination);

        // قفل الشات
        try {
            await sock.groupSettingUpdate(jid, "announcement");
        } catch (_) {}

        // إعلان الكرة الفائزة بعد 5 ثواني
        await new Promise(r => setTimeout(r, 5000));
        await safeSend(sock, jid, {
            text: getGuessWinnerBall(game.winnerBall)
        });

        // البحث عن الفائزين
        const winners = [];
        for (const playerNum of Object.keys(game.players)) {
            const player = game.players[playerNum];
            if (player.choice === game.winnerBall) {
                winners.push({
                    number: playerNum,
                    nickname: player.nickname,
                    bet: player.bet
                });
            }
        }

        // خصم الرصيد من الخاسرين
        for (const playerNum of Object.keys(game.players)) {
            const player = game.players[playerNum];
            const user = db.users?.[playerNum];
            if (user) {
                if (player.choice !== game.winnerBall) {
                    user.balance = (Number(user.balance) || 0) - player.bet;
                }
            }
        }

        if (winners.length === 0) {
            await safeSend(sock, jid, {
                text: getGuessNoWinner()
            });
        } else if (winners.length === 1) {
            const winner = winners[0];
            const user = db.users?.[winner.number];
            if (user) {
                user.balance = (Number(user.balance) || 0) + game.totalPrize;
            }
            await safeSend(sock, jid, {
                text: getGuessWinner(winner.nickname, game.totalPrize)
            });
        } else {
            const share = Math.floor(game.totalPrize / winners.length);
            for (const winner of winners) {
                const user = db.users?.[winner.number];
                if (user) {
                    user.balance = (Number(user.balance) || 0) + share;
                }
            }
            await safeSend(sock, jid, {
                text: getGuessMultipleWinners(winners, game.totalPrize)
            });
        }

        if (typeof saveDb === "function") saveDb();

        // إعلان ADS
        const dateStr = formatDate(game.startTime);
        const creatorNickname = game.creatorNickname || "مجهول";

        const adMessage = `_*█ إنــتــهــت█*_

◇🎮 نـــــــوع الفعالية:
*{اتبع حدسك}*

◇🪎 آلَــــجَــــآئـزَة:
*{ ${game.totalPrize}$ }*

◇🎖️ آلَفــــــآئــز:
*${winners.length > 0 ? winners.map(w => w.nickname).join(", ") : "لا فائز"}*

◇⏰ بّـــــــدأت:
*{${dateStr}}*

*صـــآنـــــــٌع الفعالية:*
\`━✦❘༻𝐵𝑜𝑡 𝑨𝑳𝑱𝑬𝑺𝐴𝑇༺❘✦━\``;

        if (db.adsGroups && typeof db.adsGroups === "object") {
            for (const adJid of Object.keys(db.adsGroups)) {
                if (!db.adsGroups[adJid]) continue;
                await safeSend(sock, adJid, { text: adMessage });
            }
        }

        // فتح الشات
        try {
            await sock.groupSettingUpdate(jid, "not_announcement");
        } catch (_) {}

        delete activeGuess[jid];

    } catch (error) {
        console.error("❌ خطأ في endGuessGame:", error?.message || error);
    }
}

// ============================================================
// إيقاف الفعالية
// ============================================================

function stopGuessGame(jid) {
    const game = activeGuess[jid];
    if (game) {
        game.stopGame();
        return true;
    }
    return false;
}

// ============================================================
// تصدير
// ============================================================

module.exports = {
    activeGuess,
    handleGuessCommand,
    handleGuessJoin,
    handleGuessStart,
    handleGuessChoice,
    stopGuessGame,
    BALLS
};