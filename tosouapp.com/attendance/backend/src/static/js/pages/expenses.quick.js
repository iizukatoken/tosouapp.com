// 交通費申請 (社員画面) — シンプルでクラシックな 1 画面。従来の画面 (expenses.page.js) は隠して使わない。
//
//   一覧: 月ごとの表 (対象月・件数・合計金額・状態)。月を押すと明細。
//         下書き・差戻しの明細は「修正」「削除」、その月は「この月を申請する」。「印刷」で月別明細。
//   入力: 1 枚のフォーム (日付・種別・区間・片道/往復・金額・用途・領収書、物品購入は 品名・購入先)
//   送信: 「申請する」= 保存 → その月を申請 (従来の 内容確認→申請 と同じ API)
import { fetchJSONAuth } from '/static/js/api/http.api.js?v=20260416-1';

const $ = (id) => document.getElementById(id);
const todayJST = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const yen = (n) => Math.round(Number(n) || 0).toLocaleString('ja-JP') + '円';
const TYPES = [['train', '電車'], ['bus', 'バス'], ['taxi', 'タクシー'], ['car', '自家用車'], ['parking', '駐車場代'], ['highway', '高速料金'], ['goods', '物品購入']];
const TYPE_NAME = Object.fromEntries(TYPES);
const STATUS = {
  draft: ['下書き', '#6b7280'], pending: ['下書き', '#6b7280'],
  applied: ['申請中', '#b45309'], soumu_checked: ['総務確認済み', '#1d4ed8'],
  approved: ['承認済み', '#15803d'], paid: ['支給済み', '#374151'], rejected: ['差戻し', '#b91c1c'],
};
// 社員が修正・削除・再申請できる状態 (サーバー側の制限と同じ)
const EDITABLE = new Set(['draft', 'pending', 'rejected']);
// 添付ファイルの制限 (サーバー側 uploadR2.js と同じ): 画像または PDF、1 件 10MB まで、1 申請 8 件まで
const MAX_FILES = 8;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

