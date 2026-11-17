import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const username = process.env.GITHUB_USERNAME;
const outputPath = process.env.OUTPUT_PATH ?? "dist/contribution-candles.svg";
const dayMs = 24 * 60 * 60 * 1000;
const daysToShow = 31;

if (!username || !/^[A-Za-z0-9-]+$/.test(username)) {
  throw new Error("GITHUB_USERNAME must be a valid GitHub username.");
}

const today = new Date();
today.setUTCHours(0, 0, 0, 0);

const days = Array.from({ length: daysToShow }, (_, index) => {
  const date = new Date(today.getTime() - (daysToShow - index - 1) * dayMs);
  return {
    date,
    key: date.toISOString().slice(0, 10),
    count: 0,
  };
});

const dayCounts = new Map(days.map((day) => [day.key, 0]));
const contributionUrl = new URL(`https://github-contributions-api.jogruber.de/v4/${username}`);
contributionUrl.searchParams.set("y", "last");

const response = await fetch(contributionUrl);
if (!response.ok) {
  const details = (await response.text()).slice(0, 300);
  throw new Error(`GitHub contributions API returned ${response.status}: ${details}`);
}

const contributionData = await response.json();
if (!Array.isArray(contributionData.contributions)) {
  throw new Error("GitHub contributions API returned an unexpected response.");
}

for (const contribution of contributionData.contributions) {
  if (
    typeof contribution.date !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/.test(contribution.date)
    || !Number.isInteger(contribution.count)
    || contribution.count < 0
  ) {
    throw new Error("GitHub contributions API returned an invalid daily contribution.");
  }
  if (dayCounts.has(contribution.date)) {
    dayCounts.set(contribution.date, contribution.count);
  }
}

const chartDays = days.map((day) => ({ ...day, count: dayCounts.get(day.key) }));
const chartWidth = 1200;
const chartHeight = 390;
const left = 74;
const right = 28;
const top = 88;
const bottom = 320;
const plotHeight = bottom - top;
const plotWidth = chartWidth - left - right;
const maxCount = Math.max(4, Math.ceil(Math.max(...chartDays.map((day) => day.count)) / 4) * 4);
const xStep = plotWidth / (daysToShow - 1);
const bodyWidth = Math.min(18, xStep * 0.55);
const valueToY = (value) => bottom - (value / maxCount) * plotHeight;
const grid = Array.from({ length: 5 }, (_, index) => {
  const value = (maxCount * (4 - index)) / 4;
  const y = valueToY(value);
  return `<line x1="${left}" y1="${y}" x2="${chartWidth - right}" y2="${y}" stroke="#ffffff" stroke-opacity="0.16"/><text x="${left - 12}" y="${y + 4}" fill="#ffffff" font-size="12" text-anchor="end">${value}</text>`;
}).join("");

const dateLabel = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const candles = chartDays.map((day, index) => {
  const previousCount = index === 0 ? day.count : chartDays[index - 1].count;
  const openY = valueToY(previousCount);
  const closeY = valueToY(day.count);
  const highY = Math.min(openY, closeY);
  const lowY = Math.max(openY, closeY);
  const x = left + index * xStep;
  const color = day.count >= previousCount ? "#3fb950" : "#f85149";
  const wickTop = Math.max(top, highY - 4);
  const wickBottom = Math.min(bottom, lowY + 4);
  const bodyHeight = Math.max(5, Math.abs(closeY - openY));
  const bodyY = (openY + closeY - bodyHeight) / 2;
  const candle = `<line x1="${x}" y1="${wickTop}" x2="${x}" y2="${wickBottom}" stroke="${color}" stroke-width="2"/><rect x="${x - bodyWidth / 2}" y="${bodyY}" width="${bodyWidth}" height="${bodyHeight}" rx="2" fill="${color}"><title>${day.key}: ${day.count} contributions</title></rect>`;
  const label = index % 5 === 0 || index === daysToShow - 1
    ? `<text x="${x}" y="${bottom + 28}" fill="#ffffff" font-size="12" text-anchor="middle">${dateLabel.format(day.date)}</text>`
    : "";
  return candle + label;
}).join("");

const subtitle = "Daily GitHub contributions · candle color compares with previous day";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${chartWidth}" height="${chartHeight}" viewBox="0 0 ${chartWidth} ${chartHeight}" role="img" aria-labelledby="title description">
  <title id="title">GitHub Contribution Activity</title>
  <desc id="description">Candlestick-inspired daily contribution counts for the last 31 days. Green indicates contributions increased from the previous day; red indicates they decreased.</desc>
  <text x="${chartWidth / 2}" y="34" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="22" font-weight="600" text-anchor="middle">GitHub Contribution Activity</text>
  <text x="${chartWidth / 2}" y="58" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="13" text-anchor="middle">${subtitle}</text>
  ${grid}
  <line x1="${left}" y1="${bottom}" x2="${chartWidth - right}" y2="${bottom}" stroke="#ffffff" stroke-opacity="0.35"/>
  ${candles}
</svg>`;

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, svg, "utf8");
console.log(`Generated ${outputPath} using GitHub contribution data for ${username}.`);
