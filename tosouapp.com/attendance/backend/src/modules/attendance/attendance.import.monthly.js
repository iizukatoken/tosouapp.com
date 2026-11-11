'use strict';
/**
 * 入力用Excel取込（月次勤怠）
 *
 * やり方: 今のデータから「入力用Excel出力」と同じファイルをサーバー内で作り直し、
 * アップロードされたファイルとセル単位で比べる。違うセルだけが変更。
 * （出力と取込で値の作り方がずれないように、比較の元は出力処理そのものを使う）
 *
 * 取り込む項目: 勤務区分 / 出社・在宅・現場 / 現場（任意）/ 作業内容 / 備考 /
 *               開始・終了時刻（打刻がまだ無い日だけ。打刻済みの時刻は誰も上書きできない）
 * 保存: 勤務区分・時刻は月次保存（PUT /month/bulk と同じ処理）を通す。
 *       打刻のある日の 現場・作業内容・備考・勤務形態 は、その打刻行の文字の列だけ更新する
 *       （月次保存の行更新は時刻も書き換えるため使わない）。
 */
const ExcelJS = require('exceljs');
const db = require('../../core/database/mysql');
const repo = require('./attendance.repository');
const leaveRepo = require('../leave/leave.repository');
const auditRepo = require('../audit/audit.repository');
const { resolveTargetUserId, assertMonthWritable } = require('./attendance.utils');
const { exportMonthXlsx } = require('./attendance.export.monthly');
const { putMonthBulk } = require('./attendance.bulk.controller');

// 入力用Excel の列（A=1 … R=18）。出力側 attendance.export.monthly.js の sheet1Headers と同じ並び。
const COL = { date: 1, kubun: 2, onsite: 3, remote: 4, satellite: 5, location: 6, memo: 7, start: 8, end: 9, notes: 16 };
const HEADER_ROW = 6;
const FIRST_ROW = 7;
const KUBUN_ALLOWED = new Set(['出勤', '半休', '半休(有給)', '欠勤', '有給休暇', '無給休暇', '代替休日', '振替出勤', '休日', '休日出勤', '代替出勤']);
const LEAVE_KUBUN = new Set(['有給休暇', '無給休暇', '欠勤', '代替休日', '休日']);
const FIELD_LABEL = { kubun: '勤務区分', workType: '出社/在宅/現場', location: '現場（任意）', memo: '作業内容', notes: '備考', time: '開始/終了時刻' };
const WT_LABEL = { onsite: '出社', remote: '在宅', satellite: '現場', '': '—' };

const pad = (n) => String(n).padStart(2, '0');
const todayJST = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

// セルの値を文字列に（リッチテキスト・数値・日付も）
function cellText(cell) {
  const v = cell ? cell.value : null;
  if (v == null) return '';
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text || '').join('').trim();
    if (v.text != null) return String(v.text).trim();
    if (v.result != null) return String(v.result).trim();
    if (v instanceof Date) return v.toISOString();
  }
  return String(v).trim();
}

