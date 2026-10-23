import {
  TASHKENT, aqiBand, classify, advice, bestWindow, loadForecast, digest, hh, nextWalk,
  REPORT_TYPES, DISTRICTS, reportPayload, summarizeReports,
} from "./core.js";
import { LANGS, makeT } from "./i18n.js";
import { BOT_USERNAME, TELEGRAM_CHANNEL, REPORTS_URL } from "./config.js";
import { clockSvg } from "./charts.js";

const GEO_API = "https://geocoding-api.open-meteo.com/v1/search";
const SITE_URL = location.origin + location.pathname;
const CITY_NAMES = { uz: "Toshkent", ru: "Ташкент", en: "Tashkent" };

const $ = (id) => document.getElementById(id);

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem("nafas:" + key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem("nafas:" + key, JSON.stringify(value));
    } catch {
      /* storage blocked: preferences just won't persist */
    }
  },
};

// Links can preselect things, e.g. ?lang=uz&who=sensitive or ?lat=..&lon=..&name=..
const params = new URLSearchParams(location.search);

function detectLang() {
  if (LANGS.includes(params.get("lang"))) return params.get("lang");
  const saved = store.get("lang", null);
  if (LANGS.includes(saved)) return saved;
  const nav = (navigator.language || "en").slice(0, 2);
  return LANGS.includes(nav) ? nav : "en";
}

const state = {
  lang: detectLang(),
  persona: ["kids", "sensitive", "everyone"].includes(params.get("who")) ? params.get("who") : store.get("persona", "kids"),
  place: params.has("lat")
    ? { name: params.get("name") || "", lat: Number(params.get("lat")), lon: Number(params.get("lon")) }
    : store.get("place", { ...TASHKENT, isDefault: true }),
  reports: [],
  reportType: "leaves",
  reportDistrict: store.get("district", "chilonzor"),
  school: { start: 8, end: 14, ...store.get("school", {}) },
  data: null,
};
let t = makeT(state.lang);

const placeName = () => (state.place.isDefault ? CITY_NAMES[state.lang] : state.place.name);

function setStatus(msg, isError = false) {
  $("status").textContent = msg || "";
  $("status").classList.toggle("error", isError);
}

function applyStaticText() {
  t = makeT(state.lang);
  document.documentElement.lang = state.lang;
  document.title = t("pageTitle");
  document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => (el.placeholder = t(el.dataset.i18nPh)));
  document.querySelectorAll("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === state.lang)));
  $("place-label").textContent = placeName();
  $("hero-place").textContent = placeName();
}

