import{fetchJSONAuth as G}from"../../api/http.api.js";
/*
 * シフト承認
 * - タブ: 承認待ち（既定）/ 差戻し / 承認済 / 未提出 / 全員の一覧表
 * - 承認待ちは1人1行。「内容を見る」で月カレンダーを開き、その場で承認・差戻しできる。まとめて承認も可
 * - 全員の一覧表は「従業員＝行・日付＝列」（名前が切れない）。未提出の人は下にまとめて薄く表示
 * - 代理入力（Z）と承認API呼び出し（X）は従来の実装をそのまま使う（ファイル末尾）
 */
let g = "", O = [], l = null, q = "", H = "", TAB = "ALL"; // 承認は 申請一覧 で行うので、開いたら全員の一覧表
const picked = new Set();

window.addEventListener("resize", () => { if (l && document.getElementById("saMonth")) syncMobileMonth(); });

// 今月(0)・来月(1) の YYYY-MM（日本時間）。月の1日で計算するので 10/31 → 11月 のように月末でもずれない
function ymJST(add) {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + add, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function te({ content: o }) {
  l = o; l.style.visibility = "";
  // 既定は来月（シフトの提出・未提出の確認は来月分のため）。今月は「今月」ボタンですぐ切り替えられる
  g = ymJST(1);
  // 申請一覧（統合）の「内容を見る」から: ?month=YYYY-MM&view=<userId> でその人の月カレンダーを開く
  let viewId = "";
  try {
    const qs = new URLSearchParams(window.location.search);
    if (/^\d{4}-\d{2}$/.test(qs.get("month") || "")) g = qs.get("month");
    viewId = qs.get("view") || "";
  } catch { /* ignore */ }
  await I();
  if (viewId) openView(viewId);
}

function h(o) { return o == null ? "" : String(o).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

const STATUS = {
  PENDING: { label: "承認待ち", color: "#c2410c", bg: "#ffedd5" },
  REJECTED: { label: "差戻し", color: "#b91c1c", bg: "#fee2e2" },
  APPROVED: { label: "承認済", color: "#15803d", bg: "#dcfce7" },
  UNSUBMITTED: { label: "未提出", color: "#64748b", bg: "#f1f5f9" }
};
const statusOf = (e) => (STATUS[e.submission_status] ? e.submission_status : "UNSUBMITTED");
const pill = (st) => `<span class="sa-pill${st === "UNSUBMITTED" ? " unsub" : ""}" style="color:${STATUS[st].color};background:${STATUS[st].bg};">${STATUS[st].label}</span>`;
const WORK = ["WORKING", "CA_NGAY", "CA_CHIEU", "CA_DEM", "09:00-14:00"];
const WD = ["日", "月", "火", "水", "木", "金", "土"];

function monthParts() { const [y, m] = g.split("-"); const mm = parseInt(m, 10); return { y: Number(y), m: mm, days: new Date(Number(y), mm, 0).getDate() }; }
const dateKey = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
function fmtTime(v) { if (!v) return "—"; const d = new Date(v); if (isNaN(d)) return "—"; const p = (n) => String(n).padStart(2, "0"); return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`; }

// 1日分のセル（従来と同じ表示ルール: 休暇理由はクリックで表示。パートの未入力日は休）
function cellHtml(e, key, big) {
  const c = (e.schedule || {})[key];
  const cls = big ? " sa-cell-big" : "";
  if (!c) return e.employment_type === "full_time" ? `<div class="cell-empty${cls}">-</div>` : `<div class="cell-off${cls}">休</div>`;
  switch (c.status) {
    case "WORKING": return `<div class="cell-work${cls}">出</div>`;
    case "CA_NGAY": return `<div class="cell-work${cls}">日</div>`;
    case "CA_CHIEU": return `<div class="cell-work${cls}">午</div>`;
    case "CA_DEM": return `<div class="cell-work${cls}">夜</div>`;
    case "09:00-14:00": return `<div class="cell-work${cls}" style="font-size:8px;line-height:1.1;" title="09:00-14:00">9-14</div>`;
    case "LEAVE": {
      const short = { paid: "有休", unpaid: "欠", special: "特休" }[c.leaveType] || "休";
      const label = { paid: "有給休暇", unpaid: "欠勤 / 無給休暇", special: "特別休暇" }[c.leaveType] || "";
      const k = c.leaveType === "paid" ? "cell-leave-paid" : c.leaveType === "special" ? "cell-leave-special" : "cell-leave";
      const reason = c.reason || c.detail || "";
      return c.leaveType
        ? `<div class="${k}${cls} clickable-leave" data-leave-label="${h(label)}" data-reason="${h(reason)}" title="${h([label, reason].filter(Boolean).join("\n") || "理由なし")}">${short}</div>`
        : `<div class="${k}${cls}">${short}</div>`;
    }
    case "OFF": return `<div class="cell-off${cls}">休</div>`;
    default: return `<div class="cell-empty${cls}">-</div>`;
  }
}

function summarize(e) {
  const { y, m, days } = monthParts();
  let work = 0, off = 0, leave = 0;
  for (let d = 1; d <= days; d++) {
    const c = (e.schedule || {})[dateKey(y, m, d)];
    if (!c) continue;
    if (WORK.includes(c.status)) work++; else if (c.status === "LEAVE") leave++; else if (c.status === "OFF") off++;
  }
  return { work, off, leave };
}

async function I() {
  if (l && !l.querySelector(".sa-root")) l.innerHTML = '<div style="padding:20px;color:#64748b;">読み込み中...</div>';
  try {
    const m = await G(`/api/attendance/shifts/matrix?month=${g}${H ? "&department=" + encodeURIComponent(H) : ""}`);
    O = Array.isArray(m) ? m : [];
    for (const id of [...picked]) if (!O.some((e) => String(e.id) === id && statusOf(e) === "PENDING")) picked.delete(id);
    V();
  } catch (o) {
    l && (l.innerHTML = `<div style="padding:20px;color:#dc2626;">取得失敗: ${h(o.message)}</div>`);
  }
}

const CSS = `
  #adminContent { padding: 0 !important; margin: 0 !important; width: 100% !important; max-width: 100% !important; }
  /* 共通UI（案C, admin-ui.css）と同じ見た目 */
  .sa-root { font-family: 'Meiryo UI', 'Yu Gothic UI', Meiryo, sans-serif; color: #1f2937; font-size: 12.5px; padding: 12px 16px 24px; box-sizing: border-box; }
  .sa-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 2px solid #0b2c66; }
  .sa-title { font-size: 16px; font-weight: 700; margin: 0; color: #0b2c66; }
  .sa-tools { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .sa-tools input, .sa-tools select { height: 26px; padding: 0 6px; border: 1px solid #c3cdda; border-radius: 0; font-size: 12.5px; background: #fff; box-sizing: border-box; font-family: inherit; }
  /* ボタンは「登録」ボタン（#0b2c66・角丸4px）と同じトーン。管理画面の共通CSSに負けないよう !important */
  .sa-root .sa-btn, #saView .sa-btn { display: inline-flex !important; align-items: center; justify-content: center; gap: 4px; height: 24px; padding: 0 10px !important; border: 1px solid #c3cdda !important; border-radius: 2px !important; background: #fff !important; color: #1f2937 !important; font-family: inherit !important; font-size: 12px !important; font-weight: 600 !important; line-height: 1 !important; cursor: pointer; white-space: nowrap; box-shadow: none !important; }
  .sa-root .sa-btn:hover, #saView .sa-btn:hover { background: #f6f8fb !important; border-color: #8a97aa !important; }
  .sa-root .sa-btn.sm, #saView .sa-btn.sm { height: 20px; padding: 0 7px !important; font-size: 11.5px !important; }
  .sa-root .sa-btn.ok, #saView .sa-btn.ok { background: #0b2c66 !important; border-color: #08214d !important; color: #fff !important; }
  .sa-root .sa-btn.ok:hover, #saView .sa-btn.ok:hover { background: #0a2556 !important; }
  .sa-root .sa-btn.ng, #saView .sa-btn.ng { background: #fff !important; border-color: #d79a9a !important; color: #a11 !important; }
  .sa-root .sa-btn.ng:hover, #saView .sa-btn.ng:hover { background: #fbeeee !important; }
  /* タブ: 紙のファイルの見出し風（申請一覧と同じ） */
  .sa-root .sa-tab { display: inline-flex !important; align-items: center; gap: 4px; height: 24px; padding: 0 12px !important; margin-bottom: -1px; border: 1px solid #c3cdda !important; border-bottom: 0 !important; border-radius: 0 !important; background: #f6f8fb !important; color: #334155 !important; font-family: inherit !important; font-size: 12.5px !important; font-weight: 600 !important; cursor: pointer; white-space: nowrap; box-shadow: none !important; }
  .sa-root .sa-tab:hover { background: #eef2f7 !important; }
  .sa-root .sa-btn:disabled, #saView .sa-btn:disabled { opacity: .45; cursor: default; }
  .sa-tabs { display: flex; gap: 2px; align-items: flex-end; flex-wrap: wrap; margin-bottom: 0; padding: 4px 6px 0; background: #f3f6fa; border: 1px solid #c3cdda; border-bottom: 1px solid #c3cdda; }
  .sa-root .sa-tab.active, .sa-root .sa-tab.active:hover { background: #fff !important; color: #0b2c66 !important; font-weight: 700 !important; height: 25px; }
  .sa-root .sa-count { font-weight: 600; }
  .sa-root .sa-tab.hot:not(.active) .sa-count { color: #c2410c; font-weight: 800; }
  .sa-pill { display: inline-block; padding: 0 8px; border-radius: 0; border: 1px solid rgba(0,0,0,.12); font-size: 11.5px; font-weight: 700; line-height: 18px; white-space: nowrap; }
  .sa-type { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; border: 1px solid #bfdbfe; background: #eff6ff; color: #1e40af; }
  .sa-type.part { border-color: #bbf7d0; background: #dcfce7; color: #166534; }
  .sa-list { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #c3cdda; border-top: 0; }
  .sa-list th { background: #eef2f7; font-size: 12px; color: #0f172a; font-weight: 700; text-align: left; padding: 4px 8px; border: 1px solid #c3cdda; white-space: nowrap; }
  .sa-list td { padding: 3px 8px; border: 1px solid #d3dae4; font-size: 12.5px; vertical-align: middle; }
  .sa-list tbody tr:nth-child(even) td { background: #f7f9fc; }
  .sa-list tbody tr:hover td { background: #fff8db; }
  .sa-list .num { text-align: right; white-space: nowrap; }
  .sa-name { font-weight: 700; font-size: 13px; }
  .sa-code { color: #94a3b8; font-size: 12px; margin-left: 6px; }
  .sa-actions { display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap; }
  .sa-empty { padding: 24px 16px; text-align: center; color: #64748b; background: #fff; border: 1px solid #c3cdda; border-top: 0; }
  .sa-bulk { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 10px 0 0; flex-wrap: wrap; font-size: 12.5px; color: #64748b; }
  /* 全員の一覧表: 従業員=行, 日付=列 */
  .sa-grid-wrap { overflow: auto; border: 1px solid #c3cdda; border-top: 0; max-height: calc(100vh - 230px); background: #fff; }
  .sa-grid { border-collapse: separate; border-spacing: 0; font-size: 11px; }
  .sa-grid th, .sa-grid td { border-right: 1px solid #d3dae4; border-bottom: 1px solid #d3dae4; padding: 3px 2px; text-align: center; background: #fff; }
  .sa-grid thead th { position: sticky; top: 0; z-index: 3; background: #eef2f7; font-weight: 700; color: #0f172a; min-width: 26px; border-color: #c3cdda; }
  .sa-grid .emp { position: sticky; left: 0; z-index: 2; text-align: left; min-width: 190px; max-width: 190px; padding: 4px 8px; background: #fff; box-shadow: 1px 0 0 #e2e8f0; }
  .sa-grid thead th.emp { z-index: 4; background: #eef2f7; }
  .sa-grid .emp .n { font-weight: 800; font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sa-grid .emp .s { display: flex; gap: 4px; align-items: center; margin-top: 2px; font-size: 11px; color: #64748b; }
  .sa-grid .emp .s .sa-pill, .sa-grid .emp .s .sa-type { font-size: 9px !important; line-height: 13px !important; padding: 0 3px !important; font-weight: 600 !important; border-radius: 2px !important; }
  .sa-grid .emp .s .sa-pill.unsub { background: transparent !important; border-color: transparent !important; padding: 0 !important; color: #64748b !important; font-weight: 600 !important; }
  .sa-grid tr.dim td { opacity: .45; }
  .sa-grid tr.dim td.emp { opacity: 1; }
  .sa-grid tbody tr:hover td { background: #fff8db; }
  .sa-grid .sat { color: #2563eb; } .sa-grid .sun { color: #dc2626; }
  .sa-grid td.sun-col, .sa-grid th.sun-col { background: #fff7f7; }
  .sa-grid td.sat-col, .sa-grid th.sat-col { background: #f5f9ff; }
  .sa-grid .tot { font-weight: 700; color: #0369a1; min-width: 34px; }
  .sa-sep td { background: #f1f5f9 !important; color: #64748b; font-weight: 700; text-align: left !important; padding: 5px 10px !important; }
  /* セル（従来の色分け） */
  .cell-work, .cell-off, .cell-leave, .cell-leave-paid, .cell-leave-special, .cell-empty { width: 22px; height: 20px; display: flex; align-items: center; justify-content: center; margin: 0 auto; border-radius: 3px; font-size: 11px; font-weight: 700; box-sizing: border-box; }
  .cell-work { background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; }
  .cell-off, .cell-leave { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
  .cell-leave-paid { background: #fef9c3; color: #92400e; border: 1px solid #fde68a; font-size: 9.5px; }
  .cell-leave-special { background: #f3e8ff; color: #6b21a8; border: 1px solid #e9d5ff; font-size: 9.5px; }
  .cell-empty { color: #cbd5e1; font-weight: 400; }
  .clickable-leave { cursor: pointer; }
  .sa-cell-big { width: 100%; height: 30px; font-size: 13px; }
  /* 内容を見る（月カレンダー） */
  /* 上部メニュー（z-index が非常に高い）の下から表示し、見出しとボタンは常に見えるようにする */
  .sa-ov { position: fixed; inset: 0; top: var(--topbar-height, 52px); background: rgba(15,23,42,.45); z-index: 9990; display: flex; align-items: center; justify-content: center; padding: 12px 16px; box-sizing: border-box; }
  .sa-modal { background: #fff; border-radius: 2px; border: 1px solid #c3cdda; width: min(560px, 100%); max-height: 100%; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,.3); }
  .sa-mh { flex: 0 0 auto; display: flex; justify-content: space-between; align-items: flex-start; padding: 8px 14px; background: #eef2f7; color: #0b2c66; border-bottom: 1px solid #c3cdda; }
  .sa-mb { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 14px 18px; }
  .sa-mf { flex: 0 0 auto; display: flex; justify-content: flex-end; gap: 6px; padding: 8px 14px; border-top: 1px solid #c3cdda; background: #f1f4f8; flex-wrap: wrap; }
  .sa-cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
  .sa-cal .wd { text-align: center; font-size: 11.5px; font-weight: 700; color: #64748b; padding-bottom: 2px; }
  .sa-cal .day { border: 1px solid #e2e8f0; border-radius: 6px; padding: 3px; min-height: 50px; box-sizing: border-box; }
  .sa-cal .day .d { font-size: 11px; font-weight: 700; margin-bottom: 3px; }
  .sa-sum { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
  .sa-sum div { background: #fff; border: 1px solid #c3ccd8; border-radius: 0; padding: 2px 10px; font-size: 11.5px; color: #475569; }
  .sa-sum b { color: #0b2c66; font-size: 13.5px; }
  .reason-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 9999; display: none; align-items: center; justify-content: center; }
  .reason-modal-overlay.show { display: flex; }
  .reason-modal-content { background: #fff; border-radius: 8px; width: 90%; max-width: 320px; overflow: hidden; }
  .reason-modal-header { padding: 12px 16px; background: #f8fafc; font-weight: bold; border-bottom: 1px solid #e2e8f0; }
  .reason-modal-body { padding: 16px; font-size: 14px; line-height: 1.5; min-height: 60px; word-break: break-word; }
  .reason-modal-footer { padding: 12px 16px; background: #f8fafc; border-top: 1px solid #e2e8f0; text-align: right; }
  .reason-modal-btn { padding: 6px 16px; background: #64748b; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; }
  @media (max-width: 768px) {
    .sa-root { padding: 10px; }
    .sa-head .sa-title { display: none; }
    .sa-list thead { display: none; }
    .sa-list, .sa-list tbody, .sa-list tr, .sa-list td { display: block; width: 100%; box-sizing: border-box; }
    .sa-list tr { border-bottom: 1px solid #e2e8f0; padding: 8px 4px; }
    .sa-list td { border: none; padding: 3px 8px; }
    .sa-list .num { text-align: left; }
    .sa-list td[data-l]::before { content: attr(data-l) "："; color: #94a3b8; font-size: 12px; }
    .sa-actions { justify-content: flex-start; }
    .sa-grid-wrap { max-height: calc(100vh - 200px); }
    .sa-grid .emp { min-width: 120px; max-width: 120px; }
  }
`;

function V() {
  if (!l) return;
  const { y, m, days } = monthParts();
  const matchQ = (e) => { if (!q) return true; const s = q.toLowerCase(); return String(e.username || "").toLowerCase().includes(s) || String(e.employee_code || "").toLowerCase().includes(s); };
  const all = O.filter(matchQ);
  const byStatus = (st) => all.filter((e) => statusOf(e) === st);
  const counts = { PENDING: byStatus("PENDING").length, REJECTED: byStatus("REJECTED").length, APPROVED: byStatus("APPROVED").length, UNSUBMITTED: byStatus("UNSUBMITTED").length };
  const tabBtn = (id, label, n, hot) => `<button type="button" class="sa-tab${TAB === id ? " active" : ""}${hot && n ? " hot" : ""}" data-tab="${id}">${label}${n == null ? "" : `<span class="sa-count">（${n}）</span>`}</button>`;
  const depts = [...new Set(O.map((e) => e.departmentName).filter(Boolean))].sort();
  if (H && !depts.includes(H)) depts.push(H);

  let body = "";
  if (TAB === "ALL") body = gridHtml(all, y, m, days);
  else body = listHtml(byStatus(TAB), TAB);

  const active = document.activeElement; const keepSearch = active && active.id === "saSearch" ? [active.selectionStart, active.selectionEnd] : null;
  l.innerHTML = `
    <style>${CSS}</style>
    <div class="sa-root">
      <div class="sa-head">
        <h2 class="sa-title">シフト表</h2>
        <div class="sa-tools">
          <input type="text" id="saSearch" value="${h(q)}" placeholder="名前・番号で検索" style="width:160px;">
          <select id="saDept"><option value="">全部署</option>${depts.map((d) => `<option value="${h(d)}" ${d === H ? "selected" : ""}>${h(d)}</option>`).join("")}</select>
          <span style="display:inline-flex;gap:4px;">${[[ymJST(0), "今月"], [ymJST(1), "来月"]].map(([ym, lb]) => `<button type="button" class="sa-btn${g === ym ? " ok" : ""}" data-ym="${ym}" title="${ym}">${lb}</button>`).join("")}</span>
          <input type="month" id="saMonth" value="${g}" style="width:140px;">
          <button type="button" class="sa-btn pdf" id="shiftsExportPdf">PDF出力</button>
        </div>
      </div>
      <div class="sa-tabs">
        ${tabBtn("ALL", "全員の一覧表", null)}
        ${tabBtn("UNSUBMITTED", "未提出", counts.UNSUBMITTED)}
        <a href="/admin/attendance/adjust-requests?tab=shift" style="margin-left:auto;align-self:center;font-size:12px;color:#0b2c66;text-decoration:underline;">シフトの承認は 申請一覧 で${counts.PENDING ? `（承認待ち ${counts.PENDING}件）` : ""}</a>
      </div>
      ${body}
    </div>
    <div id="reasonModal" class="reason-modal-overlay">
      <div class="reason-modal-content">
        <div id="reasonModalHeader" class="reason-modal-header">休みの理由</div>
        <div id="reasonModalText" class="reason-modal-body"></div>
        <div class="reason-modal-footer"><button id="closeReasonModalBtn" class="reason-modal-btn">閉じる</button></div>
      </div>
    </div>
  `;
  if (keepSearch) { const s = l.querySelector("#saSearch"); if (s) { s.focus(); try { s.setSelectionRange(keepSearch[0], keepSearch[1]); } catch { /* ignore */ } } }
  bind(l);
  syncMobileMonth();
}

function listHtml(rows, st) {
  const { y, m } = monthParts();
  const empty = {
    PENDING: "承認待ちのシフトはありません。",
    REJECTED: "差戻し中のシフトはありません。",
    APPROVED: "承認済みのシフトはありません。",
    UNSUBMITTED: "未提出の従業員はいません。"
  }[st];
  if (!rows.length) return `<div class="sa-empty">${empty}<div style="margin-top:10px;"><button type="button" class="sa-btn sm" data-tab="ALL">全員の一覧表を見る</button></div></div>`;
  const pending = st === "PENDING";
  const timeLabel = { PENDING: "提出日時", REJECTED: "差戻し日時", APPROVED: "承認日時", UNSUBMITTED: "" }[st];
  const rowsHtml = rows.map((e) => {
    const s = summarize(e); const id = String(e.id); const part = e.employment_type !== "full_time";
    return `
      <tr data-id="${h(id)}">
        ${pending ? `<td style="width:34px;"><input type="checkbox" class="sa-pick" ${picked.has(id) ? "checked" : ""} aria-label="${h(e.username)}を選択"></td>` : ""}
        <td><span class="sa-name">${h(e.username)}</span>${e.employee_code ? `<span class="sa-code">${h(e.employee_code)}</span>` : ""}</td>
        <td data-l="部署">${h(e.departmentName || "—")}</td>
        <td data-l="区分"><span class="sa-type${part ? " part" : ""}">${part ? "パート" : "正社員"}</span></td>
        <td class="num" data-l="出勤">${st === "UNSUBMITTED" && !s.work ? "—" : `<b>${s.work}</b>日`}</td>
        <td class="num" data-l="休み">${st === "UNSUBMITTED" && !s.off && !s.leave ? "—" : `${s.off + s.leave}日`}</td>
        ${timeLabel ? `<td data-l="${timeLabel}" style="color:#64748b;white-space:nowrap;">${h(fmtTime(e.submission_updated_at))}</td>` : ""}
        <td><div class="sa-actions">
          ${st === "UNSUBMITTED" ? "" : `<button type="button" class="sa-btn sm btn-view" data-id="${h(id)}">内容を見る</button>`}
          ${pending ? `<button type="button" class="sa-btn sm ok btn-approve" data-id="${h(id)}">承認</button><button type="button" class="sa-btn sm ng btn-reject" data-id="${h(id)}">差戻し</button>` : ""}
          <button type="button" class="sa-btn sm btn-proxy" data-id="${h(id)}" data-name="${h(e.username)}">代理入力</button>
        </div></td>
      </tr>`;
  }).join("");
  return `
    <table class="sa-list">
      <thead><tr>
        ${pending ? `<th style="width:34px;"><input type="checkbox" id="saPickAll" aria-label="すべて選択" ${rows.every((e) => picked.has(String(e.id))) ? "checked" : ""}></th>` : ""}
        <th>氏名</th><th>部署</th><th>区分</th><th style="text-align:right;">出勤</th><th style="text-align:right;">休み</th>${timeLabel ? `<th>${timeLabel}</th>` : ""}<th></th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    ${pending ? `<div class="sa-bulk"><span>${y}年${m}月分・「内容を見る」で日ごとの出勤・休みを確認できます</span><button type="button" class="sa-btn ok" id="saBulkApprove" ${picked.size ? "" : "disabled"}>選択した人をまとめて承認${picked.size ? `（${picked.size}名）` : ""}</button></div>` : ""}
    ${st === "UNSUBMITTED" ? `<div class="sa-bulk"><span>未提出の人は、本人が提出するのを待つか「代理入力」で入力できます</span></div>` : ""}
  `;
}

function gridHtml(rows, y, m, days) {
  if (!rows.length) return `<div class="sa-empty">データがありません</div>`;
  const order = { PENDING: 0, REJECTED: 1, APPROVED: 2, UNSUBMITTED: 3 };
  const sorted = rows.slice().sort((a, b) => order[statusOf(a)] - order[statusOf(b)]);
  const dayCls = (d) => { const w = new Date(y, m - 1, d).getDay(); return w === 0 ? "sun" : w === 6 ? "sat" : ""; };
  const head = Array.from({ length: days }, (_, i) => { const d = i + 1; const c = dayCls(d); return `<th class="${c ? c + "-col" : ""}"><div class="${c}">${d}</div><div class="${c}" style="font-weight:400;font-size:10px;">${WD[new Date(y, m - 1, d).getDay()]}</div></th>`; }).join("");
  let firstUnsub = true;
  const body = sorted.map((e) => {
    const st = statusOf(e); const s = summarize(e); const part = e.employment_type !== "full_time";
    let sep = "";
    if (st === "UNSUBMITTED" && firstUnsub) { firstUnsub = false; sep = `<tr class="sa-sep"><td class="emp">未提出</td><td colspan="${days + 1}"></td></tr>`; }
    const cells = Array.from({ length: days }, (_, i) => { const c = dayCls(i + 1); return `<td class="${c ? c + "-col" : ""}">${cellHtml(e, dateKey(y, m, i + 1))}</td>`; }).join("");
    return `${sep}<tr class="${st === "UNSUBMITTED" ? "dim" : ""}">
      <td class="emp"><div class="n" title="${h(e.username)}">${h(e.username)} <span style="color:#94a3b8;font-weight:400;">${h(e.employee_code || "")}</span></div>
        <div class="s">${pill(st)}<span class="sa-type${part ? " part" : ""}">${part ? "パート" : "正"}</span>${st === "UNSUBMITTED" ? "" : `<button type="button" class="sa-btn sm btn-view" data-id="${h(String(e.id))}" style="height:20px;padding:0 6px;font-size:10.5px;">見る</button>`}</div></td>
      ${cells}<td class="tot" title="出勤日数">${s.work}</td></tr>`;
  }).join("");
  return `<div class="sa-grid-wrap"><table class="sa-grid"><thead><tr><th class="emp">従業員</th>${head}<th class="tot">出勤</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

// 内容を見る: 月カレンダー（月曜始まり）＋その場で承認・差戻し・代理入力
function openView(id) {
  const e = O.find((x) => String(x.id) === String(id)); if (!e) return;
  const { y, m, days } = monthParts(); const st = statusOf(e); const s = summarize(e);
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const wds = ["月", "火", "水", "木", "金", "土", "日"];
  let cal = wds.map((w, i) => `<div class="wd" style="${i === 5 ? "color:#2563eb;" : i === 6 ? "color:#dc2626;" : ""}">${w}</div>`).join("");
  for (let i = 0; i < lead; i++) cal += "<div></div>";
  for (let d = 1; d <= days; d++) {
    const w = new Date(y, m - 1, d).getDay();
    cal += `<div class="day" style="${w === 0 ? "background:#fff7f7;" : w === 6 ? "background:#f5f9ff;" : ""}"><div class="d" style="${w === 0 ? "color:#dc2626;" : w === 6 ? "color:#2563eb;" : ""}">${d}</div>${cellHtml(e, dateKey(y, m, d), true)}</div>`;
  }
  document.getElementById("saView")?.remove();
  document.body.insertAdjacentHTML("beforeend", `
    <div class="sa-ov" id="saView">
      <div class="sa-modal" role="dialog" aria-label="シフト内容">
        <div class="sa-mh">
          <div><div style="font-size:16px;font-weight:800;">${h(e.username)} <span style="color:#94a3b8;font-weight:400;font-size:13px;">${h(e.employee_code || "")}</span></div>
            <div style="margin-top:4px;display:flex;gap:6px;align-items:center;font-size:12.5px;color:#64748b;">${y}年${m}月 ${pill(st)} ${h(e.departmentName || "")}</div></div>
          <button type="button" class="sa-btn sm" id="saViewClose" aria-label="閉じる">✕</button>
        </div>
        <div class="sa-mb">
          <div class="sa-sum"><div>出勤 <b>${s.work}</b>日</div><div>休日 <b>${s.off}</b>日</div><div>休暇 <b>${s.leave}</b>日</div></div>
          <div class="sa-cal">${cal}</div>
          <div style="font-size:11.5px;color:#94a3b8;margin-top:8px;">有休・欠・特休はクリックで理由を表示します</div>
        </div>
        <div class="sa-mf">
          <button type="button" class="sa-btn btn-proxy" data-id="${h(String(e.id))}" data-name="${h(e.username)}">代理入力</button>
          ${st === "PENDING" ? `<button type="button" class="sa-btn ng btn-reject" data-id="${h(String(e.id))}">差戻し</button><button type="button" class="sa-btn ok btn-approve" data-id="${h(String(e.id))}">承認する</button>` : ""}
        </div>
      </div>
    </div>`);
  const ov = document.getElementById("saView");
  const close = () => ov && ov.remove();
  ov.addEventListener("click", (ev) => { if (ev.target === ov) close(); });
  ov.querySelector("#saViewClose").addEventListener("click", close);
  bindActions(ov, close);
  bindLeave(ov);
}

async function approveMany(ids) {
  const btn = l.querySelector("#saBulkApprove"); if (btn) { btn.disabled = true; btn.textContent = "承認中..."; }
  const failed = [];
  for (const id of ids) {
    try {
      const r = await G("/api/attendance/shifts/submissions/approve", { method: "POST", body: JSON.stringify({ userId: id, month: g, status: "APPROVED" }) });
      if (!r || !r.success) failed.push(id);
      else picked.delete(String(id));
    } catch { failed.push(id); }
  }
  if (failed.length) {
    const names = failed.map((id) => (O.find((e) => String(e.id) === String(id)) || {}).username || id);
    alert(`承認できなかった人がいます: ${names.join("、")}`);
  }
  await I();
}

function bindActions(root, after) {
  root.querySelectorAll(".btn-approve").forEach((b) => b.addEventListener("click", () => {
    const e = O.find((x) => String(x.id) === b.getAttribute("data-id"));
    if (confirm(`${e ? e.username + "さんの" : ""}シフトを承認しますか？`)) { after && after(); X(b.getAttribute("data-id"), "APPROVED"); }
  }));
  root.querySelectorAll(".btn-reject").forEach((b) => b.addEventListener("click", () => {
    const e = O.find((x) => String(x.id) === b.getAttribute("data-id"));
    if (confirm(`${e ? e.username + "さんの" : ""}シフトを差戻しますか？\n本人が修正して再提出できるようになります。`)) { after && after(); X(b.getAttribute("data-id"), "REJECTED"); }
  }));
  root.querySelectorAll(".btn-proxy").forEach((b) => b.addEventListener("click", async () => { after && after(); await Z(b.getAttribute("data-id"), b.getAttribute("data-name") || ""); }));
}

function bindLeave(root) {
  root.querySelectorAll(".clickable-leave").forEach((t) => t.addEventListener("click", (ev) => {
    const a = ev.currentTarget; const p = l.querySelector("#reasonModal"); const L = l.querySelector("#reasonModalText"); const hd = l.querySelector("#reasonModalHeader");
    if (!p || !L) return;
    hd && (hd.textContent = a.getAttribute("data-leave-label") || "休みの理由");
    const r = a.getAttribute("data-reason") || "";
    if (r) L.textContent = r; else L.innerHTML = '<span style="color:#94a3b8;">理由の記載なし</span>';
    p.classList.add("show");
  }));
}

function bind(root) {
  root.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { TAB = b.getAttribute("data-tab"); V(); }));
  root.querySelector("#saSearch")?.addEventListener("input", (ev) => { q = ev.target.value; V(); });
  root.querySelector("#saDept")?.addEventListener("change", (ev) => { H = ev.target.value; I(); });
  root.querySelector("#saMonth")?.addEventListener("change", (ev) => { g = ev.target.value; picked.clear(); I(); });
  root.querySelectorAll("[data-ym]").forEach((b) => b.addEventListener("click", () => { g = b.getAttribute("data-ym"); picked.clear(); I(); }));
  root.querySelectorAll(".btn-view").forEach((b) => b.addEventListener("click", () => openView(b.getAttribute("data-id"))));
  root.querySelectorAll(".sa-pick").forEach((c) => c.addEventListener("change", () => { const id = c.closest("tr").getAttribute("data-id"); c.checked ? picked.add(id) : picked.delete(id); V(); }));
  root.querySelector("#saPickAll")?.addEventListener("change", (ev) => {
    O.filter((e) => statusOf(e) === "PENDING").forEach((e) => { ev.target.checked ? picked.add(String(e.id)) : picked.delete(String(e.id)); });
    V();
  });
  root.querySelector("#saBulkApprove")?.addEventListener("click", () => {
    const ids = [...picked]; if (!ids.length) return;
    if (confirm(`${ids.length}名のシフトをまとめて承認しますか？`)) approveMany(ids);
  });
  bindActions(root);
  bindLeave(root);
  const p = root.querySelector("#reasonModal");
  root.querySelector("#closeReasonModalBtn")?.addEventListener("click", () => p && p.classList.remove("show"));
  p?.addEventListener("click", (ev) => { if (ev.target === p) p.classList.remove("show"); });
  // PDF出力（従来と同じAPI）
  const pdf = root.querySelector("#shiftsExportPdf");
  pdf?.addEventListener("click", async () => {
    const orig = pdf.textContent; pdf.disabled = true; pdf.textContent = "出力中...";
    try {
      const resp = await fetch(`/api/attendance/shifts/export.pdf?month=${encodeURIComponent(g)}`, { credentials: "include" });
      if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.message || `HTTP ${resp.status}`); }
      const url = URL.createObjectURL(await resp.blob());
      const a = document.createElement("a"); a.href = url; a.download = `シフト承認_${g}.pdf`; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) { alert("PDF出力に失敗しました: " + (err.message || err)); }
    finally { pdf.disabled = false; pdf.textContent = orig; }
  });
}

// スマホ: 上部バー（attHubMobileActions）に月の選択を出す（従来と同じ）
function syncMobileMonth() {
  const box = document.getElementById("attHubMobileActions");
  if (!box) return;
  if (window.innerWidth > 768) { box.innerHTML = ""; return; }
  let mm = document.getElementById("monthFilterMobile");
  if (!mm) {
    mm = document.createElement("input"); mm.type = "month"; mm.id = "monthFilterMobile";
    mm.style.cssText = "height:32px;padding:0 10px;border:1px solid #d1d5db;border-radius:4px;font-size:13px;width:130px;color:#1f2937;margin:0;box-sizing:border-box;background:white;";
    box.innerHTML = ""; box.appendChild(mm);
    mm.addEventListener("change", (ev) => { g = ev.target.value; picked.clear(); I(); });
  }
  mm.value = g;
}

// ---- ここから下は従来の実装（承認API呼び出し X / 代理入力 Z）をそのまま使用 ----
async function X(o,d){try{const r=await G("/api/attendance/shifts/submissions/approve",{method:"POST",body:JSON.stringify({userId:o,month:g,status:d})});r.success?I():alert("\u30A8\u30E9\u30FC: "+(r.message||"Unknown error"))}catch(r){alert("\u30A8\u30E9\u30FC: "+r.message)}}async function Z(o,d){const[r,m]=g.split("-"),k=parseInt(m,10),z=new Date(r,k,0).getDate(),P=["\u65E5","\u6708","\u706B","\u6C34","\u6728","\u91D1","\u571F"];let A=[];try{const n=await G(`/api/attendance/shifts/user-month?userId=${o}&month=${g}`);A=Array.isArray(n)?n:[]}catch{}const D=O.find(n=>String(n.id)===String(o)),_=D&&D.employment_type!=="full_time",R={};A.forEach(n=>{const i=String(n.date).slice(0,10);R[i]={status:n.status||"OFF",leaveType:n.leaveType||null}});let b="";for(let n=1;n<=z;n++){const i=`${r}-${String(k).padStart(2,"0")}-${String(n).padStart(2,"0")}`,p=new Date(r,k-1,n),L=P[p.getDay()],y=p.getDay()===0,E=p.getDay()===6,t=y?"color:#dc2626;":E?"color:#2563eb;":"",e=R[i]||{},a=e.status||"",f=e.leaveType||"",u=D&&String(D.departmentName||"").includes("\u5DE5\u4E8B\u90E8"),w=E&&Math.ceil(n/7)===4,c=y||(u?w:E);let s="";a==="WORKING"?s="WORKING":a==="LEAVE"&&f==="paid"?s="PAID":a==="LEAVE"&&f==="unpaid"?s="ABSENT":a==="OFF"&&(s="OFF");let x="";_?x=`
        <label style="font-size:11px;cursor:pointer;"><input type="radio" name="day_${i}" value="WORKING" ${s==="WORKING"?"checked":""}> \u51FA\u52E4</label>
        <label style="font-size:11px;cursor:pointer;"><input type="radio" name="day_${i}" value="OFF" ${s==="OFF"?"checked":""}> \u4F11\u65E5</label>
        <label style="font-size:11px;cursor:pointer;"><input type="radio" name="day_${i}" value="" ${s?"":"checked"}> \u672A\u8A2D\u5B9A</label>
      `:c?x=`
        <label style="font-size:11px;cursor:pointer;"><input type="radio" name="day_${i}" value="FURIKAE" ${a==="WORKING"?"checked":""}> \u632F\u66FF\u51FA\u52E4</label>
        <label style="font-size:11px;cursor:pointer;"><input type="radio" name="day_${i}" value="HOLIDAY_WORK" ${s==="HOLIDAY_WORK"?"checked":""}> \u4F11\u65E5\u51FA\u52E4</label>
        <label style="font-size:11px;cursor:pointer;"><input type="radio" name="day_${i}" value="OFF" ${s==="OFF"||!s?"checked":""}> \u4F11\u65E5</label>
        <label style="font-size:11px;cursor:pointer;"><input type="radio" name="day_${i}" value="" > \u672A\u8A2D\u5B9A</label>
      `:x=`
        <label style="font-size:11px;cursor:pointer;"><input type="radio" name="day_${i}" value="WORKING" ${s==="WORKING"?"checked":""}> \u51FA\u52E4</label>
        <label style="font-size:11px;cursor:pointer;"><input type="radio" name="day_${i}" value="OFF" ${s==="OFF"?"checked":""}> \u4F11\u65E5</label>
        <label style="font-size:11px;cursor:pointer;"><input type="radio" name="day_${i}" value="PAID" ${s==="PAID"?"checked":""}> \u6709\u4F11</label>
        <label style="font-size:11px;cursor:pointer;"><input type="radio" name="day_${i}" value="ABSENT" ${s==="ABSENT"?"checked":""}> \u6B20\u52E4</label>
        <label style="font-size:11px;cursor:pointer;"><input type="radio" name="day_${i}" value="" ${s?"":"checked"}> \u672A\u8A2D\u5B9A</label>
      `,b+=`
      <div style="display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid #f1f5f9;${c?"background:#fef2f2;":""}">
        <span style="width:65px;font-size:11px;font-weight:600;${t}">${k}/${n}(${L})</span>
        ${x}
      </div>
    `}const F=`
    <div id="proxyModal" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;">
      <div style="background:#fff;border-radius:8px;width:420px;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
        <div style="padding:16px 20px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;">
          <h3 style="margin:0;font-size:15px;font-weight:700;">\u4EE3\u7406\u5165\u529B: ${h(d)}</h3>
          <button id="closeProxyModal" style="border:none;background:none;font-size:20px;cursor:pointer;color:#64748b;">\u2715</button>
        </div>
        <div style="padding:16px 20px;overflow-y:auto;flex:1;">
          <div style="margin-bottom:8px;font-size:11px;color:#64748b;">\u5BFE\u8C61\u6708: ${r}\u5E74${m}\u6708 \u30FB \u5404\u65E5\u306E\u51FA\u52E4/\u4F11\u307F\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044</div>
          <div id="proxyDaysList">${b}</div>
        </div>
        <div style="padding:12px 20px;border-top:1px solid #e2e8f0;display:flex;gap:8px;justify-content:flex-end;">
          <button id="cancelProxy" style="padding:8px 16px;border:1px solid #d1d5db;border-radius:6px;background:#fff;cursor:pointer;font-size:13px;">\u30AD\u30E3\u30F3\u30BB\u30EB</button>
          <button id="saveProxy" style="padding:8px 16px;border:none;border-radius:6px;background:#2563eb;color:#fff;cursor:pointer;font-size:13px;font-weight:600;">\u4FDD\u5B58</button>
        </div>
      </div>
    </div>
  `,N=document.getElementById("proxyModal");N&&N.remove(),document.body.insertAdjacentHTML("beforeend",F);const T=document.getElementById("proxyModal"),B=document.getElementById("closeProxyModal"),j=document.getElementById("cancelProxy"),$=document.getElementById("saveProxy"),S=()=>{T&&T.remove()};B.addEventListener("click",S),j.addEventListener("click",S),T.addEventListener("click",n=>{n.target===T&&S()}),$.addEventListener("click",async()=>{$.disabled=!0,$.textContent="\u4FDD\u5B58\u4E2D...";const n=[];for(let i=1;i<=z;i++){const p=`${r}-${String(k).padStart(2,"0")}-${String(i).padStart(2,"0")}`,L=document.querySelectorAll(`input[name="day_${p}"]`);let y="";L.forEach(E=>{E.checked&&(y=E.value)}),y&&(y==="PAID"?n.push({date:p,status:"LEAVE",leaveType:"paid"}):y==="ABSENT"?n.push({date:p,status:"LEAVE",leaveType:"unpaid"}):y==="FURIKAE"?n.push({date:p,status:"WORKING",detail:"\u632F\u66FF\u51FA\u52E4"}):y==="HOLIDAY_WORK"?n.push({date:p,status:"WORKING",detail:"\u4F11\u65E5\u51FA\u52E4"}):n.push({date:p,status:y}))}try{const i=await G("/api/attendance/shifts/bulk",{method:"POST",body:JSON.stringify({userId:o,month:g,shifts:n})});i.success?(S(),await I()):(alert("\u4FDD\u5B58\u5931\u6557: "+(i.message||"")),$.disabled=!1,$.textContent="\u4FDD\u5B58")}catch(i){alert("\u30A8\u30E9\u30FC: "+i.message),$.disabled=!1,$.textContent="\u4FDD\u5B58"}})}export{te as mount};
