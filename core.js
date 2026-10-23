// Nafas core: data loading and decision logic.
// Shared by the web app (app.js) and the daily Telegram post (bot/daily.mjs),
// so it must not touch the DOM.

const AIR_API = "https://air-quality-api.open-meteo.com/v1/air-quality";
const WX_API = "https://api.open-meteo.com/v1/forecast";

export const TASHKENT = { name: "Tashkent", lat: 41.311, lon: 69.28 };

// Who is going outside. Air limits are US AQI values; temperatures are "feels like" °C.
// Children are a sensitive group in EPA guidance, but healthy kids still get the
// general limits for short outdoor time; sensitive people get stricter ones.
export const PERSONAS = {
  kids: { caution: 100, stay: 150, cold: -15, heat: 32 },
  sensitive: { caution: 50, stay: 100, cold: -10, heat: 30 },
  everyone: { caution: 100, stay: 150, cold: -20, heat: 35 },
};

// PM2.5 (µg/m³) to US AQI, EPA breakpoints revised in 2024.
const PM_BREAKS = [
  [0, 9.0, 0, 50],
  [9.1, 35.4, 51, 100],
  [35.5, 55.4, 101, 150],
  [55.5, 125.4, 151, 200],
  [125.5, 225.4, 201, 300],
  [225.5, 325.4, 301, 500],
];

export function pmToAqi(pm) {
  if (pm == null || Number.isNaN(pm)) return null;
  const c = Math.floor(pm * 10) / 10;
  for (const [cl, ch, il, ih] of PM_BREAKS) {
    if (c <= ch) return Math.round(((ih - il) / (ch - cl)) * (Math.max(c, cl) - cl) + il);
  }
  return 500;
}

// 0 good, 1 moderate, 2 unhealthy for sensitive groups, 3 unhealthy, 4 very unhealthy, 5 hazardous
export function aqiBand(aqi) {
  if (aqi == null) return null;
  const i = [50, 100, 150, 200, 300].findIndex((max) => aqi <= max);
  return i === -1 ? 5 : i;
}

// Returns { level: 0 go | 1 limit | 2 stay inside, reasons: [{ level, key, vars }] }.
export function classify(h, persona) {
  const p = PERSONAS[persona];
  const reasons = [];
  let level = 0;
  const add = (l, key, vars = {}) => {
    level = Math.max(level, l);
    reasons.push({ level: l, key, vars });
  };

  if (h.aqi != null) {
    if (h.aqi > p.stay) add(2, "rAirStay", { aqi: h.aqi });
    else if (h.aqi > p.caution) add(1, "rAirCaution", { aqi: h.aqi });
  }
  if (h.feels != null) {
    const t = Math.round(h.feels);
    if (h.feels < p.cold) add(2, "rCold", { t });
    else if (h.feels < p.cold + 5) add(1, "rCool", { t });
    if (h.feels > p.heat) add(2, "rHot", { t });
    else if (h.feels > p.heat - 4) add(1, "rWarm", { t });
  }
  if (h.precip != null) {
    if (h.precip >= 1) add(2, "rRain", { p: h.precip.toFixed(1) });
    else if (h.precip > 0.1) add(1, "rDrizzle");
  }
  if (h.wind != null) {
    const w = Math.round(h.wind);
    if (h.wind > 14) add(2, "rWind", { w });
    else if (h.wind > 10) add(1, "rBreezy", { w });
  }
  if (!reasons.length) reasons.push({ level: 0, key: "rAllGood", vars: {} });
  reasons.sort((a, b) => b.level - a.level);
  return { level, reasons };
}

// What to do right now, as i18n keys.
export function advice(level, persona, aqi) {
  const keys = [];
  keys.push(["aVentOpen", "aVentShort", "aWindowsClosed"][level]);
  if (persona === "kids") keys.push(["aKidsGo", "aKidsShort", "aKidsInside"][level]);
  else if (persona === "sensitive") keys.push(["aGo", "aSensShort", "aInside"][level]);
  else keys.push(["aGo", "aShort", "aInside"][level]);
  if (level === 2 && aqi > PERSONAS[persona].stay) keys.push("aMask");
  if (persona === "sensitive" && level > 0) keys.push("aInhaler");
  if (aqiBand(aqi) >= 2) keys.push("aNoBurning");
  return keys;
}

