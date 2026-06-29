// bot.js
import axios from "axios";
import fs from "fs";

const BOT_TOKEN = process.env.BOT_TOKEN || "BOT_TOKEN";
const CHAT_ID = process.env.CHAT_ID || "CHAT_ID";

const TELEGRAM_URL = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

const OKX = "https://www.okx.com";

const CACHE_FILE = "sentCoins.json";
const DUPLICATE_TIME = 2 * 60 * 60 * 1000; // 2 giờ

// ================= CACHE =================

function loadCache() {
    try {
        return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    } catch {
        return {};
    }
}

function saveCache(cache) {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

const sentCache = loadCache();

function wasSentRecently(symbol) {
    const t = sentCache[symbol];
    if (!t) return false;
    return Date.now() - t < DUPLICATE_TIME;
}

function markSent(symbol) {
    sentCache[symbol] = Date.now();
    saveCache(sentCache);
}

// ================= TELEGRAM =================

async function sendTelegram(text) {
    try {
        await axios.post(TELEGRAM_URL, {
            chat_id: CHAT_ID,
            text,
            parse_mode: "HTML"
        });
    } catch (e) {
        console.log("Telegram:", e.message);
    }
}

// ================= API =================

async function getTop50() {

    const { data } = await axios.get(
        `${OKX}/api/v5/market/tickers?instType=SWAP`
    );

    return data.data
        .filter(x => x.last && x.open24h)
        .map(x => {

            const change24 =
                ((Number(x.last) - Number(x.open24h)) / Number(x.open24h)) * 100;

            return {
                symbol: x.instId,
                change24
            };
        })
        .sort((a, b) => Math.abs(b.change24) - Math.abs(a.change24))
        .slice(0, 50);
}

async function getCandles(symbol, bar, limit) {

    const { data } = await axios.get(
        `${OKX}/api/v5/market/candles`,
        {
            params: {
                instId: symbol,
                bar,
                limit
            }
        }
    );

    return data.data;
}

function percent(open, close) {
    return ((close - open) / open) * 100;
}

// ================= MAIN =================

async function checkCoin(symbol, change24) {

    // 5m cần 2 cây
    const candles5 = await getCandles(symbol, "5m", 2);

    if (candles5.length < 2) return;

    const c5 = candles5[0];

    const open5 = Number(c5[1]);
    const close5 = Number(c5[4]);

    const change5 = percent(open5, close5);

    if (change5 <= 3) return;

    // 2h = 1 cây 2H
    const candles2h = await getCandles(symbol, "2H", 1);

    if (candles2h.length === 0) return;

    const c2 = candles2h[0];

    const change2h = percent(
        Number(c2[1]),
        Number(c2[4])
    );

    if (change2h >= 10) return;

    if (change24 >= 25) return;

    if (wasSentRecently(symbol)) return;

    const msg =
`🟢 Buy

Coin : <b>${symbol}</b>

5m : <b>${change5.toFixed(2)}%</b>
2H : <b>${change2h.toFixed(2)}%</b>
24H : <b>${change24.toFixed(2)}%</b>`;

    await sendTelegram(msg);

    markSent(symbol);
}

async function main() {

    try {

        const top50 = await getTop50();

        // Chạy tuần tự để tránh lỗi 429
        for (const coin of top50) {

            await checkCoin(
                coin.symbol,
                coin.change24
            );

            // Delay giữa các request
            await new Promise(r => setTimeout(r, 180));
        }

    } catch (e) {

        console.log(e.message);

    }
}

main();
