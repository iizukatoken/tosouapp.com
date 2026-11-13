/**
 * 打刻編集パネル（管理者・マネージャー）。勤怠記録（日別）・月次勤怠入力 から開く。
 * 取消は削除ではなく原本を残す（取り消し線＋取消済み、元に戻す で復元）。修正・取消・追加・復元は理由が必須。
 *   openPunchEdit({ userId, date, name, code, onChanged })
 */
import { api } from '../../shared/api/client.js';
import { escapeHtml as esc } from '../_shared/dom.js';

const CSS = `
.pe-bg{position:fixed;inset:0;background:rgba(15,23,42,.38);z-index:9998}
.pe-panel{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(760px,calc(100vw - 32px));max-height:86vh;background:#fff;border:1px solid #d5dde8;border-radius:6px;box-shadow:0 18px 48px rgba(15,23,42,.22);z-index:9999;font-family:'Meiryo UI','Yu Gothic UI',sans-serif;color:#1f2937;display:flex;flex-direction:column;overflow:hidden}
.pe-hd{background:#fff;color:#0b2c66;padding:14px 18px 10px;display:flex;align-items:baseline;gap:12px;border-bottom:2px solid #0b2c66}
.pe-hd b{font-size:16px;font-weight:700}.pe-hd span{font-size:12.5px;color:#475569}
.pe-x{margin-left:auto;align-self:center;background:none;border:0;color:#94a3b8;font-size:22px;line-height:1;cursor:pointer;padding:0 2px}
.pe-x:hover{color:#334155}
.pe-body{flex:1;overflow:auto;padding:6px 18px 4px}
.pe-sec{padding:10px 0}
.pe-sec h4{margin:0 0 8px;font-size:12.5px;font-weight:700;color:#0b2c66;background:#f1f5f9;border-left:3px solid #0b2c66;padding:5px 8px}
.pe-t{width:100%;border-collapse:collapse;font-size:13px}
.pe-t th{background:#f8fafc !important;color:#475569 !important;border:1px solid #e2e8f0 !important;padding:6px 10px !important;text-align:left;font-weight:600;font-size:12px}
.pe-t td{border:1px solid #e2e8f0 !important;padding:7px 10px !important;vertical-align:middle;color:#1f2937}
.pe-t tr.void td{background:#fafbfc;color:#94a3b8 !important}
.pe-b{display:inline-block;height:26px;line-height:24px;padding:0 10px;border:1px solid #cbd5e1;border-radius:3px;background:#fff;font-size:12px;font-weight:600;color:#334155;margin:1px 4px 1px 0;cursor:pointer;font-family:inherit}
.pe-b:hover{background:#f1f5f9;border-color:#94a3b8}.pe-b:disabled{opacity:.5;cursor:default}
.pe-b.del{color:#b91c1c;border-color:#f1c4c4}.pe-b.del:hover{background:#fef2f2}
.pe-b.pri{background:#0b2c66;border-color:#0b2c66;color:#fff}.pe-b.pri:hover{background:#163d82}
.pe-b.danger{background:#b91c1c;border-color:#b91c1c;color:#fff}.pe-b.danger:hover{background:#991b1b}
.pe-b.add{color:#0b2c66;border-style:dashed;border-color:#9cb6e0;background:#f8fbff}
.pe-tag{display:inline-block;padding:1px 8px;font-size:11.5px;font-weight:600;border:1px solid;border-radius:3px}
.pe-in{color:#166534;border-color:#bbf7d0;background:#f0fdf4}.pe-out{color:#0b2c66;border-color:#c7d7f0;background:#eef4ff}.pe-off{color:#94a3b8;border-color:#e2e8f0;background:#fff}
.pe-void{display:inline-block;margin-right:6px;padding:0 6px;font-size:11px;font-weight:600;color:#b91c1c;border:1px solid #f1c4c4;background:#fef2f2;border-radius:3px}
.pe-hist{font-size:12.5px;line-height:1.7}.pe-hist div{padding:6px 2px;border-bottom:1px solid #f1f5f9}
.pe-hist .who{color:#0b2c66;font-weight:600}.pe-hist .why{color:#64748b;font-size:12px}
.pe-foot{padding:9px 18px;border-top:1px solid #e2e8f0;background:#f8fafc;font-size:11.5px;color:#64748b}
.pe-msg{margin:10px 18px 0;padding:8px 12px;font-size:12.5px;border-radius:4px}.pe-msg.ok{background:#f0fdf4;color:#166534;border:1px solid #bbf7d0}.pe-msg.err{background:#fef2f2;color:#991b1b;border:1px solid #fecaca}
.pe-mbg{position:fixed;inset:0;background:rgba(15,23,42,.25);z-index:10000}
.pe-modal{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(420px,calc(100vw - 32px));background:#fff;border:1px solid #d5dde8;border-radius:6px;z-index:10001;font-family:'Meiryo UI','Yu Gothic UI',sans-serif;box-shadow:0 18px 48px rgba(15,23,42,.28);overflow:hidden}
.pe-modal .pe-hd{padding:12px 16px 8px}.pe-modal .pe-hd b{font-size:15px}
.pe-modal .pe-hd.red{color:#b91c1c;border-bottom-color:#b91c1c}
.pe-row{padding:10px 16px;font-size:13px;line-height:1.6;color:#1f2937}
.pe-sel,.pe-inp{height:34px !important;min-height:34px !important;line-height:normal !important;box-sizing:border-box !important;border:1px solid #cbd5e1 !important;border-radius:3px;font-size:13px !important;padding:0 8px !important;font-family:inherit;color:#1f2937 !important;background:#fff}
.pe-sel:focus,.pe-inp:focus,.pe-ta:focus{outline:none;border-color:#0b2c66 !important;box-shadow:0 0 0 2px rgba(11,44,102,.12)}
.pe-sel{width:100%;margin-top:4px}
.pe-ta{width:100%;height:52px;border:1px solid #cbd5e1;border-radius:3px;font-size:13px;padding:6px 8px;margin-top:8px;box-sizing:border-box;font-family:inherit;resize:vertical}
.pe-note{font-size:11.5px;color:#64748b;margin-top:6px}
.pe-err{color:#b91c1c;font-size:12px;margin-top:6px;min-height:0}
.pe-mfoot{text-align:right;border-top:1px solid #e2e8f0;background:#f8fafc;padding:10px 16px}
`;

