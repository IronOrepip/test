-- NOVA shop, phase 1 schema.
-- Row-level security is on for every table. The Worker uses the service-role key and talks to
-- the database only through the api_* functions below, which are not callable by anon or
-- signed-in customers. Customers can read only their own profile, orders and order items.

-- ---------- Catalogue ----------
create table public.products (
  id text primary key,                       -- product SKU
  slug text not null unique,
  type text not null check (type in ('standard', 'website')),   -- extend here for custom-printed products
  category text not null,
  featured boolean not null default false,
  active boolean not null default true,
  sort integer not null default 0,
  min_quantity integer not null default 1 check (min_quantity > 0),
  quantity_step integer not null default 1 check (quantity_step > 0),
  max_online_quantity integer not null default 200 check (max_online_quantity > 0),
  low_stock_threshold integer,
  dispatch_days integer,
  weight_grams integer,
  tax_code text,
  regions text[] not null default array['eu_eea'],
  images jsonb not null default '[]',
  setup_fields jsonb not null default '[]',
  demo_url text,
  customs jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_translations (
  product_id text not null references public.products on delete cascade,
  lang text not null,
  name text not null,
  short_description text,
  description text,
  primary key (product_id, lang)
);

create table public.variants (
  id text primary key,                       -- variant SKU
  product_id text not null references public.products on delete cascade,
  options jsonb not null default '{}',
  stock integer check (stock is null or stock >= 0),   -- null = not stock-tracked (websites)
  active boolean not null default true,
  sort integer not null default 0
);
create index variants_product_idx on public.variants (product_id);

create table public.price_breaks (
  id bigint generated always as identity primary key,
  product_id text not null references public.products on delete cascade,
  variant_id text references public.variants on delete cascade,   -- null = applies to every variant
  currency text not null default 'EUR',
  min_quantity integer not null check (min_quantity > 0),
  unit_amount integer not null check (unit_amount >= 0),          -- cents, excluding VAT
  billing text not null default 'one_off' check (billing in ('one_off', 'monthly', 'yearly', 'setup_fee'))
);
create index price_breaks_product_idx on public.price_breaks (product_id, currency);

-- ---------- Customers ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'customer' check (role in ('customer', 'admin')),
  language text not null default 'en',
  created_at timestamptz not null default now()
);
-- There is exactly one admin.
create unique index profiles_one_admin on public.profiles (role) where role = 'admin';

-- ---------- Orders ----------
create sequence public.order_number_seq start 1001;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  status text not null default 'pending' check (status in ('pending', 'paid', 'awaiting_details', 'in_setup', 'ready_for_review', 'packed', 'shipped', 'delivered', 'cancelled', 'refunded', 'partially_refunded')),
  customer_id uuid references auth.users (id) on delete set null,
  email text,
  customer_name text,
  language text not null default 'en',
  currency text not null default 'EUR',
  region text not null,
  shipping_country text,
  payment_provider text not null,
  provider_session_id text unique,
  provider_payment_id text,
  provider_customer_id text,
  invoice_url text,
  subtotal bigint not null default 0,
  shipping_amount bigint not null default 0,
  tax_amount bigint not null default 0,
  total bigint not null default 0,
  amount_refunded bigint not null default 0,
  shipping_address jsonb,
  billing_address jsonb,
  vat_id text,
  marketing_consent boolean not null default false,
  withdrawal_waiver_at timestamptz,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now()
);
create index orders_customer_idx on public.orders (customer_id);
create index orders_email_idx on public.orders (lower(email));
create index orders_payment_idx on public.orders (provider_payment_id);

create table public.order_items (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders on delete cascade,
  product_id text not null references public.products,
  variant_id text not null references public.variants,
  product_type text not null,
  name text not null,
  options jsonb not null default '{}',
  quantity integer not null check (quantity > 0),
  unit_amount integer not null,
  line_total bigint not null
);
create index order_items_order_idx on public.order_items (order_id);

create table public.order_status_log (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders on delete cascade,
  from_status text,
  to_status text not null,
  actor text not null,                       -- 'system', 'stripe', 'customer' or the admin's user id
  note text,
  created_at timestamptz not null default now()
);
create index order_status_log_order_idx on public.order_status_log (order_id);