// Shape + colour for each level, so the answer never depends on colour alone.
const MARKS = [
  `<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="19" fill="var(--go)"/><path d="M11 20.5l6 6 12-13" fill="none" stroke="var(--paper)" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  `<svg viewBox="0 0 40 40"><path d="M20 2 39 37H1z" fill="var(--limit)"/><path d="M20 15v10" stroke="var(--paper)" stroke-width="4.5" stroke-linecap="round"/><circle cx="20" cy="31" r="2.6" fill="var(--paper)"/></svg>`,
  `<svg viewBox="0 0 40 40"><path d="M12 1h16l11 11v16L28 39H12L1 28V12z" fill="var(--stay)"/><path d="M11 20h18" stroke="var(--paper)" stroke-width="5" stroke-linecap="round"/></svg>`,
];

// ---------- Rendering ----------

function renderHero() {
  const d = state.data;
  const c = d.current;
  const haze = Math.min(1, Math.max(0, ((c.pm25 ?? 0) - 5) / 60));
  $("sky").style.setProperty("--haze", haze.toFixed(2));
  $("hero-time").textContent = "· " + t("asOf", { time: d.nowTime.slice(11, 16) });
  $("aqi-num").textContent = c.aqi ?? "—";
  $("aqi-band").textContent = c.aqi != null ? t("band" + aqiBand(c.aqi)) : "";
  $("pm-line").textContent = t("pmLine", {
    pm: c.pm25 != null ? Math.round(c.pm25) : "—",
    feels: Math.round(c.feels),
    wind: Math.round(c.wind),
  });

  const v = classify(c, state.persona);
  $("verdict-mark").innerHTML = MARKS[v.level];
  $("verdict-text").textContent = t("verdict" + v.level);
  $("reasons").replaceChildren(
    ...v.reasons.map((r) => {
      const li = document.createElement("li");
      li.textContent = t(r.key, r.vars);
      return li;
    })
  );
  return v;
}

function renderHours() {
  const d = state.data;
  const today = d.upcoming.filter((h) => h.date === d.today);
  const w = bestWindow(today, state.persona);
  const range = w && `${hh(w.start)}–${hh(w.end)}`;
  $("best").innerHTML = "";
  if (!w) $("best").textContent = t("noBest");
  else {
    const [before, after] = t(w.level === 0 ? "best" : "bestShort", { range: "\u0000" }).split("\u0000");
    const b = document.createElement("b");
    b.textContent = range;
    $("best").append(before, b, after);
  }

  $("hours").replaceChildren(
    ...d.upcoming.map((h, i) => {
      const v = classify(h, state.persona);
      const isToday = h.date === d.today;
      const li = document.createElement("li");
      li.className = [
        "lv" + v.level,
        i === 0 && "is-now",
        isToday && h.hour >= state.school.start && h.hour < state.school.end && "is-school",
        w && isToday && h.hour >= w.start && h.hour < w.end && "is-best",
      ]
        .filter(Boolean)
        .join(" ");
      li.setAttribute("aria-label", t("hourAria", { h: hh(h.hour), aqi: h.aqi ?? "—", verdict: t("verdict" + v.level) }));
      li.title = v.reasons.map((r) => t(r.key, r.vars)).join(" ");

      const pct = Math.max(7, Math.min(86, ((h.aqi ?? 0) / 250) * 100));
      li.innerHTML = `<div class="col" aria-hidden="true"><span class="val"></span><div class="bar-v"></div></div><span class="sch" aria-hidden="true"></span><span class="t" aria-hidden="true"></span>`;
      li.querySelector(".bar-v").style.height = pct + "%";
      const val = li.querySelector(".val");
      val.textContent = h.aqi ?? "";
      val.style.bottom = `calc(${pct}% + 4px)`;
      const tl = li.querySelector(".t");
      tl.textContent = String(h.hour).padStart(2, "0");
      if (i === 0 || h.hour === 0) {
        const s = document.createElement("small");
        s.textContent = i === 0 ? "●" : h.date.slice(8, 10) + "." + h.date.slice(5, 7);
        tl.append(s);
      }
      return li;
    })
  );
}

function renderAdvice(v) {
  $("advice").replaceChildren(
    ...advice(v.level, state.persona, state.data.current.aqi).map((key) => {
      const li = document.createElement("li");
      li.textContent = t(key);
      return li;
    })
  );
}

function renderClock() {
  const c = clockSvg(state.data, { t, schoolStart: state.school.start });
  $("clock").innerHTML = c ? c.svg : "";
  $("clock-insight").textContent = c?.insight ?? "";
  $("clock-school").textContent = c?.school ?? "";
}

function renderWalk() {
  const walk = nextWalk(state.data, state.school.start);
  $("walk").hidden = !walk;
  if (!walk) return;
  const v = classify(walk.worst, state.persona);
  $("walk").className = "walk lv" + v.level;
  $("walk-mark").innerHTML = MARKS[v.level];
  $("walk-title").textContent = t(walk.isToday ? "walkToday" : "walkTomorrow");
  $("walk-line").textContent = t("walkLine", { range: `${hh(walk.from)}–${hh(walk.to)}`, aqi: walk.worst.aqi ?? "—" });
  $("walk-tip").textContent = t("walkTip" + v.level);
}

function renderShare() {
  const text = digest(t, state.data, placeName(), "");
  $("digest").textContent = text + "\n" + SITE_URL;
  state.shareText = text + "\n" + SITE_URL;
  const enc = encodeURIComponent;
  $("tg-share").href = `https://t.me/share/url?url=${enc(SITE_URL)}&text=${enc(text)}`;
  const c = state.data.current;
  const alert = t("alertText", { aqi: c.aqi ?? "—", band: t("band" + aqiBand(c.aqi)).toLowerCase(), url: "" }).trim();
  $("tg-alert").href = `https://t.me/share/url?url=${enc(SITE_URL)}&text=${enc(alert)}`;
  $("tg-channel").hidden = !TELEGRAM_CHANNEL;
  if (TELEGRAM_CHANNEL) $("tg-channel").href = TELEGRAM_CHANNEL;
  const q = new URLSearchParams({ lang: state.lang, start: state.school.start });
  if (!state.place.isDefault) q.set("lat", state.place.lat), q.set("lon", state.place.lon), q.set("name", state.place.name);
  $("poster").href = "poster.html?" + q;
}

