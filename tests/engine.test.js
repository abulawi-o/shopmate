// Run: node tests/engine.test.js   (no install needed)
const assert = require('assert'), E = require('../engine.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const shop = { name: 'Demo Barbershop', address: '1 Main St', winDays: 42, hours: { start: 540, end: 1080, days: [true, true, true, true, true, true, false] } };
const TODAY = E.dayNum('2026-11-11'); // a Wednesday
const bk = (id, date, time, extra) => Object.assign({ id, name: 'Sam ' + id, phone: '905555' + id.padStart(4, '0'), status: 'accepted', date, time, end_time: time + 30, barber: 'Alex', consent: true, created_at: '2026-10-01T10:00:00Z' }, extra || {});

t('old saved state still loads and gets the new fields', () => {
  const st = E.normalize({ on: { review: true }, outbox: [], stops: {} });
  assert.ok(st.on.digest && st.on.noshow && st.on.waitlist && st.on.replybook && st.on.unhappy);
  assert.deepStrictEqual(st.waitlist, []); assert.deepStrictEqual(st.noshows, {});
});
t('morning summary counts booked, overdue, missed, waiting', () => {
  const st = E.normalize(null); E.addLead(st, TODAY, 'Mia', '9055550100', 'missed');
  const bookings = [bk('1', '2026-11-11', 600), bk('2', '2026-11-11', 660), bk('3', '2026-09-01', 600), bk('4', '2026-11-12', 600, { status: 'new' })];
  const d = E.digestFor(st, bookings, shop, TODAY);
  assert.strictEqual(d.booked, 2); assert.strictEqual(d.missed, 1); assert.strictEqual(d.waiting, 1); assert.strictEqual(d.overdue, 1);
  assert.ok(/2 booked, first at 10:00 AM/.test(d.text) && /1 request waiting/.test(d.text));
});
t('morning summary is drafted once per day, to the owner, never blocked by consent', () => {
  const st = E.normalize(null); const bookings = [bk('1', '2026-11-11', 600, { consent: false })];
  E.runFor(st, bookings, shop, TODAY); E.runFor(st, bookings, shop, TODAY);
  const d = st.outbox.filter(m => m.kind === 'digest'); assert.strictEqual(d.length, 1); assert.strictEqual(d[0].status, 'draft'); assert.strictEqual(d[0].to, 'You');
  assert.ok(!/STOP/.test(d[0].text));
});
t('morning summary can be switched off', () => {
  const st = E.normalize(null); st.on.digest = false; E.runFor(st, [], shop, TODAY);
  assert.strictEqual(st.outbox.filter(m => m.kind === 'digest').length, 0);
});
t('no-show: draft rebook text the same day, no review request', () => {
  const st = E.normalize(null), b = bk('7', '2026-11-11', 600);
  E.runFor(st, [b], shop, TODAY); assert.strictEqual(st.outbox.filter(m => m.kind === 'review').length, 1);
  const st2 = E.normalize(null); E.markNoShow(st2, [b], '7', TODAY); E.runFor(st2, [b], shop, TODAY);
  assert.strictEqual(st2.outbox.filter(m => m.kind === 'noshow').length, 1); assert.strictEqual(st2.outbox.filter(m => m.kind === 'review').length, 0);
  assert.ok(/Reply STOP/.test(st2.outbox.find(m => m.kind === 'noshow').text));
});
t('no-show to a customer without consent is blocked', () => {
  const st = E.normalize(null), b = bk('8', '2026-11-11', 600, { consent: false }); E.markNoShow(st, [b], '8', TODAY); E.runFor(st, [b], shop, TODAY);
  assert.strictEqual(st.outbox.find(m => m.kind === 'noshow').status, 'blocked');
});
t('unhappy-first: 5 gets the review link, 2 goes to the owner with no link', () => {
  const st = E.normalize(null), b = bk('9', '2026-11-10', 600); const c = E.contacts(st, [b])[0];
  const r1 = E.handleReply(st, [b], shop, TODAY, c.id, '5'); assert.strictEqual(r1.type, 'happy');
  assert.ok(st.outbox.some(m => m.kind === 'review' && m.variant === 'link' && /review link/.test(m.text)));
  const st2 = E.normalize(null); const r2 = E.handleReply(st2, [b], shop, TODAY, c.id, '2 waited too long');
  assert.strictEqual(r2.type, 'unhappy');
  assert.ok(st2.outbox.some(m => m.kind === 'unhappy' && m.to === 'You' && /2 out of 5/.test(m.text)));
  assert.ok(!st2.outbox.some(m => /\[review link\]/.test(m.text)), 'no review link for an unhappy customer');
  assert.ok(st2.outbox.every(m => m.status === 'draft'));
});
t('review first message asks for a rating, not a link', () => {
  const st = E.normalize(null), b = bk('10', '2026-11-11', 600); E.runFor(st, [b], shop, TODAY);
  const m = st.outbox.find(x => x.kind === 'review' && x.variant === 'first'); assert.ok(/1 to 5/.test(m.text) && !/review link/.test(m.text));
});
t('"4pm" is not mistaken for a rating', () => {
  const st = E.normalize(null), b = bk('11', '2026-11-10', 600), c = E.contacts(st, [b])[0];
  const r = E.handleReply(st, [b], shop, TODAY, c.id, '4pm tomorrow?'); assert.notStrictEqual(r.type, 'happy'); assert.notStrictEqual(r.type, 'unhappy');
});
t('waitlist: slot goes to first eligible person as a draft', () => {
  const st = E.normalize(null); const a = E.addWaitlist(st, TODAY, 'Ana', '9055550111', 'Fade'), b = E.addWaitlist(st, TODAY, 'Ben', '9055550112', 'Fade');
  const m = E.offerSlot(st, shop, TODAY, { date: '2026-11-12', time: 600 });
  assert.strictEqual(m.to, 'Ana'); assert.strictEqual(m.status, 'draft'); assert.ok(/Thu Nov 12 at 10:00 AM/.test(m.text) && /Reply STOP/.test(m.text));
  assert.strictEqual(a.status, 'offered'); assert.strictEqual(b.status, 'waiting');
  const m2 = E.offerSlot(st, shop, TODAY, { date: '2026-11-12', time: 660 }); assert.strictEqual(m2.to, 'Ben');
  assert.strictEqual(E.offerSlot(st, shop, TODAY, { date: '2026-11-12', time: 720 }), null);
});
t('waitlist skips STOPped and expired-consent people', () => {
  const st = E.normalize(null); const a = E.addWaitlist(st, TODAY, 'Ana', '9055550111'), b = E.addWaitlist(st, TODAY, 'Ben', '9055550112');
  E.handleReply(st, [], shop, TODAY, a.id, 'STOP'); assert.ok(a.stop);
  b.consentFrom = TODAY - 300; // inquiry basis, 180 day limit
  assert.strictEqual(E.offerSlot(st, shop, TODAY, { date: '2026-11-12', time: 600 }), null);
});
t('waitlist YES tells the owner to add the appointment, does not book', () => {
  const st = E.normalize(null); const a = E.addWaitlist(st, TODAY, 'Ana', '9055550111'); E.offerSlot(st, shop, TODAY, { date: '2026-11-12', time: 600 });
  const r = E.handleReply(st, [], shop, TODAY, a.id, 'yes please'); assert.strictEqual(r.type, 'waitlist-yes');
  assert.ok(st.outbox.some(m => m.to === 'You' && /Add the appointment/.test(m.text)));
});
t('reply-to-book: "Thursday morning?" drafts up to 3 morning times on Thursdays', () => {
  const st = E.normalize(null), b = bk('12', '2026-11-10', 600), c = E.contacts(st, [b])[0];
  const r = E.handleReply(st, [b], shop, TODAY, c.id, 'Thursday morning?'); assert.strictEqual(r.type, 'options');
  assert.ok(r.slots.length >= 1 && r.slots.length <= 3); r.slots.forEach(s => { assert.ok(s.time < 720 && s.time >= 540); assert.ok(/Thu/.test(E.niceDay(s.day))); });
  const m = st.outbox.find(x => x.kind === 'replybook'); assert.strictEqual(m.status, 'draft'); assert.ok(/Reply with the one you want/.test(m.text) && /Reply STOP/.test(m.text));
});
t('reply-to-book never offers a busy or closed slot', () => {
  const st = E.normalize(null), busy = bk('13', '2026-11-12', 600, { end_time: 660 }), c = E.contacts(st, [busy])[0];
  const slots = E.freeSlots([busy], shop, TODAY, TODAY, TODAY + 6, 0);
  assert.ok(!slots.some(s => s.date === '2026-11-12' && s.time >= 600 && s.time < 660), 'busy slot excluded');
  assert.ok(!slots.some(s => E.niceDay(s.day).startsWith('Sun')), 'closed Sunday excluded');
  const r = E.handleReply(st, [busy], shop, TODAY, c.id, 'Sunday?'); assert.strictEqual(r.type, 'no-slots');
});
t('reply-to-book: exact time that is free is confirmed as a draft for the owner', () => {
  const st = E.normalize(null), b = bk('14', '2026-11-10', 600), c = E.contacts(st, [b])[0];
  const r = E.handleReply(st, [b], shop, TODAY, c.id, 'tomorrow 2pm'); assert.strictEqual(r.type, 'pick'); assert.strictEqual(r.slot.time, 840);
  assert.strictEqual(st.outbox.find(m => m.variant === 'confirm').status, 'draft');
});
t('reply-to-book can be switched off', () => {
  const st = E.normalize(null); st.on.replybook = false; const b = bk('15', '2026-11-10', 600), c = E.contacts(st, [b])[0];
  assert.strictEqual(E.handleReply(st, [b], shop, TODAY, c.id, 'Thursday morning?').type, 'other');
});
t('STOP in a reply blocks every later draft to that customer', () => {
  const st = E.normalize(null), b = bk('16', '2026-11-11', 600), c = E.contacts(st, [b])[0];
  E.handleReply(st, [b], shop, TODAY, c.id, 'STOP'); E.runFor(st, [b], shop, TODAY + 1);
  assert.ok(st.outbox.filter(m => m.contact === c.id).every(m => m.status === 'blocked'));
});
console.log('\n' + n + ' tests passed');
