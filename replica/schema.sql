-- SQLite schema. ids: UUID text. times: ISO 8601 UTC text.
pragma foreign_keys = on;

create table if not exists users (
  id text primary key,
  email text not null unique collate nocase,
  password_hash text not null,
  created_at text not null,
  updated_at text not null
);

create table if not exists domains (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  full_name text not null unique collate nocase,
  type text not null default 'user' check (type in ('service','user')),
  active integer not null default 0 check (active in (0,1)),
  is_default integer not null default 0 check (is_default in (0,1)),
  not_found_url text,
  verified_at text,
  last_check_error text,
  created_at text not null,
  updated_at text not null
);
create index if not exists domains_user on domains(user_id);

create table if not exists links (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  -- restrict: a domain with links cannot be removed by accident
  domain_id text not null references domains(id) on delete restrict,
  slashtag text not null,
  slashtag_lower text not null,
  destination text not null
    check (destination like 'http://%' or destination like 'https://%'),
  title text,
  favourite integer not null default 0 check (favourite in (0,1)),
  forward_parameters integer not null default 1 check (forward_parameters in (0,1)),
  clicks integer not null default 0,
  last_click_at text,
  created_at text not null,
  updated_at text not null,
  unique (domain_id, slashtag_lower)
);
create index if not exists links_user_created on links(user_id, created_at);
create index if not exists links_domain on links(domain_id);

create table if not exists tags (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  name text not null,
  color text,
  created_at text not null,
  unique (user_id, name)
);

create table if not exists link_tags (
  link_id text not null references links(id) on delete cascade,
  tag_id text not null references tags(id) on delete cascade,
  primary key (link_id, tag_id)
);
create index if not exists link_tags_tag on link_tags(tag_id);

create table if not exists clicks (
  id integer primary key autoincrement,
  link_id text not null references links(id) on delete cascade,
  at text not null,
  referrer_host text,
  user_agent text,
  is_bot integer not null default 0 check (is_bot in (0,1))
);
create index if not exists clicks_link_at on clicks(link_id, at);