// ---------- Smoke reports ----------

function renderReportForm() {
  $("report-types").replaceChildren(
    ...REPORT_TYPES.map((type) => {
      const label = document.createElement("label");
      label.innerHTML = `<input type="radio" name="rtype"><span></span>`;
      const input = label.querySelector("input");
      input.value = type;
      input.checked = type === state.reportType;
      input.addEventListener("change", () => {
        state.reportType = type;
        renderReportLink();
      });
      label.querySelector("span").textContent = t("rt_" + type);
      return label;
    })
  );
  $("report-district").replaceChildren(
    ...Object.entries(DISTRICTS).map(([slug, names]) => {
      const o = document.createElement("option");
      o.value = slug;
      o.textContent = names[state.lang];
      o.selected = slug === state.reportDistrict;
      return o;
    })
  );
  renderReportLink();
}

function renderReportLink() {
  const { reportType: type, reportDistrict: district } = state;
  if (BOT_USERNAME) {
    $("report-send").href = `https://t.me/${BOT_USERNAME}?start=${reportPayload(type, district)}`;
  } else {
    // No bot configured yet: share the report as a message to any chat instead.
    const time = new Date().toTimeString().slice(0, 5);
    const text = t("reportShare", { type: t("rt_" + type).toLowerCase(), district: DISTRICTS[district][state.lang], time, url: "" }).trim();
    $("report-send").href = `https://t.me/share/url?url=${encodeURIComponent(SITE_URL)}&text=${encodeURIComponent(text)}`;
  }
}

function renderReports() {
  const groups = summarizeReports(state.reports);
  $("reports-empty").hidden = groups.length > 0;
  const max = Math.max(1, ...groups.map((g) => g.count));
  $("reports-list").replaceChildren(
    ...groups.map((g) => {
      const li = document.createElement("li");
      li.innerHTML = `<div class="rep-head"><b></b><span></span></div><div class="rep-bar"><i></i></div><p class="rep-types"></p>`;
      li.querySelector("b").textContent = DISTRICTS[g.district][state.lang];
      li.querySelector(".rep-head span").textContent = t("reportsTotal", { n: g.count });
      li.querySelector(".rep-bar i").style.width = (g.count / max) * 100 + "%";
      li.querySelector(".rep-types").textContent = Object.entries(g.types)
        .sort((a, b) => b[1] - a[1])
        .map(([type, n]) => `${t("rt_" + type)} ×${n}`)
        .join(" · ");
      return li;
    })
  );
}

async function loadReports() {
  state.reports = [];
  // Latest commit first; the copy deployed with the site is the fallback.
  for (const url of [REPORTS_URL, "reports.json"]) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      state.reports = (await res.json()).reports || [];
      break;
    } catch (err) {
      console.warn("Reports unavailable from", url, err.message);
    }
  }
  renderReports();
}

function render() {
  applyStaticText();
  document.querySelectorAll('input[name="who"]').forEach((r) => (r.checked = r.value === state.persona));
  renderReportForm();
  renderReports();
  if (!state.data) return;
  const v = renderHero();
  renderWalk();
  renderHours();
  renderAdvice(v);
  renderClock();
  renderShare();
}

