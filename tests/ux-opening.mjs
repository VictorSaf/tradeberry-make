// Opening Note once a day (UX report 09.11.2026, F15; round 2 defects; opening.js): first opening of the UTC day shows
// it, a reload after "Let's begin" goes straight to the terminal, an edition written after the note was seen comes back
// at the next opening (never over a terminal already on screen), "Don't show again today" counts the UTC day.
// The note is not shown to automated browsers, so these tests hide navigator.webdriver from the page.
const notWebdriver = { fn: () => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }), arg: null };
const pause = ms => new Promise(r => setTimeout(r, ms));
const utcToday = () => new Date().toISOString().slice(0, 10);
const nowSec = () => Math.floor(Date.now() / 1000);
// '<UTC day>|<edition>|s<server ts>' (round 3: the server's created_at of what was seen, never the client's clock)
const SEEN_RE = day => new RegExp(`^${day}\\|(.+)\\|s(\\d+)$`);
const booted = page => page.waitForFunction(() => typeof S === 'object' && S, null, { timeout: 30000 });
const revealed = page => page.waitForFunction(() => { const c = document.querySelector('#onote .onote-copy'); return c && c.style.visibility !== 'hidden'; }, null, { timeout: 8000 });
// /api/edition answered by the test: the edition, after `delay` ms
const serve = async (page, edition, delay = 0) => {
  await page.unroute('**/api/edition').catch(() => {});
  await page.route('**/api/edition', async r => { if (delay) await pause(delay); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ edition, admin: false }) }).catch(() => {}); });
};

