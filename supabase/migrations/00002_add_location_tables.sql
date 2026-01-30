-- ============================================================
-- Add store_locations and inventory_locations tables
-- These tables support per-location inventory tracking
-- ============================================================

-- 2.9 Store locations (physical locations within stores)
-- ============================================================
create table public.store_locations (
  id                  text primary key default gen_random_uuid()::text,

  -- Store reference
  store_id            text not null references public.stores(id) on delete cascade,

  -- Shopify location ID (GID format: gid://shopify/Location/...)
  shopify_location_id text not null,

  -- Location details
  name                text not null,
  is_active           boolean not null default true,
  address1            text,
  city                text,
  province            text,
  country             text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (store_id, shopify_location_id)
);

create index idx_store_locations_store_id on public.store_locations (store_id);
create index idx_store_locations_shopify_location_id on public.store_locations (shopify_location_id);
create index idx_store_locations_is_active on public.store_locations (is_active);

create trigger trg_store_locations_updated_at
  before update on public.store_locations
  for each row execute function public.set_updated_at();


-- 2.10 Inventory at specific locations (per-location inventory)
-- ============================================================
create table public.inventory_locations (
  id                  text primary key default gen_random_uuid()::text,

  -- Product reference
  product_id          text not null references public.products(id) on delete cascade,

  -- Location reference
  store_location_id   text not null references public.store_locations(id) on delete cascade,

  -- Inventory quantities
  available_quantity  int not null default 0,
  committed_quantity  int not null default 0,
  incoming_quantity    int not null default 0,

  -- Metadata
  last_adjusted_at    timestamptz,
  last_adjusted_by    text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (product_id, store_location_id),
  constraint chk_inventory_locations_available_non_negative check (available_quantity >= 0)
);

create index idx_inventory_locations_product_id on public.inventory_locations (product_id);
create index idx_inventory_locations_store_location_id on public.inventory_locations (store_location_id);
create index idx_inventory_locations_available_quantity on public.inventory_locations (available_quantity);

create trigger trg_inventory_locations_updated_at
  before update on public.inventory_locations
  for each row execute function public.set_updated_at();


-- 3. Row Level Security for new tables
-- ============================================================
alter table public.store_locations      enable row level security;
alter table public.inventory_locations enable row level security;

-- Service-role has full access (used by the Remix backend)
create policy "service_role_all" on public.store_locations      for all using (true) with check (true);
create policy "service_role_all" on public.inventory_locations  for all using (true) with check (true);
