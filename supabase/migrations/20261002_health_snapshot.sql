-- /api/health 用（2026-10-02）
-- 外形監視（UptimeRobot・15分間隔）から呼ばれるたびに API 3本（captures×2・channel_stats_daily）を
-- 投げていたのを RPC 1本にまとめる。edge_logs は1リクエスト≒3KB なので本数がそのままログ量になる。
-- 判定（想定間隔×3 など）は lib/schedule.ts に依存するのでアプリ側に残し、ここは最新時刻を返すだけ。

create or replace function public.health_snapshot()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'youtube', (select max(captured_at) from captures where platform = 'youtube'),
    'twitch', (select max(captured_at) from captures where platform = 'twitch'),
    'enrich_day', (select max(day) from channel_stats_daily)
  );
$$;

grant execute on function public.health_snapshot() to anon, authenticated, service_role;

notify pgrst, 'reload schema';
