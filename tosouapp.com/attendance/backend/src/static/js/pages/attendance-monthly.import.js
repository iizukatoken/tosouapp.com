// 入力用Excel取込: ① ファイル選択 → ② 変更内容の確認 → ③ 取込完了 のダイアログ。
// サーバー: POST /api/attendance/month/import（apply なし = 確認だけ、apply=1 = 保存）
(function () {
  'use strict';
  // 読み込み順に依存しないよう、使うときに取る（controller はこのファイルより後に読み込まれる）
  const root = () => globalThis.AttendanceMonthly || {};
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const getCookie = (n) => { const m = document.cookie.match(new RegExp(`(^| )${n}=([^;]+)`)); return m ? decodeURIComponent(m[2]) : ''; };
  const DOW = ['日', '月', '火', '水', '木', '金', '土'];
  const fmtDate = (ds) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ds || ''))) return '';
    const d = new Date(`${ds}T00:00:00Z`);
    return `${Number(ds.slice(5, 7))}/${Number(ds.slice(8, 10))}(${DOW[d.getUTCDay()]})`;
  };
  const shorten = (s, n = 28) => { const t = String(s || '').replace(/\s+/g, ' '); return t.length > n ? `${t.slice(0, n)}…` : t; };

  let dlg = null;
  let file = null;
  let busy = false;

  function currentYM() {
    const v = String(($('#monthPicker2') || $('#monthPicker'))?.value || '');
    const m = /^(\d{4})-(\d{2})$/.exec(v);
    return m ? { y: Number(m[1]), m: Number(m[2]) } : null;
  }

  async function send(apply) {
    const ym = currentYM();
    if (!ym) throw new Error('対象年月が読み取れません。');
    const qs = new URLSearchParams({ year: String(ym.y), month: String(ym.m) });
    const acting = root().Controller?.ctx?.actingUserId;
    if (acting) qs.set('userId', String(acting));
    if (apply) qs.set('apply', '1');
    const fd = new FormData();
    fd.append('file', file, file.name);
    const token = sessionStorage.getItem('accessToken') || '';
    const res = await fetch(`/api/attendance/month/import?${qs}`, {
      method: 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'X-CSRF-Token': getCookie('csrfToken') },
      credentials: 'include',
      body: fd
    });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      if (res.status === 401) throw new Error('ログインの有効期限が切れました。画面を再読み込みしてください。');
      throw new Error(data?.message || `取込に失敗しました（${res.status}）`);
    }
    return data;
  }

  function build() {
    dlg = document.createElement('div');
    dlg.className = 'se-imp-ov';
    dlg.hidden = true;
    dlg.innerHTML = `
      <div class="se-imp" role="dialog" aria-modal="true" aria-labelledby="seImpTitle">
        <div class="se-imp-h"><h3 id="seImpTitle"></h3><button type="button" class="se-imp-x" aria-label="閉じる">✕</button></div>
        <div class="se-imp-steps"><div data-s="1">① ファイル選択</div><div data-s="2">② 内容の確認</div><div data-s="3">③ 取込完了</div></div>
        <div class="se-imp-b"></div>
        <div class="se-imp-err" hidden></div>
        <div class="se-imp-f"></div>
      </div>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('click', onClick);
    dlg.addEventListener('dragover', (e) => { const z = e.target.closest('.se-imp-drop'); if (z) { e.preventDefault(); z.classList.add('is-over'); } });
    dlg.addEventListener('dragleave', (e) => { const z = e.target.closest('.se-imp-drop'); if (z) z.classList.remove('is-over'); });
    dlg.addEventListener('drop', (e) => {
      const z = e.target.closest('.se-imp-drop');
      if (!z) return;
      e.preventDefault();
      z.classList.remove('is-over');
      const f = e.dataTransfer?.files?.[0];
      if (f) choose(f);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && dlg && !dlg.hidden && !busy) close(); });
  }

  function setStep(n) {
    dlg.querySelectorAll('.se-imp-steps [data-s]').forEach((el) => {
      const s = Number(el.dataset.s);
      el.className = s < n ? 'done' : s === n ? 'on' : '';
      if (s < n) el.textContent = el.textContent.replace(/^[①②③]/, '✓');
    });
  }
  function showErr(msg) { const e = $('.se-imp-err', dlg); e.textContent = msg || ''; e.hidden = !msg; }
  function footer(html) { $('.se-imp-f', dlg).innerHTML = html; }

  function step1() {
    file = null;
    dlg.querySelectorAll('.se-imp-steps [data-s]').forEach((el, i) => { el.textContent = ['① ファイル選択', '② 内容の確認', '③ 取込完了'][i]; });
    setStep(1);
    showErr('');
    $('.se-imp-b', dlg).innerHTML = `
      <label class="se-imp-drop">
        <input type="file" accept=".xlsx" class="se-imp-file" hidden>
        <div class="se-imp-ic">📄</div>
        <div class="se-imp-t">入力用Excel をここにドラッグ＆ドロップ</div>
        <div class="se-imp-s">または <span class="se-imp-pick">ファイルを選択</span></div>
        <div class="se-imp-s">.xlsx・10MB まで（「入力用Excel出力」で作ったファイル）</div>
        <div class="se-imp-chosen" hidden></div>
      </label>
      <ul class="se-imp-note">
        <li>取込前に、変更される内容を一覧で確認できます（この時点ではまだ保存されません）。</li>
        <li>取り込む項目: 勤務区分・出社/在宅/現場・現場（任意）・作業内容・備考・打刻のない日の開始/終了時刻。</li>
        <li>打刻済みの 出勤/退勤 時刻は取り込みません（変更は調整申請で）。</li>
      </ul>`;
    $('.se-imp-file', dlg).addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) choose(f); });
    footer('<button type="button" class="se-imp-btn" data-act="close">キャンセル</button><button type="button" class="se-imp-btn primary" data-act="preview" disabled>次へ</button>');
  }

  function choose(f) {
    showErr('');
    if (!/\.xlsx$/i.test(f.name)) { showErr('選択されたファイルが正しくありません（.xlsx のみ）。'); return; }
    if (f.size > 10 * 1024 * 1024) { showErr('入力用Excelのファイルサイズが10MBを超過しているため取り込めません。'); return; }
    file = f;
    const c = $('.se-imp-chosen', dlg);
    c.hidden = false;
    c.textContent = `選択中: ${f.name}（${Math.max(1, Math.round(f.size / 1024))} KB）`;
    $('[data-act="preview"]', dlg).disabled = false;
  }

  function changeRow(c) {
    const from = c.from ? esc(shorten(c.from)) : '（空）';
    return `<tr><td>${esc(fmtDate(c.date))}</td><td>${esc(c.fieldLabel)}</td><td><span class="old">${from}</span> → <span class="new">${esc(shorten(c.to) || '（空）')}</span></td></tr>`;
  }
  function skipRow(s) {
    return `<tr class="skip"><td>${esc(fmtDate(s.date))}</td><td>${esc(s.fieldLabel)}</td><td>⚠ ${esc(s.reason)}</td></tr>`;
  }

  async function step2() {
    setBusy(true, '確認中…');
    try {
      const r = await send(false);
      setStep(2);
      const ch = r.changes || [];
      const sk = r.skipped || [];
      $('.se-imp-b', dlg).innerHTML = `
        <div class="se-imp-file-line">📄 <b>${esc(file.name)}</b></div>
        <div class="se-imp-sum"><span class="pill">変更 ${ch.length}件</span>${sk.length ? `<span class="pill w">取り込まない ${sk.length}件</span>` : ''}</div>
        ${ch.length || sk.length ? `<div class="se-imp-tw"><table><thead><tr><th style="width:84px">日付</th><th style="width:110px">項目</th><th>現在 → 取込後</th></tr></thead>
          <tbody>${ch.map(changeRow).join('')}${sk.map(skipRow).join('')}</tbody></table></div>`
        : '<div class="se-imp-empty">変更はありません（ファイルの内容は今のデータと同じです）。</div>'}`;
      footer(`<button type="button" class="se-imp-btn" data-act="back">戻る</button>
        <button type="button" class="se-imp-btn primary" data-act="apply" ${ch.length ? '' : 'disabled'}>${ch.length}件を取り込む</button>`);
    } catch (e) {
      showErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function step3() {
    if (!confirm('変更内容を取り込みます。よろしいですか？')) return;
    setBusy(true, '取り込み中…');
    try {
      const r = await send(true);
      setStep(3);
      $('.se-imp-b', dlg).innerHTML = `<div class="se-imp-done">✓ ${Number(r.saved || 0)}件を取り込みました。</div>
        ${(r.skipped || []).length ? `<div class="se-imp-s" style="text-align:center">取り込まなかった項目: ${(r.skipped || []).length}件</div>` : ''}`;
      footer('<button type="button" class="se-imp-btn primary" data-act="finish">閉じる</button>');
    } catch (e) {
      showErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  function setBusy(on, label) {
    busy = on;
    dlg.querySelectorAll('.se-imp-f button').forEach((b) => { b.disabled = on || b.dataset.locked === '1'; });
    const p = $('[data-act="preview"], [data-act="apply"]', dlg);
    if (p && on) { p.dataset.label = p.textContent; p.textContent = label; }
    else if (p && p.dataset.label) { p.textContent = p.dataset.label; delete p.dataset.label; }
  }

  async function onClick(e) {
    if (busy) return;
    if (e.target === dlg || e.target.closest('.se-imp-x')) { close(); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') close();
    else if (act === 'preview' && file) step2();
    else if (act === 'back') step1();
    else if (act === 'apply') step3();
    else if (act === 'finish') {
      close();
      try { await root().Controller?.reloadMonth?.(); } catch (err) { location.reload(); }
    }
  }

  function close() { if (dlg) dlg.hidden = true; }

  function open() {
    if (root().State?.dirty && !confirm('保存されていない変更があります。取込の前に「保存」してください。\nこのまま続けますか？（保存していない変更は取込後の再読み込みで消えます）')) return;
    if (!dlg) build();
    const ym = currentYM();
    $('#seImpTitle', dlg).textContent = `入力用Excel取込（${ym ? `${ym.y}年${ym.m}月` : ''}）`;
    step1();
    dlg.hidden = false;
  }

  globalThis.MonthlyImport = { open };
})();
