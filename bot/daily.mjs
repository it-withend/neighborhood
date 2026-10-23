// Daily morning post for a Telegram channel or group (run by .github/workflows/daily-post.yml).
// Uses the same decision logic as the website.
//
// Env:
//   TELEGRAM_BOT_TOKEN  bot token from @BotFather (GitHub secret)
//   TELEGRAM_CHAT_ID    channel "@name" or chat id (GitHub secret)
//   SITE_URL            link added to the post
//   NAFAS_LANG          uz | ru | en (default uz)
//   NAFAS_LAT/NAFAS_LON/NAFAS_PLACE  location (default Tashkent)
// Without a token it prints the message instead of sending it (dry run).

import { TASHKENT, loadForecast, digest } from "../core.js";
import { makeT } from "../i18n.js";

const env = process.env;
const lang = env.NAFAS_LANG || "uz";
const t = makeT(lang);
const place = {
  lat: Number(env.NAFAS_LAT || TASHKENT.lat),
  lon: Number(env.NAFAS_LON || TASHKENT.lon),
};
const placeName = env.NAFAS_PLACE || { uz: "Toshkent", ru: "Ташкент", en: "Tashkent" }[lang];

const data = await loadForecast(place);
const text = digest(t, data, placeName, env.SITE_URL || "");

if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
  console.log("Dry run (no TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID):\n");
  console.log(text);
} else {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
  });
  const body = await res.json();
  if (!body.ok) {
    console.error("Telegram error:", body.description);
    process.exit(1);
  }
  console.log("Posted:\n" + text);
}
