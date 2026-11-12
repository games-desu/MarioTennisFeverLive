"use client";

// トップページの「昨日の見どころ」。配信が無い時間帯に開いても見るものがあるように、
// 直近で配信があった日（今日より前・JST）の 視聴者数トップ3／自己最高の更新／初登場／最長配信 をまとめて出す。
// 集計は DB の yesterday_highlights（/api/highlights・CDNキャッシュ）。1分ごとの自動更新には乗せず、
// 表示時とタイトル切り替え時にだけ読む。データが無い・取得に失敗したときは何も出さない。
// 各行はサイト内の配信者ページへ飛ばす（前日の配信そのものはもう終わっているため）。

import { useEffect, useState } from "react";
import Link from "next/link";
import { GAME_BY_ID, gameLabel, type GameId } from "@/lib/games";
import { useLang } from "./LocaleProvider";

interface Row {
  platform: string;
  channel_id: string;
  channel_name: string | null;
  thumbnail_url: string | null;
  game: string | null;
  title: string | null;
  peak: number;
  hours: number;
  prev_best: number | null;
}

interface Highlights {
  day: string | null; // YYYY-MM-DD（JST）
  channels: number;
  hours: number;
  top: Row[];
  bests: Row[];
  newcomers: Row[];
  longest: Row | null;
}

const TOP_N = 3;

// JST の「昨日」の日付（YYYY-MM-DD）
function jstYesterday(): string {
  return new Date(Date.now() + 9 * 3600000 - 86400000).toISOString().slice(0, 10);
}

function streamerPath(r: Row): string {
  return `/streamers/${r.platform}/${encodeURIComponent(r.channel_id)}`;
}

function Icon({ r, size = 32 }: { r: Row; size?: number }) {
  const dot = r.platform === "twitch" ? "bg-twitch" : "bg-youtube";
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      {r.thumbnail_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={r.thumbnail_url}
          alt=""
          loading="lazy"
          className="h-full w-full rounded-full border border-slate-200 object-cover"
        />
      ) : (
        <span
          className={`grid h-full w-full place-items-center rounded-full text-[11px] font-bold text-white ${dot}`}
        >
          {(r.channel_name ?? "?").charAt(0)}
        </span>
      )}
      <span
        title={r.platform === "twitch" ? "Twitch" : "YouTube"}
        className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white ${dot}`}
      />
    </span>
  );
}

export default function YesterdayHighlights({ game }: { game: "all" | GameId }) {
  const { lang, t } = useLang();
  const [data, setData] = useState<Highlights | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    fetch(`/api/highlights${game === "all" ? "" : `?game=${game}`}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json: Highlights | null) => {
        if (alive && json?.day) setData(json);
      })
      .catch(() => {
        /* 出さないだけ */
      });
    return () => {
      alive = false;
    };
  }, [game]);

  if (!data?.day || data.top.length === 0) return null;

  const ja = lang === "ja";
  const num = (n: number) => n.toLocaleString(ja ? "ja-JP" : "en-US");
  const [, m, d] = data.day.split("-").map(Number);
  const dayLabel = `${m}/${d}`;
  const isYesterday = data.day === jstYesterday();
  const heading = isYesterday
    ? t("home.hlTitle")
    : ja
      ? `${dayLabel} の見どころ`
      : `Highlights from ${dayLabel}`;
  const summary = ja
    ? `${isYesterday ? `${dayLabel}・` : ""}${num(data.channels)}人が配信・のべ約${num(data.hours)}時間`
    : `${isYesterday ? `${dayLabel} · ` : ""}${num(data.channels)} streamers · about ${num(data.hours)}h in total`;

  // 全タイトル表示のときだけ、どのタイトルの配信かを添える
  const gameTag = (r: Row) => {
    if (game !== "all" || !r.game) return null;
    const g = GAME_BY_ID.get(r.game as GameId);
    return g ? gameLabel(g, lang) : null;
  };
  const hoursLabel = (h: number) => (ja ? `約${num(h)}時間` : `about ${num(h)}h`);

  const top = data.top.slice(0, TOP_N);
  const sectionTitle = "mb-1.5 text-xs font-bold text-slate-500";
  const rowLink =
    "flex items-center gap-2.5 rounded-xl px-1.5 py-1.5 transition hover:bg-slate-50";

  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h2 className="text-base font-black text-slate-800">{heading}</h2>
        <span className="text-xs text-slate-400">{summary}</span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <h3 className={sectionTitle}>{t("home.hlTop")}</h3>
          <ol className="space-y-0.5">
            {top.map((r, i) => (
              <li key={`${r.platform}:${r.channel_id}`}>
                <Link href={streamerPath(r)} className={rowLink}>
                  <span
                    className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-black tabular-nums ${
                      i === 0
                        ? "bg-amber-100 text-amber-600"
                        : i === 1
                          ? "bg-slate-200 text-slate-600"
                          : "bg-orange-100 text-orange-500"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <Icon r={r} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-slate-700">
                      {r.channel_name}
                    </span>
                    <span className="block truncate text-[11px] text-slate-400">
                      {[gameTag(r), r.title].filter(Boolean).join("・")}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-black tabular-nums text-slate-900">
                      {num(r.peak)}
                      {ja && <span className="ml-0.5 text-[10px] font-normal text-slate-400">人</span>}
                    </span>
                    <span className="block text-[10px] text-slate-400">{t("home.hlPeak")}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </div>

        <div className="min-w-0 space-y-3">
          {data.bests.length > 0 && (
            <div>
              <h3 className={sectionTitle}>{t("home.hlBest")}</h3>
              <ul className="space-y-0.5">
                {data.bests.map((r) => (
                  <li key={`${r.platform}:${r.channel_id}`}>
                    <Link href={streamerPath(r)} className={rowLink}>
                      <Icon r={r} size={24} />
                      <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-700">
                        {r.channel_name}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-slate-400">
                        {num(r.prev_best ?? 0)} →{" "}
                        <span className="text-sm font-black text-brand">{num(r.peak)}</span>
                        {ja && "人"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.newcomers.length > 0 && (
            <div>
              <h3 className={sectionTitle}>{t("home.hlNew")}</h3>
              <ul className="space-y-0.5">
                {data.newcomers.map((r) => (
                  <li key={`${r.platform}:${r.channel_id}`}>
                    <Link href={streamerPath(r)} className={rowLink}>
                      <Icon r={r} size={24} />
                      <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-700">
                        {r.channel_name}
                      </span>
                      {gameTag(r) && (
                        <span className="shrink-0 text-[11px] text-slate-400">{gameTag(r)}</span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.longest && (
            <div>
              <h3 className={sectionTitle}>{t("home.hlLongest")}</h3>
              <Link href={streamerPath(data.longest)} className={rowLink}>
                <Icon r={data.longest} size={24} />
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-700">
                  {data.longest.channel_name}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-slate-500">
                  {hoursLabel(data.longest.hours)}
                </span>
              </Link>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
