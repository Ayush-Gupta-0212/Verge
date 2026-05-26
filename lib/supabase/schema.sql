-- ============================================================================
-- Verge — canonical Postgres schema for Supabase.
--
-- This is the ONE file new deployments need to run. It contains every
-- table, index, RLS policy, trigger, storage bucket, and column the
-- current app expects. Every statement is idempotent (CREATE … IF NOT
-- EXISTS, ALTER … ADD COLUMN IF NOT EXISTS, DROP POLICY IF EXISTS) so
-- re-running it after a pull is safe and recommended.
--
-- HOW TO RUN
--   1. Supabase dashboard → SQL Editor → New query.
--   2. Paste this entire file → Run.
--
-- Row Level Security is enabled on every table; users only ever see their
-- own rows. The avatars storage bucket is owner-write, public-read so
-- shared profile cards render anywhere.
-- ============================================================================

create extension if not exists "uuid-ossp";

-- ──────────────────────────────────────────────────────────────────────────
-- profiles — one row per auth.users row, holds display + preference state.
-- ──────────────────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id                       uuid primary key references auth.users(id) on delete cascade,
  display_name             text not null default 'Stargazer',
  avatar_url               text,
  accent                   text not null default 'amber'
                           check (accent in ('amber','violet','aurora')),
  public_slug              text unique,
  public_enabled           boolean not null default false,

  -- Focus + goal preferences
  daily_goal_min           int  not null default 120,
  weekly_goal_min          int  not null default 1500,
  focus_minutes            int  not null default 25
                           check (focus_minutes between 5 and 240),
  break_minutes            int  not null default 5
                           check (break_minutes between 1 and 60),
  long_break_minutes       int  not null default 15
                           check (long_break_minutes between 5 and 120),
  long_break_every         int  not null default 4
                           check (long_break_every between 2 and 12),

  -- Day window
  day_start_hour           int  not null default 9
                           check (day_start_hour between 0 and 23),
  day_end_hour             int  not null default 21
                           check (day_end_hour between 1 and 24),

  -- Quiet hours (notifications + sounds suppressed in this window)
  quiet_hours_enabled      boolean not null default false,
  quiet_hours_start        int  not null default 22
                           check (quiet_hours_start between 0 and 23),
  quiet_hours_end          int  not null default 7
                           check (quiet_hours_end between 0 and 23),

  -- Notification toggles
  notify_focus_end         boolean not null default false,
  notify_due_reminders     boolean not null default false,

  -- Sensory prefs
  sounds_enabled           boolean not null default false,
  reduced_motion           boolean not null default false,

  -- Streak forgiveness ledger (Monday-anchored ISO week)
  streak_freeze_used_week  date,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists profiles_public_slug_idx
  on public.profiles(public_slug)
  where public_slug is not null;

-- ──────────────────────────────────────────────────────────────────────────
-- tasks — work items, optionally recurring / snoozable / tagged / sized.
-- ──────────────────────────────────────────────────────────────────────────

create table if not exists public.tasks (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid references auth.users(id) on delete cascade,
  title         text not null,
  notes         text,
  priority      text not null default 'medium'
                check (priority in ('low','medium','high')),
  due_at        timestamptz,
  completed_at  timestamptz,
  tags          text[] not null default '{}'::text[],
  rrule         text,
  snooze_until  timestamptz,
  position      int,
  estimated_min int,
  created_at    timestamptz not null default now(),

  -- Spatial placement on the 3D spine
  spine_t       double precision not null default 0.5,
  spine_radius  double precision not null default 1.3,
  spine_angle   double precision not null default 0
);

create index if not exists tasks_user_idx     on public.tasks(user_id);
create index if not exists tasks_priority_idx on public.tasks(priority);
create index if not exists tasks_due_idx      on public.tasks(due_at);
create index if not exists tasks_tags_gin_idx on public.tasks using gin(tags);
create index if not exists tasks_position_idx on public.tasks(user_id, position);
create index if not exists tasks_snooze_idx   on public.tasks(user_id, snooze_until);

