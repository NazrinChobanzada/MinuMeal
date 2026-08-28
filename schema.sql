-- =====================================================================
--  Food's Up — database schema
--  Open the SQL Editor in your Supabase dashboard, paste this whole file, run it.
--  Safe to run again (everything is "if not exists" / "or replace").
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables

-- Kitchen: the group that shares data. You get one even on your own.
create table if not exists public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'My kitchen',
  invite_code text unique not null default upper(substr(encode(gen_random_bytes(8),'hex'),1,6)),
  created_at  timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- User profile: holds the meal template (names + macro targets).
create table if not exists public.profiles (
  user_id      uuid primary key references auth.users on delete cascade,
  email        text,
  household_id uuid references public.households on delete set null,
  meals        jsonb not null default '[]'::jsonb,
  updated_at   timestamptz not null default now()
);

-- Food list: shared per kitchen. A food your friend adds shows up for you too.
create table if not exists public.foods (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  name         text not null,
  basis        text not null default '100g',   -- '100g' | 'piece'
  unit         text not null default 'g',
  p numeric not null default 0,
  c numeric not null default 0,
  f numeric not null default 0,
  kcal numeric not null default 0,
  mn numeric not null default 30,
  mx numeric not null default 300,
  st numeric not null default 10,
  role    text not null default 'protein',     -- protein | carb | fat | veg
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
create index if not exists foods_household_idx on public.foods(household_id);
-- Prevents the same food name being inserted twice for one kitchen (e.g. if
-- the initial upload ever races or retries). uploadFoods() in app.js relies
-- on this via upsert(...,{onConflict:'household_id,name'}).
do $$ begin
  alter table public.foods add constraint foods_household_name_uniq unique (household_id, name);
exception when duplicate_object then null;
end $$;

-- Daily plan: private to each user, keyed by date. History accumulates here.
create table if not exists public.days (
  user_id    uuid not null references auth.users on delete cascade,
  day        date not null,
  plan       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- Saved combinations: shared per kitchen.
create table if not exists public.combos (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  user_id      uuid references auth.users on delete set null,
  name         text not null,
  items        jsonb not null,
  macros       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists combos_household_idx on public.combos(household_id);

-- ---------------------------------------------------------------- helpers

-- Returns the caller's kitchen. security definer avoids infinite recursion
-- in RLS (the policy never reads the table that triggered it).
create or replace function public.my_household()
returns uuid language sql stable security definer set search_path = public as $$
  select household_id from public.profiles where user_id = auth.uid();
$$;

-- Every new signup automatically gets a kitchen and a profile.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare h uuid;
begin
  insert into public.households (name) values ('My kitchen') returning id into h;
  insert into public.household_members (household_id, user_id) values (h, new.id);
  insert into public.profiles (user_id, email, household_id) values (new.id, new.email, h);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Join a friend's kitchen with their invite code.
-- WARNING: if nobody else is left in your old kitchen, that kitchen (and its
-- food list) is deleted. Take a backup before joining.
create or replace function public.join_household(code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare h uuid; old_h uuid; still int;
begin
  select id into h from public.households where invite_code = upper(trim(code));
  if h is null then raise exception 'No kitchen with that invite code'; end if;

  select household_id into old_h from public.profiles where user_id = auth.uid();
  if old_h = h then return h; end if;

  update public.profiles set household_id = h, updated_at = now() where user_id = auth.uid();
  insert into public.household_members (household_id, user_id)
    values (h, auth.uid()) on conflict do nothing;

  if old_h is not null then
    delete from public.household_members where household_id = old_h and user_id = auth.uid();
    select count(*) into still from public.household_members where household_id = old_h;
    if still = 0 then delete from public.households where id = old_h; end if;
  end if;
  return h;
end $$;

-- ---------------------------------------------------------------- RLS

alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.profiles          enable row level security;
alter table public.foods             enable row level security;
alter table public.days              enable row level security;
alter table public.combos            enable row level security;

drop policy if exists h_read   on public.households;
drop policy if exists h_write  on public.households;
drop policy if exists hm_read  on public.household_members;
drop policy if exists p_all    on public.profiles;
drop policy if exists f_all    on public.foods;
drop policy if exists d_all    on public.days;
drop policy if exists c_all    on public.combos;

create policy h_read  on public.households        for select using (id = public.my_household());
create policy h_write on public.households        for update using (id = public.my_household())
                                                  with check (id = public.my_household());
create policy hm_read on public.household_members for select using (household_id = public.my_household());
create policy p_all   on public.profiles          for all    using (user_id = auth.uid())
                                                  with check (user_id = auth.uid());
create policy f_all   on public.foods             for all    using (household_id = public.my_household())
                                                  with check (household_id = public.my_household());
create policy d_all   on public.days              for all    using (user_id = auth.uid())
                                                  with check (user_id = auth.uid());
create policy c_all   on public.combos            for all    using (household_id = public.my_household())
                                                  with check (household_id = public.my_household());

-- ---------------------------------------------------------------- realtime
-- So a food your friend adds appears on your screen immediately.
do $$
begin
  begin alter publication supabase_realtime add table public.foods;  exception when others then null; end;
  begin alter publication supabase_realtime add table public.combos; exception when others then null; end;
end $$;
