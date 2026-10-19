// 交通費管理 (管理者・マネージャー) — シンプルでクラシックな 1 画面。
//
//   対象月を選ぶ → 段階ごとの人数 (総務確認待ち・承認待ち・支給待ち・差戻し中・支給済み・未申請、押すと絞り込み)
//   → 全社員の表 (未申請も含む)。各行に「次の操作」ボタン:
//     総務確認 (manager/admin) → 承認 (admin) → 支給済み (admin)
//   社員を押すと明細: 領収書の表示、差戻し (理由つき)、精算書(PDF)
//   ほか: Excel出力・月次締め
//
// サーバー側の状態遷移ルール (validateStatusTransition) はそのまま。押せるボタンだけを表示する。
// 従来の画面は ?legacy=1 で開ける。
import { fetchJSONAuth } from '../../api/http.api.js';

const NAVY = '#0b2c66';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const yen = (n) => Math.round(Number(n) || 0).toLocaleString('ja-JP') + '円';
const thisMonth = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 7);
const shiftMonth = (ym, d) => { const [y, m] = ym.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + d, 1)); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`; };
const TYPE_NAME = { train: '電車', bus: 'バス', taxi: 'タクシー', car: '自家用車', private_car: '自家用車', parking: '駐車場代', highway: '高速料金', goods: '物品購入' };
const STATUS = {
  draft: ['下書き', '#6b7280'], pending: ['下書き', '#6b7280'], applied: ['申請中', '#b45309'],
  soumu_checked: ['総務確認済み', '#1d4ed8'], approved: ['承認済み', '#15803d'], paid: ['支給済み', '#374151'], rejected: ['差戻し', '#b91c1c'],
};
const REJECTABLE = new Set(['applied', 'soumu_checked', 'approved']);

let root = null;
let role = '';
let month = thisMonth();
let rows = [];          // 当月の明細 (admin/list)
let overview = [];      // 当月の社員一覧 (未申請を含む)
let filter = 'all';     // 段階の絞り込み
const openUsers = new Set();
const fileCache = new Map();

const isAdmin = () => role === 'admin' || role === 'owner' || role === 'sysadmin';

function css() {
  if (document.getElementById('qaStyle')) return;
  const st = document.createElement('style');
  st.id = 'qaStyle';
  st.textContent = `
    .qa { font-size: 14px; color: #1f2937; background: #fff; padding: 16px 20px 40px; min-height: 100%; }
    .qa-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
    .qa-title { font-size: 18px; font-weight: 700; margin: 0 12px 0 0; }
    .qa-month { display: inline-flex; align-items: center; gap: 4px; }
    .qa-month input { height: 32px; border: 1px solid #9ca3af; border-radius: 3px; padding: 0 6px; font-size: 14px; }
    .qa-sp { flex: 1; }
    .qa-btn { height: 32px; padding: 0 12px; font-size: 13px; border: 1px solid #9ca3af; background: #fff; color: #1f2937; border-radius: 3px; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; }
    .qa-btn:hover { background: #f3f4f6; }
    .qa-btn.primary { background: ${NAVY}; border-color: ${NAVY}; color: #fff; font-weight: 600; }
    .qa-btn.primary:hover { background: #092352; }
    .qa-btn.danger { color: #b91c1c; border-color: #fca5a5; }
    .qa-btn.small { height: 26px; padding: 0 8px; font-size: 12px; }
    .qa-btn:disabled { opacity: .6; cursor: default; }
    .qa-flow { font-size: 13px; color: #4b5563; margin: 0 0 12px; }
    .qa-flow b { font-weight: 600; color: #1f2937; }
    .qa-stages { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); border: 1px solid #d1d5db; margin-bottom: 14px; }
    .qa-stage { background: #fff; border: none; border-left: 1px solid #e5e7eb; border-bottom: 3px solid transparent; padding: 10px 12px; text-align: left; cursor: pointer; display: flex; flex-direction: column; gap: 2px; font-family: inherit; color: #1f2937; }
    .qa-stage:first-child { border-left: none; }
    .qa-stage:hover { background: #f9fafb; }
    .qa-stage .l { font-size: 12px; color: #4b5563; }
    .qa-stage .n { font-size: 22px; font-weight: 700; line-height: 1.2; }
    .qa-stage .n small { font-size: 12px; font-weight: 400; margin-left: 2px; }
    .qa-stage .a { font-size: 12px; color: #6b7280; }
    .qa-stage.todo .l { color: #b45309; font-weight: 700; }
    .qa-stage.todo .l::after { content: ' ●'; font-size: 9px; vertical-align: 2px; }
    .qa-stage.on { background: #f3f4f6; border-bottom-color: ${NAVY}; }
    .qa-wait { font-size: 12px; color: #6b7280; }
    .qa-table tr.none td { color: #9ca3af; }
    .qa table.qa-table tfoot td { background: #f9fafb !important; font-weight: 700; border-top: 2px solid #d1d5db; }
    .qa-table td.st { white-space: nowrap; font-weight: 600; }
    .qa-table td.name { white-space: nowrap; }
    .m-code { display: none; }
    .qa-table { width: 100%; border-collapse: collapse; border: 1px solid #d1d5db; }
    .qa-table th { background: #f3f4f6; font-weight: 600; font-size: 13px; text-align: left; padding: 8px 10px; border-bottom: 1px solid #d1d5db; white-space: nowrap; }
    .qa-table td { padding: 8px 10px; border-top: 1px solid #e5e7eb; vertical-align: top; }
    .qa-table .num { text-align: right; white-space: nowrap; }
    .qa-user[data-user]:not([data-user=""]) { cursor: pointer; }
    .qa-user:hover td { background: #f9fafb; }
    .qa-user td.name { font-weight: 600; }
    .qa-caret { display: inline-block; width: 12px; color: #6b7280; }
    .qa-detail > td { background: #fafafa; padding: 8px 10px 12px 22px; }
    .qa-acts { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 8px; }
    .qa-acts a.link { font-size: 13px; color: ${NAVY}; margin-right: auto; }
    .qa-sub { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e5e7eb; }
    .qa-sub th { background: #fafafa; font-weight: 500; color: #4b5563; font-size: 12px; text-align: left; padding: 6px 8px; border-bottom: 1px solid #e5e7eb; }
    .qa-sub td { padding: 6px 8px; border-top: 1px solid #f1f5f9; font-size: 13px; vertical-align: top; }
    .qa-sub .note { font-size: 12px; color: #b91c1c; }
    .qa-files a { color: ${NAVY}; font-size: 12px; margin-right: 8px; white-space: nowrap; }
    .qa-empty { color: #6b7280; padding: 14px 0; }
    /* 管理画面共通の表スタイル (中央寄せ・色付き見出し) を上書き */
    .qa table th { background: #f3f4f6 !important; color: #1f2937 !important; text-align: left !important; }
    .qa table.qa-sub th { background: #fafafa !important; color: #4b5563 !important; }
    .qa table .num, .qa table th.num { text-align: right !important; }
    .qa table td { color: inherit; }
    .qa a { text-decoration: underline; }
    .qa a.qa-btn { text-decoration: none; }
    .qa-toast { position: fixed; right: 16px; bottom: 16px; background: #374151; color: #fff; padding: 10px 14px; border-radius: 3px; font-size: 13px; z-index: 10060; }
    .m-type, .m-lbl { display: none; }
    @media (max-width: 700px) {
      .qa { padding: 12px; }
      .qa-sub, .qa-sub tbody { display: block; width: 100%; }
      .qa-sub thead { display: none; }
      .qa-sub tr.qa-item { display: grid; grid-template-columns: 1fr auto; grid-template-areas: "date amt" "what what" "file file" "st act"; gap: 3px 8px; padding: 10px 8px; border-top: 1px solid #e5e7eb; }
      .admin .content .qa table.qa-sub tr.qa-item td { display: block !important; border: none !important; padding: 0 !important; height: auto !important; min-height: 0 !important; line-height: 1.5 !important; overflow: visible !important; white-space: normal; }
      .admin .content .qa table.qa-sub tr.qa-item td.col-type { display: none !important; }
      .admin .content .qa table.qa-sub tr.qa-item td div { line-height: 1.5 !important; height: auto !important; }
      .qa-sub .c-date { grid-area: date; color: #4b5563; }
      .qa-sub .m-type, .qa-sub .m-lbl { display: inline; color: #6b7280; }
      .qa-sub .c-amt { grid-area: amt; font-weight: 700; }
      .qa-sub .c-what { grid-area: what; font-size: 14px; }
      .qa-sub .c-file { grid-area: file; font-size: 13px; }
      .qa-sub .c-st { grid-area: st; align-self: center; }
      .qa-sub .c-act { grid-area: act; }
      .qa-btn.small { height: 32px; padding: 0 12px; }
      .qa-stages { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .qa-user:hover td { background: transparent; }
      .qa-stage { border-top: 1px solid #e5e7eb; padding: 8px; }
      .qa-stage .n { font-size: 18px; }
      .qa-table, .qa-table tbody, .qa-table tfoot { display: block; }
      .qa-table thead { display: none; }
      .qa-table tbody tr.qa-user { display: grid; grid-template-columns: 1fr auto; grid-template-areas: "name amt" "st next"; gap: 4px 8px; padding: 10px 8px; border-top: 1px solid #e5e7eb; }
      .admin .content .qa table.qa-table tr.qa-user > td { display: block !important; border: none !important; padding: 0 !important; height: auto !important; line-height: 1.5 !important; white-space: normal; }
      .admin .content .qa table.qa-table tr.qa-user > td.col-code, .admin .content .qa table.qa-table tr.qa-user > td.col-dept, .admin .content .qa table.qa-table tr.qa-user > td.col-cnt { display: none !important; }
      .m-code { display: block; font-size: 11px; color: #6b7280; font-weight: 400; padding-left: 12px; }
      .qa-table tr.qa-user > td.name { grid-area: name; }
      .qa-table tr.qa-user > td.amt { grid-area: amt; font-weight: 700; }
      .qa-table tr.qa-user > td.st { grid-area: st; align-self: center; }
      .qa-table tr.qa-user > td.col-next { grid-area: next; text-align: right; }
      .qa-table tr.qa-detail, .admin .content .qa table.qa-table tr.qa-detail > td { display: block !important; height: auto !important; }
      .qa-table tfoot tr { display: flex; justify-content: space-between; padding: 10px 8px; background: #f9fafb; border-top: 2px solid #d1d5db; }
      .admin .content .qa table.qa-table tfoot td { display: block !important; border: none !important; height: auto !important; padding: 0 !important; }
      .admin .content .qa table.qa-table tfoot td:empty, .admin .content .qa table.qa-table tfoot td.col-cnt { display: none !important; }
      .qa-detail > td { padding-left: 8px; }
      .qa-sub .col-type { display: none; }
    }`;
  document.head.appendChild(st);
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'qa-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

// 社員ごとの「今どの段階か」。明細のうち一番手前の段階で決める (未処理を見落とさないため)
const STAGES = [
  { key: 'applied', label: '総務確認待ち', color: '#b45309' },
  { key: 'soumu_checked', label: '承認待ち', color: '#1d4ed8' },
  { key: 'approved', label: '支給待ち', color: '#15803d' },
  { key: 'rejected', label: '差戻し中', color: '#b91c1c' },
  { key: 'paid', label: '支給済み', color: '#374151' },
  { key: 'none', label: '未申請', color: '#9ca3af' },
];
const STAGE = Object.fromEntries(STAGES.map((x) => [x.key, x]));
function stageOf(items) {
  const st = new Set(items.map((r) => String(r.status)));
  for (const k of ['applied', 'soumu_checked', 'approved', 'rejected', 'paid']) if (st.has(k)) return k;
  return 'none';
}
// この利用者が今押せる操作がある段階か
const canAct = (k) => k === 'applied' || (isAdmin() && (k === 'soumu_checked' || k === 'approved'));

async function load() {
  const list = root.querySelector('#qaList');
  list.innerHTML = '<p class="qa-empty">読み込み中…</p>';
  try {
    const [l, o] = await Promise.all([
      fetchJSONAuth(`/api/expenses/admin/list?month=${encodeURIComponent(month)}&page=1&limit=2000&sortBy=date&sortDir=asc`),
      fetchJSONAuth(`/api/expenses/admin/employee-overview?month=${encodeURIComponent(month)}`).catch(() => ({ rows: [] })),
    ]);
    rows = Array.isArray(l?.rows) ? l.rows.filter((r) => !['draft', 'pending'].includes(String(r.status))) : [];
    overview = Array.isArray(o?.rows) ? o.rows : [];
  } catch (e) {
    list.innerHTML = `<p class="qa-empty" style="color:#b91c1c;">読み込みに失敗しました：${esc(e?.message || '')}</p>`;
    return;
  }
  render();
}

// 全社員 (未申請も含む) を 1 つの表にする
function buildUsers() {
  const byUser = new Map();
  const add = (id, name, code, dept) => {
    const k = String(id);
    if (!byUser.has(k)) byUser.set(k, { userId: id, name: name || `#${id}`, code: code || '', dept: dept || '', items: [] });
    return byUser.get(k);
  };
  for (const x of overview) add(x.userId, x.userName, x.employeeCode, x.departmentName);
  for (const r of rows) {
    const u = add(r.userId, r.user_name || r.user_email, r.employee_code, r.department_name);
    if (!u.dept && r.department_name) u.dept = r.department_name;
    u.items.push(r);
  }
  const users = [...byUser.values()];
  for (const u of users) { u.stage = stageOf(u.items); u.total = u.items.reduce((a, r) => a + (Number(r.amount) || 0), 0); }
  const order = Object.fromEntries(STAGES.map((x, i) => [x.key, i]));
  return users.sort((a, b) => order[a.stage] - order[b.stage] || String(a.code).localeCompare(String(b.code), 'ja', { numeric: true }) || String(a.name).localeCompare(String(b.name)));
}

function render() {
  const all = buildUsers();
  const of = (k) => all.filter((u) => u.stage === k);

  // 段階ごとの人数 (押すと絞り込み)
  root.querySelector('#qaStages').innerHTML = [{ key: 'all', label: 'すべて' }, ...STAGES].map((x) => {
    const us = x.key === 'all' ? all : of(x.key);
    const amt = us.reduce((a, u) => a + u.total, 0);
    const todo = x.key !== 'all' && us.length > 0 && canAct(x.key);
    return `<button type="button" class="qa-stage${filter === x.key ? ' on' : ''}${todo ? ' todo' : ''}" data-stage="${x.key}">
      <span class="l">${esc(x.label)}</span>
      <span class="n">${us.length}<small>名</small></span>
      <span class="a">${x.key === 'none' ? '&nbsp;' : yen(amt)}</span>
    </button>`;
  }).join('');

  const users = filter === 'all' ? all : of(filter);
  const list = root.querySelector('#qaList');
  if (!users.length) {
    list.innerHTML = '<p class="qa-empty">該当する社員はいません。</p>';
    return;
  }
  const total = users.reduce((a, u) => a + u.total, 0);
  const cnt = users.reduce((a, u) => a + u.items.length, 0);
  list.innerHTML = `
    <table class="qa-table">
      <thead><tr><th class="col-code">社員番号</th><th>氏名</th><th class="col-dept">部署</th><th class="num col-cnt">件数</th><th class="num">金額</th><th>状態</th><th class="col-next">次の操作</th></tr></thead>
      <tbody>${users.map(userRows).join('')}</tbody>
      <tfoot><tr><td class="col-code"></td><td>合計（${users.length}名）</td><td class="col-dept"></td><td class="num col-cnt">${cnt}件</td><td class="num">${yen(total)}</td><td></td><td class="col-next"></td></tr></tfoot>
    </table>`;
}

function nextAction(u) {
  const ids = (st) => u.items.filter((r) => r.status === st).map((r) => r.id);
  const btn = (status, st, text) => `<button type="button" class="qa-btn primary small" data-bulk="${status}" data-ids="${ids(st).join(',')}">${text}（${ids(st).length}件）</button>`;
  switch (u.stage) {
    case 'applied': return btn('soumu_checked', 'applied', '総務確認する');
    case 'soumu_checked': return isAdmin() ? btn('approved', 'soumu_checked', '承認する') : '<span class="qa-wait">管理者の承認待ち</span>';
    case 'approved': return isAdmin() ? btn('paid', 'approved', '支給済みにする') : '<span class="qa-wait">支給待ち</span>';
    case 'rejected': return '<span class="qa-wait">社員の再申請待ち</span>';
    case 'paid': return '<span class="qa-wait">完了</span>';
    default: return '<span class="qa-wait">—</span>';
  }
}

function userRows(u) {
  const stg = STAGE[u.stage];
  const has = u.items.length > 0;
  const open = has && openUsers.has(String(u.userId));
  const ids = (st) => u.items.filter((r) => r.status === st).map((r) => r.id);
  // 明細の中: 段階が混在しているときのための一括ボタン
  const acts = [];
  if (u.stage !== 'applied' && ids('applied').length) acts.push(`<button type="button" class="qa-btn primary small" data-bulk="soumu_checked" data-ids="${ids('applied').join(',')}">総務確認（${ids('applied').length}件）</button>`);
  if (isAdmin() && u.stage !== 'soumu_checked' && ids('soumu_checked').length) acts.push(`<button type="button" class="qa-btn primary small" data-bulk="approved" data-ids="${ids('soumu_checked').join(',')}">承認（${ids('soumu_checked').length}件）</button>`);
  if (isAdmin() && u.stage !== 'approved' && ids('approved').length) acts.push(`<button type="button" class="qa-btn primary small" data-bulk="paid" data-ids="${ids('approved').join(',')}">支給済みにする（${ids('approved').length}件）</button>`);
  return `
    <tr class="qa-user${has ? '' : ' none'}" data-user="${has ? u.userId : ''}">
      <td class="col-code">${esc(u.code)}</td>
      <td class="name"><span class="qa-caret">${has ? (open ? '▾' : '▸') : ''}</span>${esc(u.name)}<span class="m-code">${esc(u.code)}${u.dept ? `　${esc(u.dept)}` : ''}</span></td>
      <td class="col-dept">${esc(u.dept)}</td>
      <td class="num col-cnt">${has ? `${u.items.length}件` : ''}</td>
      <td class="num amt">${has ? yen(u.total) : ''}</td>
      <td class="st" style="color:${stg.color};">${esc(stg.label)}</td>
      <td class="col-next">${nextAction(u)}</td>
    </tr>
    ${open ? `<tr class="qa-detail"><td colspan="7">
      <div class="qa-acts">
        <a class="link" href="/api/expenses/admin/monthly-detail/print?userId=${encodeURIComponent(u.userId)}&month=${month}" target="_blank" rel="noopener">精算書（PDF・印刷）</a>
        ${acts.join('')}
      </div>
      <table class="qa-sub">
        <thead><tr><th>日付</th><th>内容</th><th class="col-type">種別</th><th style="text-align:right;">金額</th><th>領収書</th><th>状態</th><th></th></tr></thead>
        <tbody>${u.items.map(itemRow).join('')}</tbody>
      </table>
    </td></tr>` : ''}`;
}

function itemRow(r) {
  const [label, color] = STATUS[String(r.status)] || [String(r.status || ''), '#374151'];
  const what = r.type === 'goods'
    ? `${esc(r.item_name || '物品購入')}${r.vendor ? `（${esc(r.vendor)}）` : ''}`
    : `${esc(r.origin)} → ${esc(r.destination)}${r.trip_type === 'round_trip' ? '（往復）' : ''}`;
  const purpose = [r.purpose, r.site_name ? `［${r.site_name}］` : ''].filter(Boolean).map(esc).join(' ');
  const note = r.status === 'rejected' && r.manager_note ? `<div class="note">差戻し理由：${esc(r.manager_note)}</div>` : '';
  const files = Number(r.file_count || 0) > 0
    ? `<span class="qa-files" data-files="${r.id}"><a href="#" data-load-files="${r.id}">表示（${Number(r.file_count)}）</a></span>`
    : '－';
  return `<tr class="qa-item">
    <td class="c-date" style="white-space:nowrap;">${esc(String(r.date || '').slice(5, 10).replace('-', '/'))}<span class="m-type"> ${esc(TYPE_NAME[r.type] || '')}</span></td>
    <td class="c-what">${what}${purpose ? `<div style="font-size:12px;color:#6b7280;">${purpose}</div>` : ''}${note}</td>
    <td class="col-type">${esc(TYPE_NAME[r.type] || r.type || '')}</td>
    <td class="c-amt" style="text-align:right;white-space:nowrap;">${yen(r.amount)}</td>
    <td class="c-file"><span class="m-lbl">領収書：</span>${files}</td>
    <td class="c-st" style="white-space:nowrap;color:${color};">${esc(label)}</td>
    <td class="c-act" style="text-align:right;">${REJECTABLE.has(String(r.status)) ? `<button type="button" class="qa-btn danger small" data-reject="${r.id}">差戻し</button>` : ''}</td>
  </tr>`;
}

async function onClick(e) {
  const t = e.target;
  const loadFiles = t.closest('[data-load-files]');
  if (loadFiles) { e.preventDefault(); await showFiles(loadFiles.dataset.loadFiles); return; }
  if (t.closest('a')) return;
  const bulk = t.closest('[data-bulk]');
  if (bulk) { await bulkStatus(bulk.dataset.bulk, bulk.dataset.ids.split(','), bulk); return; }
  const rej = t.closest('[data-reject]');
  if (rej) { await reject(rej.dataset.reject); return; }
  const u = t.closest('.qa-user');
  if (u && u.dataset.user) {
    const k = u.dataset.user;
    if (openUsers.has(k)) openUsers.delete(k); else openUsers.add(k);
    render();
  }
}

async function showFiles(id) {
  const box = root.querySelector(`[data-files="${id}"]`);
  if (!box) return;
  try {
    let files = fileCache.get(id);
    if (!files) { files = await fetchJSONAuth(`/api/expenses/${encodeURIComponent(id)}/files`); fileCache.set(id, files); }
    box.innerHTML = (files || []).map((f) => `<a href="${esc(f.path)}" target="_blank" rel="noopener">${esc(f.name || 'ファイル')}</a>`).join('') || '－';
  } catch (err) {
    box.textContent = '取得失敗';
  }
}

const ACTION_NAME = { soumu_checked: '総務確認', approved: '承認', paid: '支給済み' };
async function bulkStatus(status, ids, btn) {
  if (!window.confirm(`${ids.length}件を「${ACTION_NAME[status]}」にします。よろしいですか？`)) return;
  btn.disabled = true;
  try {
    const r = await fetchJSONAuth('/api/expenses/admin/bulk-status', { method: 'POST', body: JSON.stringify({ ids: ids.map(Number), status }) });
    await load();
    const skipped = Number(r?.skipped || 0);
    toast(skipped ? `${ACTION_NAME[status]}：${ids.length - skipped}件（${skipped}件は処理できませんでした）` : `${ACTION_NAME[status]}にしました。`);
  } catch (err) {
    alert(err?.message || '処理に失敗しました。');
    btn.disabled = false;
  }
}

async function reject(id) {
  const reason = window.prompt('差戻しの理由を入力してください（社員に表示されます）');
  if (reason == null) return;
  if (!reason.trim()) { alert('理由を入力してください。'); return; }
  try {
    await fetchJSONAuth(`/api/expenses/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'rejected', note: reason.trim() }) });
    await load();
    toast('差戻しました。');
  } catch (err) {
    alert(err?.message || '差戻しに失敗しました。');
  }
}

async function monthlyClose(btn) {
  if (!window.confirm(`${month.replace('-', '年')}月を月次締めします（承認済みの交通費を給与に反映する集計を作成します）。よろしいですか？`)) return;
  btn.disabled = true;
  try {
    await fetchJSONAuth('/api/expenses/admin/monthly-close', { method: 'POST', body: JSON.stringify({ month }) });
    toast('月次締めを実行しました。');
  } catch (err) {
    alert(err?.message || '月次締めに失敗しました。');
  } finally {
    btn.disabled = false;
  }
}

function frame() {
  root.innerHTML = `
    <div class="qa">
      <div class="qa-head">
        <h2 class="qa-title">交通費管理</h2>
        <div class="qa-month">
          <button type="button" class="qa-btn small" id="qaPrev" aria-label="前の月">‹</button>
          <input type="month" id="qaMonth" value="${month}">
          <button type="button" class="qa-btn small" id="qaNext" aria-label="次の月">›</button>
        </div>
        <span class="qa-sp"></span>
        <a class="qa-btn" id="qaExcel" href="#">Excel出力</a>
        <button type="button" class="qa-btn" id="qaClose">月次締め</button>
      </div>
      <p class="qa-flow">流れ：<b>① 社員が申請</b> → <b>② 総務確認</b> → <b>③ 承認</b> → <b>④ 支給</b>${isAdmin() ? '' : '　（あなたの権限では ② 総務確認 まで操作できます）'}</p>
      <div class="qa-stages" id="qaStages"></div>
      <div id="qaList"></div>
    </div>`;
  const setMonth = (ym) => { if (!/^\d{4}-\d{2}$/.test(ym)) return; month = ym; root.querySelector('#qaMonth').value = ym; openUsers.clear(); filter = 'all'; load(); };
  root.querySelector('#qaPrev').addEventListener('click', () => setMonth(shiftMonth(month, -1)));
  root.querySelector('#qaNext').addEventListener('click', () => setMonth(shiftMonth(month, 1)));
  root.querySelector('#qaMonth').addEventListener('change', (e) => setMonth(e.target.value));
  root.querySelector('#qaExcel').addEventListener('click', (e) => { e.preventDefault(); window.open(`/api/expenses/admin/export.xlsx?month=${encodeURIComponent(month)}`, '_blank'); });
  root.querySelector('#qaClose').addEventListener('click', (e) => monthlyClose(e.currentTarget));
  root.querySelector('#qaList').addEventListener('click', onClick);
  root.querySelector('#qaStages').addEventListener('click', (e) => { const b = e.target.closest('[data-stage]'); if (!b) return; filter = b.dataset.stage; render(); });
}

export async function mount({ content }) {
  // 従来の画面: /admin/expenses?legacy=1
  if (new URLSearchParams(window.location.search).get('legacy') === '1') {
    const old = await import('./expenses.page.js?v=navy-20260831-workflow1');
    return old.mount({ content });
  }
  css();
  root = content;
  try {
    const me = await fetchJSONAuth('/api/auth/me');
    role = String(me?.role || '').toLowerCase();
  } catch (e) { role = ''; }
  frame();
  await load();
}
