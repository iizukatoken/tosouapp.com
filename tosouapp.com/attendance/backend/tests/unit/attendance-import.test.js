/**
 * 入力用Excel取込: ファイルの読み取りと、今のデータとの比較（変更・取り込まない理由）。
 * DB は使わない。出力と同じ形式（inlineStr・自前の zip）と、Excel で保存し直した形式の両方を読む。
 */
'use strict';

jest.mock('../../src/core/database/mysql', () => ({ query: jest.fn() }));

const ExcelJS = require('exceljs');
const { buildXlsxArchive } = require('../../src/utils/xlsx');
const { readSheet, diffRows, cellTime } = require('../../src/modules/attendance/attendance.import.monthly');

const HEAD = ['日付', '勤務区分', '出社', '在宅', '現場', '現場（任意）', '作業内容', '開始時刻', '終了時刻',
  '休憩時間', '深夜休憩', '勤務時間', '超過時間', '遅刻/早退', '理由', '備考', '承認ステータス', '承認者'];
const colRef = (n) => String.fromCharCode(64 + n);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

// 出力（attendance.export.monthly.js）と同じ作り: inlineStr のセル + buildXlsxArchive
function exportLikeXlsx(rows, info = '社員番号：EMP023　　氏名：employee　　対象月：2026年11月') {
  const c = (ref, v) => `<c r="${ref}" t="inlineStr" s="0"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  const rowXml = (r, cells) => `<row r="${r}">${cells.join('')}</row>`;
  const xmlRows = [
    rowXml(1, [c('A1', '月次勤怠表（入力用）')]),
    rowXml(4, [c('A4', info)]),
    rowXml(6, HEAD.map((h, i) => c(`${colRef(i + 1)}6`, h))),
    ...rows.map((vals, i) => rowXml(7 + i, vals.map((v, ci) => c(`${colRef(ci + 1)}${7 + i}`, v || ''))))
  ];
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${xmlRows.join('')}</sheetData></worksheet>`;
  const ns = 'http://schemas.openxmlformats.org';
  return buildXlsxArchive([
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships"><sheets><sheet name="入力用勤怠表" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId3" Type="${ns}/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="${ns}/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf/></cellXfs></styleSheet>` },
    { name: 'xl/worksheets/sheet1.xml', data: sheet }
  ]);
}

// 1行 = 18列（A〜R）。必要な列だけ指定
function row(day, o = {}) {
  const r = new Array(18).fill('');
  r[0] = `11月${day}日(水)`;
  r[1] = o.kubun ?? '【予定出勤】';
  r[2] = o.on ? '✓' : ''; r[3] = o.re ? '✓' : ''; r[4] = o.sa ? '✓' : '';
  r[5] = o.loc || ''; r[6] = o.memo || ''; r[7] = o.start || ''; r[8] = o.end || ''; r[15] = o.notes || '';
  return r;
}

describe('readSheet', () => {
  it('出力と同じ形式（inlineStr）を読める', async () => {
    const buf = exportLikeXlsx([row(4, { kubun: '出勤', on: true, start: '08:52', end: '17:00', memo: '外壁塗装' })]);
    const s = await readSheet(buf, 2026, 11);
    expect(s.info).toContain('社員番号：EMP023');
    expect(s.rows.get('2026-11-04')).toMatchObject({ kubun: '出勤', onsite: true, start: '08:52', end: '17:00', memo: '外壁塗装' });
  });

  it('Excel で保存し直したファイル（共有文字列・時刻が数値）も読める', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('入力用勤怠表');
    ws.getCell('A4').value = '社員番号：EMP023　　対象月：2026年11月';
    HEAD.forEach((h, i) => { ws.getRow(6).getCell(i + 1).value = h; });
    ws.getCell('A7').value = '11月5日(木)';
    ws.getCell('B7').value = '出勤';
    ws.getCell('H7').value = 8 / 24 + 30 / 1440; // 08:30
    ws.getCell('I7').value = new Date(Date.UTC(1899, 11, 30, 17, 15)); // 17:15
    const buf = await wb.xlsx.writeBuffer();
    const s = await readSheet(Buffer.from(buf), 2026, 11);
    expect(s.rows.get('2026-11-05')).toMatchObject({ kubun: '出勤', start: '08:30', end: '17:15' });
  });

  it('入力用Excel ではないファイルは断る', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('x').getCell('A1').value = 'hello';
    await expect(readSheet(Buffer.from(await wb.xlsx.writeBuffer()), 2026, 11)).rejects.toThrow(/入力用Excelの形式ではありません/);
  });

  it('同じ日の2行目（2つ目の勤務）は数えるだけで取り込まない', async () => {
    const s = await readSheet(exportLikeXlsx([row(4, { kubun: '出勤' }), row(4, { start: '18:00' }), row(5)]), 2026, 11);
    expect(s.rows.size).toBe(2);
    expect(s.extraRows).toBe(1);
  });
});

describe('cellTime', () => {
  it.each([['8:52', '08:52'], ['08:52', '08:52'], ['17:00:00', '17:00'], ['', ''], ['あいう', null], ['25:00', null]])('%s → %s', (v, want) => {
    expect(cellTime({ value: v })).toBe(want);
  });
});

describe('diffRows', () => {
  const make = async (rows) => readSheet(exportLikeXlsx(rows), 2026, 11);
  const TODAY = '2026-11-11';

  it('変わったセルだけを変更にする', async () => {
    const cur = await make([row(4), row(5, { kubun: '出勤', on: true, start: '08:52', end: '17:00' })]);
    const up = await make([
      row(4, { kubun: '出勤', sa: true, loc: '○○邸', memo: '外壁塗装', notes: '雨天' }),
      row(5, { kubun: '出勤', on: true, start: '08:52', end: '17:00' })
    ]);
    const { changes, skipped } = diffRows(cur, up, { today: TODAY });
    expect(skipped).toEqual([]);
    expect(changes.map((c) => `${c.date} ${c.field}`)).toEqual([
      '2026-11-04 kubun', '2026-11-04 workType', '2026-11-04 location', '2026-11-04 memo', '2026-11-04 notes'
    ]);
  });

  it('打刻済みの時刻は取り込まない（誰でも）', async () => {
    const cur = await make([row(5, { kubun: '出勤', start: '10:05', end: '17:00' })]);
    const up = await make([row(5, { kubun: '出勤', start: '08:55', end: '17:00' })]);
    const { changes, skipped } = diffRows(cur, up, { today: TODAY });
    expect(changes).toEqual([]);
    expect(skipped[0].reason).toMatch(/打刻済み.*10:05/);
  });

  it('打刻のない過去の日は時刻を取り込む / 未来の日・開始なし・休暇の日は取り込まない', async () => {
    const cur = await make([row(3, { kubun: '出勤' }), row(12), row(4), row(6, { kubun: '有給休暇' })]);
    const up = await make([
      row(3, { kubun: '出勤', start: '08:00', end: '17:00' }),
      row(12, { start: '08:00', end: '17:00' }),
      row(4, { end: '17:00' }),
      row(6, { kubun: '有給休暇', start: '08:00', end: '17:00' })
    ]);
    const { changes, skipped } = diffRows(cur, up, { today: TODAY });
    expect(changes).toEqual([expect.objectContaining({ date: '2026-11-03', field: 'time', to: '08:00〜17:00' })]);
    const reasons = skipped.map((s) => `${s.date} ${s.reason}`);
    expect(reasons).toEqual(expect.arrayContaining([
      expect.stringMatching(/2026-11-12 未来の日付/),
      expect.stringMatching(/2026-11-04 開始時刻がありません/),
      expect.stringMatching(/2026-11-06 有給休暇の日には時刻/)
    ]));
  });

  it('勤務区分: 予定に戻す・使えない値は取り込まない', async () => {
    const cur = await make([row(4, { kubun: '出勤' }), row(5)]);
    const up = await make([row(4, { kubun: '' }), row(5, { kubun: '遊び' })]);
    const { changes, skipped } = diffRows(cur, up, { today: TODAY });
    expect(changes).toEqual([]);
    expect(skipped.map((s) => s.reason)).toEqual(['勤務区分を空欄（予定）には戻せません', '勤務区分「遊び」は使えません']);
  });

  it('出社・在宅・現場を2つ選んだら取り込まない', async () => {
    const cur = await make([row(4, { kubun: '出勤' })]);
    const up = await make([row(4, { kubun: '出勤', on: true, re: true })]);
    const { changes, skipped } = diffRows(cur, up, { today: TODAY });
    expect(changes).toEqual([]);
    expect(skipped[0].reason).toMatch(/1つだけ/);
  });
});

describe('importMonthXlsx（API 全体）', () => {
  const flush = () => new Promise((r) => setImmediate(r));
  function mockRes() {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
  }
  async function load({ current, uploaded, role = 'employee' }) {
    jest.resetModules();
    const putMonthBulk = jest.fn(async (req, res) => res.status(200).json({ saved: true }));
    jest.doMock('../../src/modules/attendance/attendance.bulk.controller', () => ({ putMonthBulk }));
    jest.doMock('../../src/modules/attendance/attendance.export.monthly', () => ({
      exportMonthXlsx: jest.fn(async (req, res) => res.status(200).send(current))
    }));
    jest.doMock('../../src/modules/attendance/attendance.utils', () => ({
      resolveTargetUserId: jest.fn(async () => 23),
      assertMonthWritable: jest.fn(async () => {})
    }));
    const segs = [{ id: 501, checkIn: '2026-11-05 08:52:00', checkOut: '2026-11-05 17:00:00' }];
    jest.doMock('../../src/modules/attendance/attendance.repository', () => ({ listByUserBetween: jest.fn(async () => segs) }));
    const leave = { cancelKubunRequestsByDate: jest.fn(), findExactRequest: jest.fn(async () => null), create: jest.fn(), cancelOwnPaidByDate: jest.fn(), ensureKubunRequest: jest.fn() };
    jest.doMock('../../src/modules/leave/leave.repository', () => leave);
    jest.doMock('../../src/modules/audit/audit.repository', () => ({ writeLog: jest.fn() }));
    const dbm = require('../../src/core/database/mysql');
    dbm.query.mockReset().mockResolvedValue([{ affectedRows: 1 }]);
    const mod = require('../../src/modules/attendance/attendance.import.monthly');
    const mk = (apply) => ({
      query: { year: '2026', month: '11', ...(apply ? { apply: '1' } : {}) }, body: {}, headers: {}, tenantId: 1,
      user: { id: 23, role }, file: { originalname: 'a.xlsx', buffer: uploaded }
    });
    return { mod, mk, putMonthBulk, leave, dbm };
  }

  it('確認だけ（apply なし）は保存しない', async () => {
    const current = exportLikeXlsx([row(4)]);
    const uploaded = exportLikeXlsx([row(4, { kubun: '出勤', memo: '塗装' })]);
    const { mod, mk, putMonthBulk } = await load({ current, uploaded });
    const res = mockRes();
    await mod.importMonthXlsx(mk(false), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const out = res.json.mock.calls[0][0];
    expect(out.applied).toBe(false);
    expect(out.changes.map((c) => c.fieldLabel)).toEqual(['勤務区分', '作業内容']);
    expect(putMonthBulk).not.toHaveBeenCalled();
  });

  it('apply=1: 勤務区分・新しい時刻は月次保存へ、打刻のある日の作業内容は打刻行の文字だけ更新', async () => {
    const current = exportLikeXlsx([row(3), row(5, { kubun: '出勤', on: true, start: '08:52', end: '17:00' })]);
    const uploaded = exportLikeXlsx([
      row(3, { kubun: '出勤', start: '08:00', end: '17:00' }),
      row(5, { kubun: '出勤', on: true, start: '08:52', end: '17:00', memo: '外壁塗装' })
    ]);
    const { mod, mk, putMonthBulk, dbm } = await load({ current, uploaded });
    const res = mockRes();
    await mod.importMonthXlsx(mk(true), res);
    await flush();
    expect(res.status).toHaveBeenCalledWith(200);
    const body = putMonthBulk.mock.calls[0][0].body;
    expect(body.updates).toEqual([expect.objectContaining({ checkIn: '2026-11-03 08:00:00', checkOut: '2026-11-03 17:00:00' })]);
    expect(body.dailyUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2026-11-03', kubun: '出勤', kubunConfirmed: 1 }),
      expect.objectContaining({ date: '2026-11-05', memo: '外壁塗装' })
    ]));
    // 打刻行（id 501）は memo だけ。時刻の列には触れない
    const [sql, params] = dbm.query.mock.calls.find((c) => /UPDATE attendance SET/.test(c[0]));
    expect(sql).toMatch(/memo = \?/);
    expect(sql).not.toMatch(/checkIn|checkOut/);
    expect(params).toEqual(['外壁塗装', 501, 23, 1]);
  });

  it('別の社員・別の月のファイルは断る', async () => {
    const current = exportLikeXlsx([row(4)]);
    const uploaded = exportLikeXlsx([row(4)], '社員番号：EMP099　　氏名：x　　対象月：2026年11月');
    const { mod, mk } = await load({ current, uploaded });
    const res = mockRes();
    await mod.importMonthXlsx(mk(false), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/別の社員/);
  });

  it('社員が 有給休暇 を取り込むと、画面と同じく承認待ちの有給申請を作る', async () => {
    const current = exportLikeXlsx([row(9)]);
    const uploaded = exportLikeXlsx([row(9, { kubun: '有給休暇' })]);
    const { mod, mk, leave } = await load({ current, uploaded });
    const res = mockRes();
    await mod.importMonthXlsx(mk(true), res);
    expect(leave.create).toHaveBeenCalledWith(expect.objectContaining({ startDate: '2026-11-09', type: 'paid' }));
  });
});