-- Backfill position for legacy rows so manual order matches insertion order.
update public.tasks
  set position = sub.rn
  from (
    select id, row_number() over (partition by user_id order by created_at) as rn
    from public.tasks
    where position is null
  ) as sub
  where public.tasks.id = sub.id
    and public.tasks.position is null;

-- ──────────────────────────────────────────────────────────────────────────
-- task_subtasks — checklist items under a parent task.
-- ──────────────────────────────────────────────────────────────────────────

create table if not exists public.task_subtasks (
  id            uuid primary key default uuid_generate_v4(),
  task_id       uuid not null references public.tasks(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete cascade,
  title         text not null,
  completed_at  timestamptz,
  position      int  not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists task_subtasks_task_idx on public.task_subtasks(task_id);
create index if not exists task_subtasks_user_idx on public.task_subtasks(user_id);

-- ──────────────────────────────────────────────────────────────────────────
-- schedule_cells — legacy 7×24 holographic timetable cells (kept for the
-- planned "recurring schedule template" surface; the live calendar uses
-- schedule_events below).
-- ──────────────────────────────────────────────────────────────────────────

create table if not exists public.schedule_cells (
  id        uuid primary key default uuid_generate_v4(),
  user_id   uuid references auth.users(id) on delete cascade,
  day       int  not null check (day  between 0 and 6),
  slot      int  not null check (slot between 0 and 23),
  duration  int  not null default 1 check (duration between 1 and 12),
  title     text not null,
  color     text not null default '#5fb3ff',
  notes     text,
  task_id   uuid references public.tasks(id) on delete set null,
  unique (user_id, day, slot)
);

create index if not exists schedule_cells_user_idx on public.schedule_cells(user_id);
create index if not exists schedule_cells_task_idx on public.schedule_cells(task_id);

-- ──────────────────────────────────────────────────────────────────────────
-- schedule_events — date-anchored calendar events with optional recurrence.
-- ──────────────────────────────────────────────────────────────────────────

create table if not exists public.schedule_events (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid references auth.users(id) on delete cascade,
  date              date not null,
  start_minute      int  not null check (start_minute between 0 and 1439),
  duration_minutes  int  not null default 60
                    check (duration_minutes between 15 and 1440),
  title             text not null,
  color             text not null default '#ff8a3d',
  notes             text,
  task_id           uuid references public.tasks(id) on delete set null,
  rrule             text,
  series_id         uuid,
  created_at        timestamptz not null default now()
);

create index if not exists schedule_events_user_date_idx
  on public.schedule_events(user_id, date);
create index if not exists schedule_events_task_idx
  on public.schedule_events(task_id);
create index if not exists schedule_events_series_idx
  on public.schedule_events(series_id);

-- ──────────────────────────────────────────────────────────────────────────
-- timer_sessions — stopwatch + focus history, with interruption count.
-- ──────────────────────────────────────────────────────────────────────────

create table if not exists public.timer_sessions (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid references auth.users(id) on delete cascade,
  kind          text not null check (kind in ('stopwatch','focus')),
  started_at    timestamptz not null,
  ended_at      timestamptz,
  duration_ms   bigint not null default 0,
  interruptions int    not null default 0 check (interruptions >= 0),
  task_id       uuid references public.tasks(id) on delete set null
);

create index if not exists timer_sessions_user_idx on public.timer_sessions(user_id);
create index if not exists timer_sessions_task_idx on public.timer_sessions(task_id);

-- ──────────────────────────────────────────────────────────────────────────
-- constellation_stars — points on the user's personal galaxy. Awarded by
-- trigger whenever a task is marked completed.
-- ──────────────────────────────────────────────────────────────────────────

create table if not exists public.constellation_stars (
  id         text primary key,
  user_id    uuid references auth.users(id) on delete cascade,
  task_id    uuid references public.tasks(id) on delete cascade,
  position   double precision[] not null,
  intensity  double precision not null default 0.6,
  earned_at  timestamptz not null default now()
);

create index if not exists constellation_user_idx on public.constellation_stars(user_id);

-- ──────────────────────────────────────────────────────────────────────────
-- achievements — earned badge ledger. (key, user_id) is unique.
-- ──────────────────────────────────────────────────────────────────────────

create table if not exists public.achievements (
  user_id    uuid not null references auth.users(id) on delete cascade,
  key        text not null,
  earned_at  timestamptz not null default now(),
  primary key (user_id, key)
);

create index if not exists achievements_user_idx on public.achievements(user_id);

-- ──────────────────────────────────────────────────────────────────────────
-- push_subscriptions — Web Push endpoints. One row per (user, device).
-- ──────────────────────────────────────────────────────────────────────────

create table if not exists public.push_subscriptions (
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null,
  p256dh      text not null,
  auth_key    text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  primary key (user_id, endpoint)
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

-- ──────────────────────────────────────────────────────────────────────────
-- Row Level Security — owner-only for all tables, plus public-opt-in for
-- profiles that have public_enabled = true.
-- ──────────────────────────────────────────────────────────────────────────

alter table public.profiles            enable row level security;
alter table public.tasks               enable row level security;
alter table public.task_subtasks       enable row level security;
alter table public.schedule_cells      enable row level security;
alter table public.schedule_events     enable row level security;
alter table public.timer_sessions      enable row level security;
alter table public.constellation_stars enable row level security;
alter table public.achievements        enable row level security;
alter table public.push_subscriptions  enable row level security;

drop policy if exists "profiles_self"            on public.profiles;
drop policy if exists "profiles_public_opt_in"   on public.profiles;
drop policy if exists "tasks_self"               on public.tasks;
drop policy if exists "task_subtasks_self"       on public.task_subtasks;
drop policy if exists "schedule_cells_self"      on public.schedule_cells;
drop policy if exists "schedule_events_self"     on public.schedule_events;
drop policy if exists "timer_sessions_self"      on public.timer_sessions;
drop policy if exists "constellation_stars_self" on public.constellation_stars;
drop policy if exists "achievements_self"        on public.achievements;
drop policy if exists "push_subscriptions_self"  on public.push_subscriptions;

create policy "profiles_self" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "profiles_public_opt_in" on public.profiles
  for select to anon, authenticated
  using (public_enabled = true and public_slug is not null);

create policy "tasks_self" on public.tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "task_subtasks_self" on public.task_subtasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "schedule_cells_self" on public.schedule_cells
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "schedule_events_self" on public.schedule_events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "timer_sessions_self" on public.timer_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "constellation_stars_self" on public.constellation_stars
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "achievements_self" on public.achievements
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "push_subscriptions_self" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ──────────────────────────────────────────────────────────────────────────
-- Storage — avatars bucket (public read, owner-folder write).
-- ──────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', true)
  on conflict (id) do update set public = true;

drop policy if exists "avatars_public_read"   on storage.objects;
drop policy if exists "avatars_owner_insert"  on storage.objects;
drop policy if exists "avatars_owner_update"  on storage.objects;
drop policy if exists "avatars_owner_delete"  on storage.objects;

create policy "avatars_public_read" on storage.objects
  for select using (bucket_id = 'avatars');

create policy "avatars_owner_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_owner_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_owner_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ──────────────────────────────────────────────────────────────────────────
-- Triggers — auto-create a profile on signup; award a star on task done.
-- ──────────────────────────────────────────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.award_constellation_star()
returns trigger language plpgsql as $$
begin
  if new.completed_at is not null
     and (old.completed_at is null or old.completed_at <> new.completed_at) then
    insert into public.constellation_stars (id, user_id, task_id, position, intensity)
    values (
      'star-' || new.id::text,
      new.user_id,
      new.id,
      array[random()*2-1, random()*2-1, random()*2-1],
      0.55 + random() * 0.4
    )
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_award_star on public.tasks;
create trigger tasks_award_star
  after update on public.tasks
  for each row execute function public.award_constellation_star();

-- ──────────────────────────────────────────────────────────────────────────
-- Done. Re-run any time after a pull — every statement is idempotent.
-- ──────────────────────────────────────────────────────────────────────────
