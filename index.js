"use strict";

const { startBot, configureHandlers } = require("./bot");
const { createHandlers } = require("./dexo");

async function main() {
    try {
        console.log("🤖 ALJESAT BOT START");
        configureHandlers(createHandlers());
        const sock = await startBot();
        if (!sock) throw new Error("فشل بدء البوت");
        return sock;
    } catch (e) {
        console.error("فشل تشغيل البوت:", e?.message);
        return null;
    }
}

main().catch(e => console.error("Fatal:", e?.message));

process.once("SIGINT", () => process.exit(0));
process.once("SIGTERM", () => process.exit(0));

module.exports = { main };
