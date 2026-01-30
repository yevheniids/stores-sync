-- ============================================================
-- Shopify Inventory Sync App — Supabase Database Schema
-- Run this in the Supabase SQL Editor (or via supabase db push)
-- ============================================================

-- 0. Helper: auto-update updated_at on row change
-- ============================================================
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;


-- 1. Enums
-- ============================================================
create type public.inventory_policy as enum ('DENY', 'CONTINUE');

create type public.sync_status as enum (
  'PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'RETRYING', 'CANCELLED'
);

create type public.operation_type as enum (
  'INVENTORY_UPDATE', 'PRODUCT_CREATE', 'PRODUCT_UPDATE', 'PRODUCT_DELETE',
  'PRICE_UPDATE', 'VARIANT_UPDATE', 'BULK_SYNC', 'INITIAL_SYNC'
);

create type public.sync_direction as enum (
  'CENTRAL_TO_STORE', 'STORE_TO_CENTRAL', 'BIDIRECTIONAL'
);

create type public.conflict_type as enum (
  'INVENTORY_MISMATCH', 'PRICE_MISMATCH', 'PRODUCT_DATA_MISMATCH',
  'VARIANT_MISSING', 'SKU_DUPLICATE', 'SYNC_COLLISION'
);

create type public.conflict_resolution_strategy as enum (
  'USE_LOWEST', 'USE_HIGHEST', 'USE_DATABASE', 'USE_STORE', 'MANUAL', 'AVERAGE'
);


-- 2. Tables
-- ============================================================

