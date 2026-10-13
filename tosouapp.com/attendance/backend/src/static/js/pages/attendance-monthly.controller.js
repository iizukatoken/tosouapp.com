(function () {
  const root = globalThis.AttendanceMonthly || {};
  const core = root.Core || globalThis.MonthlyMonthlyCore || {};
  const state = root.State || globalThis.MonthlyMonthlyState || {};
  const render = root.Render || globalThis.MonthlyMonthlyRender || {};
  const api = root.Api || globalThis.MonthlyMonthlyApi || {};
  const sectionsRender = root.SectionsRender || globalThis.MonthlyMonthlySectionsRender || {};
  const draft = root.Draft || globalThis.MonthlyMonthlyDraft || null;

  const { $, showSpinner, hideSpinner, fetchJSONAuth, downloadWithAuth, ensureAuthProfile, showErr, setDirty, clearDirty, monthJST, addMonths, cssEscape, fromDateTime, workTypeLabel } = core;
  const { renderTable, markRowSaved, recomputeRow } = render;
  const { loadMonth, collectUpdates } = api;
  const { renderContract, renderWorkDetail, renderSummary, renderYearSummary } = sectionsRender;

  const ctx = {
    profile: null,
    role: '',
    actingUserId: '',
    initialYM: '',
    picker1: null,
    picker2: null,
    picker: null,
    summaryHost: null,
    tableHost: null,
    contractHost: null,
    workDetailHost: null,
    wfWrap: null,
    pinMonthHeadMode: 'bottom',
    btnPin: null,
    autoSaveTimer: null,
    autoSaveInFlight: false,
    lastAutoSavePayload: '',
    userPicker: null,
    applyContractTab: null,
    applySummaryTab: null,
    summaryEditorWrap: null
  };

  const getDailyCollapsed = () => {
    try { return localStorage.getItem('monthly.dailyCollapsed') === '1'; } catch (e) { return false; }
  };
  const setDailyCollapsed = (v) => {
    try { localStorage.setItem('monthly.dailyCollapsed', v ? '1' : '0'); } catch (e) { /* silently ignored */ }
  };
  const applyDailyCollapsed = (collapsed) => {
    const sec = $('#dailySection');
    const btn = $('#dailyToggle');
    if (sec) {
      try { sec.classList.toggle('collapsed', !!collapsed); } catch (e) { /* silently ignored */ }
    }
    if (btn) {
      try { btn.setAttribute('aria-pressed', collapsed ? 'true' : 'false'); } catch (e) { /* silently ignored */ }
      try { btn.setAttribute('aria-label', collapsed ? '日次実績を展開する' : '日次実績を折りたたむ'); } catch (e) { /* silently ignored */ }
    }
  };

  const getContractCollapsed = () => {
    try { return localStorage.getItem('monthly.contractCollapsed') === '1'; } catch (e) { return false; }
  };
  const setContractCollapsed = (v) => {
    try { localStorage.setItem('monthly.contractCollapsed', v ? '1' : '0'); } catch (e) { /* silently ignored */ }
  };
  const applyContractCollapsed = (collapsed) => {
    const sec = $('#contractSection');
    const btn = $('#contractToggle');
    if (sec) {
      try { sec.classList.toggle('collapsed', !!collapsed); } catch (e) { /* silently ignored */ }
    }
    if (btn) {
      try { btn.setAttribute('aria-pressed', collapsed ? 'true' : 'false'); } catch (e) { /* silently ignored */ }
      try { btn.setAttribute('aria-label', collapsed ? '契約先一覧を展開する' : '契約先一覧を折りたたむ'); } catch (e) { /* silently ignored */ }
    }
  };

  const getSummaryCollapsed = () => {
    try { return localStorage.getItem('monthly.summaryCollapsed') === '1'; } catch (e) { return false; }
  };
  const setSummaryCollapsed = (v) => {
    try { localStorage.setItem('monthly.summaryCollapsed', v ? '1' : '0'); } catch (e) { /* silently ignored */ }
  };
  const applySummaryCollapsed = (collapsed) => {
    const sec = $('#summarySection');
    const btn = $('#summaryToggle');
    if (sec) {
      try { sec.classList.toggle('collapsed', !!collapsed); } catch (e) { /* silently ignored */ }
    }
    if (btn) {
      try { btn.setAttribute('aria-pressed', collapsed ? 'true' : 'false'); } catch (e) { /* silently ignored */ }
      try { btn.setAttribute('aria-label', collapsed ? '当月サマリを展開する' : '当月サマリを折りたたむ'); } catch (e) { /* silently ignored */ }
    }
  };

  const getAnnualCollapsed = () => {
    try { return localStorage.getItem('monthly.annualCollapsed') === '1'; } catch (e) { return false; }
  };
  const setAnnualCollapsed = (v) => {
    try { localStorage.setItem('monthly.annualCollapsed', v ? '1' : '0'); } catch (e) { /* silently ignored */ }
  };
  const applyAnnualCollapsed = (collapsed) => {
    const sec = $('#annualSection');
    const btn = $('#annualToggle');
    if (sec) {
      try { sec.classList.toggle('collapsed', !!collapsed); } catch (e) { /* silently ignored */ }
    }
    if (btn) {
      try { btn.setAttribute('aria-pressed', collapsed ? 'true' : 'false'); } catch (e) { /* silently ignored */ }
      try { btn.setAttribute('aria-label', collapsed ? '年間サマリを展開する' : '年間サマリを折りたたむ'); } catch (e) { /* silently ignored */ }
    }
  };

  const syncFooterVars = () => {
    try {
      const main = document.querySelector('.kintai-main');
      const bb = document.querySelector('.se-bottombar');
      const page = document.querySelector('.layout-contents') || document.querySelector('.layout-main') || document.querySelector('.se-month');
      const hs = document.querySelector('#monthHScroll');
      if (!bb) return;
      const h = bb.offsetHeight || 0;
      const bottom = parseFloat(getComputedStyle(bb).bottom || '0') || 0;
      const hsVisible = (() => {
        try {
          if (!hs) return false;
          if (hs.hasAttribute('hidden')) return false;
          const cs = getComputedStyle(hs);
          if (cs.display === 'none') return false;
          return true;
        } catch (e) {
          return !!hs && !hs.hasAttribute('hidden');
        }
      })();
      const hsH = hsVisible ? (hs.offsetHeight || 16) : 0;
      const gap = 8;
      const reserved = Math.max(0, h + hsH + gap);
      const pad = Math.max(0, reserved + bottom);
      if (page) page.style.paddingBottom = `${pad}px`;
      if (main) {
        main.style.setProperty('--se-bottom-bar-h', `${reserved}px`);
        main.style.setProperty('--se-bottom-bar-bottom', `${bottom}px`);
        main.style.setProperty('--se-bb-h', `${h}px`);
        main.style.setProperty('--se-hs-h', `${hsH}px`);
      }
    } catch (e) { /* silently ignored */ }
  };

  const syncStickyTop = () => {
    try {
      const top = document.querySelector('.kintai-top');
      const h = top ? Math.max(0, Math.round(top.getBoundingClientRect().height || 0)) : 0;
      document.documentElement.style.setProperty('--se-sticky-top', `${h}px`);
    } catch (e) { /* silently ignored */ }
  };

  const syncTheadRowHeights = () => {
    try {
      const host = document.querySelector('#monthTable');
      const t = host?.querySelector('table');
      const r1 = t?.querySelector('thead tr');
      const h = r1 ? Math.max(0, Math.round(r1.getBoundingClientRect().height || 0)) : 0;
      host?.style.setProperty('--se-thead-row1', `${h}px`);
    } catch (e) { /* silently ignored */ }
  };

  const buildTargetDateSelect = (initialYM) => {
    const sel = document.querySelector('#targetDateSelect');
    if (!sel) return;
    const ym = String(initialYM || monthJST()).slice(0, 7);
    const [y, m] = ym.split('-').map(n => parseInt(n, 10));
    const opts = [];
    for (let i = -18; i <= 6; i++) {
      const dt = new Date(Date.UTC(y, (m - 1) + i, 1));
      const yy = dt.getUTCFullYear();
      const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
      const label = `${yy}年${mm}月`;
      const value = `${yy}${mm}`;
      opts.push({ value, label, ym: `${yy}-${mm}` });
    }
    sel.innerHTML = opts.map(o => `<option value="${o.value}" ${o.ym === ym ? 'selected' : ''}>${o.label}</option>`).join('');
  };

  const canEditForMonth = (ym, profile) => {
    const role = String(profile?.role || '').toLowerCase();
    if (state.currentMonthStatus === 'approved' && role === 'payroll') return false;
    if (state.currentMonthStatus === 'submitted' && role === 'payroll') return false;
    
    // Normalize ym to YYYY-MM
    let tgt = String(ym || '').trim();
    if (/^\d{6}$/.test(tgt)) tgt = tgt.slice(0, 4) + '-' + tgt.slice(4, 6);
    if (!/^\d{4}-\d{2}$/.test(tgt)) return false;

    if (role === 'employee') {
      const cur = String(monthJST() || '').slice(0, 7);
      const y = parseInt(tgt.slice(0, 4), 10);
      const m = parseInt(tgt.slice(5, 7), 10);
      const cy = parseInt(cur.slice(0, 4), 10);
      const cm = parseInt(cur.slice(5, 7), 10);
      const idx = y * 12 + m;
      const cidx = cy * 12 + cm;
      return idx >= cidx;
    }
    const meId = String(profile?.id || '');
    const monthIndexLocal = (s) => {
      let v = String(s || '').slice(0, 7);
      if (/^\d{6}$/.test(v)) v = v.slice(0, 4) + '-' + v.slice(4, 6);
      const parts = v.split('-');
      if (parts.length !== 2) return NaN;
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return NaN;
      return y * 12 + (m - 1);
    };
    const isEditableWindow = (targetYM, aheadMonths) => {
      const base = monthJST();
      const baseIdx = monthIndexLocal(base);
      const targetIdx = monthIndexLocal(targetYM);
      if (!Number.isFinite(baseIdx) || !Number.isFinite(targetIdx)) return false;
      // Allow editing past months (up to 2 months ago) and future months.
      return targetIdx >= (baseIdx - 2) && targetIdx <= (baseIdx + Math.max(0, Number(aheadMonths || 0)));
    };
    if (role === 'admin') return true;
    if (role === 'manager') {
      return isEditableWindow(tgt, 6);
    }
    return isEditableWindow(tgt, 6);
  };

  const applyEditability = (ym) => {
    state.editableMonth = canEditForMonth(ym, ctx.profile);

    const host = document.querySelector('#monthTable');
    if (host) {
      const ctrls = Array.from(host.querySelectorAll('input, select, textarea, button'));
      for (const el of ctrls) {
        const isHistoryBtn = el.matches('button[data-action="history"]');
        if (isHistoryBtn) continue;
        if (state.editableMonth) {
          if (!el.hasAttribute('data-fixed-disabled') && !el.hasAttribute('data-row-disabled')) el.removeAttribute('disabled');
        } else {
          el.setAttribute('disabled', '');
        }
      }
    }

    for (const el of document.querySelectorAll('.saveBtn, #btnSave, #btnSaveBottom')) {
      el.toggleAttribute('disabled', !state.editableMonth);
    }
    for (const el of document.querySelectorAll('.importBtn, #importFile')) {
      el.toggleAttribute('disabled', !state.editableMonth);
    }
    for (const el of document.querySelectorAll('.exportBtn')) {
      el.removeAttribute('disabled');
    }

    if (!state.editableMonth) clearDirty();
  };

  const refreshAddButtons = (host) => {
    if (!host) return;
    const rows = Array.from(host.querySelectorAll('[data-row="1"][data-date]'));
    const counts = new Map();
    for (const r of rows) {
      const d = String(r.dataset.date || '');
      counts.set(d, (counts.get(d) || 0) + 1);
    }
    for (const r of rows) {
      const d = String(r.dataset.date || '');
      const cnt = counts.get(d) || 0;
      const btn = r.querySelector('button[data-action="add"]');
      if (!btn) continue;
      const canAddMore = cnt < 3;
      btn.toggleAttribute('disabled', !state.editableMonth || !canAddMore);
      btn.title = canAddMore ? '行追加' : '1日は最大3件まで';
    }
  };

  const readFastMonthCache = (cacheKey) => {
    try {
      const k = String(cacheKey || '').trim();
      if (!k) return null;
      const raw = localStorage.getItem(`monthly.cache.fast.${k}`) || '';
      if (!raw) return null;
      const obj = JSON.parse(raw); 
      if (!obj || typeof obj !== 'object' || !obj.detail) return null;
      return obj;
    } catch (e) {
      return null;
    }
  };
  const writeFastMonthCache = (cacheKey, payload) => {
    try {
      const k = String(cacheKey || '').trim();
      if (!k || !payload || !payload.detail) return;
      localStorage.setItem(`monthly.cache.fast.${k}`, JSON.stringify({
        detail: payload.detail,
        timesheet: payload.timesheet || null,
        at: Date.now()
      }));
      // Keep one generic fallback for employee self screen across sessions.
      if (k.startsWith('self:')) {
        localStorage.setItem('monthly.cache.fast.self.latest', JSON.stringify({
          key: k,
          ym: String(k.split(':')[1] || ''),
          detail: payload.detail,
          timesheet: payload.timesheet || null,
          at: Date.now()
        }));
      }
    } catch (e) { /* silently ignored */ }
  };

  const renderInstantRightSkeleton = (ym) => {
    try {
      const host = ctx.tableHost;
      if (!host) return;
      const monthLabel = String(ym || '').trim() || monthJST();
      host.innerHTML = `
        <div class="se-month-table-wrap" aria-busy="true">
          <div style="min-width:2300px;border:1px solid #dbe4f0;border-radius:10px;overflow:hidden;background:#fff;">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#0b2c66;color:#fff;font-weight:800;">
              <span>${monthLabel} 読込中</span>
              <span style="opacity:.9;font-weight:700;">月次データを取得しています...</span>
            </div>
            <div style="padding:12px;color:#475569;font-weight:700;">
              データを読み込んでいます...
            </div>
          </div>
        </div>
      `;
    } catch (e) { /* silently ignored */ }
  };

  // 横スクロール対応の「浮遊ヘッダー」— テーブル幅がビューポートより広い場合、
  // .se-month-scroll に overflow-x:auto を付けると（CSS仕様上の制約で）
  // overflow-y も auto 扱いになり、position:sticky の基準祖先が .kintai-main
  // ではなく .se-month-scroll 自身になってしまい、ヘッダーが全く効かなくなる。
  // そのため CSS の sticky には頼らず、実ヘッダーの複製を position:fixed で
  // 独自に追従させることで、縦1本・横1本のスクロールバーのままヘッダー固定を実現する。
  const updateFloatingHead = () => {
    try {
      const floatWrap = window.__seFloatingHeadEl;
      if (!floatWrap) return;
      const wrapEl = document.querySelector('.se-month-scroll');
      const table = wrapEl?.querySelector('#monthTableReal') || wrapEl?.querySelector('table');
      const thead = table?.querySelector('thead');
      if (!wrapEl || !table || !thead) { floatWrap.style.display = 'none'; return; }

      const stickTop = (() => {
        try {
          const v = getComputedStyle(document.documentElement).getPropertyValue('--kintai-top-h').trim();
          const n = parseFloat(v);
          return Number.isFinite(n) ? n : 48;
        } catch (e) { return 48; }
      })();

      // テーブルは再描画のたびに .se-month-scroll ごと作り直されるため、要素インスタンス
      // ごとにスクロール監視を付け直す（一度だけ付けると再描画後は無反応になる）。
      if (wrapEl.dataset.hscrollBound !== '1') {
        wrapEl.dataset.hscrollBound = '1';
        wrapEl.addEventListener('scroll', () => {
          try {
            const ft = floatWrap.querySelector('table');
            if (ft) ft.style.transform = `translateX(${-wrapEl.scrollLeft}px)`;
          } catch (e) { /* silently ignored */ }
        }, { passive: true });
      }

      const theadRect = thead.getBoundingClientRect();
      const wrapRect = wrapEl.getBoundingClientRect();
      const shouldShow = theadRect.top < (stickTop - 1) && wrapRect.bottom > (stickTop + 20);

      if (!shouldShow) {
        floatWrap.style.display = 'none';
        return;
      }

      const realRows = thead.querySelectorAll('tr');
      let clone = floatWrap.querySelector('table');
      if (!clone || floatWrap.dataset.sourceRows !== String(realRows.length)) {
        floatWrap.innerHTML = '';
        clone = document.createElement('table');
        clone.style.cssText = 'border-collapse:collapse; table-layout:fixed; margin:0;';
        clone.appendChild(thead.cloneNode(true));
        floatWrap.appendChild(clone);
        floatWrap.dataset.sourceRows = String(realRows.length);
      }

      try {
        const cloneRows = clone.querySelectorAll('thead tr');
        for (let r = 0; r < realRows.length; r++) {
          const realCells = realRows[r].children;
          const cloneCells = cloneRows[r] ? cloneRows[r].children : [];
          for (let c = 0; c < realCells.length; c++) {
            const w = realCells[c].getBoundingClientRect().width;
            if (cloneCells[c]) {
              cloneCells[c].style.width = w + 'px';
              cloneCells[c].style.minWidth = w + 'px';
              cloneCells[c].style.maxWidth = w + 'px';
              cloneCells[c].style.boxSizing = 'border-box';
              // クローンは元のテーブルから切り離されるため、IDに紐づくCSSが効かず
              // 背景色などが消える。computed styleをそのままコピーして見た目を一致させる。
              try {
                const cs = getComputedStyle(realCells[c]);
                cloneCells[c].style.background = cs.backgroundColor;
                cloneCells[c].style.color = cs.color;
                cloneCells[c].style.fontSize = cs.fontSize;
                cloneCells[c].style.fontWeight = cs.fontWeight;
                cloneCells[c].style.padding = cs.padding;
                cloneCells[c].style.border = cs.border;
                cloneCells[c].style.textAlign = cs.textAlign;
                cloneCells[c].style.verticalAlign = cs.verticalAlign;
                cloneCells[c].style.lineHeight = cs.lineHeight;
                cloneCells[c].style.height = cs.height;
                cloneCells[c].style.position = 'static';
                cloneCells[c].style.boxShadow = 'none';
              } catch (e) { /* silently ignored */ }
            }
          }
        }
      } catch (e) { /* silently ignored */ }

      floatWrap.style.display = '';
      floatWrap.style.top = stickTop + 'px';
      floatWrap.style.left = wrapRect.left + 'px';
      floatWrap.style.width = wrapRect.width + 'px';
      clone.style.transform = `translateX(${-wrapEl.scrollLeft}px)`;
    } catch (e) { /* silently ignored */ }
  };

  const syncMonthHScroll = () => { updateFloatingHead(); };

  const syncMonthVScroll = () => {};

  const wireMonthHScrollVisibility = () => {
    try {
      if (window.__seFloatingHeadWired) { updateFloatingHead(); return; }
      window.__seFloatingHeadWired = true;
      const floatWrap = document.createElement('div');
      floatWrap.id = 'seFloatingHead';
      floatWrap.style.cssText = 'position:fixed; overflow:hidden; z-index:900; display:none; pointer-events:none; box-shadow:0 2px 6px rgba(15,23,42,0.15);';
      document.body.appendChild(floatWrap);
      window.__seFloatingHeadEl = floatWrap;

      const onScroll = () => { try { updateFloatingHead(); } catch (e) { /* silently ignored */ } };
      const main = document.querySelector('.kintai-main');
      if (main) main.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll, { passive: true });
      // 横スクロールの監視は updateFloatingHead 側で、その時点の実際の
      // .se-month-scroll 要素に対して都度付け直す（再描画で要素が入れ替わるため）。
      updateFloatingHead();
    } catch (e) { /* silently ignored */ }
  };

  const wireFooterResize = () => {
    try {
      if (typeof ResizeObserver === 'undefined') return;
      const bb = document.querySelector('.se-bottombar');
      const hs = document.querySelector('#monthHScroll');
      if (!bb && !hs) return;
      const ro = new ResizeObserver(() => {
        try { syncFooterVars(); } catch (e) { /* silently ignored */ }
      });
      if (bb) ro.observe(bb);
      if (hs) ro.observe(hs);
    } catch (e) { /* silently ignored */ }
  };

  const ensureWorkflowUI = () => {
    const role = String(ctx.profile?.role || '').toLowerCase();
    if (role === 'employee') {
      try { document.querySelector('#monthWorkflow')?.remove(); } catch (e) { /* silently ignored */ }
      ctx.wfWrap = null;
      ctx.btnPin = null;
      return;
    }
    const wfHost = document.querySelector('.se-page-head') || document.querySelector('.se-month') || document.body;
    let wfWrap = document.querySelector('#monthWorkflow');
    if (!wfWrap) {
      wfWrap = document.createElement('div');
      wfWrap.id = 'monthWorkflow';
      wfWrap.style.display = 'flex';
      wfWrap.style.alignItems = 'center';
      wfWrap.style.gap = '8px';
      wfWrap.style.flexWrap = 'wrap';
      wfWrap.style.justifyContent = 'flex-end';
      wfWrap.style.marginTop = '6px';
      const btnApprove = document.createElement('button');
      btnApprove.type = 'button';
      btnApprove.id = 'btnApproveMonth';
      btnApprove.className = 'se-mini-btn';
      btnApprove.textContent = '承認';
      const btnUnlock = document.createElement('button');
      btnUnlock.type = 'button';
      btnUnlock.id = 'btnUnlockMonth';
      btnUnlock.className = 'se-mini-btn';
      btnUnlock.textContent = '解除';
      wfWrap.appendChild(btnApprove);
      wfWrap.appendChild(btnUnlock);
      wfHost.appendChild(wfWrap);
    }
    ctx.wfWrap = wfWrap;
    if (!ctx.btnPin) {
      const b = document.querySelector('#btnPinMonthHead') || document.createElement('button');
      b.type = 'button';
      b.id = 'btnPinMonthHead';
      b.className = 'se-mini-btn';
      b.textContent = 'ヘッダー: 下固定';
      b.style.display = 'none';
      b.setAttribute('aria-pressed', 'true');
      wfWrap?.appendChild(b);
      ctx.btnPin = b;
    }
  };

  const applyPinMonthHead = () => {
    const mode = String(ctx.pinMonthHeadMode || 'bottom');
    void mode;
    try {
      const host = document.querySelector('#monthTable');
      if (host) {
        host.classList.remove('pin-month-head-top', 'pin-month-head-bottom');
        host.classList.add('pin-month-head-bottom');
      }
    } catch (e) { /* silently ignored */ }
    try {
      if (!ctx.btnPin) return;
      ctx.btnPin.style.display = 'none';
      ctx.btnPin.setAttribute('aria-pressed', 'true');
    } catch (e) { /* silently ignored */ }
  };

  const updateMonthWorkflowUI = () => {
    const btnApprove = document.querySelector('#btnApproveMonth');
    const btnUnlock = document.querySelector('#btnUnlockMonth');
    const role = String(ctx.profile?.role || '').toLowerCase();
    const status = String(state.currentMonthStatus || 'draft');
    const isAdmin = role === 'admin';
    const isManager = role === 'manager';
    const isSelf = !ctx.actingUserId || String(ctx.actingUserId) === String(ctx.profile?.id || '');
    if (btnApprove) btnApprove.style.display = ((isManager || isAdmin) && !isSelf) ? '' : 'none';
    if (btnUnlock) btnUnlock.style.display = (isAdmin && (status === 'submitted' || status === 'approved')) ? '' : 'none';
    applyPinMonthHead();
  };

  const ensureCompactToggle = () => {
    // Chức năng "コンパクト表示" đã được xóa theo yêu cầu
    return;
  };

  const scheduleAutoSave = () => {
    // Disabled: save only on manual 保存 button press
    return;
    const ym = ctx.picker?.value || '';
    if (!/^\d{4}-\d{2}$/.test(ym)) return;
    try { clearTimeout(ctx.autoSaveTimer); } catch (e) { /* silently ignored */ }
    ctx.autoSaveTimer = setTimeout(async () => {
      if (!state.editableMonth) return;
      if (!ctx.tableHost) return;
      if (ctx.autoSaveInFlight) return;
      try {
        const until = Number(ctx.autoSavePausedUntil || 0);
        if (until && Date.now() < until) return;
      } catch (e) { /* silently ignored */ }
      if (ctx.tableHost.querySelector('.invalid')) return;
      const payload = collectUpdates(ctx.tableHost, ym, ctx.actingUserId || null, { includeAll: true });
      const body = JSON.stringify(payload);
      if (!body || body === ctx.lastAutoSavePayload) return;
      ctx.autoSaveInFlight = true;
      try {
        const r = await fetchJSONAuth('/api/attendance/month/bulk', { method: 'PUT', body }, 120000);
        try {
          const created = Array.isArray(r?.created) ? r.created : [];
          for (const c of created) {
            const cid = String(c?.clientId || '').trim();
            const id = c?.id;
            if (!cid || !id) continue;
            const tr = ctx.tableHost.querySelector(`[data-row="1"][data-client-id="${cssEscape(cid)}"]`);
            if (tr) tr.dataset.id = String(id);
          }
          if (created.length) ctx.lastAutoSavePayload = '';
        } catch (e) { /* silently ignored */ }
        try {
          const dates = new Set();
          for (const d of Array.isArray(payload?.dailyUpdates) ? payload.dailyUpdates : []) {
            const ds = String(d?.date || '').slice(0, 10);
            if (ds) dates.add(ds);
          }
          for (const u of Array.isArray(payload?.updates) ? payload.updates : []) {
            const id = u?.id != null ? String(u.id) : '';
            const cid = String(u?.clientId || '').trim();
            const tr = id ? ctx.tableHost.querySelector(`[data-row="1"][data-id="${cssEscape(id)}"]`)
              : cid ? ctx.tableHost.querySelector(`[data-row="1"][data-client-id="${cssEscape(cid)}"]`)
              : null;
            const ds = tr ? String(tr.dataset.date || '').slice(0, 10) : '';
            if (ds) dates.add(ds);
          }
          for (const ds of dates) {
            const tr = ctx.tableHost.querySelector(`[data-row="1"][data-date="${cssEscape(ds)}"]`);
            if (tr) markRowSaved(tr);
          }
        } catch (e) { /* silently ignored */ }
        ctx.lastAutoSavePayload = body;
        clearDirty();
        try { draft?.clear?.(ctx, ym); } catch (e) { /* silently ignored */ }
      } catch (e) {
        const msg = String(e?.message || '');
        if (msg.includes('Duplicate entry') && msg.includes('unique_user_checkin')) {
          try { draft?.save?.(ctx, ym); } catch (e) { /* silently ignored */ }
          try { ctx.lastAutoSavePayload = body; } catch (e) { /* silently ignored */ }
          try { ctx.autoSavePausedUntil = Date.now() + 15000; } catch (e) { /* silently ignored */ }
          showErr('保存が競合しています。少し待ってから再度お試しください。');
        } else {
          showErr(msg || '保存に失敗しました');
        }
      } finally {
        ctx.autoSaveInFlight = false;
      }
    }, 900);
  };

  const setMonth = async (ym, replace = false, opts = {}) => {
    if (!(ctx.monthCache instanceof Map)) ctx.monthCache = new Map();
    const reqSeq = (ctx.monthReqSeq = Number(ctx.monthReqSeq || 0) + 1);
    const cacheKey = `${String(ctx.actingUserId || 'self')}:${String(ym || '')}`;
    
    // Bypass cache when forcing reload (e.g. from shift assignment or explicit refresh)
    const forceReload = opts?.forceReload === true;
    if (forceReload) {
      ctx.monthCache.delete(cacheKey);
      try {
        sessionStorage.removeItem(`monthly.cache.${cacheKey}`);
        localStorage.removeItem(`monthly.cache.fast.${cacheKey}`);
      } catch (e) {}
    }

    state.currentYM = String(ym || '').slice(0, 7);
    const url = new URL(window.location.href);
    url.searchParams.set('month', ym);
    try {
      if (replace) history.replaceState(null, '', url.pathname + url.search + url.hash);
      else history.pushState(null, '', url.pathname + url.search + url.hash);
    } catch (e) { /* silently ignored */ }
    if (ctx.picker1) ctx.picker1.value = ym;
    if (ctx.picker2) ctx.picker2.value = ym;
    showErr('');
    const cached = ctx.monthCache.get(cacheKey) || null;
    let persisted = null;
    if (!cached) {
      try {
        const raw = sessionStorage.getItem(`monthly.cache.${cacheKey}`);
        if (raw) persisted = JSON.parse(raw);
      } catch (e) { /* silently ignored */ }
      if (!persisted) {
        persisted = readFastMonthCache(cacheKey);
      }
      if (!persisted && !String(ctx.actingUserId || '')) {
        try {
          const latestRaw = localStorage.getItem('monthly.cache.fast.self.latest') || '';
          const latest = latestRaw ? JSON.parse(latestRaw) : null;
          if (latest && latest.detail && String(latest.ym || '') === String(ym || '')) persisted = latest;
        } catch (e) { /* silently ignored */ }
      }
    }
    let latestFast = null;
    if (!cached && !persisted && !String(ctx.actingUserId || '')) {
      try {
        const latestRaw = localStorage.getItem('monthly.cache.fast.self.latest') || '';
        const latest = latestRaw ? JSON.parse(latestRaw) : null;
        if (latest && latest.detail) latestFast = latest;
      } catch (e) { /* silently ignored */ }
    }
    const instant = cached || persisted || latestFast;
    if (!instant?.detail) {
      try { renderInstantRightSkeleton(ym); } catch (e) { /* silently ignored */ }
    }
    const useSpinner = opts?.spinner !== false && !instant;
    if (useSpinner) showSpinner();
    try {
      if (ctx.role !== 'employee' && !ctx.actingUserId) {
        // Hide admin's own data until an employee is selected
        state.currentMonthDetail = null;
        state.currentMonthTimesheet = null;
        try {
          if ($('#empCode')) $('#empCode').textContent = '—';
          if ($('#staffName')) $('#staffName').textContent = '—';
          if ($('#officeCode')) $('#officeCode').textContent = '—';
          if ($('#empDept')) $('#empDept').textContent = '—';
        } catch (e) { /* silently ignored */ }
        try { renderContract(ctx.contractHost, null); } catch (e) { /* silently ignored */ }
        try { renderWorkDetail(ctx.workDetailHost, null, ctx.profile); } catch (e) { /* silently ignored */ }
        try { renderSummary(ctx.summaryHost, null, null); } catch (e) { /* silently ignored */ }
        try { renderTable(ctx.tableHost, null, ctx.profile); } catch (e) { /* silently ignored */ }
        return;
      }

      const [y, m] = String(ym).split('-').map(x => parseInt(x, 10));
      const uidQ = ctx.actingUserId ? `&userId=${encodeURIComponent(ctx.actingUserId)}` : '';
      if (instant?.detail && !forceReload) {
        state.currentMonthDetail = instant.detail;
        state.currentMonthTimesheet = instant.timesheet || null;
        try {
          const st = String(instant.detail?.monthStatus?.status || '').trim();
          state.currentMonthStatus = st || 'draft';
        } catch (e) {
          state.currentMonthStatus = 'draft';
        }
        renderContract(ctx.contractHost, instant.detail);
        renderWorkDetail(ctx.workDetailHost, instant.detail, ctx.profile);
        renderSummary(ctx.summaryHost, instant.detail, instant.timesheet || null);
        // 年間サマリ (instant)
        try {
          const yearHost = document.querySelector('#yearSummaryTable');
          if (yearHost) renderYearSummary(yearHost, { userId: state.currentViewingUserId, month: ym });
        } catch (e) { /* silently ignored */ }
        state.editableMonth = canEditForMonth(ym, ctx.profile);
        renderTable(ctx.tableHost, instant.detail, ctx.profile);
        applyPinMonthHead();
        applyEditability(ym);
        updateMonthWorkflowUI();
        ensureCompactToggle();
        syncFooterVars();
        syncTheadRowHeights();
        syncMonthHScroll();
        syncMonthVScroll();
      }
      const detail = await fetchJSONAuth(`/api/attendance/month/detail?year=${encodeURIComponent(y)}&month=${encodeURIComponent(m)}${uidQ}`);
      if (reqSeq !== ctx.monthReqSeq) return;
      ctx.monthCache.set(cacheKey, { detail, timesheet: null, at: Date.now() });
      try {
        sessionStorage.setItem(`monthly.cache.${cacheKey}`, JSON.stringify({ detail, timesheet: null, at: Date.now() }));
      } catch (e) { /* silently ignored */ }
      writeFastMonthCache(cacheKey, { detail, timesheet: null });
      state.currentMonthDetail = detail;
      state.currentMonthTimesheet = null;
      try {
        const st = String(detail?.monthStatus?.status || '').trim();
        state.currentMonthStatus = st || 'draft';
      } catch (e) {
        state.currentMonthStatus = 'draft';
      }
      try {
        const u2 = detail?.user || null;
        if (u2) {
          const code = u2.employee_code || u2.employeeCode || (u2.id ? ('EMP' + String(u2.id).padStart(3, '0')) : '');
          if ($('#empCode')) $('#empCode').textContent = code || '—';
          if ($('#staffName')) $('#staffName').textContent = u2.username || u2.email || '—';
          const officeCode = u2.office_code || u2.officeCode || ' ';
          if ($('#officeCode')) $('#officeCode').textContent = String(officeCode || '').trim() || '—';
          if ($('#empDept')) $('#empDept').textContent = u2.departmentName || '—';
        }
      } catch (e) { /* silently ignored */ }
      renderContract(ctx.contractHost, detail);
      renderWorkDetail(ctx.workDetailHost, detail, ctx.profile);
      renderSummary(ctx.summaryHost, detail, null);
      
      // 年間サマリ
      try {
        const yearHost = document.querySelector('#yearSummaryTable');
        if (yearHost) renderYearSummary(yearHost, { userId: state.currentViewingUserId, month: ym });
      } catch (e) { /* silently ignored */ }
      
      // Update editability BEFORE rendering table to ensure correct lock state
      state.editableMonth = canEditForMonth(ym, ctx.profile);
      
      renderTable(ctx.tableHost, detail, ctx.profile);
      applyPinMonthHead();
      applyEditability(ym);
      updateMonthWorkflowUI();
      ensureCompactToggle();
      try { draft?.restore?.(ctx, ym); } catch (e) { /* silently ignored */ }
      try {
        const role = String(ctx.profile?.role || '').toLowerCase();
        const lockedMsg = state.currentMonthStatus === 'submitted'
          ? 'この月は提出済のため編集できません。'
          : (state.currentMonthStatus === 'approved' ? 'この月は締め済のため編集できません。' : '');
        if (!state.editableMonth && lockedMsg) showErr(lockedMsg);
        else showErr('');
      } catch (e) { /* silently ignored */ }
      syncFooterVars();
      syncTheadRowHeights();
      syncMonthHScroll();
      syncMonthVScroll();
      wireMonthHScrollVisibility();
      ctx.lastAutoSavePayload = '';
      if (typeof ctx.applyContractTab === 'function') ctx.applyContractTab();
      if (typeof ctx.applySummaryTab === 'function') ctx.applySummaryTab();
      if (typeof ctx.applyPlanTab === 'function') ctx.applyPlanTab();

      // Load heavy monthly timesheet summary in background so table appears instantly.
      fetchJSONAuth(`/api/attendance/month?year=${encodeURIComponent(y)}&month=${encodeURIComponent(m)}${uidQ}`)
        .then((timesheet) => {
          if (reqSeq !== ctx.monthReqSeq) return;
          state.currentMonthTimesheet = timesheet || null;
          try {
            const nextCache = { detail: state.currentMonthDetail, timesheet: state.currentMonthTimesheet, at: Date.now() };
            ctx.monthCache.set(cacheKey, nextCache);
            sessionStorage.setItem(`monthly.cache.${cacheKey}`, JSON.stringify(nextCache));
            writeFastMonthCache(cacheKey, nextCache);
          } catch (e) { /* silently ignored */ }
          try { renderSummary(ctx.summaryHost, state.currentMonthDetail, state.currentMonthTimesheet); } catch (e) { /* silently ignored */ }
        })
        .catch(() => {});
      // Prefetch adjacent months for instant prev/next navigation.
      const prefetch = async (targetYm) => {
        try {
          const k = `${String(ctx.actingUserId || 'self')}:${String(targetYm || '')}`;
          if (ctx.monthCache.has(k)) return;
          const [py, pm] = String(targetYm).split('-').map(x => parseInt(x, 10));
          if (!py || !pm) return;
          const pDetail = await fetchJSONAuth(`/api/attendance/month/detail?year=${encodeURIComponent(py)}&month=${encodeURIComponent(pm)}${uidQ}`);
          ctx.monthCache.set(k, { detail: pDetail, timesheet: null, at: Date.now() });
        } catch (e) { /* silently ignored */ }
      };
      void prefetch(addMonths(ym, -1));
      void prefetch(addMonths(ym, 1));
    } catch (e) {
      showErr(e?.message || '読み込みに失敗しました');
    } finally {
      if (useSpinner) hideSpinner();
    }
  };

  const saveManual = async () => {
    if (!state.editableMonth) {
      alert('この月は入力できません。');
      return;
    }
    const ym = ctx.picker?.value || ctx.initialYM;
    if (!/^\d{4}-\d{2}$/.test(ym)) return;
    showErr('');
    try {
      try {
        const ae = document.activeElement;
        const row = ae?.closest?.('[data-row="1"][data-date]');
        try { ae?.blur?.(); } catch (e) { /* silently ignored */ }
        if (row) {
          row.dataset.dirty = '1';
          try {
            const sel = row.querySelector('select[data-field="classification"]');
            const v = String(sel?.value || '').trim();
            if (v) row.dataset.kubunConfirmed = '1';
          } catch (e) { /* silently ignored */ }
          try { root.Render?.recomputeRow?.(row); } catch (e) { /* silently ignored */ }
        }
      } catch (e) { /* silently ignored */ }
      try {
        const rows = Array.from(ctx.tableHost?.querySelectorAll?.('[data-row="1"][data-date]') || []);
        for (const tr of rows) {
          if (String(tr.dataset.dirty || '') === '1') continue;
          const sel = tr.querySelector('select[data-field="classification"]');
          const v = String(sel?.value || '').trim();
          const inEl = tr.querySelector('input.se-time[data-field="checkIn"]');
          const outEl = tr.querySelector('input.se-time[data-field="checkOut"]');
          const inV = String(inEl?.value || '').trim();
          const outV = String(outEl?.value || '').trim();
          const inAuto = String(inEl?.dataset?.auto || '') === '1';
          const outAuto = String(outEl?.dataset?.auto || '') === '1';
          const clearFlag = String(tr.dataset.clear || '') === '1';
          const meaningful = clearFlag || !!v || (!!inV && !inAuto) || (!!outV && !outAuto);
          if (!meaningful) continue;
          tr.dataset.dirty = '1';
          if (v) tr.dataset.kubunConfirmed = '1';
        }
      } catch (e) { /* silently ignored */ }
      // Keep auto planned times as virtual hints.
      // They must not be converted to "actual" just because user presses save.
      try {
        const rows = Array.from(ctx.tableHost?.querySelectorAll?.('[data-row="1"][data-date]') || []);
        for (const tr of rows) {
          const inEl = tr.querySelector('input.se-time[data-field="checkIn"]');
          const outEl = tr.querySelector('input.se-time[data-field="checkOut"]');
          try { inEl?.classList?.remove('invalid'); } catch (e) { /* silently ignored */ }
          try { outEl?.classList?.remove('invalid'); } catch (e) { /* silently ignored */ }
          const inAuto = String(inEl?.dataset?.auto || '') === '1';
          const outAuto = String(outEl?.dataset?.auto || '') === '1';
          const inV = inAuto ? '' : String(inEl?.value || '').trim();
          const outV = outAuto ? '' : String(outEl?.value || '').trim();
          const idRaw = String(tr.dataset.id || '').trim();
          const clearFlag = String(tr.dataset.clear || '') === '1';
          if (outV && !inV) {
            try { inEl?.classList?.add('invalid'); } catch (e) { /* silently ignored */ }
            try { outEl?.classList?.add('invalid'); } catch (e) { /* silently ignored */ }
          }
          if (idRaw && !clearFlag && !inV && !outV) {
            tr.dataset.clear = '1';
            tr.dataset.dirty = '1';
          }
        }
      } catch (e) { /* silently ignored */ }
      if (ctx.tableHost && ctx.tableHost.querySelector('.invalid')) {
        showErr('入力内容を確認してください（赤枠の項目）');
        throw new Error('入力内容を確認してください（赤枠の項目）');
      }
      showSpinner('save');
      const payload = collectUpdates(ctx.tableHost, ym, ctx.actingUserId || null, { includeAll: true });
      try {
        const days = Array.isArray(state.currentMonthDetail?.days) ? state.currentMonthDetail.days : [];
        const findSegId = (checkInDt) => {
          const dt = String(checkInDt || '');
          const ds = dt.slice(0, 10);
          if (!ds) return null;
          const day = days.find(d => String(d?.date || '').slice(0, 10) === ds);
          const segs = Array.isArray(day?.segments) ? day.segments : [];
          const hit = segs.find(s => String(s?.checkIn || '') === dt);
          return hit?.id != null ? Number(hit.id) : null;
        };
        for (const u of Array.isArray(payload?.updates) ? payload.updates : []) {
          if (u?.id) continue;
          if (!u?.checkIn) continue;
          const existingId = findSegId(u.checkIn);
          if (!existingId) continue;
          u.id = existingId;
          delete u.clientId;
        }
      } catch (e) { /* silently ignored */ }
      const body = JSON.stringify(payload);
      const savedDates = new Set();
      try {
        for (const d of Array.isArray(payload?.dailyUpdates) ? payload.dailyUpdates : []) {
          const ds = String(d?.date || '').slice(0, 10);
          if (ds) savedDates.add(ds);
        }
        for (const u of Array.isArray(payload?.updates) ? payload.updates : []) {
          const id = u?.id != null ? String(u.id) : '';
          const cid = String(u?.clientId || '').trim();
          const tr = id ? ctx.tableHost.querySelector(`[data-row="1"][data-id="${cssEscape(id)}"]`)
            : cid ? ctx.tableHost.querySelector(`[data-row="1"][data-client-id="${cssEscape(cid)}"]`)
            : null;
          const ds = tr ? String(tr.dataset.date || '').slice(0, 10) : '';
          if (ds) savedDates.add(ds);
        }
      } catch (e) { /* silently ignored */ }
      let r = null;
      try {
        r = await fetchJSONAuth('/api/attendance/month/bulk', { method: 'PUT', body }, 120000);
      } catch (e) {
        const msg = String(e?.message || '');
        if (msg.includes('Duplicate entry') && msg.includes('unique_user_checkin')) {
          try { draft?.save?.(ctx, ym); } catch (e) { /* silently ignored */ }
          const now = Date.now();
          const last = Number(ctx._dupRetryAt || 0);
          if (now - last > 5000) {
            ctx._dupRetryAt = now;
            try {
              const { detail } = await loadMonth(ym, ctx.actingUserId || null);
              if (detail) state.currentMonthDetail = detail;
              try {
                const map = new Map();
                const days = Array.isArray(detail?.days) ? detail.days : [];
                for (const d of days) {
                  for (const s of (Array.isArray(d?.segments) ? d.segments : [])) {
                    const ci = String(s?.checkIn || '');
                    const id = s?.id != null ? Number(s.id) : null;
                    if (ci && id) map.set(ci, id);
                  }
                }
                for (const u of Array.isArray(payload?.updates) ? payload.updates : []) {
                  if (!u || u.id || !u.checkIn) continue;
                  const id = map.get(String(u.checkIn));
                  if (!id) continue;
                  u.id = id;
                  delete u.clientId;
                  const ds = String(u.checkIn).slice(0, 10);
                  const hm = String(u.checkIn).slice(11, 16);
                  const tr = ctx.tableHost?.querySelector?.(`[data-row="1"][data-date="${cssEscape(ds)}"]`);
                  const inEl = tr?.querySelector?.('input.se-time[data-field="checkIn"]');
                  if (tr && inEl && String(inEl.value || '') === hm) {
                    tr.dataset.id = String(id);
                    tr.dataset.clientId = '';
                  }
                }
              } catch (e) { /* silently ignored */ }
              const body2 = JSON.stringify(payload);
              r = await fetchJSONAuth('/api/attendance/month/bulk', { method: 'PUT', body: body2 }, 120000);
              if (r && r.ok === false) throw new Error(String(r?.message || '保存に失敗しました'));
              showErr('');
            } catch (e) {
              throw e;
            }
          } else {
            throw e;
          }
        } else {
          throw e;
        }
      }
      if (r && r.ok === false) {
        const msg = String(r?.message || '保存に失敗しました');
        throw new Error(msg);
      }
      try {
        const created = Array.isArray(r?.created) ? r.created : [];
        for (const c of created) {
          const cid = String(c?.clientId || '').trim();
          const id = c?.id;
          if (!cid || !id) continue;
          const tr = ctx.tableHost.querySelector(`[data-row="1"][data-client-id="${cssEscape(cid)}"]`);
          if (tr) tr.dataset.id = String(id);
        }
      } catch (e) { /* silently ignored */ }
      try {
        const days = Array.isArray(state.currentMonthDetail?.days) ? state.currentMonthDetail.days : [];
        const updates0 = Array.isArray(payload?.updates) ? payload.updates : [];
        const created0 = Array.isArray(r?.created) ? r.created : [];
        const createdByCid = new Map(created0.map(c => [String(c?.clientId || '').trim(), c]));
        const getDay = (ds) => days.find(d => String(d?.date || '').slice(0, 10) === String(ds || '').slice(0, 10));
        const ensureSegList = (day) => {
          if (!day) return null;
          if (!Array.isArray(day.segments)) day.segments = [];
          return day.segments;
        };
        const updateRowVisual = (tr) => {
          if (!tr) return;
          const inEl = tr.querySelector('input.se-time[data-field="checkIn"]');
    const outEl = tr.querySelector('input.se-time[data-field="checkOut"]');
        };
        for (const u of updates0) {
          const id = u?.id != null ? String(u.id) : '';
          const cid = String(u?.clientId || '').trim();
          const tr = id
            ? ctx.tableHost.querySelector(`[data-row="1"][data-id="${cssEscape(id)}"]`)
            : cid
              ? ctx.tableHost.querySelector(`[data-row="1"][data-client-id="${cssEscape(cid)}"]`)
              : null;
          const ds = tr ? String(tr.dataset.date || '').slice(0, 10) : String(u?.checkIn || u?.checkOut || '').slice(0, 10);
          const day = getDay(ds);
          const segs = ensureSegList(day);
          if (!segs) continue;
          if (id) {
            if (u.delete === true) {
              const idx = segs.findIndex(s => String(s?.id || '') === id);
              if (idx !== -1) segs.splice(idx, 1);
              if (tr && String(tr.dataset.id || '') === id) {
                tr.dataset.id = '';
              }
            } else {
              const seg = segs.find(s => String(s?.id || '') === id);
              if (seg) {
                if (u.checkIn != null) seg.checkIn = u.checkIn;
                if (Object.prototype.hasOwnProperty.call(u, 'checkOut')) seg.checkOut = u.checkOut;
                if (Object.prototype.hasOwnProperty.call(u, 'workType')) seg.workType = u.workType;
              } else {
                segs.push({ id: u.id, checkIn: u.checkIn || null, checkOut: u.checkOut || null, workType: u.workType || null });
              }
              updateRowVisual(tr);
            }
          } else if (cid) {
            const c = createdByCid.get(cid);
            const newId = c?.id != null ? String(c.id) : '';
            if (tr && newId) tr.dataset.id = newId;
            if (newId) {
              const exists = segs.some(s => String(s?.id || '') === newId);
              if (!exists) {
                segs.push({
                  id: c.id,
                  checkIn: c.checkIn || u.checkIn || null,
                  checkOut: c.checkOut || u.checkOut || null,
                  workType: c.workType || u.workType || null
                });
              }
              updateRowVisual(tr);
            }
          }
        }
      } catch (e) { /* silently ignored */ }
      try {
        for (const ds of savedDates) {
          const tr = ctx.tableHost.querySelector(`[data-row="1"][data-date="${cssEscape(ds)}"]`);
          if (tr) {
            markRowSaved(tr);
            try { tr.dataset.clear = ''; } catch (e) { /* silently ignored */ }
            try {
              const days = Array.isArray(state.currentMonthDetail?.days) ? state.currentMonthDetail.days : [];
              const day = days.find(d => String(d?.date || '').slice(0,10) === ds);
              if (day) {
                const sel = tr.querySelector('select[data-field="classification"]');
                const v = String(sel?.value || '').trim();
                day.daily = day.daily || {};
                day.daily.kubun = v || null;
                day.daily.kubunConfirmed = v ? 1 : 0;
                const wt = (tr.querySelector('input[data-field="ckOnsite"]')?.checked ? 'onsite'
                  : tr.querySelector('input[data-field="ckRemote"]')?.checked ? 'remote'
                  : tr.querySelector('input[data-field="ckSatellite"]')?.checked ? 'satellite'
                  : String(tr.dataset.workType || '')).trim() || null;
                day.daily.workType = wt;
                const loc = tr.querySelector('input[data-field="location"]')?.value ?? '';
                const memo = tr.querySelector('[data-field="memo"]')?.value ?? '';
                const notes = tr.querySelector('input[data-field="notes"]')?.value ?? '';
                const reason = tr.querySelector('select[data-field="reason"]')?.value ?? '';
                day.daily.location = String(loc || '').trim();
                day.daily.memo = String(memo || '').trim();
                day.daily.notes = String(notes || '').trim();
                day.daily.reason = String(reason || '').trim();
                const br = String(tr.querySelector('select[data-field="break"]')?.value || '1:00');
                const nb = String(tr.querySelector('select[data-field="nightBreak"]')?.value || '0:00');
                day.daily.breakMinutes = (() => { const p = br.split(':'); return p.length === 2 ? (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0) : 60; })();
                day.daily.nightBreakMinutes = (() => { const p = nb.split(':'); return p.length === 2 ? (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0) : 0; })();
                try {
                  tr.dataset.kubunBase = v || '';
                  tr.dataset.workTypeBase = wt || '';
                  tr.dataset.locationBase = String(loc || '');
                  tr.dataset.memoBase = String(memo || '');
                  tr.dataset.notesBase = String(notes || '');
                  tr.dataset.reasonBase = String(reason || '');
                  tr.dataset.breakBase = br;
                  tr.dataset.nightBreakBase = nb;
                } catch (e) { /* silently ignored */ }
              }
            } catch (e) { /* silently ignored */ }
            try { root.Render?.recomputeRow?.(tr); } catch (e) { /* silently ignored */ }
          }
        }
      } catch (e) { /* silently ignored */ }
      try { ctx.lastAutoSavePayload = body; } catch (e) { /* silently ignored */ }
      clearDirty();
      try { draft?.clear?.(ctx, ym); } catch (e) { /* silently ignored */ }
      const s = r?.saved || {};
      const daily = Number(s?.daily || 0);
      const created = Number(s?.segmentsCreated || 0);
      const updated = Number(s?.segmentsUpdated || 0);
      const n = daily + created + updated;
      const intent = (() => {
        try {
          const p = JSON.parse(body || '{}');
          const du = Array.isArray(p?.dailyUpdates) ? p.dailyUpdates : [];
          const up = Array.isArray(p?.updates) ? p.updates : [];
          const dHas = du.some(d => {
            if (!d) return false;
            return (typeof d.kubun === 'string' && d.kubun !== '') ||
                   Object.prototype.hasOwnProperty.call(d, 'kubunConfirmed') ||
                   (typeof d.workType === 'string' && d.workType !== '') ||
                   (d.location && d.location !== '') || (d.memo && d.memo !== '') || (d.reason && d.reason !== '') ||
                   d.breakMinutes != null || d.nightBreakMinutes != null;
          });
          return dHas || up.length > 0;
        } catch (e) { return false; }
      })();
      if (n <= 0 && intent) throw new Error('保存対象がありません。入力内容を確認してください。');
      // Đã gỡ bỏ alert theo yêu cầu người dùng
      if (n > 0 && root.Core?.showToast) {
        root.Core.showToast(`保存しました（daily:${daily}, seg+${created}, seg更新:${updated}）`, 'success');
      }
      
      // Update summary section locally
      renderSummary(ctx.summaryHost, state.currentMonthDetail, state.currentMonthTimesheet);
      
      // Sync salary in background so Save returns immediately.
      // 給与同期は管理者・マネージャーのみ許可（従業員が呼ぶと 403 になるためスキップ）。
      try {
        const role = String(ctx.profile?.role || ctx.role || '').toLowerCase();
        if (role === 'admin' || role === 'manager') {
          const [y, m] = ym.split('-');
          fetchJSONAuth('/api/attendance/month/sync-salary', {
            method: 'POST',
            body: JSON.stringify({ year: y, month: m, userId: ctx.actingUserId || null })
          }).catch((e) => {
            try { console.error('Salary sync failed:', e); } catch (e) { /* silently ignored */ }
          });
        }
      } catch (e) { /* silently ignored */ }
    } catch (e) {
      const msg = String(e?.message || '');
      if (msg.includes('Duplicate entry') && msg.includes('unique_user_checkin')) {
        showErr('保存が競合しています。少し待ってから再度お試しください。');
      } else {
        showErr(msg || '保存に失敗しました');
      }
      throw e;
    } finally {
      hideSpinner();
    }
  };

  const saveRowNow = async (tr) => {
    const ym = ctx.picker?.value || ctx.initialYM;
    if (!/^\d{4}-\d{2}$/.test(ym)) return;
    if (!tr) return;
    if (ctx.autoSaveInFlight) return;
    showErr('');
    try {
      ctx.autoSaveInFlight = true;
      const [y, m] = String(ym).split('-').map(x => parseInt(x, 10));
      const dateStr = String(tr.dataset.date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return;
      const kubunVal = String(tr.querySelector('select[data-field="classification"]')?.value || '').trim();
      const kubunConfirmed = String(tr.dataset.kubunConfirmed || '') === '1' ? 1 : 0;
      const wt = (tr.querySelector('input[data-field="ckOnsite"]')?.checked ? 'onsite'
        : tr.querySelector('input[data-field="ckRemote"]')?.checked ? 'remote'
        : tr.querySelector('input[data-field="ckSatellite"]')?.checked ? 'satellite'
        : String(tr.dataset.workType || '')).trim();
      const loc = String(tr.querySelector('input[data-field="location"]')?.value || '').trim();
      const reason = String(tr.querySelector('select[data-field="reason"]')?.value || '').trim();
      const memo = String(tr.querySelector('[data-field="memo"]')?.value || '').trim();
      const notes = String(tr.querySelector('input[data-field="notes"]')?.value || '').trim();
      const br = String(tr.querySelector('select[data-field="break"]')?.value || '1:00');
      const nb = String(tr.querySelector('select[data-field="nightBreak"]')?.value || '0:00');
      const breakMinutes = (() => { const p = br.split(':'); return p.length === 2 ? (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0) : 60; })();
      const nightBreakMinutes = (() => { const p = nb.split(':'); return p.length === 2 ? (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0) : 0; })();
      const payload = {
        year: y, month: m, userId: ctx.actingUserId || undefined,
        updates: [],
        dailyUpdates: [{
          date: dateStr,
          kubun: kubunVal,
          kubunConfirmed,
          workType: (wt === 'onsite' || wt === 'remote' || wt === 'satellite') ? wt : null,
          location: loc,
          reason,
          memo,
          notes,
          breakMinutes,
          nightBreakMinutes
        }]
      };
      const r = await fetchJSONAuth('/api/attendance/month/bulk', { method: 'PUT', body: JSON.stringify(payload) }, 120000);
      if (r && r.ok === false) {
        const msg = String(r?.message || '保存に失敗しました');
        throw new Error(msg);
      }
      markRowSaved(tr);
      try { draft?.clear?.(ctx, ym); } catch (e) { /* silently ignored */ }
      try {
        const days = Array.isArray(state.currentMonthDetail?.days) ? state.currentMonthDetail.days : [];
        const day = days.find(d => String(d?.date || '').slice(0,10) === dateStr);
        if (day) {
          day.daily = day.daily || {};
          day.daily.kubun = kubunVal || null;
          day.daily.kubunConfirmed = kubunVal ? 1 : 0;
          day.daily.workType = (wt === 'onsite' || wt === 'remote' || wt === 'satellite') ? wt : null;
          day.daily.location = loc;
          day.daily.reason = reason;
          day.daily.memo = memo;
          day.daily.notes = notes;
          day.daily.breakMinutes = breakMinutes;
          day.daily.nightBreakMinutes = nightBreakMinutes;
        }
        try {
          tr.dataset.kubunBase = kubunVal || '';
          tr.dataset.workTypeBase = (wt === 'onsite' || wt === 'remote' || wt === 'satellite') ? wt : '';
          tr.dataset.locationBase = loc || '';
          tr.dataset.reasonBase = reason || '';
          tr.dataset.memoBase = memo || '';
          tr.dataset.notesBase = notes || '';
          tr.dataset.breakBase = (br === '0:45' || br === '0:30' || br === '0:00') ? br : '1:00';
          tr.dataset.nightBreakBase = (nb === '1:00' || nb === '0:30') ? nb : '0:00';
        } catch (e) { /* silently ignored */ }
      } catch (e) { /* silently ignored */ }
      try { root.Render?.recomputeRow?.(tr); } catch (e) { /* silently ignored */ }
    } catch (e) {
      showErr(e?.message || '保存に失敗しました');
    } finally {
      ctx.autoSaveInFlight = false;
    }
  };

  const saveRowTimesNow = async (tr) => {
    const ym = ctx.picker?.value || ctx.initialYM;
    if (!/^\d{4}-\d{2}$/.test(ym)) return;
    if (!tr) return;
    
    // Thay vì return ngay, chúng ta đợi một chút nếu đang có save khác (Ưu tiên 1 - Chống Race Condition)
    if (ctx.autoSaveInFlight) {
      setTimeout(() => saveRowTimesNow(tr), 200);
      return;
    }
    
    showErr('');
    try {
      ctx.autoSaveInFlight = true;
      const core = root.Core || {};
      const toDateTime = core.toDateTime;
      const addDaysISO = core.addDaysISO;
      const parseHm = core.parseHm;
      const [y, m] = String(ym).split('-').map(x => parseInt(x, 10));
      const dateStr = String(tr.dataset.date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return;
      const inEl = tr.querySelector('input.se-time[data-field="checkIn"]');
      const outEl = tr.querySelector('input.se-time[data-field="checkOut"]');
      
      const effTime = (el) => {
        const v = String(el?.value || '').trim();
        const isAuto = String(el?.dataset?.auto || '') === '1';
        if (isAuto) return '';
        return v;
      };
      
      // Đảm bảo lấy giá trị mới nhất từ DOM ngay lúc này, bỏ qua giá trị auto-planned
      const rawIn = effTime(inEl);
      const rawOut = effTime(outEl);
      
      const inDt = rawIn && toDateTime ? toDateTime(dateStr, rawIn) : null;
      let outDt = rawOut && toDateTime ? toDateTime(dateStr, rawOut) : null;
      
      if (outDt && parseHm) {
        const a = parseHm(rawIn);
        const b = parseHm(rawOut);
        if (a != null && b != null && b < a && addDaysISO && toDateTime) {
          outDt = toDateTime(addDaysISO(dateStr, 1), rawOut);
        }
      }
      const sel = tr.querySelector('select[data-field="classification"]');
      const v = String(sel?.value || '').trim();
      const rowBaseOff = String(tr.dataset.baseOff || '') === '1';
      
      const wtRaw = (tr.querySelector('input[data-field="ckOnsite"]')?.checked ? 'onsite'
        : tr.querySelector('input[data-field="ckRemote"]')?.checked ? 'remote'
        : tr.querySelector('input[data-field="ckSatellite"]')?.checked ? 'satellite'
        : String(tr.dataset.workType || '')).trim();
      const reasonRaw = String(tr.querySelector('select[data-field="reason"]')?.value || '').trim();
      const locationRaw = String(tr.querySelector('input[data-field="location"]')?.value || '').trim();
      const memoRaw = String(tr.querySelector('[data-field="memo"]')?.value || '').trim();
      const notesRaw = String(tr.querySelector('input[data-field="notes"]')?.value || '').trim();
      
      const hasDailyInput = !!(v || wtRaw || reasonRaw); // Bỏ qua locationRaw và memoRaw để không tự nhảy 出勤 khi gõ text
      const hasTimeInput = !!(rawIn || rawOut);
      const effectiveKubun = v || ((hasTimeInput || hasDailyInput) ? (rowBaseOff ? '休日出勤' : '出勤') : '');
      const isHoliday = effectiveKubun === '休日' || effectiveKubun === '代替休日' || effectiveKubun === '無給休暇' || effectiveKubun === '有給休暇' || effectiveKubun === '欠勤';
      
      // ĐẢM BẢO KHÔNG MẤT DỮ LIỆU KHI CHỌN 欠勤
      // Khi là ngày nghỉ, lấy dữ liệu backup hoặc lấy chính cái hiện tại trên DOM (nếu nó bị ẩn chứ không bị xóa trắng)
      const wt = isHoliday ? (tr.dataset.workTypeBackup || tr.dataset.workTypeBase || wtRaw || tr.dataset.workType || '') : wtRaw;
      const reason = reasonRaw;
      const location = isHoliday ? (tr.dataset.locBackup || tr.dataset.locationBase || locationRaw || String(tr.querySelector('input[data-field="location"]')?.value || '')) : locationRaw;
      const memo = isHoliday ? (tr.dataset.memoBackup || tr.dataset.memoBase || memoRaw || String(tr.querySelector('[data-field="memo"]')?.value || '')) : memoRaw;
      const notes = isHoliday ? (tr.dataset.notesBackup || tr.dataset.notesBase || notesRaw || String(tr.querySelector('input[data-field="notes"]')?.value || '')) : notesRaw;
      
      const br = String(tr.querySelector('select[data-field="break"]')?.value || '1:00');
      const nb = String(tr.querySelector('select[data-field="nightBreak"]')?.value || '0:00');
      const breakMinutes = (() => { const p = br.split(':'); return p.length === 2 ? (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0) : 60; })();
      const nightBreakMinutes = (() => { const p = nb.split(':'); return p.length === 2 ? (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0) : 0; })();
      
      const idRaw = String(tr.dataset.id || '').trim();
      let clientId = String(tr.dataset.clientId || '').trim();
      if (!idRaw && !clientId) {
        clientId = (core.makeClientId ? core.makeClientId() : String(Date.now()));
        tr.dataset.clientId = clientId;
      }
      
      const updates = [];
      if (idRaw) {
        const xid = parseInt(idRaw, 10);
        if (!inDt && !outDt) {
          // Không xóa bản ghi nếu đang ở trạng thái ngày nghỉ (để bảo lưu dữ liệu khi chuyển lại thành đi làm)
          if (!isHoliday) {
            // CHỈ xóa khi người dùng thực sự xóa trắng ô nhập liệu
            const inEmpty = !inEl || String(inEl.value).trim() === '';
            const outEmpty = !outEl || String(outEl.value).trim() === '';
            if (inEmpty && outEmpty) {
              tr.dataset.clear = '1';
              updates.push({ id: xid, delete: true });
            }
          }
        } else if (inDt) {
          updates.push({ id: xid, checkIn: inDt, checkOut: outDt, workType: wt || null, location, memo, notes });
        } else {
          return;
        }
      } else if (inDt) {
        updates.push({ clientId, checkIn: inDt, checkOut: outDt, workType: wt || null, location, memo, notes });
      }
      
      try {
        const u0 = updates[0];
        if (!u0?.id && u0?.checkIn) {
          const days = Array.isArray(state.currentMonthDetail?.days) ? state.currentMonthDetail.days : [];
          const dt = String(u0.checkIn || '');
          const ds = dt.slice(0, 10);
          const day = days.find(d => String(d?.date || '').slice(0, 10) === ds);
          const segs = Array.isArray(day?.segments) ? day.segments : [];
          const hit = segs.find(s => String(s?.checkIn || '') === dt);
          const existingId = hit?.id != null ? Number(hit.id) : null;
          if (existingId) {
            u0.id = existingId;
            delete u0.clientId;
            tr.dataset.id = String(existingId);
            tr.dataset.clientId = '';
          }
        }
      } catch (e) { /* silently ignored */ }
      
      // 現場・作業内容・備考を「全部消して空にする」操作も保存対象にする —
      // 元の値と比較して、空になっただけでも変更として扱う（元が空ならこれまで通り無視）。
      const locationChanged = location !== (tr.dataset.locationBase || '');
      const memoChanged = memo !== (tr.dataset.memoBase || '');
      const notesChanged = notes !== (tr.dataset.notesBase || '');
      const hasDailyMeaningful = !!(effectiveKubun || wt || location || reason || memo || breakMinutes !== 60 || nightBreakMinutes !== 0
        || locationChanged || memoChanged || notesChanged);
      // Important: allow saving daily-only edits (kubun/work/location/memo) even when no time updates.
      if (!updates.length && !hasDailyMeaningful) return;
      const payload = {
        year: y, 
        month: m, 
        userId: ctx.actingUserId || undefined, 
        updates, 
        dailyUpdates: [
          {
            date: dateStr,
            kubun: effectiveKubun || null,
            kubunConfirmed: effectiveKubun ? 1 : 0,
            workType: (wt === 'onsite' || wt === 'remote' || wt === 'satellite') ? wt : null,
            location: location || '',
            reason: reason || '',
            memo: memo || '',
            notes: notes || '',
            breakMinutes,
            nightBreakMinutes,
            shiftStart: String(tr.dataset.shiftStart || '08:00').trim(),
            checkInTime: rawIn || null
          }
        ] 
      };
      const r = await fetchJSONAuth('/api/attendance/month/bulk', { method: 'PUT', body: JSON.stringify(payload) }, 120000);

      if (!r || r.message === 'Unauthorized') {
         throw new Error('セッションが切れました。再ログインしてください。');
      }

      if (r.error || (r.status && r.status >= 400)) {
         throw new Error(String(r.message || r.error || '保存に失敗しました'));
      }

      // Thông báo thành công (Ưu tiên 2)
      if (root.Core?.showToast) {
        root.Core.showToast('保存しました', 'success');
      }
      // ĐÃ XÓA alert('保存しました') gây phiền nhiễu theo yêu cầu người dùng

      // Cập nhật ID nếu là bản ghi mới
      const created = Array.isArray(r?.created) ? r.created : (Array.isArray(r?.createdIds) ? r.createdIds : []);
      for (const c of created) {
        const cid = String(c?.clientId || '').trim();
        if (cid && cid === clientId && c.id) {
          tr.dataset.id = String(c.id);
          // Quan trọng: xóa clientId sau khi đã có id thật
          tr.dataset.clientId = '';
        }
      }

      // Cập nhật LOCAL STATE để đồng bộ hoàn toàn (Chặn rủi ro Blind Spot)
      try {
        const days = Array.isArray(state.currentMonthDetail?.days) ? state.currentMonthDetail.days : [];
        const day = days.find(d => String(d?.date || '').slice(0, 10) === dateStr);
        if (day) {
          day.segments = Array.isArray(day.segments) ? day.segments : [];
          for (const u of updates) {
            const id = u.id ? String(u.id) : null;
            if (u.delete === true) {
              if (id) {
                day.segments = day.segments.filter(s => String(s?.id || '') !== id);
                if (String(tr.dataset.id || '') === id) {
                  tr.dataset.id = '';
                }
              }
            } else if (id) {
              const seg = day.segments.find(s => String(s?.id || '') === id);
              if (seg) {
                seg.checkIn = u.checkIn;
                seg.checkOut = u.checkOut;
                seg.workType = u.workType;
                if (u.location !== undefined) seg.location = u.location;
                if (u.memo !== undefined) seg.memo = u.memo;
                if (u.notes !== undefined) seg.notes = u.notes;
              }
            } else {
              // Cập nhật segment rỗng bằng ID thật
              const c = created.find(x => x.clientId === clientId);
              if (c) {
                const emptySeg = day.segments.find(s => s.clientId === clientId || (!s.id && !s.clientId));
                if (emptySeg) {
                  emptySeg.id = c.id;
                  emptySeg.checkIn = c.checkIn;
                  emptySeg.checkOut = c.checkOut;
                  emptySeg.workType = wt;
                  if (u.location !== undefined) emptySeg.location = u.location;
                  if (u.memo !== undefined) emptySeg.memo = u.memo;
                  if (u.notes !== undefined) emptySeg.notes = u.notes;
                  emptySeg.clientId = undefined;
                } else {
                  day.segments.push({ id: c.id, checkIn: c.checkIn, checkOut: c.checkOut, workType: wt, location: u.location, memo: u.memo, notes: u.notes });
                }
              }
            }
          }
        }
      } catch (err) {
        console.warn('Local state sync failed:', err);
      }

      markRowSaved(tr);
      try { draft?.clear?.(ctx, ym); } catch (e) { /* silently ignored */ }
      try {
        tr.dataset.kubunConfirmed = effectiveKubun ? '1' : '';
        tr.dataset.kubunBase = effectiveKubun || '';
        if (sel && effectiveKubun && String(sel.value || '').trim() !== effectiveKubun) sel.value = effectiveKubun;
      } catch (e) { /* silently ignored */ }
      // Preserve scroll position to prevent page jumping after save
      const _scrollHost = document.querySelector('.kintai-main');
      const _savedST = _scrollHost ? _scrollHost.scrollTop : 0;
      if (root.Render?.recomputeRow) root.Render.recomputeRow(tr);
      if (_scrollHost && _scrollHost.scrollTop !== _savedST) _scrollHost.scrollTop = _savedST;
      
    } catch (e) {
      console.error('Save failed:', e);
      showErr(e?.message || '保存に失敗しました');
    } finally {
      ctx.autoSaveInFlight = false;
    }
  };

  const exportXlsx = async () => {
    clearDirty();
    const ym = ctx.picker?.value || ctx.initialYM;
    if (!/^\d{4}-\d{2}$/.test(ym)) return;
    const [y, m] = ym.split('-').map(x => parseInt(x, 10));
    if (!y || !m) return;
    showErr('');
    const uidQ = ctx.actingUserId ? `&userId=${encodeURIComponent(ctx.actingUserId)}` : '';
    const bust = `&_=${Date.now()}`;
    const url = `/api/attendance/month/export.xlsx?year=${encodeURIComponent(y)}&month=${encodeURIComponent(m)}${uidQ}${bust}`;
    const fileName = `attendance_month_${ym}.xlsx`;
    try {
      await downloadWithAuth(url, fileName);
    } catch (err) {
      showErr(err?.message || '出力に失敗しました');
      alert(String(err?.message || '出力に失敗しました'));
    } finally {
      hideSpinner();
    }
  };

  const submitMonth = async () => {
    const ym = ctx.picker?.value || '';
    if (!/^\d{4}-\d{2}$/.test(ym)) return;
    if (!confirm('この月を提出します。よろしいですか？')) return;
    showErr('');
    try {
      const y = parseInt(ym.slice(0, 4), 10);
      const m = parseInt(ym.slice(5, 7), 10);
      await fetchJSONAuth('/api/attendance/month/submit', { method: 'POST', body: JSON.stringify({ year: y, month: m, userId: ctx.actingUserId || undefined }) });
      await setMonth(ym, true);
    } catch (err) {
      showErr(err?.message || '提出に失敗しました');
    } finally {
      hideSpinner();
    }
  };

  const approveMonth = async () => {
    const ym = ctx.picker?.value || '';
    if (!/^\d{4}-\d{2}$/.test(ym)) return;
    if (!ctx.actingUserId) return;
    if (!confirm('この月を承認して締め処理します。よろしいですか？')) return;
    showErr('');
    try {
      const y = parseInt(ym.slice(0, 4), 10);
      const m = parseInt(ym.slice(5, 7), 10);
      try {
        await fetchJSONAuth('/api/attendance/month/submit', { method: 'POST', body: JSON.stringify({ year: y, month: m, userId: ctx.actingUserId }) });
      } catch (e) { /* silently ignored */ }
      await fetchJSONAuth('/api/attendance/month/approve', { method: 'POST', body: JSON.stringify({ year: y, month: m, userId: ctx.actingUserId }) });
      // Reflect approval immediately on UI, then sync in background.
      try {
        if (state.currentMonthDetail) {
          state.currentMonthDetail.monthStatus = state.currentMonthDetail.monthStatus || {};
          state.currentMonthDetail.monthStatus.status = 'approved';
          state.currentMonthDetail.monthStatus.approvedAt = state.currentMonthDetail.monthStatus.approvedAt || new Date().toISOString();
          state.currentMonthDetail.monthStatus.approverName = state.currentMonthDetail.monthStatus.approverName || String(ctx.profile?.username || '').trim();
        }
        state.currentMonthStatus = 'approved';
        updateMonthWorkflowUI();
        renderTable(ctx.tableHost, state.currentMonthDetail, ctx.profile);
        renderSummary(ctx.summaryHost, state.currentMonthDetail, state.currentMonthTimesheet || null);
      } catch (e) { /* silently ignored */ }
      void setMonth(ym, true, { spinner: false }).catch(() => {});
    } catch (err) {
      showErr(err?.message || '承認に失敗しました');
    }
  };

  const unlockMonth = async () => {
    const ym = ctx.picker?.value || '';
    if (!/^\d{4}-\d{2}$/.test(ym)) return;
    if (!ctx.actingUserId) return;
    if (!confirm('締め状態を解除して編集可能に戻します。よろしいですか？')) return;
    showErr('');
    try {
      const y = parseInt(ym.slice(0, 4), 10);
      const m = parseInt(ym.slice(5, 7), 10);
      await fetchJSONAuth('/api/attendance/month/unlock', { method: 'POST', body: JSON.stringify({ year: y, month: m, userId: ctx.actingUserId }) });
      await setMonth(ym, true);
    } catch (err) {
      showErr(err?.message || '解除に失敗しました');
    } finally {
      hideSpinner();
    }
  };

  const initUserPicker = async () => {
    if (ctx.role !== 'admin' && ctx.role !== 'manager') return;
    try {
      const head = document.querySelector('.se-page-head');
      if (!head) return;
      const wrap = document.createElement('div');
      wrap.style.display = 'flex';
      wrap.style.alignItems = 'center';
      wrap.style.gap = '12px';
      wrap.style.flexWrap = 'wrap';
      wrap.style.justifyContent = 'flex-end';
      wrap.style.paddingRight = '16px';
      wrap.style.marginTop = '12px';

      // Add 実績表PDF button before 対象社員 label
      const btnReportMatrix = document.createElement('button');
      btnReportMatrix.type = 'button';
      btnReportMatrix.id = 'btnReportMatrix';
      btnReportMatrix.textContent = '実績表PDF';
      btnReportMatrix.style.cssText = 'height:24px;padding:0 12px;background:#059669;color:#fff;border:none;border-radius:4px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;';
      wrap.appendChild(btnReportMatrix);

      const lbl = document.createElement('div');
      lbl.textContent = '対象社員';
      lbl.style.fontWeight = '900';
      lbl.style.color = '#0b2c66';
      lbl.style.fontSize = '10px';
      lbl.style.whiteSpace = 'nowrap';

      const input = document.createElement('input');
      input.type = 'search';
      input.placeholder = '社員番号 / 氏名';
      input.autocomplete = 'off';
      input.style.height = '24px';
      input.style.border = '1px solid #cbd5e1';
      input.style.borderRadius = '4px';
      input.style.padding = '0 8px';
      input.style.minWidth = '140px';
      input.style.fontSize = '10px';

      const sel = document.createElement('select');
      sel.style.height = '24px';
      sel.style.border = '1px solid #cbd5e1';
      sel.style.borderRadius = '4px';
      sel.style.padding = '0 8px';
      sel.style.minWidth = '120px';
      sel.style.maxWidth = '160px';
      sel.style.fontWeight = '800';
      sel.style.color = '#0b2c66';
      sel.style.fontSize = '10px';

      wrap.appendChild(lbl);
      wrap.appendChild(input);
      wrap.appendChild(sel);
      head.appendChild(wrap);

      const fetchUsers = async () => {
        let role = '';
        try { role = String(profile?.role || '').toLowerCase(); } catch (e) { /* silently ignored */ }
        if (!role) {
          try { role = String(state?.profile?.role || '').toLowerCase(); } catch (e) { /* silently ignored */ }
        }
        if (role === 'admin') {
          return fetchJSONAuth('/api/admin/users').catch(() => fetchJSONAuth('/api/manager/users'));
        }
        // Manager uses dedicated endpoint that returns all company employees (no dept scope)
        return fetchJSONAuth('/api/manager/users').catch(() => fetchJSONAuth('/api/admin/users'));
      };

      const allUsers = await fetchUsers().catch((e) => { console.error('fetchUsers error', e); return []; });
      const usersAll = Array.isArray(allUsers) ? allUsers : (allUsers?.rows || allUsers?.data || []);
      const meId = String(ctx.profile?.id || '');

      const normalize = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
      const codeOf = (u) => String(u.employee_code || u.employeeCode || (u.id ? ('EMP' + String(u.id).padStart(3, '0')) : '')).trim();
      const nameOf = (u) => String(u.username || u.email || '').trim();
      
      const isEmployee = (u) => {
        // Only show employees (not admin/manager) in the picker
        const r = String(u.role || '').toLowerCase();
        return r === 'employee';
      };
      
      const users = usersAll
        .filter(u => String(u?.id || '') && String(u.id) !== meId)
        .filter(isEmployee)
        .sort((a, b) => {
          const ac = codeOf(a);
          const bc = codeOf(b);
          const c = ac.localeCompare(bc);
          if (c) return c;
          const an = nameOf(a);
          const bn = nameOf(b);
          return an.localeCompare(bn);
        });

      const rebuild = () => {
        const q = normalize(input.value);
        const list = users.filter(u => {
          if (!q) return true;
          const hay = normalize([codeOf(u), nameOf(u), u.email || '', u.id || ''].join(' '));
          return hay.includes(q);
        }).slice(0, 2000);
        sel.innerHTML = '';
        const optPick = document.createElement('option');
        optPick.value = '';
        optPick.textContent = '（社員を選択）';
        sel.appendChild(optPick);
        for (const u of list) {
          const opt = document.createElement('option');
          opt.value = String(u.id || '');
          opt.textContent = `${codeOf(u)} ${nameOf(u)}`.trim();
          sel.appendChild(opt);
        }
        const cur = ctx.actingUserId || '';
        sel.value = cur || '';
      };

      rebuild();
      if (!ctx.actingUserId && users.length) {
        ctx.actingUserId = String(users[0].id || '').trim();
        try { state.currentViewingUserId = ctx.actingUserId; } catch (e) { /* silently ignored */ }
        try { sel.value = ctx.actingUserId; } catch (e) { /* silently ignored */ }
        // Force the URL to reflect the default user
        const url = new URL(window.location.href);
        url.searchParams.set('userId', ctx.actingUserId);
        try { history.replaceState(null, '', url.pathname + url.search + url.hash); } catch (e) { /* silently ignored */ }
      }

      ctx.userPicker = { input, select: sel, rebuild };
    } catch (e) { /* silently ignored */ }
  };

  const initContractTabs = () => {
    const sec = $('#contractSection');
    if (!sec) return;
    const tabs = Array.from(sec.querySelectorAll('.se-tab[data-tab]'));
    ctx.applyContractTab = () => {
      const active = tabs.find(t => t.classList.contains('active')) || tabs[0] || null;
      const key = String(active?.dataset?.tab || '');
      for (const t of tabs) t.classList.toggle('active', String(t.dataset.tab || '') === String(key || ''));
      if (ctx.contractHost) ctx.contractHost.toggleAttribute('hidden', String(key) === 'workDetail');
      if (ctx.workDetailHost) ctx.workDetailHost.toggleAttribute('hidden', String(key) !== 'workDetail');
    };
    try { ctx.applyContractTab(); } catch (e) { /* silently ignored */ }
  };

  const initSummaryTabs = () => {
    const sec = $('#summarySection');
    if (!sec) return;
    const tabs = Array.from(sec.querySelectorAll('.se-tab[data-tab]'));
    ctx.applySummaryTab = () => {
      const active = tabs.find(t => t.classList.contains('active')) || tabs[0] || null;
      const key = String(active?.dataset?.tab || '');
      for (const t of tabs) t.classList.toggle('active', String(t.dataset.tab || '') === String(key || ''));
      renderSummary(ctx.summaryHost, state.currentMonthDetail, state.currentMonthTimesheet);
    };
    try { ctx.applySummaryTab(); } catch (e) { /* silently ignored */ }
  };

  const initSummaryEditor = () => {
    const sec = $('#summarySection');
    if (!sec || sec.dataset.summaryEditorReady === '1') return;
    sec.dataset.summaryEditorReady = '1';
    if (ctx.role !== 'admin' && ctx.role !== 'manager') return;
    const head = sec.querySelector('.se-section-head');
    const body = sec.querySelector('.se-section-body');
    if (!head || !body) return;
  };

  const wireAutoRefreshSide = () => {
    const sec = $('#summarySection');
    if (!sec || sec.dataset.sideAutoRefreshWired === '1') return;
    sec.dataset.sideAutoRefreshWired = '1';
    let lastKey = '';
    const buildKey = (d) => {
      try {
        const a = Array.isArray(d?.shiftAssignments) ? d.shiftAssignments : [];
        const w = Array.isArray(d?.workDetails) ? d.workDetails : [];
        const s = d?.monthSummary || null;
        return JSON.stringify({ a, w, s });
      } catch (e) {
        return '';
      }
    };
    const refresh = async () => {
      if (document.hidden) return;
      const ym = String(ctx.picker?.value || '').trim();
      if (!/^\d{4}-\d{2}$/.test(ym)) return;
      if (!state.currentMonthDetail) return;
      const [y, m] = ym.split('-').map(x => parseInt(x, 10));
      if (!y || !m) return;
      const uid = ctx.actingUserId || null;
      const uidQ = uid ? `&userId=${encodeURIComponent(String(uid))}` : '';
      const next = await fetchJSONAuth(`/api/attendance/month/detail?year=${encodeURIComponent(y)}&month=${encodeURIComponent(m)}${uidQ}`).catch(() => null);
      if (!next) return;
      const key = buildKey(next);
      if (!key || key === lastKey) return;
      lastKey = key;
      try {
        state.currentMonthDetail.shiftAssignments = next.shiftAssignments;
        state.currentMonthDetail.workDetails = next.workDetails;
        state.currentMonthDetail.monthSummary = next.monthSummary;
      } catch (e) { /* silently ignored */ }
      try { renderContract(ctx.contractHost, state.currentMonthDetail); } catch (e) { /* silently ignored */ }
      try { renderWorkDetail(ctx.workDetailHost, state.currentMonthDetail, ctx.profile); } catch (e) { /* silently ignored */ }
      try { renderSummary(ctx.summaryHost, state.currentMonthDetail, state.currentMonthTimesheet); } catch (e) { /* silently ignored */ }
    };
    try { clearInterval(ctx.refreshTimer); } catch (e) { /* silently ignored */ }
    ctx.refreshFailCount = 0;
    ctx.refreshTimer = setInterval(async () => {
      try {
        await refresh();
        ctx.refreshFailCount = 0;
      } catch (e) {
        ctx.refreshFailCount = (ctx.refreshFailCount || 0) + 1;
        if (ctx.refreshFailCount >= 2) {
          try { clearInterval(ctx.refreshTimer); } catch (e) { /* silently ignored */ }
          ctx.refreshTimer = null;
        }
      }
    }, 15000);
    try { lastKey = buildKey(state.currentMonthDetail); } catch (e) { /* silently ignored */ }
  };

  const init = async () => {
    state.editableMonth = state.editableMonth == null ? true : state.editableMonth;
    state.currentMonthStatus = state.currentMonthStatus || 'draft';
    state.currentViewingUserId = state.currentViewingUserId || '';
    state.currentYM = state.currentYM || monthJST();

    showErr('');
    hideSpinner();
    let cachedProfile = null;
    try {
      const raw = sessionStorage.getItem('user') || localStorage.getItem('user') || '';
      cachedProfile = raw ? JSON.parse(raw) : null;
    } catch (e) { /* silently ignored */ }
    const profileTask = ensureAuthProfile().catch(() => null);
    let profile = cachedProfile || null;
    if (!profile) {
      // Do not block first paint when cache is empty; run real auth in background.
      profile = { id: '', role: 'employee', username: '', email: '' };
    }
    ctx.profile = profile;
    state.profile = profile;
    ctx.role = String(profile.role || '').toLowerCase();
    // Attendance monthly page should always keep topbar/navigation visible.
    // Admin embed view uses a dedicated page, so do not auto-hide by URL param here.
    try {
      const top = document.querySelector('.kintai-top');
      if (top) top.style.display = '';
      try { document.body.classList.remove('embed'); } catch (e) { /* silently ignored */ }
    } catch (e) { /* silently ignored */ }
    try { if ($('#userName')) $('#userName').textContent = profile.username || profile.email || 'ユーザー'; } catch (e) { /* silently ignored */ }
    try {
      const code = profile.employee_code || profile.employeeCode || (profile.id ? ('EMP' + String(profile.id).padStart(3, '0')) : '');
      if ($('#empCode')) $('#empCode').textContent = (ctx.role === 'employee') ? (code || '—') : '—';
    } catch (e) { /* silently ignored */ }
    try { if ($('#staffName')) $('#staffName').textContent = (ctx.role === 'employee') ? (profile.username || profile.email || '—') : '—'; } catch (e) { /* silently ignored */ }
    try {
      const officeCode = profile.office_code || profile.officeCode || '00084';
      if ($('#officeCode')) $('#officeCode').textContent = (ctx.role === 'employee') ? (String(officeCode || '').trim() || '—') : '—';
    } catch (e) { /* silently ignored */ }
    // オフィス名 = tên công ty (tenant) của chính nhân viên, KHÔNG hardcode 飯塚塗研.
    try {
      const nameFromProfile = String(profile.tenantName || profile.tenant_name || '').trim();
      if ($('#officeName')) $('#officeName').textContent = nameFromProfile || '—';
      // Nếu profile cache chưa có tenantName, lấy từ /api/auth/me rồi cập nhật lại.
      if (!nameFromProfile) {
        fetchJSONAuth('/api/auth/me')
          .then((me) => {
            const nm = String(me?.tenantName || me?.tenant_name || '').trim();
            if (nm && $('#officeName')) $('#officeName').textContent = nm;
          })
          .catch(() => { /* giữ nguyên '—' nếu không lấy được */ });
      }
    } catch (e) { /* silently ignored */ }
    try { if ($('#empDept')) $('#empDept').textContent = (ctx.role === 'employee') ? (profile.departmentName || profile.department || '—') : '—'; } catch (e) { /* silently ignored */ }

    ctx.actingUserId = '';
    try {
      const u = new URL(window.location.href);
      const v = String(u.searchParams.get('userId') || '').trim();
      if (/^\d+$/.test(v) && ctx.role !== 'employee') ctx.actingUserId = v;
    } catch (e) { /* silently ignored */ }
    
    // For admin/manager, if no specific userId is set yet, wait for initUserPicker to set the first employee
    try { state.currentViewingUserId = ctx.actingUserId ? String(ctx.actingUserId) : (ctx.role === 'employee' ? String(profile.id || '') : ''); } catch (e) { /* silently ignored */ }

    ctx.picker1 = $('#monthPicker');
    ctx.picker2 = $('#monthPicker2');
    ctx.picker = ctx.picker2 || ctx.picker1;
    ctx.summaryHost = $('#monthSummaryTable') || $('#monthSummary');
    ctx.tableHost = $('#monthTable');
    ctx.contractHost = $('#contractTable');
    ctx.workDetailHost = $('#workDetailTable');

    ensureWorkflowUI();
    ctx.pinMonthHeadMode = 'bottom';
    applyPinMonthHead();
    syncFooterVars();
    syncStickyTop();
    syncTheadRowHeights();
    wireMonthHScrollVisibility();
    wireFooterResize();

    try {
      // Always open all monthly sections on first render (requested UX baseline).
      setDailyCollapsed(false);
      setContractCollapsed(false);
      setSummaryCollapsed(false);
      setAnnualCollapsed(false);
    } catch (e) { /* silently ignored */ }

    applyDailyCollapsed(getDailyCollapsed());
    applyContractCollapsed(getContractCollapsed());
    applySummaryCollapsed(getSummaryCollapsed());
    applyAnnualCollapsed(getAnnualCollapsed());

    initContractTabs();
    initSummaryTabs();
    initSummaryEditor();
    wireAutoRefreshSide();
    ctx.initialYM = (() => {
      try {
        const u = new URL(window.location.href);
        const m = String(u.searchParams.get('month') || '').slice(0, 7);
        if (/^\d{4}-\d{2}$/.test(m)) return m;
      } catch (e) { /* silently ignored */ }
      return monthJST();
    })();
    if (ctx.picker1) ctx.picker1.value = ctx.initialYM;
    if (ctx.picker2) ctx.picker2.value = ctx.initialYM;
    buildTargetDateSelect(ctx.initialYM);

    if (ctx.role === 'employee') {
      setMonth(ctx.initialYM, true, { spinner: false }).catch(()=>{});
    }

    // Do not block first month rendering on employee-list fetch.
    initUserPicker().then(() => {
      try { root.Events?.bindUserPicker?.(); } catch (e) { /* silently ignored */ }
      if (ctx.role !== 'employee') {
        // Force refresh for admin to show the auto-selected first employee
        setMonth(ctx.initialYM, true, { spinner: false }).catch(()=>{});
      }
    }).catch(() => {});

    Promise.resolve(profileTask).then((fresh) => {
      if (!fresh) {
        try { window.location.replace('/ui/login'); } catch (e) { window.location.href = '/ui/login'; }
        return;
      }
      ctx.profile = fresh;
      state.profile = fresh;
      ctx.role = String(fresh.role || '').toLowerCase();
    }).catch(() => {});

    return true;
  };

  const tableHistory = (dateStr) => {
    const days = Array.isArray(state.currentMonthDetail?.days) ? state.currentMonthDetail.days : [];
    const day = days.find(d => String(d?.date || '') === dateStr);
    const segs = Array.isArray(day?.segments) ? day.segments : [];
    const lines = segs.map(s => {
      const inHm = fromDateTime(s?.checkIn);
      const outHm = fromDateTime(s?.checkOut);
      const wt = workTypeLabel(s?.workType);
      return `#${s?.id || 'new'} ${inHm || '--:--'}-${outHm || '--:--'} ${wt || ''}`.trim();
    });
    alert(lines.length ? lines.join('\n') : '履歴がありません');
  };

  const addSegmentRow = async (dateStr) => {
    if (!state.editableMonth) return;
    const days = Array.isArray(state.currentMonthDetail?.days) ? state.currentMonthDetail.days : [];
    const day = days.find(d => String(d?.date || '').slice(0, 10) === dateStr);
    if (!day) return;
    
    day.segments = Array.isArray(day.segments) ? day.segments : [];
    if (day.segments.length >= 3) {
      if (root.Core?.showToast) root.Core.showToast('1日は最大3件まで追加できます。', 'error');
      return;
    }
    
    // Thêm segment trống
    day.segments.push({
      id: null,
      clientId: root.Core?.makeClientId?.() || String(Date.now()),
      checkIn: null,
      checkOut: null,
      workType: null
    });
    
    // Đảm bảo không render lại nếu đang lưu (chờ xíu)
    if (ctx.autoSaveInFlight) {
      await new Promise(r => setTimeout(r, 300));
    }
    
    // Re-render table
    renderTable(ctx.tableHost, state.currentMonthDetail, ctx.profile);
    
    // Focus vào input checkIn của dòng mới
    setTimeout(() => {
      const rows = Array.from(ctx.tableHost.querySelectorAll(`[data-row="1"][data-date="${core.cssEscape(dateStr)}"]`));
      const lastRow = rows[rows.length - 1];
      if (lastRow) {
        const inEl = lastRow.querySelector('input[data-field="checkIn"]');
        if (inEl) {
          inEl.focus();
          try { lastRow.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch(e){}
        }
      }
    }, 50);
  };

  const clearRow = async (tr) => {
    if (!tr) return;
    const dateStr = String(tr.dataset.date || '').slice(0, 10);
    const idRaw = String(tr.dataset.id || '').trim();
    
    const days = Array.isArray(state.currentMonthDetail?.days) ? state.currentMonthDetail.days : [];
    const day = days.find(d => String(d?.date || '').slice(0, 10) === dateStr);
    const segs = day ? (Array.isArray(day.segments) ? day.segments : []) : [];
    
    // Nếu là dòng thêm (dòng phụ thứ 2, thứ 3), tiến hành xóa luôn khỏi DOM và DB
    if (segs.length > 1) {
       if (idRaw) {
         try {
           const payload = {
             year: parseInt(dateStr.slice(0,4), 10),
             month: parseInt(dateStr.slice(5,7), 10),
             userId: ctx.actingUserId || undefined,
             updates: [{ id: parseInt(idRaw, 10), delete: true }],
             dailyUpdates: []
           };
           await fetchJSONAuth('/api/attendance/month/bulk', { method: 'PUT', body: JSON.stringify(payload) });
           day.segments = day.segments.filter(s => String(s.id) !== idRaw);
         } catch (e) {
           showErr(e?.message || '削除に失敗しました');
           return;
         }
       } else {
         // Xóa dòng chưa lưu
         const clientId = String(tr.dataset.clientId || '').trim();
         const emptyIdx = day.segments.findIndex(s => s.clientId === clientId || !s.id);
         if (emptyIdx !== -1) {
            day.segments.splice(emptyIdx, 1);
         } else {
            day.segments.pop();
         }
       }
       renderTable(ctx.tableHost, state.currentMonthDetail, ctx.profile);
       if (root.Core?.showToast) root.Core.showToast('行を削除しました', 'success');
       return;
    }

    // Nếu là dòng duy nhất, chỉ xóa nội dung (Clear)
    try { tr.dataset.dirty = '1'; } catch (e) { /* silently ignored */ }
    try { tr.dataset.clear = '1'; } catch (e) { /* silently ignored */ }
    const ckOn = tr.querySelector('input[data-field="ckOnsite"]');
    const ckRe = tr.querySelector('input[data-field="ckRemote"]');
    const ckSa = tr.querySelector('input[data-field="ckSatellite"]');
    if (ckOn) ckOn.checked = false;
    if (ckRe) ckRe.checked = false;
    if (ckSa) ckSa.checked = false;
    tr.dataset.workType = '';
    const inEl = tr.querySelector('input[data-field="checkIn"]');
    const outEl = tr.querySelector('input[data-field="checkOut"]');
    if (inEl) inEl.value = '';
    if (outEl) outEl.value = '';
    const bSel = tr.querySelector('select[data-field="break"]');
    if (bSel) bSel.value = '1:00';
    const nbSel = tr.querySelector('select[data-field="nightBreak"]');
    if (nbSel) nbSel.value = '0:00';
    const rSel = tr.querySelector('select[data-field="reason"]');
    if (rSel) rSel.value = '';
    const ihSel = tr.querySelector('select[data-field="inhouse"]');
    if (ihSel) ihSel.value = '';
    const memo = tr.querySelector('[data-field="memo"]');
    if (memo) memo.value = '';
    try { root.Render?.recomputeRow?.(tr); } catch (e) { /* silently ignored */ }
    
    // Auto save to process clear on backend
    await saveRowTimesNow(tr);
  };

  const checkImportFile = () => {
    const fileEl = document.querySelector('#importFile');
    const file = fileEl && 'files' in fileEl ? fileEl.files?.[0] : null;
    if (!file) { showErr('取込対象がありません。'); return false; }
    const name = String(file.name || '');
    const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() : '';
    if (ext !== 'xlsx') { showErr('選択されたファイルが正しくありません。'); return false; }
    if (file.size <= 0) { showErr('取込対象がありません。'); return false; }
    if (file.size > 10 * 1024 * 1024) { showErr('入力用Excelのファイルサイズが10MBを超過しているため取り込めません。'); return false; }
    return true;
  };

  // ─── 退勤打刻削除: checkOutのみをNULLにする（admin/manager専用）─────────────────
  const clearCheckOut = async (tr) => {
    if (!tr) return;
    const idRaw = String(tr.dataset.id || '').trim();
    if (!idRaw) {
      showErr('保存済みの打刻レコードがありません。');
      return;
    }
    const outEl = tr.querySelector('input.se-time[data-field="checkOut"]');
    const outVal = String(outEl?.value || '').trim();
    if (!outVal) {
      showErr('退勤打刻がありません。');
      return;
    }
    if (!confirm('退勤打刻を削除しますか？\nチェックイン時刻はそのまま残ります。')) return;

    showErr('');
    try {
      // Read current checkIn from the row to preserve it
      const inEl = tr.querySelector('input.se-time[data-field="checkIn"]');
      const dateStr = String(tr.dataset.date || '').slice(0, 10);
      const rawIn = String(inEl?.value || '').trim();
      const core = root.Core || {};
      const checkInDt = rawIn && core.toDateTime ? core.toDateTime(dateStr, rawIn) : null;

      const r = await fetchJSONAuth(
        `/api/admin/attendance/${encodeURIComponent(idRaw)}`,
        { method: 'PATCH', body: JSON.stringify({ checkIn: checkInDt || undefined, checkOut: null }) }
      );
      if (r && (r.message === 'Unauthorized' || (r.status && Number(r.status) >= 400))) {
        throw new Error(String(r.message || '退勤削除に失敗しました'));
      }

      // Update DOM — clear the checkout field and manual flag
      if (outEl) { outEl.value = ''; outEl.dataset.manual = ''; }

      // Update local state so re-render stays consistent
      try {
        const days = Array.isArray(state.currentMonthDetail?.days) ? state.currentMonthDetail.days : [];
        const day = days.find(d => String(d?.date || '').slice(0, 10) === dateStr);
        if (day && Array.isArray(day.segments)) {
          const seg = day.segments.find(s => String(s?.id || '') === idRaw);
          if (seg) seg.checkOut = null;
        }
      } catch (e) { /* silently ignored */ }

      // Recompute the row visuals (worked hours, status, etc.)
      try { root.Render?.recomputeRow?.(tr); } catch (e) { /* silently ignored */ }

      if (root.Core?.showToast) root.Core.showToast('退勤打刻を削除しました', 'success');
    } catch (err) {
      showErr(err?.message || '退勤削除に失敗しました');
    }
  };

  const setActingUserId = async (nextUserId) => {
    ctx.actingUserId = String(nextUserId || '').trim();
    try { if (ctx.monthCache instanceof Map) ctx.monthCache.clear(); } catch (e) { /* silently ignored */ }
    try { state.currentViewingUserId = ctx.actingUserId || String(ctx.profile?.id || ''); } catch (e) { /* silently ignored */ }
    const ym = ctx.picker?.value || monthJST();
    
    // Pass userId to setMonth so it updates URL once
    const url = new URL(window.location.href);
    if (ctx.actingUserId) url.searchParams.set('userId', ctx.actingUserId);
    else url.searchParams.delete('userId');
    try { history.replaceState(null, '', url.pathname + url.search + url.hash); } catch (e) { /* silently ignored */ }
    
    await setMonth(ym, true);
  };

  const nextMonth = async (delta) => {
    const cur = ctx.picker?.value || ctx.initialYM;
    await setMonth(addMonths(cur, delta));
  };

  const reloadMonth = async () => {
    const cur = ctx.picker?.value || ctx.initialYM;
    await setMonth(cur, true);
  };

  const Controller = {
    ctx,
    init,
    setMonth,
    nextMonth,
    reloadMonth,
    scheduleAutoSave,
    saveManual,
    saveRowNow,
    saveRowTimesNow,
    exportXlsx,
    submitMonth,
    approveMonth,
    unlockMonth,
    applyDailyCollapsed,
    setDailyCollapsed,
    getDailyCollapsed,
    applyContractCollapsed,
    setContractCollapsed,
    getContractCollapsed,
    applySummaryCollapsed,
    setSummaryCollapsed,
    getSummaryCollapsed,
    applyAnnualCollapsed,
    setAnnualCollapsed,
    getAnnualCollapsed,
    buildTargetDateSelect,
    syncFooterVars,
    syncStickyTop,
    syncTheadRowHeights,
    syncMonthHScroll,
    wireMonthHScrollVisibility,
    wireFooterResize,
    updateMonthWorkflowUI,
    applyPinMonthHead,
    applyEditability,
    refreshAddButtons,
    tableHistory,
    addSegmentRow,
    clearRow,
    clearCheckOut,
    checkImportFile,
    setActingUserId
  };

  root.Controller = Controller;
  globalThis.AttendanceMonthly = root;
})();


