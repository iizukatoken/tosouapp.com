// 交通費申請 (社員画面) — シンプルでクラシックな画面。expenses.page.js の処理は変えずに上に重ねる。
//
//   一覧: 「新規申請」ボタン + 件数 1 行 + 最近の申請の表 (従来のカード・サイドメニュー・年選択は隠す)
//   入力: 1 枚のフォーム (前回と同じ・日付・種別・区間・片道/往復・金額・用途、任意項目は「詳細」)
//   送信: 「申請する」1 回で送信 (= 明細を作成 → その月を申請。従来の 内容確認→申請 と同じ API)
//
// 添付ファイル・物品購入・別の月の申請・月別の詳細は「従来の画面」リンクから今までどおり使える。
import { fetchJSONAuth } from '/static/js/api/http.api.js?v=20260416-1';

const $ = (id) => document.getElementById(id);
const todayJST = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const yen = (n) => Math.round(Number(n) || 0).toLocaleString('ja-JP') + '円';
const TYPES = [['train', '電車'], ['bus', 'バス'], ['taxi', 'タクシー'], ['car', '自家用車'], ['parking', '駐車場代'], ['highway', '高速料金']];
const TYPE_NAME = Object.fromEntries([...TYPES, ['goods', '物品購入']]);
const STATUS = {
  draft: ['下書き', '#6b7280'], pending: ['下書き', '#6b7280'],
  applied: ['申請中', '#b45309'], soumu_checked: ['総務確認済み', '#1d4ed8'],
  approved: ['承認済み', '#15803d'], paid: ['支給済み', '#374151'], rejected: ['差戻し', '#b91c1c'],
};

