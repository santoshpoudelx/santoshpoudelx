import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const username = process.env.GITHUB_USERNAME;
const outputDir = process.env.OUTPUT_DIR ?? ".";
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
const contributionsByDate = new Map();
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
  contributionsByDate.set(contribution.date, contribution);
  if (dayCounts.has(contribution.date)) {
    dayCounts.set(contribution.date, contribution.count);
  }
}

if (contributionsByDate.size === 0) {
  throw new Error("GitHub contributions API returned no daily contributions.");
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

const allContributions = [...contributionsByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
const calendarStart = new Date(`${allContributions[0].date}T00:00:00Z`);
calendarStart.setUTCDate(calendarStart.getUTCDate() - calendarStart.getUTCDay());
const cellSize = 12;
const cellGap = 4;
const cellStep = cellSize + cellGap;
const gridLeft = 58;
const gridTop = 52;
const calendarPositions = allContributions.map((contribution) => {
  const date = new Date(`${contribution.date}T00:00:00Z`);
  const dayOffset = Math.round((date.getTime() - calendarStart.getTime()) / dayMs);
  return {
    ...contribution,
    week: Math.floor(dayOffset / 7),
    row: date.getUTCDay(),
  };
});
const weekCount = Math.max(...calendarPositions.map((day) => day.week)) + 1;
const gridWidth = gridLeft + weekCount * cellStep;
const snakeWidth = Math.max(1000, gridWidth + 28);
const snakeHeight = gridTop + 7 * cellStep + 28;
const contributionPalette = ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"];
const heatmapCells = calendarPositions.map((day) => {
  const level = Number.isInteger(day.level) && day.level >= 0 && day.level < contributionPalette.length
    ? day.level
    : 0;
  const x = gridLeft + day.week * cellStep;
  const y = gridTop + day.row * cellStep;
  return `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="3" fill="${contributionPalette[level]}"><title>${day.date}: ${day.count} contributions</title></rect>`;
}).join("");
const monthLabels = calendarPositions
  .filter((day) => day.date.endsWith("-01"))
  .map((day) => {
    const x = gridLeft + day.week * cellStep;
    const label = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" })
      .format(new Date(`${day.date}T00:00:00Z`));
    return `<text x="${x}" y="${gridTop - 14}" fill="#ffffff" font-size="12">${label}</text>`;
  })
  .join("");
const weekdayLabels = [
  { row: 1, label: "Mon" },
  { row: 3, label: "Wed" },
  { row: 5, label: "Fri" },
].map(({ row, label }) => (
  `<text x="${gridLeft - 10}" y="${gridTop + row * cellStep + 10}" fill="#ffffff" font-size="11" text-anchor="end">${label}</text>`
)).join("");
const snakeRoute = [
  [5, 3], [6, 3], [7, 3], [8, 3], [9, 3], [9, 4], [10, 4], [11, 4],
  [12, 4], [13, 4], [13, 3], [14, 3], [15, 3], [16, 3], [16, 2],
  [17, 2], [18, 2], [19, 2], [20, 2],
];
const snakePoints = snakeRoute.map(([week, row]) => [
  gridLeft + week * cellStep + cellSize / 2,
  gridTop + row * cellStep + cellSize / 2,
]);
const snakePath = snakePoints.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x} ${y}`).join(" ");
const [headX, headY] = snakePoints[snakePoints.length - 1];
const appleX = headX + cellStep;
const appleY = headY;
const snapshotDate = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
}).format(today);
const snakeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${snakeWidth}" height="${snakeHeight}" viewBox="0 0 ${snakeWidth} ${snakeHeight}" role="img" aria-labelledby="snake-title snake-description">
  <title id="snake-title">Static contribution snake</title>
  <desc id="snake-description">A contribution heatmap for the past year with a stationary snake winding across the grid. Snapshot through ${snapshotDate}.</desc>
  <text x="${snakeWidth / 2}" y="22" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="17" font-weight="600" text-anchor="middle">Contribution Snake · Static Snapshot</text>
  ${monthLabels}
  ${weekdayLabels}
  ${heatmapCells}
  <path d="${snakePath}" fill="none" stroke="#39d353" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="${headX}" cy="${headY}" r="6" fill="#39d353"/>
  <circle cx="${headX + 2}" cy="${headY - 2}" r="1.2" fill="#0d1117"/>
  <circle cx="${headX + 2}" cy="${headY + 2}" r="1.2" fill="#0d1117"/>
  <path d="M${appleX} ${appleY + 4}a5 5 0 1 1 0-8a5 5 0 0 1 0 8" fill="#f85149"/>
  <path d="M${appleX} ${appleY - 5}q2-4 5-2q-1 3-5 3" fill="#39d353"/>
</svg>`;

await mkdir(outputDir, { recursive: true });
await Promise.all([
  writeFile(join(outputDir, "contribution-candles.svg"), svg, "utf8"),
  writeFile(join(outputDir, "contribution-snake.svg"), snakeSvg, "utf8"),
]);
console.log(`Generated static contribution charts for ${username} in ${outputDir}.`);
