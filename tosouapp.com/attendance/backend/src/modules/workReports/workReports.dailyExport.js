/**
 * @module workReports.dailyExport
 * 勤怠記録（日別）の Excel / PDF 出力。
 * 画面（GET /api/admin/work-reports）と同じデータ（buildDailyRoster）を使うので、
 * 状態・遅刻/早退・追加勤務・理由・備考 が画面と一致する。
 * 見た目は管理画面と同じ「紺・罫線・フラット」の業務帳票。
 */
'use strict';

const path = require('path');
const fs = require('fs');

const NAVY = '0B2C66';
const LINE = 'C3CDDA';
const HEAD_BG = 'EEF2F7';
const ZEBRA = 'F7F9FC';
const EXTRA_BG = 'F1F5F9';

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const hm = (v) => (v ? String(v).slice(11, 16) : '');
const minToHm = (m) => { const n = Math.max(0, Math.round(Number(m) || 0)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; };
const wtLabel = (wt) => (wt === 'onsite' ? '出社' : wt === 'remote' ? '在宅' : wt === 'satellite' ? '現場' : '');
const todayJST = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

// 状態の表示と色（画面の 状態 列と同じ言い方）
const TONE = {
  ok: { text: '166534', bg: 'DCFCE7' },
  warn: { text: '854D0E', bg: 'FEF9C3' },
  danger: { text: '991B1B', bg: 'FEE2E2' },
  info: { text: '0369A1', bg: 'E0F2FE' },
  off: { text: '475569', bg: 'F1F5F9' }
};
function statusOf(it, date) {
  const p = String(it.status || '');
  const kubun = String(it.dailyKubun || '').trim();
  const past = date < todayJST();
  if (it.kubunConflict) return { label: `${kubun || '休暇'}（打刻あり）`, tone: 'danger' };
  const half = kubun.startsWith('半休');
  if (p === 'checked_out') return { label: half ? `${kubun}・退勤済` : '退勤済', tone: 'ok' };
  if (p === 'working') return past ? { label: '退勤忘れ', tone: 'danger' } : { label: half ? `${kubun}・出勤中` : '出勤中', tone: 'warn' };
  if (p === 'holiday_working') return past ? { label: '退勤忘れ', tone: 'danger' } : { label: '休日出勤中', tone: 'warn' };
  if (p === 'holiday_work') return { label: '休日出勤', tone: 'warn' };
  if (p === 'absence') return { label: kubun || '欠勤', tone: 'danger' };
  if (p === 'leave' || p === 'off') return { label: kubun || '休日', tone: 'off' };
  if (p === 'not_checked_in') return past ? { label: '打刻なし', tone: 'danger' } : { label: '未出勤', tone: 'info' };
  return { label: kubun || '', tone: 'off' };
}

/** 画面の一覧（buildDailyRoster の items）→ 帳票の行（1行目 + 追加勤務の行） */
function toRows(items, date) {
  const rows = [];
  const counts = { total: 0, working: 0, done: 0, late: 0, notIn: 0, off: 0, extra: 0 };
  let no = 0;
  for (const it of items) {
    const st = statusOf(it, date);
    const kubun = String(it.dailyKubun || '').trim();
    const leaveLike = ['欠勤', '有給休暇', '無給休暇', '休日', '代替休日', '半休', '半休(有給)'].includes(kubun);
    const isOffRow = st.tone === 'off';
    const late = Number(it.lateMinutes || 0);
    const early = Number(it.earlyMinutes || 0);
    const lateEarly = [late > 0 ? `遅刻 ${minToHm(late)}` : '', early > 0 ? `早退 ${minToHm(early)}` : ''].filter(Boolean).join(' / ');
    counts.total++;
    if (st.label.includes('出勤中')) counts.working++;
    if (st.label.includes('退勤済') || st.label === '休日出勤') counts.done++;
    if (late > 0) counts.late++;
    if (st.label === '未出勤' || st.label === '打刻なし') counts.notIn++;
    if (isOffRow) counts.off++;
    no++;
    rows.push({
      kind: 'main', no,
      code: it.employeeCode || `EMP${String(it.userId).padStart(3, '0')}`,
      name: it.username || '',
      dept: it.departmentName || '',
      workType: leaveLike ? kubun : wtLabel(String(it.workType || it.report?.workType || '').trim()),
      status: st,
      in: isOffRow ? '' : hm(it.attendance?.checkIn),
      out: isOffRow ? '' : hm(it.attendance?.checkOut),
      lateEarly,
      site: String(it.report?.site || ''),
      work: String(it.report?.work || ''),
      reason: String(it.reason || ''),
      notes: String(it.notes || '')
    });
    for (const ex of Array.isArray(it.extraRows) ? it.extraRows : []) {
      counts.extra++;
      rows.push({
        kind: 'extra', no: '',
        code: '', name: '└', dept: '',
        workType: '追加勤務', status: null,
        in: ex.in || '', out: ex.out || '', lateEarly: '',
        site: '', work: ex.work || '', reason: ex.reason || '', notes: ex.notes || ''
      });
    }
  }
  return { rows, counts };
}

const COLUMNS = [
  { key: 'no', label: 'No', xw: 5, pw: 22, align: 'center' },
  { key: 'code', label: '社員番号', xw: 11, pw: 52, align: 'center' },
  { key: 'name', label: '氏名', xw: 15, pw: 70, align: 'left' },
  { key: 'dept', label: '部署', xw: 11, pw: 52, align: 'left' },
  { key: 'workType', label: '勤務区分', xw: 9, pw: 44, align: 'center' },
  { key: 'status', label: '状態', xw: 11, pw: 56, align: 'center' },
  { key: 'in', label: '出勤', xw: 7, pw: 34, align: 'center' },
  { key: 'out', label: '退勤', xw: 7, pw: 34, align: 'center' },
  { key: 'lateEarly', label: '遅刻/早退', xw: 11, pw: 52, align: 'center' },
  { key: 'site', label: '現場', xw: 14, pw: 70, align: 'left' },
  { key: 'work', label: '作業内容', xw: 28, pw: 0, align: 'left' }, // PDF は残りの幅
  { key: 'reason', label: '理由', xw: 12, pw: 58, align: 'left' },
  { key: 'notes', label: '備考', xw: 18, pw: 80, align: 'left' }
];

function dateLabel(date) {
  const [y, m, d] = date.split('-').map(Number);
  const dow = WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y}年${m}月${d}日（${dow}）`;
}
const nowLabel = () => new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const summaryText = (c, date) => `対象 ${c.total}名　出勤中 ${c.working}名　退勤済 ${c.done}名　遅刻 ${c.late}名　${String(date || '') < todayJST() ? '打刻なし' : '未出勤'} ${c.notIn}名　休日・休暇 ${c.off}名${c.extra ? `　追加勤務 ${c.extra}件` : ''}`;

async function writeXlsx(res, { date, rows, counts, companyName }) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'スマートE勤怠';
  wb.created = new Date();
  const ws = wb.addWorksheet('勤怠記録（日別）', {
    pageSetup: {
      paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.25 },
      printTitlesRow: '5:5', horizontalCentered: true
    },
    headerFooter: { oddFooter: `&L&8出力日時: ${nowLabel()}&R&8&P / &N ページ` },
    views: [{ state: 'frozen', ySplit: 5, showGridLines: false }]
  });
  ws.columns = COLUMNS.map(c => ({ key: c.key, width: c.xw }));
  const lastCol = COLUMNS.length;
  const font = (o = {}) => ({ name: 'Meiryo UI', size: 9, color: { argb: 'FF1F2937' }, ...o });
  const thin = { style: 'thin', color: { argb: `FF${LINE}` } };
  const border = { top: thin, bottom: thin, left: thin, right: thin };

  // 1: タイトル（左に紺の帯）
  ws.mergeCells(1, 1, 1, 8);
  ws.getCell(1, 1).value = '勤怠記録（日別）';
  ws.getCell(1, 1).font = font({ size: 14, bold: true, color: { argb: `FF${NAVY}` } });
  ws.mergeCells(1, 9, 1, lastCol);
  ws.getCell(1, 9).value = companyName || '';
  ws.getCell(1, 9).font = font({ size: 10, color: { argb: 'FF475569' } });
  ws.getCell(1, 9).alignment = { horizontal: 'right', vertical: 'middle' };
  ws.getRow(1).height = 24;
  // 2: 対象日・出力日時
  ws.mergeCells(2, 1, 2, 8);
  ws.getCell(2, 1).value = `対象日　${dateLabel(date)}`;
  ws.getCell(2, 1).font = font({ size: 10, bold: true });
  ws.mergeCells(2, 9, 2, lastCol);
  ws.getCell(2, 9).value = `出力日時　${nowLabel()}`;
  ws.getCell(2, 9).font = font({ size: 9, color: { argb: 'FF64748B' } });
  ws.getCell(2, 9).alignment = { horizontal: 'right' };
  // 3: 集計
  ws.mergeCells(3, 1, 3, lastCol);
  ws.getCell(3, 1).value = summaryText(counts, date);
  ws.getCell(3, 1).font = font({ size: 9, color: { argb: 'FF334155' } });
  ws.getCell(3, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${HEAD_BG}` } };
  ws.getCell(3, 1).border = { left: { style: 'thick', color: { argb: `FF${NAVY}` } } };
  ws.getRow(3).height = 18;
  // タイトルの下線（紺）
  for (let c = 1; c <= lastCol; c++) ws.getCell(2, c).border = { bottom: { style: 'medium', color: { argb: `FF${NAVY}` } } };
  ws.getRow(4).height = 6;

  // 5: 見出し
  const head = ws.getRow(5);
  COLUMNS.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.label;
    cell.font = font({ bold: true, color: { argb: 'FFFFFFFF' } });
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${NAVY}` } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = border;
  });
  head.height = 20;

  let mainIdx = 0;
  rows.forEach((r, ri) => {
    const row = ws.getRow(6 + ri);
    if (r.kind === 'main') mainIdx++;
    const bg = r.kind === 'extra' ? EXTRA_BG : (mainIdx % 2 === 0 ? ZEBRA : 'FFFFFF');
    COLUMNS.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.value = c.key === 'status' ? (r.status ? r.status.label : '') : (r[c.key] ?? '');
      cell.font = font(r.kind === 'extra' ? { color: { argb: 'FF475569' } } : {});
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${bg}` } };
      cell.alignment = { horizontal: c.align, vertical: 'middle', wrapText: ['work', 'notes', 'site'].includes(c.key) };
      cell.border = border;
      if (c.key === 'status' && r.status) {
        const t = TONE[r.status.tone] || TONE.off;
        cell.font = font({ bold: true, color: { argb: `FF${t.text}` } });
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${t.bg}` } };
      }
      if (c.key === 'lateEarly' && r.lateEarly) cell.font = font({ bold: true, color: { argb: 'FFC2410C' } });
      if ((c.key === 'in' || c.key === 'out') && cell.value) cell.font = font({ bold: true, color: { argb: `FF${NAVY}` } });
      if (c.key === 'workType' && r.kind === 'extra') cell.font = font({ bold: true, color: { argb: 'FF475569' } });
    });
    row.height = 18;
  });
  if (!rows.length) {
    ws.mergeCells(6, 1, 6, lastCol);
    ws.getCell(6, 1).value = '該当データがありません';
    ws.getCell(6, 1).alignment = { horizontal: 'center' };
  }
  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: lastCol } };

  const encoded = encodeURIComponent(`勤怠記録_${date}.xlsx`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`);
  await wb.xlsx.write(res);
  res.end();
}

