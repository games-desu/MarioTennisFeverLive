import { ImageResponse } from "next/og";
import { createPublicClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
// Edge で動かす（Node 版の next/og は Windows の開発環境でフォントのパス解決に失敗する）。
export const runtime = "edge";

// 配信者の記録カード（1200x630 の PNG）。
// 配信者ページの「記録カードを作る」と、共有リンクのプレビュー画像（OGP）の両方で使う。
// 保存済みデータだけを読む。画像の生成は CPU を使うので CDN で長めにキャッシュし、
// ページを開いただけでは作らない（ボタンを押したとき・共有先が取りに来たときだけ）。

const W = 1200;
const H = 630;
const SITE = "mario-tennis-fever-live.vercel.app";
const ALLOWED_DAYS = [7, 30, 90];

type Lang = "ja" | "en";

interface Stats {
  channel_name: string;
  first_seen_all: string | null;
  stream_hours: number;
  viewer_hours: number;
  peak_viewers: number;
  peak_at: string | null;
  avg_viewers: number | null;
}
interface Rank {
  rank: number | null;
  total_channels: number | null;
}

function fmt(n: number | null | undefined): string {
  return Math.round(n ?? 0).toLocaleString("en-US");
}
function md(d: Date): string {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("month")}/${g("day")}`;
}

// 太字の日本語フォントを、カードに出す文字だけに絞って Google Fonts から取る。
// 取れなければ既定のフォント（細字）で描く。
async function loadFont(text: string): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(
      `https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@800&text=${encodeURIComponent(text)}`,
      { signal: AbortSignal.timeout(4000) },
    ).then((r) => (r.ok ? r.text() : ""));
    const url = css.match(/src:\s*url\(([^)]+)\)\s*format\('(?:opentype|truetype)'\)/)?.[1];
    if (!url) return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}

// アイコンは先に取って data URI にする（取れないときは頭文字の丸で代用）。
async function loadIcon(url: string | null | undefined): Promise<string | null> {
  if (!url || !/^https:\/\//.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!/^image\/(png|jpe?g)/.test(type)) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > 1_500_000) return null;
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return `data:${type.split(";")[0]};base64,${btoa(bin)}`;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const platform = searchParams.get("platform");
  const id = (searchParams.get("id") ?? "").slice(0, 200);
  const daysRaw = parseInt(searchParams.get("days") ?? "30", 10);
  const days = ALLOWED_DAYS.includes(daysRaw) ? daysRaw : 30;
  const lang: Lang = searchParams.get("lang") === "en" ? "en" : "ja";

  if ((platform !== "youtube" && platform !== "twitch") || !id) {
    return new Response("invalid params", { status: 400 });
  }

  const supabase = createPublicClient();
  const [statsRes, rankRes, channelRes] = await Promise.all([
    supabase.rpc("channel_stats", { p_platform: platform, p_channel_id: id, p_days: days }),
    supabase.rpc("channel_rank", { p_channel_id: id, p_days: days }),
    supabase
      .from("channels")
      .select("title,thumbnail_url")
      .eq("platform", platform)
      .eq("channel_id", id)
      .maybeSingle(),
  ]);

  const stats = (statsRes.data?.[0] ?? null) as Stats | null;
  const rank = (rankRes.data?.[0] ?? null) as Rank | null;
  const channel = channelRes.data as { title: string | null; thumbnail_url: string | null } | null;

  if (!stats?.first_seen_all && !channel) {
    return new Response("not found", { status: 404 });
  }

  const rawName =
    stats?.channel_name && stats.channel_name !== id
      ? stats.channel_name
      : channel?.title ?? stats?.channel_name ?? id;
  const name = rawName.length > 26 ? `${rawName.slice(0, 25)}…` : rawName;
  const nameSize = name.length <= 10 ? 68 : name.length <= 16 ? 56 : 44;

  const now = new Date();
  const from = new Date(now.getTime() - days * 86400000);
  const range = `${md(from)} – ${md(now)}`;
  const hasStreams = (stats?.stream_hours ?? 0) > 0;

  const L =
    lang === "en"
      ? {
          period: `Last ${days} days`,
          peak: "Peak viewers",
          hours: "Stream hours",
          vh: "Viewer-hours",
          avg: "Avg viewers",
          rankLead: "Streamer rank",
          rankVal: rank?.rank != null ? `#${rank.rank}` : "",
          rankTail: rank?.total_channels != null ? `of ${fmt(rank.total_channels)}` : "",
          none: "No streams in this period",
          unofficial: "Unofficial fan site",
          record: "STREAM RECORD",
        }
      : {
          period: `直近${days}日の記録`,
          peak: "最大同時視聴",
          hours: "配信時間",
          vh: "延べ視聴",
          avg: "平均同時視聴",
          rankLead: "配信者ランキング",
          rankVal: rank?.rank != null ? `${rank.rank}位` : "",
          rankTail: rank?.total_channels != null ? `/ ${fmt(rank.total_channels)}ch中` : "",
          none: "この期間の配信はありません",
          unofficial: "非公式ファンサイト",
          record: "STREAM RECORD",
        };

  const tiles = [
    { label: L.peak, value: fmt(stats?.peak_viewers), unit: "", sub: stats?.peak_at ? md(new Date(stats.peak_at)) : "" },
    { label: L.hours, value: fmt(stats?.stream_hours), unit: "h", sub: "" },
    { label: L.vh, value: fmt(stats?.viewer_hours), unit: "", sub: "" },
    { label: L.avg, value: fmt(stats?.avg_viewers), unit: "", sub: "" },
  ];

  const pfLabel = platform === "twitch" ? "Twitch" : "YouTube";
  const pfColor = platform === "twitch" ? "#9146ff" : "#e62117";

  const allText =
    [name, range, SITE, pfLabel, "FEVER LIVE", ...Object.values(L), ...tiles.flatMap((t) => [t.value, t.unit, t.sub])].join("") +
    "0123456789/–・,.#h…";
  const [font, icon] = await Promise.all([loadFont(allText), loadIcon(channel?.thumbnail_url)]);

  const GREEN = "#22c55e";
  const TEXT = "#f2faf4";
  const MUTED = "#8fa698";

  return new ImageResponse(
    (
      <div
        style={{
          width: W,
          height: H,
          display: "flex",
          flexDirection: "column",
          padding: "44px 56px 36px",
          background: "linear-gradient(135deg, #0b130e 0%, #12241a 55%, #0f3a22 100%)",
          color: TEXT,
          fontFamily: font ? "NotoJP" : undefined,
        }}
      >
        {/* 上段：ロゴと期間 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ width: 14, height: 14, borderRadius: 7, background: GREEN, marginRight: 12 }} />
            <div style={{ display: "flex", fontSize: 30, letterSpacing: 2 }}>FEVER LIVE</div>
            <div style={{ display: "flex", fontSize: 18, color: GREEN, marginLeft: 16, letterSpacing: 3 }}>
              {L.record}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", fontSize: 24, color: MUTED }}>
            <div style={{ display: "flex", color: TEXT }}>{L.period}</div>
            <div style={{ display: "flex", marginLeft: 14 }}>{range}</div>
          </div>
        </div>

        {/* 中段：アイコン・名前・順位 */}
        <div style={{ display: "flex", alignItems: "center", marginTop: 44 }}>
          {icon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={icon}
              alt=""
              width={148}
              height={148}
              style={{ borderRadius: 74, border: `4px solid ${GREEN}`, objectFit: "cover" }}
            />
          ) : (
            <div
              style={{
                width: 148,
                height: 148,
                borderRadius: 74,
                background: pfColor,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 72,
              }}
            >
              {name.charAt(0)}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", marginLeft: 36, flex: 1 }}>
            <div style={{ display: "flex", fontSize: nameSize, lineHeight: 1.15 }}>{name}</div>
            <div style={{ display: "flex", alignItems: "center", marginTop: 16 }}>
              <div
                style={{
                  display: "flex",
                  fontSize: 20,
                  padding: "4px 14px",
                  borderRadius: 999,
                  background: pfColor,
                  color: "#fff",
                }}
              >
                {pfLabel}
              </div>
              {hasStreams && rank?.rank != null && (
                <div style={{ display: "flex", alignItems: "baseline", marginLeft: 20 }}>
                  <div style={{ display: "flex", fontSize: 22, color: MUTED }}>{L.rankLead}</div>
                  <div style={{ display: "flex", fontSize: 40, color: GREEN, marginLeft: 12 }}>{L.rankVal}</div>
                  <div style={{ display: "flex", fontSize: 22, color: MUTED, marginLeft: 10 }}>{L.rankTail}</div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 下段：数字 */}
        {hasStreams ? (
          <div style={{ display: "flex", marginTop: 44 }}>
            {tiles.map((t, i) => (
              <div
                key={t.label}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  flex: 1,
                  marginLeft: i === 0 ? 0 : 18,
                  padding: "20px 24px 18px",
                  borderRadius: 20,
                  background: i === 0 ? "rgba(34,197,94,0.16)" : "rgba(255,255,255,0.06)",
                  border: i === 0 ? `2px solid ${GREEN}` : "2px solid rgba(255,255,255,0.08)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 21, color: MUTED }}>
                  <div style={{ display: "flex" }}>{t.label}</div>
                  <div style={{ display: "flex" }}>{t.sub}</div>
                </div>
                <div style={{ display: "flex", alignItems: "flex-end", marginTop: 6 }}>
                  <div style={{ display: "flex", fontSize: 76, lineHeight: 1.1, color: i === 0 ? GREEN : TEXT }}>
                    {t.value}
                  </div>
                  <div style={{ display: "flex", fontSize: 34, marginLeft: 6, marginBottom: 12, color: MUTED }}>{t.unit}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", marginTop: 70, fontSize: 34, color: MUTED }}>{L.none}</div>
        )}

        {/* 下端：出どころ */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: "auto",
            fontSize: 20,
            color: MUTED,
          }}
        >
          <div style={{ display: "flex" }}>{SITE}</div>
          <div style={{ display: "flex" }}>{L.unofficial}</div>
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      fonts: font ? [{ name: "NotoJP", data: font, weight: 800, style: "normal" }] : undefined,
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}
