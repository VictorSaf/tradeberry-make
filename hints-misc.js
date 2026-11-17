/* Hint cards: Administration (accounts, price data), Teach me, the Opening Note, the sign-in bar and the confirm dialog (front 16.11.2026, task T12).
   Registered on the hint engine (hints-engine.js); the look is the one of hints-brief.js. Every card is built from the element itself and its live text.
   Sources read for the rules quoted in the cards:
     cloud.js (Administration, Price data, the bar "You were signed out", sign out, the status pill), functions/api/admin.js (what each operation does, password 8-256,
     self-protection, delete archives the broker accounts), functions/api/pricedata.js (recorder "on" within 15 s, gaps, 50 newest, one import at a time),
     host/recorder.mjs (MIN_FREE 5e9), host/bars-import.mjs (05:30, 1 request a second, 3 tries), server/auth.js (USER_RE, 12 h session, 10 failures in 15 min),
     functions/api/login.js (400 days), migrations/0010_modules.sql (new accounts: no module), shell.js (wsGate), brief.js teachTour (keys, steps), teach.js,
     opening.js (seen mark, skip mark, new edition), trade.js askConfirm.
   The Opening Note keeps its format: only its controls (Let's begin, Don't show again today, New edition, the photo credit) get cards; the text of the note is opted out.
   Opted out here, as candidates for hints-optouts.json (they are self-explanatory actions or data tables, Victor's standing rule): the Administration tabs, Close, Generate,
   "<- Accounts", the Journal filter and Older events; every cell and header of the account, security-log, gaps and journal tables; Teach me Close / Back / Next and the step text;
   the sign-in bar's Dismiss / OK are NOT opted out (a text button cannot be selected in CSS): they have a one-line card.
   Verify with: node tools/hint-audit.mjs admin-users admin-pricedata preferences teach-me opening-note (0 elements without a card, 0 generic cards). */
