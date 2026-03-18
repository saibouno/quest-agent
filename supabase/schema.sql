create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'goal_status') then
    create type goal_status as enum ('draft', 'active', 'paused', 'completed', 'abandoned');
  end if;
  if not exists (select 1 from pg_type where typname = 'stop_mode') then
    create type stop_mode as enum ('hold', 'shrink', 'cancel');
  end if;
  if not exists (select 1 from pg_type where typname = 'resume_trigger_type') then
    create type resume_trigger_type as enum ('manual', 'date', 'condition');
  end if;
  if not exists (select 1 from pg_type where typname = 'resume_queue_status') then
    create type resume_queue_status as enum ('waiting', 'resumed');
  end if;
  if not exists (select 1 from pg_type where typname = 'milestone_status') then
    create type milestone_status as enum ('planned', 'active', 'completed');
  end if;
  if not exists (select 1 from pg_type where typname = 'quest_status') then
    create type quest_status as enum ('planned', 'ready', 'in_progress', 'blocked', 'completed');
  end if;
  if not exists (select 1 from pg_type where typname = 'priority_level') then
    create type priority_level as enum ('high', 'medium', 'low');
  end if;
  if not exists (select 1 from pg_type where typname = 'quest_type') then
    create type quest_type as enum ('main', 'side');
  end if;
  if not exists (select 1 from pg_type where typname = 'blocker_type') then
    create type blocker_type as enum ('clarity', 'time', 'decision', 'dependency', 'energy', 'unknown');
  end if;
  if not exists (select 1 from pg_type where typname = 'blocker_status') then
    create type blocker_status as enum ('open', 'resolved');
  end if;
  if not exists (select 1 from pg_type where typname = 'severity_level') then
    create type severity_level as enum ('high', 'medium', 'low');
  end if;
  if not exists (select 1 from pg_type where typname = 'entity_type') then
    create type entity_type as enum ('goal', 'milestone', 'quest', 'blocker', 'review', 'decision', 'artifact', 'system');
  end if;
  if not exists (select 1 from pg_type where typname = 'artifact_type') then
    create type artifact_type as enum ('note', 'link', 'file', 'output');
  end if;
end $$;