// ---------- Data ----------

async function choosePlace(place, { persist = true } = {}) {
  state.place = place;
  if (persist) store.set("place", place);
  $("results").hidden = true;
  togglePanel(false);
  applyStaticText();
  setStatus(t("loading"));
  const cacheKey = `forecast:${place.lat},${place.lon}`;
  try {
    state.data = await loadForecast(place);
    store.set(cacheKey, state.data);
    setStatus("");
    render();
  } catch (err) {
    console.error(err);
    const cached = store.get(cacheKey, null);
    if (cached) {
      // Offline: show the last saved forecast and say how old it is.
      state.data = cached;
      render();
      setStatus(t("offlineNote", { time: cached.nowTime.slice(11, 16) }), true);
    } else {
      setStatus(t("errLoad"), true);
    }
  }
}

async function searchCity(name) {
  setStatus(t("searching"));
  try {
    const res = await fetch(`${GEO_API}?name=${encodeURIComponent(name)}&count=6&language=${state.lang}`);
    const list = (await res.json()).results || [];
    if (!list.length) return setStatus(t("notFound"), true);
    setStatus("");
    $("results").replaceChildren(
      ...list.map((r) => {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = [r.name, r.admin1, r.country].filter(Boolean).join(", ");
        b.addEventListener("click", () => choosePlace({ name: r.name, lat: r.latitude, lon: r.longitude }));
        li.append(b);
        return li;
      })
    );
    $("results").hidden = false;
  } catch (err) {
    console.error(err);
    setStatus(t("errLoad"), true);
  }
}

// ---------- Wiring ----------

function togglePanel(open) {
  $("place-panel").hidden = !open;
  $("place-btn").setAttribute("aria-expanded", String(open));
  if (open) $("city").focus();
}

$("place-btn").addEventListener("click", () => togglePanel($("place-panel").hidden));

$("search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("city").value.trim();
  if (name) searchCity(name);
});

$("geo").addEventListener("click", () => {
  if (!navigator.geolocation) return setStatus(t("errGeo"), true);
  setStatus(t("loading"));
  navigator.geolocation.getCurrentPosition(
    (pos) => choosePlace({ name: t("myLocation"), lat: +pos.coords.latitude.toFixed(3), lon: +pos.coords.longitude.toFixed(3) }),
    () => setStatus(t("errGeo"), true),
    { timeout: 10000 }
  );
});

document.querySelectorAll("[data-lang]").forEach((b) =>
  b.addEventListener("click", () => {
    state.lang = b.dataset.lang;
    store.set("lang", state.lang);
    render();
  })
);

document.querySelectorAll('input[name="who"]').forEach((r) =>
  r.addEventListener("change", () => {
    state.persona = r.value;
    store.set("persona", state.persona);
    render();
  })
);

$("s-start").value = state.school.start;
$("s-end").value = state.school.end;
["s-start", "s-end"].forEach((id) =>
  $(id).addEventListener("change", () => {
    const start = Number($("s-start").value);
    const end = Number($("s-end").value);
    if (Number.isFinite(start) && Number.isFinite(end) && start < end) {
      state.school = { start, end };
      store.set("school", state.school);
      render();
    }
  })
);

$("copy").addEventListener("click", async () => {
  if (!state.shareText) return;
  try {
    await navigator.clipboard.writeText(state.shareText);
    $("copied").textContent = t("copied");
  } catch {
    $("copied").textContent = t("copyFail");
    getSelection()?.selectAllChildren($("digest"));
  }
});

$("report-district").addEventListener("change", (e) => {
  state.reportDistrict = e.target.value;
  store.set("district", state.reportDistrict);
  renderReportLink();
});

// Install as an app (Android/desktop Chrome); iOS uses "Add to Home Screen" from the share menu.
let installPrompt = null;
addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  $("install").hidden = false;
});
$("install").addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $("install").hidden = true;
});

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW:", e.message));
}

render();
choosePlace(state.place, { persist: !params.has("lat") });
loadReports();
