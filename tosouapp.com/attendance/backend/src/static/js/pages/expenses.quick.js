// 交通費申請 (社員画面) を速く・簡単にするための追加機能。expenses.page.js の処理は変更せず上に足す。
//   1. 一覧画面に大きな「＋ 交通費を申請する」ボタン: 月の選択を挟まず今月の申請を開き、明細入力を直接開く
//   2. 明細入力の上に「前回と同じ」: 最近使ったルートをワンタップで入力 (日付だけ選べば済む)
//   3. 明細入力をシンプルに: 任意項目 (経由・現場名・定期・添付・メモ) は「詳細（任意）」にまとめて閉じておく
//   + 明細を追加したときの日付を「今日」に (以前は毎回その月の 1 日になっていた)
import { fetchJSONAuth } from '/static/js/api/http.api.js?v=20260416-1';

const $ = (id) => document.getElementById(id);
const todayJST = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const TYPE_ICON = { train: '🚃', bus: '🚌', taxi: '🚕', car: '🚗', parking: '🅿️', highway: '🛣️' };
const TRIP_LABEL = { one_way: '片道', round_trip: '往復', multi: '複数' };

// ---------- 1. 大きな申請ボタン ----------
function addQuickNewButton() {
  const host = $('historySection');
  if (!host || $('expQuickNewBtn')) return;
  const wrap = document.createElement('div');
  wrap.id = 'expQuickNewWrap';
  wrap.style.cssText = 'margin:0 0 16px;';
  wrap.innerHTML = `
    <button type="button" id="expQuickNewBtn"
      style="width:100%;min-height:56px;border:none;border-radius:12px;background:#2563eb;color:#fff;
             font-size:18px;font-weight:800;letter-spacing:.02em;cursor:pointer;
             box-shadow:0 4px 12px rgba(37,99,235,.25);display:flex;align-items:center;justify-content:center;gap:8px;">
      <span style="font-size:24px;line-height:1;">＋</span> 交通費を申請する
    </button>`;
  host.insertBefore(wrap, host.firstChild);
  $('expQuickNewBtn').addEventListener('click', startQuickNew);
}