-- 2.1 Shopify App Bridge sessions
-- ============================================================
create table public.sessions (
  id          text primary key,
  shop        text not null,
  state       text not null,
  is_online   boolean not null default false,
  scope       text,
  expires     timestamptz,
  access_token text not null,
  user_id     bigint,
  first_name  text,
  last_name   text,
  email       text,
  account_owner boolean not null default false,
  locale      text,
  collaborator  boolean default false,
  email_verified boolean default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_sessions_shop on public.sessions (shop);

create trigger trg_sessions_updated_at
  before update on public.sessions
  for each row execute function public.set_updated_at();


-- 2.2 Connected Shopify stores
-- ============================================================
create table public.stores (
  id                text primary key default gen_random_uuid()::text,
  shop_domain       text not null unique,        -- e.g. "store-a.myshopify.com"
  shop_name         text not null,
  access_token      text not null,               -- encrypted at app level
  scope             text not null,
  is_active         boolean not null default true,
  installation_date timestamptz not null default now(),
  last_sync_at      timestamptz,

  -- metadata
  currency          text default 'USD',
  timezone          text,
  country           text,

  -- configuration
  sync_enabled      boolean not null default true,
  auto_sync_interval int default 300,            -- seconds

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_stores_shop_domain on public.stores (shop_domain);
create index idx_stores_is_active   on public.stores (is_active);

create trigger trg_stores_updated_at
  before update on public.stores
  for each row execute function public.set_updated_at();


-- 2.3 Central product registry (SKU-based)
-- ============================================================
create table public.products (
  id               text primary key default gen_random_uuid()::text,
  sku              text not null unique,         -- main identifier across stores
  title            text not null,
  description      text,

  vendor           text,
  product_type     text,
  tags             text[] default '{}',

  inventory_policy public.inventory_policy not null default 'DENY',
  tracks_inventory boolean not null default true,

  image_url        text,
  weight           double precision,
  weight_unit      text default 'g',

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index idx_products_sku          on public.products (sku);
create index idx_products_vendor       on public.products (vendor);
create index idx_products_product_type on public.products (product_type);

create trigger trg_products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();


-- 2.4 Product ↔ Store variant mappings
-- ============================================================
create table public.product_store_mappings (
  id                      text primary key default gen_random_uuid()::text,

  product_id              text not null references public.products(id) on delete cascade,
  store_id                text not null references public.stores(id)   on delete cascade,

  -- Shopify identifiers
  shopify_product_id      text not null,   -- gid://shopify/Product/...
  shopify_variant_id      text not null,   -- gid://shopify/ProductVariant/...
  shopify_inventory_item_id text,          -- gid://shopify/InventoryItem/...

  -- store-specific pricing/data
  price                   double precision,
  compare_at_price        double precision,
  store_sku               text,            -- store may remap sku
  barcode                 text,

  -- sync state
  last_synced_at          timestamptz,
  sync_status             public.sync_status not null default 'PENDING',
  sync_error_message      text,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  unique (product_id, store_id),
  unique (store_id, shopify_variant_id)
);

create index idx_psm_product_id          on public.product_store_mappings (product_id);
create index idx_psm_store_id            on public.product_store_mappings (store_id);
create index idx_psm_shopify_product_id  on public.product_store_mappings (shopify_product_id);
create index idx_psm_shopify_variant_id  on public.product_store_mappings (shopify_variant_id);
create index idx_psm_sync_status         on public.product_store_mappings (sync_status);

create trigger trg_psm_updated_at
  before update on public.product_store_mappings
  for each row execute function public.set_updated_at();


-- 2.5 Central inventory (Single Source of Truth)
-- ============================================================
create table public.inventory (
  id                  text primary key default gen_random_uuid()::text,

  product_id          text not null unique references public.products(id) on delete cascade,

  available_quantity  int not null default 0,
  committed_quantity  int not null default 0,     -- reserved by orders
  incoming_quantity   int not null default 0,     -- expected from suppliers

  low_stock_threshold int default 10,

  -- optimistic locking
  version             int not null default 1,

  last_counted_at     timestamptz,
  last_adjusted_at    timestamptz,
  last_adjusted_by    text,                       -- user / system id

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint chk_available_non_negative check (available_quantity >= 0)
);

create index idx_inventory_product_id         on public.inventory (product_id);
create index idx_inventory_available_quantity on public.inventory (available_quantity);

create trigger trg_inventory_updated_at
  before update on public.inventory
  for each row execute function public.set_updated_at();


-- 2.6 Webhook event tracking (idempotency)
-- ============================================================
create table public.webhook_events (
  id              text primary key default gen_random_uuid()::text,

  event_id        text not null unique,           -- X-Shopify-Event-Id
  topic           text not null,                  -- e.g. "orders/create"
  shop_domain     text not null,

  payload         jsonb not null default '{}',
  processed       boolean not null default false,
  processed_at    timestamptz,

  error_message   text,
  retry_count     int not null default 0,
  max_retries     int not null default 3,

  received_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_we_event_id    on public.webhook_events (event_id);
create index idx_we_topic       on public.webhook_events (topic);
create index idx_we_shop_domain on public.webhook_events (shop_domain);
create index idx_we_processed   on public.webhook_events (processed);
create index idx_we_received_at on public.webhook_events (received_at);

create trigger trg_webhook_events_updated_at
  before update on public.webhook_events
  for each row execute function public.set_updated_at();


-- 2.7 Sync operations audit log
-- ============================================================
create table public.sync_operations (
  id              text primary key default gen_random_uuid()::text,

  operation_type  public.operation_type  not null,
  direction       public.sync_direction  not null,

  product_id      text references public.products(id) on delete set null,
  store_id        text references public.stores(id)   on delete set null,

  status          public.sync_status not null default 'PENDING',
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,

  previous_value  jsonb,
  new_value       jsonb,

  error_message   text,
  retry_count     int not null default 0,
  max_retries     int not null default 3,

  triggered_by    text,                           -- webhook | manual | scheduled | api
  user_id         text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_so_operation_type on public.sync_operations (operation_type);
create index idx_so_status         on public.sync_operations (status);
create index idx_so_product_id     on public.sync_operations (product_id);
create index idx_so_store_id       on public.sync_operations (store_id);
create index idx_so_started_at     on public.sync_operations (started_at);
create index idx_so_triggered_by   on public.sync_operations (triggered_by);

create trigger trg_sync_operations_updated_at
  before update on public.sync_operations
  for each row execute function public.set_updated_at();


-- 2.8 Detected conflicts
-- ============================================================
create table public.conflicts (
  id                   text primary key default gen_random_uuid()::text,

  conflict_type        public.conflict_type not null,

  product_id           text not null references public.products(id) on delete cascade,
  store_id             text not null references public.stores(id)   on delete cascade,

  central_value        jsonb not null,
  store_value          jsonb not null,
  detected_at          timestamptz not null default now(),

  resolution_strategy  public.conflict_resolution_strategy not null default 'USE_DATABASE',
  resolved             boolean not null default false,
  resolved_at          timestamptz,
  resolved_by          text,
  resolved_value       jsonb,

  notes                text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index idx_conflicts_conflict_type on public.conflicts (conflict_type);
create index idx_conflicts_product_id    on public.conflicts (product_id);
create index idx_conflicts_store_id      on public.conflicts (store_id);
create index idx_conflicts_resolved      on public.conflicts (resolved);
create index idx_conflicts_detected_at   on public.conflicts (detected_at);

create trigger trg_conflicts_updated_at
  before update on public.conflicts
  for each row execute function public.set_updated_at();


-- 3. Row Level Security
-- ============================================================
-- Enable RLS on every table (Supabase requirement).
-- The app uses the service_role key, so policies are permissive.
-- Tighten as needed when you add end-user access.

alter table public.sessions                enable row level security;
alter table public.stores                  enable row level security;
alter table public.products                enable row level security;
alter table public.product_store_mappings  enable row level security;
alter table public.inventory               enable row level security;
alter table public.webhook_events          enable row level security;
alter table public.sync_operations         enable row level security;
alter table public.conflicts               enable row level security;

-- Service-role has full access (used by the Remix backend)
create policy "service_role_all" on public.sessions               for all using (true) with check (true);
create policy "service_role_all" on public.stores                 for all using (true) with check (true);
create policy "service_role_all" on public.products               for all using (true) with check (true);
create policy "service_role_all" on public.product_store_mappings for all using (true) with check (true);
create policy "service_role_all" on public.inventory              for all using (true) with check (true);
create policy "service_role_all" on public.webhook_events         for all using (true) with check (true);
create policy "service_role_all" on public.sync_operations        for all using (true) with check (true);
create policy "service_role_all" on public.conflicts              for all using (true) with check (true);


-- 4. Utility functions
-- ============================================================

-- 4.1 Atomic inventory update with optimistic locking
create or replace function public.update_inventory_atomic(
  p_product_id       text,
  p_new_available    int,
  p_new_committed    int,
  p_expected_version int,
  p_adjusted_by      text default 'system'
)
returns table (
  success boolean,
  current_version int
) as $$
declare
  v_rows int;
  v_ver  int;
begin
  update public.inventory
  set
    available_quantity = p_new_available,
    committed_quantity = p_new_committed,
    version            = version + 1,
    last_adjusted_at   = now(),
    last_adjusted_by   = p_adjusted_by
  where product_id = p_product_id
    and version    = p_expected_version
    and p_new_available >= 0;

  get diagnostics v_rows = row_count;

  select i.version into v_ver
  from public.inventory i
  where i.product_id = p_product_id;

  return query select (v_rows > 0), coalesce(v_ver, 0);
end;
$$ language plpgsql;


-- 4.2 Clean up old webhook events (>7 days)
create or replace function public.cleanup_old_webhook_events()
returns int as $$
declare
  v_deleted int;
begin
  delete from public.webhook_events
  where received_at < now() - interval '7 days'
    and processed = true;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$ language plpgsql;


-- 4.3 Dashboard stats (single call from the app)
create or replace function public.get_dashboard_stats()
returns jsonb as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'total_products',      (select count(*) from public.products),
    'total_stores',        (select count(*) from public.stores where is_active = true),
    'total_inventory',     (select coalesce(sum(available_quantity), 0) from public.inventory),
    'low_stock_count',     (select count(*) from public.inventory
                            where available_quantity <= coalesce(low_stock_threshold, 10)),
    'pending_conflicts',   (select count(*) from public.conflicts where resolved = false),
    'recent_syncs_24h',    (select count(*) from public.sync_operations
                            where started_at > now() - interval '24 hours'),
    'failed_syncs_24h',    (select count(*) from public.sync_operations
                            where started_at > now() - interval '24 hours'
                              and status = 'FAILED'),
    'unprocessed_webhooks',(select count(*) from public.webhook_events where processed = false)
  ) into v_result;

  return v_result;
end;
$$ language plpgsql;


-- 5. Cron-compatible: schedule webhook cleanup (use pg_cron or Supabase cron)
-- Example (enable pg_cron extension in Supabase dashboard first):
--
--   select cron.schedule(
--     'cleanup-webhook-events',
--     '0 3 * * *',                -- daily at 03:00 UTC
--     $$ select public.cleanup_old_webhook_events() $$
--   );
