// SENSEKI FEVER の「大会看板」(events テーブル)を読んで、いま開催中・まもなく始まる大会を返す。
// ブラウザから相手側の Supabase を公開キーで直接読む（events は誰でも閲覧できる設定）。
// FEVER LIVE のサーバーも DB も通らないので、こちらの CPU・Egress は増えない。
// 読むのは表示時だけ＋sessionStorage に10分キャッシュ。失敗したら空（枠を出さない）。

import type { GameId } from "./games";
import type { StreamSnapshot } from "./types";
import { streamTags } from "./tags";

const SENSEKI_REST = "https://bltnmpwgbmohvrqwtzmn.supabase.co/rest/v1/";
// 公開用のキー（SENSEKI FEVER のブラウザにも配られているもの。秘密ではない）
const SENSEKI_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJsdG5tcHdnYm1vaHZycXd0em1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2MjczODUsImV4cCI6MjA5NDIwMzM4NX0.wjVKqCfSL9Uf2P-tBwoMWj2wSFEDZcxPeePrXeAfp6A";
const CACHE_KEY = "fl-events-v2";
const CACHE_MS = 10 * 60_000;

export const SOON_MS = 3 * 3600_000; // 開始の3時間前から「このあと」として出す
const DEFAULT_LEN_MS = 4 * 3600_000; // 終了時刻が未登録の大会は開始から4時間を開催中とみなす
// 開始から終了まで24時間を超える大会は「期間開催」（各自で日程を合わせて進める大会など）。
// 終了日が未定の大会は、看板に仮の終了日を入れてもらう前提。
const LONG_MS = 24 * 3600_000;

export interface BoardEvent {
  id: string;
  title: string;
  description: string | null;
  host_name: string | null;
  link_url: string | null;
  starts_at: string;
  ends_at: string | null;
}

export type EventPhase = "soon" | "live";

export function eventEnd(e: BoardEvent): number {
  return e.ends_at ? new Date(e.ends_at).getTime() : new Date(e.starts_at).getTime() + DEFAULT_LEN_MS;
}

export function isLongEvent(e: BoardEvent): boolean {
  return !!e.ends_at && eventEnd(e) - new Date(e.starts_at).getTime() > LONG_MS;
}

export function eventPhase(e: BoardEvent, now: number): EventPhase | null {
  const start = new Date(e.starts_at).getTime();
  if (now >= eventEnd(e)) return null;
  if (now >= start) return "live";
  if (now >= start - SOON_MS) return "soon";
  return null;
}

function norm(s: string | null | undefined): string {
  return (s ?? "").normalize("NFKC").toLowerCase().replace(/[\s'’`_-]+/g, "");
}

// 看板の大会名から、配信タイトルと照らす部分だけを取り出す。
// 「第3回」を外し、末尾の日本語訳の括弧「AuntStarr's Singles（AuntStarrのシングルス）」も外す。
function eventName(e: BoardEvent): string {
  return norm(e.title.replace(/[（(][^（()）]*[)）]\s*$/, "")).replace(/^第\d+回/, "");
}

// 大会がどのタイトルのものか。看板はフィーバーが基本で、シリーズ作品は題名か説明に名前が入る。
export function eventGame(e: BoardEvent): GameId {
  const s = norm(e.title) + norm(e.description);
  if (/マリオテニスエース|tennisaces/.test(s)) return "aces";
  if (/マリオテニス64|tennis64/.test(s)) return "mt64";
  return "fever";
}

// その大会の配信とみなす条件（どれか1つ）:
//  - タイトルが「大会」タグに当たる（RTAの催しなら「RTA」タグも）
//  - タイトルに大会名がそのまま入っている
//  - チャンネル名が主催者名と一致する
// 期間開催の大会は何週間も続き、その間のほかの大会の配信まで拾ってしまうので「大会」タグでは選ばない。
// 代わりにタイトルに主催者名が入っている配信（「AuntStarrさんの大会 1回戦」など）も拾う。
export function eventStreams(e: BoardEvent, streams: StreamSnapshot[]): StreamSnapshot[] {
  const game = eventGame(e);
  const name = eventName(e);
  const host = norm(e.host_name);
  const long = isLongEvent(e);
  const rta = streamTags(e.title).includes("rta");
  return streams
    .filter((s) => {
      if (s.game !== game) return false;
      const tags = streamTags(s.title);
      if (!long && (tags.includes("tournament") || (rta && tags.includes("rta")))) return true;
      const title = norm(s.title);
      if (name.length >= 4 && title.includes(name)) return true;
      if (long && host.length >= 4 && title.includes(host)) return true;
      const ch = norm(s.channel_name);
      return host.length >= 2 && ch.length >= 2 && (ch.includes(host) || host.includes(ch));
    })
    .sort((a, b) => (b.viewers ?? 0) - (a.viewers ?? 0));
}

export async function fetchBoardEvents(): Promise<BoardEvent[]> {
  try {
    const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) ?? "null") as
      | { at: number; rows: BoardEvent[] }
      | null;
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.rows;
  } catch {
    /* キャッシュが読めなければ取りに行く */
  }
  try {
    // 開催中かもしれない過去12時間ぶん〜「このあと」に入る先まで。
    // 加えて、それより前に始まっていても終了時刻がまだ先の大会（期間開催）。
    const now = new Date().toISOString();
    const from = new Date(Date.now() - 12 * 3600_000).toISOString();
    const to = new Date(Date.now() + SOON_MS + CACHE_MS).toISOString();
    const or =
      `(and(starts_at.gte.${from},starts_at.lte.${to}),` + `and(starts_at.lte.${to},ends_at.gt.${now}))`;
    const q =
      "events?select=id,title,description,host_name,link_url,starts_at,ends_at" +
      `&or=${encodeURIComponent(or)}&order=starts_at.asc&limit=20`;
    const res = await fetch(SENSEKI_REST + q, {
      headers: { apikey: SENSEKI_KEY, Authorization: `Bearer ${SENSEKI_KEY}` },
    });
    if (!res.ok) return [];
    const rows = (await res.json()) as BoardEvent[];
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), rows }));
    } catch {
      /* 保存できなくても表示はできる */
    }
    return rows;
  } catch {
    return [];
  }
}