export const tests = [
  {
    name: 'ONOTE1 Opening Note once a day: shown at the first opening, not after "Let\'s begin" and a reload; an edition written later shows at the next opening',
    async run({ t, open }) {
      const page = await open('/', { init: notWebdriver });
      await page.waitForSelector('#onote', { timeout: 10000 });
      await revealed(page);
      t.eq(await page.textContent('#onote .onote-meta span:nth-child(2)'), 'Edition 01', 'the built-in note (no server edition)');
      await page.click('#onoteBegin');
      const today = utcToday();
      const v = await page.evaluate(() => localStorage.getItem('tb-onote-seen'));
      const m = SEEN_RE(today).exec(v || '');
      t.ok(m && m[1] === '-', 'seen today, built-in note: ' + v);
      t.ok(m && +m[2] === 0, 'no edition known by the server at that moment: reference 0 (server time), not the client clock: ' + v);

      // same day, same edition: straight to the terminal
      await page.reload();
      await booted(page);
      await pause(2500); // past the 1.8 s the note used to wait for the edition
      t.eq(await page.$('#onote'), null, 'no note after a reload on the same day');

      // an edition written after the note was seen: not over the terminal of this opening, at the next one
      const edition = { day: today, n: 2, ts: nowSec() + 30, title: 'A test edition', body: 'Body.', quote: 'Quote.' };
      await serve(page, edition);
      await page.reload();
      await booted(page);
      await pause(2500);
      t.eq(await page.$('#onote'), null, 'the terminal of this opening is not covered');
      await page.reload();
      await page.waitForSelector('#onote', { timeout: 10000 });
      await revealed(page);
      t.eq(await page.textContent('#onoteTitle'), 'A test edition', 'the new edition is shown at the next opening');
      t.eq(await page.textContent('#onote .onote-meta span:nth-child(2)'), 'Edition 02', 'its number');
      await page.click('#onoteBegin');
      const v2 = await page.evaluate(() => localStorage.getItem('tb-onote-seen'));
      const m2 = SEEN_RE(today).exec(v2 || '');
      t.ok(m2 && m2[1] === `${today}:2`, 'this edition is now seen: ' + v2);
      t.ok(m2 && +m2[2] === edition.ts, 'with its server time: ' + v2);

      // that edition seen: a reload goes straight to the terminal again
      await page.reload();
      await booted(page);
      await pause(2500);
      t.eq(await page.$('#onote'), null, 'no note for an edition already seen');

      // a new UTC day (seen yesterday): shown again
      await page.evaluate(() => localStorage.setItem('tb-onote-seen', '2000-01-01|' + new Date().toISOString().slice(0, 10) + ':2|946684800'));
      await page.reload();
      await page.waitForSelector('#onote', { timeout: 10000 });
      t.noErrors(page);
    }
  },
  {
    name: 'ONOTE2 a new edition answering late on a day already seen does not cover the terminal, take the scroll or the focus; it shows at the next opening',
    async run({ t, open }) {
      const page = await open('/', { init: notWebdriver });
      await booted(page);
      const today = utcToday();
      // the day is seen (an hour ago), the built-in note
      await page.evaluate(v => { localStorage.setItem('tb-onote-seen', v); localStorage.removeItem('tb-opening-skip'); }, `${today}|-|${nowSec() - 3600}`);
      await page.waitForSelector('#onote', { state: 'detached', timeout: 10000 }).catch(() => {});
      await serve(page, { day: today, n: 3, ts: nowSec() - 60, title: 'Late edition', body: 'Body.', quote: 'Quote.' }, 1200);
      await page.reload();
      await booted(page);
      // the user is already typing in the ticket when the edition answers
      await page.focus('#tkLots');
      await pause(2600);
      t.eq(await page.$('#onote'), null, 'no note over the terminal');
      t.eq(await page.evaluate(() => document.documentElement.classList.contains('onote-open')), false, 'scroll not locked');
      t.eq(await page.evaluate(() => document.activeElement && document.activeElement.id), 'tkLots', 'the focus stays in the field');
      // next opening: the edition, written after the note was seen, is shown
      await serve(page, { day: today, n: 3, ts: nowSec() - 60, title: 'Late edition', body: 'Body.', quote: 'Quote.' });
      await page.reload();
      await page.waitForSelector('#onote', { timeout: 10000 });
      await revealed(page);
      t.eq(await page.textContent('#onoteTitle'), 'Late edition', 'the edition shows at the next opening');
      t.noErrors(page);
    }
  },
  {
    name: 'ONOTE3 first opening with a slow edition: the built-in note is seen; at the reload the same (older) edition answering on time does not bring the note back',
    async run({ t, open }) {
      const page = await open('/', { init: notWebdriver });
      const today = utcToday();
      // the edition exists (written an hour ago) but answers after the 1.8 s the note waits; one edition, one created_at
      const slow = { day: today, n: 1, ts: nowSec() - 3600, title: 'Slow edition', body: 'Body.', quote: 'Quote.' };
      await serve(page, slow, 2600);
      await page.reload();
      await page.waitForSelector('#onote', { timeout: 10000 });
      await revealed(page);
      t.eq(await page.textContent('#onote .onote-meta span:nth-child(2)'), 'Edition 01', 'the built-in note while the edition is late');
      await page.click('#onoteBegin');
      await pause(3000); // the slow answer arrives meanwhile
      await serve(page, slow);
      await page.reload();
      await booted(page);
      await pause(2500);
      t.eq(await page.$('#onote'), null, 'an edition written before the note was seen does not show it a second time');
      await page.reload();
      await booted(page);
      await pause(2500);
      t.eq(await page.$('#onote'), null, 'nor at the opening after');
      t.noErrors(page);
    }
  },
  {
    name: 'ONOTE4 "Don\'t show again today" counts the UTC day, like the seen mark; an old local-date value is migrated quietly',
    async run({ t, open }) {
      const page = await open('/', { init: notWebdriver });
      await page.waitForSelector('#onote', { timeout: 10000 });
      await revealed(page);
      await page.evaluate(() => document.getElementById('onoteSkip').click()); // hidden by design (v15.14.2), still wired
      t.eq(await page.evaluate(() => localStorage.getItem('tb-opening-skip')), 'utc:' + utcToday(), 'skip kept as the UTC day');
      await page.evaluate(() => localStorage.removeItem('tb-onote-seen')); // only the skip keeps it away now
      await page.reload();
      await booted(page);
      await pause(2500);
      t.eq(await page.$('#onote'), null, 'skipped for the UTC day');

      // the old value (the local date of the click, written by the previous version): honoured once, migrated to the UTC day
      await page.evaluate(() => { localStorage.setItem('tb-opening-skip', new Date().toISOString().slice(0, 10)); localStorage.removeItem('tb-onote-seen'); }); // the local date of the click, on a day when it is the UTC day (ONOTE10: otherwise dropped)
      await page.reload();
      await booted(page);
      await pause(2500);
      t.eq(await page.$('#onote'), null, 'the old skip of today still keeps the note away');
      t.eq(await page.evaluate(() => localStorage.getItem('tb-opening-skip')), 'utc:' + utcToday(), 'migrated to the UTC day');

      // a skip from another day (old or new form): the note shows
      await page.evaluate(() => localStorage.setItem('tb-opening-skip', '2000-01-01'));
      await page.reload();
      await page.waitForSelector('#onote', { timeout: 10000 });
      await page.evaluate(() => localStorage.setItem('tb-opening-skip', 'utc:2000-01-01'));
      await page.reload();
      await page.waitForSelector('#onote', { timeout: 10000 });
      t.noErrors(page);
    }
  },
  {
    name: 'ONOTE5 Escape plays "Let\'s begin": the note leaves and the day is marked seen',
    async run({ t, open }) {
      const page = await open('/', { init: notWebdriver });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForSelector('#onote', { timeout: 10000 });
      await revealed(page);
      await page.focus('#onoteBegin');
      await page.keyboard.press('Escape');
      await page.waitForSelector('#onote', { state: 'detached', timeout: 5000 });
      t.eq(await page.evaluate(() => document.documentElement.classList.contains('onote-open')), false, 'scroll unlocked');
      t.ok(SEEN_RE(utcToday()).test(await page.evaluate(() => localStorage.getItem('tb-onote-seen')) || ''), 'the day is marked seen');
      t.noErrors(page);
    }
  },
  {
    name: 'ONOTE6 a malformed tb-onote-seen value: the note shows (as an unseen day), without errors, and the value is written again in its form',
    async run({ t, open }) {
      const page = await open('/', { init: notWebdriver });
      await page.waitForSelector('#onote', { timeout: 10000 });
      await page.click('#onoteBegin');
      for (const bad of ['garbage', '|||', utcToday() + '|', utcToday(), '{"x":1}', utcToday() + '|-|notanumber']) {
        await page.evaluate(v => localStorage.setItem('tb-onote-seen', v), bad);
        await page.reload();
        await page.waitForSelector('#onote', { timeout: 10000 });
        await revealed(page);
        await page.click('#onoteBegin');
        t.ok(SEEN_RE(utcToday()).test(await page.evaluate(() => localStorage.getItem('tb-onote-seen')) || ''), 'rewritten after ' + JSON.stringify(bad));
      }
      t.noErrors(page);
    }
  },
  {
    name: 'ONOTE7 storage blocked: the note shows at every opening, "Let\'s begin" and "Don\'t show again today" still close it, no errors from opening.js',
    async run({ t, open }) {
      const block = { fn: () => {
        Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
        const no = { get() { throw new DOMException('blocked', 'SecurityError'); } };
        Object.defineProperty(window, 'localStorage', no); Object.defineProperty(window, 'sessionStorage', no);
        // round 3: errors are caught by their source (the file in the event or in the stack), whatever their message says
        const errs = window.__srcErrs = [];
        addEventListener('error', ev => errs.push({ file: ev.filename || '', stack: (ev.error && ev.error.stack) || '', msg: ev.message || '' }));
        addEventListener('unhandledrejection', ev => errs.push({ file: '', stack: (ev.reason && ev.reason.stack) || '', msg: String(ev.reason) }));
      }, arg: null };
      const mine = [];
      const collect = async page => { for (const e of await page.evaluate(() => window.__srcErrs || [])) if (/\bopening\.js\b/.test(e.file + ' ' + e.stack)) mine.push(e.msg); };
      const page = await open('/', { init: block });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForSelector('#onote', { timeout: 10000 });
      await revealed(page);
      await page.click('#onoteBegin');
      await page.waitForSelector('#onote', { state: 'detached', timeout: 5000 });
      await collect(page);
      await page.reload();
      await page.waitForSelector('#onote', { timeout: 10000 });
      await revealed(page);
      await page.evaluate(() => document.getElementById('onoteSkip').click()); // hidden by design (v15.14.2), still wired
      await page.waitForSelector('#onote', { state: 'detached', timeout: 5000 });
      await pause(300);
      await collect(page);
      t.eq(mine.length, 0, 'no errors raised in opening.js: ' + mine.join(' | '));
    }
  },
  {
    name: 'ONOTE8 tb-onote-next with an edition that answers late again: the built-in note shows and the edition is kept for the next opening, not lost for the day',
    async run({ t, open }) {
      const page = await open('/', { init: notWebdriver });
      await booted(page);
      const today = utcToday(), ed = { day: today, n: 4, ts: 1000, title: 'Waiting edition', body: 'Body.', quote: 'Quote.' };
      await page.evaluate(([d]) => { localStorage.setItem('tb-onote-seen', d + '|-|s0'); localStorage.setItem('tb-onote-next', d); localStorage.removeItem('tb-opening-skip'); }, [today]);
      await serve(page, ed, 2600);
      await page.reload();
      await page.waitForSelector('#onote', { timeout: 10000 });
      await revealed(page);
      t.eq(await page.textContent('#onote .onote-meta span:nth-child(2)'), 'Edition 01', 'the built-in note while the edition is late');
      await page.click('#onoteBegin');
      await pause(3000); // the late answer arrives meanwhile
      t.eq(await page.evaluate(() => localStorage.getItem('tb-onote-next')), today, 'the edition that brought the note back is still due');
      await serve(page, ed);
      await page.reload();
      await page.waitForSelector('#onote', { timeout: 10000 });
      await revealed(page);
      t.eq(await page.textContent('#onoteTitle'), 'Waiting edition', 'it shows at the next opening');
      await page.click('#onoteBegin');
      t.eq(await page.evaluate(() => localStorage.getItem('tb-onote-next')), null, 'shown: no longer due');
      await page.reload();
      await booted(page);
      await pause(2500);
      t.eq(await page.$('#onote'), null, 'and not again that day');
      t.noErrors(page);
    }
  },
  {
    name: 'ONOTE9 the client clock is never compared with the server time: an edition written after the note was seen shows even with a fast client clock; a late one known then does not come back with a slow clock',
    async run({ t, open }) {
      const page = await open('/', { init: notWebdriver });
      await page.waitForSelector('#onote', { timeout: 10000 });
      await revealed(page);
      await page.click('#onoteBegin'); // no edition on the server: the built-in note is seen
      const today = utcToday();
      // the server writes an edition afterwards; its created_at reads two hours before the client clock (client fast)
      await serve(page, { day: today, n: 1, ts: nowSec() - 7200, title: 'After you saw it', body: 'Body.', quote: 'Quote.' });
      await page.reload();
      await booted(page);
      await pause(2500);
      t.eq(await page.$('#onote'), null, 'not over the terminal of this opening');
      await page.reload();
      await page.waitForSelector('#onote', { timeout: 10000 });
      await revealed(page);
      t.eq(await page.textContent('#onoteTitle'), 'After you saw it', 'shown at the next opening although its server time is "before" the client clock');
      await page.click('#onoteBegin');

      // a new day of the test: the edition exists but answers late; its created_at reads an hour after the client clock (client slow)
      await page.evaluate(() => { localStorage.removeItem('tb-onote-seen'); localStorage.removeItem('tb-onote-next'); });
      const late = { day: today, n: 2, ts: nowSec() + 3600, title: 'Late and known', body: 'Body.', quote: 'Quote.' };
      await serve(page, late, 2600);
      await page.reload();
      await page.waitForSelector('#onote', { timeout: 10000 });
      await revealed(page);
      t.eq(await page.textContent('#onote .onote-meta span:nth-child(2)'), 'Edition 01', 'the built-in note while it is late');
      await page.click('#onoteBegin');
      await pause(3000);
      const v = await page.evaluate(() => localStorage.getItem('tb-onote-seen'));
      t.eq(v, `${today}|-|s${late.ts}`, 'the reference is the server time of the edition the server had then');
      await serve(page, late);
      await page.reload();
      await booted(page);
      await pause(2500);
      await page.reload();
      await booted(page);
      await pause(2500);
      t.eq(await page.$('#onote'), null, 'that edition does not bring the note back, whatever the client clock says');
      t.noErrors(page);
    }
  },
  {
    name: 'ONOTE10 the old local-date skip is migrated only when it is today\'s UTC day; a local date that is another UTC day is dropped',
    async run({ t, open }) {
      const page = await open('/', { init: notWebdriver });
      await page.waitForSelector('#onote', { timeout: 10000 });
      // a time zone where the local date is not the UTC date now (west of UTC in the evening, east in the morning)
      const tz = new Date().getUTCHours() < 11 ? 'Pacific/Pago_Pago' : 'Pacific/Kiritimati';
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setTimezoneOverride', { timezoneId: tz });
      const local = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
      t.ok(local !== utcToday(), `local date ${local} differs from the UTC day ${utcToday()} in ${tz}`);
      await page.evaluate(d => { localStorage.setItem('tb-opening-skip', d); localStorage.removeItem('tb-onote-seen'); }, local);
      await page.reload();
      await page.waitForSelector('#onote', { timeout: 10000 });
      t.eq(await page.evaluate(() => localStorage.getItem('tb-opening-skip')), null, 'a skip of another UTC day is dropped, not moved onto today');
      // an old value equal to today's UTC day: kept, in the new form
      await page.evaluate(d => { localStorage.setItem('tb-opening-skip', d); localStorage.removeItem('tb-onote-seen'); }, utcToday());
      await page.reload();
      await booted(page);
      await pause(2500);
      t.eq(await page.$('#onote'), null, 'the old skip of today\'s UTC day still keeps the note away');
      t.eq(await page.evaluate(() => localStorage.getItem('tb-opening-skip')), 'utc:' + utcToday(), 'migrated to the UTC form');
      t.noErrors(page);
    }
  }
  ,
  {
    name: 'ONOTE11 a due edition the server cannot give (none today) stops bringing the built-in note back; a late one gets two more tries, not the whole day',
    async run({ t, open }) {
      const page = await open('/', { init: notWebdriver });
      await booted(page);
      const today = utcToday();
      await page.evaluate(([d]) => { localStorage.setItem('tb-onote-seen', d + '|-|s0'); localStorage.setItem('tb-onote-next', d); localStorage.removeItem('tb-onote-next-n'); localStorage.removeItem('tb-opening-skip'); }, [today]);
      await serve(page, null);
      await page.reload();
      await page.waitForSelector('#onote', { timeout: 10000 });
      await revealed(page);
      await page.click('#onoteBegin');
      await pause(500);
      t.eq(await page.evaluate(() => localStorage.getItem('tb-onote-next')), null, 'no edition to give: nothing stays due');
      await page.reload(); await booted(page); await pause(2500);
      t.eq(await page.$('#onote'), null, 'the built-in note does not come back that day');
      // an edition that always answers late: shown built-in at most three times, then no longer due
      const ed = { day: today, n: 5, ts: 2000, title: 'Always late', body: 'Body.', quote: 'Quote.' };
      await page.evaluate(([d]) => { localStorage.setItem('tb-onote-next', d); localStorage.removeItem('tb-onote-next-n'); }, [today]);
      for (let i = 0; i < 3; i++) {
        await serve(page, ed, 2600); await page.reload();
        await page.waitForSelector('#onote', { timeout: 10000 }); await revealed(page);
        await page.click('#onoteBegin'); await pause(3000);
      }
      t.eq(await page.evaluate(() => localStorage.getItem('tb-onote-next')), null, 'after three late tries the edition is no longer due');
      t.noErrors(page);
    }
  }
];
