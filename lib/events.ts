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
const CACHE_KEY = "fl-events-v1";
const CACHE_MS = 10 * 60_000;

export const SOON_MS = 3 * 3600_000; // 開始の3時間前から「このあと」として出す
const DEFAULT_LEN_MS = 4 * 3600_000; // 終了時刻が未登録の大会は開始から4時間を開催中とみなす

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

export function eventPhase(e: BoardEvent, now: number): EventPhase | null {
  const start = new Date(e.starts_at).getTime();
  if (now >= eventEnd(e)) return null;
  if (now >= start) return "live";
  if (now >= start - SOON_MS) return "soon";
  return null;
}

function norm(s: string | null | undefined): string {
  return (s ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");
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
export function eventStreams(e: BoardEvent, streams: StreamSnapshot[]): StreamSnapshot[] {
  const game = eventGame(e);
  const name = norm(e.title).replace(/^第\d+回/, "");
  const host = norm(e.host_name);
  const rta = streamTags(e.title).includes("rta");
  return streams
    .filter((s) => {
      if (s.game !== game) return false;
      const tags = streamTags(s.title);
      if (tags.includes("tournament") || (rta && tags.includes("rta"))) return true;
      if (name.length >= 4 && norm(s.title).includes(name)) return true;
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
    // 開催中かもしれない過去12時間ぶん〜「このあと」に入る先まで
    const from = new Date(Date.now() - 12 * 3600_000).toISOString();
    const to = new Date(Date.now() + SOON_MS + CACHE_MS).toISOString();
    const q =
      "events?select=id,title,description,host_name,link_url,starts_at,ends_at" +
      `&starts_at=gte.${encodeURIComponent(from)}&starts_at=lte.${encodeURIComponent(to)}&order=starts_at.asc&limit=10`;
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
