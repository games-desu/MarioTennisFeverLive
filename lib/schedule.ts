// YouTube収集の時間帯別スケジュール（JST）。アプリ内の唯一の定義。
// 注意: Supabase pg_cron の17ジョブ（mtf-yt-wd-* 9本 / mtf-yt-we-* 8本）と一致必須。
// 時間帯を変更するときは cron.schedule 側も同時に更新すること。
//
// 2026-09-07 平日／土日を分離（20260907_weekend_schedule.sql）。実測40日ぶんより:
//   ・土日の13〜18時は平日の約5倍（平均同時配信数 0.32 vs 0.06）。Twitch側でも同方向。
//   ・逆に土日の深夜0〜4時と23時は平日より静か。
//   → 土日は 12〜18時を60分→20分に強化し、原資は深夜0〜4時と23時から回収（83回/日）。
//     平日は据え置き（90回/日）。昼帯10-18時の平均掲載遅延は土日 24.8分 → 14.6分。
//
// 2026-08-19 時間帯別の再配分（20260819_schedule_tuning.sql）。
//   ※日中60分化に伴い、セッション分割のギャップ閾値はYouTubeのみ70分
//     （channel_recent_streams / channel_kpi_ranks / stream_sessions）。
//     土日も5〜12時に60分帯が残るため、この閾値は据え置きで正しい。

/** 平日か土日か。cron の曜日指定と同じく JST の暦日で判定する（祝日は対象外）。 */
export type DayType = "weekday" | "weekend";

export interface ScheduleBand {
  range: string; // 表示用の時間帯ラベル
  every: number; // 取得間隔（分）
  count: number; // この帯の1日の収集回数
  hours: number[]; // この帯に属するJSTの時（0〜23）
}

// 平日（JST 月〜金）: 2026-08-19 の配分のまま。
export const YT_SCHEDULE_WEEKDAY: ScheduleBand[] = [
  { range: "21:00〜翌1:00（ピーク）", every: 5, count: 48, hours: [21, 22, 23, 0] },
  { range: "20:00〜21:00", every: 10, count: 6, hours: [20] },
  { range: "18:00〜20:00", every: 15, count: 8, hours: [18, 19] },
  { range: "13:00〜18:00", every: 60, count: 5, hours: [13, 14, 15, 16, 17] },
  { range: "12:00〜13:00（お昼）", every: 15, count: 4, hours: [12] },
  { range: "5:00〜12:00", every: 60, count: 7, hours: [5, 6, 7, 8, 9, 10, 11] },
  { range: "1:00〜5:00（深夜）", every: 20, count: 12, hours: [1, 2, 3, 4] },
];

// 土日（JST 土日）: 昼を厚く、深夜を薄く。
export const YT_SCHEDULE_WEEKEND: ScheduleBand[] = [
  { range: "21:00〜23:00（ピーク）", every: 5, count: 24, hours: [21, 22] },
  { range: "23:00〜翌1:00", every: 10, count: 12, hours: [23, 0] },
  { range: "20:00〜21:00", every: 10, count: 6, hours: [20] },
  { range: "18:00〜20:00", every: 15, count: 8, hours: [18, 19] },
  { range: "12:00〜18:00（昼）", every: 20, count: 18, hours: [12, 13, 14, 15, 16, 17] },
  { range: "5:00〜12:00", every: 60, count: 7, hours: [5, 6, 7, 8, 9, 10, 11] },
  { range: "1:00〜5:00（深夜）", every: 30, count: 8, hours: [1, 2, 3, 4] },
];

export function ytSchedule(dayType: DayType): ScheduleBand[] {
  return dayType === "weekend" ? YT_SCHEDULE_WEEKEND : YT_SCHEDULE_WEEKDAY;
}

export function ytDailyCaptures(dayType: DayType): number {
  return ytSchedule(dayType).reduce((s, b) => s + b.count, 0);
}

export const YT_UNITS_PER_CAPTURE = 102; // search.list 1ページ(100) + videos.list(1) + 取りこぼし補完のvideos.list(0〜2)
export const YT_DAILY_QUOTA = 10000; // YouTube Data API の1日上限
// クォータのリセットはPT深夜0時＝JST16:00。曜日で配分を変えると「JST16:00→翌16:00」の
// 窓ごとに回数が変わるため、上限判定はこの最大値（平日→平日の90回＝9,180u）で見る。
export const YT_MAX_CAPTURES_PER_QUOTA_DAY = 90;
export const TW_EXPECTED_MIN = 2; // Twitch は終日2分間隔（mtf-collect-twitch）

export function currentJstHour(): number {
  return (
    Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Tokyo",
        hour: "2-digit",
        hour12: false,
      }).format(new Date()),
    ) % 24
  );
}

/** いまが平日か土日か（JSTの暦日。cron の dow 指定と同じ基準）。 */
export function currentJstDayType(): DayType {
  const dow = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    weekday: "short",
  }).format(new Date());
  return dow === "Sat" || dow === "Sun" ? "weekend" : "weekday";
}

export function ytExpectedMin(jstHour: number, dayType: DayType = "weekday"): number {
  return ytSchedule(dayType).find((b) => b.hours.includes(jstHour))?.every ?? 30;
}

// JSTの「今日0:00」をUTCのDateで返す（当日分の集計用）
export function jstTodayStartUtc(): Date {
  const jstNow = new Date(Date.now() + 9 * 3600 * 1000);
  return new Date(
    Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate()) - 9 * 3600 * 1000,
  );
}
