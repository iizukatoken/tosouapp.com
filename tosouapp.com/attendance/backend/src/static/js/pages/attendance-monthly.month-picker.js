// 対象年月: ブラウザ標準の月選択（見た目を変えられない）の代わりに、
// 「‹ 2026年11月 › 」＋ 年と12か月のポップアップを表示する。
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
  const addMonths = ({ y, m }, delta) => {
    const t = (y * 12 + (m - 1)) + delta;
    return { y: Math.floor(t / 12), m: (t % 12) + 1 };
  };

  function mount(input) {
    if (!input || input.dataset.mpMounted === '1') return;
    input.dataset.mpMounted = '1';

    const wrap = document.createElement('div');
    wrap.className = 'se-mp';
    wrap.innerHTML = `
      <button type="button" class="se-mp-step" data-step="-1" aria-label="前月">‹</button>
      <button type="button" class="se-mp-current" aria-haspopup="dialog" aria-expanded="false"></button>
      <button type="button" class="se-mp-step" data-step="1" aria-label="翌月">›</button>
      <div class="se-mp-pop" role="dialog" aria-label="対象年月を選択" hidden>
        <div class="se-mp-head">
          <button type="button" class="se-mp-year" data-year="-1" aria-label="前年">‹</button>
          <span class="se-mp-ytext"></span>
          <button type="button" class="se-mp-year" data-year="1" aria-label="翌年">›</button>
        </div>
        <div class="se-mp-grid"></div>
        <div class="se-mp-foot"><button type="button" class="se-mp-today">今月</button></div>
      </div>`;
    input.classList.add('se-mp-native');
    input.insertAdjacentElement('afterend', wrap);

    const cur = wrap.querySelector('.se-mp-current');
    const pop = wrap.querySelector('.se-mp-pop');
    let viewYear = (parseYM(input.value) || todayYM()).y;

    const selected = () => parseYM(input.value) || todayYM();
    const renderCurrent = () => {
      const s = selected();
      cur.textContent = `${s.y}年${s.m}月`;
    };
    const renderPop = () => {
      const s = selected();
      const t = todayYM();
      wrap.querySelector('.se-mp-ytext').textContent = `${viewYear}年`;
      wrap.querySelector('.se-mp-grid').innerHTML = Array.from({ length: 12 }, (_, i) => {
        const m = i + 1;
        const cls = ['se-mp-month'];
        if (viewYear === s.y && m === s.m) cls.push('is-selected');
        if (viewYear === t.y && m === t.m) cls.push('is-today');
        return `<button type="button" class="${cls.join(' ')}" data-month="${m}">${m}月</button>`;
      }).join('');
    };
    const pick = (ym) => {
      const v = `${ym.y}-${pad(ym.m)}`;
      close();
      if (input.value === v) return;
      input.value = v;
      renderCurrent();
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const open = () => { viewYear = selected().y; renderPop(); pop.hidden = false; cur.setAttribute('aria-expanded', 'true'); };
    function close() { pop.hidden = true; cur.setAttribute('aria-expanded', 'false'); }

    wrap.addEventListener('click', (e) => {
      const step = e.target.closest('[data-step]');
      if (step) { pick(addMonths(selected(), Number(step.dataset.step))); return; }
      if (e.target.closest('.se-mp-current')) { pop.hidden ? open() : close(); return; }
      const yr = e.target.closest('[data-year]');
      if (yr) { viewYear += Number(yr.dataset.year); renderPop(); return; }
      const mo = e.target.closest('[data-month]');
      if (mo) { pick({ y: viewYear, m: Number(mo.dataset.month) }); return; }
      if (e.target.closest('.se-mp-today')) { pick(todayYM()); }
    });
    document.addEventListener('click', (e) => { if (!pop.hidden && !wrap.contains(e.target)) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { close(); cur.focus(); } });

    // 前月/翌月ボタンなど、他の処理が input.value を書き換えたら表示を合わせる
    renderCurrent();
    let last = input.value;
    setInterval(() => { if (input.value !== last) { last = input.value; renderCurrent(); if (!pop.hidden) renderPop(); } }, 300);
  }

  function init() { mount(document.getElementById('monthPicker2')); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