function writePdf(res, { date, rows, counts, companyName }) {
  const PDFDocument = require('pdfkit');
  const fontPath = [
    path.join(__dirname, '../../static/fonts/NotoSansJP-Regular.ttf'),
    'C:\\Windows\\Fonts\\NotoSansJP-VF.ttf',
    'C:\\Windows\\Fonts\\meiryo.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
  ].find(fp => { try { return fs.existsSync(fp); } catch (e) { return false; } });

  const PAGE_W = 841.89; const PAGE_H = 595.28; // A4 横
  const ML = 28; const MT = 28; const MB = 28;
  const USABLE = PAGE_W - ML * 2;
  const fixed = COLUMNS.reduce((s, c) => s + c.pw, 0);
  const cols = COLUMNS.map(c => ({ ...c, w: c.pw || Math.max(80, USABLE - fixed) }));
  const totalW = cols.reduce((s, c) => s + c.w, 0);
  const FS = 7.5; const HDR_H = 18; const PAD = 3;
  const hex = (h) => `#${h}`;

  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: MT, bottom: MB, left: ML, right: ML }, bufferPages: true, autoFirstPage: false, info: { Title: `勤怠記録（日別） ${date}`, Author: 'スマートE勤怠' } });
  if (fontPath) { doc.registerFont('JP', fontPath); doc.font('JP'); }
  doc.pipe(res);
  let y = MT;

  const rowHeight = (r) => {
    doc.fontSize(FS);
    let h = 16;
    for (const c of cols) {
      if (!['work', 'notes', 'site', 'reason'].includes(c.key)) continue;
      const t = String(r[c.key] || '');
      if (!t) continue;
      h = Math.max(h, doc.heightOfString(t, { width: c.w - PAD * 2 }) + 7);
    }
    return Math.min(h, 80);
  };
  const header = (first) => {
    // タイトル・対象日
    doc.fillColor(hex(NAVY)).fontSize(13).text('勤怠記録（日別）', ML, y, { lineBreak: false });
    doc.fillColor('#334155').fontSize(9).text(`対象日　${dateLabel(date)}`, ML + 150, y + 4, { lineBreak: false });
    if (companyName) doc.fillColor('#475569').fontSize(9).text(companyName, ML, y + 4, { width: totalW, align: 'right', lineBreak: false });
    y += 20;
    doc.rect(ML, y, totalW, 1.5).fill(hex(NAVY));
    y += 6;
    if (first) {
      // 集計（左に紺の線）
      doc.rect(ML, y, totalW, 16).fill(hex(HEAD_BG));
      doc.rect(ML, y, 2.5, 16).fill(hex(NAVY));
      doc.fillColor('#334155').fontSize(8).text(summaryText(counts, date), ML + 8, y + 4, { lineBreak: false });
      y += 22;
    }
    // 列見出し
    doc.rect(ML, y, totalW, HDR_H).fill(hex(NAVY));
    let x = ML;
    for (const c of cols) {
      doc.fillColor('#ffffff').fontSize(7.5).text(c.label, x + PAD, y + 5, { width: c.w - PAD * 2, align: 'center', lineBreak: false });
      x += c.w;
    }
    y += HDR_H;
  };

  doc.addPage(); header(true);
  let mainIdx = 0;
  const bottom = PAGE_H - MB - 14;
  for (const r of rows) {
    const h = rowHeight(r);
    if (y + h > bottom) { doc.addPage(); y = MT; header(false); }
    if (r.kind === 'main') mainIdx++;
    const bg = r.kind === 'extra' ? EXTRA_BG : (mainIdx % 2 === 0 ? ZEBRA : 'FFFFFF');
    doc.rect(ML, y, totalW, h).fill(hex(bg));
    let x = ML;
    for (const c of cols) {
      const v = c.key === 'status' ? '' : String(r[c.key] ?? '');
      if (c.key === 'status' && r.status) {
        const t = TONE[r.status.tone] || TONE.off;
        const bw = c.w - 8; const bh = 11;
        doc.rect(x + 4, y + (h - bh) / 2, bw, bh).fill(hex(t.bg));
        doc.fillColor(hex(t.text)).fontSize(7).text(r.status.label, x + 4, y + (h - bh) / 2 + 1.4, { width: bw, align: 'center', lineBreak: false, ellipsis: true });
      } else if (['work', 'notes', 'site', 'reason'].includes(c.key)) {
        doc.fillColor(r.kind === 'extra' ? '#475569' : '#1f2937').fontSize(FS).text(v, x + PAD, y + 4, { width: c.w - PAD * 2, height: h - 6, align: c.align });
      } else {
        let color = r.kind === 'extra' ? '#475569' : '#1f2937';
        if ((c.key === 'in' || c.key === 'out') && v) color = hex(NAVY);
        if (c.key === 'lateEarly' && v) color = '#c2410c';
        doc.fillColor(color).fontSize(FS).text(v, x + PAD, y + (h - FS) / 2 - 0.5, { width: c.w - PAD * 2, align: c.align, lineBreak: false, ellipsis: true });
      }
      x += c.w;
    }
    // 罫線
    doc.lineWidth(0.4).strokeColor(hex(LINE));
    doc.moveTo(ML, y + h).lineTo(ML + totalW, y + h).stroke();
    x = ML;
    for (const c of cols) { doc.moveTo(x, y).lineTo(x, y + h).stroke(); x += c.w; }
    doc.moveTo(x, y).lineTo(x, y + h).stroke();
    y += h;
  }
  if (!rows.length) doc.fillColor('#64748b').fontSize(10).text('該当データがありません', ML, y + 14, { width: totalW, align: 'center' });

  // フッター（全ページ）
  const range = doc.bufferedPageRange();
  const now = nowLabel();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const fy = PAGE_H - MB + 8;
    const ob = doc.page.margins.bottom; doc.page.margins.bottom = 0;
    doc.lineWidth(0.5).strokeColor(hex(LINE)).moveTo(ML, fy - 3).lineTo(ML + totalW, fy - 3).stroke();
    doc.fillColor('#94a3b8').fontSize(7).text(`出力日時 ${now}　スマートE勤怠`, ML, fy, { width: totalW / 2, lineBreak: false });
    doc.fillColor('#94a3b8').fontSize(7).text(`${i + 1} / ${range.count}`, ML, fy, { width: totalW, align: 'right', lineBreak: false });
    doc.page.margins.bottom = ob;
  }
  const encoded = encodeURIComponent(`勤怠記録_${date}.pdf`);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`);
  doc.end();
}

module.exports = { toRows, statusOf, writeXlsx, writePdf };
