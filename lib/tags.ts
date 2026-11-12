// 配信タイトルから「どんな配信か」のタグを読み取る。
// 表示のたびにブラウザ側で判定するので、DBにもAPIにも手を入れない（サーバーの負荷は増えない）。
// 判定語は直近90日の実際のタイトルを見て決めた（2026-11-13）。足すときも実例を確かめてから。

export type TagId = "ranked" | "viewers" | "tournament" | "doubles" | "singles" | "rta" | "welcome";

export interface TagDef {
  id: TagId;
  label: string;
  labelEn: string;
  re: RegExp; // 全角半角をそろえて小文字にしたタイトルに当てる
}

// 並び順 = バッジと絞り込みボタンの並び順
export const TAGS: TagDef[] = [
  {
    id: "ranked",
    label: "ランクマ",
    labelEn: "Ranked",
    re: /ランクマ|ランク戦|レート戦|ランキング戦|\branked\b|\brank match/,
  },
  {
    id: "viewers",
    label: "参加型",
    labelEn: "Viewer games",
    re: /参加型|視聴者参加|リスナー参加|誰でも参加|参加(歓迎|ok|可|募集|待ち|者募集)|ルムマ|ルームマッチ|フレ戦|フレンド戦|対戦募集|相手募集|凸待ち|with (chat|viewers)|viewer (match|game|battle)|open lobb|!join/,
  },
  {
    id: "tournament",
    label: "大会",
    labelEn: "Tournament",
    // 「大会見てたら」「大会に向けて練習」は大会そのものではないので外す
    re: /大会(?!見|観|後|に向け|の感想|お疲れ)|トーナメント|tournament|\bcup\b|杯|championship|選手権|リーグ戦/,
  },
  { id: "doubles", label: "ダブルス", labelEn: "Doubles", re: /ダブルス|\bdoubles\b/ },
  { id: "singles", label: "シングルス", labelEn: "Singles", re: /シングルス|\bsingles\b/ },
  { id: "rta", label: "RTA", labelEn: "Speedrun", re: /\brta\b|speedrun|any%/ },
  {
    id: "welcome",
    label: "初見歓迎",
    labelEn: "Newcomers welcome",
    re: /初見(さん|様)?(大)?歓迎|newcomers? welcome/,
  },
];

export const TAG_BY_ID = new Map(TAGS.map((x) => [x.id, x]));

export function tagLabel(tag: TagDef, lang: "ja" | "en"): string {
  return lang === "en" ? tag.labelEn : tag.label;
}

export function streamTags(title: string | null | undefined): TagId[] {
  if (!title) return [];
  // 「乾杯」が「杯」(大会)に当たらないよう先に消す
  const s = title.normalize("NFKC").toLowerCase().replace(/乾杯/g, "");
  return TAGS.filter((x) => x.re.test(s)).map((x) => x.id);
}