// 時刻セル → 'HH:MM'（"8:52" / "08:52" / Excel の時刻数値 / Date）。読めなければ null、空なら ''
function cellTime(cell) {
  const v = cell ? cell.value : null;
  if (v == null || v === '') return '';
  if (v instanceof Date) return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`;
  if (typeof v === 'number' && v >= 0 && v < 2) {
    const mins = Math.round((v % 1) * 24 * 60);
    return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;
  }
  const s = cellText(cell);
  if (!s) return '';
  const m = /^(\d{1,2})[:：](\d{2})(?::\d{2})?$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return `${pad(h)}:${pad(mi)}`;
}

const normText = (s) => String(s || '').replace(/\r\n?/g, '\n').trim();
const isPlannedKubun = (k) => !k || k.includes('予定');
const ticked = (s) => !!String(s || '').trim();

/** 入力用Excel を読む → { info, rows: Map(date → row), extraRows, badRows } */
async function readSheet(buffer, y, m) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw Object.assign(new Error('シートが見つかりません。'), { status: 400 });
  const h1 = cellText(ws.getRow(HEADER_ROW).getCell(COL.date));
  const h2 = cellText(ws.getRow(HEADER_ROW).getCell(COL.kubun));
  if (h1 !== '日付' || h2 !== '勤務区分') {
    throw Object.assign(new Error('入力用Excelの形式ではありません（「入力用Excel出力」で作ったファイルを使ってください）。'), { status: 400 });
  }
  const info = cellText(ws.getRow(4).getCell(1));
  const rows = new Map();
  let extraRows = 0;
  for (let r = FIRST_ROW; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const dateText = cellText(row.getCell(COL.date));
    const dm = /^(\d{1,2})月(\d{1,2})日/.exec(dateText);
    if (!dm) {
      if (!dateText) break; // 日次実績の表の終わり（下は 当月サマリ）
      continue;
    }
    if (Number(dm[1]) !== m) continue;
    const date = `${y}-${pad(m)}-${pad(Number(dm[2]))}`;
    if (rows.has(date)) { extraRows++; continue; } // 同じ日の2行目以降（2つ目の勤務）は取り込まない
    rows.set(date, {
      kubun: cellText(row.getCell(COL.kubun)),
      onsite: ticked(cellText(row.getCell(COL.onsite))),
      remote: ticked(cellText(row.getCell(COL.remote))),
      satellite: ticked(cellText(row.getCell(COL.satellite))),
      location: normText(cellText(row.getCell(COL.location))),
      memo: normText(cellText(row.getCell(COL.memo))),
      notes: normText(cellText(row.getCell(COL.notes))),
      start: cellTime(row.getCell(COL.start)),
      end: cellTime(row.getCell(COL.end)),
      startRaw: cellText(row.getCell(COL.start)),
      endRaw: cellText(row.getCell(COL.end))
    });
  }
  return { info, rows, extraRows };
}

const wtOf = (r) => {
  const list = [r.onsite && 'onsite', r.remote && 'remote', r.satellite && 'satellite'].filter(Boolean);
  return list.length > 1 ? null : (list[0] || '');
};

/**
 * 今のデータ（cur）と取込ファイル（up）を比べる。
 * @returns {{ changes: Array, skipped: Array, perDate: Map }}
 */
function diffRows(cur, up, { today = todayJST() } = {}) {
  const changes = [];
  const skipped = [];
  const perDate = new Map(); // date → { kubun?, workType?, location?, memo?, notes?, time? }
  const put = (date, field, value) => {
    if (!perDate.has(date)) perDate.set(date, {});
    perDate.get(date)[field] = value;
  };
  for (const [date, u] of up.rows) {
    const c = cur.rows.get(date);
    if (!c) continue;
    const curHasTime = !!(c.start || c.end);

    // 勤務区分
    let finalKubun = isPlannedKubun(c.kubun) ? '' : c.kubun;
    if (u.kubun !== c.kubun) {
      if (isPlannedKubun(u.kubun)) {
        if (!isPlannedKubun(c.kubun)) skipped.push({ date, field: 'kubun', reason: '勤務区分を空欄（予定）には戻せません' });
      } else if (!KUBUN_ALLOWED.has(u.kubun)) {
        skipped.push({ date, field: 'kubun', reason: `勤務区分「${u.kubun}」は使えません` });
      } else {
        changes.push({ date, field: 'kubun', from: c.kubun, to: u.kubun });
        put(date, 'kubun', u.kubun);
        finalKubun = u.kubun;
      }
    }

    // 出社/在宅/現場
    const uWt = wtOf(u);
    const cWt = wtOf(c) || '';
    if (uWt === null) {
      skipped.push({ date, field: 'workType', reason: '出社・在宅・現場は1つだけ選んでください' });
    } else if (uWt !== cWt) {
      changes.push({ date, field: 'workType', from: WT_LABEL[cWt], to: WT_LABEL[uWt] });
      put(date, 'workType', uWt);
    }

    // 文字の項目
    for (const f of ['location', 'memo', 'notes']) {
      if (u[f] !== c[f]) {
        changes.push({ date, field: f, from: c[f], to: u[f] });
        put(date, f, u[f]);
      }
    }

    // 開始/終了時刻
    const timeChanged = (u.start !== c.start) || (u.end !== c.end);
    if (timeChanged) {
      if (u.start === null || u.end === null) {
        skipped.push({ date, field: 'time', reason: `時刻の形式が正しくありません（${u.start === null ? u.startRaw : u.endRaw}）` });
      } else if (curHasTime) {
        skipped.push({ date, field: 'time', reason: `打刻済みのため取り込みません（${c.start || '--:--'}〜${c.end || '--:--'} のまま）。変更は調整申請で` });
      } else if (date > today) {
        skipped.push({ date, field: 'time', reason: '未来の日付の時刻は取り込みません' });
      } else if (!u.start) {
        skipped.push({ date, field: 'time', reason: '開始時刻がありません' });
      } else if (LEAVE_KUBUN.has(finalKubun)) {
        skipped.push({ date, field: 'time', reason: `${finalKubun}の日には時刻を取り込みません` });
      } else {
        changes.push({ date, field: 'time', from: '', to: `${u.start}〜${u.end || ''}` });
        put(date, 'time', { start: u.start, end: u.end || '' });
      }
    }
  }
  changes.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  skipped.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { changes, skipped, perDate };
}

// Express の (req, res) ハンドラーをサーバー内で呼び、結果を受け取る
function callHandler(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      setHeader() {},
      status(code) { this.statusCode = code; return this; },
      send(body) { resolve({ status: this.statusCode, body }); return this; },
      json(body) { resolve({ status: this.statusCode, json: body }); return this; }
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

const nextDay = (ds) => {
  const t = new Date(`${ds}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};

