/* LEO connector: the small piece that links ANY custom client website to that client's dashboard and AI system.
   A custom site only needs:  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js"></script>
                              <script src="../../config.js"></script>   <script src="../../connect.js"></script>
   then:  const info = await LeoConnect.load({ shop: 'THE-SHOP-ID' });   // name, content (phone, hours, services, team, socials), booking
          const r = await LeoConnect.book({ name, phone, service, price, barber, date:'2026-11-10', time:600, consent:true });  // lands in the client's dashboard
          LeoConnect.ownerUrl()  // link to the shared owner login
   Nothing here can read other people's data: the database only lets the public read the website info and send a booking request. */
(function (root) {
  const base = (function () { try { return new URL('.', document.currentScript.src).href; } catch (e) { return ''; } })();
  const state = { sb: null, info: null, shop: '' };
  const cfg = () => root.LEO || {};
  function client() {
    if (!state.sb) state.sb = root.supabase.createClient(cfg().url, cfg().key, { auth: { persistSession: false, autoRefreshToken: false } });
    return state.sb;
  }
  const shopFromPage = () => cfg().shopId || new URLSearchParams(location.search).get('shop') || '';
  /* Loads this client's website info. Uses the shop ID if given, otherwise the domain name the visitor came to. */
  async function load(opts) {
    const shop = (opts && opts.shop) || shopFromPage();
    try {
      const { data, error } = shop ? await client().rpc('site_info', { s: shop }) : await client().rpc('site_info_domain', { d: location.hostname });
      if (error || !data) return null;
      state.info = data; state.shop = data.id || shop; return data;
    } catch (e) { return null; }
  }
  /* Sends a booking request into the client's dashboard. Returns { ok:true } or { ok:false, error }. */
  async function book(b) {
    if (!state.shop) return { ok: false, error: 'not-connected' };
    const name = String(b.name || '').trim().slice(0, 60), phone = String(b.phone || '').trim().slice(0, 20);
    if (!name) return { ok: false, error: 'Please enter your name.' };
    if (phone.replace(/\D/g, '').length < 7) return { ok: false, error: 'Please enter a valid mobile number.' };
    const row = { shop_id: state.shop, name, phone, service: String(b.service || '').slice(0, 80), price: Number(b.price) || 0, barber: String(b.barber || 'Anyone').slice(0, 40), date: b.date, time: Number(b.time), status: 'new', source: 'website', consent: !!b.consent };
    if (b.end != null) row.end_time = Number(b.end);
    try { const { error } = await client().from('bookings').insert(row); return error ? { ok: false, error: error.message } : { ok: true }; }
    catch (e) { return { ok: false, error: 'network' }; }
  }
  const ownerUrl = () => (base ? new URL('owner.html', base).href.replace('/sites/', '/').replace(/\/[^/]+\/owner\.html$/, '/owner.html') : 'owner.html');
  root.LeoConnect = { load, book, ownerUrl, info: () => state.info, shopId: () => state.shop, bookingOpen: () => !!(state.info && state.info.booking) };
})(window);