async function startQuickNew() {
  const btn = $('expQuickNewBtn');
  if (btn) btn.disabled = true;
  try {
    const ym = todayJST().slice(0, 7);
    if (typeof window.startNewForMonth === 'function') {
      await window.startNewForMonth(ym, { showProgress: false });
    } else {
      ($('expNavNew') || $('topNavNew'))?.click(); // 予備: 従来どおり月選択から
      return;
    }
    // 明細入力をすぐ開く
    setTimeout(() => $('exAppAddItemBtn')?.click(), 50);
  } catch (e) {
    alert('申請画面を開けませんでした。もう一度お試しください。');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ---------- 2. 前回と同じ ----------
let recentCache = null;
let recentAt = 0;
async function loadRecentRoutes() {
  if (recentCache && Date.now() - recentAt < 60_000) return recentCache;
  let rows = [];
  try { rows = await fetchJSONAuth('/api/expenses/my'); } catch (e) { rows = []; }
  const seen = new Set();
  const list = [];
  const sorted = (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.type !== 'goods' && (r.origin || r.destination))
    .sort((a, b) => String(b.date || b.created_at).localeCompare(String(a.date || a.created_at)));
  for (const r of sorted) {
    // 画面に出す内容 (種別・区間・片道/往復・金額) が同じものは 1 つにまとめる (最新を使う)
    const key = [r.type, r.origin, r.destination, r.trip_type, Number(r.amount)].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(r);
    if (list.length >= 4) break;
  }
  recentCache = list;
  recentAt = Date.now();
  return list;
}

function setVal(id, v, evt) {
  const el = $(id);
  if (!el) return;
  el.value = v == null ? '' : String(v);
  if (evt) el.dispatchEvent(new Event(evt, { bubbles: true }));
}

function fillFrom(r) {
  setVal('exType', r.type || 'train', 'change');
  setVal('exOrigin', r.origin);
  setVal('exVia', r.via);
  setVal('exDestination', r.destination);
  setVal('exTripType', r.trip_type || 'one_way', 'change');
  setVal('exTripCount', r.trip_count || 1, 'input');
  setVal('exPurpose', r.purpose);
  setVal('exSiteName', r.site_name);
  if (r.type === 'car') {
    setVal('exKm', r.distance_km ? Number(r.distance_km) : '', 'input');
    setVal('exUnitPrice', r.unit_price_per_km ? Number(r.unit_price_per_km) : '', 'input');
  }
  const teiki = $('exTeiki');
  if (teiki) teiki.checked = !!Number(r.teiki_flag || r.commuter_pass || 0);
  const amount = Math.round(Number(r.amount) || 0);
  setVal('exAmount', amount ? amount.toLocaleString('ja-JP') : '', 'input');
  openDetailsIfFilled();
  const hint = $('expRecentHint');
  if (hint) hint.textContent = '入力しました。日付を確認して「保存する」を押してください。';
}

async function renderRecentChips() {
  const form = document.querySelector('#exItemModal .form-wrap');
  if (!form) return;
  let box = $('expRecentRoutes');
  if (!box) {
    box = document.createElement('div');
    box.id = 'expRecentRoutes';
    box.className = 'full-row';
    box.style.cssText = 'grid-column:1/-1;margin-bottom:8px;';
    form.insertBefore(box, form.firstChild);
  }
  // 編集中 (既存明細を開いた) は出さない: 出発地などが既に入っている
  if (String($('exOrigin')?.value || '').trim() || String($('exDestination')?.value || '').trim()) {
    box.style.display = 'none';
    return;
  }
  const list = await loadRecentRoutes();
  if (!list.length) { box.style.display = 'none'; return; }
  box.style.display = '';
  box.innerHTML = `
    <div style="font-size:13px;font-weight:700;color:#334155;margin-bottom:6px;">前回と同じ（タップで入力）</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;">
      ${list.map((r, i) => `
        <button type="button" data-recent="${i}"
          style="border:1px solid #93c5fd;background:#eff6ff;color:#1e3a8a;border-radius:999px;padding:8px 14px;
                 font-size:14px;font-weight:700;cursor:pointer;text-align:left;max-width:100%;">
          ${TYPE_ICON[r.type] || '🚃'} ${esc(r.origin)} → ${esc(r.destination)}
          <span style="font-weight:600;color:#475569;">${esc(TRIP_LABEL[r.trip_type] || '')} ¥${Math.round(Number(r.amount) || 0).toLocaleString('ja-JP')}</span>
        </button>`).join('')}
    </div>
    <div id="expRecentHint" style="font-size:12px;color:#16a34a;font-weight:700;margin-top:6px;min-height:16px;"></div>`;
  box.querySelectorAll('[data-recent]').forEach((b) => b.addEventListener('click', () => fillFrom(list[Number(b.dataset.recent)])));
}

// ---------- 3. 任意項目を「詳細（任意）」にまとめる ----------
const OPTIONAL_INPUTS = ['exVia', 'exSiteName', 'exMemo'];
function collapseOptionalFields() {
  const form = document.querySelector('#exItemModal .form-wrap');
  if (!form || $('expMoreDetails')) return;
  const details = document.createElement('details');
  details.id = 'expMoreDetails';
  details.className = 'full-row';
  details.style.cssText = 'grid-column:1/-1;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;background:#f8fafc;';
  details.innerHTML = '<summary style="cursor:pointer;font-weight:700;color:#334155;font-size:14px;">詳細（任意）：経由・現場名・定期・添付・メモ</summary>';
  const inner = document.createElement('div');
  inner.className = 'adjust-grid';
  inner.style.cssText = 'margin-top:10px;border:none;padding:0;';
  details.appendChild(inner);

  // ラベルと入力欄はペアのまま移動する (expenses.page.js が parentElement.previousElementSibling で表示切替するため)
  const movePair = (inputId, labelEl) => {
    const input = $(inputId);
    const cell = input ? (input.closest('.full-row') && inputId === 'exMemo' ? input.closest('.full-row') : input.closest('#exTeikiWrap') || input.parentElement) : null;
    const label = labelEl || cell?.previousElementSibling;
    if (!cell || !label) return;
    inner.appendChild(label);
    inner.appendChild(cell);
  };
  const anchor = $('exTaxSummaryBox');
  movePair('exVia');
  movePair('exSiteName');
  movePair('exTeiki', $('exTeikiLabel'));
  const uploads = form.querySelector('.upload-sections');
  if (uploads) inner.appendChild(uploads);
  movePair('exMemo');
  if (anchor && anchor.parentElement === form) form.insertBefore(details, anchor.nextSibling);
  else form.appendChild(details);
}

function openDetailsIfFilled() {
  const details = $('expMoreDetails');
  if (!details) return;
  const filled = OPTIONAL_INPUTS.some((id) => String($(id)?.value || '').trim())
    || !!$('exTeiki')?.checked
    || ['exReceiptFront', 'exReceiptBack', 'exImages'].some((id) => ($(id)?.files?.length || 0) > 0);
  if (filled) details.open = true;
}

// ---------- 明細入力を開いたとき ----------
function onItemModalOpened() {
  // 新規追加なら日付は今日 (同じ月のとき)。編集時は既存の日付のまま。
  const date = $('exDate');
  const isNew = !String($('exOrigin')?.value || '').trim() && !String($('exDestination')?.value || '').trim() && !String($('exAmount')?.value || '').trim();
  const today = todayJST();
  if (isNew && date && String(date.value || '').slice(0, 7) === today.slice(0, 7)) {
    date.value = today;
    date.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const details = $('expMoreDetails');
  if (details) details.open = false;
  openDetailsIfFilled();
  renderRecentChips();
}

function watchItemModal() {
  const modal = $('exItemModal');
  if (!modal || modal.dataset.quickWatch === '1') return;
  modal.dataset.quickWatch = '1';
  let wasOpen = modal.style.display !== 'none' && modal.style.display !== '';
  new MutationObserver(() => {
    const open = modal.style.display !== 'none' && modal.style.display !== '';
    if (open && !wasOpen) setTimeout(onItemModalOpened, 0);
    if (!open && wasOpen) recentAt = 0; // 保存後は最新の履歴を取り直す
    wasOpen = open;
  }).observe(modal, { attributes: true, attributeFilter: ['style'] });
}

function boot() {
  try { collapseOptionalFields(); } catch (e) { /* 失敗しても従来の画面のまま使える */ }
  try { watchItemModal(); } catch (e) { /* ignore */ }
  try { addQuickNewButton(); } catch (e) { /* ignore */ }
}

// ポータルからのソフト遷移 (portal.page.js) では bootExpensesQuick() を呼ぶ。直接開いたときは自動で起動。
export function bootExpensesQuick() { boot(); }

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
