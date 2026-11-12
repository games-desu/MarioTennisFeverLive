import type { Metadata } from "next";

// 配信者ページの共有プレビュー（OGP）。リンクを X などに貼ると、直近30日の記録カードが出る。
// ページ本体はクライアント側で描くので、ここでは題名と画像の場所だけを決める。
// 名前は channels から1日キャッシュで読む（読めなければ名前なしの題名にする）。

async function channelTitle(platform: string, id: string): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetch(
      `${url}/rest/v1/channels?select=title&platform=eq.${platform}&channel_id=eq.${encodeURIComponent(id)}&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, next: { revalidate: 86400 } },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as { title: string | null }[];
    return rows[0]?.title ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: { platform: string; id: string };
}): Promise<Metadata> {
  const platform = params.platform === "twitch" ? "twitch" : "youtube";
  const id = decodeURIComponent(params.id ?? "").slice(0, 200);
  const name = await channelTitle(platform, id);
  const title = name ? `${name} の配信記録 — FEVER LIVE` : "配信者の記録 — FEVER LIVE";
  const description =
    "【非公式ファンサイト】マリオテニスの配信記録（最大同時視聴・配信時間・ランキング）。";
  const image = `/api/card?platform=${platform}&id=${encodeURIComponent(id)}&days=30`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      siteName: "FEVER LIVE",
      locale: "ja_JP",
      images: [{ url: image, width: 1200, height: 630, alt: title }],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default function StreamerLayout({ children }: { children: React.ReactNode }) {
  return children;
}
