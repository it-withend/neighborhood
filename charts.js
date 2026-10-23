// "Smog clock" chart: average air for each hour of the day over the past week.
// Shared by the main page and the printable poster.

import { aqiBand, pmToAqi, hh } from "./core.js";

// Returns { svg, insight, school } or null when there isn't enough history.
export function clockSvg(data, { t, schoolStart = 8, width = 480, height = 210 }) {
  const clock = data.clock;
  const pts = clock.filter((p) => p.aqi != null);
  if (pts.length < 12) return null;

  const W = width, H = height, L = 34, R = 12, T = 18, B = 28;
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
  const ws = Math.max(0, schoolStart - 1);
  const we = Math.min(23, schoolStart + 1);
  const schoolBand =
    `<rect class="school-band" x="${x(ws)}" y="${T}" width="${x(we) - x(ws)}" height="${H - T - B}"/>` +
    `<text class="school-band-label" x="${(x(ws) + x(we)) / 2}" y="${T - 5}" text-anchor="middle">${hh(ws)}–${hh(we)}</text>`;

  const nowHour = Number(data.nowTime.slice(11, 13));
  const now =
    `<g class="now"><line x1="${x(nowHour)}" x2="${x(nowHour)}" y1="${T}" y2="${H - B}"/>` +
    `<text x="${x(nowHour) + 4}" y="${H - B - 6}">${t("clockNow")}</text></g>`;

  const day = pts.filter((p) => p.hour >= 6 && p.hour <= 21);
  const worst = day.reduce((a, b) => (b.pm25 > a.pm25 ? b : a));
  const best = day.reduce((a, b) => (b.pm25 < a.pm25 ? b : a));
  const dots =
    `<circle class="dot-worst" cx="${x(worst.hour)}" cy="${y(worst.aqi)}" r="5"/>` +
    `<circle class="dot-best" cx="${x(best.hour)}" cy="${y(best.aqi)}" r="5"/>`;

  const svg =
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${t("clockSub")}">` +
    `<g class="grid">${grid.join("")}</g>${schoolBand}` +
    `<path class="area" d="${area}"/><polyline class="line" points="${linePts.join(" ")}"/>` +
    `${now}${dots}<g class="axis">${axis}</g></svg>`;

  const ratio = best.pm25 > 0 ? worst.pm25 / best.pm25 : null;
  const insight =
    ratio && ratio >= 1.3 ? t("clockInsight", { worst: hh(worst.hour), best: hh(best.hour), x: ratio.toFixed(1) }) : "";

  const walk = clock.filter((p) => p.hour >= ws && p.hour < we && p.pm25 != null);
  const walkAqi = walk.length ? pmToAqi(walk.reduce((s, p) => s + p.pm25, 0) / walk.length) : null;
  const school =
    walkAqi != null
      ? t("clockSchool", { range: `${hh(ws)}–${hh(we)}`, aqi: walkAqi, band: t("band" + aqiBand(walkAqi)).toLowerCase() })
      : "";

  return { svg, insight, school, worst, best };
}
