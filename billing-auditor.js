// Pike13 Investigator v1.13 — Diagnostic & Reporting Tool
// Paste into browser console at musicplace.pike13.com (or any Pike13 instance)
// Reports: Account Diagnostic, Unpaid Visit Investigator, Plan Punch Audit, Price Mismatch Scanner, Event Roster Check

(function () {
  'use strict';
  if (document.getElementById('p13inv-root')) {
    document.getElementById('p13inv-root').remove();
    console.log('Pike13 Investigator removed.');
    return;
  }

  // ── Constants ──
  const API = '/api/v2/desk';
  const VERSION = '1.13';
  const DELAY = 120; // ms between API calls
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const get = async (path) => {
    const r = await fetch(path, { credentials: 'include' });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} on ${path}`);
    return r.json();
  };

  // ── Oxford comma list helper ──
  const oxList = (items, conjunction = 'and') => {
    if (items.length === 0) return '';
    if (items.length === 1) return items[0];
    if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
    return items.slice(0, -1).join(', ') + `, ${conjunction} ` + items[items.length - 1];
  };

  // ── Smart context detection from URL ──
  const path = location.pathname;
  const search = location.search;
  const ctx = { pid: '', eoId: '', planId: '', autoTab: 'diagnostic' };

  // /people/{id}/memberships/{plan_id}?aspect=visits → Plan Punch Audit (most specific)
  const membershipMatch = path.match(/\/people\/(\d+)\/memberships\/(\d+)/);
  // /people/{id}/visits → Unpaid Visits
  const visitsMatch = path.match(/\/people\/(\d+)\/visits/);
  // /people/{id} (any subpage) → person detected
  const personMatch = path.match(/\/people\/(\d+)/);
  // /e/{id} → Event Roster
  const eoMatch = path.match(/\/e\/(\d+)/);

  if (membershipMatch) {
    ctx.pid = membershipMatch[1];
    ctx.planId = membershipMatch[2];
    ctx.autoTab = 'punches';
  } else if (visitsMatch) {
    ctx.pid = visitsMatch[1];
    ctx.autoTab = 'unpaid';
  } else if (eoMatch) {
    ctx.eoId = eoMatch[1];
    ctx.autoTab = 'roster';
  } else if (personMatch) {
    ctx.pid = personMatch[1];
    ctx.autoTab = 'diagnostic';
  }

  // ── State ──
  let isMinimized = false;
  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };
  let abortController = null;

  // ── Build UI ──
  const root = document.createElement('div');
  root.id = 'p13inv-root';
  root.innerHTML = `
    <style>
      #p13inv-root { position:fixed; top:60px; right:20px; z-index:999999; font-family:'Segoe UI',system-ui,sans-serif; font-size:13px; }
      #p13inv-panel { width:660px; background:#1a1d23; color:#d4d4d8; border:1px solid #2e3138; border-radius:10px; box-shadow:0 8px 32px rgba(0,0,0,0.5); overflow:hidden; }
      #p13inv-header { background:#22252b; padding:10px 14px; cursor:move; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #2e3138; user-select:none; }
      #p13inv-header h3 { margin:0; font-size:14px; color:#e4e4e7; font-weight:600; }
      #p13inv-header .btns { display:flex; gap:6px; }
      #p13inv-header .btns button { background:none; border:none; color:#71717a; cursor:pointer; font-size:16px; padding:2px 4px; line-height:1; }
      #p13inv-header .btns button:hover { color:#e4e4e7; }
      #p13inv-body { padding:14px; max-height:75vh; overflow-y:auto; }
      #p13inv-pill { display:none; background:#22252b; border:1px solid #2e3138; border-radius:20px; padding:6px 14px; cursor:pointer; font-size:12px; color:#a1a1aa; box-shadow:0 4px 12px rgba(0,0,0,0.3); white-space:nowrap; }
      #p13inv-pill:hover { color:#e4e4e7; border-color:#3f3f46; }

      .inv-tabs { display:flex; gap:4px; margin-bottom:12px; flex-wrap:wrap; }
      .inv-tab { background:#2a2d35; border:1px solid #3f3f46; border-radius:6px; padding:6px 12px; cursor:pointer; color:#a1a1aa; font-size:12px; transition:all 0.15s; }
      .inv-tab:hover { color:#e4e4e7; border-color:#52525b; }
      .inv-tab.active { background:#3b82f6; border-color:#3b82f6; color:#fff; }

      .inv-section { display:none; }
      .inv-section.active { display:block; }

      .inv-row { display:flex; gap:8px; align-items:flex-end; margin-bottom:8px; flex-wrap:wrap; }
      .inv-field { display:flex; flex-direction:column; gap:3px; }
      .inv-field label { font-size:11px; color:#71717a; text-transform:uppercase; letter-spacing:0.5px; }
      .inv-field input, .inv-field select { background:#2a2d35; border:1px solid #3f3f46; border-radius:5px; padding:6px 10px; color:#e4e4e7; font-size:13px; outline:none; font-family:inherit; }
      .inv-field input:focus, .inv-field select:focus { border-color:#3b82f6; }
      .inv-field input::placeholder { color:#52525b; }

      .inv-btn { background:#3b82f6; border:none; border-radius:6px; padding:7px 16px; color:#fff; font-size:12px; font-weight:600; cursor:pointer; white-space:nowrap; transition:background 0.15s; }
      .inv-btn:hover { background:#2563eb; }
      .inv-btn:disabled { background:#1e3a5f; color:#64748b; cursor:not-allowed; }
      .inv-btn.danger { background:#dc2626; }
      .inv-btn.danger:hover { background:#b91c1c; }
      .inv-btn.secondary { background:#3f3f46; }
      .inv-btn.secondary:hover { background:#52525b; }

      .inv-status { font-size:12px; color:#a1a1aa; margin:8px 0; min-height:18px; }
      .inv-status .error { color:#f87171; }
      .inv-status .success { color:#4ade80; }

      .inv-results { background:#15171c; border:1px solid #2e3138; border-radius:6px; padding:10px; margin-top:8px; max-height:50vh; overflow-y:auto; font-family:'Cascadia Code','Fira Code','Consolas',monospace; font-size:12px; line-height:1.6; white-space:pre-wrap; word-break:break-word; }
      .inv-results .heading { color:#60a5fa; font-weight:bold; }
      .inv-results .warn { color:#fbbf24; }
      .inv-results .err { color:#f87171; font-weight:bold; }
      .inv-results .ok { color:#4ade80; }
      .inv-results .dim { color:#52525b; }
      .inv-results .sep { color:#3f3f46; }

      .inv-help { font-size:11px; color:#52525b; margin-top:4px; }

      #p13inv-body::-webkit-scrollbar, .inv-results::-webkit-scrollbar { width:6px; }
      #p13inv-body::-webkit-scrollbar-track, .inv-results::-webkit-scrollbar-track { background:transparent; }
      #p13inv-body::-webkit-scrollbar-thumb, .inv-results::-webkit-scrollbar-thumb { background:#3f3f46; border-radius:3px; }
    </style>

    <div id="p13inv-pill">🔍 Investigator</div>
    <div id="p13inv-panel">
      <div id="p13inv-header">
        <h3>🔍 Pike13 Investigator v${VERSION}</h3>
        <div class="btns">
          <button id="p13inv-minimize" title="Minimize">─</button>
          <button id="p13inv-close" title="Close">✕</button>
        </div>
      </div>
      <div id="p13inv-body">
        <div class="inv-tabs">
          <div class="inv-tab${ctx.autoTab === 'diagnostic' ? ' active' : ''}" data-tab="diagnostic">Account Diagnostic</div>
          <div class="inv-tab${ctx.autoTab === 'unpaid' ? ' active' : ''}" data-tab="unpaid">Unpaid Visits</div>
          <div class="inv-tab${ctx.autoTab === 'punches' ? ' active' : ''}" data-tab="punches">Plan Punch Audit</div>
          <div class="inv-tab${ctx.autoTab === 'prices' ? ' active' : ''}" data-tab="prices">Price Mismatch</div>
          <div class="inv-tab${ctx.autoTab === 'roster' ? ' active' : ''}" data-tab="roster">Event Roster</div>
        </div>

        <!-- ── Account Diagnostic ── -->
        <div class="inv-section${ctx.autoTab === 'diagnostic' ? ' active' : ''}" id="sec-diagnostic">
          <div class="inv-row">
            <div class="inv-field"><label>Person ID</label><input id="diag-pid" type="text" placeholder="e.g. 9988349" value="${ctx.pid}" style="width:120px"></div>
            <button class="inv-btn" id="diag-run">Run Diagnostic</button>
            <button class="inv-btn secondary" id="diag-copy">Copy</button>
            <button class="inv-btn danger" id="diag-stop" style="display:none">Stop</button>
          </div>
          <div class="inv-help">Pulls person basics, balance, payment methods, active + inactive plans, recent visits, and visit summary.</div>
          <div class="inv-status" id="diag-status"></div>
          <div class="inv-results" id="diag-results" style="display:none"></div>
        </div>

        <!-- ── Unpaid Visit Investigator ── -->
        <div class="inv-section${ctx.autoTab === 'unpaid' ? ' active' : ''}" id="sec-unpaid">
          <div class="inv-row">
            <div class="inv-field"><label>Person ID</label><input id="unpaid-pid" type="text" placeholder="e.g. 9988355" value="${ctx.pid}" style="width:120px"></div>
            <div class="inv-field"><label>From</label><input id="unpaid-from" type="date" value="2026-01-01"></div>
            <div class="inv-field"><label>To</label><input id="unpaid-to" type="date" value="2026-12-31"></div>
            <button class="inv-btn" id="unpaid-run">Investigate</button>
            <button class="inv-btn secondary" id="unpaid-copy">Copy</button>
            <button class="inv-btn danger" id="unpaid-stop" style="display:none">Stop</button>
          </div>
          <div class="inv-help">Finds unpaid visits in range, checks active plan coverage (service match + date range), and identifies potential causes.</div>
          <div class="inv-status" id="unpaid-status"></div>
          <div class="inv-results" id="unpaid-results" style="display:none"></div>
        </div>

        <!-- ── Plan Punch Audit ── -->
        <div class="inv-section${ctx.autoTab === 'punches' ? ' active' : ''}" id="sec-punches">
          <div class="inv-row">
            <div class="inv-field"><label>Person ID</label><input id="punch-pid" type="text" placeholder="e.g. 9988355" value="${ctx.pid}" style="width:120px"></div>
            <div class="inv-field"><label>Plan ID</label><input id="punch-planid" type="text" placeholder="e.g. 49394781" value="${ctx.planId}" style="width:120px"></div>
            <button class="inv-btn" id="punch-run">Audit Punches</button>
            <button class="inv-btn secondary" id="punch-copy">Copy</button>
            <button class="inv-btn danger" id="punch-stop" style="display:none">Stop</button>
          </div>
          <div class="inv-row" style="margin-top:4px">
            <div class="inv-field"><label>Visit history from</label><input id="punch-from" type="date" value="2024-01-01"></div>
            <div class="inv-field"><label>To</label><input id="punch-to" type="date" value="2026-12-31"></div>
          </div>
          <div class="inv-help">Traces all punches belonging to a specific plan. Finds old visits consuming weekly/monthly slots. Leave Plan ID blank to list active plans for the person.</div>
          <div class="inv-status" id="punch-status"></div>
          <div class="inv-results" id="punch-results" style="display:none"></div>
        </div>

        <!-- ── Price Mismatch Scanner ── -->
        <div class="inv-section${ctx.autoTab === 'prices' ? ' active' : ''}" id="sec-prices">
          <div class="inv-row">
            <div class="inv-field"><label>Plan Product ID</label><input id="price-ppid" type="text" placeholder="Blank = all products" style="width:160px"></div>
            <div class="inv-field">
              <label>Scan scope</label>
              <select id="price-scope" style="width:130px">
                <option value="single">Single person</option>
                <option value="bulk">Bulk (all people)</option>
              </select>
            </div>
            <div class="inv-field" id="price-pid-wrap"><label>Person ID</label><input id="price-pid" type="text" placeholder="e.g. 9988355" value="${ctx.pid}" style="width:120px"></div>
            <button class="inv-btn" id="price-run">Scan</button>
            <button class="inv-btn secondary" id="price-copy">Copy</button>
            <button class="inv-btn danger" id="price-stop" style="display:none">Stop</button>
          </div>
          <div class="inv-row">
            <div class="inv-field">
              <label>Batch size</label>
              <select id="price-batch" style="width:70px">
                <option value="5" selected>5</option>
                <option value="3">3</option>
                <option value="10">10</option>
              </select>
            </div>
            <div class="inv-field"><label>Max people (bulk)</label><input id="price-max" type="number" value="500" style="width:80px" min="1"></div>
          </div>
          <div class="inv-help">Compares client plan prices to current template prices. Bulk mode scans all people (slow — uses adaptive rate limiting). Plan Product ID blank = all billing plan products.</div>
          <div class="inv-status" id="price-status"></div>
          <div class="inv-results" id="price-results" style="display:none"></div>
        </div>

        <!-- ── Event Roster Check ── -->
        <div class="inv-section${ctx.autoTab === 'roster' ? ' active' : ''}" id="sec-roster">
          <div class="inv-row">
            <div class="inv-field"><label>Event Occurrence ID</label><input id="roster-eoid" type="text" placeholder="e.g. 286765341" value="${ctx.eoId}" style="width:140px"></div>
            <button class="inv-btn" id="roster-run">Check Roster</button>
            <button class="inv-btn secondary" id="roster-copy">Copy</button>
            <button class="inv-btn danger" id="roster-stop" style="display:none">Stop</button>
          </div>
          <div class="inv-row" style="margin-top:2px">
            <label style="font-size:12px;color:#a1a1aa;cursor:pointer;display:flex;align-items:center;gap:5px;user-select:none"><input type="checkbox" id="roster-passes" style="accent-color:#3b82f6;cursor:pointer"> Include passes in suggestions</label>
          </div>
          <div class="inv-help">Pulls the event's enrolled students, then checks each one's active plans against the event's service. Flags plan/service mismatches and price discrepancies.</div>
          <div class="inv-status" id="roster-status"></div>
          <div class="inv-results" id="roster-results" style="display:none"></div>
        </div>

        <div style="text-align:center;margin-top:10px;font-size:10px;color:#3f3f46;">v${VERSION} • 2026-03-26 • Pike13 Investigator</div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  // ── Element refs ──
  const $ = id => document.getElementById(id);
  const panel = $('p13inv-panel');
  const pill = $('p13inv-pill');
  const header = $('p13inv-header');

  // ── Drag ──
  header.addEventListener('mousedown', e => {
    if (e.target.tagName === 'BUTTON') return;
    isDragging = true;
    const rect = root.getBoundingClientRect();
    dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!isDragging) return;
    root.style.left = (e.clientX - dragOffset.x) + 'px';
    root.style.top = (e.clientY - dragOffset.y) + 'px';
    root.style.right = 'auto';
  });
  document.addEventListener('mouseup', () => isDragging = false);

  // ── Minimize / Close ──
  $('p13inv-minimize').addEventListener('click', () => {
    isMinimized = !isMinimized;
    panel.style.display = isMinimized ? 'none' : '';
    pill.style.display = isMinimized ? 'block' : 'none';
  });
  pill.addEventListener('click', () => {
    isMinimized = false;
    panel.style.display = '';
    pill.style.display = 'none';
  });
  $('p13inv-close').addEventListener('click', () => root.remove());

  // ── Tabs ──
  root.querySelectorAll('.inv-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      root.querySelectorAll('.inv-tab').forEach(t => t.classList.remove('active'));
      root.querySelectorAll('.inv-section').forEach(s => s.classList.remove('active'));
      tab.classList.add('active');
      $('sec-' + tab.dataset.tab).classList.add('active');
    });
  });

  // ── Price scope toggle ──
  $('price-scope').addEventListener('change', e => {
    $('price-pid-wrap').style.display = e.target.value === 'single' ? '' : 'none';
  });

  // ── Abort helper ──
  function makeAbort(stopBtn) {
    if (abortController) abortController.abort();
    abortController = new AbortController();
    stopBtn.style.display = '';
    stopBtn.onclick = () => { abortController.abort(); stopBtn.style.display = 'none'; };
    return abortController.signal;
  }
  function checkAbort(signal) { if (signal.aborted) throw new Error('ABORTED'); }

  // ── Output helpers ──
  function h(text) { return `<span class="heading">${text}</span>`; }
  function w(text) { return `<span class="warn">${text}</span>`; }
  function e(text) { return `<span class="err">${text}</span>`; }
  function ok(text) { return `<span class="ok">${text}</span>`; }
  function dim(text) { return `<span class="dim">${text}</span>`; }
  function sep() { return `<span class="sep">━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</span>`; }

  class Output {
    constructor(el, statusEl) {
      this.el = el;
      this.statusEl = statusEl;
      this.lines = [];
    }
    clear() { this.lines = []; this.el.innerHTML = ''; this.el.style.display = 'none'; }
    show() { this.el.style.display = ''; }
    add(html) { this.lines.push(html); this.el.innerHTML = this.lines.join('\n'); this.el.scrollTop = this.el.scrollHeight; }
    status(html) { this.statusEl.innerHTML = html; }
    getText() { return this.el.innerText; }
  }

  // ── Shared API helpers ──
  async function fetchPerson(pid) {
    try {
      const ac = await get(`${API}/people/search/autocomplete.json?q=${pid}&per_page=5`);
      return (ac.people || []).find(p => p.id === Number(pid)) || null;
    } catch { return null; }
  }

  async function fetchPersonDirect(pid) {
    try {
      const d = await get(`${API}/people/${pid}`);
      return d.people?.[0] || null;
    } catch { return null; }
  }

  // Uses find_by_ids endpoint — the only reliable way to get populated providers[] (guardian/account-manager IDs).
  // Returns { person, providerId, providerEmail } or null.
  async function fetchPersonWithProviders(pid) {
    try {
      const d = await get(`${API}/people/find_by_ids.json?ids=${pid}`);
      const person = (d.people || []).find(p => p.id === Number(pid)) || null;
      if (!person) return null;
      const provider = person.providers?.[0] || null;
      return {
        person,
        providerId: provider?.id || null,
        providerEmail: provider?.email || null
      };
    } catch { return null; }
  }

  async function fetchAllPlans(pid) {
    const d = await get(`${API}/people/${pid}/plans`);
    return d.plans || [];
  }

  async function fetchActivePlans(pid) {
    const d = await get(`${API}/people/${pid}/plans?filter=active`);
    return d.plans || [];
  }

  async function fetchVisits(pid, from, to) {
    const visits = [];
    let page = 1;
    while (true) {
      const d = await get(`${API}/people/${pid}/visits?from=${from}&to=${to}&per_page=100&page=${page}`);
      visits.push(...(d.visits || []));
      if (!d.next) break;
      page++;
    }
    return visits;
  }

  async function fetchPlanProductMap(signal) {
    const map = new Map();
    let page = 1;
    while (true) {
      checkAbort(signal);
      const d = await get(`${API}/plan_products?per_page=100&page=${page}`);
      for (const pp of (d.plan_products || [])) {
        map.set(pp.id, pp);
      }
      if (!d.next) break;
      page++;
      await sleep(DELAY);
    }
    return map;
  }

  // ═══════════════════════════════════════════════════
  //  REPORT 1: ACCOUNT DIAGNOSTIC
  // ═══════════════════════════════════════════════════
  $('diag-run').addEventListener('click', async () => {
    const pid = $('diag-pid').value.trim();
    if (!pid) return;
    const out = new Output($('diag-results'), $('diag-status'));
    const stopBtn = $('diag-stop');
    const signal = makeAbort(stopBtn);
    out.clear(); out.show();
    $('diag-run').disabled = true;

    try {
      // Summary flags — populated throughout, used at the end for Slack summary
      const diagFlags = { noPayment: false, expiredCards: [], noAutobill: false, noPlans: false, unpaidCount: 0 };

      out.status('Fetching person data...');
      out.add(sep());
      out.add(h(`  ACCOUNT DIAGNOSTIC — Person ${pid}`));
      out.add(sep());

      // Person basics — combine autocomplete (has balance/dependents) + find_by_ids (has providers[])
      checkAbort(signal);
      const person = await fetchPerson(pid);
      const direct = await fetchPersonDirect(pid);
      // find_by_ids gives us reliable providers[] (guardian ID) — API ref v5.9/v6.1
      const withProviders = await fetchPersonWithProviders(pid);
      const name = person?.name || direct?.name || '(unknown)';

      out.add('');
      out.add(h('PERSON'));
      out.add(`  Name:      ${name}`);
      out.add(`  Email:     ${person?.email || direct?.email || '(none)'}`);

      // Guardian: show name + both email fields if they differ
      const guardianName = person?.guardian_name || direct?.guardian_name || null;
      const guardianEmail = person?.guardian_email || direct?.guardian_email || null;
      const providerEmail = withProviders?.providerEmail || null;
      const providerId = withProviders?.providerId || null;

      if (guardianName) {
        out.add(`  Guardian:  ${guardianName}${providerId ? ` (id:${providerId})` : ''}`);
        if (guardianEmail) {
          out.add(`  Guard.Email (stored): ${guardianEmail}`);
        }
        if (providerEmail && providerEmail !== guardianEmail) {
          out.add(`  Guard.Email (account): ${providerEmail}`);
        } else if (!guardianEmail && providerEmail) {
          out.add(`  Guard.Email: ${providerEmail}`);
        } else if (!guardianEmail && !providerEmail) {
          out.add(`  Guard.Email: —`);
        }
      } else {
        out.add(`  Guardian:  (none / self-managed)`);
      }

      if (direct?.dependents?.length) {
        out.add(`  Dependents: ${direct.dependents.map(d => `${d.name} (${d.id})`).join(', ')}`);
      }
      out.add(`  Hidden:    ${person?.hidden_at ? w('YES — ' + person.hidden_at) : ok('No')}`);
      if (person?.balances?.length) {
        out.add(`  Balances:  ${person.balances.map(b => `$${(b.balance_cents/100).toFixed(2)} (${b.type})`).join(', ')}`);
      }

      // Payment methods
      checkAbort(signal);
      out.status('Checking payment methods...');
      try {
        const fop = await get(`${API}/people/${pid}/form_of_payments`);
        const methods = fop.form_of_payments || [];
        out.add('');
        out.add(h('PAYMENT METHODS'));
        if (methods.length === 0) {
          out.add(w('  ⚠️  NO PAYMENT METHODS ON FILE'));
          diagFlags.noPayment = true;
        } else {
          for (const m of methods) {
            const mExpired = new Date(m.expire_year, m.expire_month) < new Date();
            if (mExpired) diagFlags.expiredCards.push(`${m.card_type || m.type} ****${m.last_four}`);
            if (!m.autobill) diagFlags.noAutobill = true;
            out.add(`  ${m.card_type || m.type} ending ${m.last_four || '?'}  exp ${m.expire_month}/${m.expire_year}  autobill:${m.autobill ? ok('yes') : w('no')}`);
          }
        }
      } catch (err) { out.add(dim(`  (error: ${err.message})`)); }

      // Active plans
      checkAbort(signal);
      out.status('Fetching plans...');
      const active = await fetchActivePlans(pid);
      out.add('');
      out.add(h('ACTIVE PLANS'));
      if (active.length === 0) {
        out.add(w('  ⚠️  NO ACTIVE PLANS'));
        diagFlags.noPlans = true;
      } else {
        for (const p of active) {
          out.add(`  [${p.id}] ${p.name}`);
          out.add(`    Start: ${p.start_date}  End: ${p.end_date || '(ongoing)'}  Remaining: ${p.remaining_count ?? 'n/a'}`);
          if (p.billing?.interval_unit) out.add(`    Billing: every ${p.billing.interval_count} ${p.billing.interval_unit} on day ${JSON.stringify(p.billing.days_of_month)}`);
          if (p.next_invoice) out.add(`    Next invoice: ${p.next_invoice.invoice_date} — ${p.next_invoice.total?.price_string || '$?'}`);
          if (p.limit_period) out.add(`    Limit: ${p.count} visit per ${p.limit_period}`);
        }
      }

      // Recently inactive plans
      checkAbort(signal);
      const allPlans = await fetchAllPlans(pid);
      const inactive = allPlans.filter(p => p.end_date && !active.find(a => a.id === p.id));
      const recent = inactive.filter(p => p.end_date >= '2025-01-01').sort((a, b) => b.end_date.localeCompare(a.end_date));
      if (recent.length) {
        out.add('');
        out.add(h('RECENTLY INACTIVE PLANS (ended 2025+)'));
        for (const p of recent.slice(0, 10)) {
          out.add(`  [${p.id}] ${p.name}  ${p.start_date} → ${p.end_date}${p.cancelled_at ? '  (cancelled)' : ''}`);
        }
      }

      // Recent visits summary
      checkAbort(signal);
      out.status('Fetching visits...');
      const now = new Date();
      const threeMonthsAgo = new Date(now); threeMonthsAgo.setMonth(now.getMonth() - 3);
      const fromDate = threeMonthsAgo.toISOString().slice(0, 10);
      const toDate = now.toISOString().slice(0, 10);
      const visits = await fetchVisits(pid, fromDate, toDate);
      const realVisits = visits.filter(v => !['late_canceled', 'cancelled'].includes(v.state));
      const unpaid = realVisits.filter(v => !v.paid);
      const paid = realVisits.filter(v => v.paid);
      diagFlags.unpaidCount = unpaid.length;
      out.add('');
      out.add(h(`VISITS (${fromDate} → ${toDate})`));
      out.add(`  Total: ${realVisits.length}  ${ok('Paid: ' + paid.length)}  ${unpaid.length ? e('Unpaid: ' + unpaid.length) : ok('Unpaid: 0')}`);
      if (unpaid.length) {
        out.add('');
        out.add(w('  UNPAID VISITS:'));
        for (const v of unpaid.slice(0, 15)) {
          const d = v.event_occurrence?.start_at?.slice(0, 10) || '?';
          out.add(`    ${d}  ${v.event_occurrence?.name || '?'} (svc:${v.event_occurrence?.service_id})  state:${v.state}  status:${v.status}`);
        }
        if (unpaid.length > 15) out.add(dim(`    ... and ${unpaid.length - 15} more`));
      }

      // Visit summary
      checkAbort(signal);
      try {
        const summary = await get(`${API}/people/${pid}/visits/summary`);
        out.add('');
        out.add(h('VISIT SUMMARY (all time)'));
        out.add(`  ${JSON.stringify(summary.summaries?.[0] || summary, null, 2)}`);
      } catch { }

      // ── Slack Summary ──
      out.add('');
      out.add(sep());
      out.add(h('SLACK SUMMARY (copy-paste ready)'));
      out.add(sep());
      out.add('');
      {
        const issues = [];
        if (diagFlags.noPayment) issues.push('no payment method on file');
        if (diagFlags.expiredCards.length) issues.push(`expired card${diagFlags.expiredCards.length > 1 ? 's' : ''} (${diagFlags.expiredCards.join(', ')})`);
        if (diagFlags.noAutobill && !diagFlags.noPayment && !diagFlags.expiredCards.length) issues.push('autobill is turned off');
        if (diagFlags.noPlans) issues.push('no active plans');
        if (diagFlags.unpaidCount > 0) issues.push(`${diagFlags.unpaidCount} unpaid visit${diagFlags.unpaidCount !== 1 ? 's' : ''} in the last 3 months`);

        if (issues.length === 0) {
          out.add(`${name}'s account looks healthy — active plan, valid payment method, and no recent unpaid visits.`);
        } else {
          const issueStr = oxList(issues);
          const verb = issues.length === 1 ? 'has' : 'has';
          let msg = `${name}'s account ${verb} ${issueStr}.`;
          if (diagFlags.noPayment || diagFlags.expiredCards.length) {
            msg += ' A valid payment method will need to be on file for billing to work.';
          }
          if (diagFlags.noAutobill && !diagFlags.noPayment && !diagFlags.expiredCards.length) {
            msg += ' Autobill should be enabled so lessons are charged automatically.';
          }
          if (diagFlags.noPlans && diagFlags.unpaidCount > 0) {
            msg += ' Without an active plan, visits have nothing to bill against.';
          }
          out.add(msg);
        }
      }

      out.add('');
      out.add(sep());
      out.add(ok('  DIAGNOSTIC COMPLETE'));
      out.add(sep());
      out.status(`<span class="success">Done — ${name}</span>`);

    } catch (err) {
      if (err.message === 'ABORTED') { out.status('Aborted.'); out.add(w('\n  ⚠️  Aborted by user')); }
      else { out.status(`<span class="error">Error: ${err.message}</span>`); out.add(e(`\n  ERROR: ${err.message}`)); }
    } finally {
      $('diag-run').disabled = false;
      stopBtn.style.display = 'none';
    }
  });

  // ═══════════════════════════════════════════════════
  //  REPORT 2: UNPAID VISIT INVESTIGATOR
  // ═══════════════════════════════════════════════════
  $('unpaid-run').addEventListener('click', async () => {
    const pid = $('unpaid-pid').value.trim();
    const from = $('unpaid-from').value;
    const to = $('unpaid-to').value;
    if (!pid) return;
    const out = new Output($('unpaid-results'), $('unpaid-status'));
    const stopBtn = $('unpaid-stop');
    const signal = makeAbort(stopBtn);
    out.clear(); out.show();
    $('unpaid-run').disabled = true;

    try {
      // Summary flags — populated throughout, used at the end for Slack summary
      const sumFlags = { noPlans: false, exhausted: [], mismatch: [], noPayment: false, expiredCards: [], noAutobill: false, unattended: [], completedNoPunch: [] };

      // Person info
      out.status('Fetching person...');
      const person = await fetchPerson(pid) || await fetchPersonDirect(pid);
      const name = person?.name || `Person ${pid}`;
      out.add(sep());
      out.add(h(`  UNPAID VISIT INVESTIGATION — ${name} (${pid})`));
      out.add(sep());

      // Check for dependents
      const direct = await fetchPersonDirect(pid);
      if (direct?.dependents?.length && !direct?.guardian_name) {
        out.add('');
        out.add(w(`  ⚠️  This is a PARENT ACCOUNT with dependents:`));
        for (const d of direct.dependents) out.add(`      ${d.name} (id:${d.id})`);
        out.add(w('  The student may have the unpaid visits — check their ID instead.'));
      }

      // Fetch visits
      checkAbort(signal);
      out.status('Fetching visits...');
      const visits = await fetchVisits(pid, from, to);
      const realVisits = visits.filter(v => !['late_canceled', 'cancelled'].includes(v.state));
      const unpaid = realVisits.filter(v => !v.paid);
      const paid = realVisits.filter(v => v.paid);

      out.add('');
      out.add(h(`VISITS ${from} → ${to}`));
      out.add(`  Total: ${realVisits.length}  ${ok('Paid: ' + paid.length)}  ${unpaid.length ? e('Unpaid: ' + unpaid.length) : ok('Unpaid: 0')}`);

      if (unpaid.length === 0) {
        out.add(''); out.add(ok('  ✅ No unpaid visits found in this range.')); out.status('<span class="success">Done — no unpaid visits</span>');
        return;
      }

      // Categorise by state — used in Slack summary for targeted fix guidance
      sumFlags.unattended = unpaid.filter(v => v.state === 'registered');
      sumFlags.completedNoPunch = unpaid.filter(v => v.state === 'completed' && !v.punch_id);

      // Show unpaid visits
      out.add('');
      out.add(h('UNPAID VISITS'));
      for (const v of unpaid) {
        const d = v.event_occurrence?.start_at?.slice(0, 10) || '?';
        const t = v.event_occurrence?.start_at?.slice(11, 16) || '';
        const stateFlag = v.state === 'registered' ? w(' ← attendance not taken') : '';
        out.add(`  ${d} ${t}  ${v.event_occurrence?.name || '?'}  svc:${v.event_occurrence?.service_id}  state:${v.state}${stateFlag}  visit:${v.id}`);
      }

      // Active plans + service matching
      checkAbort(signal);
      out.status('Checking plan coverage...');
      const active = await fetchActivePlans(pid);
      out.add('');
      out.add(h('ACTIVE PLANS'));
      if (active.length === 0) {
        out.add(e('  🚨 NO ACTIVE PLANS — visits have nothing to bill against'));
        sumFlags.noPlans = true;
      } else {
        // Fetch plan product templates for service lists
        out.status('Loading plan product templates...');
        const ppMap = await fetchPlanProductMap(signal);

        for (const plan of active) {
          const pp = ppMap.get(plan.plan_product_id);
          const coveredSvcIds = (pp?.services || []).map(s => s.id);
          out.add(`  [${plan.id}] ${plan.name}`);
          out.add(`    Covers services: ${(pp?.services || []).map(s => `${s.name} (${s.id})`).join(', ') || '(unknown — template not found)'}`);
          out.add(`    Date range: ${plan.start_date} → ${plan.end_date || '(ongoing)'}`);
          if (plan.limit_period) out.add(`    Limit: ${plan.count} per ${plan.limit_period}  remaining: ${plan.remaining_count}`);

          // Check each unpaid visit against this plan
          let couldCover = 0;
          for (const v of unpaid) {
            const svcId = v.event_occurrence?.service_id;
            const vDate = v.event_occurrence?.start_at?.slice(0, 10);
            const svcMatch = coveredSvcIds.includes(svcId);
            const inRange = vDate >= plan.start_date && (!plan.end_date || vDate <= plan.end_date);
            if (svcMatch && inRange) couldCover++;
          }
          if (couldCover > 0 && plan.remaining_count === 0) {
            out.add(e(`    🚨 This plan SHOULD cover ${couldCover} unpaid visit(s) but remaining_count is 0`));
            out.add(w(`    → Likely cause: weekly/monthly slots consumed by old visits. Run Plan Punch Audit on plan ${plan.id}.`));
            sumFlags.exhausted.push({ name: plan.name, id: plan.id });
          } else if (couldCover > 0) {
            out.add(w(`    ⚠️  ${couldCover} unpaid visit(s) match this plan's service and date range`));
          } else {
            out.add(dim(`    (no unpaid visits match this plan's coverage)`));
          }
        }

        // Service mismatch detection
        const allCoveredSvcIds = new Set();
        for (const plan of active) {
          const pp = ppMap.get(plan.plan_product_id);
          (pp?.services || []).forEach(s => allCoveredSvcIds.add(s.id));
        }
        const uncoveredVisits = unpaid.filter(v => !allCoveredSvcIds.has(v.event_occurrence?.service_id));
        sumFlags.mismatch = uncoveredVisits;
        if (uncoveredVisits.length) {
          out.add('');
          out.add(e('🚨 SERVICE MISMATCH — these visits are on services NO active plan covers:'));
          for (const v of uncoveredVisits) {
            out.add(`  ${v.event_occurrence?.start_at?.slice(0, 10)}  ${v.event_occurrence?.name}  svc:${v.event_occurrence?.service_id}`);
          }
        }
      }

      // Payment method check
      // Uses find_by_ids to reliably get providers[] (guardian ID) — API ref v5.9/v6.1.
      // Previously used name-based autocomplete search which could fail to find the right parent.
      checkAbort(signal);
      out.status('Checking payment...');
      try {
        const fop = await get(`${API}/people/${pid}/form_of_payments`);
        const methods = fop.form_of_payments || [];
        let parentMethods = [];
        if (person?.guardian_name) {
          try {
            const withProviders = await fetchPersonWithProviders(pid);
            const providerId = withProviders?.providerId;
            if (providerId) {
              const pfop = await get(`${API}/people/${providerId}/form_of_payments`);
              parentMethods = pfop.form_of_payments || [];
            } else {
              // Fallback: name-based autocomplete search
              const ac = await get(`${API}/people/search/autocomplete.json?q=${encodeURIComponent(person.guardian_name)}&per_page=5`);
              const parent = (ac.people || []).find(p => p.dependents?.some(d => d.id === Number(pid)));
              if (parent) {
                const pfop = await get(`${API}/people/${parent.id}/form_of_payments`);
                parentMethods = pfop.form_of_payments || [];
              }
            }
          } catch { }
        }
        const allMethods = [...methods, ...parentMethods];
        out.add('');
        out.add(h('PAYMENT METHODS'));
        if (allMethods.length === 0) {
          out.add(w('  ⚠️  No payment methods found (checked person + guardian)'));
          sumFlags.noPayment = true;
        } else {
          for (const m of allMethods) {
            const expired = new Date(m.expire_year, m.expire_month) < new Date();
            if (expired) sumFlags.expiredCards.push(`${m.card_type || m.type} ****${m.last_four}`);
            if (!m.autobill) sumFlags.noAutobill = true;
            out.add(`  ${m.card_type || m.type} ****${m.last_four}  exp ${m.expire_month}/${m.expire_year}  ${expired ? e('EXPIRED') : ok('valid')}  autobill:${m.autobill ? 'yes' : w('no')}`);
          }
        }
      } catch { out.add(dim('  (could not check payment methods)')); }

      // Multiple service IDs?
      const svcIds = [...new Set(realVisits.map(v => v.event_occurrence?.service_id))];
      if (svcIds.length > 1) {
        out.add('');
        out.add(w(`📋 MULTIPLE SERVICES IN RANGE: ${svcIds.join(', ')}`));
        for (const sid of svcIds) {
          const sv = realVisits.filter(v => v.event_occurrence?.service_id === sid);
          const paidN = sv.filter(v => v.paid).length;
          const dates = sv.map(v => v.event_occurrence?.start_at?.slice(0, 10)).sort();
          out.add(`  svc:${sid} (${sv[0]?.event_occurrence?.name}): ${sv.length} visits (${paidN} paid), ${dates[0]} → ${dates[dates.length - 1]}`);
        }
      }

      // ── Slack Summary ──
      out.add('');
      out.add(sep());
      out.add(h('SLACK SUMMARY (copy-paste ready)'));
      out.add(sep());
      out.add('');
      {
        const lines = [];
        if (sumFlags.noPlans) {
          lines.push(`${name} has no active plans — there's nothing to bill visits against. They'll need to be enrolled on a plan before visits can be paid.`);
        }
        if (sumFlags.mismatch.length > 0) {
          const svcNames = [...new Set(sumFlags.mismatch.map(v => v.event_occurrence?.name).filter(Boolean))];
          const svcStr = oxList(svcNames.map(s => `"${s}"`));
          lines.push(`${sumFlags.mismatch.length} of ${name}'s unpaid visit${sumFlags.mismatch.length !== 1 ? 's are' : ' is'} on ${svcStr} — a service not covered by any of their active plans. This is usually caused by a lesson duration or type change. The plan may need to be updated to cover the new service, or the visits may need to be moved to a service the plan does cover.`);
        }
        if (sumFlags.exhausted.length > 0) {
          for (const p of sumFlags.exhausted) {
            lines.push(`${name}'s "${p.name}" plan should cover these visits but is showing 0 remaining. This can happen when old visits get retroactively applied to the plan and consume its weekly/monthly slots. Run the Plan Punch Audit on plan ${p.id} to find out which visits are using up the slots.`);
          }
        }
        if (sumFlags.noPayment) {
          lines.push(`There is no payment method on file for ${name} (or their guardian). Visits can't be billed until a card is added.`);
        } else if (sumFlags.expiredCards.length > 0) {
          lines.push(`The payment method on file (${sumFlags.expiredCards.join(', ')}) is expired. The card will need to be updated before billing can go through.`);
        } else if (sumFlags.noAutobill && !sumFlags.noPlans && sumFlags.exhausted.length === 0 && sumFlags.mismatch.length === 0) {
          lines.push(`${name} has a valid payment method but autobill is turned off — lessons won't be charged automatically until it's re-enabled.`);
        }
        // State-based fixes — only surface for visits not already explained by mismatch/noPlans
        if (sumFlags.unattended.length > 0 && sumFlags.mismatch.length === 0 && !sumFlags.noPlans) {
          const n = sumFlags.unattended.length;
          lines.push(`${n} of the unpaid visit${n !== 1 ? 's are' : ' is'} still in "registered" state — attendance was never recorded. If the lesson happened, mark it complete from the event roster and the plan will be charged automatically. If it didn't happen (e.g. a holiday or cancellation), mark it as a no-show or late cancel to clear it without using a plan slot.`);
        }
        if (sumFlags.completedNoPunch.length > 0 && sumFlags.exhausted.length === 0) {
          const n = sumFlags.completedNoPunch.length;
          lines.push(`${n} visit${n !== 1 ? 's are' : ' is'} marked complete but ${n !== 1 ? 'were' : 'was'} never deducted from a plan. Use "Deduct from plan" from the event roster on each one to apply plan coverage retroactively.`);
        }
        if (lines.length === 0) {
          out.add(`No clear cause identified for ${name}'s unpaid visits — plan coverage, service match, payment method, and visit state all look intact. May need manual review.`);
        } else {
          for (const l of lines) { out.add(l); out.add(''); }
        }
      }

      out.add('');
      out.add(sep());
      out.add(ok('  INVESTIGATION COMPLETE'));
      out.add(sep());
      out.status(`<span class="success">Done — ${unpaid.length} unpaid visit(s)</span>`);

    } catch (err) {
      if (err.message === 'ABORTED') { out.status('Aborted.'); out.add(w('\n  ⚠️  Aborted by user')); }
      else { out.status(`<span class="error">Error: ${err.message}</span>`); out.add(e(`\n  ERROR: ${err.message}`)); }
    } finally {
      $('unpaid-run').disabled = false;
      stopBtn.style.display = 'none';
    }
  });

  // ═══════════════════════════════════════════════════
  //  REPORT 3: PLAN PUNCH AUDIT
  // ═══════════════════════════════════════════════════
  $('punch-run').addEventListener('click', async () => {
    const pid = $('punch-pid').value.trim();
    let planId = $('punch-planid').value.trim();
    const from = $('punch-from').value;
    const to = $('punch-to').value;
    if (!pid) return;
    const out = new Output($('punch-results'), $('punch-status'));
    const stopBtn = $('punch-stop');
    const signal = makeAbort(stopBtn);
    out.clear(); out.show();
    $('punch-run').disabled = true;

    try {
      const person = await fetchPerson(pid) || await fetchPersonDirect(pid);
      const name = person?.name || `Person ${pid}`;

      // If no plan ID, list active plans
      if (!planId) {
        out.status('Listing active plans...');
        const active = await fetchActivePlans(pid);
        const all = await fetchAllPlans(pid);
        out.add(sep());
        out.add(h(`  PLANS FOR ${name} (${pid})`));
        out.add(sep());
        out.add('');
        out.add(h('ACTIVE PLANS — enter one of these IDs:'));
        if (active.length === 0) {
          out.add(w('  (none)'));
        } else {
          for (const p of active) {
            out.add(`  ${ok(String(p.id))}  ${p.name}  ${p.start_date} → ${p.end_date || '(ongoing)'}  remaining:${p.remaining_count ?? 'n/a'}`);
          }
        }
        const inactive = all.filter(p => !active.find(a => a.id === p.id));
        if (inactive.length) {
          out.add('');
          out.add(h(`INACTIVE PLANS (${inactive.length}):`));
          for (const p of inactive.slice(0, 15)) {
            out.add(dim(`  ${p.id}  ${p.name}  ${p.start_date} → ${p.end_date || '?'}`));
          }
          if (inactive.length > 15) out.add(dim(`  ... and ${inactive.length - 15} more`));
        }
        out.status('<span class="success">Enter a Plan ID above and run again.</span>');
        return;
      }

      planId = Number(planId);
      out.add(sep());
      out.add(h(`  PLAN PUNCH AUDIT — ${name} (${pid}) — Plan ${planId}`));
      out.add(sep());

      // Get the plan details
      checkAbort(signal);
      out.status('Fetching plan details...');
      const allPlans = await fetchAllPlans(pid);
      const plan = allPlans.find(p => p.id === planId);
      if (!plan) {
        out.add(e(`\n  Plan ${planId} not found on this person's record.`));
        out.status('<span class="error">Plan not found</span>');
        return;
      }
      out.add('');
      out.add(h('PLAN DETAILS'));
      out.add(`  Name:        ${plan.name}`);
      out.add(`  Product ID:  ${plan.plan_product_id}`);
      out.add(`  Type:        ${plan.type}`);
      out.add(`  Start:       ${plan.start_date}  End: ${plan.end_date || '(ongoing)'}`);
      out.add(`  Count:       ${plan.count}  Limit period: ${plan.limit_period || '(none)'}`);
      out.add(`  Remaining:   ${plan.remaining_count ?? 'n/a'}`);
      out.add(`  Last visit:  ${plan.last_visit?.event_occurrence?.start_at?.slice(0, 10) || '(none)'}`);

      // Fetch all visits in range
      checkAbort(signal);
      out.status('Fetching all visits...');
      const visits = await fetchVisits(pid, from, to);
      const withPunches = visits.filter(v => v.punch_id);
      out.add('');
      out.add(h(`VISITS ${from} → ${to}`));
      out.add(`  Total: ${visits.length}  With punches: ${withPunches.length}`);

      // Look up each punch
      checkAbort(signal);
      out.status(`Looking up ${withPunches.length} punches (this may take a minute)...`);
      const planPunches = [];
      const otherPunches = [];
      let checked = 0;
      for (const vis of withPunches) {
        checkAbort(signal);
        try {
          const p = await get(`${API}/punches/${vis.punch_id}`);
          const punch = p.punches?.[0];
          if (punch?.plan_id === planId) {
            planPunches.push({ punch, visit: vis });
          } else {
            otherPunches.push({ punch, visit: vis });
          }
        } catch { /* skip 404s */ }
        checked++;
        if (checked % 10 === 0) out.status(`Checked ${checked}/${withPunches.length} punches...`);
        await sleep(DELAY);
      }

      out.add('');
      out.add(h(`PUNCHES ON PLAN ${planId}: ${planPunches.length} found`));
      let oldPunches = []; // hoisted so Slack summary can reference it outside the else block
      if (planPunches.length === 0) {
        out.add(w('  No punches found for this plan.'));
      } else {
        // Sort by visit date
        planPunches.sort((a, b) => {
          const da = a.visit.event_occurrence?.start_at || '';
          const db = b.visit.event_occurrence?.start_at || '';
          return da.localeCompare(db);
        });

        const currentPunches = [];
        for (const { punch, visit } of planPunches) {
          // Derive vDate from visit — it is not stored on planPunches items directly (v1.10 bugfix)
          const vDate = visit.event_occurrence?.start_at?.slice(0, 10) || '?';
          const beforeStart = vDate !== '?' && vDate < plan.start_date;
          const flag = beforeStart ? e('⚠️  BEFORE PLAN START') : '';
          out.add(`  ${vDate}  punch:${punch.id}  visit:${visit.id}  svc:${visit.event_occurrence?.name || '?'}  created:${punch.created_at?.slice(0, 10)} ${flag}`);
          if (beforeStart) oldPunches.push({ punch, visit, vDate });
          else currentPunches.push({ punch, visit, vDate });
        }

        if (oldPunches.length) {
          out.add('');
          out.add(e(`🚨 ${oldPunches.length} PUNCHES FROM VISITS BEFORE PLAN START (${plan.start_date}):`));
          out.add(e('   These old visits are consuming weekly/monthly slots on the current plan!'));
          out.add('');
          out.add(w('   PUNCH IDs TO REMOVE:'));
          for (const { punch, vDate } of oldPunches) {
            out.add(w(`     punch ${punch.id} → visit on ${vDate}  (created ${punch.created_at?.slice(0,10)})`));
          }
          out.add('');
          // Updated guidance: API ref v6.3 confirmed there is NO "Remove" button on the plan visits page.
          // The fix must be done from each event occurrence roster (gear icon → Reset attendance).
          out.add(w('   HOW TO FIX:'));
          out.add('   There is no Remove button on the plan visits page. To remove a punch,');
          out.add('   go to the event occurrence, click the gear ⚙ icon next to this student,');
          out.add('   and choose "Reset attendance". This removes the punch and frees the slot.');
          out.add('');
          out.add('   Event occurrence links (gear ⚙ → Reset attendance on each):');
          for (const { punch, visit, vDate } of oldPunches) {
            const occId = visit.event_occurrence?.id;
            const occLink = occId ? `/e/${occId}` : '(occurrence ID not available)';
            out.add(w(`     ${vDate}  punch:${punch.id}  visit:${visit.id}  → ${occLink}`));
          }
        }

        // Week-by-week slot analysis (if weekly plan)
        if (plan.limit_period === 'weekly' || plan.limit_period === 'monthly') {
          out.add('');
          out.add(h(`SLOT ALLOCATION (${plan.limit_period}, ${plan.count} per period)`));

          // Guard against invalid/missing date strings — v1.10 bugfix
          const getWeekStart = (dateStr) => {
            if (!dateStr || dateStr === '?') return null;
            const d = new Date(dateStr + 'T00:00:00Z');
            if (isNaN(d.getTime())) return null;
            const day = d.getUTCDay();
            const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1); // Monday start
            return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff)).toISOString().slice(0, 10);
          };

          // Get all visits (not just punched) in plan's active period to show gaps.
          // Cap at today — future pre-booked visits aren't unpaid, just not yet due.
          const today = new Date().toISOString().slice(0, 10);
          const planVisits = visits.filter(v => {
            const vDate = v.event_occurrence?.start_at?.slice(0, 10);
            return vDate && vDate >= plan.start_date && vDate <= today
              && !['late_canceled', 'cancelled'].includes(v.state);
          });

          const slotMap = new Map(); // weekStart → { punched: [], unpaid: [] }

          // Derive vDate from visit inside the loop — v1.10 bugfix
          for (const { punch, visit } of planPunches) {
            const vDate = visit.event_occurrence?.start_at?.slice(0, 10) || '?';
            const ws = getWeekStart(vDate);
            if (!ws) continue; // skip if date is invalid
            if (!slotMap.has(ws)) slotMap.set(ws, { punched: [], unpaid: [] });
            slotMap.get(ws).punched.push({ vDate, punchId: punch.id, old: vDate < plan.start_date });
          }
          for (const v of planVisits) {
            if (!v.paid && !v.punch_id) {
              const vDate = v.event_occurrence?.start_at?.slice(0, 10);
              if (!vDate) continue;
              const ws = getWeekStart(vDate);
              if (!ws) continue; // skip if date is invalid
              if (!slotMap.has(ws)) slotMap.set(ws, { punched: [], unpaid: [] });
              slotMap.get(ws).unpaid.push({ vDate, visitId: v.id });
            }
          }

          const sortedWeeks = [...slotMap.keys()].sort();
          for (const ws of sortedWeeks) {
            const slot = slotMap.get(ws);
            const punchInfo = slot.punched.map(p => `${p.vDate}${p.old ? ' ' + e('(OLD)') : ' ' + ok('✓')}`).join(', ');
            const unpaidInfo = slot.unpaid.map(u => e(u.vDate)).join(', ');
            let line = `  Week of ${ws}: `;
            if (slot.punched.length) line += `punched: ${punchInfo}`;
            if (slot.unpaid.length) line += `${slot.punched.length ? '  |  ' : ''}${e('unpaid: ' + unpaidInfo)}`;
            out.add(line);
          }
        }
      }

      // ── Slack Summary ──
      out.add('');
      out.add(sep());
      out.add(h('SLACK SUMMARY (copy-paste ready)'));
      out.add(sep());
      out.add('');
      {
        // Cap at today — future pre-booked visits show as unpaid but haven't occurred yet
        const today = new Date().toISOString().slice(0, 10);
        const unpaidInActivePeriod = visits.filter(v =>
          !v.paid &&
          !['late_canceled', 'cancelled'].includes(v.state) &&
          (v.event_occurrence?.start_at?.slice(0, 10) || '') >= plan.start_date &&
          (v.event_occurrence?.start_at?.slice(0, 10) || '') <= today
        );
        if (planPunches.length === 0) {
          out.add(`No punches were found for ${name}'s "${plan.name}" plan in the scanned date range. Visits may be covered by a different plan, or the plan hasn't been used yet.`);
        } else if (oldPunches.length > 0) {
          const plural = oldPunches.length !== 1;
          const oldDates = oxList(oldPunches.map(p => p.vDate));
          out.add(`${name}'s "${plan.name}" plan is showing 0 remaining because ${oldPunches.length} visit${plural ? 's' : ''} from before the plan started (${plan.start_date}) ${plural ? 'are' : 'is'} taking up ${plan.limit_period} slot${plural ? 's' : ''}: ${oldDates}. The fix is to go to each event occurrence listed above and use the gear icon → "Reset attendance" to remove the punch and free the slot.`);
        } else if (plan.remaining_count === 0 && unpaidInActivePeriod.length > 0) {
          const unpaidRegistered = unpaidInActivePeriod.filter(v => v.state === 'registered');
          const unpaidCompletedNoPunch = unpaidInActivePeriod.filter(v => v.state === 'completed' && !v.punch_id);
          const unpaidOther = unpaidInActivePeriod.filter(v => v.state !== 'registered' && !(v.state === 'completed' && !v.punch_id));
          const firstUnpaid = unpaidInActivePeriod.map(v => v.event_occurrence?.start_at?.slice(0, 10)).filter(Boolean).sort()[0];
          let msg = `${name}'s "${plan.name}" plan has no old visits consuming slots — all ${planPunches.length} punch${planPunches.length !== 1 ? 'es' : ''} are from within the plan's active period. The plan is showing 0 remaining with ${unpaidInActivePeriod.length} unpaid past visit${unpaidInActivePeriod.length !== 1 ? 's' : ''} (first: ${firstUnpaid}). `;
          if (unpaidRegistered.length > 0 && unpaidCompletedNoPunch.length === 0 && unpaidOther.length === 0) {
            const n = unpaidRegistered.length;
            msg += `All ${n} ${n !== 1 ? 'are' : 'is'} in "registered" state — attendance was never recorded. If those lessons happened, mark each one complete from the event roster (this will automatically deduct from the plan). If they didn't happen, mark them as no-show or late cancel to clear them without consuming a plan slot.`;
          } else if (unpaidCompletedNoPunch.length > 0 && unpaidRegistered.length === 0 && unpaidOther.length === 0) {
            const n = unpaidCompletedNoPunch.length;
            msg += `All ${n} ${n !== 1 ? 'are' : 'is'} marked complete but ${n !== 1 ? 'were' : 'was'} never deducted from the plan. Use "Deduct from plan" from the event roster on each one to apply coverage.`;
          } else if (unpaidRegistered.length > 0 || unpaidCompletedNoPunch.length > 0) {
            const parts = [];
            if (unpaidRegistered.length > 0) parts.push(`${unpaidRegistered.length} in "registered" state (attendance not recorded — mark complete or no-show from the event roster)`);
            if (unpaidCompletedNoPunch.length > 0) parts.push(`${unpaidCompletedNoPunch.length} marked complete but never deducted from the plan (use "Deduct from plan" from the event roster)`);
            if (unpaidOther.length > 0) parts.push(`${unpaidOther.length} in another state — may need manual review`);
            msg += parts.join('; ') + '.';
          } else {
            msg += `The visit states don't point to an obvious fix — may need manual review.`;
          }
          out.add(msg);
        } else {
          out.add(`No slot allocation issues found for ${name}'s "${plan.name}" plan — all ${planPunches.length} punch${planPunches.length !== 1 ? 'es' : ''} are within the plan's active period.`);
        }
      }

      out.add('');
      out.add(sep());
      out.add(ok('  PUNCH AUDIT COMPLETE'));
      out.add(sep());
      out.status(`<span class="success">Done — ${planPunches.length} punches found on plan</span>`);

    } catch (err) {
      if (err.message === 'ABORTED') { out.status('Aborted.'); out.add(w('\n  ⚠️  Aborted by user')); }
      else { out.status(`<span class="error">Error: ${err.message}</span>`); out.add(e(`\n  ERROR: ${err.message}`)); }
    } finally {
      $('punch-run').disabled = false;
      stopBtn.style.display = 'none';
    }
  });

  // ═══════════════════════════════════════════════════
  //  REPORT 4: PRICE MISMATCH SCANNER
  // ═══════════════════════════════════════════════════
  $('price-run').addEventListener('click', async () => {
    const scope = $('price-scope').value;
    const ppFilter = $('price-ppid').value.trim();
    const singlePid = $('price-pid').value.trim();
    const batchSize = parseInt($('price-batch').value);
    const maxPeople = parseInt($('price-max').value);
    if (scope === 'single' && !singlePid) return;
    const out = new Output($('price-results'), $('price-status'));
    const stopBtn = $('price-stop');
    const signal = makeAbort(stopBtn);
    out.clear(); out.show();
    $('price-run').disabled = true;

    try {
      out.add(sep());
      out.add(h('  PRICE MISMATCH SCANNER'));
      out.add(sep());

      // Load plan product templates
      out.status('Loading plan product templates...');
      const ppMap = await fetchPlanProductMap(signal);

      // Build template price map (only billing types)
      const templatePrices = new Map();
      for (const [id, pp] of ppMap) {
        if (['MembershipProduct', 'PackProduct', 'PrepaidProduct'].includes(pp.type)) {
          templatePrices.set(id, {
            name: pp.product?.name || pp.name || `PP#${id}`,
            price_cents: pp.product?.price_cents ?? null,
            type: pp.type
          });
        }
      }
      out.add(`\n  Loaded ${templatePrices.size} billing plan templates (excl RackPlanProduct)`);

      if (ppFilter) {
        const filterId = Number(ppFilter);
        if (!templatePrices.has(filterId)) {
          out.add(w(`  ⚠️  Plan Product ${ppFilter} not found in billing templates`));
        } else {
          const tp = templatePrices.get(filterId);
          out.add(`  Filtering to: ${tp.name} — template price $${((tp.price_cents || 0) / 100).toFixed(2)}`);
        }
      }

      // Collect people to scan
      let peopleIds = [];
      if (scope === 'single') {
        peopleIds = [Number(singlePid)];
      } else {
        out.status('Loading people list...');
        let page = 1;
        while (peopleIds.length < maxPeople) {
          checkAbort(signal);
          const d = await get(`${API}/people?per_page=100&page=${page}`);
          const batch = (d.people || []).map(p => p.id);
          if (batch.length === 0) break;
          peopleIds.push(...batch);
          out.status(`Loaded ${peopleIds.length} people...`);
          if (!d.next) break;
          page++;
          await sleep(DELAY);
        }
        peopleIds = peopleIds.slice(0, maxPeople);
        out.add(`  Scanning ${peopleIds.length} people...`);
      }

      // Scan plans
      const mismatches = [];
      const errors = [];
      let scanned = 0;
      const startTime = Date.now();

      const processPerson = async (personId) => {
        checkAbort(signal);
        try {
          const d = await get(`${API}/people/${personId}/plans?filter=active`);
          const plans = d.plans || [];
          for (const plan of plans) {
            const ppId = plan.plan_product_id;
            if (ppFilter && ppId !== Number(ppFilter)) continue;
            const template = templatePrices.get(ppId);
            if (!template) continue; // archived/deleted template
            const clientPrice = plan.price_cents;
            const templatePrice = template.price_cents;
            if (clientPrice !== null && templatePrice !== null && clientPrice !== templatePrice) {
              mismatches.push({
                person_id: personId,
                plan_id: plan.id,
                plan_name: plan.name,
                plan_product_id: ppId,
                template_name: template.name,
                client_price: clientPrice,
                template_price: templatePrice,
                diff_cents: clientPrice - templatePrice
              });
            }
          }
        } catch (err) {
          errors.push({ personId, error: err.message });
        }
        scanned++;
      };

      // Process in batches
      for (let i = 0; i < peopleIds.length; i += batchSize) {
        checkAbort(signal);
        const batch = peopleIds.slice(i, i + batchSize);
        await Promise.all(batch.map(processPerson));
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = (scanned / elapsed * 60).toFixed(0);
        const eta = ((peopleIds.length - scanned) / (scanned / elapsed)).toFixed(0);
        out.status(`Scanned ${scanned}/${peopleIds.length} (${rate}/min, ~${eta}s remaining) — ${mismatches.length} mismatches`);
        await sleep(200);
      }

      // Output results
      out.add('');
      if (mismatches.length === 0) {
        out.add(ok('  ✅ No price mismatches found!'));
      } else {
        out.add(e(`  🚨 ${mismatches.length} PRICE MISMATCH(ES) FOUND:`));
        out.add('');
        // Group by template
        const byTemplate = new Map();
        for (const m of mismatches) {
          const key = m.plan_product_id;
          if (!byTemplate.has(key)) byTemplate.set(key, []);
          byTemplate.get(key).push(m);
        }
        for (const [ppId, items] of byTemplate) {
          const tmpl = items[0];
          out.add(h(`  ${tmpl.template_name} (PP#${ppId}) — template: $${(tmpl.template_price / 100).toFixed(2)}`));
          for (const m of items) {
            const clientStr = `$${(m.client_price / 100).toFixed(2)}`;
            const diffStr = m.diff_cents > 0 ? `+$${(m.diff_cents / 100).toFixed(2)}` : `-$${(Math.abs(m.diff_cents) / 100).toFixed(2)}`;
            out.add(`    Person ${m.person_id} plan ${m.plan_id}: ${w(clientStr)} (${diffStr})`);
          }
          out.add('');
        }

        // Summary table
        out.add(h('SUMMARY'));
        out.add(`  Total mismatches:  ${mismatches.length}`);
        out.add(`  Underpaying:       ${mismatches.filter(m => m.diff_cents < 0).length}`);
        out.add(`  Overpaying:        ${mismatches.filter(m => m.diff_cents > 0).length}`);
        const totalDiff = mismatches.reduce((s, m) => s + m.diff_cents, 0);
        out.add(`  Net difference:    $${(totalDiff / 100).toFixed(2)}/cycle`);
      }

      if (errors.length) {
        out.add('');
        out.add(w(`  ${errors.length} errors during scan (rate limiting or 404s)`));
      }

      out.add('');
      out.add(sep());
      out.add(ok('  PRICE SCAN COMPLETE'));
      out.add(sep());
      out.status(`<span class="success">Done — ${mismatches.length} mismatches in ${scanned} people</span>`);

    } catch (err) {
      if (err.message === 'ABORTED') { out.status('Aborted.'); out.add(w('\n  ⚠️  Aborted by user')); }
      else { out.status(`<span class="error">Error: ${err.message}</span>`); out.add(e(`\n  ERROR: ${err.message}`)); }
    } finally {
      $('price-run').disabled = false;
      stopBtn.style.display = 'none';
    }
  });

  // ═══════════════════════════════════════════════════
  //  REPORT 5: EVENT ROSTER CHECK
  // ═══════════════════════════════════════════════════
  $('roster-run').addEventListener('click', async () => {
    const eoId = $('roster-eoid').value.trim();
    if (!eoId) return;
    const includePasses = $('roster-passes').checked;
    const out = new Output($('roster-results'), $('roster-status'));
    const stopBtn = $('roster-stop');
    const signal = makeAbort(stopBtn);
    out.clear(); out.show();
    $('roster-run').disabled = true;

    try {
      // 1. Fetch the event occurrence
      out.status('Fetching event occurrence...');
      checkAbort(signal);
      let eo;
      try {
        const d = await get(`${API}/event_occurrences/${eoId}`);
        eo = d.event_occurrences?.[0];
      } catch (err) {
        // Try the non-API path
        try {
          const r = await fetch(`/e/${eoId}.json`, { credentials: 'include' });
          if (r.ok) eo = await r.json();
        } catch { }
      }
      if (!eo) {
        out.add(e(`  Event Occurrence ${eoId} not found.`));
        out.status('<span class="error">Event not found</span>');
        return;
      }

      const eventName = eo.name || '(unnamed)';
      const serviceId = eo.service_id;
      const startAt = eo.start_at?.slice(0, 16)?.replace('T', ' ') || '?';
      const locationName = eo.location?.name || `loc:${eo.location_id || '?'}`;

      out.add(sep());
      out.add(h(`  EVENT ROSTER CHECK — ${eventName}`));
      out.add(sep());
      out.add('');
      out.add(h('EVENT'));
      out.add(`  Name:     ${eventName}`);
      out.add(`  ID:       ${eoId}`);
      out.add(`  Service:  ${serviceId}`);
      out.add(`  Start:    ${startAt}`);
      out.add(`  Location: ${locationName}`);

      // 2. Get visits/enrollment for this event occurrence
      checkAbort(signal);
      out.status('Fetching enrolled students...');
      const vd = await get(`${API}/event_occurrences/${eoId}/visits`);
      const visits = (vd.visits || []).filter(v => !['late_canceled', 'cancelled'].includes(v.state));

      if (visits.length === 0) {
        out.add('');
        out.add(w('  No enrolled students found for this event.'));
        out.status('Done — no students');
        return;
      }

      out.add(`  Enrolled:  ${visits.length} student(s)`);

      // 3. Load plan product templates for service matching
      checkAbort(signal);
      out.status('Loading plan product templates...');
      const ppMap = await fetchPlanProductMap(signal);

      // Build a lookup: which plan products cover this service?
      const coveringPPs = new Set();
      for (const [ppId, pp] of ppMap) {
        if ((pp.services || []).some(s => s.id === serviceId)) {
          coveringPPs.add(ppId);
        }
      }

      // 4. Check each enrolled student
      const issues = [];
      const results = [];
      let checked = 0;

      out.add('');
      out.add(h(`ROSTER (${visits.length} students)`));
      out.add('');

      for (const vis of visits) {
        checkAbort(signal);
        const personId = vis.person_id;
        const personName = vis.person?.name || `Person ${personId}`;
        out.status(`Checking ${personName} (${checked + 1}/${visits.length})...`);

        // Get active plans
        let activePlans = [];
        try {
          activePlans = await fetchActivePlans(personId);
        } catch { }

        const paid = vis.paid;
        const punchId = vis.punch_id;
        const status = paid ? ok('PAID') : e('UNPAID');

        // Find which plans cover this event's service
        const coveringPlans = activePlans.filter(p => coveringPPs.has(p.plan_product_id));
        // Find plans that DON'T cover the service (potential mismatches)
        const nonCoveringPlans = activePlans.filter(p => !coveringPPs.has(p.plan_product_id));

        // Get the plan that actually covered this visit (if paid)
        let coveringPlanName = null;
        let coveringPlanPrice = null;
        let wrongPlanFlag = false;
        if (punchId) {
          try {
            const pd = await get(`${API}/punches/${punchId}`);
            const punch = pd.punches?.[0];
            if (punch) {
              const usedPlan = activePlans.find(p => p.id === punch.plan_id);
              // Also check inactive plans
              if (!usedPlan) {
                try {
                  const allP = await fetchAllPlans(personId);
                  const matchedPlan = allP.find(p => p.id === punch.plan_id);
                  if (matchedPlan) {
                    coveringPlanName = matchedPlan.name;
                    coveringPlanPrice = matchedPlan.price_cents;
                    if (!coveringPPs.has(matchedPlan.plan_product_id)) wrongPlanFlag = true;
                  }
                } catch { }
              } else {
                coveringPlanName = usedPlan.name;
                coveringPlanPrice = usedPlan.price_cents;
                if (!coveringPPs.has(usedPlan.plan_product_id)) wrongPlanFlag = true;
              }
            }
          } catch { }
        }

        // Determine issue type
        let issueType = null;
        let issueDetail = '';
        if (!paid && coveringPlans.length === 0) {
          issueType = 'NO_COVERING_PLAN';
          issueDetail = 'No active plan covers this service';
        } else if (!paid && coveringPlans.length > 0) {
          const exhausted = coveringPlans.some(p => p.remaining_count === 0);
          if (exhausted) {
            issueType = 'PLAN_EXHAUSTED';
            issueDetail = 'Has a covering plan but remaining_count is 0';
          } else {
            issueType = 'UNPAID_WITH_PLAN';
            issueDetail = 'Has a covering plan with remaining count — may need manual application';
          }
        } else if (wrongPlanFlag) {
          issueType = 'WRONG_PLAN';
          issueDetail = `Covered by "${coveringPlanName}" which doesn't include this service`;
        }

        // Check for plan/service price mismatch
        let priceMismatch = null;
        if (coveringPlans.length > 0) {
          for (const cp of coveringPlans) {
            const pp = ppMap.get(cp.plan_product_id);
            const templatePrice = pp?.product?.price_cents;
            if (templatePrice !== null && cp.price_cents !== null && cp.price_cents !== templatePrice) {
              priceMismatch = {
                planName: cp.name,
                clientPrice: cp.price_cents,
                templatePrice: templatePrice
              };
              break;
            }
          }
        }

        // Format output
        let line = `  ${status}  ${personName} (${personId})`;
        if (coveringPlans.length > 0) {
          const planNames = coveringPlans.map(p => {
            const price = p.price_cents !== null ? ` $${(p.price_cents / 100).toFixed(2)}` : '';
            return `${p.name}${price}`;
          }).join(', ');
          line += `\n        Plan: ${ok(planNames)}`;
        }
        if (wrongPlanFlag && coveringPlanName) {
          line += `\n        ${w('⚠️  Covered by WRONG plan: ' + coveringPlanName)}`;
        }
        let wrongPlanDetails = null;
        if (!paid && coveringPlans.length === 0 && nonCoveringPlans.length > 0) {
          const wrongPlan = nonCoveringPlans[0];
          const wrongPP = ppMap.get(wrongPlan.plan_product_id);
          const wrongSvcNames = (wrongPP?.services || []).map(s => s.name);
          const wrongPrice = wrongPlan.price_cents !== null ? `$${(wrongPlan.price_cents / 100).toFixed(2)}` : '';
          wrongPlanDetails = { name: wrongPlan.name, price: wrongPrice, services: wrongSvcNames };
          line += `\n        Current plan: ${w(wrongPlan.name)}${wrongPrice ? ' ' + wrongPrice : ''}`;
          line += `\n        ${e('🚨 This plan does not cover this class\'s service')}`;
          line += `\n        ${dim('Plan covers: ' + (oxList(wrongSvcNames) || 'unknown'))}`;
          if (nonCoveringPlans.length > 1) {
            for (const extra of nonCoveringPlans.slice(1)) {
              const extraPP = ppMap.get(extra.plan_product_id);
              const extraSvcs = (extraPP?.services || []).map(s => s.name);
              line += `\n        ${dim('Also has: ' + extra.name + ' (covers: ' + (oxList(extraSvcs) || 'unknown') + ')')}`;
            }
          }
        }
        if (issueType === 'PLAN_EXHAUSTED') {
          const exhaustedPlan = coveringPlans.find(p => p.remaining_count === 0);
          line += `\n        ${w('⚠️  Plan slots exhausted (remaining: 0) — run Plan Punch Audit on plan ' + exhaustedPlan?.id)}`;
        }
        if (priceMismatch) {
          line += `\n        ${w(`⚠️  Price mismatch: client pays $${(priceMismatch.clientPrice / 100).toFixed(2)} vs template $${(priceMismatch.templatePrice / 100).toFixed(2)}`)}`;
        }
        if (!paid && coveringPlans.length === 0 && nonCoveringPlans.length === 0) {
          line += `\n        ${e('🚨 NO ACTIVE PLANS AT ALL')}`;
        }

        out.add(line);

        const result = { personId, personName, paid, issueType, issueDetail, coveringPlans, priceMismatch, wrongPlanDetails, nonCoveringPlans: nonCoveringPlans.map(p => p.name) };
        results.push(result);
        if (issueType || priceMismatch || wrongPlanFlag) issues.push(result);

        checked++;
        await sleep(DELAY);
      }

      // 5. Summary
      out.add('');
      out.add(sep());
      out.add(h('SUMMARY'));
      const unpaidCount = results.filter(r => !r.paid).length;
      const paidCount = results.filter(r => r.paid).length;
      out.add(`  Total enrolled: ${results.length}  ${ok('Paid: ' + paidCount)}  ${unpaidCount ? e('Unpaid: ' + unpaidCount) : ok('Unpaid: 0')}`);

      if (issues.length === 0) {
        out.add(ok('  ✅ No issues found.'));
      } else {
        out.add(w(`  ⚠️  ${issues.length} student(s) with issues:`));
        const byType = {};
        for (const iss of issues) {
          const type = iss.issueType || (iss.priceMismatch ? 'PRICE_MISMATCH' : 'OTHER');
          if (!byType[type]) byType[type] = [];
          byType[type].push(iss);
        }
        const typeLabels = {
          NO_COVERING_PLAN: '🚨 No plan covering this service',
          PLAN_EXHAUSTED: '⚠️  Covering plan has 0 remaining',
          UNPAID_WITH_PLAN: '⚠️  Unpaid but has a covering plan',
          WRONG_PLAN: '⚠️  Covered by wrong plan',
          PRICE_MISMATCH: '⚠️  Price mismatch vs template',
          OTHER: '⚠️  Other issue'
        };
        for (const [type, items] of Object.entries(byType)) {
          out.add(`    ${typeLabels[type] || type}: ${items.length} — ${oxList(items.map(i => i.personName))}`);
        }
      }

      // Which plan products WOULD cover this service?
      const coveringPlansTemplates = [...ppMap.values()].filter(pp =>
        (pp.services || []).some(s => s.id === serviceId) && pp.type === 'MembershipProduct'
      );
      const coveringPassTemplates = [...ppMap.values()].filter(pp =>
        (pp.services || []).some(s => s.id === serviceId) &&
        ['PackProduct', 'PrepaidProduct'].includes(pp.type)
      );
      const coveringTemplates = includePasses
        ? [...coveringPlansTemplates, ...coveringPassTemplates]
        : [...coveringPlansTemplates];
      if (coveringPlansTemplates.length || coveringPassTemplates.length) {
        out.add('');
        out.add(h(`PLANS${includePasses ? ' & PASSES' : ''} COVERING SERVICE ${serviceId}:`));
        if (coveringPlansTemplates.length) {
          if (includePasses && coveringPassTemplates.length) out.add('  Plans (Memberships):');
          for (const pp of coveringPlansTemplates) {
            const price = pp.product?.price_cents != null ? `$${(pp.product.price_cents / 100).toFixed(2)}` : '$?';
            out.add(`  ${includePasses && coveringPassTemplates.length ? '  ' : ''}PP#${pp.id}  ${pp.product?.name || pp.name}  ${price}`);
          }
        }
        if (includePasses && coveringPassTemplates.length) {
          out.add('  Passes (Packs):');
          for (const pp of coveringPassTemplates) {
            const price = pp.product?.price_cents != null ? `$${(pp.product.price_cents / 100).toFixed(2)}` : '$?';
            out.add(`    PP#${pp.id}  ${pp.product?.name || pp.name}  ${price}`);
          }
        }
        if (!includePasses && coveringPassTemplates.length) {
          out.add(dim(`  (${coveringPassTemplates.length} pass template(s) also cover this service — check "Include passes" to show)`));
        }
      }

      // 6. Generate Slack-ready summary
      const wrongPlanIssues = issues.filter(i => i.issueType === 'NO_COVERING_PLAN' && i.wrongPlanDetails);
      const exhaustedIssues = issues.filter(i => i.issueType === 'PLAN_EXHAUSTED');
      const noPlanIssues = issues.filter(i => i.issueType === 'NO_COVERING_PLAN' && !i.wrongPlanDetails);
      const unpaidWithPlanIssues = issues.filter(i => i.issueType === 'UNPAID_WITH_PLAN');
      const priceIssues = issues.filter(i => i.priceMismatch);

      if (issues.length > 0) {
        out.add('');
        out.add(sep());
        out.add(h('SLACK SUMMARY (copy-paste ready)'));
        out.add(sep());
        out.add('');

        const lines = [];

        if (wrongPlanIssues.length > 0) {
          // Group by wrong plan name — students may be on different wrong plans
          const byPlan = {};
          for (const iss of wrongPlanIssues) {
            const key = iss.wrongPlanDetails.name;
            if (!byPlan[key]) byPlan[key] = { details: iss.wrongPlanDetails, students: [] };
            byPlan[key].students.push(iss.personName);
          }

          for (const [planName, group] of Object.entries(byPlan)) {
            const names = oxList(group.students);
            const count = group.students.length;
            const svcList = oxList(group.details.services);
            const priceStr = group.details.price ? ` (${group.details.price})` : '';

            // Opening — explain the problem
            const verb = count === 1 ? 'is' : 'are';
            lines.push(`${names} ${verb} showing as unpaid, because ${count === 1 ? "they are" : "all of them are"} enrolled in the "${planName}"${priceStr} plan, which does not cover this class. There are two ways to resolve this, depending on whether the plan is wrong or the class is wrong.`);
            lines.push('');

            // Build the best suggestion for "wrong plan" option
            const suggestionPool = includePasses
              ? [...coveringPlansTemplates, ...coveringPassTemplates]
              : [...coveringPlansTemplates];
            const fmtSuggestion = (pp) => `"${pp.product?.name || pp.name}" ($${((pp.product?.price_cents || 0) / 100).toFixed(2)})`;

            let planType = 'plan';
            if (includePasses && !coveringPlansTemplates.length && coveringPassTemplates.length) planType = 'pass';
            else if (includePasses && coveringPlansTemplates.length && coveringPassTemplates.length) planType = 'plan or pass';

            if (suggestionPool.length > 0) {
              const suggestionStr = suggestionPool.length <= 2
                ? oxList(suggestionPool.map(fmtSuggestion), 'or')
                : fmtSuggestion(suggestionPool[0]);
              const moreNote = suggestionPool.length > 2 ? ` (${suggestionPool.length - 1} other options also cover this service)` : '';
              lines.push(`• If they have the wrong ${planType} but are in the right class, then they'll need to be switched to a ${planType} that covers "${eventName}" services, such as ${suggestionStr}${moreNote}.`);
            } else {
              lines.push(`• If they have the wrong plan but are in the right class, then they'll need to be switched to a plan that covers "${eventName}" services (none were found in the current templates — one may need to be set up).`);
            }

            // "Wrong class" option — pick the best service to suggest
            const coveredSvcNames = group.details.services;
            const svcStr = coveredSvcNames.length <= 2
              ? oxList(coveredSvcNames.map(s => `"${s}"`), 'or')
              : `"${coveredSvcNames[0]}"`;
            const moreSvcNote = coveredSvcNames.length > 2 ? ` (their plan also covers ${coveredSvcNames.length - 1} other services)` : '';
            lines.push('');
            lines.push(`• If they have the right plan but are in the wrong class, then they'll need to be switched to an event that is covered by their "${planName}" plan, such as ${svcStr}${moreSvcNote}.`);
          }
        }

        if (exhaustedIssues.length > 0) {
          if (lines.length) lines.push('');
          const names = oxList(exhaustedIssues.map(i => i.personName));
          const singular = exhaustedIssues.length === 1;
          lines.push(`${names} ${singular ? 'has' : 'have'} the right plan but the weekly/monthly visit slots are used up (showing 0 remaining). This can happen when old visits get retroactively applied to the plan. The fix is to check the plan's visit allocation and remove any old visits that are taking up current slots.`);
        }

        if (noPlanIssues.length > 0) {
          if (lines.length) lines.push('');
          const names = oxList(noPlanIssues.map(i => i.personName));
          const singular = noPlanIssues.length === 1;
          lines.push(`${names} ${singular ? "doesn't have" : "don't have"} any active plans at all and ${singular ? 'needs' : 'need'} to be enrolled on a plan.`);
        }

        if (unpaidWithPlanIssues.length > 0) {
          if (lines.length) lines.push('');
          const names = oxList(unpaidWithPlanIssues.map(i => i.personName));
          const singular = unpaidWithPlanIssues.length === 1;
          lines.push(`${names} ${singular ? 'has' : 'have'} an active plan that covers this service with visits remaining, but ${singular ? 'their visit is' : 'their visits are'} showing as unpaid. This usually means attendance hasn't been recorded yet — the visit is still in "registered" state. If the lesson happened, mark it complete from the event roster and the plan will be charged automatically. If it didn't happen, mark it as a no-show or late cancel instead.`);
        }

        if (priceIssues.length > 0 && wrongPlanIssues.length === 0 && exhaustedIssues.length === 0) {
          if (lines.length) lines.push('');
          const names = oxList(priceIssues.map(i => i.personName));
          const singular = priceIssues.length === 1;
          lines.push(`${names} ${singular ? 'has' : 'have'} a price mismatch — their plan price doesn't match the current template rate and may need to be updated.`);
        }

        for (const l of lines) out.add(l);
      }

      out.add('');
      out.add(sep());
      out.add(ok('  ROSTER CHECK COMPLETE'));
      out.add(sep());
      out.status(`<span class="success">Done — ${issues.length} issue(s) in ${results.length} students</span>`);

    } catch (err) {
      if (err.message === 'ABORTED') { out.status('Aborted.'); out.add(w('\n  ⚠️  Aborted by user')); }
      else { out.status(`<span class="error">Error: ${err.message}</span>`); out.add(e(`\n  ERROR: ${err.message}`)); }
    } finally {
      $('roster-run').disabled = false;
      stopBtn.style.display = 'none';
    }
  });

  // ── Copy buttons ──
  for (const [btn, results] of [
    ['diag-copy', 'diag-results'],
    ['unpaid-copy', 'unpaid-results'],
    ['punch-copy', 'punch-results'],
    ['price-copy', 'price-results'],
    ['roster-copy', 'roster-results'],
  ]) {
    $(btn).addEventListener('click', () => {
      const text = $(results).innerText;
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        const el = $(btn);
        const orig = el.textContent;
        el.textContent = 'Copied!';
        setTimeout(() => el.textContent = orig, 1500);
      });
    });
  }

  const ctxParts = [];
  if (ctx.pid) ctxParts.push(`person:${ctx.pid}`);
  if (ctx.eoId) ctxParts.push(`event:${ctx.eoId}`);
  if (ctx.planId) ctxParts.push(`plan:${ctx.planId}`);
  const ctxStr = ctxParts.length ? ` (detected ${ctxParts.join(', ')} → ${ctx.autoTab})` : '';
  console.log(`Pike13 Investigator v${VERSION} loaded successfully${ctxStr}`);
})();