create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  why text not null default '',
  deadline date,
  success_criteria text[] not null default '{}',
  current_state text not null default '',
  constraints text[] not null default '{}',
  concerns text not null default '',
  today_capacity text not null default '',
  status goal_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists portfolio_settings (
  id text primary key default 'default',
  wip_limit integer not null default 1,
  focus_goal_id uuid references goals(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint portfolio_settings_singleton check (id = 'default'),
  constraint portfolio_settings_wip_limit check (wip_limit between 1 and 3)
);

create table if not exists milestones (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references goals(id) on delete cascade,
  title text not null,
  description text not null default '',
  sequence integer not null default 1,
  target_date date,
  status milestone_status not null default 'planned',
  created_at timestamptz not null default now()
);

create table if not exists quests (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references goals(id) on delete cascade,
  milestone_id uuid references milestones(id) on delete set null,
  title text not null,
  description text not null default '',
  priority priority_level not null default 'medium',
  status quest_status not null default 'planned',
  due_date date,
  estimated_minutes integer,
  quest_type quest_type not null default 'main',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists blockers (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references goals(id) on delete cascade,
  related_quest_id uuid references quests(id) on delete set null,
  title text not null,
  description text not null default '',
  blocker_type blocker_type not null default 'unknown',
  severity severity_level not null default 'medium',
  status blocker_status not null default 'open',
  suggested_next_step text not null default '',
  detected_at timestamptz not null default now()
);

create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references goals(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  summary text not null default '',
  learnings text not null default '',
  reroute_note text not null default '',
  next_focus text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists decisions (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references goals(id) on delete cascade,
  title text not null,
  description text not null default '',
  rationale text not null default '',
  decided_at timestamptz not null default now()
);

create table if not exists artifacts (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references goals(id) on delete cascade,
  title text not null,
  artifact_type artifact_type not null default 'note',
  url_or_ref text not null default '',
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references goals(id) on delete cascade,
  entity_type entity_type not null,
  entity_id uuid not null,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists resume_queue_items (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references goals(id) on delete cascade,
  stop_mode stop_mode not null,
  parked_at timestamptz not null default now(),
  reason text not null default '',
  parking_note text not null default '',
  next_restart_step text not null default '',
  resume_trigger_type resume_trigger_type not null default 'manual',
  resume_trigger_text text not null default '',
  status resume_queue_status not null default 'waiting'
);

create index if not exists idx_goals_status on goals(status);
create index if not exists idx_milestones_goal_id on milestones(goal_id);
create index if not exists idx_quests_goal_id on quests(goal_id);
create index if not exists idx_quests_status on quests(status);
create index if not exists idx_blockers_goal_id on blockers(goal_id);
create index if not exists idx_reviews_goal_id on reviews(goal_id);
create index if not exists idx_events_goal_id on events(goal_id);
create index if not exists idx_events_type on events(type);
create index if not exists idx_resume_queue_goal_id on resume_queue_items(goal_id);
create index if not exists idx_resume_queue_status on resume_queue_items(status);

do $$
begin
  if not exists (select 1 from pg_type where typname = 'session_category') then
    create type session_category as enum ('main', 'improve', 'admin', 'other');
  end if;
  if not exists (select 1 from pg_type where typname = 'main_connection_kind') then
    create type main_connection_kind as enum ('direct', 'supporting', 'unclear');
  end if;
  if not exists (select 1 from pg_type where typname = 'build_improve_mode') then
    create type build_improve_mode as enum ('build', 'improve', 'avoidant');
  end if;
  if not exists (select 1 from pg_type where typname = 'meta_work_flag_type') then
    create type meta_work_flag_type as enum ('main_work_absent', 'meta_overweight', 'start_delay', 'switch_density', 'unfinished_chain', 'uncertainty_loop');
  end if;
  if not exists (select 1 from pg_type where typname = 'bottleneck_type') then
    create type bottleneck_type as enum ('capability', 'opportunity', 'motivation', 'unclear');
  end if;
  if not exists (select 1 from pg_type where typname = 'return_decision') then
    create type return_decision as enum ('fight', 'detour', 'hold', 'retreat');
  end if;
end $$;

create table if not exists build_improve_decisions (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references goals(id) on delete cascade,
  quest_id uuid references quests(id) on delete set null,
  category session_category not null,
  main_connection main_connection_kind not null,
  artifact_commitment text not null default '',
  timebox_minutes integer not null default 25,
  done_when text not null default '',
  mode build_improve_mode not null,
  rationale text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists work_sessions (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references goals(id) on delete cascade,
  quest_id uuid references quests(id) on delete set null,
  gate_decision_id uuid references build_improve_decisions(id) on delete set null,
  category session_category not null,
  planned_minutes integer not null default 25,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  artifact_note text not null default ''
);

create table if not exists meta_work_flags (
  id text primary key,
  goal_id uuid references goals(id) on delete set null,
  day_key date not null,
  flag_type meta_work_flag_type not null,
  message text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists bottleneck_interviews (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references goals(id) on delete cascade,
  main_quest text not null default '',
  primary_bottleneck bottleneck_type not null,
  avoidance_hypothesis text not null default '',
  smallest_win text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists return_runs (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references goals(id) on delete cascade,
  quest_id uuid references quests(id) on delete set null,
  interview_id uuid references bottleneck_interviews(id) on delete set null,
  mirror_message text not null default '',
  diagnosis_type bottleneck_type not null,
  woop_plan text not null default '',
  if_then_plan text not null default '',
  next_15m_action text not null default '',
  decision return_decision not null,
  decision_note text not null default '',
  review_date date,
  created_at timestamptz not null default now()
);

create table if not exists lead_metrics_daily (
  day_key date primary key,
  main_work_ratio double precision not null default 0,
  meta_work_ratio double precision not null default 0,
  start_delay_minutes integer,
  resume_delay_minutes double precision,
  switch_density integer not null default 0,
  if_then_coverage double precision not null default 0,
  monitoring_done boolean not null default false
);

create index if not exists idx_build_improve_goal_id on build_improve_decisions(goal_id);
create index if not exists idx_build_improve_mode on build_improve_decisions(mode);
create index if not exists idx_work_sessions_goal_id on work_sessions(goal_id);
create index if not exists idx_work_sessions_started_at on work_sessions(started_at);
create index if not exists idx_meta_work_flags_day_key on meta_work_flags(day_key);
create index if not exists idx_bottleneck_interviews_goal_id on bottleneck_interviews(goal_id);
create index if not exists idx_return_runs_goal_id on return_runs(goal_id);

create table if not exists ui_preferences (
  id text primary key default 'default',
  locale text not null default 'ja' check (locale in ('ja', 'en'))
);

