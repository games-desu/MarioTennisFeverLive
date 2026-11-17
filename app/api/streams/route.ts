import { NextResponse } from "next/server";
import { createPublicClient } from "@/lib/supabase";
import { isGameId } from "@/lib/games";

export const dynamic = "force-dynamic";

// CDN（Vercel Edge）に持たせるキャッシュ。
//   max-age=0                 … ブラウザには持たせない（毎回CDNに聞きに行く）
//   s-maxage=60               … CDNは60秒そのまま返す＝この間は関数が動かない
//   stale-while-revalidate    … 期限切れ後も古い内容を即返し、裏で1回だけ取り直す
// 収集自体が Twitch 2分・YouTube 5〜60分間隔なので、60秒足しても体感の鮮度は変わらない。
// 誰でも同じ内容を返す公開APIなので、利用者ごとに出し分ける心配はない。
const CACHE_CONTROL = "public, max-age=0, s-maxage=60, stale-while-revalidate=300";

// 現在配信中の一覧を返す（current_streams ビューから）。
// ?game=fever|aces|mt64 でタイトル絞り込み（未指定=全タイトル）。
// ユーザーのアクセスでは外部APIを一切叩かず、Supabaseのキャッシュ済みデータのみ返す。
export async function GET(request: Request) {
  const gRaw = new URL(request.url).searchParams.get("game");
  const game = isGameId(gRaw) ? gRaw : null;

  const supabase = createPublicClient();
  let query = supabase.from("current_streams").select("*");
  if (game) query = query.eq("game", game);

  // 5本の問い合わせは互いに依存しないので同時に投げる（以前は1本ずつ待っていた）。
  //   latest_capture             … 最新取得時刻（0件の回でも正しい時刻を返すため）
  //   latest_capture_by_platform … PF別の最新取得時刻（YouTube と Twitch は収集間隔が異なる）
  //   today_viewer_stats         … 本日ピーク・前回比（▲▼）。1行だけ
  //   current_stream_badges      … 連続配信日数・配信開始検知時刻・視聴者トレンド
  const [
    { data, error },
    { data: lc },
    { data: lcp },
    { data: stats, error: statsErr },
    { data: badges, error: badgeErr },
  ] = await Promise.all([
    query,
    supabase.from("latest_capture").select("captured_at").maybeSingle(),
    supabase.from("latest_capture_by_platform").select("platform, captured_at"),
    supabase.rpc("today_viewer_stats", { p_game: game }),
    supabase.rpc("current_stream_badges"),
  ]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const capByPf = new Map<string, string>(
    (lcp ?? []).map((r) => [r.platform as string, r.captured_at as string]),
  );

  if (statsErr) console.error("[streams] today_viewer_stats失敗:", statsErr.message);
  const st = Array.isArray(stats) ? stats[0] : stats;

  // 集計に失敗してもバッジ無しで一覧は返す（badges を null 扱いにするだけ）。
  if (badgeErr) console.error("[streams] current_stream_badges失敗:", badgeErr.message);
  const badgeMap = new Map<
    string,
    { started_at: string | null; streak_days: number | null; trend: string | null }
  >();
  for (const b of badges ?? []) {
    badgeMap.set(`${b.platform}:${b.channel_id}`, {
      started_at: b.started_at ?? null,
      streak_days: b.streak_days ?? null,
      trend: b.trend ?? null,
    });
  }
  const withBadges = (rows: typeof data) =>
    (rows ?? []).map((r) => ({ ...r, ...(badgeMap.get(`${r.platform}:${r.channel_id}`) ?? {}) }));

  const capturedAt = lc?.captured_at ?? data?.[0]?.captured_at ?? null;
  const youtube = withBadges((data ?? []).filter((r) => r.platform === "youtube"));
  const twitch = withBadges((data ?? []).filter((r) => r.platform === "twitch"));

  return NextResponse.json(
    {
      captured_at: capturedAt,
      captured_at_youtube: capByPf.get("youtube") ?? null,
      captured_at_twitch: capByPf.get("twitch") ?? null,
      previous_total: st?.previous_total ?? null,
      peak_viewers: st?.peak ?? null,
      peak_at: st?.peak_at ?? null,
      youtube,
      twitch,
    },
    { headers: { "Cache-Control": CACHE_CONTROL } },
  );
}
