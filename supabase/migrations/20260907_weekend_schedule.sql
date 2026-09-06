-- =====================================================================
-- 2026-09-07 収集スケジュールを平日／土日で分ける
--
-- 実測（2026-07-28〜09-05・40日。stream_details の actual_start/actual_end ＝
-- YouTube APIが返す実測時刻なので収集間隔の影響を受けない）:
--   ・土日の13〜18時は平日の約5倍配信がある（平均同時配信数 0.32 vs 0.06）。
--     終日2分間隔で穴のないTwitch側でも同方向（13-17時合計 平日0.82→土日1.40）。
--   ・逆に土日の深夜0〜4時は平日より静か（同 1.05/0.61/0.68/0.62/0.42 vs
--     2.60/1.90/1.24/1.03/0.48）。23時も配信開始が 0.36件/日（平日1.03）と少ない。
--   ・「配信の取りこぼし」はRSSフォールバック導入(8/20)以降ほぼゼロ。
--     実害は掲載遅延で、土日13-18時は平均33.9分・最大59.4分かかっていた。
--
-- 目的関数を「1日の期待掲載遅延 Σ aₕ·Eₕ/2」（aₕ=開始数/日, Eₕ=間隔）、制約を
-- 1日の収集回数とすると最適解は Eₕ ∝ 1/√aₕ。これを cron で書ける間隔に丸めた。
--
--   平日: 変更なし（90回/日）。曜日指定を足しただけ。
--   土日: 12〜18時を60分→20分に強化し、原資は深夜0〜4時と23時から回収（83回/日）。
--         → 昼帯10-18時の平均掲載遅延 24.8分 → 14.6分
--
-- クォータ: YouTubeの日次リセットはPT深夜0時＝JST16:00なので、曜日差をつけると
--   「JST16:00→翌16:00」の窓ごとに回数が変わる。最大は平日→平日の90回(9,180u)で
--   現行と同じ。金→土85 / 土→日83 / 日→月88。
--
-- 注意: UTC登録・JST運用。JST 0:00〜8:59 は UTC では前日なので、土日ぶんの
--   dow は 5,6（金土）になる。JST 9:00以降は 6,0（土日）。
--   祝日はcronで表現できないため対象外（山の日1日ぶんしか実績が無く、
--   土日と同じ形かはデータで確認できていないため、まず土日だけで様子を見る）。
--
-- 粗い帯（30分・60分）は :00 ではなく :05 起点にしている。日中の配信開始は
--   毎時00分前後に集まる（5〜19時開始74本のうち00-04分が24%）ため、:00ちょうどに
--   走らせると「毎時00分開始」が丸1周期待たされる（実測で60分待ちが2件あった）。
--   実測分布での期待待ち時間: 60分帯 22.9分→22.3分 / 30分帯 12.8分→10.1分。
-- =====================================================================

do $$
declare
  cmd  text;
  jname text;
begin
  -- 既存ジョブのコマンド（URL＋認証ヘッダ）をそのまま流用する
  select command into cmd from cron.job where jobname = 'mtf-collect-golden';
  if cmd is null then
    raise exception 'mtf-collect-golden が見つかりません（コマンド流用元）';
  end if;

  -- ---- 平日（JST 月〜金）: 間隔は現行のまま・合計90回/日 -----------------
  perform cron.schedule('mtf-yt-wd-midnight',  '*/5 15 * * 0-4',    cmd); -- JST 0時      5分 (12)
  perform cron.schedule('mtf-yt-wd-latenight', '*/20 16-19 * * 0-4', cmd); -- JST 1-4時   20分 (12)
  perform cron.schedule('mtf-yt-wd-dawn',      '5 20-23 * * 0-4',   cmd); -- JST 5-8時   60分  (4)
  perform cron.schedule('mtf-yt-wd-morning',   '5 0-2 * * 1-5',     cmd); -- JST 9-11時  60分  (3)
  perform cron.schedule('mtf-yt-wd-noon',      '*/15 3 * * 1-5',    cmd); -- JST 12時    15分  (4)
  perform cron.schedule('mtf-yt-wd-afternoon', '5 4-8 * * 1-5',     cmd); -- JST 13-17時 60分  (5)
  perform cron.schedule('mtf-yt-wd-prime',     '*/15 9-10 * * 1-5', cmd); -- JST 18-19時 15分  (8)
  perform cron.schedule('mtf-yt-wd-evening',   '*/10 11 * * 1-5',   cmd); -- JST 20時    10分  (6)
  perform cron.schedule('mtf-yt-wd-golden',    '*/5 12-14 * * 1-5', cmd); -- JST 21-23時  5分 (36)

  -- ---- 土日（JST 土日）: 昼を強化・深夜を緩和・合計83回/日 ---------------
  perform cron.schedule('mtf-yt-we-midnight',  '*/10 15 * * 5,6',   cmd); -- JST 0時     10分  (6)
  perform cron.schedule('mtf-yt-we-latenight', '5,35 16-19 * * 5,6', cmd); -- JST 1-4時  30分  (8)
  perform cron.schedule('mtf-yt-we-dawn',      '5 20-23 * * 5,6',   cmd); -- JST 5-8時   60分  (4)
  perform cron.schedule('mtf-yt-we-morning',   '5 0-2 * * 6,0',     cmd); -- JST 9-11時  60分  (3)
  perform cron.schedule('mtf-yt-we-daytime',   '*/20 3-8 * * 6,0',  cmd); -- JST 12-17時 20分 (18)
  perform cron.schedule('mtf-yt-we-prime',     '*/15 9-10 * * 6,0', cmd); -- JST 18-19時 15分  (8)
  perform cron.schedule('mtf-yt-we-evening',   '*/10 11,14 * * 6,0', cmd); -- JST 20時/23時 10分 (12)
  perform cron.schedule('mtf-yt-we-golden',    '*/5 12-13 * * 6,0', cmd); -- JST 21-22時  5分 (24)

  -- ---- 旧ジョブを撤去（Twitch/enrich/prune はそのまま残す） --------------
  foreach jname in array array[
    'mtf-collect-golden', 'mtf-collect-evening', 'mtf-collect-prime',
    'mtf-collect-noon', 'mtf-collect-daytime', 'mtf-collect-latenight'
  ] loop
    if exists (select 1 from cron.job where jobname = jname) then
      perform cron.unschedule(jname);
    end if;
  end loop;
end $$;