// ---------------- スタイル ----------------
const NAVY = '#0b2c66';
function ensureStyle() {
  if ($('qxStyle')) return;
  const st = document.createElement('style');
  st.id = 'qxStyle';
  st.textContent = `
    /* かんたん画面のときは従来の部品を隠す */
    body.qx-simple #exSummaryCards, body.qx-simple #exMonthlyBoardHost,
    body.qx-simple #exListWrapper, body.qx-simple #exListHost,
    body.qx-simple .expense-side-tabs, body.qx-simple #expToggleSidebarBtn,
    body.qx-simple .expense-standalone-header-center { display: none !important; }
    body.qx-simple .expense-layout { padding-left: 0 !important; transform: none !important; }
    body.qx-simple .expense-main { background: #fff !important; }
    #historySection:not(.applied-month-mode) #qxHome, body:not(.qx-simple) #qxHome,
    body:not(.qx-simple) #qxHeaderTitle { display: none !important; }

    .qx { font-size: 14px; color: #1f2937; max-width: 880px; margin: 0 auto; }
    .qx-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 4px 0 6px; }
    .qx-h { font-size: 16px; font-weight: 700; margin: 0; }
    .qx-btn { height: 34px; padding: 0 14px; font-size: 14px; border: 1px solid #9ca3af; background: #fff; color: #1f2937; border-radius: 3px; cursor: pointer; }
    .qx-btn:hover { background: #f3f4f6; }
    .qx-btn.primary { background: ${NAVY}; border-color: ${NAVY}; color: #fff; font-weight: 600; }
    .qx-btn.primary:hover { background: #092352; }
    .qx-btn:disabled { opacity: .6; cursor: default; }
    .qx-sub { font-size: 13px; color: #6b7280; margin: 0 0 10px; }
    .qx-table { width: 100%; border-collapse: collapse; border: 1px solid #d1d5db; background: #fff; }
    .qx-table th { background: #f3f4f6; font-weight: 600; font-size: 13px; text-align: left; padding: 8px 10px; border-bottom: 1px solid #d1d5db; white-space: nowrap; }
    .qx-table td { padding: 8px 10px; border-top: 1px solid #e5e7eb; vertical-align: top; }
    .qx-table .num { text-align: right; white-space: nowrap; }
    .qx-table .note { font-size: 12px; color: #b91c1c; margin-top: 2px; }
    .qx-links { font-size: 13px; margin: 10px 0 20px; color: #6b7280; }
    .qx-links a { color: ${NAVY}; }
    @media (max-width: 600px) {
      .qx { padding: 0 12px; }
      .qx-table .col-type { display: none; }
      .qx-table th, .qx-table td { padding: 7px 6px; font-size: 13px; }
    }

    .qx-overlay { display: none; position: fixed; inset: 0; z-index: 10050; background: rgba(0,0,0,.4); overflow: auto; }
    .qx-dialog { background: #fff; width: min(560px, 94vw); margin: 6vh auto 24px; border: 1px solid #9ca3af; border-radius: 4px; box-shadow: 0 8px 24px rgba(0,0,0,.18); font-size: 14px; color: #1f2937; }
    .qx-dialog-head { display: flex; justify-content: space-between; align-items: center; background: #f3f4f6; border-bottom: 1px solid #d1d5db; padding: 10px 14px; font-weight: 700; font-size: 15px; }
    .qx-close { border: none; background: none; font-size: 20px; line-height: 1; cursor: pointer; color: #4b5563; }
    .qx-form { display: grid; grid-template-columns: 96px 1fr; gap: 10px 12px; align-items: center; padding: 16px 14px; }
    .qx-form .l { font-size: 13px; color: #374151; }
    .qx-form .req::after { content: ' *'; color: #b91c1c; }
    .qx-in { height: 34px; width: 100%; box-sizing: border-box; border: 1px solid #9ca3af; border-radius: 3px; padding: 0 8px; font-size: 14px; background: #fff; color: #1f2937; }
    .qx-in:focus { outline: 2px solid ${NAVY}33; border-color: ${NAVY}; }
    .qx-route { display: flex; align-items: center; gap: 6px; }
    .qx-radio { display: flex; gap: 18px; }
    .qx-radio label { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
    .qx-amount { display: flex; align-items: center; gap: 6px; max-width: 200px; }
    .qx-more { grid-column: 1 / -1; border-top: 1px dashed #d1d5db; padding-top: 8px; }
    .qx-more summary { cursor: pointer; font-size: 13px; color: #374151; }
    .qx-more .qx-form { padding: 10px 0 0; }
    .qx-foot { display: flex; align-items: center; gap: 8px; border-top: 1px solid #d1d5db; padding: 10px 14px; background: #fafafa; }
    .qx-err { flex: 1; color: #b91c1c; font-size: 13px; }
    @media (max-width: 600px) {
      .qx-form { grid-template-columns: 1fr; gap: 4px; }
      .qx-form .l { margin-top: 8px; }
      .qx-dialog { margin-top: 2vh; }
      .qx-foot { flex-wrap: wrap; position: sticky; bottom: 0; }
      .qx-err { flex-basis: 100%; }
    }
    .qx-toast { position: fixed; right: 16px; bottom: 16px; background: #374151; color: #fff; padding: 10px 14px; border-radius: 3px; font-size: 13px; z-index: 10060; }`;
  document.head.appendChild(st);
}

// ---------------- データ ----------------
let myRows = null;
let myRowsAt = 0;
async function loadMine(force = false) {
  if (!force && myRows && Date.now() - myRowsAt < 30_000) return myRows;
  try {
    const rows = await fetchJSONAuth('/api/expenses/my');
    myRows = Array.isArray(rows) ? rows : [];
  } catch (e) {
    myRows = myRows || [];
  }
  myRowsAt = Date.now();
  return myRows;
}
const byNewest = (a, b) => String(b.date || '').localeCompare(String(a.date || '')) || Number(b.id) - Number(a.id);

function recentRoutes(rows) {
  const seen = new Set();
  const out = [];
  for (const r of [...rows].filter((x) => x.type !== 'goods' && (x.origin || x.destination)).sort(byNewest)) {
    const key = [r.type, r.origin, r.destination, r.trip_type, Number(r.amount)].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= 5) break;
  }
  return out;
}
const tripName = (t) => (t === 'round_trip' ? '往復' : t === 'multi' ? '複数' : '片道');