create table public.stock_reservations (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders on delete cascade,
  variant_id text not null references public.variants,
  quantity integer not null check (quantity > 0),
  expires_at timestamptz not null,
  released_at timestamptz
);
create index stock_reservations_live_idx on public.stock_reservations (variant_id) where released_at is null;

create table public.back_in_stock_requests (
  id bigint generated always as identity primary key,
  variant_id text not null references public.variants on delete cascade,
  email text not null,
  language text not null default 'en',
  created_at timestamptz not null default now(),
  notified_at timestamptz,
  unique (variant_id, email)
);

-- ---------- System ----------
create table public.webhook_events (
  provider text not null,
  event_id text not null,
  type text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text,
  primary key (provider, event_id)
);

create table public.email_log (
  id bigint generated always as identity primary key,
  order_id uuid references public.orders on delete set null,
  template text not null,
  to_email text not null,
  language text not null default 'en',
  payload jsonb,                             -- what is needed to send it again
  provider_id text,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  error text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index email_log_order_idx on public.email_log (order_id);

create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);

-- ---------- Row-level security ----------
alter table public.products enable row level security;
alter table public.product_translations enable row level security;
alter table public.variants enable row level security;
alter table public.price_breaks enable row level security;
alter table public.profiles enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_log enable row level security;
alter table public.stock_reservations enable row level security;
alter table public.back_in_stock_requests enable row level security;
alter table public.webhook_events enable row level security;
alter table public.email_log enable row level security;
alter table public.rate_limits enable row level security;

-- A signed-in customer reads only their own rows. Nobody but the service role writes.
create policy profiles_own on public.profiles for select to authenticated using (id = auth.uid());
create policy orders_own on public.orders for select to authenticated using (customer_id = auth.uid());
create policy order_items_own on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_items.order_id and o.customer_id = auth.uid()));
-- Every other table has no policy: only the service role (the Worker) can reach it.

-- ---------- Helpers ----------
create function public.unit_price(p_product text, p_variant text, p_currency text, p_quantity integer)
returns integer language sql stable set search_path = public as $$
  select b.unit_amount from price_breaks b
  where b.product_id = p_product and b.currency = p_currency and b.billing in ('one_off', 'setup_fee') and b.min_quantity <= p_quantity
    and (b.variant_id = p_variant
      or (b.variant_id is null and not exists (
        select 1 from price_breaks o where o.product_id = p_product and o.variant_id = p_variant and o.currency = p_currency)))
  order by b.min_quantity desc limit 1
$$;

-- Stock on hand minus live reservations. Null for items that are not stock-tracked.
create function public.available_stock(p_variant text)
returns integer language sql stable set search_path = public as $$
  select case when v.stock is null then null else greatest(v.stock - coalesce((
    select sum(r.quantity) from stock_reservations r
    where r.variant_id = v.id and r.released_at is null and r.expires_at > now()), 0), 0)::integer end
  from variants v where v.id = p_variant
$$;

create function public.order_json(p_order uuid)
returns jsonb language sql stable set search_path = public as $$
  select to_jsonb(o) || jsonb_build_object('items', coalesce((
    select jsonb_agg(to_jsonb(i) || jsonb_build_object('slug', p.slug, 'image', p.images -> 0 ->> 'src') order by i.id)
    from order_items i join products p on p.id = i.product_id where i.order_id = o.id), '[]'::jsonb))
  from orders o where o.id = p_order
$$;

-- ---------- API functions (service role only) ----------
create function public.api_catalog(payload jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'type', p.type, 'category', p.category, 'regions', p.regions,
    'min_quantity', p.min_quantity, 'quantity_step', p.quantity_step, 'max_online_quantity', p.max_online_quantity,
    'low_stock_threshold', p.low_stock_threshold,
    'variants', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'options', v.options, 'available', available_stock(v.id)) order by v.sort), '[]'::jsonb)
                 from variants v where v.product_id = p.id and v.active),
    'price_breaks', (select coalesce(jsonb_agg(jsonb_build_object('variant_id', b.variant_id, 'min_quantity', b.min_quantity, 'unit_amount', b.unit_amount, 'billing', b.billing) order by b.min_quantity), '[]'::jsonb)
                     from price_breaks b where b.product_id = p.id and b.currency = coalesce(payload ->> 'currency', 'EUR'))
  ) order by p.sort), '[]'::jsonb)
  from products p
  where p.active and (payload ->> 'id' is null or p.id = payload ->> 'id')
