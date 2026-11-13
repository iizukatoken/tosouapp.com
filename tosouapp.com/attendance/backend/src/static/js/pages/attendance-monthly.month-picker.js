// 対象年月: 「‹ 2026年 › ｜1月 2月 … 12月」の帯（ポップアップなし、1クリックで月を切り替え）。
// 各月の下の点の色 = その月の状態（承認済み・承認待ち・入力中・まだ）。
// 値は元の <input type="month" id="monthPicker2"> に書いて change を発火するだけなので、
// 月の読み込み処理（attendance-monthly.events.js の handlePick）はそのまま動く。
(function () {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');
  const parseYM = (v) => {
    const m = String(v || '').match(/^(\d{4})-(\d{2})$/);
    return m ? { y: Number(m[1]), m: Number(m[2]) } : null;
  };
  const todayYM = () => {
    const d = new Date(Date.now() + 9 * 3600 * 1000);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
  };
  const ST_LABEL = { approved: '承認済み', submitted: '承認待ち', draft: '入力中', none: 'まだ' };

  function mount(input) {
    if (!input || input.dataset.mpMounted === '1') return;
    input.dataset.mpMounted = '1';

    const wrap = document.createElement('div');
    wrap.className = 'se-ms';
    wrap.innerHTML = `
      <div class="se-ms-strip" role="tablist" aria-label="対象年月">
        <div class="se-ms-year">
          <button type="button" class="se-ms-ybtn" data-year="-1" aria-label="前年">‹</button>
          <span class="se-ms-ytext"></span>
          <button type="button" class="se-ms-ybtn" data-year="1" aria-label="翌年">›</button>
        </div>
        <div class="se-ms-months"></div>
      </div>
      <div class="se-ms-legend" aria-hidden="true">
        <span><i class="st-approved"></i>承認済み</span><span><i class="st-submitted"></i>承認待ち</span><span><i class="st-draft"></i>入力中</span><span><i class="st-none"></i>まだ</span>
      </div>`;
    input.classList.add('se-mp-native');
    input.insertAdjacentElement('afterend', wrap);

    let viewYear = (parseYM(input.value) || todayYM()).y;
    const statusCache = new Map(); // `${uid}:${year}` -> { 1: 'approved', ... }
    const uid = () => { try { return new URLSearchParams(location.search).get('userId') || ''; } catch (e) { return ''; } };
    const selected = () => parseYM(input.value) || todayYM();

    const render = () => {
      const s = selected();
      const t = todayYM();
      const st = statusCache.get(`${uid()}:${viewYear}`) || {};
      wrap.querySelector('.se-ms-ytext').textContent = `${viewYear}年`;
      wrap.querySelector('.se-ms-months').innerHTML = Array.from({ length: 12 }, (_, i) => {
        const m = i + 1;
        const cls = ['se-ms-m'];
        const isSel = viewYear === s.y && m === s.m;
        if (isSel) cls.push('is-selected');
        if (viewYear === t.y && m === t.m) cls.push('is-today');
        const k = st[m] || 'none';
        const tip = `${viewYear}年${m}月：${ST_LABEL[k] || ''}${viewYear === t.y && m === t.m ? '（今月）' : ''}`;
        return `<button type="button" class="${cls.join(' ')}" data-month="${m}" role="tab" aria-selected="${isSel}" title="${tip}">${m}月<i class="st-${k}"></i></button>`;
      }).join('');
    };

    const loadStatuses = async (force) => {
      const key = `${uid()}:${viewYear}`;
      if (!force && statusCache.has(key)) return;
      try {
        const core = (globalThis.AttendanceMonthly && globalThis.AttendanceMonthly.Core) || globalThis.MonthlyMonthlyCore || {};
        if (typeof core.fetchJSONAuth !== 'function') return;
        const u = uid();
        const r = await core.fetchJSONAuth(`/api/attendance/month/statuses?year=${viewYear}${u ? `&userId=${encodeURIComponent(u)}` : ''}`);
        if (r && r.months) { statusCache.set(key, r.months); render(); }
      } catch (e) { /* 点が出ないだけ */ }
    };

    const pick = (ym) => {
      const v = `${ym.y}-${pad(ym.m)}`;
      if (input.value === v) return;
      input.value = v;
      render();
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    wrap.addEventListener('click', (e) => {
      const yr = e.target.closest('[data-year]');
      if (yr) { viewYear += Number(yr.dataset.year); render(); loadStatuses(false); return; }
      const mo = e.target.closest('[data-month]');
      if (mo) pick({ y: viewYear, m: Number(mo.dataset.month) });
    });

    // 前月/翌月ボタン・社員の切り替えなどで値が変わったら表示を合わせ、状態も読み直す
    render();
    loadStatuses(true);
    let last = input.value;
    let lastUid = uid();
    setInterval(() => {
      const u = uid();
      if (input.value !== last || u !== lastUid) {
        const changedUser = u !== lastUid;
        last = input.value; lastUid = u;
        const s = selected();
        if (s.y !== viewYear) viewYear = s.y;
        render();
        loadStatuses(changedUser);
      }
    }, 300);
    // 提出・承認などで状態が変わるので、ときどき読み直す
    setInterval(() => { if (!document.hidden) loadStatuses(true); }, 60000);
  }

  function init() { mount(document.getElementById('monthPicker2')); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