// ---------------- 一覧 ----------------
function renderHome() {
  const host = $('historySection');
  if (!host) return;
  ensureStyle();
  // ヘッダーにページ名 (サイドメニューを隠すため)
  const left = document.querySelector('.expense-standalone-header-left');
  if (left && !$('qxHeaderTitle')) {
    const t = document.createElement('span');
    t.id = 'qxHeaderTitle';
    t.textContent = '交通費申請';
    t.style.cssText = 'font-size:16px;font-weight:700;color:#1f2937;';
    left.appendChild(t);
  }
  let home = $('qxHome');
  if (!home) {
    home = document.createElement('div');
    home.id = 'qxHome';
    home.className = 'qx';
    host.insertBefore(home, host.firstChild);
  }
  home.innerHTML = `
    <div class="qx-bar">
      <h2 class="qx-h">申請一覧</h2>
      <button type="button" class="qx-btn primary" id="qxNewBtn">新規申請</button>
    </div>
    <p class="qx-sub" id="qxCounts"></p>
    <div id="qxList"><p class="qx-sub">読み込み中…</p></div>
    <div class="qx-links">
      添付ファイル・物品購入・他の月の申請・月別の詳細は <a href="#" id="qxShowOld">従来の画面</a> から行えます。
    </div>`;
  $('qxNewBtn').addEventListener('click', () => openForm());
  $('qxShowOld').addEventListener('click', (e) => { e.preventDefault(); toggleOldHome(true); });
  toggleOldHome(false);
  refreshList();
}

function toggleOldHome(show) {
  ensureStyle();
  document.body.classList.toggle('qx-simple', !show);
  if (show) {
    if (!$('qxBackSimple')) {
      const a = document.createElement('a');
      a.href = '#';
      a.id = 'qxBackSimple';
      a.textContent = '← かんたん画面に戻る';
      a.style.cssText = `display:inline-block;margin:0 0 12px;font-size:14px;color:${NAVY};`;
      a.addEventListener('click', (e) => { e.preventDefault(); toggleOldHome(false); });
      $('historySection')?.insertBefore(a, $('historySection').firstChild);
    }
    $('qxBackSimple').style.display = '';
  } else if ($('qxBackSimple')) {
    $('qxBackSimple').style.display = 'none';
  }
}