// ---------------- スタイル ----------------
const NAVY = '#0b2c66';
function ensureStyle() {
  if ($('qxStyle')) return;
  const st = document.createElement('style');
  st.id = 'qxStyle';
  st.textContent = `
    /* 従来の画面の部品はすべて隠す */
    body.qx-simple #homeSection, body.qx-simple #historySection, body.qx-simple #helpSection,
    body.qx-simple #monthSelectModal, body.qx-simple #exItemModal,
    body.qx-simple .expense-side-tabs, body.qx-simple #expToggleSidebarBtn,
    body.qx-simple .expense-standalone-header-center { display: none !important; }
    body.qx-simple .expense-layout { padding-left: 0 !important; transform: none !important; }
    body.qx-simple .expense-main { background: #fff !important; }

    .qx { font-size: 14px; color: #1f2937; max-width: 880px; margin: 0 auto; }
    .qx-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 4px 0 10px; }
    .qx-h { font-size: 16px; font-weight: 700; margin: 0; }
    .qx-btn { height: 34px; padding: 0 14px; font-size: 14px; border: 1px solid #9ca3af; background: #fff; color: #1f2937; border-radius: 3px; cursor: pointer; }
    .qx-btn:hover { background: #f3f4f6; }
    .qx-btn.primary { background: ${NAVY}; border-color: ${NAVY}; color: #fff; font-weight: 600; }
    .qx-btn.primary:hover { background: #092352; }
    .qx-btn.small { height: 26px; padding: 0 8px; font-size: 12px; }
    .qx-btn:disabled { opacity: .6; cursor: default; }
    .qx-sub { font-size: 13px; color: #6b7280; margin: 0 0 10px; }
    .qx-notice { font-size: 13px; color: #b91c1c; margin: 0 0 10px; }
    .qx-table { width: 100%; border-collapse: collapse; border: 1px solid #d1d5db; background: #fff; }
    .qx-table th { background: #f3f4f6; font-weight: 600; font-size: 13px; text-align: left; padding: 8px 10px; border-bottom: 1px solid #d1d5db; white-space: nowrap; }
    .qx-table td { padding: 8px 10px; border-top: 1px solid #e5e7eb; vertical-align: top; }
    .qx-table .num { text-align: right; white-space: nowrap; }
    .qx-table .note { font-size: 12px; color: #b91c1c; margin-top: 2px; }
    .qx-table .acts { white-space: nowrap; text-align: right; }
    .qx-table .acts .qx-btn + .qx-btn { margin-left: 4px; }
    .qx-month-row { cursor: pointer; }
    .qx-month-row:focus { outline: none; }
    .qx-month-row:focus-visible { outline: 2px solid ${NAVY}55; outline-offset: -2px; }
    .qx-month-row:hover td { background: #f9fafb; }
    .qx-month-row td { font-weight: 600; }
    .qx-caret { display: inline-block; width: 12px; color: #6b7280; }
    .qx-detail > td { padding: 0 0 10px 22px; background: #fafafa; }
    .qx-month-acts { display: flex; gap: 8px; justify-content: flex-end; align-items: center; padding: 8px 0; }
    .qx-month-acts a { font-size: 13px; color: ${NAVY}; }
    .qx-sub-table { border: none; border-left: 2px solid #d1d5db; background: #fff; }
    .qx-sub-table th { background: #fafafa; font-weight: 500; color: #4b5563; }
    .m-type { display: none; }
    @media (max-width: 600px) {
      .qx { padding: 0 12px 76px; }
      .qx-table .col-type { display: none; }
      .qx-table th, .qx-table td { padding: 9px 8px; font-size: 14px; }
      .qx-detail > td { padding: 0 0 8px; }
      .qx-month-acts { padding: 8px; justify-content: space-between; }
      /* 明細はカード状に: 1 行目 日付・種別 / 金額、2 行目 内容、3 行目 状態 / 操作 */
      .qx-table .col-cnt { display: none; }
      .qx-table .m-st { white-space: normal !important; font-size: 13px; }
      .qx-sub-table, .qx-sub-table tbody { display: block; width: 100%; }
      .qx-sub-table tr.qx-item td.col-type { display: none; }
      .qx-sub-table { border-left: none; }
      .qx-sub-table thead { display: none; }
      .qx-sub-table tr.qx-item { display: grid; grid-template-columns: 1fr auto; grid-template-areas: "date amt" "what what" "st acts"; gap: 2px 8px; padding: 10px 8px; border-top: 1px solid #e5e7eb; }
      .qx-sub-table tr.qx-item td { display: block; border: none; padding: 0; background: transparent !important; }
      .qx-sub-table .c-date { grid-area: date; color: #4b5563; font-size: 13px; }
      .qx-sub-table .m-type { display: inline; }
      .qx-sub-table .c-amt { grid-area: amt; font-weight: 700; }
      .qx-sub-table .c-what { grid-area: what; font-size: 15px; }
      .qx-sub-table .c-st { grid-area: st; font-size: 13px; align-self: center; }
      .qx-sub-table .c-acts { grid-area: acts; }
      .qx-btn.small { height: 32px; padding: 0 12px; font-size: 13px; }
      /* 新規申請は画面下に固定 (親指で押しやすい) */
      .qx-bar .qx-btn.primary { position: fixed; left: 12px; right: 12px; bottom: 12px; height: 48px; font-size: 16px; z-index: 40; box-shadow: 0 2px 8px rgba(0,0,0,.2); }
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
    .qx-hint { font-size: 12px; color: #6b7280; margin-top: 4px; }
    .qx-files { list-style: none; margin: 6px 0 0; padding: 0; font-size: 13px; }
    .qx-files li { display: flex; align-items: center; gap: 8px; padding: 3px 0; border-bottom: 1px dotted #e5e7eb; }
    .qx-files li span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .qx-files button { border: 1px solid #9ca3af; background: #fff; border-radius: 3px; font-size: 12px; padding: 1px 8px; cursor: pointer; }
    .qx-more { grid-column: 1 / -1; border-top: 1px dashed #d1d5db; padding-top: 8px; }
    .qx-more summary { cursor: pointer; font-size: 13px; color: #374151; }
    .qx-more .qx-form { padding: 10px 0 0; }
    .qx-foot { display: flex; align-items: center; gap: 8px; border-top: 1px solid #d1d5db; padding: 10px 14px; background: #fafafa; }
    .qx-err { flex: 1; color: #b91c1c; font-size: 13px; }
    .qx-hide { display: none !important; }
    @media (max-width: 600px) {
      .qx-overlay { background: #fff; }
      .qx-dialog { width: 100%; min-height: 100%; margin: 0; border: none; border-radius: 0; box-shadow: none; display: flex; flex-direction: column; }
      .qx-dialog-head { position: sticky; top: 0; z-index: 1; padding: 12px 14px; }
      .qx-form { grid-template-columns: 1fr; gap: 4px; flex: 1; }
      .qx-form .l { margin-top: 10px; font-size: 14px; }
      .qx-in { height: 44px; font-size: 16px; }
      .qx-amount { max-width: none; }
      .qx-radio { gap: 28px; font-size: 16px; padding: 6px 0; }
      .qx-radio input { width: 20px; height: 20px; }
      .qx-foot { position: sticky; bottom: 0; flex-wrap: wrap; padding: 10px 14px calc(10px + env(safe-area-inset-bottom)); }
      .qx-foot .qx-btn { flex: 1; height: 44px; font-size: 15px; }
      .qx-foot #qxSubmit { flex-basis: 100%; order: -1; }
      .qx-err { flex-basis: 100%; order: -2; }
    }
    @media (max-width: 600px) { .qx-toast { bottom: 76px !important; left: 12px; right: 12px !important; text-align: center; } }
    .qx-toast { position: fixed; right: 16px; bottom: 16px; background: #374151; color: #fff; padding: 10px 14px; border-radius: 3px; font-size: 13px; z-index: 10060; }`;
  document.head.appendChild(st);
}

