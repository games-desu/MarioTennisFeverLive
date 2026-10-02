import { NextResponse } from "next/server";
import { createPublicClient } from "@/lib/supabase";
import {
  currentJstHour,
  currentJstDayType,
  ytExpectedMin,
  TW_EXPECTED_MIN,
} from "@/lib/schedule";

// 外形監視（UptimeRobot等）用のヘルスチェック。認証不要・匿名キーの読み取りのみ。
// 収集(YouTube/Twitch)とエンリッチが止まっていたら 503 を返す。
// Supabase のログ量を抑えるため、最新時刻は health_snapshot RPC 1本でまとめて取る。
export const dynamic = "force-dynamic";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

interface Snapshot {
  youtube: string | null;
  twitch: string | null;
  enrich_day: string | null;
}

export async function GET() {
  const supabase = createPublicClient();

  const { data, error } = await supabase.rpc("health_snapshot");
  if (error || !data) {
    return NextResponse.json(
      { ok: false, checks: [{ name: "db", ok: false, detail: error?.message ?? "応答なし" }] },
      { status: 503 },
    );
  }
  const snap = data as Snapshot;

  const checks: Check[] = [];

  // 収集: 最終収集からの経過が想定間隔×3（=2回連続スキップ相当）を超えたら異常。
  // 管理画面の停止警告と同じしきい値。
  function captureCheck(name: string, iso: string | undefined, expectedMin: number) {
    if (!iso) {
      checks.push({ name, ok: false, detail: "収集データがありません" });
      return;
    }
    const ageMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    checks.push({
      name,
      ok: ageMin <= expectedMin * 3,
      detail: `最終収集 ${ageMin}分前（想定間隔 ${expectedMin}分）`,
    });
  }
  captureCheck(
    "collect-youtube",
    snap.youtube ?? undefined,
    ytExpectedMin(currentJstHour(), currentJstDayType()),
  );
  captureCheck("collect-twitch", snap.twitch ?? undefined, TW_EXPECTED_MIN);

  // エンリッチ: 1日1回（JST17:30）。最新日がJSTの前日より古ければ1回以上飛んでいる。
  const latestDay = snap.enrich_day ?? undefined;
  if (!latestDay) {
    checks.push({ name: "enrich", ok: false, detail: "エンリッチデータがありません" });
  } else {
    const jstToday = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(
      new Date(),
    ); // "YYYY-MM-DD"
    const diffDays = Math.round(
      (new Date(jstToday).getTime() - new Date(latestDay).getTime()) / 86400000,
    );
    checks.push({
      name: "enrich",
      ok: diffDays <= 1,
      detail: `最新データ ${latestDay}（${diffDays}日前）`,
    });
  }

  const ok = checks.every((c) => c.ok);
  return NextResponse.json({ ok, checks }, { status: ok ? 200 : 503 });
}
