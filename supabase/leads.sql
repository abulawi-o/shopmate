-- Get-started requests from the Shopmate home page.
-- Run once in the Supabase SQL Editor. Safe to run again.
-- The public can only call lead_submit (it checks the details); only the platform admin can read or change leads.

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 80),
  shop_name text not null check (char_length(shop_name) between 1 and 100),
  phone text not null check (char_length(phone) between 7 and 20),
  kind text check (kind in ('barber','salon','dental','other')),
  consent boolean not null check (consent),
  status text not null default 'new' check (status in ('new','contacted','closed'))
);
alter table public.leads enable row level security;
drop policy if exists leads_admin on public.leads;
create policy leads_admin on public.leads for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.leads from anon, authenticated;
grant select, update, delete on public.leads to authenticated;

create or replace function public.lead_submit(p_name text, p_shop text, p_phone text, p_kind text, p_consent boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if coalesce(trim(p_name), '') = '' or char_length(p_name) > 80 then return jsonb_build_object('ok', false, 'error', 'name'); end if;
  if coalesce(trim(p_shop), '') = '' or char_length(p_shop) > 100 then return jsonb_build_object('ok', false, 'error', 'shop'); end if;
  if char_length(d) < 10 or char_length(d) > 15 then return jsonb_build_object('ok', false, 'error', 'phone'); end if;
  if p_consent is not true then return jsonb_build_object('ok', false, 'error', 'consent'); end if;
  if (select count(*) from leads where created_at > now() - interval '1 hour') >= 40 then return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  if exists (select 1 from leads where regexp_replace(phone, '\D', '', 'g') = d and created_at > now() - interval '1 day') then return jsonb_build_object('ok', true, 'again', true); end if;
  insert into leads (name, shop_name, phone, kind, consent)
    values (trim(p_name), trim(p_shop), d, case when p_kind in ('barber','salon','dental','other') then p_kind else 'other' end, true);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.lead_submit(text, text, text, text, boolean) from public;
grant execute on function public.lead_submit(text, text, text, text, boolean) to anon, authenticated;
