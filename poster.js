// Printable A4 poster for a school entrance or staff room: today's answers, the walk to school,
// the smog clock and a QR code to the live site.

import { TASHKENT, aqiBand, classify, bestWindow, loadForecast, hh, nextWalk } from "./core.js";
import { LANGS, makeT } from "./i18n.js";
import { clockSvg } from "./charts.js";

const params = new URLSearchParams(location.search);
const lang = LANGS.includes(params.get("lang")) ? params.get("lang") : "uz";
const t = makeT(lang);
const schoolStart = Number(params.get("start")) || 8;
const place = params.has("lat")
  ? { lat: Number(params.get("lat")), lon: Number(params.get("lon")), name: params.get("name") || "" }
  : { ...TASHKENT, name: { uz: "Toshkent", ru: "Ташкент", en: "Tashkent" }[lang] };
const siteUrl = new URL("./", location.href).href;

const $ = (id) => document.getElementById(id);
const MARK = ["●", "▲", "■"];

document.documentElement.lang = lang;
document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
$("print").addEventListener("click", () => print());

const data = await loadForecast(place);
const c = data.current;
const today = data.upcoming.filter((h) => h.date === data.today);

$("p-place").textContent = `${place.name} · ${data.today.split("-").reverse().join(".")}`;
$("p-title").textContent = t("posterTitle");
$("p-now").textContent = `AQI ${c.aqi ?? "—"} · ${t("band" + aqiBand(c.aqi))} · ${t("asOf", { time: data.nowTime.slice(11, 16) })}`;

$("p-groups").replaceChildren(
  ...["kids", "sensitive", "everyone"].map((persona) => {
    const v = classify(c, persona);
    const w = bestWindow(today, persona);
    const li = document.createElement("li");
    li.className = "lv" + v.level;
    li.innerHTML = `<span class="g-mark" aria-hidden="true"></span><span class="g-who"></span><b class="g-verdict"></b><span class="g-best"></span>`;
    li.querySelector(".g-mark").textContent = MARK[v.level];
    li.querySelector(".g-who").textContent = t("p_" + persona);
    li.querySelector(".g-verdict").textContent = t("verdict" + v.level);
    li.querySelector(".g-best").textContent = `${t("digestBest")} ${w ? `${hh(w.start)}–${hh(w.end)}` : t("digestNoWindow")}`;
    return li;
  })
);

const walk = nextWalk(data, schoolStart);
if (walk) {
  const v = classify(walk.worst, "kids");
  $("p-walk").className = "sheet-walk lv" + v.level;
  $("p-walk").innerHTML = `<span class="g-mark" aria-hidden="true"></span><div><h2></h2><p class="w-line"></p><p></p></div>`;
  $("p-walk").querySelector(".g-mark").textContent = MARK[v.level];
  $("p-walk").querySelector("h2").textContent = t(walk.isToday ? "walkToday" : "walkTomorrow");
  $("p-walk").querySelector(".w-line").textContent = t("walkLine", { range: `${hh(walk.from)}–${hh(walk.to)}`, aqi: walk.worst.aqi ?? "—" });
  $("p-walk").querySelector("p:last-child").textContent = t("walkTip" + v.level);
}

const clock = clockSvg(data, { t, schoolStart, width: 640, height: 220 });
$("p-clock-title").textContent = t("clockTitle");
$("p-clock").innerHTML = clock?.svg ?? "";
$("p-clock-insight").textContent = clock?.insight ?? "";

if (window.qrcode) {
  const qr = qrcode(0, "M");
  qr.addData(siteUrl);
  qr.make();
  $("p-qr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}
$("p-scan").textContent = t("posterScan");
$("p-url").textContent = siteUrl.replace(/^https?:\/\//, "");
const now = new Date();
$("p-printed").textContent = t("posterPrinted", {
  date: now.toLocaleDateString("ru-RU"),
  time: now.toTimeString().slice(0, 5),
});
