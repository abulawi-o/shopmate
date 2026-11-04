/* LEO automation engine (shared). Pure rules, no screen code.
   PRACTICE RUN: it only writes drafts and checks consent. Nothing is ever sent from here.
   Rules (CASL): express consent never expires; implied consent 730 days after a purchase,
   180 days after an inquiry; STOP is always honoured; every text carries business name,
   address and "Reply STOP to unsubscribe". */
(function (root) {
  const EPOCH = Date.UTC(2026, 0, 1);
  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const fromIso = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const dayNum = s => Math.round((Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) - EPOCH) / 86400000);
  const dayIso = n => { const d = new Date(EPOCH + n * 86400000); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); };
  const tLabel = m => { const h = Math.floor(m / 60), mm = m % 60, ap = h >= 12 ? 'PM' : 'AM', h12 = h % 12 || 12; return h12 + ':' + String(mm).padStart(2, '0') + ' ' + ap; };

  const KINDS = { review: 'Review request', reminder: 'Appointment reminder', missed: 'Missed-call text-back', inquiry: 'Inquiry follow-up', winback: 'Win-back' };
  const INFO = {
    review: ['Review requests', 'Asks happy customers for a Google review after a visit.'],
    reminder: ['Appointment reminders', 'A message 24 hours and 2 hours before the booking.'],
    missed: ['Missed-call replies', 'Texts back right away with your booking link.'],
    inquiry: ['Inquiry follow-up', 'Answers new inquiries fast and checks in once.'],
    winback: ['Win-back notes', 'Nudges customers you have not seen in 6 weeks.']
  };

  const fresh = () => ({ on: { review: true, reminder: true, missed: true, inquiry: true, winback: true }, outbox: [], stops: {}, leads: [], test: [], auto: false, sim: 0, lastCheck: 0, msg: '' });
  // fill anything missing in saved state (older or empty rows)
  const normalize = d => { const f = fresh(), o = Object.assign(f, d || {}); o.on = Object.assign({}, fresh().on, (d && d.on) || {}); ['outbox', 'leads', 'test'].forEach(k => { if (!Array.isArray(o[k])) o[k] = []; }); if (!o.stops || typeof o.stops !== 'object') o.stops = {}; return o; };

  function contacts(st, bookings) {
    const fromB = bookings.filter(b => b.status === 'accepted').map(b => {
      const d = dayNum(b.date), pd = String(b.phone || '').replace(/\D/g, '');
      return { id: 'bk-' + b.id, name: b.name, phone: pd, consent: b.consent ? 'express' : 'none', consentFrom: b.created_at ? dayNum(iso(new Date(b.created_at))) : d, basis: null, visitDay: d, apptDay: d, apptTime: tLabel(b.time), barber: b.barber && b.barber !== 'Anyone' ? b.barber : '', status: '', stop: !!st.stops[pd], reviewed: false, inquiryDay: null, missedDay: null };
    });
    return fromB.concat(st.leads, st.test);
  }
  function consentCheck(c, today) {
    if (c.stop) return 'Unsubscribed (STOP)';
    if (c.consent === 'none') return 'No consent on record';
    if (c.consent === 'implied') { const age = today - c.consentFrom, lim = c.basis === 'inquiry' ? 180 : 730; if (age > lim) return 'Implied consent expired (' + age + ' days old, limit ' + lim + ')'; }
    return null;
  }
  const foot = shop => '\n— ' + shop.name + (shop.address ? ', ' + shop.address : '') + '. Reply STOP to unsubscribe.';
  function makeText(kind, variant, c, shop) {
    const n = c.name, b = shop.name, t = c.apptTime; let body;
    if (kind === 'review') body = variant === 'nudge' ? 'Hi ' + n + ', if you have a minute, we would love a quick Google review of your visit to ' + b + ': [review link]' : 'Hi ' + n + ', thanks for visiting ' + b + '. If you were happy, a quick Google review helps us a lot: [review link]';
    else if (kind === 'reminder') body = variant === '2h' ? 'Hi ' + n + ', see you today at ' + t + (c.barber ? ' with ' + c.barber : '') + ' at ' + b + '. Reply C to confirm or X to cancel.' : 'Hi ' + n + ', a reminder of your appointment at ' + b + ' tomorrow at ' + t + (c.barber ? ' with ' + c.barber : '') + '. Reply C to confirm or X to cancel.';
    else if (kind === 'missed') body = 'Hi, sorry we missed your call at ' + b + '. Book online here: [booking link] or reply with a good time.';
    else if (kind === 'inquiry') body = variant === 'followup' ? 'Hi ' + n + ', just checking in about your inquiry at ' + b + '. Can we help you pick a time? [booking link]' : 'Hi ' + n + ', thanks for contacting ' + b + '. We got your message and will reply shortly. You can also book here: [booking link]';
    else body = 'Hi ' + n + ', it has been a while since your last visit to ' + b + '. Book your next one: [booking link]';
    return body + foot(shop);
  }
  // Writes whatever is due on day `today`. Safe to run again and again: the same message is never drafted twice for the same day.
  function runFor(st, bookings, shop, today) {
    let made = 0, blocked = 0; const winDays = shop.winDays || 42;
    const add = (c, kind, variant) => {
      const key = c.id + '|' + kind + '|' + variant;
      if (st.outbox.some(m => m.key === key && m.day === today)) return;
      const why = consentCheck(c, today);
      st.outbox.push({ id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), key, contact: c.id, to: c.name, kind, variant, day: today, text: makeText(kind, variant, c, shop), status: why ? 'blocked' : 'draft', reason: why || '' });
      if (why) blocked++; else made++;
    };
    contacts(st, bookings).forEach(c => {
      const on = st.on;
      if (on.review && c.visitDay !== null) { if (c.visitDay === today) add(c, 'review', 'first'); else if (c.visitDay === today - 3 && !c.reviewed) add(c, 'review', 'nudge'); }
      if (on.reminder && c.apptDay !== null) { if (c.apptDay === today + 1) add(c, 'reminder', '24h'); else if (c.apptDay === today) add(c, 'reminder', '2h'); }
      if (on.missed && c.status === 'missed' && c.missedDay === today) add(c, 'missed', 'first');
      if (on.inquiry && c.status === 'inquiry') { if (c.inquiryDay === today) add(c, 'inquiry', 'first'); else if (c.inquiryDay === today - 2) add(c, 'inquiry', 'followup'); }
      if (on.winback && c.visitDay !== null && today - c.visitDay === winDays) add(c, 'winback', 'first');
    });
    if (st.auto) st.outbox.forEach(m => { if (m.status === 'draft' && m.day === today) m.status = 'released'; });
    if (st.outbox.length > 250) st.outbox = st.outbox.slice(-250);
    return [made, blocked];
  }
  function decide(st, status) { let n = 0; st.outbox.forEach(m => { if (m.status === 'draft') { m.status = status; n++; } }); return n; }
  function stop(st, bookings, cid) {
    const c = contacts(st, bookings).find(x => x.id === cid); if (!c) return null;
    if (cid.startsWith('bk-')) { if (c.phone) st.stops[c.phone] = true; }
    else { const t = st.test.concat(st.leads).find(x => x.id === cid); if (t) t.stop = true; }
    const all = contacts(st, bookings);
    st.outbox.forEach(m => { if (m.status === 'draft') { const k = all.find(x => x.id === m.contact); if (k && k.stop) { m.status = 'blocked'; m.reason = 'Unsubscribed (STOP)'; } } });
    return c;
  }
  function addLead(st, today, name, phone, type) {
    const c = { id: 'ld' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4), name: (name || 'Caller').slice(0, 24), phone: String(phone || '').replace(/\D/g, '').slice(0, 15), consent: 'implied', basis: 'inquiry', consentFrom: today, visitDay: null, apptDay: null, apptTime: '', status: type, stop: false, reviewed: false, inquiryDay: type === 'inquiry' ? today : null, missedDay: type === 'missed' ? today : null };
    st.leads.push(c); return c;
  }
  function addTest(st, today, name, cv, e) {
    const d = today;
    const c = { id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4), name: (name || 'Test').slice(0, 24), phone: '', consent: cv === 'express' ? 'express' : (cv === 'none' ? 'none' : 'implied'), consentFrom: d, basis: null, visitDay: null, apptDay: null, apptTime: '2:00 PM', status: '', stop: false, reviewed: false, inquiryDay: null, missedDay: null };
    if (c.consent === 'implied') { c.basis = (e === 'inquiry' || e === 'missed') ? 'inquiry' : 'purchase'; if (cv === 'old') c.consentFrom = d - (c.basis === 'inquiry' ? 300 : 800); }
    if (e === 'visit') c.visitDay = d; else if (e === 'appt24') { c.apptDay = d + 1; c.visitDay = d - 30; } else if (e === 'appt2h') { c.apptDay = d; c.visitDay = d - 30; }
    else if (e === 'lapsed') c.visitDay = d - 42; else if (e === 'inquiry') { c.status = 'inquiry'; c.inquiryDay = d; } else if (e === 'missed') { c.status = 'missed'; c.missedDay = d; }
    st.test.push(c); return c;
  }

  const api = { iso, fromIso, dayNum, dayIso, tLabel, KINDS, INFO, fresh, normalize, contacts, consentCheck, makeText, runFor, decide, stop, addLead, addTest };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
