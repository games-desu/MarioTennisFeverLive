-- トップページ「昨日の見どころ」用（2026-11-12）
-- 配信が無い時間帯に開いても見るものがあるように、直近で配信があった日（今日より前・JST）を1日分まとめて返す。
-- 1リクエスト＝RPC1本・jsonb 1行。アプリ側（/api/highlights）は CDN で長めにキャッシュする。
--
-- 返す内容:
--   day       対象日（JST）。直近8日に配信が無ければ null（アプリ側は何も出さない）
--   channels  その日に配信したチャンネル数
--   hours     配信時間の合計（チャンネル×1時間バケットの数。週次の集計と同じ数え方）
--   top       最大同時視聴者数の上位5
--   bests     自己最高を更新した配信者（過去に3日以上の配信実績があり、その日の最大が5人以上）
--   newcomers 初めて観測した配信者（保持期間90日の中に過去の配信が無く、channels.first_seen もその日以降）
--   longest   配信時間が最も長かった配信者（2時間以上のときだけ）
-- p_game を渡すとそのタイトルの配信だけで集計する（自己最高・初登場もそのタイトル内で判定）。

create or replace function public.yesterday_highlights(p_game text default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with d as (
    select max((captured_at at time zone 'Asia/Tokyo')::date) as day
    from stream_snapshots
    where captured_at >= now() - interval '8 days'
      and (captured_at at time zone 'Asia/Tokyo')::date < (now() at time zone 'Asia/Tokyo')::date
      and (p_game is null or game = p_game)
  ),
  win as (
    select day,
           (day::timestamp at time zone 'Asia/Tokyo') as t0,
           ((day + 1)::timestamp at time zone 'Asia/Tokyo') as t1
    from d
    where day is not null
  ),
  y as (
    select s.platform, s.channel_id, s.channel_name, s.game, s.title, s.viewers, s.captured_at
    from stream_snapshots s, win
    where s.captured_at >= win.t0 and s.captured_at < win.t1
      and (p_game is null or s.game = p_game)
  ),
  per as (
    select platform, channel_id,
           (array_agg(channel_name order by captured_at desc))[1] as channel_name,
           (array_agg(game order by viewers desc nulls last, captured_at desc))[1] as game,
           (array_agg(title order by viewers desc nulls last, captured_at desc))[1] as title,
           coalesce(max(viewers), 0) as peak,
           count(distinct date_trunc('hour', captured_at))::int as hours
    from y
    group by platform, channel_id
  ),
  hist as (
    select s.platform, s.channel_id,
           coalesce(max(s.viewers), 0) as prev_best,
           count(distinct (s.captured_at at time zone 'Asia/Tokyo')::date)::int as prev_days
    from stream_snapshots s, win
    where s.captured_at < win.t0
      and (p_game is null or s.game = p_game)
      and exists (
        select 1 from per p where p.platform = s.platform and p.channel_id = s.channel_id
      )
    group by s.platform, s.channel_id
  ),
  rows as (
    select p.platform, p.channel_id, p.channel_name, p.game, p.title, p.peak, p.hours,
           c.thumbnail_url,
           h.prev_best,
           (h.channel_id is null and (c.first_seen is null or c.first_seen >= win.t0)) as is_new,
           (h.prev_days >= 3 and p.peak >= 5 and p.peak > h.prev_best) as is_best
    from per p
    cross join win
    left join hist h on h.platform = p.platform and h.channel_id = p.channel_id
    left join channels c on c.platform = p.platform and c.channel_id = p.channel_id
  ),
  j as (
    select r.*,
           jsonb_build_object(
             'platform', r.platform,
             'channel_id', r.channel_id,
             'channel_name', r.channel_name,
             'thumbnail_url', r.thumbnail_url,
             'game', r.game,
             'title', r.title,
             'peak', r.peak,
             'hours', r.hours,
             'prev_best', r.prev_best
           ) as obj
    from rows r
  )
  select jsonb_build_object(
    'day', (select day from d),
    'channels', (select count(*) from j),
    'hours', (select coalesce(sum(hours), 0) from j),
    'top', coalesce((
      select jsonb_agg(obj order by peak desc, hours desc, channel_name)
      from (select * from j order by peak desc, hours desc, channel_name limit 5) t
    ), '[]'::jsonb),
    'bests', coalesce((
      select jsonb_agg(obj order by peak desc, channel_name)
      from (select * from j where is_best order by peak desc, channel_name limit 5) t
    ), '[]'::jsonb),
    'newcomers', coalesce((
      select jsonb_agg(obj order by peak desc, channel_name)
      from (select * from j where is_new order by peak desc, channel_name limit 5) t
    ), '[]'::jsonb),
    'longest', (
      select obj from j where hours >= 2 order by hours desc, peak desc, channel_name limit 1
    )
  );
$$;

grant execute on function public.yesterday_highlights(text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
