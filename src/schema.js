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
  // sales tracker
  `create table if not exists tk_clicks (
    id text primary key, link_id text references links(id) on delete set null, at text not null,
    source text not null default 'other', campaign text, adset text, ad text, keyword text,
    gclid text, nb_callback text, country text, device text)`,
  `create index if not exists tk_clicks_at on tk_clicks(at)`,
  `create table if not exists tk_conversions (
    id text primary key, click_id text, network text not null, txid text not null,
    type text not null check (type in ('sale','upsell','refund','chargeback')),
    amount_cents integer not null default 0, currency text not null default 'USD', at text not null,
    unique (network, txid, type))`,
  `create index if not exists tk_conversions_at on tk_conversions(at)`,
  `create index if not exists tk_conversions_click on tk_conversions(click_id)`,
  `create table if not exists tk_costs (
    date text not null, source text not null, campaign_key text not null, campaign_name text,
    cost_cents integer not null default 0, currency text not null default 'BRL',
    clicks integer not null default 0, impressions integer not null default 0, updated_at text not null,
    primary key (date, source, campaign_key))`,
  `create table if not exists tk_demo (
    date text not null, campaign_key text not null, dim text not null check (dim in ('age','gender')), bucket text not null,
    cost_cents integer not null default 0, currency text not null default 'BRL', clicks integer not null default 0,
    impressions integer not null default 0, conversions real not null default 0, updated_at text not null,
    primary key (date, campaign_key, dim, bucket))`,
  `create table if not exists push_subs (
    id text primary key, endpoint text not null unique, p256dh text not null, auth text not null,
    label text, created_at text not null, last_ok_at text)`,
  `create table if not exists tk_events (
    id integer primary key autoincrement, at text not null, network text, outcome text not null, detail text, raw text)`,
];

// Columns added after the first release. Each runs on its own; "duplicate column" means done.
export const MIGRATIONS = [
  `alter table clicks add column country text`,
  `alter table clicks add column device text`,
  `alter table clicks add column os text`,
  `alter table clicks add column blocked integer not null default 0`,
  `alter table clicks add column ip text`,
  `alter table clicks add column city text`,
  `alter table clicks add column region text`,
  `alter table clicks add column asn integer`,
  `alter table clicks add column as_org text`,
  `alter table links add column geo_mode text not null default 'off'`,
  `alter table links add column geo_countries text not null default ''`,
  `alter table links add column track integer not null default 0`,
  `alter table links add column network text`,
  `alter table links add column sub_param text`,
  `alter table links add column track_source text`,
  `alter table tk_conversions add column product text`,
  `alter table tk_conversions add column gads_sent_at text`,
  `alter table tk_conversions add column gads_tries integer`,
  `alter table tk_conversions add column gads_error text`,
  `alter table tk_conversions add column country text`,
];