const hm = (v) => (v ? String(v).slice(11, 16) : '');
const nextDayOf = (v, date) => !!v && String(v).slice(0, 10) > date;
const SOURCE = { simple: '簡易登録', gps: '打刻（位置情報）', ip: '打刻', manual: '手入力', kiosk: '打刻機' };
const srcLabel = (s) => (s ? (SOURCE[s] || '打刻') : '打刻');
const md = (d) => { const [, m, dd] = String(d).split('-'); const w = '日月火水木金土'[new Date(`${d}T00:00:00Z`).getUTCDay()]; return `${Number(m)}/${Number(dd)}（${w}）`; };
const when = (v) => { const s = String(v || '').replace('T', ' '); return s ? `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))} ${s.slice(11, 16)}` : ''; };
const roleJa = (r) => ({ admin: '管理者', manager: 'マネージャー' }[String(r || '').toLowerCase()] || '');

function ensureCss() {
  if (document.getElementById('pe-css')) return;
  const st = document.createElement('style');
  st.id = 'pe-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}

/** 理由つきの確認ダイアログ。OK で { reason, note, ...extra } を返す（キャンセルは null） */
function askReason({ title, danger, html, okLabel, reasons, extraHtml, readExtra }) {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'pe-mbg';
    const m = document.createElement('div');
    m.className = 'pe-modal';
    m.setAttribute('role', 'dialog');
    m.innerHTML = `
      <div class="pe-hd${danger ? ' red' : ''}"><b>${esc(title)}</b><button type="button" class="pe-x" aria-label="閉じる">×</button></div>
      <div class="pe-row">${html}</div>
      ${extraHtml ? `<div class="pe-row">${extraHtml}</div>` : ''}
      <div class="pe-row"><b>理由（必須）</b>
        <select class="pe-sel" data-k="reason"><option value="">選んでください</option>${reasons.map(r => `<option>${esc(r)}</option>`).join('')}</select>
        <textarea class="pe-ta" data-k="note" placeholder="補足（「その他」のときは必須）" maxlength="255"></textarea>
        <div class="pe-note">内容は 編集履歴 と 監査ログ に残り、本人に通知されます。</div>
        <div class="pe-err"></div>
      </div>
      <div class="pe-mfoot">
        <button type="button" class="pe-b" data-k="cancel">キャンセル</button>
        <button type="button" class="pe-b ${danger ? 'danger' : 'pri'}" data-k="ok">${esc(okLabel)}</button>
      </div>`;
    document.body.append(bg, m);
    const close = (v) => { bg.remove(); m.remove(); resolve(v); };
    const err = m.querySelector('.pe-err');
    m.querySelector('.pe-x').onclick = () => close(null);
    m.querySelector('[data-k=cancel]').onclick = () => close(null);
    bg.onclick = () => close(null);
    m.querySelector('[data-k=ok]').onclick = () => {
      const reason = m.querySelector('[data-k=reason]').value;
      const note = m.querySelector('[data-k=note]').value.trim();
      if (!reason) { err.textContent = '理由を選んでください'; return; }
      if (reason === 'その他' && !note) { err.textContent = '「その他」のときは内容を入力してください'; return; }
      let extra = {};
      if (readExtra) { const r = readExtra(m); if (typeof r === 'string') { err.textContent = r; return; } extra = r || {}; }
      close({ reason, note, ...extra });
    };
    (m.querySelector('input') || m.querySelector('select')).focus();
  });
}

