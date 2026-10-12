// Pure model for ActivityHeatmap: UTC days, levels, weeks-as-columns, month labels.
export type HeatDay = { date: string; count: number };
export type HeatCell = { date: string; count: number; level: number; col: number; row: number; inRange: boolean };

const DAY = 86_400_000;
export const parseUTC = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
export const fmtUTC = (t: number) => new Date(t).toISOString().slice(0, 10);

export function buildModel(days: HeatDay[], { thresholds, weekStartsOn = 0, locale = "en-US" }: { thresholds?: number[]; weekStartsOn?: 0 | 1; locale?: string } = {}) {
  const counts = new Map<string, number>();
  for (const d of days) counts.set(d.date, (counts.get(d.date) ?? 0) + d.count);
  const dates = days.map((d) => parseUTC(d.date)).sort((a, b) => a - b);
  const min = dates[0] ?? Date.now();
  const max = dates[dates.length - 1] ?? Date.now();
  const busiest = Math.max(0, ...counts.values());
  const th = thresholds ?? [1, Math.max(2, Math.ceil(busiest * 0.25)), Math.max(3, Math.ceil(busiest * 0.5)), Math.max(4, Math.ceil(busiest * 0.75))];
  const levelOf = (c: number) => (c <= 0 ? 0 : c >= th[3] ? 4 : c >= th[2] ? 3 : c >= th[1] ? 2 : 1);
  const startDow = (new Date(min).getUTCDay() - weekStartsOn + 7) % 7;
  const start = min - startDow * DAY;
  const cells: HeatCell[] = [];
  let total = 0;
  for (let t = start, i = 0; t <= max; t += DAY, i++) {
    const date = fmtUTC(t);
    const inRange = t >= min;
    const count = inRange ? (counts.get(date) ?? 0) : 0;
    if (inRange) total += count;
    cells.push({ date, count, level: inRange ? levelOf(count) : 0, col: Math.floor(i / 7), row: i % 7, inRange });
  }
  const cols = (cells[cells.length - 1]?.col ?? 0) + 1;
  // month labels at the first column containing the 1st of a month; drop a cramped first label
  const months: { col: number; label: string }[] = [];
  const mf = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
  for (const c of cells) if (c.inRange && c.date.endsWith("-01")) months.push({ col: c.col, label: mf.format(parseUTC(c.date)) });
  if (!months.length || months[0].col > 0) months.unshift({ col: 0, label: mf.format(min) });
  if (months.length > 1 && months[1].col - months[0].col < 3) months.shift();
  const perLevel = [0, 0, 0, 0, 0];
  for (const c of cells) if (c.inRange) perLevel[c.level]++;
  const ranges = [
    [0, 0],
    [th[0], th[1] - 1],
    [th[1], th[2] - 1],
    [th[2], th[3] - 1],
    [th[3], Infinity],
  ] as [number, number][];
  return { cells, cols, months, total, perLevel, ranges, busiest };
}