// ---------------- データ ----------------
let myRows = [];
async function loadMine() {
  try {
    const rows = await fetchJSONAuth('/api/expenses/my');
    myRows = Array.isArray(rows) ? rows : [];
  } catch (e) { /* 取得できないときは前回の一覧のまま */ }
  return myRows;
}
const byNewest = (a, b) => String(b.date || '').localeCompare(String(a.date || '')) || Number(b.id) - Number(a.id);
const monthOf = (r) => String(r.date || '').slice(0, 7);

// ---------------- 一覧 (月ごと) ----------------
const openMonths = new Set();
let openMonthsInit = false;

function mountHome() {
  ensureStyle();
  document.body.classList.add('qx-simple');
  const left = document.querySelector('.expense-standalone-header-left');
  if (left && !$('qxHeaderTitle')) {
    const t = document.createElement('span');
    t.id = 'qxHeaderTitle';
    t.textContent = '交通費申請';
    t.style.cssText = 'font-size:16px;font-weight:700;color:#1f2937;';
    left.appendChild(t);
  }
  const main = document.querySelector('.expense-main');
  if (!main) return false;
  let home = $('qxHome');
  if (!home) {
    home = document.createElement('div');
    home.id = 'qxHome';
    home.className = 'qx';
    const header = main.querySelector('.expense-standalone-header');
    if (header && header.nextSibling) main.insertBefore(home, header.nextSibling);
    else main.appendChild(home);
  }
  home.innerHTML = `
    <div class="qx-bar">
      <h2 class="qx-h">申請一覧</h2>
      <button type="button" class="qx-btn primary" id="qxNewBtn">新規申請</button>
    </div>
    <p class="qx-notice" id="qxNotice" style="display:none;"></p>
    <div id="qxList"><p class="qx-sub">読み込み中…</p></div>`;
  $('qxNewBtn').addEventListener('click', () => openForm(null));
  $('qxList').addEventListener('click', onListClick);
  $('qxList').addEventListener('keydown', (e) => {
    const tr = e.target.closest('.qx-month-row');
    if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleMonth(tr.dataset.month); }
  });
  return true;
}

function monthStatus(items) {
  const st = items.map((r) => String(r.status));
  const has = (...k) => st.some((x) => k.includes(x));
  const all = (...k) => st.every((x) => k.includes(x));
  if (has('rejected')) return ['差戻しあり', '#b91c1c'];
  if (all('draft', 'pending')) return ['下書き', '#6b7280'];
  if (has('applied')) return [has('draft', 'pending') ? '申請中（下書きあり）' : '申請中', '#b45309'];
  if (has('draft', 'pending')) return ['一部下書き', '#6b7280'];
  if (has('soumu_checked')) return ['総務確認済み', '#1d4ed8'];
  if (all('paid')) return ['支給済み', '#374151'];
  if (all('approved', 'paid')) return ['承認済み', '#15803d'];
  return ['—', '#374151'];
}

