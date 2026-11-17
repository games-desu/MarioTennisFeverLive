"use client";

// トップページの大会の特設枠。SENSEKI FEVER の「大会看板」に登録された大会が
// 開催中（または開始3時間前から）のあいだだけ出し、その大会の配信をまとめる。
// 大会の一覧は lib/events.ts がブラウザから直接読む（10分キャッシュ）。
// 配信はトップがすでに持っている一覧から選ぶだけなので、追加の通信は無い。
// 対象の大会が無い・読めないときは何も出さない。

import { useEffect, useState } from "react";
import type { StreamSnapshot } from "@/lib/types";
import { GAME_BY_ID, gameLabel, type GameId } from "@/lib/games";
import {
  eventEnd,
  eventGame,
  eventPhase,
  eventStreams,
  fetchBoardEvents,
  isLongEvent,
  type BoardEvent,
} from "@/lib/events";
import { trackClick } from "@/lib/track";
import { useLang } from "./LocaleProvider";

const MAX_STREAMS = 6;

function jstHm(ms: number): string {
  return new Date(ms).toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// 期間開催の大会は時刻ではなく開始日を出す（終了日は仮のことがあるので出さない）
function jstMd(ms: number): string {
  return new Date(ms).toLocaleDateString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
  });
}

export default function TournamentSpotlight({
  streams,
  game,
}: {
  streams: StreamSnapshot[];
  game: "all" | GameId;
}) {
  const { lang, t } = useLang();
  const [events, setEvents] = useState<BoardEvent[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    const read = () =>
      fetchBoardEvents().then((rows) => {
        if (!alive) return;
        setEvents(rows);
        setNow(Date.now());
      });
    read();
    // 開きっぱなしでも開始・終了に追従する（キャッシュが効くので通信は10分に1回まで）
    const id = setInterval(() => {
      if (!document.hidden) read();
    }, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // 期間開催の大会は何週間も続くので、開催中はその大会の配信があるときだけ出す
  const shown = events
    .map((e) => {
      const phase = eventPhase(e, now);
      const long = isLongEvent(e);
      const list = phase === "live" ? eventStreams(e, streams) : [];
      return { e, phase, long, list, g: eventGame(e) };
    })
    .filter(
      (x) =>
        x.phase &&
        (game === "all" || game === x.g) &&
        !(x.long && x.phase === "live" && x.list.length === 0),
    );
  if (shown.length === 0) return null;

  return (
    <div className="mb-5 space-y-2.5">
      {shown.map(({ e, phase, long, list, g }) => {
        const live = phase === "live";
        const start = new Date(e.starts_at).getTime();
        const gdef = GAME_BY_ID.get(g);
        return (
          <section key={e.id} className="rounded-2xl border border-brand/30 bg-brand/5 p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {live ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-600">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
                  </span>
                  {t("home.evLive")}
                </span>
              ) : (
                <span className="rounded-full border border-brand/30 px-2 py-0.5 text-[11px] font-bold text-brand">
                  {t("home.evSoon")}
                </span>
              )}
              <span className="text-[11px] tabular-nums text-slate-500">
                {long
                  ? lang === "en"
                    ? `From ${jstMd(start)} · runs over several weeks`
                    : `${jstMd(start)}〜 期間開催`
                  : lang === "en"
                    ? `${jstHm(start)}${e.ends_at ? `–${jstHm(eventEnd(e))}` : ""} JST`
                    : `${jstHm(start)}〜${e.ends_at ? jstHm(eventEnd(e)) : ""}`}
              </span>
              {g !== "fever" && gdef && (
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${gdef.badgeClass}`}>
                  {gameLabel(gdef, lang)}
                </span>
              )}
            </div>
            <h2 className="mt-1.5 text-base font-black leading-snug text-slate-900">{e.title}</h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              {e.host_name && (
                <span>
                  {t("home.evHost")} {e.host_name}
                </span>
              )}
              {e.link_url && (
                <a
                  href={e.link_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-bold text-brand underline underline-offset-2"
                >
                  {t("home.evPage")}
                </a>
              )}
            </div>

            {live &&
              (list.length > 0 ? (
                <ul className="mt-3 space-y-1.5">
                  {list.slice(0, MAX_STREAMS).map((s) => (
                    <li key={`${s.platform}:${s.channel_id}`}>
                      <a
                        href={s.url ?? "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => trackClick(s)}
                        className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 transition-colors hover:bg-slate-50"
                      >
                        <span
                          title={s.platform === "twitch" ? "Twitch" : "YouTube"}
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            s.platform === "twitch" ? "bg-twitch" : "bg-youtube"
                          }`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-bold text-slate-900">
                            {s.channel_name ?? s.channel_id}
                          </span>
                          <span className="block truncate text-[11px] text-slate-500">{s.title}</span>
                        </span>
                        <span className="shrink-0 text-sm font-black tabular-nums text-slate-900">
                          {(s.viewers ?? 0).toLocaleString("ja-JP")}
                          {lang === "ja" && (
                            <span className="ml-0.5 text-[10px] font-normal text-slate-400">人</span>
                          )}
                        </span>
                      </a>
                    </li>
                  ))}
                  {list.length > MAX_STREAMS && (
                    <li className="px-1 text-[11px] text-slate-400">
                      {lang === "en"
                        ? `+${list.length - MAX_STREAMS} more in the list below`
                        : `ほか ${list.length - MAX_STREAMS} 本は下の一覧に`}
                    </li>
                  )}
                </ul>
              ) : (
                <p className="mt-3 text-xs text-slate-500">{t("home.evNone")}</p>
              ))}
            {live && list.length > 0 && (
              <p className="mt-2 text-[10px] leading-relaxed text-slate-400">{t("home.evNote")}</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
