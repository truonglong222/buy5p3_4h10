import axios from "axios";
import fs from "fs";

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

const STATE_FILE = "./state.json";
const COOLDOWN = 2 * 60 * 60 * 1000;

// ================= STATE =================
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ================= TELEGRAM =================
async function sendTelegram(text) {
  await axios.post(
    `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
    {
      chat_id: CHAT_ID,
      text,
      parse_mode: "Markdown"
    }
  );
}

// ================= COOLDOWN =================
function canSend(lastTime) {
  if (!lastTime) return true;
  return Date.now() - lastTime > COOLDOWN;
}

// ================= OKX TICKERS =================
async function getTickers() {
  const res = await axios.get(
    "https://www.okx.com/api/v5/market/tickers?instType=SPOT"
  );

  return res.data.data || [];
}

// ================= CHANGE =================
async function getChange(instId, bar) {
  const res = await axios.get(
    `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=2`
  );

  const d = res.data.data;

  if (!d || d.length < 2) return null;

  const open = Number(d[1][1]);
  const close = Number(d[0][4]);

  if (open === 0) return null;

  return ((close - open) / open) * 100;
}

// ================= MAIN =================
async function run() {
  const state = loadState();

  const tickers = await getTickers();

  // Chỉ lấy coin tăng >7% trong 24h
  const usdtCoins = tickers
    .filter(t => t.instId.endsWith("-USDT"))
    .map(t => {
      const last = Number(t.last);
      const open24h = Number(t.open24h);

      const change24h =
        open24h > 0
          ? ((last - open24h) / open24h) * 100
          : 0;

      return {
        instId: t.instId,
        change24h
      };
    })
    .filter(c => c.change24h > 7)
    .sort((a, b) => b.change24h - a.change24h);

  let alerts = [];

  for (const coin of usdtCoins) {
    const symbol = coin.instId;

    try {
      // 15 phút > 2%
      const chg15m = await getChange(symbol, "15m");

      if (chg15m === null || chg15m <= 2) continue;

      // Biến động 2 giờ
      const chg2h = await getChange(symbol, "2H");

      if (chg2h === null) continue;

      // Điều kiện mới:
      // -5 < (2h - 15m) < +5
      const diff = chg2h - chg15m;

      if (diff <= -5 || diff >= 5) continue;

      // Cooldown 2 giờ
      if (!canSend(state[symbol])) continue;

      alerts.push({
        symbol,
        change24h: coin.change24h,
        chg15m,
        chg2h,
        diff
      });

      state[symbol] = Date.now();

    } catch (e) {
      continue;
    }
  }

  saveState(state);

  if (alerts.length === 0) return;

  let msg = `🚨 *OKX ALERT (>7% 24H)*\n\n`;

  for (const a of alerts) {
    msg += `🪙 ${a.symbol}\n`;
    msg += `24h: +${a.change24h.toFixed(2)}%\n`;
    msg += `15m: +${a.chg15m.toFixed(2)}%\n`;
    msg += `2h: ${a.chg2h.toFixed(2)}%\n`;
    msg += `2h-15m: ${a.diff.toFixed(2)}%\n\n`;
  }

  await sendTelegram(msg);
}

run();
