import axios from "axios";
import fs from "fs";

const BOT_TOKEN = process.env.BOT_TOKEN || "BOT_TOKEN";
const CHAT_ID = process.env.CHAT_ID || "CHAT_ID";

const TELEGRAM_URL = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

const CACHE_FILE = "./sent_cache.json";

// ===========================
// Cache
// ===========================
function loadCache() {
  if (!fs.existsSync(CACHE_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

function cleanCache(cache) {
  const now = Date.now();
  for (const coin in cache) {
    if (now - cache[coin] > 2 * 60 * 60 * 1000) {
      delete cache[coin];
    }
  }
}

const cache = loadCache();
cleanCache(cache);

// ===========================
// Telegram
// ===========================
async function sendTelegram(text) {
  await axios.post(TELEGRAM_URL, {
    chat_id: CHAT_ID,
    text,
    parse_mode: "HTML",
  });
}

// ===========================
// Get Top 50 Futures
// ===========================
async function getTop50() {
  const url =
    "https://www.okx.com/api/v5/market/tickers?instType=SWAP";

  const res = await axios.get(url);

  return res.data.data
    .filter((c) => c.instId.endsWith("-USDT-SWAP"))
    .sort(
      (a, b) =>
        Math.abs(parseFloat(b.change24h)) -
        Math.abs(parseFloat(a.change24h))
    )
    .slice(0, 50);
}

// ===========================
// Get Candles
// ===========================
async function getCandles(instId, bar, limit = 2) {
  const url = `https://www.okx.com/api/v5/market/history-candles?instId=${instId}&bar=${bar}&limit=${limit}`;
  const res = await axios.get(url);
  return res.data.data;
}

// ===========================
// Calculate Change
// ===========================
function percent(open, close) {
  return ((close - open) / open) * 100;
}

// ===========================
// Main
// ===========================
async function main() {
  try {
    const coins = await getTop50();

    for (const coin of coins) {
      try {
        const symbol = coin.instId;

        // ---------- 5m ----------
        const c5 = await getCandles(symbol, "5m", 2);

        if (c5.length < 2) continue;

        const open5 = parseFloat(c5[1][1]);
        const close5 = parseFloat(c5[0][4]);

        const change5 = percent(open5, close5);

        if (change5 <= 3) continue;

        // ---------- 4H ----------
        const c4h = await getCandles(symbol, "4H", 2);

        if (c4h.length < 2) continue;

        const open4 = parseFloat(c4h[1][1]);
        const close4 = parseFloat(c4h[0][4]);

        const change4 = percent(open4, close4);

        if (change4 >= 10) continue;

        // ---------- Duplicate within 2h ----------
        if (
          cache[symbol] &&
          Date.now() - cache[symbol] < 2 * 60 * 60 * 1000
        ) {
          continue;
        }

        const price = parseFloat(coin.last).toFixed(6);

        const msg =
`🚀 Buy

Coin: <b>${symbol}</b>

Price: ${price}

5m: +${change5.toFixed(2)}%
4H: +${change4.toFixed(2)}%`;

        await sendTelegram(msg);

        cache[symbol] = Date.now();
        saveCache(cache);

      } catch (e) {
        console.log("Skip:", coin.instId);
      }
    }
  } catch (err) {
    console.error(err.message);
  }
}

main();
