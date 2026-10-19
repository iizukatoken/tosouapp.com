// 交通費申請 (社員画面) をできるだけシンプルにする。expenses.page.js の処理は変えずに上に重ねる。
//
//   一覧: 大きな「＋ 交通費を申請する」ボタン + 1 行の件数 + 最近の申請リスト (5 枚のカードは隠す)
//   入力: 5 項目だけの簡単フォーム (日付・種別・出発地→到着地・片道/往復・金額・用途)
//         「前回と同じ」でワンタップ入力、任意項目 (経由・現場名・メモ) は「詳細（任意）」
//   送信: 「申請する」1 回で送信 (= 明細を作成 → その月を申請。従来の 内容確認→申請 と同じ API)
//
// 添付ファイル・物品購入・別の月の申請などは、メニュー (☰) の「新規作成」から従来の画面で行える。
import { fetchJSONAuth } from '/static/js/api/http.api.js?v=20260416-1';

const $ = (id) => document.getElementById(id);
const todayJST = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const yen = (n) => '¥' + Math.round(Number(n) || 0).toLocaleString('ja-JP');
const TYPES = [
  ['train', '🚃', '電車'], ['bus', '🚌', 'バス'], ['taxi', '🚕', 'タクシー'],
  ['car', '🚗', '車'], ['parking', '🅿️', '駐車場'], ['highway', '🛣️', '高速'],
];
const TYPE_ICON = Object.fromEntries(TYPES.map(([v, i]) => [v, i]));
const STATUS = {
  draft: ['下書き', '#64748b', '#f1f5f9'], pending: ['下書き', '#64748b', '#f1f5f9'],
  applied: ['申請中', '#c2410c', '#fff7ed'], soumu_checked: ['総務確認済み', '#0369a1', '#f0f9ff'], approved: ['承認済み', '#15803d', '#f0fdf4'],
  paid: ['支給済み', '#7e22ce', '#faf5ff'], rejected: ['差戻し', '#b91c1c', '#fef2f2'],
};

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
    if (out.length >= 3) break;
  }
  return out;
}

// ---------------- 一覧 (ホーム) ----------------
function renderHome() {
  const host = $('historySection');
  if (!host) return;
  let home = $('qxHome');
  if (!home) {
    home = document.createElement('div');
    home.id = 'qxHome';
    host.insertBefore(home, host.firstChild);
  }
  home.innerHTML = `
    <button type="button" id="qxNewBtn"
      style="width:100%;min-height:60px;border:none;border-radius:14px;background:#2563eb;color:#fff;font-size:19px;
             font-weight:800;cursor:pointer;box-shadow:0 4px 12px rgba(37,99,235,.25);margin-bottom:12px;">＋ 交通費を申請する</button>
    <div id="qxCounts" style="font-size:14px;color:#475569;margin:0 2px 10px;"></div>
    <div id="qxList" style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
      <div style="padding:16px;color:#94a3b8;font-size:14px;">読み込み中…</div>
    </div>
    <div style="text-align:right;margin:8px 2px 16px;">
      <a href="#" id="qxShowOld" style="font-size:13px;color:#64748b;">月別の詳しい画面を見る</a>
    </div>`;
  $('qxNewBtn').addEventListener('click', () => openForm());
  $("qxShowOld").addEventListener("click", (e) => { e.preventDefault(); toggleOldHome(true); });
  toggleOldHome(false);
  refreshList();
}