function itemRows(items) {
  return items.map((r) => {
    const [label, color] = STATUS[String(r.status)] || [String(r.status || ''), '#374151'];
    const what = r.type === 'goods'
      ? `${esc(r.item_name || '物品購入')}${r.vendor ? `（${esc(r.vendor)}）` : ''}`
      : `${esc(r.origin)} → ${esc(r.destination)}`;
    const note = r.status === 'rejected' && r.manager_note ? `<div class="note">理由：${esc(r.manager_note)}</div>` : '';
    const files = Number(r.file_count || 0) > 0 ? ` <span style="font-size:12px;color:#6b7280;">（添付${Number(r.file_count)}件）</span>` : '';
    const acts = EDITABLE.has(String(r.status))
      ? `<button type="button" class="qx-btn small" data-edit="${r.id}">修正</button><button type="button" class="qx-btn small" data-del="${r.id}">削除</button>`
      : '';
    return `<tr class="qx-item">
      <td class="c-date" style="white-space:nowrap;">${esc(String(r.date || '').slice(5, 10).replace('-', '/'))}<span class="m-type"> ${esc(TYPE_NAME[r.type] || '')}</span></td>
      <td class="c-what">${what}${files}${note}</td>
      <td class="col-type">${esc(TYPE_NAME[r.type] || '')}</td>
      <td class="num c-amt">${yen(r.amount)}</td>
      <td class="c-st" style="white-space:nowrap;color:${color};">${esc(label)}</td>
      <td class="acts c-acts">${acts}</td>
    </tr>`;
  }).join('');
}

function renderList() {
  const list = $('qxList');
  if (!list) return;
  const rows = myRows.slice().sort(byNewest);
  const rejected = rows.filter((r) => String(r.status) === 'rejected').length;
  const notice = $('qxNotice');
  notice.textContent = rejected ? `差戻しが ${rejected} 件あります。該当する月を開いて理由を確認し、修正して再申請してください。` : '';
  notice.style.display = rejected ? '' : 'none';
  if (!rows.length) {
    list.innerHTML = '<p class="qx-sub">まだ申請はありません。「新規申請」から申請してください。</p>';
    return;
  }
  const byMonth = new Map();
  for (const r of rows) {
    const ym = monthOf(r);
    if (!byMonth.has(ym)) byMonth.set(ym, []);
    byMonth.get(ym).push(r);
  }
  const months = [...byMonth.keys()].sort().reverse();
  if (!openMonthsInit) { openMonths.add(months[0]); openMonthsInit = true; }
  list.innerHTML = `
    <table class="qx-table">
      <thead><tr><th>対象月</th><th class="num col-cnt">件数</th><th class="num">合計金額</th><th>状態</th></tr></thead>
      <tbody>
        ${months.map((ym) => {
          const items = byMonth.get(ym);
          const total = items.reduce((a, r) => a + (Number(r.amount) || 0), 0);
          const [label, color] = monthStatus(items);
          const open = openMonths.has(ym);
          const canApply = items.some((r) => EDITABLE.has(String(r.status)));
          return `<tr class="qx-month-row" data-month="${ym}" tabindex="0" role="button" aria-expanded="${open}">
              <td style="white-space:nowrap;"><span class="qx-caret">${open ? '▾' : '▸'}</span> ${ym.slice(0, 4)}年${ym.slice(5, 7)}月</td>
              <td class="num col-cnt">${items.length}件</td>
              <td class="num">${yen(total)}</td>
              <td class="m-st" style="white-space:nowrap;color:${color};">${esc(label)}</td>
            </tr>
            ${open ? `<tr class="qx-detail"><td colspan="4">
              <div class="qx-month-acts">
                <a href="/api/expenses/my/monthly-detail/print?month=${ym}" target="_blank" rel="noopener">精算書（PDF・印刷）</a>
                ${canApply ? `<button type="button" class="qx-btn primary small" data-apply-month="${ym}">この月を申請する</button>` : ''}
              </div>
              <table class="qx-table qx-sub-table">
                <thead><tr><th>日付</th><th>内容</th><th class="col-type">種別</th><th class="num">金額</th><th>状態</th><th></th></tr></thead>
                <tbody>${itemRows(items)}</tbody>
              </table>
            </td></tr>` : ''}`;
        }).join('')}
      </tbody>
    </table>`;
}

async function refreshList() {
  await loadMine();
  renderList();
}

function toggleMonth(ym) {
  if (openMonths.has(ym)) openMonths.delete(ym); else openMonths.add(ym);
  renderList();
}