// Longest run of hours at the best available level, within today's daytime.
export function bestWindow(hours, persona, fromHour = 7, toHour = 21) {
  const day = hours.filter((h) => h.hour >= fromHour && h.hour < toHour);
  for (const level of [0, 1]) {
    let best = null;
    let run = null;
    for (const h of day) {
      if (classify(h, persona).level === level) {
        run = run && run.end === h.hour ? { ...run, end: h.hour + 1 } : { start: h.hour, end: h.hour + 1 };
        if (!best || run.end - run.start > best.end - best.start) best = run;
      } else {
        run = null;
      }
    }
    if (best) return { ...best, level };
  }
  return null;
}

// Average air quality for each hour of the day over the past days ("smog clock").
export function smogClock(past) {
  const sums = Array.from({ length: 24 }, () => ({ sum: 0, n: 0 }));
  for (const h of past) {
    if (h.pm25 == null) continue;
    sums[h.hour].sum += h.pm25;
    sums[h.hour].n += 1;
  }
  return sums.map((s, hour) => {
    const pm25 = s.n ? s.sum / s.n : null;
    return { hour, pm25, aqi: pmToAqi(pm25) };
  });
}

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

export async function loadForecast(place) {
  const q = `latitude=${place.lat}&longitude=${place.lon}&timezone=auto`;
  const [air, wx] = await Promise.all([
    getJSON(`${AIR_API}?${q}&past_days=7&forecast_days=2&hourly=pm2_5&current=pm2_5`),
    getJSON(
      `${WX_API}?${q}&forecast_days=2&wind_speed_unit=ms` +
        `&hourly=apparent_temperature,precipitation,wind_speed_10m` +
        `&current=apparent_temperature,precipitation,wind_speed_10m`
    ),
  ]);

  const nowTime = wx.current.time.slice(0, 13) + ":00";
  const pmByTime = new Map(air.hourly.time.map((t, i) => [t, air.hourly.pm2_5[i]]));

  const past = air.hourly.time
    .map((t, i) => ({ time: t, hour: Number(t.slice(11, 13)), pm25: air.hourly.pm2_5[i] }))
    .filter((h) => h.time < nowTime);

  const upcoming = wx.hourly.time
    .map((t, i) => {
      const pm25 = pmByTime.get(t) ?? null;
      return {
        time: t,
        hour: Number(t.slice(11, 13)),
        date: t.slice(0, 10),
        pm25,
        aqi: pmToAqi(pm25),
        feels: wx.hourly.apparent_temperature[i],
        precip: wx.hourly.precipitation[i],
        wind: wx.hourly.wind_speed_10m[i],
      };
    })
    .filter((h) => h.time >= nowTime)
    .slice(0, 24);

  const currentPm = air.current?.pm2_5 ?? upcoming[0]?.pm25 ?? null;
  return {
    nowTime: wx.current.time,
    today: wx.current.time.slice(0, 10),
    current: {
      pm25: currentPm,
      aqi: pmToAqi(currentPm),
      feels: wx.current.apparent_temperature,
      precip: wx.current.precipitation,
      wind: wx.current.wind_speed_10m,
    },
    upcoming,
    clock: smogClock(past),
  };
}

export const hh = (h) => String(h).padStart(2, "0") + ":00";

// Plain-text summary for Telegram chats and the daily channel post.
export function digest(t, data, placeName, url) {
  const c = data.current;
  const today = data.upcoming.filter((h) => h.date === data.today);
  const lines = [
    t("digestHead", { place: placeName, date: data.today }),
    t("digestNow", { aqi: c.aqi ?? "—", band: t("band" + aqiBand(c.aqi)) }),
    "",
  ];
  for (const persona of ["kids", "sensitive", "everyone"]) {
    const v = classify(c, persona);
    const w = bestWindow(today, persona);
    const when = w ? `${hh(w.start)}–${hh(w.end)}` : t("digestNoWindow");
    lines.push(`${["🟢", "🟡", "🔴"][v.level]} ${t("p_" + persona)}: ${t("verdict" + v.level)}. ${t("digestBest")} ${when}`);
  }
  if (url) lines.push("", url);
  return lines.join("\n");
}
