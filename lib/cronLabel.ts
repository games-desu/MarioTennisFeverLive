// 管理画面のジョブ稼働状況用: pg_cron のスケジュール（UTC）を日本語（JST）に読み替える。
// ジョブ名だけでは「いつ動くか」が分からないため、cron 式から説明・前回予定・次回予定を出す。
// 対応する書式は pg_cron で使っている範囲（* / */n / a-b / a-b/n / リスト）。

const JST_OFFSET_MS = 9 * 3600 * 1000;
const MIN_MS = 60 * 1000;
const DOW_JA = ["日", "月", "火", "水", "木", "金", "土"];

function parseField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart ? Number(stepPart) : 1;
    let lo = min;
    let hi = max;
    if (rangePart !== "*") {
      const [a, b] = rangePart.split("-").map(Number);
      lo = a;
      hi = b ?? (stepPart ? max : a);
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

interface Cron {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
}

function parseCron(expr: string): Cron | null {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return null;
  try {
    const dow = parseField(f[4], 0, 7);
    if (dow.has(7)) dow.add(0);
    return {
      minute: parseField(f[0], 0, 59),
      hour: parseField(f[1], 0, 23),
      dom: parseField(f[2], 1, 31),
      month: parseField(f[3], 1, 12),
      dow,
    };
  } catch {
    return null;
  }
}

// pg_cron は UTC で判定する（日・曜日の両方が指定された場合の OR 規則は使っていないので AND で扱う）
function matches(c: Cron, utcMs: number): boolean {
  const d = new Date(utcMs);
  return (
    c.minute.has(d.getUTCMinutes()) &&
    c.hour.has(d.getUTCHours()) &&
    c.dom.has(d.getUTCDate()) &&
    c.month.has(d.getUTCMonth() + 1) &&
    c.dow.has(d.getUTCDay())
  );
}

function hoursLabel(hours: number[]): string {
  // 連続する時をまとめる（例: 12,13,14 → 12〜14時台）
  const runs: [number, number][] = [];
  for (const h of hours) {
    const last = runs[runs.length - 1];
    if (last && last[1] === h - 1) last[1] = h;
    else runs.push([h, h]);
  }
  return runs.map(([a, b]) => (a === b ? `${a}時台` : `${a}〜${b}時台`)).join("・");
}

function daysLabel(dows: number[]): string {
  const key = dows.join(",");
  if (key === "0,1,2,3,4,5,6") return "毎日";
  if (key === "1,2,3,4,5") return "平日";
  if (key === "0,6") return "土日";
  return dows.map((d) => DOW_JA[d]).join("");
}

/** cron 式（UTC）→「土日 21〜22時台 5分ごと」のような JST の説明。読めない式はそのまま返す。 */
export function describeCronJst(expr: string): string {
  const c = parseCron(expr);
  if (!c) return expr;
  // 基準の1週間（2026-09-07 月 0:00 JST から）を1分ずつなめて、JST の曜日・時・分に写す
  const start = Date.UTC(2026, 8, 7) - JST_OFFSET_MS;
  const dows = new Set<number>();
  const hourMinutes = new Map<number, Set<number>>();
  for (let t = start; t < start + 7 * 1440 * MIN_MS; t += MIN_MS) {
    if (!matches(c, t)) continue;
    const j = new Date(t + JST_OFFSET_MS);
    dows.add(j.getUTCDay());
    const h = j.getUTCHours();
    if (!hourMinutes.has(h)) hourMinutes.set(h, new Set());
    hourMinutes.get(h)!.add(j.getUTCMinutes());
  }
  if (dows.size === 0) return expr;

  const days = daysLabel([...dows].sort((a, b) => a - b));
  const hours = [...hourMinutes.keys()].sort((a, b) => a - b);
  const minuteSets = [...hourMinutes.values()].map((s) => [...s].sort((a, b) => a - b).join(","));
  const sameMinutes = minuteSets.every((m) => m === minuteSets[0]);
  const mins = [...hourMinutes.get(hours[0])!].sort((a, b) => a - b);

  if (hours.length === 24 && sameMinutes && mins.length > 1) {
    return `${days} 終日 ${mins[1] - mins[0]}分ごと`;
  }
  if (sameMinutes && mins.length === 1) {
    const mm = String(mins[0]).padStart(2, "0");
    if (hours.length === 1) return `${days} ${hours[0]}:${mm}`;
    return `${days} ${hoursLabel(hours)} 毎時${mm}分`;
  }
  if (sameMinutes) {
    const gaps = mins.map((m, i) => (i === 0 ? mins[0] + 60 - mins[mins.length - 1] : m - mins[i - 1]));
    if (gaps.every((g) => g === gaps[0])) return `${days} ${hoursLabel(hours)} ${gaps[0]}分ごと`;
  }
  return `${days} ${hoursLabel(hours)}`;
}

/** 直近の実行予定時刻（now − 猶予 以前で最も新しいもの）。8日以内に無ければ null。 */
export function lastScheduledRun(expr: string, now = Date.now(), graceMin = 10): number | null {
  const c = parseCron(expr);
  if (!c) return null;
  let t = Math.floor((now - graceMin * MIN_MS) / MIN_MS) * MIN_MS;
  for (let i = 0; i < 8 * 1440; i++, t -= MIN_MS) if (matches(c, t)) return t;
  return null;
}

/** 次の実行予定時刻。8日以内に無ければ null。 */
export function nextScheduledRun(expr: string, now = Date.now()): number | null {
  const c = parseCron(expr);
  if (!c) return null;
  let t = Math.floor(now / MIN_MS) * MIN_MS + MIN_MS;
  for (let i = 0; i < 8 * 1440; i++, t += MIN_MS) if (matches(c, t)) return t;
  return null;
}

/** ジョブ名 → 何をするジョブか。 */
export function jobPurpose(jobname: string): string {
  if (jobname.startsWith("mtf-yt-")) return "YouTube収集";
  if (jobname === "mtf-collect-twitch") return "Twitch収集";
  if (jobname === "mtf-enrich") return "チャンネル情報の更新（登録者数など）";
  if (jobname === "mtf-prune") return "古いデータの掃除";
  return "";
}
