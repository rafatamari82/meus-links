// Runs on every cold start; every statement is idempotent.
export const SCHEMA = [
  `create table if not exists settings (key text primary key, value text not null)`,
  `create table if not exists users (
    id text primary key, email text not null unique collate nocase, password_hash text not null,
    created_at text not null, updated_at text not null)`,
  `create table if not exists domains (
    id text primary key,
    user_id text not null references users(id) on delete cascade,
    full_name text not null unique collate nocase,
    type text not null default 'user' check (type in ('service','user')),
    active integer not null default 0 check (active in (0,1)),
    is_default integer not null default 0 check (is_default in (0,1)),
    not_found_url text, verified_at text, last_check_error text,
    created_at text not null, updated_at text not null)`,
  `create index if not exists domains_user on domains(user_id)`,
  `create table if not exists links (
    id text primary key,
    user_id text not null references users(id) on delete cascade,
    domain_id text not null references domains(id) on delete restrict,
    slashtag text not null, slashtag_lower text not null,
    destination text not null check (destination like 'http://%' or destination like 'https://%'),
    title text,
    favourite integer not null default 0 check (favourite in (0,1)),
    forward_parameters integer not null default 1 check (forward_parameters in (0,1)),
    clicks integer not null default 0, last_click_at text,
    created_at text not null, updated_at text not null,
    unique (domain_id, slashtag_lower))`,
  `create index if not exists links_user_created on links(user_id, created_at)`,
  `create index if not exists links_domain on links(domain_id)`,
  `create table if not exists clicks (
    id integer primary key autoincrement,
    link_id text not null references links(id) on delete cascade,
    at text not null, referrer_host text, user_agent text,
    is_bot integer not null default 0 check (is_bot in (0,1)))`,
  `create index if not exists clicks_link_at on clicks(link_id, at)`,
  `create table if not exists login_attempts (ip text not null, at integer not null)`,
  `create index if not exists login_attempts_ip on login_attempts(ip, at)`,
];

// Columns added after the first release. Each runs on its own; "duplicate column" means done.
export const MIGRATIONS = [
  `alter table clicks add column country text`,
  `alter table clicks add column device text`,
  `alter table clicks add column os text`,
];
