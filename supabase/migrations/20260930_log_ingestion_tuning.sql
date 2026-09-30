-- Log Ingestion 削減（2026-09-30）
-- Supabase の無料枠 1GB/月（組織合計）を平常時で超えるペースだったため:
--   1) 収集1回ごとの captures insert ＋ stream_snapshots insert（API 2本）を
--      RPC 1本にまとめる（edge_logs が1リクエスト≒3.6KB で最も重い）
--   2) Twitch 収集を 2分 → 4分間隔に（pg_cron の開始/完了ログと API 本数が半減）
--      40分ギャップでの配信分割・1時間バケットの出現数には影響しない。

create or replace function public.save_capture(
  p_captured_at timestamptz,
  p_platform text,
  p_rows jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into captures (captured_at, platform, count)
  values (p_captured_at, p_platform, coalesce(jsonb_array_length(p_rows), 0));

  if p_rows is not null and jsonb_array_length(p_rows) > 0 then
    insert into stream_snapshots (
      captured_at, platform, game, channel_id, channel_name, stream_id,
      stream_started_at, title, viewers, language, url
    )
    select
      p_captured_at, r.platform, coalesce(r.game, 'fever'), r.channel_id, r.channel_name,
      r.stream_id, r.stream_started_at, r.title, r.viewers, r.language, r.url
    from jsonb_to_recordset(p_rows) as r(
      platform text, game text, channel_id text, channel_name text, stream_id text,
      stream_started_at timestamptz, title text, viewers integer, language text, url text
    );
  end if;
end;
$$;

revoke all on function public.save_capture(timestamptz, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_capture(timestamptz, text, jsonb) to service_role;

select cron.alter_job(
  (select jobid from cron.job where jobname = 'mtf-collect-twitch'),
  schedule := '*/4 * * * *'
);