// 従来の 5 枚のカードや月別ボードは普段は隠す (リンクで表示できる)。
// expenses.page.js が後から style.display を書き換えるので、body のクラス + CSS で隠す。
function ensureStyle() {
  if ($('qxStyle')) return;
  const st = document.createElement('style');
  st.id = 'qxStyle';
  st.textContent = `
    body.qx-simple #exSummaryCards, body.qx-simple #exMonthlyBoardHost,
    body.qx-simple #exListWrapper, body.qx-simple #exListHost { display: none !important; }
    #historySection:not(.applied-month-mode) #qxHome { display: none !important; }
    body:not(.qx-simple) #qxHome { display: none !important; }`;
  document.head.appendChild(st);
}
function toggleOldHome(show) {
  ensureStyle();
  document.body.classList.toggle('qx-simple', !show);
  if (show) {
    // 従来画面から戻るリンク
    if (!$('qxBackSimple')) {
      const a = document.createElement('a');
      a.href = '#';
      a.id = 'qxBackSimple';
      a.textContent = '← かんたん画面に戻る';
      a.style.cssText = 'display:inline-block;margin:0 0 12px;font-size:14px;font-weight:700;color:#2563eb;';
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
  $('qxCounts').innerHTML = `申請中 <b>${count(['applied', 'soumu_checked'])}</b>件 ・ 承認済み <b>${count(['approved'])}</b>件`
    + (rejected ? ` ・ <span style="color:#b91c1c;font-weight:800;">差戻し ${rejected}件</span>` : '');
  if (!rows.length) {
    list.innerHTML = '<div style="padding:20px;color:#64748b;font-size:14px;text-align:center;">まだ申請はありません。</div>';
    return;
  }
  list.innerHTML = rows.slice(0, 10).map((r) => {
    const [label, fg, bg] = STATUS[String(r.status)] || [String(r.status || ''), '#334155', '#f1f5f9'];
    const route = r.type === 'goods' ? esc(r.item_name || '物品購入') : `${esc(r.origin)} → ${esc(r.destination)}`;
    const note = r.status === 'rejected' && r.manager_note
      ? `<div style="font-size:12px;color:#b91c1c;margin-top:2px;">理由：${esc(r.manager_note)}</div>` : '';
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;border-top:1px solid #f1f5f9;">
        <div style="font-size:13px;color:#64748b;width:44px;flex:none;">${esc(String(r.date || '').slice(5, 10).replace('-', '/'))}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:15px;font-weight:700;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${TYPE_ICON[r.type] || ''} ${route}</div>
          ${note}
        </div>
        <div style="font-size:15px;font-weight:800;color:#0f172a;flex:none;">${yen(r.amount)}</div>
        <div style="font-size:12px;font-weight:800;color:${fg};background:${bg};border-radius:999px;padding:3px 10px;flex:none;">${esc(label)}</div>
      </div>`;
  }).join('');
}

// ---------------- 簡単フォーム ----------------
const inputCss = 'width:100%;box-sizing:border-box;height:48px;border:1px solid #cbd5e1;border-radius:10px;padding:0 12px;font-size:16px;background:#fff;';
const labelCss = 'display:block;font-size:13px;font-weight:700;color:#334155;margin:12px 0 4px;';

function ensureForm() {
  if ($('qxModal')) return;
  const m = document.createElement('div');
  m.id = 'qxModal';
  m.style.cssText = 'display:none;position:fixed;inset:0;z-index:10050;background:rgba(15,23,42,.55);align-items:flex-end;justify-content:center;';
  m.innerHTML = `
    <div style="background:#fff;width:100%;max-width:520px;max-height:94vh;overflow:auto;border-radius:18px 18px 0 0;padding:16px 18px 20px;box-sizing:border-box;">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div style="font-size:18px;font-weight:800;color:#0f172a;">交通費を申請</div>
        <button type="button" id="qxClose" aria-label="閉じる" style="border:none;background:none;font-size:26px;line-height:1;color:#64748b;cursor:pointer;">×</button>
      </div>
      <div id="qxRecent"></div>
      <label style="${labelCss}">日付</label>
      <input id="qxDate" type="date" style="${inputCss}">
      <div id="qxTypes" style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap;">
        ${TYPES.map(([v, icon, name]) => `<button type="button" data-type="${v}" style="flex:1;min-width:52px;height:52px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;cursor:pointer;font-size:20px;line-height:1.1;">${icon}<div style="font-size:10px;font-weight:700;color:#334155;white-space:nowrap;letter-spacing:-.02em;">${name}</div></button>`).join('')}
      </div>
      <label style="${labelCss}">出発地 → 到着地</label>
      <div style="display:flex;gap:8px;align-items:center;">
        <input id="qxOrigin" type="text" placeholder="出発地" style="${inputCss}">
        <span style="color:#94a3b8;font-weight:800;">→</span>
        <input id="qxDest" type="text" placeholder="到着地" style="${inputCss}">
      </div>
      <div id="qxTrip" style="display:flex;gap:8px;margin-top:10px;">
        <button type="button" data-trip="one_way" style="flex:1;height:44px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;font-size:15px;font-weight:700;cursor:pointer;">片道</button>
        <button type="button" data-trip="round_trip" style="flex:1;height:44px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;font-size:15px;font-weight:700;cursor:pointer;">往復</button>
      </div>
      <label style="${labelCss}">金額（円）</label>
      <input id="qxAmount" type="text" inputmode="numeric" placeholder="例）560" style="${inputCss}font-size:20px;font-weight:800;">
      <label style="${labelCss}">用途</label>
      <input id="qxPurpose" type="text" placeholder="例）〇〇現場・A社訪問" style="${inputCss}">
      <details id="qxMore" style="margin-top:12px;">
        <summary style="cursor:pointer;font-size:14px;color:#475569;font-weight:700;">詳細（任意）</summary>
        <label style="${labelCss}">経由</label><input id="qxVia" type="text" style="${inputCss}">
        <label style="${labelCss}">現場名</label><input id="qxSite" type="text" style="${inputCss}">
        <label style="${labelCss}">メモ</label><input id="qxMemo" type="text" style="${inputCss}">
      </details>
      <div id="qxErr" style="color:#b91c1c;font-size:14px;font-weight:700;margin-top:12px;min-height:18px;"></div>
      <button type="button" id="qxSubmit" style="width:100%;height:56px;margin-top:6px;border:none;border-radius:12px;background:#2563eb;color:#fff;font-size:18px;font-weight:800;cursor:pointer;">申請する</button>
      <button type="button" id="qxDraft" style="width:100%;height:40px;margin-top:6px;border:none;background:none;color:#64748b;font-size:14px;cursor:pointer;">下書きに保存（あとでまとめて申請）</button>
    </div>`;
  document.body.appendChild(m);
  $('qxClose').addEventListener('click', closeForm);
  m.addEventListener('click', (e) => { if (e.target === m) closeForm(); });
  $('qxTypes').addEventListener('click', (e) => { const b = e.target.closest('[data-type]'); if (b) setType(b.dataset.type); });
  $('qxTrip').addEventListener('click', (e) => { const b = e.target.closest('[data-trip]'); if (b) setTrip(b.dataset.trip); });
  $('qxAmount').addEventListener('input', () => {
    const digits = String($('qxAmount').value).replace(/[^\d]/g, '');
    $('qxAmount').value = digits ? Number(digits).toLocaleString('ja-JP') : '';
  });
  $('qxSubmit').addEventListener('click', () => submit(true));
  $('qxDraft').addEventListener('click', () => submit(false));
}

let curType = 'train';
let curTrip = 'one_way';
function paintSelected(container, attr, value) {
  container.querySelectorAll(`[${attr}]`).forEach((b) => {
    const on = b.getAttribute(attr) === value;
    b.style.background = on ? '#2563eb' : '#fff';
    b.style.color = on ? '#fff' : '';
    b.style.borderColor = on ? '#2563eb' : '#cbd5e1';
    b.querySelectorAll('div').forEach((d) => { d.style.color = on ? '#fff' : '#334155'; });
  });
}
function setType(v) { curType = v; paintSelected($('qxTypes'), 'data-type', v); }
function setTrip(v) { curTrip = v; paintSelected($('qxTrip'), 'data-trip', v); }

function fillFrom(r) {
  setType(r.type || 'train');
  setTrip(r.trip_type === 'round_trip' ? 'round_trip' : 'one_way');
  $('qxOrigin').value = r.origin || '';
  $('qxDest').value = r.destination || '';
  $('qxAmount').value = Math.round(Number(r.amount) || 0).toLocaleString('ja-JP');
  $('qxPurpose').value = r.purpose || '';
  $('qxVia').value = r.via || '';
  $('qxSite').value = r.site_name || '';
  $('qxMemo').value = '';
  $('qxMore').open = !!(r.via || r.site_name);
  $('qxErr').textContent = '';
}

async function openForm() {
  ensureForm();
  // 初期値: 今日・電車・片道・空欄
  $('qxDate').value = todayJST();
  setType('train');
  setTrip('one_way');
  for (const id of ['qxOrigin', 'qxDest', 'qxAmount', 'qxPurpose', 'qxVia', 'qxSite', 'qxMemo']) $(id).value = '';
  $('qxMore').open = false;
  $('qxErr').textContent = '';
  $('qxModal').style.display = 'flex';
  const recent = recentRoutes(await loadMine());
  $('qxRecent').innerHTML = recent.length ? `
    <div style="font-size:13px;font-weight:700;color:#334155;margin:10px 0 6px;">前回と同じ</div>
    <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;">
      ${recent.map((r, i) => `<button type="button" data-recent="${i}" style="flex:none;border:1px solid #93c5fd;background:#eff6ff;color:#1e3a8a;border-radius:999px;padding:8px 12px;font-size:14px;font-weight:700;cursor:pointer;white-space:nowrap;">${TYPE_ICON[r.type] || ''} ${esc(r.origin)}→${esc(r.destination)} ${r.trip_type === 'round_trip' ? '往復' : '片道'} ${yen(r.amount)}</button>`).join('')}
    </div>` : '';
  $('qxRecent').querySelectorAll('[data-recent]').forEach((b) => b.addEventListener('click', () => fillFrom(recent[Number(b.dataset.recent)])));
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

  const btns = [$('qxSubmit'), $('qxDraft')];
  btns.forEach((b) => { b.disabled = true; });
  $('qxSubmit').textContent = apply ? '申請中…' : '保存中…';
  try {
    await fetchJSONAuth('/api/expenses', {
      method: 'POST',
      body: JSON.stringify({
        date, type: curType, origin, destination, tripType: curTrip, tripCount: 1, purpose, amount,
        via: $('qxVia').value.trim(), siteName: $('qxSite').value.trim(), memo: $('qxMemo').value.trim(),
        teiki: false, clientToken: `qx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      }),
    });
    if (apply) await fetchJSONAuth('/api/expenses/months/apply', { method: 'POST', body: JSON.stringify({ month }) });
    closeForm();
    await refreshList(true);
    toast(apply ? '申請しました' : '下書きに保存しました');
  } catch (e) {
    err.textContent = (e && e.message) || '送信に失敗しました。もう一度お試しください。';
  } finally {
    btns.forEach((b) => { b.disabled = false; });
    $('qxSubmit').textContent = '申請する';
  }
}

function toast(msg) {
  const t = document.createElement('div');
  t.textContent = '✓ ' + msg;
  t.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:#16a34a;color:#fff;padding:12px 20px;border-radius:999px;font-weight:800;font-size:15px;z-index:10060;box-shadow:0 6px 16px rgba(0,0,0,.2);';
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