async function onListClick(e) {
  const editBtn = e.target.closest('[data-edit]');
  if (editBtn) { const r = myRows.find((x) => String(x.id) === editBtn.dataset.edit); if (r) openForm(r); return; }
  const delBtn = e.target.closest('[data-del]');
  if (delBtn) { await deleteItem(delBtn.dataset.del); return; }
  const applyBtn = e.target.closest('[data-apply-month]');
  if (applyBtn) { await applyMonth(applyBtn.dataset.applyMonth, applyBtn); return; }
  if (e.target.closest('a')) return;
  const tr = e.target.closest('.qx-month-row');
  if (tr) toggleMonth(tr.dataset.month);
}

async function deleteItem(id) {
  const r = myRows.find((x) => String(x.id) === String(id));
  if (!r || !window.confirm(`${String(r.date || '').slice(0, 10)} の明細を削除しますか？`)) return;
  try {
    await fetchJSONAuth(`/api/expenses/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await refreshList();
    toast('削除しました。');
  } catch (e) {
    alert((e && e.message) || '削除に失敗しました。');
  }
}

async function applyMonth(ym, btn) {
  const items = myRows.filter((r) => monthOf(r) === ym && EDITABLE.has(String(r.status)));
  if (!items.length) return;
  if (!window.confirm(`${ym.slice(0, 4)}年${ym.slice(5, 7)}月の 下書き・差戻し ${items.length} 件を申請します。よろしいですか？`)) return;
  if (btn) btn.disabled = true;
  try {
    await fetchJSONAuth('/api/expenses/months/apply', { method: 'POST', body: JSON.stringify({ month: ym }) });
    await refreshList();
    toast('申請しました。');
  } catch (e) {
    alert((e && e.message) || '申請に失敗しました。');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ---------------- 入力フォーム ----------------
let editing = null; // 修正中の明細 (新規は null)

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
        <label class="l req" for="qxDate">日付</label>
        <input class="qx-in" id="qxDate" type="date" style="max-width:200px;">
        <label class="l req" for="qxType">種別</label>
        <select class="qx-in" id="qxType" style="max-width:200px;">${TYPES.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select>
        <label class="l req qx-trip-only" for="qxOrigin">区間</label>
        <div class="qx-route qx-trip-only">
          <input class="qx-in" id="qxOrigin" type="text" placeholder="出発地">
          <span>→</span>
          <input class="qx-in" id="qxDest" type="text" placeholder="到着地">
        </div>
        <span class="l req qx-trip-only">片道/往復</span>
        <div class="qx-radio qx-trip-only">
          <label><input type="radio" name="qxTrip" value="one_way" checked> 片道</label>
          <label><input type="radio" name="qxTrip" value="round_trip"> 往復</label>
        </div>
        <label class="l req qx-goods-only" for="qxItem">購入物品名</label>
        <input class="qx-in qx-goods-only" id="qxItem" type="text" placeholder="例）ビス・釘">
        <label class="l qx-goods-only" for="qxVendor">購入先</label>
        <input class="qx-in qx-goods-only" id="qxVendor" type="text" placeholder="例）〇〇ホームセンター">
        <label class="l req" for="qxAmount">金額</label>
        <div class="qx-amount"><input class="qx-in" id="qxAmount" type="text" inputmode="numeric" placeholder="0" style="text-align:right;"><span>円</span></div>
        <label class="l req" for="qxPurpose">用途</label>
        <input class="qx-in" id="qxPurpose" type="text" placeholder="例）〇〇現場、A社訪問">
        <label class="l" for="qxFiles">領収書・証憑</label>
        <div>
          <input id="qxFiles" type="file" accept="image/*,application/pdf" multiple style="font-size:13px;max-width:100%;">
          <div class="qx-hint">画像またはPDF（1件10MBまで・8件まで）。スマホではカメラで撮影できます。</div>
          <div class="qx-hint" id="qxExistingFiles"></div>
          <ul id="qxFileList" class="qx-files"></ul>
        </div>
        <details class="qx-more" id="qxMore">
          <summary>詳細（任意）</summary>
          <div class="qx-form">
            <label class="l qx-trip-only" for="qxVia">経由</label><input class="qx-in qx-trip-only" id="qxVia" type="text">
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
  $('qxType').addEventListener('change', applyTypeLayout);
  $('qxAmount').addEventListener('input', () => {
    const digits = String($('qxAmount').value).replace(/[^\d]/g, '');
    $('qxAmount').value = digits ? Number(digits).toLocaleString('ja-JP') : '';
  });
  $('qxFiles').addEventListener('change', () => {
    addFiles(Array.from($('qxFiles').files || []));
    $('qxFiles').value = ''; // 同じファイルを選び直せるように
  });
  $('qxFileList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-remove]');
    if (!b) return;
    pickedFiles.splice(Number(b.dataset.remove), 1);
    renderFiles();
  });
  $('qxSubmit').addEventListener('click', () => submit(true));
  $('qxDraft').addEventListener('click', () => submit(false));
}

const isGoods = () => $('qxType').value === 'goods';
function applyTypeLayout() {
  const goods = isGoods();
  document.querySelectorAll('#qxModal .qx-trip-only').forEach((el) => el.classList.toggle('qx-hide', goods));
  document.querySelectorAll('#qxModal .qx-goods-only').forEach((el) => el.classList.toggle('qx-hide', !goods));
}
const tripValue = () => document.querySelector('input[name="qxTrip"]:checked')?.value || 'one_way';
function setTrip(v) { const el = document.querySelector(`input[name="qxTrip"][value="${v === 'round_trip' ? 'round_trip' : 'one_way'}"]`); if (el) el.checked = true; }

// ---------------- 添付ファイル ----------------
let pickedFiles = [];
function addFiles(files) {
  const err = $('qxErr');
  err.textContent = '';
  const already = editing ? Number(editing.file_count || 0) : 0;
  for (const f of files) {
    const okType = String(f.type || '').startsWith('image/') || f.type === 'application/pdf';
    if (!okType) { err.textContent = `「${f.name}」は添付できません（画像またはPDFのみ）。`; continue; }
    if (f.size > MAX_FILE_BYTES) { err.textContent = `「${f.name}」は10MBを超えています。`; continue; }
    if (already + pickedFiles.length >= MAX_FILES) { err.textContent = `添付は${MAX_FILES}件までです。`; break; }
    pickedFiles.push(f);
  }
  renderFiles();
}
function renderFiles() {
  const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
  $('qxFileList').innerHTML = pickedFiles.map((f, i) =>
    `<li><span>${esc(f.name)}（${kb(f.size)}）</span><button type="button" data-remove="${i}">削除</button></li>`).join('');
}
async function uploadFiles(expenseId) {
  if (!pickedFiles.length) return;
  const fd = new FormData();
  for (const f of pickedFiles) fd.append('files', f, f.name);
  const token = (() => { try { return sessionStorage.getItem('accessToken') || localStorage.getItem('accessToken') || ''; } catch (e) { return ''; } })();
  const res = await fetch(`/api/expenses/${encodeURIComponent(expenseId)}/files`, {
    method: 'POST',
    body: fd,
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let msg = '';
    try { msg = (await res.json())?.message || ''; } catch (e) { /* ignore */ }
    throw new Error(msg || `HTTP ${res.status}`);
  }
}

function openForm(item) {
  ensureForm();
  editing = item || null;
  $('qxTitle').textContent = editing ? (String(editing.status) === 'rejected' ? '差戻しの修正' : '明細の修正') : '交通費の申請';
  $('qxDate').value = editing ? String(editing.date || '').slice(0, 10) : todayJST();
  $('qxType').value = editing && TYPE_NAME[editing.type] ? editing.type : 'train';
  setTrip(editing ? editing.trip_type : 'one_way');
  const v = (x) => (x == null ? '' : String(x));
  $('qxOrigin').value = editing ? v(editing.origin) : '';
  $('qxDest').value = editing ? v(editing.destination) : '';
  $('qxItem').value = editing ? v(editing.item_name) : '';
  $('qxVendor').value = editing ? v(editing.vendor) : '';
  $('qxAmount').value = editing ? Math.round(Number(editing.amount) || 0).toLocaleString('ja-JP') : '';
  $('qxPurpose').value = editing ? v(editing.purpose) : '';
  $('qxVia').value = editing ? v(editing.via) : '';
  $('qxSite').value = editing ? v(editing.site_name) : '';
  $('qxMemo').value = editing ? v(editing.memo) : '';
  $('qxMore').open = !!(editing && (editing.via || editing.site_name || editing.memo));
  const existing = editing ? Number(editing.file_count || 0) : 0;
  $('qxExistingFiles').textContent = existing ? `添付済み：${existing}件（追加するファイルを選択できます）` : '';
  pickedFiles = [];
  renderFiles();
  applyTypeLayout();
  $('qxErr').textContent = '';
  $('qxModal').style.display = 'block';
}

function closeForm() { const m = $('qxModal'); if (m) m.style.display = 'none'; editing = null; }

async function submit(apply) {
  const err = $('qxErr');
  err.textContent = '';
  const goods = isGoods();
  const date = String($('qxDate').value || '');
  const origin = $('qxOrigin').value.trim();
  const destination = $('qxDest').value.trim();
  const itemName = $('qxItem').value.trim();
  const purpose = $('qxPurpose').value.trim();
  const amount = Number(String($('qxAmount').value).replace(/[^\d]/g, '')) || 0;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { err.textContent = '日付を入力してください。'; return; }
  if (goods && !itemName) { err.textContent = '購入物品名を入力してください。'; return; }
  if (!goods && (!origin || !destination)) { err.textContent = '出発地と到着地を入力してください。'; return; }
  if (!amount) { err.textContent = '金額を入力してください。'; return; }
  if (!purpose) { err.textContent = '用途を入力してください。'; return; }
  const month = date.slice(0, 7);

  // その月にほかの下書き・差戻しが残っていれば、一緒に申請されることを確認する (申請は月単位のため)
  if (apply) {
    await loadMine();
    const others = myRows.filter((r) => monthOf(r) === month && EDITABLE.has(String(r.status)) && (!editing || String(r.id) !== String(editing.id)));
    if (others.length && !window.confirm(`${month.replace('-', '年')}月の 下書き・差戻し ${others.length} 件も一緒に申請されます。よろしいですか？`)) return;
  }

  const fields = {
    date, type: $('qxType').value, purpose, amount,
    origin: goods ? '' : origin, destination: goods ? '' : destination, via: goods ? '' : $('qxVia').value.trim(),
    siteName: $('qxSite').value.trim(), memo: $('qxMemo').value.trim(),
    itemName: goods ? itemName : '', vendor: goods ? $('qxVendor').value.trim() : '',
  };
  const btns = [$('qxSubmit'), $('qxDraft'), $('qxCancel')];
  btns.forEach((b) => { b.disabled = true; });
  const label = apply ? $('qxSubmit') : $('qxDraft');
  const original = label.textContent;
  label.textContent = apply ? '申請中…' : '保存中…';
  try {
    let id;
    if (editing) {
      id = editing.id;
      await fetchJSONAuth(`/api/expenses/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          date: fields.date, type: fields.type, category: fields.type, purpose: fields.purpose, amount: fields.amount,
          origin: fields.origin, destination: fields.destination, via: fields.via,
          trip_type: goods ? null : tripValue(), trip_count: 1,
          site_name: fields.siteName, memo: fields.memo, item_name: fields.itemName, vendor: fields.vendor,
        }),
      });
    } else {
      const created = await fetchJSONAuth('/api/expenses', {
        method: 'POST',
        body: JSON.stringify({
          ...fields, tripType: goods ? null : tripValue(), tripCount: 1, teiki: false,
          clientToken: `qx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        }),
      });
      id = created?.id;
    }
    // 領収書: 送れなかったら申請はせず下書きのまま (領収書なしで申請されるのを防ぐ)
    if (pickedFiles.length) {
      try {
        await uploadFiles(id);
      } catch (upErr) {
        closeForm();
        await refreshList();
        alert(`領収書の送信に失敗したため、申請はせず保存のみ行いました。\n（${upErr?.message || 'エラー'}）\n\n該当の明細の「修正」から、もう一度領収書を添付して申請してください。`);
        return;
      }
    }
    if (apply) await fetchJSONAuth('/api/expenses/months/apply', { method: 'POST', body: JSON.stringify({ month }) });
    openMonths.add(month);
    closeForm();
    await refreshList();
    toast(apply ? '申請しました。' : '保存しました。');
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
  try {
    if (!mountHome()) return;
    ensureForm();
    refreshList();
  } catch (e) { /* ignore */ }
}

// ポータルからのソフト遷移 (portal.page.js) では bootExpensesQuick() を呼ぶ。直接開いたときは自動で起動。
export function bootExpensesQuick() { boot(); }

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
