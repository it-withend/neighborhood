import { TASHKENT, aqiBand, pmToAqi, classify, advice, bestWindow, loadForecast, digest, hh } from "./core.js";
import { LANGS, makeT } from "./i18n.js";

const GEO_API = "https://geocoding-api.open-meteo.com/v1/search";
// Public Telegram channel with the daily 07:00 post (see bot/daily.mjs). Leave empty to hide the link.
const TELEGRAM_CHANNEL = "";
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

function detectLang() {
  const saved = store.get("lang", null);
  if (LANGS.includes(saved)) return saved;
  const nav = (navigator.language || "en").slice(0, 2);
  return LANGS.includes(nav) ? nav : "en";
}

const state = {
  lang: detectLang(),
  persona: store.get("persona", "kids"),
  place: store.get("place", { ...TASHKENT, isDefault: true }),
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

      const pct = Math.max(7, Math.min(100, ((h.aqi ?? 0) / 200) * 100));
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
  const clock = state.data.clock;
  const pts = clock.filter((p) => p.aqi != null);
  if (pts.length < 12) {
    $("clock").replaceChildren();
    $("clock-insight").textContent = "";
    $("clock-school").textContent = "";
    return;
  }

  const W = 480, H = 210, L = 34, R = 12, T = 16, B = 28;
  const yMax = Math.max(150, Math.ceil(Math.max(...pts.map((p) => p.aqi)) / 50) * 50);
  const x = (hour) => L + (hour / 23) * (W - L - R);
  const y = (aqi) => T + (1 - aqi / yMax) * (H - T - B);

  const linePts = pts.map((p) => `${x(p.hour).toFixed(1)},${y(p.aqi).toFixed(1)}`);
  const area = `M${x(pts[0].hour)},${y(0)} L${linePts.join(" L")} L${x(pts.at(-1).hour)},${y(0)} Z`;

  const grid = [];
  for (let v = 50; v <= yMax; v += 50) {
    grid.push(`<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`);
  }
  const axis = [0, 6, 12, 18, 23]
    .map((h) => `<text x="${x(h)}" y="${H - 8}" text-anchor="middle">${hh(h).slice(0, 2)}</text>`)
    .join("");

  // walk to school: the hour before lessons start and the first lesson hour
  const ws = Math.max(0, state.school.start - 1);
  const we = Math.min(23, state.school.start + 1);
  const schoolBand = `<rect class="school-band" x="${x(ws)}" y="${T}" width="${x(we) - x(ws)}" height="${H - T - B}"/>` +
    `<text class="school-band-label" x="${(x(ws) + x(we)) / 2}" y="${T - 4}" text-anchor="middle">${hh(ws)}–${hh(we)}</text>`;

  const nowHour = Number(state.data.nowTime.slice(11, 13));
  const now = `<g class="now"><line x1="${x(nowHour)}" x2="${x(nowHour)}" y1="${T}" y2="${H - B}"/>` +
    `<text x="${x(nowHour) + 4}" y="${H - B - 6}">${t("clockNow")}</text></g>`;

  const day = pts.filter((p) => p.hour >= 6 && p.hour <= 21);
  const worst = day.reduce((a, b) => (b.pm25 > a.pm25 ? b : a));
  const best = day.reduce((a, b) => (b.pm25 < a.pm25 ? b : a));
  const dots = `<circle class="dot-worst" cx="${x(worst.hour)}" cy="${y(worst.aqi)}" r="5"/><circle class="dot-best" cx="${x(best.hour)}" cy="${y(best.aqi)}" r="5"/>`;

  $("clock").innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${t("clockSub")}">` +
    `<g class="grid">${grid.join("")}</g>${schoolBand}` +
    `<path class="area" d="${area}"/><polyline class="line" points="${linePts.join(" ")}"/>` +
    `${now}${dots}<g class="axis">${axis}</g></svg>`;

  const ratio = best.pm25 > 0 ? worst.pm25 / best.pm25 : null;
  $("clock-insight").textContent =
    ratio && ratio >= 1.3 ? t("clockInsight", { worst: hh(worst.hour), best: hh(best.hour), x: ratio.toFixed(1) }) : "";

  const walk = clock.filter((p) => p.hour >= ws && p.hour < we && p.pm25 != null);
  const walkPm = walk.reduce((s, p) => s + p.pm25, 0) / (walk.length || 1);
  const walkAqi = pmToAqi(walkPm);
  $("clock-school").textContent = walk.length
    ? t("clockSchool", { range: `${hh(ws)}–${hh(we)}`, aqi: walkAqi, band: t("band" + aqiBand(walkAqi)).toLowerCase() })
    : "";
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
}

function render() {
  applyStaticText();
  document.querySelectorAll('input[name="who"]').forEach((r) => (r.checked = r.value === state.persona));
  if (!state.data) return;
  const v = renderHero();
  renderHours();
  renderAdvice(v);
  renderClock();
  renderShare();
}

// ---------- Data ----------

async function choosePlace(place) {
  state.place = place;
  store.set("place", place);
  $("results").hidden = true;
  togglePanel(false);
  applyStaticText();
  setStatus(t("loading"));
  try {
    state.data = await loadForecast(place);
    setStatus("");
    render();
  } catch (err) {
    console.error(err);
    setStatus(t("errLoad"), true);
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

render();
choosePlace(state.place);