/** 取込を保存する（勤務区分・時刻は月次保存、打刻行の文字の列は直接） */
async function applyChanges({ req, userId, y, m, perDate }) {
  const tid = req.tenantId || null;
  const from = `${y}-${pad(m)}-01`;
  const to = `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
  const segs = await repo.listByUserBetween(userId, from, to).catch(() => []);
  const firstSegByDate = new Map();
  for (const s of (segs || []).slice().sort((a, b) => String(a.checkIn || '').localeCompare(String(b.checkIn || '')))) {
    const d = String(s.checkIn || s.checkOut || '').slice(0, 10);
    if (d && !firstSegByDate.has(d)) firstSegByDate.set(d, s);
  }

  const updates = [];
  const dailyUpdates = [];
  const segTextUpdates = [];
  for (const [date, ch] of perDate) {
    const daily = { date };
    if (ch.kubun !== undefined) { daily.kubun = ch.kubun; daily.kubunConfirmed = 1; }
    if (ch.workType !== undefined) daily.workType = ch.workType || null;
    for (const f of ['location', 'memo', 'notes']) if (ch[f] !== undefined) daily[f] = ch[f];
    if (Object.keys(daily).length > 1) dailyUpdates.push(daily);

    const seg = firstSegByDate.get(date);
    if (seg && (ch.workType !== undefined || ch.location !== undefined || ch.memo !== undefined || ch.notes !== undefined)) {
      segTextUpdates.push({ id: seg.id, ...['workType', 'location', 'memo', 'notes'].reduce((o, f) => (ch[f] !== undefined ? { ...o, [f]: ch[f] } : o), {}) });
    }
    if (ch.time && !seg) {
      const { start, end } = ch.time;
      const outDate = end && end <= start ? nextDay(date) : date;
      updates.push({
        clientId: `import-${date}`,
        checkIn: `${date} ${start}:00`,
        checkOut: end ? `${outDate} ${end}:00` : null,
        workType: ch.workType || null,
        location: ch.location, memo: ch.memo, notes: ch.notes
      });
    }
  }

  // 社員が 休暇系の勤務区分 を取り込んだら、画面で選んだときと同じく承認待ちの申請を作る
  if (String(req.user?.role || '').toLowerCase() === 'employee') {
    const KUBUN_TYPE = { '半休(有給)': 'paid_half', '半休': 'half', '欠勤': 'absence', '無給休暇': 'unpaid', '代替休日': 'substitute' };
    for (const [date, ch] of perDate) {
      if (ch.kubun === undefined) continue;
      try {
        if (ch.kubun === '有給休暇') {
          await leaveRepo.cancelKubunRequestsByDate(userId, date, tid);
          const ex = await leaveRepo.findExactRequest({ userId, startDate: date, endDate: date, type: 'paid', statuses: ['pending', 'approved'], tenantId: tid });
          if (!ex) await leaveRepo.create({ userId, startDate: date, endDate: date, type: 'paid', reason: 'Excel取込', tenantId: tid });
        } else if (KUBUN_TYPE[ch.kubun]) {
          await leaveRepo.cancelOwnPaidByDate(userId, date, tid);
          await leaveRepo.cancelKubunRequestsByDate(userId, date, tid, KUBUN_TYPE[ch.kubun]);
          await leaveRepo.ensureKubunRequest({ userId, date, type: KUBUN_TYPE[ch.kubun], tenantId: tid });
        } else {
          await leaveRepo.cancelOwnPaidByDate(userId, date, tid);
          await leaveRepo.cancelKubunRequestsByDate(userId, date, tid);
        }
      } catch (e) { /* 申請の作成に失敗しても勤怠の取込は続ける（月次保存側でも有給は同期される） */ }
    }
  }

  let bulk = null;
  if (updates.length || dailyUpdates.length) {
    const bulkReq = Object.create(req);
    bulkReq.body = { year: y, month: m, userId, updates, dailyUpdates };
    bulkReq.query = { ...(req.query || {}), userId };
    bulk = await callHandler(putMonthBulk, bulkReq);
    if (bulk.status >= 400) {
      throw Object.assign(new Error(bulk.json?.message || '保存に失敗しました'), { status: bulk.status });
    }
  }

  for (const s of segTextUpdates) {
    const sets = [];
    const vals = [];
    if (s.workType !== undefined) { sets.push('work_type = ?'); vals.push(s.workType || null); }
    if (s.location !== undefined) { sets.push('location = ?'); vals.push(s.location || null); }
    if (s.memo !== undefined) { sets.push('memo = ?'); vals.push(s.memo || null); }
    if (s.notes !== undefined) { sets.push('notes = ?'); vals.push(s.notes || null); }
    if (!sets.length) continue;
    vals.push(s.id, userId);
    let sql = `UPDATE attendance SET ${sets.join(', ')} WHERE id = ? AND userId = ?`;
    if (tid != null) { sql += ' AND tenant_id = ?'; vals.push(tid); }
    await db.query(sql, vals);
  }

  return { dailySaved: dailyUpdates.length, segmentsCreated: updates.length, segmentsUpdated: segTextUpdates.length, bulk: bulk?.json || null };
}

/**
 * POST /api/attendance/month/import?year=&month=[&userId=][&apply=1]  (multipart: file)
 * apply なし: 変更内容の一覧だけ返す（保存しない）。apply=1: 保存する。
 */
async function importMonthXlsx(req, res) {
  try {
    const userId = await resolveTargetUserId(req);
    if (userId === '__forbidden__') return res.status(403).json({ message: 'Forbidden' });
    if (!userId) return res.status(404).json({ message: 'User not found' });
    const y = parseInt(String(req.query?.year || req.body?.year || ''), 10);
    const m = parseInt(String(req.query?.month || req.body?.month || ''), 10);
    if (!y || !m || m < 1 || m > 12) return res.status(400).json({ message: 'Missing year/month' });
    const file = req.file;
    if (!file || !file.buffer || !file.buffer.length) return res.status(400).json({ message: '取込対象がありません。' });
    if (!/\.xlsx$/i.test(String(file.originalname || ''))) return res.status(400).json({ message: '選択されたファイルが正しくありません（.xlsx）。' });

    await assertMonthWritable(req, userId, y, m);

    // 今のデータで「入力用Excel出力」と同じファイルを作る（比較の元）
    const exportReq = Object.create(req);
    exportReq.query = { ...(req.query || {}), year: String(y), month: String(m), userId: String(userId) };
    const exported = await callHandler(exportMonthXlsx, exportReq);
    if (exported.status >= 400 || !exported.body) {
      return res.status(exported.status >= 400 ? exported.status : 500).json({ message: exported.json?.message || '現在のデータを読み込めませんでした' });
    }
    const cur = await readSheet(exported.body, y, m);
    let up;
    try { up = await readSheet(file.buffer, y, m); } catch (e) {
      return res.status(e.status || 400).json({ message: e.status ? e.message : 'Excelファイルを読み込めませんでした。' });
    }
    // 別の社員・別の月のファイルは取り込まない（4行目: 社員番号・対象月）
    const pick = (info, re) => (re.exec(String(info || '')) || [])[1] || '';
    const curCode = pick(cur.info, /社員番号：(\S+)/), upCode = pick(up.info, /社員番号：(\S+)/);
    const curMonth = pick(cur.info, /対象月：(\S+?年\S+?月)/), upMonth = pick(up.info, /対象月：(\S+?年\S+?月)/);
    if (upMonth && curMonth && upMonth !== curMonth) return res.status(400).json({ message: `対象月が違います（ファイル: ${upMonth} / 画面: ${curMonth}）。` });
    if (upCode && curCode && upCode !== curCode) return res.status(400).json({ message: `別の社員のファイルです（ファイル: ${upCode} / 画面: ${curCode}）。` });

    const { changes, skipped, perDate } = diffRows(cur, up);
    if (up.extraRows) skipped.push({ date: '', field: 'time', reason: `同じ日の2行目以降（${up.extraRows}行・2つ目の勤務）は取り込みません` });
    const labelled = (list) => list.map((c) => ({ ...c, fieldLabel: FIELD_LABEL[c.field] || c.field }));

    if (String(req.query?.apply || req.body?.apply || '') !== '1') {
      return res.status(200).json({ applied: false, fileName: file.originalname, changes: labelled(changes), skipped: labelled(skipped) });
    }
    if (!changes.length) return res.status(200).json({ applied: true, saved: 0, changes: [], skipped: labelled(skipped) });

    const result = await applyChanges({ req, userId, y, m, perDate });
    try {
      await auditRepo.writeLog({
        userId: req.user?.id, action: 'attendance_month_import', path: req.path, method: req.method, ip: req.ip,
        userAgent: req.headers['user-agent'], beforeData: null,
        afterData: JSON.stringify({ targetUserId: userId, year: y, month: m, file: file.originalname, changes })
      });
    } catch (e) { /* audit は best-effort */ }
    return res.status(200).json({ applied: true, saved: changes.length, result, changes: labelled(changes), skipped: labelled(skipped) });
  } catch (err) {
    return res.status(Number(err?.status || 500)).json({ message: err.message });
  }
}

module.exports = { importMonthXlsx, readSheet, diffRows, cellTime };
