import { NextResponse } from "next/server";
import { createPublicClient } from "@/lib/supabase";
import { isGameId } from "@/lib/games";

export const dynamic = "force-dynamic";

// トップページ「昨日の見どころ」用。直近で配信があった日（今日より前・JST）の集計を RPC 1本で返す。
// 中身が変わるのは日付が変わるときだけなので、CDN で長めにキャッシュする（関数とDBをほぼ呼ばない）。
// ?game=fever|aces|mt64 でタイトル絞り込み（未指定=全タイトル）。
const CACHE_CONTROL = "public, max-age=0, s-maxage=600, stale-while-revalidate=3600";

export async function GET(request: Request) {
  const gRaw = new URL(request.url).searchParams.get("game");
  const game = isGameId(gRaw) ? gRaw : null;

  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("yesterday_highlights", { p_game: game });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? { day: null }, { headers: { "Cache-Control": CACHE_CONTROL } });
}
