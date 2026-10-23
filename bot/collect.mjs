// Collects anonymous smoke reports sent to the Nafas Telegram bot and stores them in reports.json.
// Run by .github/workflows/collect-reports.yml every 15 minutes, so no server is needed.
//
// A report arrives as "/start smoke_<type>_<district>" from the site's deep link.
// Only the type, district and time are stored: no user ids, names or chat ids.
//
// Env: TELEGRAM_BOT_TOKEN (GitHub secret), SITE_URL.

import { readFile, writeFile } from "node:fs/promises";
import { DISTRICTS, parseReportPayload } from "../core.js";
import { makeT } from "../i18n.js";

const FILE = new URL("../reports.json", import.meta.url);
const KEEP_DAYS = 7;
const token = process.env.TELEGRAM_BOT_TOKEN;
const siteUrl = process.env.SITE_URL || "";

if (!token) {
  console.log("No TELEGRAM_BOT_TOKEN, nothing to collect.");
  process.exit(0);
}

const api = async (method, params) => {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`${method}: ${body.description}`);
  return body.result;
};

const store = JSON.parse(await readFile(FILE, "utf8"));
const updates = await api("getUpdates", { offset: store.lastUpdateId + 1, allowed_updates: ["message"], timeout: 0 });

let added = 0;
for (const u of updates) {
  store.lastUpdateId = Math.max(store.lastUpdateId, u.update_id);
  const msg = u.message;
  if (!msg?.text) continue;

  const lang = ["uz", "ru"].includes(msg.from?.language_code) ? msg.from.language_code : "en";
  const t = makeT(lang);
  const [cmd, payload] = msg.text.trim().split(/\s+/, 2);
  const report = cmd === "/start" ? parseReportPayload(payload) : null;

  if (report) {
    store.reports.push({ t: new Date(msg.date * 1000).toISOString(), ...report });
    added += 1;
    await api("sendMessage", {
      chat_id: msg.chat.id,
      text: t("botThanks", { type: t("rt_" + report.type).toLowerCase(), district: DISTRICTS[report.district][lang] }),
    }).catch((e) => console.warn(e.message));
  } else {
    await api("sendMessage", { chat_id: msg.chat.id, text: t("botHello", { url: siteUrl }) }).catch((e) => console.warn(e.message));
  }
}

const cutoff = Date.now() - KEEP_DAYS * 24 * 3600 * 1000;
store.reports = store.reports.filter((r) => Date.parse(r.t) >= cutoff);

await writeFile(FILE, JSON.stringify(store, null, 2) + "\n");
console.log(`Updates: ${updates.length}, new reports: ${added}, stored: ${store.reports.length}`);
