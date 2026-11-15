-- Customer self-service: cancel or ask to move an appointment from a private link in the reminder text.
-- Run once, after schema.sql. Safe to run again.
-- How it stays safe: every booking gets a long random secret (manage_token). Only someone holding the link can see or change THAT one booking.
-- The public (anon) role still has no read access to the bookings table; it can only call these three functions.
-- A "move" never changes the original: it creates a new request linked to it. The owner accepts it (which then cancels the old one) or declines it (the old booking stays).

alter table public.bookings add column if not exists manage_token text;
alter table public.bookings add column if not exists replaces uuid references public.bookings(id) on delete set null;
update public.bookings set manage_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '') where manage_token is null;
alter table public.bookings alter column manage_token set default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));
alter table public.bookings alter column manage_token set not null;
create unique index if not exists bookings_manage_token on public.bookings (manage_token);

-- a visitor can never point a new request at someone else's booking: only the function below may set "replaces"
drop policy if exists bookings_public_request on public.bookings;
create policy bookings_public_request on public.bookings for insert to anon, authenticated
  with check (status = 'new' and source = 'website' and replaces is null and public.site_live(shop_id) and public.ai_live(shop_id));

-- the shop's clock: appointments are stored without a time zone, so compare against Toronto time
create or replace function public.shop_now() returns timestamp language sql stable set search_path = ''
  as $$ select (now() at time zone 'America/Toronto') $$;

create or replace function public.booking_manage_get(t text) returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare b record; c jsonb; pend record; ok boolean;
begin
  if t is null or char_length(t) < 20 then return null; end if;
  select * into b from public.bookings where manage_token = t;
  if not found then return null; end if;
  if not public.ai_live(b.shop_id) then return null; end if;
  select content into c from public.shop_site where shop_id = b.shop_id;
  select * into pend from public.bookings where replaces = b.id and status = 'new' order by created_at desc limit 1;
  ok := b.status in ('new', 'accepted') and (b.date + make_interval(mins => b.time)) > public.shop_now() + interval '2 hours';
  return jsonb_build_object(
    'shop', (select name from public.shops where id = b.shop_id),
    'address', coalesce(c->>'address', ''), 'phone', coalesce(c->>'phone', ''),
    'hours', coalesce(c->'hours', '{}'::jsonb),
    'name', b.name, 'service', b.service, 'barber', b.barber,
    'date', b.date, 'time', b.time, 'end_time', b.end_time, 'status', b.status,
    'can_change', ok,
    'pending', case when pend.id is null then null else jsonb_build_object('date', pend.date, 'time', pend.time) end);
end $$;

create or replace function public.booking_cancel(t text) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare b record;
begin
  if t is null or char_length(t) < 20 then return jsonb_build_object('ok', false, 'error', 'not-found'); end if;
  select * into b from public.bookings where manage_token = t for update;
  if not found or not public.ai_live(b.shop_id) then return jsonb_build_object('ok', false, 'error', 'not-found'); end if;
  if b.status = 'cancelled' then return jsonb_build_object('ok', true, 'already', true); end if;
  if b.status not in ('new', 'accepted') then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  if (b.date + make_interval(mins => b.time)) <= public.shop_now() + interval '2 hours' then return jsonb_build_object('ok', false, 'error', 'too-late'); end if;
  update public.bookings set status = 'cancelled' where id = b.id;
  update public.bookings set status = 'declined' where replaces = b.id and status = 'new';   -- drop any waiting "move" request too
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.booking_reschedule(t text, d date, m integer) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare b record; c jsonb; h jsonb; dur integer; dw integer; pend uuid;
begin
  if t is null or char_length(t) < 20 then return jsonb_build_object('ok', false, 'error', 'not-found'); end if;
  select * into b from public.bookings where manage_token = t for update;
  if not found or not public.ai_live(b.shop_id) then return jsonb_build_object('ok', false, 'error', 'not-found'); end if;
  if b.status not in ('new', 'accepted') then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  if (b.date + make_interval(mins => b.time)) <= public.shop_now() + interval '2 hours' then return jsonb_build_object('ok', false, 'error', 'too-late'); end if;
  if d is null or m is null or m < 0 or m > 1439 then return jsonb_build_object('ok', false, 'error', 'bad-time'); end if;
  if (d + make_interval(mins => m)) < public.shop_now() + interval '2 hours' or d > public.shop_now()::date + 60 then return jsonb_build_object('ok', false, 'error', 'bad-time'); end if;
  select content into c from public.shop_site where shop_id = b.shop_id; h := c->'hours';
  dw := extract(isodow from d)::int - 1;                                     -- Monday first, same as the owner panel
  if h is not null and h ? 'days' and not coalesce((h->'days'->>dw)::boolean, false) then return jsonb_build_object('ok', false, 'error', 'closed-day'); end if;
  if h is not null and h ? 'start' and (m < (h->>'start')::int or m >= (h->>'end')::int) then return jsonb_build_object('ok', false, 'error', 'outside-hours'); end if;
  dur := coalesce(b.end_time - b.time, 30);
  select id into pend from public.bookings where replaces = b.id and status = 'new' order by created_at desc limit 1;
  if pend is not null then
    update public.bookings set date = d, time = m, end_time = m + dur where id = pend;
  else
    insert into public.bookings (shop_id, name, phone, service, price, barber, date, time, end_time, status, source, consent, replaces)
    values (b.shop_id, b.name, b.phone, b.service, b.price, b.barber, d, m, m + dur, 'new', 'website', b.consent, b.id);
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.booking_manage_get(text), public.booking_cancel(text), public.booking_reschedule(text, date, integer) from public;
grant execute on function public.booking_manage_get(text), public.booking_cancel(text), public.booking_reschedule(text, date, integer) to anon, authenticated;
