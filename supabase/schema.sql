create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'goal_status') then
    create type goal_status as enum ('draft', 'active', 'paused', 'completed', 'abandoned');
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

create index if not exists idx_goals_status on goals(status);
create index if not exists idx_milestones_goal_id on milestones(goal_id);
create index if not exists idx_quests_goal_id on quests(goal_id);
create index if not exists idx_quests_status on quests(status);
create index if not exists idx_blockers_goal_id on blockers(goal_id);
create index if not exists idx_reviews_goal_id on reviews(goal_id);
create index if not exists idx_events_goal_id on events(goal_id);
create index if not exists idx_events_type on events(type);
