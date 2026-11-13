-- NOVA shop, phase 2: accounts, tracking, fulfilment, website set-up, plans, newsletter.
-- Same rules as 0001: row-level security on every table, api_* functions for the service role only.

-- ---------- Accounts ----------
alter table public.profiles
  add column company_name text,
  add column vat_number text,
  add column invoice_email text,
  add column email_news boolean not null default false,        -- newsletter
  add column email_cart boolean not null default false,        -- abandoned cart reminders
  add column welcomed_at timestamptz,
  add column stripe_customer_id text;

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users (id) on delete cascade,
  label text,
  name text not null,
  line1 text not null,
  line2 text,
  postal_code text not null,
  city text not null,
  state text,
  country text not null,
  phone text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index addresses_customer_idx on public.addresses (customer_id);

create table public.saved_carts (
  customer_id uuid primary key references auth.users (id) on delete cascade,
  items jsonb not null default '[]',
  language text not null default 'en',
  updated_at timestamptz not null default now(),
  reminded integer not null default 0        -- abandoned cart emails sent for this cart (0, 1 or 2)
);

-- ---------- Fulfilment ----------
alter table public.orders
  add column tracking_number text,
  add column tracking_carrier text,
  add column tracking_url text,
  add column shipped_at timestamptz,
  add column delivered_at timestamptz,
  add column review_requested_at timestamptz,
  add column preview_url text,
  add column approved_at timestamptz,
  add column setup_reminded_at timestamptz,
  add column recovery_url text,              -- Stripe link to resume an expired checkout
  add column recovery_sent integer not null default 0,
  add column subscription_id text;