(() => {
  const { add, card, sec, scale, tbl, p, esc, nm, lbl, optout } = HX;
  const C = (title, chip, tone, plainT, o = {}) => card({ title, chip, tone, plain: plainT, value: o.value, vlabel: o.vlabel, vcls: o.vcls, sub: o.sub, secs: o.secs, watch: o.watch, eg: o.eg, use: o.use });
  const T = rows => tbl(rows.map(r => Array.isArray(r) ? { c: r } : r));
  const g = f => { try { return f(); } catch (e) { return null; } };
  const rowOf = el => el.closest('tr[data-u]');
  const userOf = el => { const r = rowOf(el); return r ? r.dataset.u : ''; };
  const isMe = el => { const r = rowOf(el); return !!(r && r.querySelector('th small')); };
  const dlg = () => document.getElementById('adminDlg');

  /* ------------------------------------------------------------------ opt-outs (standing rule: tables, self-explanatory buttons) */
  [
    '#adminDlg .adm-tabs', '#adminDlg .adm-x', '#adminDlg [data-a=gen]', '#adminDlg [data-a=pwgen]', '#adminDlg [data-a=back]', '#adminDlg .adm-j-filter', '#adminDlg .adm-j-more',
    '#adminDlg .adm-tbl:not(.adm-kv) thead', '#adminDlg .adm-tbl:not(.adm-kv) tbody th',
    '#adminDlg .adm-tbl:not(.adm-kv) tbody td:not(.adm-acts):not(.adm-mods):not([colspan])',
    '.tour-card .tour-x', '.tour-card [data-t=back]', '.tour-card [data-t=next]', '.tour-card .br-tc p',
    '#onote .onote-head', '#onote .onote-kicker', '#onote #onoteTitle', '#onote .onote-copy > p', '#onote .onote-copy blockquote', '#onote .onote-welcome', '#onote .onote-meta > span',
    '#confirmDlg .cf-body', '#confirmDlg [data-cf=cancel]'
  ].forEach(optout);

  /* ------------------------------------------------------------------ Administration: header */
  add('#adminDlg #admT', () => {
    const s = g(() => lbl(dlg().querySelector('.ph .small'))) || '';
    return C('Administration', 'administrators only: every action here is logged', '',
      'The control room of the server: who can sign in, what each account may open, and the price data the server keeps. Only an account with the administrator flag can open it; the server refuses everyone else (and writes the refusal to the security log).',
      { value: esc(s), vlabel: 'Now showing', sub: 'Accounts or Price data: use the tabs',
        secs: [sec('Where things are', T([['Accounts', 'new account, modules per user, journal, password, sign out, disable, admin, reset, delete, security log'], ['Price data', 'tick recorder, platform history archive, recorder gaps']]))],
        watch: 'Changes here act on the server at once and for real accounts. Each one is written to the security log with your name and address.', use: 'Open it to add a person, close a page for someone, or check that the recorder is writing.' });
  });
  add('#adminDlg .ph > span.muted.small', el => {
    const t = lbl(el);
    if (/accounts? on the server/.test(t)) { const n = nm(t), me = (t.match(/signed in as (.+)$/) || [])[1] || '';
      return C('Accounts on the server', `${n} account${n === 1 ? '' : 's'}, you are ${me}`, '', 'How many accounts exist on this server, and which one you are signed in as. The table below lists them all, one row each.', { value: String(n), vlabel: 'Accounts', sub: 'signed in as ' + esc(me), use: 'Your own row is marked "you": you cannot disable, delete or demote yourself, so an administrator is always left.' }); }
    if (/^Journal of/.test(t)) return C('Journal header', 'read-only history of one account', '', esc(t) + '. The journal lists sign-ins, administrator actions, every order report from the broker, the order log and the closed trades of that user, newest first, 300 at a time.', { use: 'Use "Older events" at the bottom to read further back.' });
    if (/Ticks and price history/.test(t)) return C('Price data', 'what the server keeps about prices', '', 'This tab is about the price data stored on the Mac mini: the tick recorder (every tick of the platform), its gaps, and a copy of the platform history. The page reads the server again every 5 seconds while it is open.', { use: 'Look here when a chart or a backtest seems to miss a period: the gaps table says whether the recorder was down and what covers it.' });
    return C('Administration status', 'loading or an error', '', esc(t), { use: 'If it says it could not load, close the dialog and open Administration again.' });
  });

  /* ------------------------------------------------------------------ Administration: new account */
  add('#admNew > b', () => C('New account', 'a person who can sign in to this server', '',
    'Creates an account with a username and a password. The password is hashed on the server (PBKDF2-SHA256, 100,000 rounds) and shown nowhere again: you give it to the person yourself.',
    { secs: [sec('What the server accepts', T([['Username', '2 to 32 characters: lowercase letters, digits, . _ -, starting with a letter or digit'], ['Password', '8 to 256 characters'], ['Modules', 'none ticked at first: Research, Strategy Lab and Coach stay closed until you tick them in the table']]))],
      use: 'Create it, then tick the modules the person needs in their row. Trade and Monitor are open to every account.' }));
  const newLbl = el => {
    const inp = el.querySelector('input'), nmv = inp && inp.name;
    if (nmv === 'shared') return C('Shared login', 'one login, many browsers', '', 'A login that several people use. Each browser that signs in with it keeps its own portfolio on the execution server and its own preferences; people on the same login do not see each other\'s account.',
      { secs: [sec('Personal against shared', T([['Personal', 'one portfolio and one set of preferences, the same in every browser'], ['Shared', 'each browser starts its own portfolio and keeps its own preferences']]))], watch: 'The type is set when the account is created: the table shows it as Personal or Shared (with the number of browsers).', use: 'Tick it for a demo or classroom login. Leave it off for one person.' });
    if (nmv === 'username') return C('Username', 'lowercase, 2 to 32 characters', '', 'What the person types to sign in. It is trimmed and turned to lowercase before it is sent. Allowed: letters a-z, digits, dot, underscore and hyphen; the first character is a letter or a digit.',
      { watch: 'A name that exists already is refused ("already exists").', use: 'Use something the person will remember; it also names their rows in the journal and the security log.' });
    return C('Password', '8 to 256 characters', '', 'The first password of the account. The server stores only its hash. Nobody, you included, can read it again afterwards.',
      { watch: 'Fewer than 8 characters is refused. Give the password to the person over a channel other than this screen.', use: 'Generate fills in a random 12-character password and selects it so you can copy it.' });
  };
  add('#admNew label', newLbl, { control: true });
  add('#admNew input', el => newLbl(el.closest('label')), { control: true, empty: true });
  add('#admNew button[type=submit]', () => C('Create', 'adds the account on the server', '', 'Sends the new account to the server. On success a message says it can sign in now, and the table reloads with the new row. If the name exists or the password is too short, the server\'s reason is shown and nothing is created.',
    { watch: 'It is logged as "admin.create" with the username and your address.', use: 'After creating, tick the modules in the new row.' }));

  /* ------------------------------------------------------------------ Administration: modules and row actions */
  const MOD = {
    Research: 'the Research workspace: Market Brief, the Observatory, correlation, volatility and the calendar',
    'Strategy Lab': 'the Strategy Lab workspace: the backtester and the lab tools',
    Coach: 'the Coach workspace'
  };
  const modLbl = el => {
    const inp = el.querySelector('input'), name = lbl(el), u = userOf(el), on = !!(inp && inp.checked), me = isMe(el);
    return C(name, on ? 'open for ' + u : 'closed for ' + u, '', `Whether ${esc(u)} may open ${MOD[name] || 'this workspace'}. A closed workspace is locked in the header for that person. Trade and Monitor are open to everyone and have no box.`,
      { value: on ? 'Open' : 'Closed', vlabel: name + ' for ' + u, vcls: on ? 'up' : '', sub: me ? 'your own account: it applies here now' : 'applies at their next page load',
        watch: 'Ticking or unticking is saved at once. If the server refuses, the box goes back to what the server has. If the person is on that page when you close it, they are sent to Trade at their next load.',
        use: 'Open only what the person needs. New accounts start with all three closed; administrators started with all three open.' });
  };
  add('#adminDlg td.adm-mods label.adm-ck', modLbl, { control: true });
  add('#adminDlg td.adm-mods input', el => modLbl(el.closest('label')), { control: true, empty: true });
  const ACT = {
    journal: el => C('Journal', 'read-only: nothing is changed', '', `Opens everything ${esc(userOf(el))} did on this server: sign-ins and sign-outs, administrator actions on the account, every order report from the broker, the order log and the closed trades, newest first.`,
      { use: 'Use it to answer "what happened to my order": it shows accepted, filled, rejected and cancelled with the broker\'s own text.' }),
    pw: el => C('Password', 'sets a new password and signs the user out', '', `Opens a row under ${esc(userOf(el))} to type a new password (8 to 256 characters). Setting it ends all of that user's sessions.`,
      { watch: isMe(el) ? 'This is your own account: after setting it the page reloads and you sign in again.' : 'The old password cannot be shown or recovered; you tell the person the new one yourself.', use: 'Press Password again to close the row without changing anything.' }),
    logout: el => { const n = nm(lbl(el.closest('tr').children[4]) || ''); return C('Sign out', 'ends every session of this user', '', `Ends all sessions of ${esc(userOf(el))}, on every device. Nothing else changes: the account stays enabled and can sign in again.`,
      { value: String(n || 0), vlabel: 'Sessions now', sub: n ? 'the button is active' : 'no session: nothing to end, the button is disabled', use: 'Use it when a device is lost or a login was shared by mistake. To also block the next sign-in, use Disable.' }); },
    disable: el => C('Disable', 'blocks sign-in until enabled again', '', `Signs ${esc(userOf(el))} out and refuses their sign-in. The account and its saved data are kept. You are asked to confirm first.`,
      { watch: isMe(el) ? 'Not available on your own account.' : 'Their open positions and orders on the execution server are not touched.', use: 'The reversible way to stop someone. Delete is the one that cannot be undone.' }),
    enable: el => C('Enable', 'lets the user sign in again', '', `Removes the block on ${esc(userOf(el))}. Their sessions ended when the account was disabled, so they sign in again.`, { use: 'No confirmation is asked: it is the safe direction.' }),
    admin: el => C('Make admin', 'gives them this screen', '', `Makes ${esc(userOf(el))} an administrator: they can open Administration, create, disable and delete accounts, read every user's journal and start price imports.`,
      { watch: 'An administrator can read the journal of every account. Grant it to people you would give the server to.', use: 'You can take it back with Remove admin; it does not change their modules.' }),
    unadmin: el => C('Remove admin', 'takes this screen away', '', `${esc(userOf(el))} stays a user but can no longer open Administration. Their modules stay as ticked.`,
      { watch: isMe(el) ? 'Not available on your own account, so one administrator is always left.' : 'Takes effect at once on the server.', use: 'Use it when someone stops managing the server.' }),
    reset: el => C('Reset preferences', 'erases the saved interface of this user', '', `Erases the interface preferences saved on the server for ${esc(userOf(el))}: settings, watchlist, drawings and lines, for the account and for each browser. The trading account on the execution server is not changed. You are asked to confirm.`,
      { watch: 'It cannot be undone; the person starts from a clean interface at their next load.', use: 'Use it when a person\'s saved preferences are broken or too large to sync.' }),
    delete: el => C('Delete', 'removes the user; cannot be undone', '', `Removes ${esc(userOf(el))} and everything saved for them on the server (sessions, preferences, leases). You are asked to confirm.`,
      { watch: 'Their broker accounts are archived, not erased: they are closed and kept with the broker\'s data, nobody can trade them any more, and positions still open there keep running under their stops and stop-out. The confirm text does not say this.', use: isMe(el) ? 'Not available on your own account.' : 'Prefer Disable unless the person is gone for good.' })
  };
  add('#adminDlg td.adm-acts button', el => (ACT[el.dataset.a] || (() => null))(el));
  add('#adminDlg tr.adm-pw input', el => { const u = userOf(el.closest('tr').previousElementSibling || el) || ''; return C('New password', '8 to 256 characters', '', `The new password of ${esc(u)}. It is hashed on the server and can be read nowhere afterwards.`, { watch: 'Fewer than 8 characters is refused by the server.', use: 'Generate fills in a random one; copy it before you press Set password.' }); });
  add('#adminDlg tr.adm-pw [data-a=pwset]', () => C('Set password', 'changes it now and ends their sessions', '', 'Sends the new password to the server. The user is signed out everywhere and uses the new password at the next sign-in. If it is your own account, the page reloads.', { watch: 'Logged as "admin.passwd".', use: 'Tell the person the new password yourself; the app never shows it again.' }));
  add('#adminDlg tr.adm-pw span', el => C('Password row', 'for ' + ((lbl(el).match(/for (.+)$/) || [])[1] || ''), '', esc(lbl(el)) + '. Type or generate the password, then press Set password.', { use: 'Press Password on the row again to close this without changing anything.' }));
  add('#adminDlg tr.adm-pw small', el => C('What it does to sessions', 'signs the user out', '', esc(lbl(el)) + ': every session of that user is deleted on the server, so they must sign in with the new password.', { use: 'Choose a quiet moment if the person is trading.' }));

  /* ------------------------------------------------------------------ Administration: journal of one user */
  add('#adminDlg .adm-j-accts > span', el => {
    const t = lbl(el), arch = /archived/.test(t), none = /No trading account/.test(t);
    return C(none ? 'No trading account' : 'Trading account', none ? 'nothing opened yet' : arch ? 'archived: closed, kept with the broker data' : 'live on the execution server', arch ? 'warn' : '', esc(t) + '. Id, type, balance and the number of open positions and working orders are read from the broker\'s own data, at this moment.',
      { watch: arch ? 'Archived: the user was deleted. Nobody can trade it any more; open positions there keep running under their stops and stop-out.' : '', use: 'The rows below are the events of these accounts; the Account column says which one.' });
  });

  /* ------------------------------------------------------------------ Administration: security log */
  add('#adminDlg .adm-log h3', el => { const n = nm(lbl(el.querySelector('small')) || '') || 0;
    return C('Security log', 'what the server wrote about sign-ins and administrators', '', 'One line for every sign-in, sign-out, refused sign-in, lock, administrator action, price import and new-edition request, as the server wrote it: when (UTC), what, who, which account, from which address, and whether it was done or refused.',
      { value: String(n), vlabel: 'Lines shown', sub: 'the newest 100, lines older than 400 days are deleted',
        secs: [sec('When a sign-in is locked', T([['Rule', '10 failed sign-ins in 15 minutes lock that username, and that address'], ['Log', 'the refused attempts and the lock are both written here']]))],
        watch: 'The username of a refused sign-in is whatever was typed: it can be a name that does not exist.', use: 'Check it after a lock, or when a person says an administrator did something to their account.' }); });
  add('#adminDlg .adm-log .adm-foot', () => C('Security log is empty', 'nothing logged yet', '', 'No sign-in or administrator action has been written yet. The first line appears with the next sign-in.', { use: 'Nothing to do. An empty log on a server in use would mean the log could not be written: the server\'s console then says "audit: not written".' }));
  add('#adminDlg .adm-modal > .adm-foot', () => C('How accounts work', 'the rules in one place', '', 'The notes under the accounts table, as the server applies them.',
    { secs: [sec('Rules', T([['Passwords', 'hashed on the server (PBKDF2-SHA256), never shown again'], ['New password / Sign out', 'ends that user\'s sessions'], ['Disable', 'also blocks the next sign-in'], ['Sessions', 'end when the browser closes, and after 12 hours at the latest'], ['Modules', 'Trade and Monitor are open to everyone; a module ticked or unticked applies at the user\'s next page load']]))],
      use: 'Come back here before changing someone\'s access.' }));

  /* ------------------------------------------------------------------ Price data */
  add('#adminDlg .adm-pd h3', el => {
    const t = lbl(el);
    if (/^Tick recorder/.test(t)) return C('Tick recorder', 'writes every tick of the platform', '', 'A server process that listens to the price feed and stores every tick (bid and ask, 10 times a second at most) in its own database, apart from the app\'s data and backup. Each finished UTC day is then compressed to a file. The platform itself keeps no ticks, so what the recorder misses cannot be recovered.', { use: 'Read the rows below: Status says whether it is writing now, Free disk whether it may keep going.' });
    if (/^Platform history archive/.test(t)) return C('Platform history archive', 'a copy of the platform\'s bars', '', 'A copy of the history the platform serves: 1-minute bars for as far back as the platform has them (about 9 months) and 1-hour bars since 2022, all instruments, kept as compressed files. It is insurance: charts and backtests keep reading the platform, not this copy.', { use: 'The buttons under it start an import by hand; the daily import runs by itself.' });
    const n = nm(lbl(el.querySelector('small')) || '') || 0;
    return C('Recorder gaps', n ? 'the recorder was down for these periods' : 'no gaps', n ? 'warn' : 'ok', 'A gap is a period when the recorder was not writing: from its last write before a stop to its first write after the restart, or up to now if it is stopped at this moment. The list shows the 50 newest.',
      { value: String(n), vlabel: 'Gaps', sub: 'the count after the title: "last 50 of N" when more exist', use: 'Fill gaps copies the 1-minute bars of the platform over these periods; the Covered column says for how many instruments that archive reaches over the gap.' });
  });
  add('#adminDlg .adm-kv th, #adminDlg .adm-kv td', el => {
    const tr = el.closest('tr'), k = lbl(tr.querySelector('th')), v = lbl(tr.querySelector('td'));
    const V = (title, chip, tone, plainT, o) => C(title, chip, tone, plainT, { value: esc(v), vlabel: title, ...o });
    if (k === 'Status') return V('Recorder status', /^Recording/.test(v) ? 'writing now' : /^Not recording/.test(v) ? 'stopped: ticks are being lost' : 'no recorder run yet', /^Recording/.test(v) ? 'ok' : 'bad', 'The recorder stamps its run every 5 seconds. It counts as Recording when the last stamp is less than 15 seconds old; otherwise it is stopped, and the time since its last write is shown.', { watch: 'While it is stopped the platform keeps no ticks for you: the period becomes a gap.', use: 'If it says Not recording, check the launchd service on the Mac mini; it also pauses by itself when the disk is nearly full (see Free disk).' });
    if (k === 'Last write') return V('Last write', 'when the recorder last stamped its run', '', 'The UTC time of the last stamp of the recorder. With the recorder running it is never more than a few seconds old.', { use: 'A time older than a minute while Status says Recording is worth a look at the server log.' });
    if (k === 'Ticks today (UTC)') return V('Ticks today (UTC)', 'ticks stored since 00:00 UTC', '', 'The number of ticks, all instruments together, written since midnight UTC. Each finished UTC day is moved to a compressed file by the hourly roll-over.', { use: 'It grows during market hours and barely moves at the weekend; a flat number on a weekday means the feed or the recorder is down.' });
    if (k === 'Database') return V('Database', 'size of the recorder\'s files', '', 'The first figure is the recorder\'s own database: today\'s ticks and the days not yet rolled out. The second is the older days, one compressed file per UTC day.', { use: 'Compare with Free disk: this is what grows every day.' });
    if (k === 'All price data') return V('All price data', 'everything the server keeps about prices', '', 'The recorder\'s database, plus its compressed days, plus the bar archive: the sum of the three figures on the line under it.', { use: 'This is the number to watch against Free disk.' });
    if (k === 'Free disk') { const free = nm(v);
      return V('Free disk', 'the recorder pauses below 5 GB', /GB/.test(v) && free < 5 ? 'bad' : 'ok', 'Free space on the disk that holds the price data. The recorder checks it every minute and pauses when it is under 5 GB, so ticks never starve the app\'s own database; the pause is logged as a gap, and it resumes by itself when space is back.',
        { secs: [sec('The one threshold', T([{ c: ['Under 5 GB free', 'the recorder pauses'], on: /GB/.test(v) && free < 5 }, { c: ['5 GB or more', 'the recorder records'], on: !(/GB/.test(v) && free < 5) }]))], use: 'Free space before it gets there: the compressed days are the part that keeps growing.' }); }
    if (k === 'Instruments') return V('Instruments in the archive', 'how many have bars stored', '', 'How many instruments have 1-minute bars and how many have 1-hour bars in the archive, read from its status file.', { use: 'If a number is lower than the instruments you trade, run Import all now.' });
    if (k === 'Bars') return V('Bars in the archive', 'bars stored and their size', '', 'The total number of 1-minute and 1-hour bars in the archive, and the disk they take.', { use: 'Grows by the new bars at every daily import.' });
    if (k === 'Failed') return V('Failed imports', v === 'none' ? 'every instrument imported' : 'some instruments did not import', v === 'none' ? 'ok' : 'bad', 'An instrument and resolution is marked failed after 3 tries of the same request. The run goes on with the others. A later successful import clears the mark.', { use: v === 'none' ? 'Nothing to do.' : 'Use Import one for the instrument that failed, and read its error here.' });
    return null;
  });
  add('#adminDlg .adm-pd-st', el => {
    const t = lbl(el);
    if (/^Importing/.test(t)) return C('Import running', 'one import at a time', 'warn', esc(t) + '. The import asks the platform for one range at a time, at most once a second, so a full run takes long.', { watch: 'The buttons are disabled until it ends; a second start would be refused ("already running").', use: 'The page reads the server every 5 seconds: leave it open to see the count move.' });
    if (/stopped before finishing/.test(t)) return C('Import stopped', 'the process ended before the end', 'bad', esc(t) + '. Its process is gone: the lock file points to no running process.', { use: 'Start it again: it continues from the last bar already archived.' });
    if (/failed:/.test(t)) return C('Last import failed', 'the run ended with an error', 'bad', esc(t) + '.', { use: 'Read the error, then start it again; nothing already archived is lost.' });
    if (/^Last import/.test(t)) return C('Last import', 'how the last run ended', '', esc(t) + '. "Done" and "failed" count instrument and resolution pairs; the bars added are the new ones only.', { use: 'Every day at 05:30 a run takes what is new; run it by hand after a long outage.' });
    if (/^Nothing imported/.test(t)) return C('Nothing imported yet', 'the archive is empty', '', 'No import has finished on this server. The first one, Import all now, takes about two hours.', { use: 'Start it once; the daily run keeps it up to date.' });
    if (/^No gaps/.test(t)) return C('No gaps', 'the recorder has not been interrupted', 'ok', 'The recorder has one continuous run: no stop is recorded in its database.', { use: 'Nothing to do.' });
    return C('Price data status', 'loading or an error', '', esc(t), { use: 'If it could not be read, the page tries again in 5 seconds.' });
  });
  add('#adminDlg [data-a=pd-all]', el => C('Import all now', 'starts the full archive import', '', 'Starts the archive import on the Mac mini for every instrument: 1-minute and 1-hour bars. The first run takes about two hours; later runs only add what is new. It goes on if you close this window.',
    { watch: el.disabled ? 'An import is running: this button is disabled until it ends.' : 'One import at a time; it is logged as "pricedata.import".', use: 'Use it once on a new server, or after a long outage. The daily run at 05:30 does the same by itself.' }));
  add('#adminDlg [data-a=pd-one]', () => C('Import one', 'imports the instrument typed beside it', '', 'Imports the 1-minute and 1-hour bars of the one instrument in the Instrument field, for example EURUSD. An empty field puts the cursor there instead.',
    { watch: 'The name must be a valid instrument code; the server refuses anything else ("Bad instrument").', use: 'Use it to retry an instrument listed under Failed.' }));
  add('#adminDlg [data-a=pd-gaps]', () => C('Fill gaps', 'copies 1-minute bars over the recorder gaps', '', 'Imports only the 1-minute bars, for every instrument, from the last bar already archived up to now. That covers the periods where the recorder was down with candles. The ticks themselves cannot be recovered.',
    { use: 'Run it after a recorder outage, then read the Covered column of the gaps table.' }));
  const symLbl = () => C('Instrument', 'for Import one', '', 'The code of the instrument to import, such as EURUSD. It is turned to capitals before it is sent.', { use: 'Leave it empty for Import all now.' });
  add('#adminDlg .adm-new label', symLbl, { control: true });
  add('#adminDlg .adm-new input', symLbl, { control: true, empty: true });
  add('#adminDlg .adm-new > small', () => C('The daily import', 'every day at 05:30', '', 'The archive takes what is new every day at 05:30 on the Mac mini. Charts and backtests keep reading the platform; this archive is a copy, kept as insurance.', { use: 'Nothing to do unless a gap or a failed import needs help.' }));
  add('#adminDlg .adm-pd .adm-foot', () => C('Why a gap cannot be fully filled', 'the platform keeps no ticks', 'warn', 'The platform keeps 1-minute bars but no ticks. A recorder gap can therefore be covered by candles, not by the ticks that were missed.', { use: 'For tick-level work, keep the recorder running.' }));

  /* ------------------------------------------------------------------ Teach me */
  add('.tour-card .tour-n', el => { const m = lbl(el).match(/(\d+)\s*\/\s*(\d+)/), i = m ? +m[1] : 0, n = m ? +m[2] : 0;
    return C('Step counter', i === n ? 'the last step' : 'steps of this page', '', 'Where you are in the walk. The steps are the parts of the page that are on screen now; a part that is hidden or closed is skipped, so the count differs from page to page.',
      { value: `${i}<small> / ${n}</small>`, vlabel: 'Step', sub: 'keys: right and left arrows, Esc closes', use: 'Open a folded section first and run Teach me again to have it explained too.' }); });
  add('.tour-card .tour-req', () => C('First visit', 'shown once for each page', '', 'The first time you open a page, Teach me walks through it by itself. When it has been seen, it does not start again for that page.', { use: 'Run it any time from the account menu: it explains the page that is open.' }));
  add('.tour-card .tour-t', el => C(lbl(el), 'the part of the page in the spotlight', '', 'The name of the element the highlight is on. Below, the three short notes say what it is, how to read it and how to use it, with the figures of the page as they are now.', { use: 'The highlighted part is not locked: Back and Next move the spotlight; Esc closes the walk.' }));
  const TL = { 'What it is': ['says what the element shows', 'The plain description of the highlighted part.', 'Read it first if the element is new to you.'], 'How to read it': ['how to read the values', 'What the colours, signs and numbers of that part mean.', 'Compare it with the live values on the page.'], 'How to use it': ['what to do with it', 'The action or the check that the element is for.', 'It is a suggestion about reading and checking, not a trade signal.'] };
  add('.tour-card .br-tc b', el => { const t = lbl(el), d = TL[t] || ['', '', '']; return C(t, d[0], '', d[1], { use: d[2] }); });

  /* ------------------------------------------------------------------ Opening Note: its controls only */
  add('#onote #onoteBegin', () => C('Let\'s begin', 'opens the terminal', '', 'Plays the exit of the note (the picture, the text, then the logo) and shows the terminal. Escape does the same. The note is marked as seen for this UTC day in this browser, so a reload goes straight to the terminal.',
    { watch: 'A new edition written later in the day shows at the next opening, not over a terminal already on screen.', use: 'Press it when you have read the question; the note is one for each day.' }));
  add('#onote #onoteSkip', () => C('Don\'t show again today', 'skips the note until tomorrow (UTC)', '', 'Does what Let\'s begin does and, in addition, keeps the note away for the rest of this UTC day in this browser, even if a new edition is written. It comes back at the first opening of the next UTC day.',
    { use: 'Use it on a day you open the app many times.' }));
  add('#onote .onote-regen', el => C('New edition', 'administrators only', '', 'Asks the server to write today\'s note again. It is written by Claude Code on the administrator\'s Mac, which picks the request up within about two minutes; the note shows the new edition as soon as it is stored.',
    { value: esc(lbl(el)), vlabel: 'State', sub: 'the page asks every 10 seconds, for at most 8 minutes',
      watch: 'If it says "Not written yet", the job on the Mac is not running. The request is logged in the security log.', use: 'Use it to test a change of the note; ordinary users do not see this button.' }));
  add('#onote .onote-credit', el => C('Photo credit', 'opens the photographer\'s page', '', esc(lbl(el)) + '. Each daily edition has its own photograph; this link opens its page on Unsplash in a new tab. The link is accepted only if it points to unsplash.com.', { use: 'Opening it does not close the note.' }));

  /* ------------------------------------------------------------------ the sign-in bar (cloud.js), the status pill, Sign out in Help, the confirm dialog */
  add('#cloudBar > span', el => {
    const t = lbl(el);
    if (/You were signed out/.test(t)) return C('You were signed out', 'the server ended the session', 'bad', 'The server answered 401 to the last save: the session ended (it lasts until the browser closes and 12 hours at most, or an administrator signed you out). Changes to preferences made since are kept in this browser and go to the server after you sign in again.',
      { watch: 'Your trading account is on the execution server and is not affected.', use: 'Press Sign in again to reload and sign in.' });
    if (/held another user/.test(t)) return C('Another user\'s data was cleared', 'this browser held an earlier session\'s data', 'warn', 'This browser held preferences of another user from an earlier session. They were cleared, and your own account is shown.', { use: 'Nothing to do; press OK.' });
    return C('Data from before you signed in', 'a copy of this browser\'s account', 'warn', 'This browser held an account saved before you signed in. The account on the server is shown instead; the older copy is not merged, but can be saved as a file.', { use: 'Press Download that copy if you want to keep it.' });
  });
  add('#cloudBar button', el => {
    const t = lbl(el);
    if (/Sign in again/.test(t)) return C('Sign in again', 'reloads the page', '', 'Saves what is pending in this browser, then reloads: the server shows its sign-in page.', { use: 'Your preference changes go to the server after you sign in.' });
    if (/Download/.test(t)) return C('Download that copy', 'saves a file', '', 'Saves the account that this browser held before you signed in as a JSON file named tradeberry-this-browser-<date>.json, then hides the bar.', { use: 'Keep the file if it holds work you still need.' });
    return C(t, 'hides this bar', '', 'Hides the bar. Nothing is sent or changed.', { use: 'The bar returns only if the same event happens again.' });
  });
  add('#cloudPill', el => { const t = lbl(el), st = (t.split('·')[1] || '').trim(), bad = /Not synced|Signed out/.test(st);
    return C('Account status', st || 'account', bad ? 'bad' : st === 'Synced' ? 'ok' : 'warn', esc(el.title || t),
      { value: esc(t), vlabel: 'Signed in as · state', use: bad ? 'Preference changes are kept in this browser and sent when the connection or the sign-in is back.' : 'Click it to open Help, where the sign-in and the save state are explained.' }); });
  add('#signOutBtn', () => C('Sign out', 'ends the session on the server', '', 'Sends the sign-out to the server first. Only if the server answers does the browser forget the session; otherwise it says "Not signed out" and the session stays open. Unsent preference changes are pushed first; if some cannot be, you are asked whether to sign out anyway.',
    { watch: 'The trading account stays on the execution server: any browser that signs in shows it again.', use: 'Use it on a computer other people use.' }));
  add('#confirmDlg .ph h2', el => C(lbl(el), 'nothing happens until you confirm', '', 'A confirmation before an action that cannot be taken back or that affects several things. The button on the right does it; Cancel, Escape, or a click outside the box leave everything as it was.', { use: 'Read the text under the title: it says what is erased or changed.' }));
  add('#confirmDlg [data-cf=ok]', el => C(lbl(el), 'does the action named in the title', 'warn', 'Runs the action described in this box now. ' + esc(g(() => lbl(document.querySelector('#confirmDlg .cf-body'))) || ''), { watch: 'Cancel is pre-selected: pressing Enter without moving does not confirm.', use: 'Press it only if the text above is what you meant.' }));
})();