$$;

-- Prices a cart from the database. The browser sends only ids and quantities.
create function public.api_price_cart(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  item jsonb; lines jsonb := '[]'::jsonb;
  v_lang text := coalesce(payload ->> 'lang', 'en');
  v_currency text := coalesce(payload ->> 'currency', 'EUR');
  v_region text := payload ->> 'region';
  p products; v variants;
  q integer; avail integer; price integer; st text; nm text;
  v_subtotal bigint := 0; all_ok boolean := true; n integer := 0;
  has_physical boolean := false; has_website boolean := false;
begin
  for item in select * from jsonb_array_elements(coalesce(payload -> 'items', '[]'::jsonb)) loop
    n := n + 1;
    q := case when item ->> 'quantity' ~ '^[0-9]{1,6}$' then (item ->> 'quantity')::integer else 0 end;
    p := null; v := null;
    select * into p from products where id = item ->> 'product_id' and active;
    if p.id is not null then
      select * into v from variants where id = item ->> 'variant_id' and product_id = p.id and active;
    end if;
    if p.id is null or v.id is null then
      lines := lines || jsonb_build_object('product_id', item ->> 'product_id', 'variant_id', item ->> 'variant_id', 'quantity', q, 'status', 'unavailable');
      all_ok := false;
      continue;
    end if;
    avail := available_stock(v.id);
    price := unit_price(p.id, v.id, v_currency, greatest(q, p.min_quantity));
    select coalesce((select name from product_translations where product_id = p.id and lang = v_lang),
                    (select name from product_translations where product_id = p.id and lang = 'en'), p.id) into nm;
    st := case
      when price is null then 'unavailable'
      when v_region is not null and not (v_region = any (p.regions)) then 'region_excluded'
      when q > p.max_online_quantity then 'over_max'
      when q < p.min_quantity or (q - p.min_quantity) % p.quantity_step <> 0 then 'invalid_quantity'
      when avail is not null and avail = 0 then 'out_of_stock'
      when avail is not null and q > avail then 'insufficient_stock'
      else 'ok' end;
    if st = 'ok' then
      v_subtotal := v_subtotal + price::bigint * q;
      if p.type = 'website' then has_website := true; else has_physical := true; end if;
    else
      all_ok := false;
    end if;
    lines := lines || jsonb_build_object(
      'product_id', p.id, 'variant_id', v.id, 'quantity', q, 'status', st, 'name', nm, 'slug', p.slug, 'type', p.type,
      'options', v.options, 'image', p.images -> 0 ->> 'src', 'unit_amount', price, 'line_total', price::bigint * q,
      'available', avail, 'min_quantity', p.min_quantity, 'quantity_step', p.quantity_step, 'max_online_quantity', p.max_online_quantity,
      'tax_code', p.tax_code);
  end loop;
  return jsonb_build_object('lines', lines, 'subtotal', v_subtotal, 'currency', v_currency,
    'ok', all_ok and n > 0, 'has_physical', has_physical, 'has_website', has_website);
end $$;

-- Creates a pending order and reserves stock in one transaction.
-- Variant rows are locked in id order, so two buyers racing for the last items are served one
-- after the other and the second one sees how many are left.
create function public.api_create_order(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  priced jsonb; line jsonb; v_order orders; v_minutes integer := coalesce((payload ->> 'reservation_minutes')::integer, 35);
begin
  perform 1 from variants
  where id in (select e ->> 'variant_id' from jsonb_array_elements(coalesce(payload -> 'items', '[]'::jsonb)) e)
  order by id for update;

  priced := api_price_cart(payload);
  if not (priced ->> 'ok')::boolean then
    return jsonb_build_object('error', 'cart_invalid', 'cart', priced);
  end if;

  insert into orders (number, region, shipping_country, payment_provider, currency, language, email, customer_id,
                      subtotal, shipping_amount, total, marketing_consent, withdrawal_waiver_at)
  values (coalesce(payload ->> 'order_prefix', 'NOVA-') || nextval('order_number_seq'),
          payload ->> 'region', payload ->> 'country', payload ->> 'payment_provider', priced ->> 'currency',
          coalesce(payload ->> 'lang', 'en'), nullif(payload ->> 'email', ''), nullif(payload ->> 'customer_id', '')::uuid,
          (priced ->> 'subtotal')::bigint, coalesce((payload ->> 'shipping_amount')::bigint, 0),
          (priced ->> 'subtotal')::bigint + coalesce((payload ->> 'shipping_amount')::bigint, 0),
          coalesce((payload ->> 'marketing_consent')::boolean, false),
          case when (priced ->> 'has_website')::boolean and coalesce((payload ->> 'waiver')::boolean, false) then now() end)
  returning * into v_order;

  for line in select * from jsonb_array_elements(priced -> 'lines') loop
    insert into order_items (order_id, product_id, variant_id, product_type, name, options, quantity, unit_amount, line_total)
    values (v_order.id, line ->> 'product_id', line ->> 'variant_id', line ->> 'type', line ->> 'name', line -> 'options',
            (line ->> 'quantity')::integer, (line ->> 'unit_amount')::integer, (line ->> 'line_total')::bigint);
    if line ->> 'available' is not null then
      insert into stock_reservations (order_id, variant_id, quantity, expires_at)
      values (v_order.id, line ->> 'variant_id', (line ->> 'quantity')::integer, now() + make_interval(mins => v_minutes));
    end if;
  end loop;

  insert into order_status_log (order_id, from_status, to_status, actor, note) values (v_order.id, null, 'pending', 'system', 'Checkout started');
  return jsonb_build_object('order', order_json(v_order.id), 'cart', priced);
end $$;

create function public.api_attach_session(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update orders set provider_session_id = payload ->> 'session_id', updated_at = now() where id = (payload ->> 'order_id')::uuid;
  return jsonb_build_object('ok', found);
end $$;

create function public.api_get_order(payload jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  select order_json(o.id) from orders o
  where (payload ->> 'order_id' is not null and o.id = (payload ->> 'order_id')::uuid)
     or (payload ->> 'session_id' is not null and o.provider_session_id = payload ->> 'session_id')
     or (payload ->> 'payment_id' is not null and o.provider_payment_id = payload ->> 'payment_id')
  limit 1
$$;

-- Marks an order paid. Safe to call twice: the second call changes nothing.
create function public.api_mark_paid(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o orders; it record; v_new text; v_customer uuid; v_email text;
  low jsonb := '[]'::jsonb; oversold jsonb := '[]'::jsonb; v_left integer;
begin
  select * into o from orders where id = (payload ->> 'order_id')::uuid for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if o.status not in ('pending', 'cancelled') then
    return jsonb_build_object('already', true, 'order', order_json(o.id));
  end if;

  for it in select i.variant_id, i.quantity, v.stock, p.low_stock_threshold, p.id as product_id
            from order_items i join variants v on v.id = i.variant_id join products p on p.id = i.product_id
            where i.order_id = o.id and v.stock is not null order by v.id for update of v loop
    if it.stock < it.quantity then
      oversold := oversold || jsonb_build_object('variant_id', it.variant_id, 'ordered', it.quantity, 'stock', it.stock);
    end if;
    update variants set stock = greatest(stock - it.quantity, 0) where id = it.variant_id returning stock into v_left;
    if it.low_stock_threshold is not null and v_left <= it.low_stock_threshold then
      low := low || jsonb_build_object('variant_id', it.variant_id, 'stock', v_left, 'threshold', it.low_stock_threshold);
    end if;
  end loop;
  update stock_reservations set released_at = now() where order_id = o.id and released_at is null;

  v_email := coalesce(nullif(payload ->> 'email', ''), o.email);
  -- Link the order to an account only when that account's email is verified.
  select u.id into v_customer from auth.users u where lower(u.email) = lower(v_email) and u.email_confirmed_at is not null limit 1;
  v_new := case when exists (select 1 from order_items where order_id = o.id and product_type = 'website') then 'awaiting_details' else 'paid' end;

  update orders set
    status = v_new, paid_at = now(), updated_at = now(), email = v_email,
    customer_name = coalesce(payload ->> 'name', customer_name),
    customer_id = coalesce(customer_id, v_customer),
    provider_payment_id = coalesce(payload ->> 'payment_id', provider_payment_id),
    provider_customer_id = coalesce(payload ->> 'customer_id', provider_customer_id),
    invoice_url = coalesce(payload ->> 'invoice_url', invoice_url),
    subtotal = coalesce((payload ->> 'subtotal')::bigint, subtotal),
    shipping_amount = coalesce((payload ->> 'shipping_amount')::bigint, shipping_amount),
    tax_amount = coalesce((payload ->> 'tax_amount')::bigint, tax_amount),
    total = coalesce((payload ->> 'total')::bigint, total),
    shipping_address = coalesce(payload -> 'shipping_address', shipping_address),
    billing_address = coalesce(payload -> 'billing_address', billing_address),
    shipping_country = coalesce(payload -> 'shipping_address' ->> 'country', shipping_country),
    vat_id = coalesce(payload ->> 'vat_id', vat_id),
    marketing_consent = marketing_consent or coalesce((payload ->> 'marketing_consent')::boolean, false)
  where id = o.id;
  insert into order_status_log (order_id, from_status, to_status, actor, note)
  values (o.id, o.status, v_new, coalesce(payload ->> 'actor', 'system'), 'Payment confirmed');

  return jsonb_build_object('already', false, 'order', order_json(o.id), 'low_stock', low, 'oversold', oversold,
                            'was_cancelled', o.status = 'cancelled');
end $$;

-- Delayed payment methods: keep the stock held while the bank confirms.
create function public.api_hold_for_async(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update stock_reservations set expires_at = now() + make_interval(days => coalesce((payload ->> 'days')::integer, 14))
  where order_id = (payload ->> 'order_id')::uuid and released_at is null;
  update orders set email = coalesce(nullif(payload ->> 'email', ''), email), updated_at = now() where id = (payload ->> 'order_id')::uuid;
  return jsonb_build_object('order', order_json((payload ->> 'order_id')::uuid));
end $$;

create function public.api_cancel_order(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  select * into o from orders where id = (payload ->> 'order_id')::uuid for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if o.status <> 'pending' then return jsonb_build_object('changed', false, 'order', order_json(o.id)); end if;
  update stock_reservations set released_at = now() where order_id = o.id and released_at is null;
  update orders set status = 'cancelled', updated_at = now() where id = o.id;
  insert into order_status_log (order_id, from_status, to_status, actor, note)
  values (o.id, 'pending', 'cancelled', coalesce(payload ->> 'actor', 'system'), payload ->> 'note');
  return jsonb_build_object('changed', true, 'order', order_json(o.id));
end $$;

create function public.api_refund(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o orders; v_new text; v_refunded bigint := (payload ->> 'amount_refunded')::bigint;
begin
  select * into o from orders where provider_payment_id = payload ->> 'payment_id' for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  v_new := case when v_refunded >= o.total then 'refunded' else 'partially_refunded' end;
  if o.status = v_new and o.amount_refunded = v_refunded then
    return jsonb_build_object('changed', false, 'order', order_json(o.id));
  end if;
  update orders set status = v_new, amount_refunded = v_refunded, updated_at = now() where id = o.id;
  insert into order_status_log (order_id, from_status, to_status, actor, note)
  values (o.id, o.status, v_new, coalesce(payload ->> 'actor', 'system'), 'Refunded ' || v_refunded || ' of ' || o.total);
  return jsonb_build_object('changed', true, 'order', order_json(o.id));
end $$;

create function public.api_set_invoice(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update orders set invoice_url = payload ->> 'invoice_url', updated_at = now()
  where (payload ->> 'order_id' is not null and id = (payload ->> 'order_id')::uuid)
     or (payload ->> 'payment_id' is not null and provider_payment_id = payload ->> 'payment_id');
  return jsonb_build_object('ok', found);
end $$;

-- Webhook idempotency: an event is processed once. A failed attempt may be retried.
create function public.api_webhook_begin(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_processed timestamptz;
begin
  insert into webhook_events (provider, event_id, type) values (payload ->> 'provider', payload ->> 'event_id', payload ->> 'type')
  on conflict (provider, event_id) do nothing;
  if found then return jsonb_build_object('fresh', true); end if;
  select processed_at into v_processed from webhook_events where provider = payload ->> 'provider' and event_id = payload ->> 'event_id';
  return jsonb_build_object('fresh', v_processed is null, 'retry', v_processed is null);
end $$;

create function public.api_webhook_done(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update webhook_events set processed_at = case when payload ->> 'error' is null then now() end, error = payload ->> 'error'
  where provider = payload ->> 'provider' and event_id = payload ->> 'event_id';
  return jsonb_build_object('ok', found);
end $$;

create function public.api_is_admin(payload jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('admin', exists (select 1 from profiles where id = (payload ->> 'user_id')::uuid and role = 'admin'))
$$;

create function public.api_admin_orders(payload jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  with f as (
    select o.id, o.created_at from orders o
    where (nullif(payload ->> 'status', '') is null or o.status = payload ->> 'status')
      and (nullif(payload ->> 'q', '') is null or o.number ilike '%' || (payload ->> 'q') || '%' or o.email ilike '%' || (payload ->> 'q') || '%')
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'orders', coalesce((select jsonb_agg(order_json(x.id) order by x.created_at desc) from (
      select * from f order by created_at desc
      limit least(coalesce((payload ->> 'limit')::integer, 50), 200) offset coalesce((payload ->> 'offset')::integer, 0)) x), '[]'::jsonb))
$$;

-- email_log has a column that is also called payload, so the function says which one it means.
create function public.api_email_log(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare v_id bigint;
begin
  if payload ->> 'id' is null then
    insert into email_log (order_id, template, to_email, language, payload)
    values (nullif(payload ->> 'order_id', '')::uuid, payload ->> 'template', payload ->> 'to_email', coalesce(payload ->> 'language', 'en'), payload -> 'payload')
    returning id into v_id;
  else
    v_id := (payload ->> 'id')::bigint;
    update email_log set status = payload ->> 'status', provider_id = coalesce(payload ->> 'provider_id', provider_id), error = payload ->> 'error',
      attempts = attempts + 1, sent_at = case when payload ->> 'status' = 'sent' then now() else sent_at end
    where id = v_id;
  end if;
  return jsonb_build_object('id', v_id);
end $$;

create function public.api_email_retry_list(payload jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) from (
    select * from email_log where status in ('failed', 'queued') and attempts < 5 and created_at > now() - interval '3 days'
      and created_at < now() - interval '2 minutes'
    order by id limit 20) e
$$;

-- Fixed-window rate limit. Returns allowed = false once `max` is passed inside the window.
create function public.api_rate_limit(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_window integer := greatest(coalesce((payload ->> 'window_seconds')::integer, 60), 1);
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / v_window) * v_window);
  v_count integer;
begin
  insert into rate_limits (key, window_start, count) values (payload ->> 'key', v_start, 1)
  on conflict (key, window_start) do update set count = rate_limits.count + 1
  returning count into v_count;
  delete from rate_limits where window_start < now() - interval '1 day';
  return jsonb_build_object('allowed', v_count <= coalesce((payload ->> 'max')::integer, 10), 'count', v_count);
end $$;

create function public.api_stock_alert(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from variants where id = payload ->> 'variant_id') then return jsonb_build_object('ok', false); end if;
  insert into back_in_stock_requests (variant_id, email, language)
  values (payload ->> 'variant_id', lower(payload ->> 'email'), coalesce(payload ->> 'lang', 'en'))
  on conflict (variant_id, email) do nothing;
  return jsonb_build_object('ok', true);
end $$;

-- Loads data/products.seed.json. Existing stock is kept unless reset_stock is true, so that
-- re-seeding after a text or price change does not overwrite live stock.
create function public.api_seed(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p jsonb; v jsonb; b jsonb; tr record; n integer := 0;
  v_reset boolean := coalesce((payload ->> 'reset_stock')::boolean, false);
begin
  update products set active = false
  where id not in (select e ->> 'id' from jsonb_array_elements(payload -> 'products') e);
  for p in select * from jsonb_array_elements(payload -> 'products') loop
    insert into products (id, slug, type, category, featured, active, sort, min_quantity, quantity_step, max_online_quantity,
                          low_stock_threshold, dispatch_days, weight_grams, tax_code, regions, images, setup_fields, demo_url, customs)
    values (p ->> 'id', p ->> 'slug', p ->> 'type', p ->> 'category', coalesce((p ->> 'featured')::boolean, false), coalesce((p ->> 'active')::boolean, true),
            coalesce((p ->> 'sort')::integer, 0), coalesce((p ->> 'min_quantity')::integer, 1), coalesce((p ->> 'quantity_step')::integer, 1),
            coalesce((p ->> 'max_online_quantity')::integer, 200), (p ->> 'low_stock_threshold')::integer, (p ->> 'dispatch_days')::integer,
            (p ->> 'weight_grams')::integer, p ->> 'tax_code',
            coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'regions') x), array['eu_eea']),
            coalesce(p -> 'images', '[]'::jsonb), coalesce(p -> 'setup_fields', '[]'::jsonb), p ->> 'demo_url', p -> 'customs')
    on conflict (id) do update set slug = excluded.slug, type = excluded.type, category = excluded.category, featured = excluded.featured,
      active = excluded.active, sort = excluded.sort, min_quantity = excluded.min_quantity, quantity_step = excluded.quantity_step,
      max_online_quantity = excluded.max_online_quantity, low_stock_threshold = excluded.low_stock_threshold, dispatch_days = excluded.dispatch_days,
      weight_grams = excluded.weight_grams, tax_code = excluded.tax_code, regions = excluded.regions, images = excluded.images,
      setup_fields = excluded.setup_fields, demo_url = excluded.demo_url, customs = excluded.customs, updated_at = now();

    delete from product_translations where product_id = p ->> 'id';
    for tr in select key, value from jsonb_each(p -> 'translations') loop
      insert into product_translations (product_id, lang, name, short_description, description)
      values (p ->> 'id', tr.key, tr.value ->> 'name', tr.value ->> 'short_description', tr.value ->> 'description');
    end loop;

    update variants set active = false where product_id = p ->> 'id'
      and id not in (select e ->> 'id' from jsonb_array_elements(p -> 'variants') e);
    for v in select * from jsonb_array_elements(p -> 'variants') loop
      insert into variants (id, product_id, options, stock, active, sort)
      values (v ->> 'id', p ->> 'id', coalesce(v -> 'options', '{}'::jsonb), (v ->> 'stock')::integer, true, coalesce((v ->> 'sort')::integer, 0))
      on conflict (id) do update set options = excluded.options, active = true, sort = excluded.sort,
        stock = case when v_reset then excluded.stock else variants.stock end;
    end loop;

    delete from price_breaks where product_id = p ->> 'id';
    for b in select * from jsonb_array_elements(p -> 'price_breaks') loop
      insert into price_breaks (product_id, variant_id, currency, min_quantity, unit_amount, billing)
      values (p ->> 'id', b ->> 'variant_id', coalesce(b ->> 'currency', 'EUR'), (b ->> 'min_quantity')::integer, (b ->> 'unit_amount')::integer, coalesce(b ->> 'billing', 'one_off'));
    end loop;
    n := n + 1;
  end loop;
  return jsonb_build_object('products', n);
end $$;

-- ---------- Privileges ----------
-- Functions are callable by PUBLIC by default. Close that: only the service role may call them.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
revoke all on sequence public.order_number_seq from public, anon, authenticated;