create table public.order_notes (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders on delete cascade,
  author text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create table public.setup_submissions (
  order_id uuid primary key references public.orders on delete cascade,
  answers jsonb not null default '{}',
  files jsonb not null default '[]',         -- [{ path, name, type, size }] in the private "setup" bucket
  change_request text,
  submitted_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ---------- Plans (subscriptions through Stripe) ----------
create table public.subscriptions (
  id text primary key,                       -- Stripe subscription id
  customer_id uuid references auth.users (id) on delete set null,
  order_id uuid references public.orders on delete set null,
  email text,
  product_id text references public.products,
  status text not null,
  billing text,
  unit_amount integer,
  currency text not null default 'EUR',
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  provider_customer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index subscriptions_customer_idx on public.subscriptions (customer_id);

-- ---------- Newsletter (double opt-in) ----------
create table public.newsletter_subscribers (
  email text primary key,
  language text not null default 'en',
  source text not null,                      -- footer, sign-up, checkout, account
  token text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  requested_at timestamptz not null default now(),
  confirmed_at timestamptz,                  -- the address counts only once this is set
  unsubscribed_at timestamptz,
  synced_at timestamptz                      -- sent to the email marketing tool
);

alter table public.addresses enable row level security;
alter table public.saved_carts enable row level security;
alter table public.order_notes enable row level security;
alter table public.setup_submissions enable row level security;
alter table public.subscriptions enable row level security;
alter table public.newsletter_subscribers enable row level security;

create policy addresses_own on public.addresses for select to authenticated using (customer_id = auth.uid());
create policy saved_carts_own on public.saved_carts for select to authenticated using (customer_id = auth.uid());
create policy subscriptions_own on public.subscriptions for select to authenticated using (customer_id = auth.uid());
create policy setup_own on public.setup_submissions for select to authenticated
  using (exists (select 1 from public.orders o where o.id = setup_submissions.order_id and o.customer_id = auth.uid()));
-- order_notes (internal) and newsletter_subscribers have no policy: service role only.

-- ---------- Account functions ----------
-- Called after every verified sign-in: makes sure the profile exists and attaches guest orders
-- that were placed with the same, verified, email address.
create function public.api_account_touch(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid := (payload ->> 'user_id')::uuid; v_email text; v_linked integer := 0; v_new boolean;
begin
  select email into v_email from auth.users where id = v_id and email_confirmed_at is not null;
  insert into profiles (id, language, email_news) values (v_id, coalesce(payload ->> 'lang', 'en'), false) on conflict (id) do nothing;
  v_new := found;
  if v_email is not null then
    update orders set customer_id = v_id where customer_id is null and lower(email) = lower(v_email);
    get diagnostics v_linked = row_count;
    update subscriptions set customer_id = v_id where customer_id is null and lower(email) = lower(v_email);
  end if;
  return jsonb_build_object('verified', v_email is not null, 'linked_orders', v_linked, 'new_profile', v_new,
    'profile', (select to_jsonb(p) from profiles p where p.id = v_id));
end $$;

create function public.api_account_update(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid := (payload ->> 'user_id')::uuid;
begin
  update profiles set
    company_name = case when payload ? 'company_name' then nullif(payload ->> 'company_name', '') else company_name end,
    vat_number = case when payload ? 'vat_number' then nullif(payload ->> 'vat_number', '') else vat_number end,
    invoice_email = case when payload ? 'invoice_email' then nullif(payload ->> 'invoice_email', '') else invoice_email end,
    email_news = coalesce((payload ->> 'email_news')::boolean, email_news),
    email_cart = coalesce((payload ->> 'email_cart')::boolean, email_cart),
    language = coalesce(payload ->> 'language', language),
    welcomed_at = case when (payload ->> 'welcomed')::boolean then now() else welcomed_at end,
    stripe_customer_id = coalesce(payload ->> 'stripe_customer_id', stripe_customer_id)
  where id = v_id;
  return (select to_jsonb(p) from profiles p where p.id = v_id);
end $$;

-- What a customer may see of an order (no internal notes, no provider ids).
create function public.order_public(p_order uuid)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'number', o.number, 'status', o.status, 'created_at', o.created_at, 'paid_at', o.paid_at, 'currency', o.currency,
    'subtotal', o.subtotal, 'shipping_amount', o.shipping_amount, 'tax_amount', o.tax_amount, 'total', o.total, 'amount_refunded', o.amount_refunded,
    'shipping_address', o.shipping_address, 'invoice_url', o.invoice_url, 'vat_id', o.vat_id,
    'tracking_number', o.tracking_number, 'tracking_carrier', o.tracking_carrier, 'tracking_url', o.tracking_url,
    'shipped_at', o.shipped_at, 'delivered_at', o.delivered_at, 'preview_url', o.preview_url, 'approved_at', o.approved_at,
    'has_website', exists (select 1 from order_items i where i.order_id = o.id and i.product_type = 'website'),
    'setup_submitted', exists (select 1 from setup_submissions s where s.order_id = o.id and s.submitted_at is not null),
    'items', coalesce((select jsonb_agg(jsonb_build_object('product_id', i.product_id, 'variant_id', i.variant_id, 'name', i.name, 'options', i.options,
        'quantity', i.quantity, 'unit_amount', i.unit_amount, 'line_total', i.line_total, 'type', i.product_type, 'slug', p.slug, 'image', p.images -> 0 ->> 'src') order by i.id)
      from order_items i join products p on p.id = i.product_id where i.order_id = o.id), '[]'::jsonb))
  from orders o where o.id = p_order
$$;

create function public.api_account_orders(payload jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(order_public(o.id) order by o.created_at desc), '[]'::jsonb)
  from orders o
  where o.customer_id = (payload ->> 'user_id')::uuid and o.status <> 'pending'
    and (payload ->> 'number' is null or o.number = payload ->> 'number')
$$;

-- Order status for someone who is not signed in: the number and the email must both match.
create function public.api_track(payload jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  select order_public(o.id) - 'shipping_address' - 'invoice_url' - 'vat_id' - 'preview_url'
  from orders o
  where upper(o.number) = upper(trim(payload ->> 'number')) and lower(o.email) = lower(trim(payload ->> 'email')) and o.status <> 'pending'
$$;

create function public.api_addresses(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid := (payload ->> 'user_id')::uuid; a jsonb := payload -> 'address';
begin
  if payload ->> 'action' = 'delete' then
    delete from addresses where id = (payload ->> 'id')::uuid and customer_id = v_id;
  elsif payload ->> 'action' = 'save' then
    if (select count(*) from addresses where customer_id = v_id) >= 20 and a ->> 'id' is null then
      return jsonb_build_object('error', 'too_many');
    end if;
    if coalesce((a ->> 'is_default')::boolean, false) then update addresses set is_default = false where customer_id = v_id; end if;
    if a ->> 'id' is null then
      insert into addresses (customer_id, label, name, line1, line2, postal_code, city, state, country, phone, is_default)
      values (v_id, a ->> 'label', a ->> 'name', a ->> 'line1', nullif(a ->> 'line2', ''), a ->> 'postal_code', a ->> 'city', nullif(a ->> 'state', ''), upper(a ->> 'country'), nullif(a ->> 'phone', ''), coalesce((a ->> 'is_default')::boolean, false));
    else
      update addresses set label = a ->> 'label', name = a ->> 'name', line1 = a ->> 'line1', line2 = nullif(a ->> 'line2', ''), postal_code = a ->> 'postal_code',
        city = a ->> 'city', state = nullif(a ->> 'state', ''), country = upper(a ->> 'country'), phone = nullif(a ->> 'phone', ''), is_default = coalesce((a ->> 'is_default')::boolean, false)
      where id = (a ->> 'id')::uuid and customer_id = v_id;
    end if;
  end if;
  return jsonb_build_object('addresses', coalesce((select jsonb_agg(to_jsonb(x) - 'customer_id' order by x.is_default desc, x.created_at) from addresses x where x.customer_id = v_id), '[]'::jsonb));
end $$;

-- Saved cart: on sign-in the browser cart is merged in (highest quantity per variant wins).
create function public.api_saved_cart(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid := (payload ->> 'user_id')::uuid; v_items jsonb;
begin
  if payload ? 'items' then
    if coalesce((payload ->> 'merge')::boolean, false) then
      select coalesce(jsonb_agg(jsonb_build_object('p', p, 'v', v, 'q', q)), '[]'::jsonb) into v_items from (
        select max(e ->> 'p') as p, e ->> 'v' as v, max((e ->> 'q')::integer) as q
        from (select jsonb_array_elements(payload -> 'items') as e
              union all select jsonb_array_elements(items) from saved_carts where customer_id = v_id) s
        group by e ->> 'v') m;
    else
      v_items := payload -> 'items';
    end if;
    insert into saved_carts (customer_id, items, language, updated_at, reminded) values (v_id, v_items, coalesce(payload ->> 'lang', 'en'), now(), 0)
    on conflict (customer_id) do update set items = excluded.items, language = excluded.language,
      updated_at = case when saved_carts.items = excluded.items then saved_carts.updated_at else now() end,
      reminded = case when saved_carts.items = excluded.items then saved_carts.reminded else 0 end;
  end if;
  return jsonb_build_object('items', coalesce((select items from saved_carts where customer_id = v_id), '[]'::jsonb));
end $$;

-- Everything we hold about one customer, for "download my data".
create function public.api_account_export(payload jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'exported_at', now(),
    'account', (select jsonb_build_object('email', u.email, 'email_confirmed_at', u.email_confirmed_at) from auth.users u where u.id = (payload ->> 'user_id')::uuid),
    'profile', (select to_jsonb(p) - 'stripe_customer_id' from profiles p where p.id = (payload ->> 'user_id')::uuid),
    'addresses', coalesce((select jsonb_agg(to_jsonb(a)) from addresses a where a.customer_id = (payload ->> 'user_id')::uuid), '[]'::jsonb),
    'orders', api_account_orders(jsonb_build_object('user_id', payload ->> 'user_id')),
    'saved_cart', (select items from saved_carts where customer_id = (payload ->> 'user_id')::uuid),
    'plans', coalesce((select jsonb_agg(to_jsonb(s) - 'provider_customer_id') from subscriptions s where s.customer_id = (payload ->> 'user_id')::uuid), '[]'::jsonb),
    'newsletter', (select to_jsonb(n) - 'token' from newsletter_subscribers n join auth.users u on lower(u.email) = n.email where u.id = (payload ->> 'user_id')::uuid))
$$;

-- Account deletion: personal data goes; order and invoice records the law requires stay, detached.
create function public.api_account_delete(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid := (payload ->> 'user_id')::uuid; v_email text;
begin
  select email into v_email from auth.users where id = v_id;
  if exists (select 1 from subscriptions where customer_id = v_id and status in ('active', 'trialing', 'past_due')) then
    return jsonb_build_object('error', 'active_plan');
  end if;
  delete from newsletter_subscribers where email = lower(v_email);
  delete from addresses where customer_id = v_id;
  delete from saved_carts where customer_id = v_id;
  update orders set customer_id = null where customer_id = v_id;
  delete from profiles where id = v_id and role <> 'admin';
  return jsonb_build_object('ok', true, 'email', v_email);
end $$;

-- ---------- Admin functions ----------
create function public.api_admin_order(payload jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  select order_json(o.id) || jsonb_build_object(
    'log', coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from order_status_log l where l.order_id = o.id), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(to_jsonb(n) order by n.id) from order_notes n where n.order_id = o.id), '[]'::jsonb),
    'emails', coalesce((select jsonb_agg(to_jsonb(e) - 'payload' order by e.id) from email_log e where e.order_id = o.id), '[]'::jsonb),
    'setup', (select to_jsonb(s) from setup_submissions s where s.order_id = o.id))
  from orders o where o.number = payload ->> 'number'
$$;

-- Allowed status moves. Paid and refund states are set only by the payment webhook.
create function public.api_admin_set_status(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o orders; v_to text := payload ->> 'status';
  allowed jsonb := '{"paid":["packed","shipped","cancelled"],"awaiting_details":["in_setup","cancelled"],"in_setup":["ready_for_review","awaiting_details","cancelled"],
    "ready_for_review":["in_setup","delivered"],"packed":["shipped","paid","cancelled"],"shipped":["delivered","packed"],"delivered":["shipped"],"pending":["cancelled"]}';
begin
  select * into o from orders where number = payload ->> 'number' for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if payload ? 'tracking_number' then
    update orders set tracking_number = nullif(payload ->> 'tracking_number', ''), tracking_carrier = nullif(payload ->> 'tracking_carrier', ''),
      tracking_url = nullif(payload ->> 'tracking_url', ''), updated_at = now() where id = o.id;
  end if;
  if payload ? 'preview_url' then update orders set preview_url = nullif(payload ->> 'preview_url', ''), updated_at = now() where id = o.id; end if;
  if v_to is null or v_to = o.status then return jsonb_build_object('changed', false, 'order', order_json(o.id)); end if;
  if not (allowed -> o.status) ? v_to then return jsonb_build_object('error', 'transition_not_allowed', 'from', o.status, 'to', v_to); end if;
  if v_to = 'cancelled' then update stock_reservations set released_at = now() where order_id = o.id and released_at is null; end if;
  update orders set status = v_to, updated_at = now(),
    shipped_at = case when v_to = 'shipped' then now() else shipped_at end,
    delivered_at = case when v_to = 'delivered' then now() else delivered_at end
  where id = o.id;
  insert into order_status_log (order_id, from_status, to_status, actor, note) values (o.id, o.status, v_to, payload ->> 'actor', payload ->> 'note');
  return jsonb_build_object('changed', true, 'from', o.status, 'order', order_json(o.id));
end $$;

create function public.api_admin_note(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  insert into order_notes (order_id, author, body) select id, payload ->> 'actor', payload ->> 'body' from orders where number = payload ->> 'number';
  return jsonb_build_object('ok', found);
end $$;

create function public.api_admin_stock(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_before integer; v_after integer;
begin
  if payload ? 'variant_id' then
    select stock into v_before from variants where id = payload ->> 'variant_id' for update;
    update variants set stock = greatest((payload ->> 'stock')::integer, 0) where id = payload ->> 'variant_id' and stock is not null returning stock into v_after;
  end if;
  return jsonb_build_object('was', v_before, 'now', v_after, 'variants', (
    select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'product_id', p.id, 'name', coalesce(t.name, p.id), 'options', v.options, 'stock', v.stock,
      'reserved', v.stock - available_stock(v.id), 'available', available_stock(v.id), 'threshold', p.low_stock_threshold,
      'low', p.low_stock_threshold is not null and v.stock <= p.low_stock_threshold) order by p.sort, v.sort), '[]'::jsonb)
    from variants v join products p on p.id = v.product_id left join product_translations t on t.product_id = p.id and t.lang = 'en'
    where v.stock is not null and v.active and p.active));
end $$;

-- People who asked to hear when a variant is back, once it has stock again.
create function public.api_back_in_stock_due(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rows jsonb;
begin
  with due as (
    update back_in_stock_requests r set notified_at = now()
    from variants v join products p on p.id = v.product_id
    where r.variant_id = v.id and r.notified_at is null and available_stock(v.id) > 0
    returning r.email, r.language, v.id as variant_id, p.slug, p.id as product_id)
  select coalesce(jsonb_agg(jsonb_build_object('email', d.email, 'language', d.language, 'variant_id', d.variant_id, 'slug', d.slug,
    'name', coalesce((select name from product_translations where product_id = d.product_id and lang = d.language), (select name from product_translations where product_id = d.product_id and lang = 'en')))), '[]'::jsonb)
  into v_rows from due d;
  return v_rows;
end $$;

create function public.api_admin_export(payload jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('number', o.number, 'status', o.status, 'created_at', o.created_at, 'paid_at', o.paid_at, 'email', o.email,
    'customer_name', o.customer_name, 'country', o.shipping_country, 'vat_id', o.vat_id, 'currency', o.currency, 'subtotal', o.subtotal,
    'shipping', o.shipping_amount, 'tax', o.tax_amount, 'total', o.total, 'refunded', o.amount_refunded, 'provider', o.payment_provider,
    'payment_id', o.provider_payment_id, 'invoice_url', o.invoice_url,
    'items', (select string_agg(i.quantity || ' x ' || i.variant_id, '; ' order by i.id) from order_items i where i.order_id = o.id)) order by o.created_at), '[]'::jsonb)
  from orders o
  where o.status <> 'pending'
    and (payload ->> 'from' is null or o.created_at >= (payload ->> 'from')::timestamptz)
    and (payload ->> 'to' is null or o.created_at < (payload ->> 'to')::timestamptz)
$$;

create function public.api_email_get(payload jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(e) from email_log e where e.id = (payload ->> 'id')::bigint
$$;

-- ---------- Website set-up and review ----------
create function public.api_setup(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o orders; v_action text := payload ->> 'action'; v_new text;
begin
  select * into o from orders where number = payload ->> 'number' for update;
  if not found or not exists (select 1 from order_items where order_id = o.id and product_type = 'website') then return jsonb_build_object('error', 'not_found'); end if;
  if v_action = 'save' and o.status in ('awaiting_details', 'in_setup') then
    insert into setup_submissions (order_id, answers, files, submitted_at, updated_at)
    values (o.id, coalesce(payload -> 'answers', '{}'::jsonb), coalesce(payload -> 'files', '[]'::jsonb), now(), now())
    on conflict (order_id) do update set answers = excluded.answers, files = setup_submissions.files || excluded.files, submitted_at = now(), updated_at = now();
  elsif v_action in ('approve', 'request_changes') and o.status = 'ready_for_review' then
    v_new := case when v_action = 'approve' then 'delivered' else 'in_setup' end;
    update orders set status = v_new, updated_at = now(), approved_at = case when v_action = 'approve' then now() else approved_at end,
      delivered_at = case when v_action = 'approve' then now() else delivered_at end where id = o.id;
    insert into setup_submissions (order_id, change_request) values (o.id, payload ->> 'message')
    on conflict (order_id) do update set change_request = excluded.change_request, updated_at = now();
    insert into order_status_log (order_id, from_status, to_status, actor, note)
    values (o.id, o.status, v_new, 'customer', case when v_action = 'approve' then 'Website approved by the customer' else 'Changes requested: ' || coalesce(payload ->> 'message', '') end);
  elsif v_action is not null and v_action <> 'get' then
    return jsonb_build_object('error', 'not_allowed', 'status', o.status);
  end if;
  return jsonb_build_object('order', order_public(o.id), 'email', o.email, 'language', o.language, 'customer_id', o.customer_id, 'changed', v_new,
    'setup', (select to_jsonb(s) from setup_submissions s where s.order_id = o.id),
    'fields', (select coalesce(jsonb_agg(distinct f), '[]'::jsonb) from order_items i join products p on p.id = i.product_id, jsonb_array_elements_text(p.setup_fields) f where i.order_id = o.id));
end $$;

-- ---------- Jobs run by the scheduled trigger ----------
-- Each returns the rows to email and marks them, so nobody is emailed twice.
create function public.api_due(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_kind text := payload ->> 'kind'; v_rows jsonb := '[]'::jsonb;
begin
  if v_kind = 'setup_reminder' then
    with due as (update orders o set setup_reminded_at = now()
      where o.status = 'awaiting_details' and o.setup_reminded_at is null and o.paid_at < now() - make_interval(days => coalesce((payload ->> 'days')::integer, 3))
        and not exists (select 1 from setup_submissions s where s.order_id = o.id and s.submitted_at is not null) returning o.id)
    select coalesce(jsonb_agg(order_json(id)), '[]'::jsonb) into v_rows from due;
  elsif v_kind = 'review_request' then
    with due as (update orders o set review_requested_at = now()
      where o.status = 'delivered' and o.review_requested_at is null and o.delivered_at < now() - make_interval(days => coalesce((payload ->> 'days')::integer, 7)) returning o.id)
    select coalesce(jsonb_agg(order_json(id)), '[]'::jsonb) into v_rows from due;
  elsif v_kind = 'checkout_recovery' then
    -- Expired checkouts: one email after 1 hour, one after 24 hours, then stop. Only with consent,
    -- and never when the buyer has ordered since.
    with due as (update orders o set recovery_sent = o.recovery_sent + 1
      where o.status = 'cancelled' and o.marketing_consent and o.email is not null and o.recovery_url is not null and o.recovery_sent < 2
        and o.updated_at < now() - case when o.recovery_sent = 0 then interval '1 hour' else interval '24 hours' end
        and o.created_at > now() - interval '7 days'
        and not exists (select 1 from orders p where lower(p.email) = lower(o.email) and p.paid_at > o.created_at) returning o.id)
    select coalesce(jsonb_agg(order_json(id)), '[]'::jsonb) into v_rows from due;
  elsif v_kind = 'saved_cart' then
    -- Signed-in customers who opted in and left items in the cart: after 24 hours and again a day later.
    with due as (update saved_carts c set reminded = c.reminded + 1
      from profiles p, auth.users u
      where p.id = c.customer_id and u.id = c.customer_id and p.email_cart and jsonb_array_length(c.items) > 0 and c.reminded < 2
        and c.updated_at < now() - make_interval(hours => 24 * (c.reminded + 1))
        and not exists (select 1 from orders o where o.customer_id = c.customer_id and o.paid_at > c.updated_at)
      returning u.email, c.language, c.items)
    select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) into v_rows from due d;
  end if;
  return v_rows;
end $$;

create function public.api_set_recovery(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update orders set recovery_url = payload ->> 'recovery_url', email = coalesce(nullif(payload ->> 'email', ''), email),
    marketing_consent = marketing_consent or coalesce((payload ->> 'marketing_consent')::boolean, false)
  where id = (payload ->> 'order_id')::uuid;
  return jsonb_build_object('ok', found);
end $$;

-- ---------- Newsletter ----------
create function public.api_newsletter(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n newsletter_subscribers; v_action text := payload ->> 'action';
begin
  if v_action = 'request' then
    insert into newsletter_subscribers (email, language, source) values (lower(trim(payload ->> 'email')), coalesce(payload ->> 'lang', 'en'), coalesce(payload ->> 'source', 'footer'))
    on conflict (email) do update set requested_at = now(), unsubscribed_at = null, language = excluded.language
    returning * into n;
    return jsonb_build_object('email', n.email, 'token', n.token, 'language', n.language, 'already_confirmed', n.confirmed_at is not null);
  elsif v_action = 'confirm' then
    update newsletter_subscribers set confirmed_at = coalesce(confirmed_at, now()), unsubscribed_at = null where token = payload ->> 'token' returning * into n;
  elsif v_action = 'unsubscribe' then
    update newsletter_subscribers set unsubscribed_at = now() where token = payload ->> 'token' or (payload ->> 'email' is not null and email = lower(payload ->> 'email')) returning * into n;
    update profiles p set email_news = false from auth.users u where u.id = p.id and lower(u.email) = n.email;
  elsif v_action = 'synced' then
    update newsletter_subscribers set synced_at = now() where email = lower(payload ->> 'email') returning * into n;
  elsif v_action = 'to_sync' then
    return (select coalesce(jsonb_agg(to_jsonb(s) - 'token'), '[]'::jsonb) from (select * from newsletter_subscribers
      where confirmed_at is not null and (synced_at is null or (unsubscribed_at is not null and unsubscribed_at > synced_at)) limit 50) s);
  end if;
  return jsonb_build_object('ok', n.email is not null, 'email', n.email, 'language', n.language, 'token', n.token);
end $$;

-- ---------- Plans ----------
create function public.api_subscription(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s subscriptions; v_customer uuid;
begin
  if payload ->> 'action' = 'list' then
    return coalesce((select jsonb_agg(to_jsonb(x) - 'provider_customer_id' || jsonb_build_object('name', (select name from product_translations t where t.product_id = x.product_id and t.lang = 'en')) order by x.created_at desc)
      from subscriptions x where x.customer_id = (payload ->> 'user_id')::uuid), '[]'::jsonb);
  end if;
  select u.id into v_customer from auth.users u where lower(u.email) = lower(payload ->> 'email') and u.email_confirmed_at is not null limit 1;
  insert into subscriptions (id, customer_id, order_id, email, product_id, status, billing, unit_amount, currency, current_period_end, cancel_at_period_end, provider_customer_id)
  values (payload ->> 'id', coalesce(nullif(payload ->> 'customer_id', '')::uuid, v_customer), nullif(payload ->> 'order_id', '')::uuid, payload ->> 'email', payload ->> 'product_id',
    payload ->> 'status', payload ->> 'billing', (payload ->> 'unit_amount')::integer, coalesce(payload ->> 'currency', 'EUR'),
    to_timestamp((payload ->> 'current_period_end')::double precision), coalesce((payload ->> 'cancel_at_period_end')::boolean, false), payload ->> 'provider_customer_id')
  on conflict (id) do update set status = excluded.status, updated_at = now(),
    current_period_end = coalesce(excluded.current_period_end, subscriptions.current_period_end),
    cancel_at_period_end = excluded.cancel_at_period_end,
    email = coalesce(subscriptions.email, excluded.email), customer_id = coalesce(subscriptions.customer_id, excluded.customer_id),
    product_id = coalesce(subscriptions.product_id, excluded.product_id), billing = coalesce(subscriptions.billing, excluded.billing),
    unit_amount = coalesce(subscriptions.unit_amount, excluded.unit_amount), provider_customer_id = coalesce(subscriptions.provider_customer_id, excluded.provider_customer_id)
  returning * into s;
  if payload ->> 'order_id' is not null then update orders set subscription_id = s.id where id = (payload ->> 'order_id')::uuid; end if;
  return to_jsonb(s) || jsonb_build_object('name', (select name from product_translations t where t.product_id = s.product_id and t.lang = 'en'));
end $$;

-- Price of a plan for one product (monthly or yearly), from the database.
create function public.api_plan_price(payload jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('unit_amount', b.unit_amount, 'currency', b.currency, 'billing', b.billing, 'product_id', p.id, 'tax_code', p.tax_code, 'type', p.type,
    'name', coalesce((select name from product_translations where product_id = p.id and lang = coalesce(payload ->> 'lang', 'en')), (select name from product_translations where product_id = p.id and lang = 'en')))
  from price_breaks b join products p on p.id = b.product_id
  where p.id = payload ->> 'product_id' and p.active and b.billing = payload ->> 'billing' and b.currency = coalesce(payload ->> 'currency', 'EUR')
  limit 1
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
