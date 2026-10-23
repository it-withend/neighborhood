// Deployment settings. Fill these in after creating the Telegram bot and channel.

// Bot username without "@", e.g. "nafas_tashkent_bot". Empty: smoke reports are shared as a Telegram message instead.
export const BOT_USERNAME = "";

// Public channel link for the daily 07:00 post, e.g. "https://t.me/nafas_tashkent". Empty: the link is hidden.
export const TELEGRAM_CHANNEL = "";

// Where the site reads neighbour reports. The collector job commits reports.json to the repo,
// and raw.githubusercontent.com serves the latest commit without a Pages redeploy.
export const REPORTS_URL = "https://raw.githubusercontent.com/it-withend/neighborhood/main/reports.json";