async function refreshList(force = false) {
  const list = $('qxList');
  if (!list) return;
  const rows = (await loadMine(force)).slice().sort(byNewest);
  const count = (st) => rows.filter((r) => st.includes(String(r.status))).length;
  const rejected = count(['rejected']);
  $('qxCounts').innerHTML = `申請中 ${count(['applied', 'soumu_checked'])}件 ／ 承認済み ${count(['approved'])}件`
    + (rejected ? ` ／ <span style="color:#b91c1c;font-weight:600;">差戻し ${rejected}件</span>` : '');
  if (!rows.length) {
    list.innerHTML = '<p class="qx-sub">まだ申請はありません。「新規申請」から申請してください。</p>';
    return;
  }
  list.innerHTML = `
    <table class="qx-table">
      <thead><tr><th>日付</th><th>区間</th><th class="col-type">種別</th><th class="num">金額</th><th>状態</th></tr></thead>
      <tbody>
        ${rows.slice(0, 10).map((r) => {
          const [label, color] = STATUS[String(r.status)] || [String(r.status || ''), '#374151'];
          const route = r.type === 'goods' ? esc(r.item_name || '物品購入') : `${esc(r.origin)} → ${esc(r.destination)}`;
          const note = r.status === 'rejected' && r.manager_note ? `<div class="note">理由：${esc(r.manager_note)}</div>` : '';
          return `<tr>
            <td style="white-space:nowrap;">${esc(String(r.date || '').slice(5, 10).replace('-', '/'))}</td>
            <td>${route}${note}</td>
            <td class="col-type">${esc(TYPE_NAME[r.type] || '')}</td>
            <td class="num">${yen(r.amount)}</td>
            <td style="white-space:nowrap;color:${color};">${esc(label)}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

// ---------------- 入力フォーム ----------------
function ensureForm() {
  if ($('qxModal')) return;
  ensureStyle();
  const m = document.createElement('div');
  m.id = 'qxModal';
  m.className = 'qx-overlay';
  m.innerHTML = `
    <div class="qx-dialog" role="dialog" aria-labelledby="qxTitle">
      <div class="qx-dialog-head"><span id="qxTitle">交通費の申請</span><button type="button" class="qx-close" id="qxClose" aria-label="閉じる">×</button></div>
      <div class="qx-form">
        <label class="l" for="qxRecent" id="qxRecentLabel">前回と同じ</label>
        <select class="qx-in" id="qxRecent"><option value="">選択すると下の項目に入力されます</option></select>
        <label class="l req" for="qxDate">日付</label>
        <input class="qx-in" id="qxDate" type="date" style="max-width:200px;">
        <label class="l req" for="qxType">種別</label>
        <select class="qx-in" id="qxType" style="max-width:200px;">${TYPES.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select>
        <label class="l req" for="qxOrigin">区間</label>
        <div class="qx-route">
          <input class="qx-in" id="qxOrigin" type="text" placeholder="出発地">
          <span>→</span>
          <input class="qx-in" id="qxDest" type="text" placeholder="到着地">
        </div>
        <span class="l req">片道/往復</span>
        <div class="qx-radio">
          <label><input type="radio" name="qxTrip" value="one_way" checked> 片道</label>
          <label><input type="radio" name="qxTrip" value="round_trip"> 往復</label>
        </div>
        <label class="l req" for="qxAmount">金額</label>
        <div class="qx-amount"><input class="qx-in" id="qxAmount" type="text" inputmode="numeric" placeholder="0" style="text-align:right;"><span>円</span></div>
        <label class="l req" for="qxPurpose">用途</label>
        <input class="qx-in" id="qxPurpose" type="text" placeholder="例）〇〇現場、A社訪問">
        <details class="qx-more" id="qxMore">
          <summary>詳細（任意）</summary>
          <div class="qx-form">
            <label class="l" for="qxVia">経由</label><input class="qx-in" id="qxVia" type="text">
            <label class="l" for="qxSite">現場名</label><input class="qx-in" id="qxSite" type="text">
            <label class="l" for="qxMemo">メモ</label><input class="qx-in" id="qxMemo" type="text">
          </div>
        </details>
      </div>
      <div class="qx-foot">
        <div class="qx-err" id="qxErr"></div>
        <button type="button" class="qx-btn" id="qxCancel">キャンセル</button>
        <button type="button" class="qx-btn" id="qxDraft">下書き保存</button>
        <button type="button" class="qx-btn primary" id="qxSubmit">申請する</button>
      </div>
    </div>`;
  document.body.appendChild(m);
  $('qxClose').addEventListener('click', closeForm);
  $('qxCancel').addEventListener('click', closeForm);
  m.addEventListener('click', (e) => { if (e.target === m) closeForm(); });
  $('qxAmount').addEventListener('input', () => {
    const digits = String($('qxAmount').value).replace(/[^\d]/g, '');
    $('qxAmount').value = digits ? Number(digits).toLocaleString('ja-JP') : '';
  });
  $('qxRecent').addEventListener('change', () => {
    const r = recentList[Number($('qxRecent').value)];
    if ($('qxRecent').value !== '' && r) fillFrom(r);
  });
  $('qxSubmit').addEventListener('click', () => submit(true));
  $('qxDraft').addEventListener('click', () => submit(false));
}

const tripValue = () => document.querySelector('input[name="qxTrip"]:checked')?.value || 'one_way';
function setTrip(v) { const el = document.querySelector(`input[name="qxTrip"][value="${v === 'round_trip' ? 'round_trip' : 'one_way'}"]`); if (el) el.checked = true; }

let recentList = [];
function fillFrom(r) {
  $('qxType').value = TYPES.some(([v]) => v === r.type) ? r.type : 'train';
  setTrip(r.trip_type);
  $('qxOrigin').value = r.origin || '';
  $('qxDest').value = r.destination || '';
  $('qxAmount').value = Math.round(Number(r.amount) || 0).toLocaleString('ja-JP');
  $('qxPurpose').value = r.purpose || '';
  $('qxVia').value = r.via || '';
  $('qxSite').value = r.site_name || '';
  $('qxMore').open = !!(r.via || r.site_name);
  $('qxErr').textContent = '';
}

async function openForm() {
  ensureForm();
  $('qxDate').value = todayJST();
  $('qxType').value = 'train';
  setTrip('one_way');
  for (const id of ['qxOrigin', 'qxDest', 'qxAmount', 'qxPurpose', 'qxVia', 'qxSite', 'qxMemo']) $(id).value = '';
  $('qxMore').open = false;
  $('qxErr').textContent = '';
  $('qxModal').style.display = 'block';
  recentList = recentRoutes(await loadMine());
  const sel = $('qxRecent');
  sel.innerHTML = '<option value="">選択すると下の項目に入力されます</option>'
    + recentList.map((r, i) => `<option value="${i}">${esc(r.origin)} → ${esc(r.destination)}（${tripName(r.trip_type)}・${yen(r.amount)}）</option>`).join('');
  const hasRecent = recentList.length > 0;
  sel.style.display = hasRecent ? '' : 'none';
  $('qxRecentLabel').style.display = hasRecent ? '' : 'none';
}

function closeForm() { const m = $('qxModal'); if (m) m.style.display = 'none'; }

async function submit(apply) {
  const err = $('qxErr');
  err.textContent = '';
  const date = String($('qxDate').value || '');
  const origin = $('qxOrigin').value.trim();
  const destination = $('qxDest').value.trim();
  const purpose = $('qxPurpose').value.trim();
  const amount = Number(String($('qxAmount').value).replace(/[^\d]/g, '')) || 0;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { err.textContent = '日付を入力してください。'; return; }
  if (!origin || !destination) { err.textContent = '出発地と到着地を入力してください。'; return; }
  if (!amount) { err.textContent = '金額を入力してください。'; return; }
  if (!purpose) { err.textContent = '用途を入力してください。'; return; }
  const month = date.slice(0, 7);

  // その月に下書きが残っていれば、一緒に申請されることを確認する (従来の「申請」と同じく月単位で送るため)
  if (apply) {
    const otherDrafts = (await loadMine(true)).filter((r) => String(r.date || '').slice(0, 7) === month && ['draft', 'pending'].includes(String(r.status)));
    if (otherDrafts.length && !window.confirm(`${month.replace('-', '年')}月の下書き ${otherDrafts.length} 件も一緒に申請されます。よろしいですか？`)) return;
  }

  const btns = [$('qxSubmit'), $('qxDraft'), $('qxCancel')];
  btns.forEach((b) => { b.disabled = true; });
  const label = (apply ? $('qxSubmit') : $('qxDraft'));
  const original = label.textContent;
  label.textContent = apply ? '申請中…' : '保存中…';
  try {
    await fetchJSONAuth('/api/expenses', {
      method: 'POST',
      body: JSON.stringify({
        date, type: $('qxType').value, origin, destination, tripType: tripValue(), tripCount: 1, purpose, amount,
        via: $('qxVia').value.trim(), siteName: $('qxSite').value.trim(), memo: $('qxMemo').value.trim(),
        teiki: false, clientToken: `qx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      }),
    });
    if (apply) await fetchJSONAuth('/api/expenses/months/apply', { method: 'POST', body: JSON.stringify({ month }) });
    closeForm();
    await refreshList(true);
    toast(apply ? '申請しました。' : '下書きに保存しました。');
  } catch (e) {
    err.textContent = (e && e.message) || '送信に失敗しました。もう一度お試しください。';
  } finally {
    btns.forEach((b) => { b.disabled = false; });
    label.textContent = original;
  }
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'qx-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

function boot() {
  try { ensureForm(); } catch (e) { /* 失敗しても従来の画面で使える */ }
  try { renderHome(); } catch (e) { /* ignore */ }
}

// ポータルからのソフト遷移 (portal.page.js) では bootExpensesQuick() を呼ぶ。直接開いたときは自動で起動。
export function bootExpensesQuick() { boot(); }

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