const timeField = (label, value, withNext, nextChecked) => `
  <label style="display:inline-flex;align-items:center;gap:6px;margin-right:12px;"><b>${label}</b>
    <input type="time" class="pe-inp" data-k="${label === '出勤' ? 'in' : 'out'}" value="${esc(value || '')}"></label>
  ${withNext ? `<label style="font-size:12px;"><input type="checkbox" data-k="next"${nextChecked ? ' checked' : ''}> 翌日</label>` : ''}`;

export async function openPunchEdit({ userId, date, name = '', code = '', onChanged } = {}) {
  ensureCss();
  document.querySelectorAll('.pe-panel,.pe-bg').forEach(e => e.remove());
  const bg = document.createElement('div');
  bg.className = 'pe-bg';
  const panel = document.createElement('aside');
  panel.className = 'pe-panel';
  panel.setAttribute('role', 'dialog');
  panel.innerHTML = `
    <div class="pe-hd"><b>打刻編集</b><span>${esc(md(date))}　${esc(name)}${code ? `（${esc(code)}）` : ''}</span><button type="button" class="pe-x" aria-label="閉じる">×</button></div>
    <div class="pe-msgs"></div>
    <div class="pe-body"><div class="pe-sec" style="color:#64748b;font-size:12px;">読み込み中…</div></div>
    <div class="pe-foot">「取消」は削除しません。原本は灰色の取り消し線で残り、「元に戻す」で復元できます。修正・取消・追加は理由が必要です。</div>`;
  document.body.append(bg, panel);
  let changed = false;
  const close = () => { bg.remove(); panel.remove(); document.removeEventListener('keydown', onKey); if (changed && typeof onChanged === 'function') onChanged(); };
  const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.pe-modal')) close(); };
  document.addEventListener('keydown', onKey);
  panel.querySelector('.pe-x').onclick = close;
  bg.onclick = close;
  const body = panel.querySelector('.pe-body');
  const msgs = panel.querySelector('.pe-msgs');
  const say = (text, ok) => { msgs.innerHTML = `<div class="pe-msg ${ok ? 'ok' : 'err'}">${esc(text)}</div>`; };

  let data = null;
  const load = async () => {
    data = await api.get(`/api/attendance/admin/punches?userId=${encodeURIComponent(userId)}&date=${encodeURIComponent(date)}`);
    render();
  };

  const render = () => {
    const voids = (data.edits || []).filter(e => (e.action === 'void_out' || e.action === 'void_row') && !e.restoredAt);
    const lines = [];
    for (const p of data.punches || []) {
      if (p.checkIn) lines.push({ kind: 'in', at: p.checkIn, p });
      if (p.checkOut) lines.push({ kind: 'out', at: p.checkOut, p });
      else if (p.checkIn) lines.push({ kind: 'open', at: '9999', p });
    }
    for (const v of voids) {
      const b = v.before || {};
      if (v.action === 'void_out') lines.push({ kind: 'void', part: 'out', at: b.checkOut, v });
      else {
        if (b.row?.checkIn) lines.push({ kind: 'void', part: 'in', at: b.row.checkIn, v });
        if (b.row?.checkOut) lines.push({ kind: 'void', part: 'out', at: b.row.checkOut, v });
      }
    }
    lines.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const multi = (data.punches || []).length > 1;
    const rowHtml = (l) => {
      if (l.kind === 'void') {
        const t = l.part === 'in' ? '出勤' : '退勤';
        const restorable = l.v.action === 'void_row' ? l.part === 'in' || !l.v.before?.row?.checkIn : true;
        return `<tr class="void"><td><span class="pe-tag pe-off">${t}</span></td><td><s>${esc(hm(l.at))}</s></td>
          <td><s>${esc(srcLabel(l.part === 'in' ? l.v.before?.row?.in_locationSource : (l.v.before?.outSource || l.v.before?.row?.out_locationSource)))}</s><div style="margin-top:3px;"><span class="pe-void">取消済み</span><span style="font-size:11.5px;">${esc(l.v.createdByName)} ${esc(when(l.v.createdAt))}</span></div></td>
          <td>${restorable ? `<button type="button" class="pe-b" data-act="restore" data-edit="${l.v.id}">元に戻す</button>` : ''}</td></tr>`;
      }
      const p = l.p;
      if (l.kind === 'open') {
        return `<tr><td><span class="pe-tag pe-out">退勤</span></td><td style="color:#94a3b8;">—</td><td style="color:#94a3b8;">まだ打刻されていません</td><td></td></tr>`;
      }
      const t = l.kind === 'in' ? '出勤' : '退勤';
      const src = l.kind === 'in' ? p.inSource : p.outSource;
      const nd = l.kind === 'out' && nextDayOf(p.checkOut, date) ? '<span style="font-size:11px;color:#64748b;">（翌日）</span>' : '';
      const extra = multi && p.extraReason ? `<br><span style="font-size:11px;color:#64748b;">追加勤務：${esc(p.extraReason)}</span>` : '';
      return `<tr><td><span class="pe-tag ${l.kind === 'in' ? 'pe-in' : 'pe-out'}">${t}</span></td><td><b>${esc(hm(l.at))}</b>${nd}</td>
        <td>${esc(srcLabel(src))}${extra}</td>
        <td><button type="button" class="pe-b" data-act="edit" data-part="${l.kind}" data-id="${p.id}">修正</button><button type="button" class="pe-b del" data-act="void" data-part="${l.kind}" data-id="${p.id}">取消</button></td></tr>`;
    };
    const hist = (data.edits || []).map(e => {
      const b = e.before || {}; const a = e.after || {};
      let what = esc(e.label);
      if (e.action === 'void_out') what = `退勤 <b>${esc(hm(b.checkOut))}</b> を<b style="color:#b91c1c;">取消</b>（原本は保存）`;
      else if (e.action === 'void_row') what = `打刻 <b>${esc(hm(b.row?.checkIn) || '—')}〜${esc(hm(b.row?.checkOut) || '—')}</b> を<b style="color:#b91c1c;">取消</b>（原本は保存）`;
      else if (e.action === 'edit_in') what = `出勤 <b>${esc(hm(b.checkIn) || 'なし')}</b> → <b>${esc(hm(a.checkIn))}</b> に修正`;
      else if (e.action === 'edit_out') what = `退勤 <b>${esc(hm(b.checkOut) || 'なし')}</b> → <b>${esc(hm(a.checkOut))}</b> に修正`;
      else if (e.action === 'add') what = `打刻を追加 <b>${esc(hm(a.checkIn) || '—')}〜${esc(hm(a.checkOut) || '—')}</b>`;
      else if (e.action === 'restore') what = '取消を<b>元に戻す</b>';
      const role = roleJa(e.createdByRole);
      return `<div><span class="who">${esc(when(e.createdAt))}　${esc(e.createdByName)}${role ? `（${role}）` : ''}</span>　${what}${e.restoredAt ? ' <span style="font-size:11px;color:#64748b;">（元に戻し済み）</span>' : ''}<br>
        <span class="why">理由：${esc(e.reason)}${e.note ? `（${esc(e.note)}）` : ''}</span></div>`;
    }).join('');
    body.innerHTML = `
      <div class="pe-sec"><h4>打刻データ（原本は消さずに残します）</h4>
        ${lines.length ? `<table class="pe-t"><thead><tr><th style="width:52px;">種類</th><th style="width:70px;">時刻</th><th>打刻元</th><th style="width:112px;">操作</th></tr></thead><tbody>${lines.map(rowHtml).join('')}</tbody></table>`
        : '<div style="font-size:12px;color:#94a3b8;">この日の打刻はありません</div>'}
        <div style="margin-top:8px;"><button type="button" class="pe-b add" data-act="add">＋ 打刻を追加</button></div>
      </div>
      <div class="pe-sec"><h4>編集履歴</h4>
        <div class="pe-hist">${hist || '<div style="color:#94a3b8;">この日の管理者による編集はまだありません</div>'}</div>
      </div>`;
  };

  const run = async (url, payload, okText) => {
    try {
      await api.post(url, payload);
      changed = true;
      say(okText, true);
      await load();
    } catch (e) {
      say(String(e?.message || e || '保存できませんでした'), false);
    }
  };

  body.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-act]');
    if (!btn || !data) return;
    const act = btn.dataset.act;
    const reasons = data.reasons || [];
    const who = `${md(date)} ${esc(name)}`;
    if (act === 'void') {
      const p = data.punches.find(x => String(x.id) === btn.dataset.id);
      const part = btn.dataset.part === 'in' ? 'row' : 'out';
      const what = part === 'out' ? `<b>退勤 ${esc(hm(p.checkOut))}</b>` : `<b>打刻 ${esc(hm(p.checkIn))}〜${esc(hm(p.checkOut) || '')}</b>（出勤ごと）`;
      const r = await askReason({
        title: '打刻の取消', danger: true, okLabel: '取消する', reasons,
        html: `${who}　${what} を取り消します。<br>${part === 'out' ? '本人はもう一度 退勤 を打刻できます。' : 'この日の勤務から外れます。'}原本は残り、「元に戻す」で復元できます。`
      });
      if (r) await run('/api/attendance/admin/punches/void', { attendanceId: p.id, part, ...r }, part === 'out' ? `退勤を取り消しました。本人に「もう一度 退勤 を打刻してください」と通知しました。` : '打刻を取り消しました。本人に通知しました。');
    } else if (act === 'restore') {
      const r = await askReason({ title: '取消を元に戻す', okLabel: '元に戻す', reasons, html: `${who}　取り消した打刻を元に戻します。` });
      if (r) await run('/api/attendance/admin/punches/restore', { editId: Number(btn.dataset.edit), ...r }, '元に戻しました。本人に通知しました。');
    } else if (act === 'edit') {
      const p = data.punches.find(x => String(x.id) === btn.dataset.id);
      const part = btn.dataset.part;
      const cur = part === 'in' ? p.checkIn : p.checkOut;
      const r = await askReason({
        title: part === 'in' ? '出勤の修正' : '退勤の修正', okLabel: '修正する', reasons,
        html: `${who}　${part === 'in' ? '出勤' : '退勤'} <b>${esc(hm(cur))}</b> を修正します。`,
        extraHtml: timeField(part === 'in' ? '出勤' : '退勤', hm(cur), part === 'out', part === 'out' && nextDayOf(cur, date)),
        readExtra: (m) => {
          const v = m.querySelector(`[data-k=${part}]`).value;
          if (!/^\d{2}:\d{2}$/.test(v)) return '時刻を入力してください';
          if (v === hm(cur) && !(part === 'out' && m.querySelector('[data-k=next]').checked !== nextDayOf(cur, date))) return '時刻が変わっていません';
          return { time: v, nextDay: part === 'out' ? m.querySelector('[data-k=next]').checked : false };
        }
      });
      if (r) await run('/api/attendance/admin/punches/edit', { attendanceId: p.id, part, ...r }, `${part === 'in' ? '出勤' : '退勤'}を ${r.time} に修正しました。本人に通知しました。`);
    } else if (act === 'add') {
      const open = (data.punches || []).some(p => p.checkIn && !p.checkOut);
      const r = await askReason({
        title: '打刻の追加', okLabel: '追加する', reasons,
        html: `${who}　打刻忘れなどの打刻を追加します。${open ? '<br>退勤だけ入れると、退勤前の出勤に入ります。' : ''}`,
        extraHtml: timeField('出勤', '', false) + '<div style="height:6px"></div>' + timeField('退勤', '', true, false),
        readExtra: (m) => {
          const cin = m.querySelector('[data-k=in]').value; const cout = m.querySelector('[data-k=out]').value;
          if (!cin && !cout) return '出勤か退勤の時刻を入力してください';
          if (!cin && !open) return 'この日に退勤前の出勤がありません。出勤も入力してください';
          return { checkIn: cin, checkOut: cout, nextDay: m.querySelector('[data-k=next]').checked };
        }
      });
      if (r) await run('/api/attendance/admin/punches/add', { userId, date, ...r }, '打刻を追加しました。本人に通知しました。');
    }
  });

  try { await load(); } catch (e) {
    body.innerHTML = `<div class="pe-sec" style="color:#991b1b;font-size:12.5px;">${esc(String(e?.message || '読み込めませんでした'))}</div>`;
  }
}
