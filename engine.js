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

  const KINDS = { review: 'Review request', reminder: 'Appointment reminder', missed: 'Missed-call text-back', inquiry: 'Inquiry follow-up', winback: 'Win-back', digest: 'Morning summary', noshow: 'No-show follow-up', waitlist: 'Waitlist offer', replybook: 'Reply-to-book', unhappy: 'Unhappy-customer catch' };
  const INFO = {
    review: ['Review requests', 'Asks happy customers for a Google review after a visit.'],
    reminder: ['Appointment reminders', 'A message 24 hours and 2 hours before the booking.'],
    missed: ['Missed-call replies', 'Texts back right away with your booking link.'],
    inquiry: ['Inquiry follow-up', 'Answers new inquiries fast and checks in once.'],
    winback: ['Win-back notes', 'Nudges customers you have not seen in 6 weeks.'],
    digest: ['Morning summary', 'A short note to you each morning: booked today, overdue customers, missed calls, requests waiting.'],
    noshow: ['No-show follow-up', 'A polite text offering to rebook after a missed appointment. You press the No-show button.'],
    waitlist: ['Waitlist offers', 'When a slot opens up, offers it to the next person on your waitlist. You approve it first.'],
    replybook: ['Reply-to-book', 'Reads a reply like "Thursday morning?" and drafts open times for you to approve.'],
    unhappy: ['Unhappy-customer catch', 'A low rating comes to you first. No review link is sent to that customer.']
  };

  const fresh = () => ({ on: { review: true, reminder: true, missed: true, inquiry: true, winback: true, digest: true, noshow: true, waitlist: true, replybook: true, unhappy: true }, outbox: [], stops: {}, leads: [], test: [], waitlist: [], noshows: {}, auto: false, sim: 0, lastCheck: 0, msg: '' });
  // fill anything missing in saved state (older or empty rows)
  const normalize = d => { const f = fresh(), o = Object.assign(f, d || {}); o.on = Object.assign({}, fresh().on, (d && d.on) || {}); ['outbox', 'leads', 'test', 'waitlist'].forEach(k => { if (!Array.isArray(o[k])) o[k] = []; }); if (!o.stops || typeof o.stops !== 'object') o.stops = {}; if (!o.noshows || typeof o.noshows !== 'object') o.noshows = {}; return o; };

  function contacts(st, bookings) {
    const fromB = bookings.filter(b => b.status === 'accepted').map(b => {
      const d = dayNum(b.date), pd = String(b.phone || '').replace(/\D/g, ''), nsd = st.noshows && st.noshows[b.id] != null ? st.noshows[b.id] : null;
      return { id: 'bk-' + b.id, name: b.name, phone: pd, consent: b.consent ? 'express' : 'none', consentFrom: b.created_at ? dayNum(iso(new Date(b.created_at))) : d, basis: null, visitDay: nsd !== null ? null : d, noshowDay: nsd, apptDay: d, apptTime: tLabel(b.time), barber: b.barber && b.barber !== 'Anyone' ? b.barber : '', status: '', stop: !!st.stops[pd], reviewed: false, inquiryDay: null, missedDay: null };
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
    if (kind === 'review') body = variant === 'link' ? 'Hi ' + n + ', thank you! If you have a minute, a quick Google review helps us a lot: [review link]' : variant === 'apology' ? 'Hi ' + n + ', thank you for telling us, and I am sorry your visit at ' + b + ' was not right. May I call you to make it right?' : variant === 'nudge' ? 'Hi ' + n + ', quick check on your visit to ' + b + ': how was it, from 1 to 5? Just reply with a number.' : 'Hi ' + n + ', thanks for visiting ' + b + '. How was your visit, from 1 to 5? Just reply with a number.';
    else if (kind === 'reminder') body = variant === '2h' ? 'Hi ' + n + ', see you today at ' + t + (c.barber ? ' with ' + c.barber : '') + ' at ' + b + '. Reply C to confirm or X to cancel.' : 'Hi ' + n + ', a reminder of your appointment at ' + b + ' tomorrow at ' + t + (c.barber ? ' with ' + c.barber : '') + '. Reply C to confirm or X to cancel.';
    else if (kind === 'missed') body = 'Hi, sorry we missed your call at ' + b + '. Book online here: [booking link] or reply with a good time.';
    else if (kind === 'noshow') body = 'Hi ' + n + ', we missed you at your appointment at ' + b + (t ? ' (' + t + ')' : '') + '. No problem, things happen. Want to book a new time? [booking link]';
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
      if (on.noshow && c.noshowDay != null && c.noshowDay === today) add(c, 'noshow', 'first');
    });
    if (st.on.digest) { const dg = digestFor(st, bookings, shop, today); if (dg && ownerMsg(st, today, 'digest', 'first', 'owner|digest|' + today, dg.text)) made++; }
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


  /* ---------- messages that go to the owner (no consent rules apply, it is their own phone) ---------- */
  function ownerMsg(st, today, kind, variant, key, text) {
    if (st.outbox.some(m => m.key === key && m.day === today)) return false;
    st.outbox.push({ id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), key, contact: 'owner', to: 'You', kind, variant, day: today, text, status: 'draft', owner: true });
    return true;
  }
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

  /* 1. Morning summary */
  function digestFor(st, bookings, shop, today) {
    const winDays = shop.winDays || 42, ownerBooked = bookings.filter(b => b.status === 'accepted' && dayNum(b.date) === today);
    const waiting = bookings.filter(b => b.status === 'new').length;
    const cs = contacts(st, bookings);
    const missed = cs.filter(c => c.status === 'missed' && c.missedDay === today).length;
    const seen = {}; let overdue = 0;
    cs.forEach(c => { if (c.visitDay === null || c.stop) return; const k = c.phone || c.id; if (seen[k]) return; seen[k] = 1; if (today - c.visitDay >= winDays) overdue++; });
    const first = ownerBooked.slice().sort((a, b) => a.time - b.time)[0];
    const text = 'Good morning. Today: ' + plural(ownerBooked.length, 'booked', 'booked') + (first ? ', first at ' + tLabel(first.time) : '') + ', ' + plural(overdue, 'customer overdue for a visit', 'customers overdue for a visit') + ', ' + plural(missed, 'missed call', 'missed calls') + ', ' + plural(waiting, 'request waiting for your answer', 'requests waiting for your answer') + '. — ' + shop.name;
    return { text, booked: ownerBooked.length, overdue, missed, waiting };
  }

  /* 5. No-show: the owner presses a button, the follow-up is drafted the same day */
  function markNoShow(st, bookings, bookingId, today) {
    if (!bookings.some(b => b.id === bookingId)) return null;
    st.noshows[bookingId] = today; return true;
  }

  /* 4. Waitlist: offers go to the next person only after the owner approves */
  function addWaitlist(st, today, name, phone, service) {
    const w = { id: 'wl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4), name: (name || 'Customer').slice(0, 24), phone: String(phone || '').replace(/\D/g, '').slice(0, 15), service: String(service || '').slice(0, 60), consent: 'implied', basis: 'inquiry', consentFrom: today, visitDay: null, apptDay: null, apptTime: '', status: 'waiting', addedDay: today, stop: false };
    st.waitlist.push(w); return w;
  }
  // slot = { date: 'YYYY-MM-DD', time: minutes }. Returns the draft, or null if nobody can be offered the slot.
  function offerSlot(st, shop, today, slot) {
    for (const w of st.waitlist) {
      if (w.status !== 'waiting' || w.stop || (w.phone && st.stops[w.phone])) continue;
      const why = consentCheck(w, today); if (why) continue;
      const when = niceDay(dayNum(slot.date)) + ' at ' + tLabel(slot.time);
      const m = { id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), key: w.id + '|waitlist|' + slot.date + '|' + slot.time, contact: w.id, to: w.name, kind: 'waitlist', variant: 'offer', day: today, text: 'Hi ' + w.name + ', a spot just opened at ' + shop.name + ' on ' + when + '. Want it? Reply YES and we will hold it for you.' + foot(shop), status: 'draft', slot };
      if (st.outbox.some(x => x.key === m.key)) return null;
      st.outbox.push(m); w.status = 'offered'; w.offered = slot; return m;
    }
    return null;
  }

  /* day names */
  const DN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function niceDay(n) { const d = new Date(EPOCH + n * 86400000); return DN[d.getUTCDay()] + ' ' + MN[d.getUTCMonth()] + ' ' + d.getUTCDate(); }
  const dowOf = n => new Date(EPOCH + n * 86400000).getUTCDay(); // 0 = Sunday

  /* open slots from the shop's hours and accepted bookings */
  function freeSlots(bookings, shop, today, fromDay, toDay, nowMin) {
    const h = shop.hours || { start: 540, end: 1080, days: [true, true, true, true, true, true, false] }, step = shop.slotMins || 30, out = [];
    for (let d = fromDay; d <= toDay; d++) {
      const dw = (dowOf(d) + 6) % 7; if (!h.days[dw]) continue; // owner days are Monday first
      const day = dayIso(d), busy = bookings.filter(b => b.status === 'accepted' && b.date === day).map(b => [b.time, b.end_time || b.time + step]);
      for (let m = h.start; m + step <= h.end; m += step) {
        if (d === today && m <= (nowMin == null ? 0 : nowMin)) continue;
        if (busy.some(r => m < r[1] && m + step > r[0])) continue;
        out.push({ date: day, day: d, time: m });
      }
    }
    return out;
  }

  /* what the customer asked for: a day and a part of the day */
  function parseWhen(text, today) {
    const t = ' ' + String(text || '').toLowerCase() + ' ';
    let from = today, to = today + 6, days = null;
    if (/\btoday\b|\btonight\b/.test(t)) { from = to = today; }
    else if (/\btomorrow\b/.test(t)) { from = to = today + 1; }
    else {
      const names = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
      for (let i = 0; i < 7; i++) if (new RegExp('\\b' + names[i] + '[a-z]*\\b').test(t)) { days = days || []; days.push(i); }
      if (/\bweekend\b/.test(t)) days = [6, 0];
    }
    let win = [0, 1440];
    if (/\bmorning\b|\bam\b/.test(t)) win = [0, 720]; else if (/\bafternoon\b/.test(t)) win = [720, 1020]; else if (/\bevening\b|\bafter work\b|\bafter 5\b/.test(t)) win = [1020, 1440];
    const hm = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
    let exact = null; if (hm) { let h = +hm[1] % 12 + (hm[3] === 'pm' ? 12 : 0); exact = h * 60 + (+(hm[2] || 0)); }
    return { from, to, days, win, exact, any: !!(days || exact || /\b(today|tonight|tomorrow|morning|afternoon|evening|weekend|\bam\b|\bpm\b|when|time|available|open|book|appointment|fit me|slot)\b/.test(t)) };
  }

  /* 2 and 3. A customer reply comes in. Returns { type, ... } and drafts what the owner should approve. Nothing is sent. */
  function handleReply(st, bookings, shop, today, contactId, text, nowMin) {
    const c = contacts(st, bookings).concat(st.waitlist).find(x => x.id === contactId); if (!c) return { type: 'unknown' };
    const body = String(text || '').trim().slice(0, 300), low = body.toLowerCase();
    if (/^\s*stop\b/.test(low)) { if (String(contactId).startsWith('wl')) { c.stop = true; if (c.phone) st.stops[c.phone] = true; } else stop(st, bookings, contactId); return { type: 'stop' }; }
    const draft = (kind, variant, txt, extra) => { const m = Object.assign({ id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), key: contactId + '|' + kind + '|' + variant + '|' + today + '|' + st.outbox.length, contact: contactId, to: c.name, kind, variant, day: today, text: txt, status: 'draft' }, extra || {}); st.outbox.push(m); return m; };
    // a rating: "5", "4/5", "3 out of 5"
    const rm = body.match(/^\s*([1-5])\b(?!\s*(?:am|pm|:))/) || body.match(/\b([1-5])\s*(?:\/|out of)\s*5\b/);
    if (rm && !/\b(am|pm)\b/.test(low)) {
      const r = +rm[1];
      if (r >= 4) { if (st.on.review) draft('review', 'link', makeText('review', 'link', c, shop)); return { type: 'happy', rating: r }; }
      if (st.on.unhappy) {
        ownerMsg(st, today, 'unhappy', 'alert', contactId + '|unhappy|' + today, c.name + ' rated their visit ' + r + ' out of 5' + (body.length > 2 ? ': "' + body + '"' : '.') + ' No review link was sent. A reply is ready below for you to approve or change.');
        draft('review', 'apology', makeText('review', 'apology', c, shop));
      }
      return { type: 'unhappy', rating: r };
    }
    // waitlist: YES to an offer
    if (c.status === 'offered' && /^\s*(yes|yep|yeah|sure|ok|okay)\b/.test(low)) {
      c.status = 'accepted-offer'; ownerMsg(st, today, 'waitlist', 'yes', contactId + '|wlyes|' + today, c.name + ' said YES to the open slot on ' + niceDay(dayNum(c.offered.date)) + ' at ' + tLabel(c.offered.time) + '. Add the appointment in Appointments to confirm it.');
      return { type: 'waitlist-yes', slot: c.offered };
    }
    // reply-to-book: "Thursday morning?"
    if (st.on.replybook) {
      const w = parseWhen(body, today);
      if (w.any) {
        let fromDay = w.from, toDay = w.to; if (w.days) { toDay = today + 13; }
        let slots = freeSlots(bookings, shop, today, fromDay, toDay, nowMin).filter(x => (!w.days || w.days.includes(dowOf(x.day))) && x.time >= w.win[0] && x.time < w.win[1]);
        if (w.exact != null) { const hit = slots.find(x => x.time === w.exact); if (hit) { draft('replybook', 'confirm', 'Hi ' + c.name + ', great, ' + niceDay(hit.day) + ' at ' + tLabel(hit.time) + ' works. We have you down and will confirm shortly.' + foot(shop), { slot: { date: hit.date, time: hit.time } }); return { type: 'pick', slot: hit }; } }
        // up to 3 options, spread over different days where possible
        const pick = []; const byDay = {}; slots.forEach(x => { (byDay[x.day] = byDay[x.day] || []).push(x); });
        Object.keys(byDay).slice(0, 3).forEach(d => { const L = byDay[d]; pick.push(L[Math.floor(L.length / 2)]); if (pick.length < 3 && L.length > 3) pick.push(L[0]); });
        const opts = pick.slice(0, 3);
        if (!opts.length) { draft('replybook', 'none', 'Hi ' + c.name + ', sorry, nothing is open then. Which other day or time works for you?' + foot(shop)); return { type: 'no-slots' }; }
        const list = opts.map(x => niceDay(x.day) + ' at ' + tLabel(x.time)).join(', or ');
        draft('replybook', 'options', 'Hi ' + c.name + ', yes we can fit you in. Open times: ' + list + '. Reply with the one you want.' + foot(shop), { slots: opts.map(x => ({ date: x.date, time: x.time })) });
        return { type: 'options', slots: opts };
      }
    }
    return { type: 'other' };
  }

  const api = { iso, fromIso, dayNum, dayIso, tLabel, KINDS, INFO, fresh, normalize, contacts, consentCheck, makeText, runFor, decide, stop, addLead, addTest, digestFor, markNoShow, addWaitlist, offerSlot, handleReply, freeSlots, niceDay };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
