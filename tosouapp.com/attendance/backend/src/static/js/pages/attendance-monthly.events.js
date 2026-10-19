(function () {
  const root = globalThis.AttendanceMonthly || {};
  const core = root.Core || globalThis.MonthlyMonthlyCore || {};
  const state = root.State || globalThis.MonthlyMonthlyState || {};
  const render = root.Render || globalThis.MonthlyMonthlyRender || {};
  const draft = root.Draft || globalThis.MonthlyMonthlyDraft || null;
  const controller = root.Controller;

  const { $, setDirty, clearDirty, showErr, hideSpinner, wireUserMenu, wireTopNavDropdowns } = core;
  const { recomputeRow: _origRecomputeRow } = render;
  const __blockRecalc = new WeakSet();
  const _setBlockRecalc = (tr) => { try { if (tr) __blockRecalc.add(tr); } catch (e) {} };
  const _clearBlockRecalc = (tr) => { try { if (tr) __blockRecalc.delete(tr); } catch (e) {} };
  const _isBlockRecalc = (tr) => { try { return tr && __blockRecalc.has(tr); } catch (e) { return false; } };
  const recomputeRow = (tr) => {
    if (!tr) return;
    if (_isBlockRecalc(tr)) return; // Skip recalculation if blocked
    if (_origRecomputeRow) return _origRecomputeRow(tr);
  };
  render.recomputeRow = recomputeRow;

  let lastAutoReloadAt = 0;
  const bindAutoReloadOnReturn = () => {
    const maybeReload = async () => {
      if (!controller) return;
      if (state.dirty) return;
      const now = Date.now();
      if (now - lastAutoReloadAt < 2000) return;
      lastAutoReloadAt = now;
      // Disabled auto-reload to prevent flicker
      // try { await controller.reloadMonth(); } catch (e) { /* silently ignored */ }
    };
    window.addEventListener('pageshow', (e) => {
      if (e && e.persisted) void maybeReload();
    });
    window.addEventListener('focus', () => {
      if (document.visibilityState !== 'visible') return;
      void maybeReload();
    });
  };

  const bindCollapseToggles = () => {
    controller.applyDailyCollapsed(controller.getDailyCollapsed());
    $('#dailyToggle')?.addEventListener('click', (e) => {
      e.preventDefault();
      const next = !controller.getDailyCollapsed();
      controller.setDailyCollapsed(next);
      controller.applyDailyCollapsed(next);
      try { requestAnimationFrame(() => controller.syncMonthHScroll()); } catch (e) { /* silently ignored */ }
    });
    controller.applyContractCollapsed(controller.getContractCollapsed());
    $('#contractToggle')?.addEventListener('click', (e) => {
      e.preventDefault();
      const next = !controller.getContractCollapsed();
      controller.setContractCollapsed(next);
      controller.applyContractCollapsed(next);
    });
    controller.applySummaryCollapsed(controller.getSummaryCollapsed());
    $('#summaryToggle')?.addEventListener('click', (e) => {
      e.preventDefault();
      const next = !controller.getSummaryCollapsed();
      controller.setSummaryCollapsed(next);
      controller.applySummaryCollapsed(next);
    });
    controller.applyAnnualCollapsed(controller.getAnnualCollapsed());
    $('#annualToggle')?.addEventListener('click', (e) => {
      e.preventDefault();
      const next = !controller.getAnnualCollapsed();
      controller.setAnnualCollapsed(next);
      controller.applyAnnualCollapsed(next);
    });
  };

  const bindDirtyOnBlur = () => {
    document.addEventListener('blur', (e) => {
      if (!state.editableMonth) return;
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      const tag = t.tagName.toLowerCase();
      if (tag === 'select' || tag === 'textarea') { setDirty(); return; }
      if (tag === 'input') {
        const type = (t.getAttribute('type') || '').toLowerCase();
        if (type === 'text' || type === 'time' || type === 'number' || type === 'checkbox' || type === 'month') setDirty();
      }
    }, true);
  };

  const bindWindowResize = () => {
    window.addEventListener('resize', () => {
      controller.syncFooterVars();
      controller.syncStickyTop();
      controller.syncMonthHScroll();
    }, { passive: true });
  };

  const bindTabs = () => {
    const cSec = $('#contractSection');
    if (cSec && cSec.dataset.tabsWired !== '1') {
      cSec.dataset.tabsWired = '1';
      const tabs = Array.from(cSec.querySelectorAll('.se-tab[data-tab]'));
      for (const t of tabs) {
        if (t.dataset.tabListenerWired === '1') continue;
        t.addEventListener('click', async (e) => {
          e.preventDefault();
          try { console.debug('attendance:tab-click', { section: 'contract', tab: t.dataset.tab, detail: e?.detail }); console.trace(); } catch (err) {}
          // Ignore additional click events (double/triple clicks)
          if (e && e.detail && e.detail > 1) return;
          if (t.hasAttribute('disabled')) return;
          for (const x of tabs) x.classList.toggle('active', x === t);
          try { controller.ctx.applyContractTab?.(); } catch (e) { /* silently ignored */ }
        });
        try { t.dataset.tabListenerWired = '1'; } catch (err) {}
      }
    }
    const sSec = $('#summarySection');
    if (sSec && sSec.dataset.tabsWired !== '1') {
      sSec.dataset.tabsWired = '1';
      const tabs = Array.from(sSec.querySelectorAll('.se-tab[data-tab]'));
      for (const t of tabs) {
        if (t.dataset.tabListenerWired === '1') continue;
        t.addEventListener('click', async (e) => {
          e.preventDefault();
          try { console.debug('attendance:tab-click', { section: 'summary', tab: t.dataset.tab, detail: e?.detail }); console.trace(); } catch (err) {}
          // Ignore additional click events (double/triple clicks)
          if (e && e.detail && e.detail > 1) return;
          if (t.hasAttribute('disabled')) return;
          for (const x of tabs) x.classList.toggle('active', x === t);
          try { controller.ctx.applySummaryTab?.(); } catch (e) { /* silently ignored */ }
        });
        try { t.dataset.tabListenerWired = '1'; } catch (err) {}
      }
    }
    
    const dSec = $('#dailySection');
    if (dSec && dSec.dataset.tabsWired !== '1') {
      dSec.dataset.tabsWired = '1';
      const tabs = Array.from(dSec.querySelectorAll('.se-tab[data-tab]'));
      for (const t of tabs) {
        if (t.dataset.tabListenerWired === '1') continue;
        t.addEventListener('click', async (e) => {
          e.preventDefault();
          try { console.debug('attendance:tab-click', { section: 'daily', tab: t.dataset.tab, detail: e?.detail }); console.trace(); } catch (err) {}
          // Ignore additional click events (double/triple clicks)
          if (e && e.detail && e.detail > 1) return;
          if (t.hasAttribute('disabled')) return;
          if (t.dataset.tab === 'plan') {
            document.body.classList.add('view-plan');
            document.body.classList.remove('view-round');
            const table = document.getElementById('monthTableReal');
            if (table) {
              const cg = table.querySelector('colgroup');
              if (cg) cg.style.display = 'none';
              table.style.tableLayout = '';
              table.style.width = '';
            }
          } else if (t.dataset.tab === 'actual') {
            // Only restore if coming from round mode
            if (document.body.classList.contains('view-round')) {
              document.body.classList.remove('view-round');
              // Restore original values from row dataset
              const allRows = document.querySelectorAll('#monthTableReal [data-row="1"]');
              for (const row of allRows) {
                if (!row.dataset.origIn) continue;
                const inEl = row.querySelector('input[data-field="checkIn"]');
                const outEl = row.querySelector('input[data-field="checkOut"]');
                const workedEl = row.querySelector('[data-field="worked"]');
                const excessEl = row.querySelector('[data-field="excess"]');
                if (inEl) inEl.value = row.dataset.origIn;
                if (outEl) outEl.value = row.dataset.origOut;
                if (workedEl) workedEl.textContent = row.dataset.origWorked;
                if (excessEl) excessEl.textContent = row.dataset.origExcess;
                _clearBlockRecalc(row);
              }
              // Restore 当月サマリ
              try {
                const sumRow = document.querySelector('#monthSummaryTable table tbody tr, #monthSummary table tbody tr');
                if (sumRow && sumRow.dataset.origSummary) {
                  const originals = JSON.parse(sumRow.dataset.origSummary);
                  const cells = sumRow.querySelectorAll('td');
                  originals.forEach((text, i) => { if (cells[i]) cells[i].textContent = text; });
                  delete sumRow.dataset.origSummary;
                }
              } catch (e) { /* silently ignored */ }
            }
            document.body.classList.remove('view-plan');
            document.body.classList.remove('view-round');
            const table = document.getElementById('monthTableReal');
            if (table) {
              const cg = table.querySelector('colgroup');
              if (cg) cg.style.display = '';
              table.style.tableLayout = 'fixed';
              table.style.width = '';
            }
          } else if (t.dataset.tab === 'round') {
            document.body.classList.remove('view-plan');
            document.body.classList.add('view-round');
            // Apply rounding to existing table values (run batches sequentially)
            const rStep = 30; // 30 minute rounding
            const toMin = (hm) => {
              if (!hm || hm === '--:--') return -1;
              const parts = String(hm).split(':');
              if (parts.length !== 2) return -1;
              const h = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
              return (isNaN(h) || isNaN(m)) ? -1 : h * 60 + m;
            };
            const fromMin = (m) => {
              if (m < 0) return '';
              return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
            };
            const fmtMin = (m) => m > 0 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` : '';
            const allRows = document.querySelectorAll('#monthTableReal [data-row="1"]');
            const doRounding = async () => {
              const rows = Array.from(allRows);
              const batchSize = 60;
              for (let i = 0; i < rows.length; i += batchSize) {
                const chunk = rows.slice(i, i + batchSize);
                for (const row of chunk) {
                  _setBlockRecalc(row);
                  const inEl = row.querySelector('input[data-field="checkIn"]');
                  const outEl = row.querySelector('input[data-field="checkOut"]');
                  const workedEl = row.querySelector('[data-field="worked"]');
                  const excessEl = row.querySelector('[data-field="excess"]');
                  // Save originals into row dataset (always update to capture latest edits)
                  row.dataset.origIn = inEl ? inEl.value : '';
                  row.dataset.origOut = outEl ? outEl.value : '';
                  row.dataset.origWorked = workedEl ? workedEl.textContent : '';
                  row.dataset.origExcess = excessEl ? excessEl.textContent : '';
                  const brSel = row.querySelector('select[data-field="break"]');
                  // Skip rows without actual data
                  const hasActualIn = !!(row.dataset.actualIn || (inEl && !inEl.classList.contains('is-auto') && inEl.value && inEl.value !== '--:--'));
                  const hasActualOut = !!(row.dataset.actualOut || (outEl && !outEl.classList.contains('is-auto') && outEl.value && outEl.value !== '--:--'));
                  // Thiếu 出勤 hoặc 退勤 thật (giờ kia chỉ là giờ ca tự điền) → không làm tròn, không tính 実働/残業
                  // từ giờ tự điền (trước đây hiện 残業 giả cho ngày quên 退勤; 給与 tính ngày đó là 0).
                  if (!hasActualIn || !hasActualOut) { _clearBlockRecalc(row); continue; }
                  const shiftStart = row.dataset.shiftStart || '08:00';
                  const shiftEnd = row.dataset.shiftEnd || '17:00';
                  const shiftStartMin = toMin(shiftStart);
                  const shiftEndMin = toMin(shiftEnd);
                  const rawIn = row.dataset.origIn || (inEl ? inEl.value : '');
                  const rawOut = row.dataset.origOut || (outEl ? outEl.value : '');
                  // Clock-in: round UP to nearest 30 minutes (do not clamp to shift start)
                  let rIn = '';
                  const rawInMin = toMin(rawIn);
                  if (rawInMin >= 0) {
                    const rInMin = Math.ceil(rawInMin / rStep) * rStep;
                    rIn = fromMin(rInMin);
                  }
                  // Clock-out: always round DOWN to 30 minutes — same as 給与 (attendance.rules.js, 会社の丸めルール).
                  // Before shift end: floor (not below shift start); after shift end: floor the OT portion.
                  let rOut = '';
                  const rawOutMin = toMin(rawOut);
                  if (rawOutMin >= 0) {
                    if (rawOutMin <= shiftEndMin) {
                      rOut = fromMin(Math.max(shiftStartMin, Math.floor(rawOutMin / rStep) * rStep));
                    } else {
                      const otRaw = rawOutMin - shiftEndMin;
                      const otRounded = Math.floor(otRaw / rStep) * rStep;
                      rOut = fromMin(shiftEndMin + otRounded);
                    }
                  }
                  if (inEl) inEl.value = rIn;
                  if (outEl) outEl.value = rOut;
                  // Recalculate worked/excess
                  if (rIn && rOut) {
                    const brRaw = brSel ? String(brSel.value || '0:00').trim() : '0:00';
                    const brVal = toMin(brRaw) >= 0 ? toMin(brRaw) : 60;
                    const totalWorked = Math.max(0, (toMin(rOut) - toMin(rIn)) - brVal);
                    if (workedEl) workedEl.textContent = fmtMin(totalWorked);
                    const scheduled = Math.max(0, shiftEndMin - shiftStartMin - brVal);
                    const excess = Math.max(0, totalWorked - scheduled);
                    if (excessEl) excessEl.textContent = fmtMin(excess);
                  }
                  row.classList.add('is-rounded');
                  // allow recomputeRow to run for this row now
                  _clearBlockRecalc(row);
                }
                // yield to the event loop so the browser can update UI
                await new Promise(r => setTimeout(r, 0));
              }
            };
            // run rounding and wait for completion before recomputing summary
            try {
              await doRounding();
            } catch (e) { /* silently ignored */ }
            // Update 当月サマリ with rounded totals
            try {
              let totalWorkMin = 0, totalOtMin = 0, attendDays = 0;
              const roundedRows = document.querySelectorAll('#monthTableReal [data-row="1"].is-rounded');
              // Summation also in batches to avoid long main-thread blocks
              await (async () => {
                try {
                  const rrows = Array.from(roundedRows);
                  const batch = 80;
                  for (let j = 0; j < rrows.length; j += batch) {
                    const chunk = rrows.slice(j, j + batch);
                    for (const rr of chunk) {
                      // Only count rows with BOTH checkIn AND checkOut (completed shifts)
                      // AND not auto/planned rows
                      const rrIn = rr.querySelector('input[data-field="checkIn"]');
                      const rrOut = rr.querySelector('input[data-field="checkOut"]');
                      if (!rrIn?.value || !rrOut?.value || rrIn.value === '--:--' || rrOut.value === '--:--') continue;
                      if (rrIn.classList.contains('is-auto') || rrOut.classList.contains('is-auto')) continue;
                      const w = rr.querySelector('[data-field="worked"]');
                      const e = rr.querySelector('[data-field="excess"]');
                      const wText = w ? w.textContent.trim() : '';
                      const eText = e ? e.textContent.trim() : '';
                      const wMin = toMin(wText) > 0 ? toMin(wText) : 0;
                      const eMin = toMin(eText) > 0 ? toMin(eText) : 0;
                      if (wMin > 0) { totalWorkMin += wMin; attendDays++; }
                      if (eMin > 0) totalOtMin += eMin;
                    }
                    await new Promise(r => setTimeout(r, 0));
                  }
                } catch (e) { /* silently ignored */ }
              })();
              const sumRow = document.querySelector('#monthSummaryTable table tbody tr, #monthSummary table tbody tr');
              if (sumRow) {
                const cells = sumRow.querySelectorAll('td');
                if (!sumRow.dataset.origSummary) {
                  sumRow.dataset.origSummary = JSON.stringify([...cells].map(c => c.textContent));
                }
                // Tìm ô theo tên cột (không theo vị trí) vì 全体 và 社内勤務 có số cột khác nhau
                const setByHeader = (tr, label, text) => {
                  const table = tr.closest('table');
                  const ths = table ? [...table.querySelectorAll('thead th')] : [];
                  const idx = ths.findIndex(th => String(th.textContent || '').trim() === label);
                  const tds = tr.querySelectorAll('td');
                  if (idx >= 0 && tds[idx]) tds[idx].textContent = text;
                };
                setByHeader(sumRow, '総労働時間', fmtMin(totalWorkMin));
                setByHeader(sumRow, '総残業時間', fmtMin(totalOtMin));
                setByHeader(sumRow, '法定外時間', fmtMin(totalOtMin));
              }
              // Also sync the top-of-page month summary host (if present)
              try {
                const top = controller?.ctx?.summaryHost;
                if (top) {
                  const topRow = top.querySelector('tbody tr');
                  const topTable = topRow ? topRow.closest('table') : null;
                  const topThs = topTable ? [...topTable.querySelectorAll('thead th')] : [];
                  const topTds = topRow ? topRow.querySelectorAll('td') : [];
                  for (const [label, text] of [['総労働時間', fmtMin(totalWorkMin)], ['総残業時間', fmtMin(totalOtMin)], ['法定外時間', fmtMin(totalOtMin)]]) {
                    const idx = topThs.findIndex(th => String(th.textContent || '').trim() === label);
                    if (idx >= 0 && topTds[idx]) topTds[idx].textContent = text;
                  }
                }
              } catch (er) { /* silently ignored */ }
            } catch (e) { /* silently ignored */ }
            // all rows were cleared during rounding; nothing more to do here
          }
          for (const x of tabs) {
            x.classList.toggle('active', x === t);
          }
          window.dispatchEvent(new Event('resize'));
        });
      }
    }
  };

  const bindWorkflowButtons = () => {
    const applyFeedback = async (btn, actionText, actionFn) => {
      if (!btn) return;
      if (btn.dataset.saving === '1') return;
      btn.dataset.saving = '1';
      const originalText = btn.dataset.originalText || btn.innerHTML;
      btn.dataset.originalText = originalText;
      btn.disabled = true;
      btn.innerHTML = actionText + '中...';
      core.showSpinner('save', false);
      try {
        await actionFn();
        btn.innerHTML = actionText + '成功';
        btn.style.background = '#10b981';
        btn.style.borderColor = '#10b981';
        btn.style.color = '#fff';
        core.showSpinner('save', true);
        setTimeout(() => {
          btn.innerHTML = originalText;
          btn.style.background = '';
          btn.style.borderColor = '';
          btn.style.color = '';
          btn.disabled = false;
          btn.dataset.saving = '0';
          core.hideSpinner();
        }, 600);

      } catch (err) {
        btn.innerHTML = originalText;
        btn.disabled = false;
        btn.dataset.saving = '0';
        core.hideSpinner();
        alert(String(err?.message || actionText + '失敗しました'));
      }
    };

    document.querySelector('#btnSubmitMonth')?.addEventListener('click', async (e) => { 
      e.preventDefault(); 
      await applyFeedback(e.currentTarget, '提出', async () => { await controller.submitMonth(); });
    });
    document.querySelector('#btnApproveMonth')?.addEventListener('click', async (e) => { 
      e.preventDefault(); 
      await applyFeedback(e.currentTarget, '承認', async () => { await controller.approveMonth(); });
    });
    document.querySelector('#btnUnlockMonth')?.addEventListener('click', async (e) => { 
      e.preventDefault(); 
      await applyFeedback(e.currentTarget, '取消', async () => { await controller.unlockMonth(); });
    });
  };

  const bindUserPicker = () => {
    const up = controller.ctx.userPicker;
    if (!up || up._bound) return;
    up._bound = true;
    up.input?.addEventListener('input', () => { try { up.rebuild(); } catch (e) { /* silently ignored */ } });
    up.select?.addEventListener('change', async () => {
      const next = String(up.select.value || '').trim();
      await controller.setActingUserId(next);
    });
  };

  const bindTargetDateSelect = () => {
    document.addEventListener('change', async (e) => {
      const sel = e.target?.closest?.('#targetDateSelect');
      if (!sel) return;
      const v = String(sel.value || '');
      if (/^\d{6}$/.test(v)) {
        const ym = `${v.slice(0, 4)}-${v.slice(4, 6)}`;
        await controller.setMonth(ym);
      }
    });
  };

  const bindMonthNav = () => {
    $('#btnPrevMonth')?.addEventListener('click', async () => { await controller.nextMonth(-1); });
    $('#btnNextMonth')?.addEventListener('click', async () => { await controller.nextMonth(1); });
    const handlePick = async (v) => {
      if (!/^\d{4}-\d{2}$/.test(v)) return;
      await controller.setMonth(v);
    };
    controller.ctx.picker1?.addEventListener('input', async () => {
      const v = controller.ctx.picker1.value;
      await handlePick(v);
    });
    controller.ctx.picker1?.addEventListener('change', async () => {
      const v = controller.ctx.picker1.value;
      await handlePick(v);
    });
    controller.ctx.picker2?.addEventListener('input', async () => {
      const v = controller.ctx.picker2.value;
      await handlePick(v);
    });
    controller.ctx.picker2?.addEventListener('change', async () => {
      const v = controller.ctx.picker2.value;
      await handlePick(v);
    });
    $('#btnReload')?.addEventListener('click', async (e) => { e.preventDefault(); await controller.reloadMonth(); });
  };

  const bindSaveExportImport = () => {
    const handleSave = async (e, btn) => {
      e.preventDefault();
      if (btn.dataset.saving === '1') return;
      if (!state.editableMonth) { alert('この月は入力できません。'); return; }
      if (!confirm('保存しますか？')) return;
      clearDirty();
      btn.dataset.saving = '1';
      const originalText = btn.dataset.originalText || btn.innerHTML;
      btn.dataset.originalText = originalText;
      btn.disabled = true;
      btn.innerHTML = '保存中...';
      core.showSpinner('save', false);
      try {
        await controller.saveManual();
        btn.innerHTML = '保存成功';
        btn.style.background = '#10b981'; // green
        btn.style.borderColor = '#10b981';
        btn.style.color = '#fff';
        core.showSpinner('save', true);
        setTimeout(() => {
          btn.innerHTML = originalText;
          btn.style.background = '';
          btn.style.borderColor = '';
          btn.style.color = '';
          btn.disabled = false;
          btn.dataset.saving = '0';
          core.hideSpinner();
        }, 600);
      } catch (err) {
        btn.innerHTML = originalText;
        btn.disabled = false;
        btn.dataset.saving = '0';
        core.hideSpinner();
        if (err && err.message) alert(err.message);
      }
    };

    $('#btnSave')?.addEventListener('click', (e) => handleSave(e, $('#btnSave')));
    $('#btnSaveBottom')?.addEventListener('click', (e) => handleSave(e, $('#btnSaveBottom')));
    document.querySelectorAll('.saveBtn').forEach((btn) => {
      btn.addEventListener('click', (e) => handleSave(e, btn));
    });
    document.querySelectorAll('.exportBtn').forEach((btn) => {
      btn.addEventListener('click', async (e) => { e.preventDefault(); await controller.exportXlsx(); });
    });
    document.querySelectorAll('.importBtn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        if (!state.editableMonth) { alert('この月は入力できません。'); return; }
        clearDirty();
        showErr('');
        if (!controller.checkImportFile()) return;
        if (!confirm('ファイルを取込します。よろしいですか？')) return;
        alert('取込処理は未実装です。');
      });
    });
    document.querySelector('#btnBackBottom')?.addEventListener('click', (e) => {
      e.preventDefault();
      try {
        if (window.history.length > 1) window.history.back();
        else window.location.href = '/ui/attendance';
      } catch (e) {
        window.location.href = '/ui/attendance';
      }
    });
  };

  const bindSummaryEditor = () => {
    const wrap = document.querySelector('#summaryEditor');
    const btn = document.querySelector('#btnSummaryEdit');
    const picker = controller.ctx.picker;
    if (!wrap || !btn || !picker) return;

    const status = (msg) => {
      const el = wrap.querySelector('#summaryEditorStatus');
      if (el) el.textContent = msg || '';
    };
    const hmToMin = (s) => {
      const t = String(s || '').trim();
      if (!t) return 0;
      const m = t.match(/^(\\d+):(\\d{2})$/);
      if (!m) return null;
      const h = parseInt(m[1], 10);
      const mm = parseInt(m[2], 10);
      if (!Number.isFinite(h) || !Number.isFinite(mm) || mm < 0 || mm >= 60) return null;
      return Math.max(0, (h * 60) + mm);
    };
    const minToHm = (min) => {
      const m = Math.max(0, Number(min || 0));
      const h = Math.floor(m / 60);
      const r = Math.floor(m % 60);
      return `${h}:${String(r).padStart(2, '0')}`;
    };
    const num = (v) => {
      const x = Number(v);
      return Number.isFinite(x) ? x : 0;
    };
    const getYM = () => {
      const ym = String(picker.value || '').trim();
      if (!/^\\d{4}-\\d{2}$/.test(ym)) return null;
      return { ym, year: parseInt(ym.slice(0, 4), 10), month: parseInt(ym.slice(5, 7), 10) };
    };
    const qUser = () => {
      const uid = controller.ctx.actingUserId || '';
      return uid ? `&userId=${encodeURIComponent(uid)}` : '';
    };
    const setAll = (o) => {
      const x = o && typeof o === 'object' ? o : {};
      wrap.querySelector('#seAllPlannedDays').value = String(x.plannedDays == null ? '' : x.plannedDays);
      wrap.querySelector('#seAllAttendDays').value = String(x.attendDays == null ? '' : x.attendDays);
      wrap.querySelector('#seAllHolidayWorkDays').value = String(x.holidayWorkDays == null ? '' : x.holidayWorkDays);
      wrap.querySelector('#seAllStandbyDays').value = String(x.standbyDays == null ? '' : x.standbyDays);
      wrap.querySelector('#seAllTotalWork').value = minToHm(x.totalWorkMinutes == null ? 0 : x.totalWorkMinutes);
      wrap.querySelector('#seAllNight').value = minToHm(x.nightMinutes == null ? 0 : x.nightMinutes);
      wrap.querySelector('#seAllOvertime').value = minToHm(x.overtimeMinutes == null ? 0 : x.overtimeMinutes);
      wrap.querySelector('#seAllLegalOvertime').value = minToHm(x.legalOvertimeMinutes == null ? 0 : x.legalOvertimeMinutes);
      wrap.querySelector('#seAllPaidDays').value = String(x.paidDays == null ? '' : x.paidDays);
      wrap.querySelector('#seAllSubstituteDays').value = String(x.substituteDays == null ? '' : x.substituteDays);
      wrap.querySelector('#seAllUnpaidDays').value = String(x.unpaidDays == null ? '' : x.unpaidDays);
      wrap.querySelector('#seAllAbsentDays').value = String(x.absentDays == null ? '' : x.absentDays);
      wrap.querySelector('#seAllDeduction').value = minToHm(x.deductionMinutes == null ? 0 : x.deductionMinutes);
      wrap.querySelector('#seAllOnsiteDays').value = String(x.onsiteDays == null ? '' : x.onsiteDays);
      wrap.querySelector('#seAllRemoteDays').value = String(x.remoteDays == null ? '' : x.remoteDays);
      wrap.querySelector('#seAllSatelliteDays').value = String(x.satelliteDays == null ? '' : x.satelliteDays);
    };
    const setIh = (o) => {
      const x = o && typeof o === 'object' ? o : {};
      wrap.querySelector('#seIhPlannedDays').value = String(x.plannedDays == null ? '' : x.plannedDays);
      wrap.querySelector('#seIhAttendDays').value = String(x.attendDays == null ? '' : x.attendDays);
      wrap.querySelector('#seIhHolidayWorkDays').value = String(x.holidayWorkDays == null ? '' : x.holidayWorkDays);
      wrap.querySelector('#seIhStandbyDays').value = String(x.standbyDays == null ? '' : x.standbyDays);
      wrap.querySelector('#seIhTotalWork').value = minToHm(x.totalWorkMinutes == null ? 0 : x.totalWorkMinutes);
      wrap.querySelector('#seIhNight').value = minToHm(x.nightMinutes == null ? 0 : x.nightMinutes);
      wrap.querySelector('#seIhOvertime').value = minToHm(x.overtimeMinutes == null ? 0 : x.overtimeMinutes);
      wrap.querySelector('#seIhLegalOvertime').value = minToHm(x.legalOvertimeMinutes == null ? 0 : x.legalOvertimeMinutes);
      wrap.querySelector('#seIhPaidDays').value = String(x.paidDays == null ? '' : x.paidDays);
      wrap.querySelector('#seIhSubstituteDays').value = String(x.substituteDays == null ? '' : x.substituteDays);
      wrap.querySelector('#seIhUnpaidDays').value = String(x.unpaidDays == null ? '' : x.unpaidDays);
      wrap.querySelector('#seIhAbsentDays').value = String(x.absentDays == null ? '' : x.absentDays);
    };
    const getAll = () => {
      const totalWorkMinutes = hmToMin(wrap.querySelector('#seAllTotalWork').value);
      const nightMinutes = hmToMin(wrap.querySelector('#seAllNight').value);
      const overtimeMinutes = hmToMin(wrap.querySelector('#seAllOvertime').value);
      const legalOvertimeMinutes = hmToMin(wrap.querySelector('#seAllLegalOvertime').value);
      const deductionMinutes = hmToMin(wrap.querySelector('#seAllDeduction').value);
      if (totalWorkMinutes == null || nightMinutes == null || overtimeMinutes == null || legalOvertimeMinutes == null || deductionMinutes == null) return null;
      return {
        plannedDays: num(wrap.querySelector('#seAllPlannedDays').value),
        attendDays: num(wrap.querySelector('#seAllAttendDays').value),
        holidayWorkDays: num(wrap.querySelector('#seAllHolidayWorkDays').value),
        standbyDays: num(wrap.querySelector('#seAllStandbyDays').value),
        totalWorkMinutes,
        nightMinutes,
        overtimeMinutes,
        legalOvertimeMinutes,
        paidDays: num(wrap.querySelector('#seAllPaidDays').value),
        substituteDays: num(wrap.querySelector('#seAllSubstituteDays').value),
        unpaidDays: num(wrap.querySelector('#seAllUnpaidDays').value),
        absentDays: num(wrap.querySelector('#seAllAbsentDays').value),
        deductionMinutes,
        onsiteDays: num(wrap.querySelector('#seAllOnsiteDays').value),
        remoteDays: num(wrap.querySelector('#seAllRemoteDays').value),
        satelliteDays: num(wrap.querySelector('#seAllSatelliteDays').value)
      };
    };
    const getIh = () => {
      const totalWorkMinutes = hmToMin(wrap.querySelector('#seIhTotalWork').value);
      const nightMinutes = hmToMin(wrap.querySelector('#seIhNight').value);
      const overtimeMinutes = hmToMin(wrap.querySelector('#seIhOvertime').value);
      const legalOvertimeMinutes = hmToMin(wrap.querySelector('#seIhLegalOvertime').value);
      if (totalWorkMinutes == null || nightMinutes == null || overtimeMinutes == null || legalOvertimeMinutes == null) return null;
      return {
        plannedDays: num(wrap.querySelector('#seIhPlannedDays').value),
        attendDays: num(wrap.querySelector('#seIhAttendDays').value),
        holidayWorkDays: num(wrap.querySelector('#seIhHolidayWorkDays').value),
        standbyDays: num(wrap.querySelector('#seIhStandbyDays').value),
        totalWorkMinutes,
        nightMinutes,
        overtimeMinutes,
        legalOvertimeMinutes,
        paidDays: num(wrap.querySelector('#seIhPaidDays').value),
        substituteDays: num(wrap.querySelector('#seIhSubstituteDays').value),
        unpaidDays: num(wrap.querySelector('#seIhUnpaidDays').value),
        absentDays: num(wrap.querySelector('#seIhAbsentDays').value)
      };
    };
    const loadFromDetail = () => {
      setAll(state.currentMonthDetail?.monthSummary?.all || {});
      setIh(state.currentMonthDetail?.monthSummary?.inhouse || {});
    };
    const load = async () => {
      const ym = getYM();
      if (!ym) return;
      status('読込中...');
      const r = await core.fetchJSONAuth(`/api/attendance/month/summary?year=${encodeURIComponent(ym.year)}&month=${encodeURIComponent(ym.month)}${qUser()}`);
      setAll(r?.all || {});
      setIh(r?.inhouse || {});
      status('読込完了');
    };
    const save = async () => {
      const ym = getYM();
      if (!ym) return;
      const all = getAll();
      const ih = getIh();
      if (!all || !ih) { status('時間はH:MMで入力してください'); return; }
      status('保存中...');
      await core.fetchJSONAuth(`/api/attendance/month/summary?year=${encodeURIComponent(ym.year)}&month=${encodeURIComponent(ym.month)}${qUser()}`, {
        method: 'PUT',
        body: JSON.stringify({ year: ym.year, month: ym.month, userId: controller.ctx.actingUserId || undefined, all, inhouse: ih })
      });
      try {
        if (!state.currentMonthDetail) state.currentMonthDetail = {};
        state.currentMonthDetail.monthSummary = { all, inhouse: ih };
      } catch (e) { /* silently ignored */ }
      try { controller.ctx.applySummaryTab?.(); } catch (e) { /* silently ignored */ }
      status('保存しました');
    };

    btn.addEventListener('click', () => {
      const hidden = wrap.hasAttribute('hidden');
      if (hidden) wrap.removeAttribute('hidden');
      else wrap.setAttribute('hidden', '');
      try { loadFromDetail(); } catch (e) { /* silently ignored */ }
    });
    wrap.querySelector('#btnSummaryLoad')?.addEventListener('click', () => { load().catch(e => status(String(e?.message || '読込失敗'))); });
    wrap.querySelector('#btnSummarySave')?.addEventListener('click', () => { save().catch(e => status(String(e?.message || '保存失敗'))); });
  };

  const bindTableHost = () => {
    const tableHost = controller.ctx.tableHost;
    if (!tableHost) return;
    if (tableHost.dataset.boundMonthlyHost === '1') return;
    tableHost.dataset.boundMonthlyHost = '1';
    const role = String(controller?.ctx?.profile?.role || '').toLowerCase();

    const ensurePaidLeaveRequest = async (row, dateStr) => {
      if (!row || !dateStr) return;
      if (role !== 'employee') return;
      if (row.dataset.paidLeaveRequested === '1') return;
      try {
        await core.fetchJSONAuth('/api/leave/paid', {
          method: 'POST',
          body: JSON.stringify({ startDate: dateStr, endDate: dateStr, reason: '' })
        });
        row.dataset.paidLeaveRequested = '1';
        try { root.Core?.showToast?.('有給申請を送信しました', 'success'); } catch (e) { /* silently ignored */ }
      } catch (err) {
        throw new Error(String(err?.message || '有給申請に失敗しました'));
      }
    };
    const cancelPaidLeaveRequest = async (row, dateStr) => {
      if (!row || !dateStr) return;
      if (role !== 'employee') return;
      try {
        await core.fetchJSONAuth('/api/leave/my/cancel-paid', {
          method: 'POST',
          body: JSON.stringify({ date: dateStr })
        });
        row.dataset.paidLeaveRequested = '';
      } catch (err) {
        throw new Error(String(err?.message || '有給申請の取消に失敗しました'));
      }
    };
    // 休暇系の区分（欠勤・半休(有給)・無給休暇 など）を選択した際に管理者へ通知する（通知のみ）。
    const LEAVE_KUBUN_NOTIFY = new Set(['半休(有給)', '半休（有給）', '半休', '欠勤', '無給休暇', '代替休日']);
    const notifyLeaveKubun = async (row, dateStr, kubun) => {
      if (!row || !dateStr || !kubun) return;
      if (role !== 'employee') return;
      if (!LEAVE_KUBUN_NOTIFY.has(kubun)) return;
      // 同一日・同一区分で二重通知を避ける
      if (row.dataset.kubunNotified === kubun) return;
      try {
        await core.fetchJSONAuth('/api/leave/notify-kubun', {
          method: 'POST',
          body: JSON.stringify({ date: dateStr, kubun })
        });
        row.dataset.kubunNotified = kubun;
      } catch (e) { /* silently ignored */ }
    };

    const applyHolidayLock = (row) => {
      if (!row) return;
      const sel = row.querySelector('select[data-field="classification"]');
      const v = String(sel?.value || '').trim();
      const dateStr = String(row.dataset.date || '').slice(0, 10);
      const dow = (() => {
        try { return core?.dowJa?.(dateStr) || ''; } catch (e) { return ''; }
      })();
      const offDay = String(row.dataset.baseOff || '') === '1';
      const plannedKubun = offDay ? '休日' : '出勤';
      const effective = v || plannedKubun;
      const isHoliday = effective === '休日' || effective === '代替休日' || effective === '無給休暇' || effective === '有給休暇' || effective === '欠勤';
      const ctrls = Array.from(row.querySelectorAll('input, select, textarea, button')).filter(el => !el.matches('select[data-field="classification"], button[data-action="history"], select[data-field="reason"], input[data-field="notes"]'));
      for (const el of ctrls) {
        if (isHoliday) {
          el.setAttribute('disabled', '');
          el.setAttribute('data-row-disabled', '1');
        } else {
          el.removeAttribute('data-row-disabled');
          // Always unlock break times so employees/managers can edit them
          if (el.matches('select[data-field="break"], select[data-field="nightBreak"], select[data-field="breakMin"], select[data-field="nightBreakMin"]')) {
            el.removeAttribute('disabled');
            el.removeAttribute('data-fixed-disabled'); // Ensure break times are never locked
          } else if (state.editableMonth) {
            // Mở khóa nếu không có data-fixed-disabled
            if (!el.hasAttribute('data-fixed-disabled')) {
              el.removeAttribute('disabled');
            } else if (el.matches('input.se-time[data-field="checkIn"], input.se-time[data-field="checkOut"]')) {
              // Ngoại lệ: Nếu là dòng phụ (không phải primary), thì checkIn và checkOut luôn được mở khóa
              if (String(row.dataset.primary || '') !== '1') {
                el.removeAttribute('disabled');
                el.removeAttribute('data-fixed-disabled');
              }
            }
          }
        }
      }
      
      // Khôi phục giờ nếu được đổi về ngày đi làm (kể cả khi chỉ là Dự kiến)
      if (!isHoliday) {
        row.dataset.holidayLocked = '';
        row.dataset.clear = ''; // QUAN TRỌNG: Phải xóa cờ clear để không bị xóa nhầm khi nhấn nút Lưu
        const inEl = row.querySelector('input.se-time[data-field="checkIn"]');
        const outEl = row.querySelector('input.se-time[data-field="checkOut"]');
        
        // Khôi phục Check-In
        if (inEl) {
          // Ưu tiên: 1. Backup từ thao tác tay -> 2. Giờ thực tế từ Server -> 3. Giờ trên ô nhập (nếu có) -> 4. Giờ tự động
          const inValToRestore = row.dataset.inBackup || row.dataset.actualIn || inEl.dataset.actual || inEl.dataset.autoVal || '';
          // Bắt buộc ghi đè lại giá trị để khôi phục
          inEl.value = inValToRestore;
          
          if (row.dataset.inBackup || row.dataset.actualIn || inEl.dataset.actual) {
            inEl.dataset.manual = '1';
            inEl.dataset.auto = '';
            inEl.classList.remove('is-auto');
          }
        }
        
        // Khôi phục Check-Out
        if (outEl) {
          const outValToRestore = row.dataset.outBackup || row.dataset.actualOut || outEl.dataset.actual || outEl.dataset.autoVal || '';
          outEl.value = outValToRestore;
          
          if (row.dataset.outBackup || row.dataset.actualOut || outEl.dataset.actual) {
            outEl.dataset.manual = '1';
            outEl.dataset.auto = '';
            outEl.classList.remove('is-auto');
          }
        }
        
        const loc = row.querySelector('[data-field="location"]');
        const memo = row.querySelector('[data-field="memo"]');
        const notes = row.querySelector('[data-field="notes"]');
        if (loc) {
          loc.value = row.dataset.locBackup || row.dataset.locationBase || loc.value || '';
          loc.style.visibility = 'visible';
        }
        if (memo) {
          memo.value = row.dataset.memoBackup || row.dataset.memoBase || memo.value || '';
          memo.style.visibility = 'visible';
        }
        if (notes) {
          row.dataset.holidayNotesBackup = notes.value;
          notes.value = row.dataset.notesBackup || row.dataset.notesBase || '';
          notes.style.visibility = 'visible';
        }
        
        const br = row.querySelector('select[data-field="break"]');
        const nb = row.querySelector('select[data-field="nightBreak"]');
        if (br) br.style.visibility = 'visible';
        if (nb) nb.style.visibility = 'visible';
        
        let wtRestored = row.dataset.workTypeBackup || row.dataset.workTypeBase || '';
        if (!wtRestored) wtRestored = 'onsite';
        
        row.dataset.workType = wtRestored;
        const ckOn = row.querySelector('input[data-field="ckOnsite"]');
        const ckRe = row.querySelector('input[data-field="ckRemote"]');
        const ckSa = row.querySelector('input[data-field="ckSatellite"]');
        if (ckOn) {
          ckOn.checked = (wtRestored === 'onsite');
          ckOn.style.visibility = 'visible';
        }
        if (ckRe) {
          ckRe.checked = (wtRestored === 'remote');
          ckRe.style.visibility = 'visible';
        }
        if (ckSa) {
          ckSa.checked = (wtRestored === 'satellite');
          ckSa.style.visibility = 'visible';
        }
        
        // Cập nhật lại UI sau khi khôi phục
        try {
          if (typeof _origRecomputeRow === 'function') {
            _origRecomputeRow(row);
          } else if (globalThis.MonthlyMonthlyRender && typeof globalThis.MonthlyMonthlyRender.recomputeRow === 'function') {
            globalThis.MonthlyMonthlyRender.recomputeRow(row);
          }
        } catch (e) { /* silently ignored */ }
      } else {
        // Nếu là ngày nghỉ thì clear giao diện để màn hình gọn gàng (nhưng đã backup ngầm ở trên)
        const ckOn = row.querySelector('input[data-field="ckOnsite"]');
        const ckRe = row.querySelector('input[data-field="ckRemote"]');
        const ckSa = row.querySelector('input[data-field="ckSatellite"]');
        
        const inEl = row.querySelector('input.se-time[data-field="checkIn"]');
        const outEl = row.querySelector('input.se-time[data-field="checkOut"]');
        const br = row.querySelector('select[data-field="break"]');
        const nb = row.querySelector('select[data-field="nightBreak"]');
        
        const loc = row.querySelector('[data-field="location"]');
        const memo = row.querySelector('[data-field="memo"]');
        const notes = row.querySelector('[data-field="notes"]');
        
        // Backup tất cả dữ liệu trước khi clear ONLY ONCE when entering holiday state
        if (row.dataset.holidayLocked !== '1') {
          if (inEl && inEl.value) row.dataset.inBackup = inEl.value;
          if (outEl && outEl.value) row.dataset.outBackup = outEl.value;
          if (loc && loc.value) row.dataset.locBackup = loc.value;
          if (memo && memo.value) row.dataset.memoBackup = memo.value;
          if (notes) row.dataset.notesBackup = notes.value;
          const currentWt = (ckOn?.checked ? 'onsite' : ckRe?.checked ? 'remote' : ckSa?.checked ? 'satellite' : row.dataset.workType || '');
          if (currentWt) row.dataset.workTypeBackup = currentWt;
          row.dataset.holidayLocked = '1';
          
          if (notes) {
            notes.value = row.dataset.holidayNotesBackup || '';
          }
        }
        
        if (ckOn) {
          ckOn.checked = false;
          ckOn.style.visibility = 'hidden';
        }
        if (ckRe) {
          ckRe.checked = false;
          ckRe.style.visibility = 'hidden';
        }
        if (ckSa) {
          ckSa.checked = false;
          ckSa.style.visibility = 'hidden';
        }
        
        // QUAN TRỌNG: KHÔNG ĐƯỢC XÓA TRẮNG VALUE CỦA CÁC Ô TEXT. CHỈ ĐƯỢC LÀM MỜ (DISABLED).
        // Nếu xóa trắng thì khi saveRowTimesNow chạy, nó sẽ gửi string rỗng lên server.
        // if (loc) loc.value = '';
        // if (memo) memo.value = '';
        // if (notes) notes.value = '';
        
        if (loc) {
          loc.style.visibility = 'hidden';
        }
        if (memo) {
          memo.style.visibility = 'hidden';
        }
        
        // Để làm ẩn text trên UI nhưng vẫn giữ value cho hàm Save, ta dùng CSS hoặc chỉ để trống lúc render.
        // Ở đây ta đã có logic render trả về string rỗng khi là ngày nghỉ, 
        // nhưng lúc đang thao tác (event) thì không nên xóa value của DOM.
        if (inEl) {
          inEl.value = '';
          inEl.dataset.autoVal = '';
        }
        if (outEl) {
          outEl.value = '';
          outEl.dataset.autoVal = '';
        }
        try { inEl?.classList?.remove('invalid'); } catch (e) { /* silently ignored */ }
        try { outEl?.classList?.remove('invalid'); } catch (e) { /* silently ignored */ }
        if (br) {
          br.value = '0:00';
          br.style.visibility = 'hidden';
        }
        if (nb) {
          nb.value = '0:00';
          nb.style.visibility = 'hidden';
        }
        
        const idRaw = String(row.dataset.id || '').trim();
        if (idRaw) {
          row.dataset.clear = '1';
        }
      }
    };

    const applyHolidayLockAll = () => {
      try {
        const _sh = document.querySelector('.kintai-main');
        const _st = _sh ? _sh.scrollTop : 0;
        const rows = Array.from(tableHost.querySelectorAll('[data-row="1"][data-date]'));
        for (const r of rows) applyHolidayLock(r);
        if (_sh && _sh.scrollTop !== _st) _sh.scrollTop = _st;
      } catch (e) { /* silently ignored */ }
    };

    applyHolidayLockAll();
    try {
      const obs = new MutationObserver((mutations) => {
        let hasNewRows = false;
        for (const m of mutations) {
          if (m.addedNodes) {
            for (let i = 0; i < m.addedNodes.length; i++) {
              const n = m.addedNodes[i];
              if (n.nodeName === 'TR' || n.nodeName === 'TBODY' || n.nodeName === 'TABLE') {
                hasNewRows = true;
                break;
              }
            }
          }
          if (hasNewRows) break;
        }
        if (hasNewRows) applyHolidayLockAll();
      });
      obs.observe(tableHost, { childList: true, subtree: true });
      tableHost._monthlyHolidayObs = obs;
    } catch (e) { /* silently ignored */ }

    tableHost.addEventListener('change', async (e) => {
      const row = e.target?.closest?.('[data-row="1"][data-date]');
      if (row) { 
        if (!state.editableMonth) return;
        // Preserve scroll position to prevent page jumping during DOM mutations
        const scrollHost = document.querySelector('.kintai-main');
        const savedScrollTop = scrollHost ? scrollHost.scrollTop : 0;
        const savedScrollLeft = scrollHost ? scrollHost.scrollLeft : 0;
        const savedWinY = window.scrollY;
        const savedWinX = window.scrollX;
        const restoreScroll = () => {
          if (scrollHost) {
            if (scrollHost.scrollTop !== savedScrollTop) scrollHost.scrollTop = savedScrollTop;
            if (scrollHost.scrollLeft !== savedScrollLeft) scrollHost.scrollLeft = savedScrollLeft;
          }
          if (window.scrollY !== savedWinY) window.scrollTo(savedWinX, savedWinY);
        };
        try { row.dataset.dirty = '1'; } catch (e) { /* silently ignored */ } 
        
        const kubunSel = e.target?.closest?.('select[data-field="classification"]');
        const timeEl = e.target?.closest?.('input.se-time[data-field="checkIn"], input.se-time[data-field="checkOut"]');
        const otherEl = e.target?.closest?.('select[data-field], input[type="text"][data-field], textarea[data-field]');
        
        const brInput = row.querySelector('select[data-field="break"], select[data-field="breakMin"]');
      const nbInput = row.querySelector('select[data-field="nightBreak"], select[data-field="nightBreakMin"]');
      
      // Always mark break time as manual when user explicitly selects a new value.
      if (e.target === brInput || e.target === nbInput) {
        e.target.dataset.manual = '1';
        e.target.dataset.auto = '0';
        e.target.classList.remove('is-auto');
        
        // Update UI immediately but prevent scroll jump
        const scrollHostBr = document.querySelector('.kintai-main');
        const stBr = scrollHostBr ? scrollHostBr.scrollTop : 0;
        const slBr = scrollHostBr ? scrollHostBr.scrollLeft : 0;
        if (typeof _origRecomputeRow === 'function') {
          _origRecomputeRow(row);
        } else if (globalThis.MonthlyMonthlyRender && typeof globalThis.MonthlyMonthlyRender.recomputeRow === 'function') {
          globalThis.MonthlyMonthlyRender.recomputeRow(row);
        }
        if (scrollHostBr) {
          scrollHostBr.scrollTop = stBr;
          scrollHostBr.scrollLeft = slBr;
        }
        return; // Skip the rest of the logic
      }

        if (kubunSel || timeEl || otherEl) {
          if (timeEl) {
            const val = String(timeEl.value || '').trim();
            timeEl.dataset.prev = val;
            timeEl.dataset.auto = '';
            timeEl.dataset.autoVal = '';
            timeEl.dataset.manual = '1';
            timeEl.classList.remove('is-auto');

            const tIn = row.querySelector('input.se-time[data-field="checkIn"]')?.value;
            const tOut = row.querySelector('input.se-time[data-field="checkOut"]')?.value;
            if (tIn || tOut) {
              const sel = row.querySelector('.kubun-sel');
              if (sel) {
                let k = sel.value || '';
                if (!k || k.includes('予定') || k === '出勤' || k === '休日出勤') {
                  // Only update kubun if it's currently a placeholder/planned value
                  // Use logic similar to what backend would assign
                  // Theo lịch nghỉ của bộ phận (data-base-off do backend tính từ 休日設定), không dựa vào
                  // màu Thứ 7/CN: vd 工事部 đi làm Thứ 7 (trừ tuần 4) là 出勤, không phải 休日出勤.
                  const isBaseOff = String(row.dataset.baseOff || '') === '1';
                  if (isBaseOff) {
                    k = '休日出勤';
                  } else {
                    k = '出勤';
                  }
                  
                  // Luôn luôn gán giá trị và gọi trigger change để UI cập nhật
                  _setBlockRecalc(row);
                  
                  // Keep track of original break values so they don't get lost during change event
                  const brSel = row.querySelector('select[data-field="break"]');
                  const origBrVal = brSel ? brSel.value : null;
                  
                  sel.value = k;
                  try { sel.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) { /* silently ignored */ }
                  
                  // Restore break value if it was wiped by any generic handler
                  if (brSel && origBrVal !== null && brSel.value !== origBrVal) {
                    brSel.value = origBrVal;
                  }
                  
                  // Also ensure break time doesn't get auto-overwritten by recomputeRow
                  if (brSel && origBrVal !== null) {
                    brSel.dataset.auto = '0';
                    brSel.dataset.manual = '1';
                  }
                  
                  _clearBlockRecalc(row);
                  
                  row.dataset.kubunConfirmed = '1';
                  applyHolidayLock(row);
                }
              }
            }
          }
          
          if (kubunSel) {
            const v = String(kubunSel.value || '').trim();
            row.dataset.kubunConfirmed = v ? '1' : '';
            applyHolidayLock(row);
            restoreScroll();
            if (v === '有給休暇') {
              const dateStr = String(row.dataset.date || '').slice(0, 10);
              if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                try {
                  await ensurePaidLeaveRequest(row, dateStr);
                } catch (err) {
                  alert(String(err?.message || '有給申請に失敗しました'));
                }
              }
            } else {
              const dateStr = String(row.dataset.date || '').slice(0, 10);
              if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                // 有給以外へ変更した場合は有給申請を取消
                try {
                  await cancelPaidLeaveRequest(row, dateStr);
                } catch (err) {
                  alert(String(err?.message || '有給申請の取消に失敗しました'));
                }
                // 休暇系の区分（欠勤・半休(有給)・無給休暇 など）なら管理者へ通知
                await notifyLeaveKubun(row, dateStr, v);
              }
            }
          }
          
          // Không tự động lưu - người dùng sẽ bấm nút 保存 để lưu
          render.recomputeRow(row);
          restoreScroll();
        }
      }
      try { draft?.schedule?.(controller.ctx, controller.ctx?.picker?.value || controller.ctx?.initialYM); } catch (e) { /* silently ignored */ }
    });
    
    tableHost.addEventListener('input', (e) => {
      const row = e.target?.closest?.('[data-row="1"][data-date]');
      if (row) { 
        if (!state.editableMonth) return;
        try { row.dataset.dirty = '1'; } catch (e) { /* silently ignored */ } 
        
        // Mark manual on input to prevent recomputeRow from overwriting during the input event
        if (e.target.matches('select[data-field="break"], select[data-field="nightBreak"]')) {
          e.target.dataset.manual = '1';
          e.target.dataset.auto = '0';
          e.target.classList.remove('is-auto');
        }

        // Khi người dùng đang nhập, xóa ngay trạng thái tự động để đổi màu sắc (UX)
        const timeEl = e.target?.closest?.('input.se-time[data-field="checkIn"], input.se-time[data-field="checkOut"]');
        if (timeEl) {
          // Store prev value for validation rollback
          if (!timeEl.dataset.prev) timeEl.dataset.prev = timeEl.value;
          
          timeEl.dataset.auto = '';
          timeEl.dataset.autoVal = '';
          timeEl.dataset.manual = '1';
          timeEl.classList.remove('is-auto');
          
          if (String(timeEl.value || '').trim() !== '') {
            row.dataset.clear = '';
          }
        }
        // Giảm chớp: Không gọi recomputeRow liên tục khi đang gõ text
        const tag = (e.target?.tagName || '').toLowerCase();
        const type = (e.target?.type || '').toLowerCase();
        const isTextInput = tag === 'textarea' || (tag === 'input' && type === 'text');
        const isSelect = tag === 'select';
        if (!isTextInput && !isSelect) {
          render.recomputeRow(row);
        }
      }
      // Giảm chớp: Không renderSummary liên tục khi đang nhập liệu
      // try { 
      //   if (root.SectionsRender && root.SectionsRender.renderSummary) {
      //     root.SectionsRender.renderSummary(document.querySelector('#monthSummaryTable') || document.querySelector('#monthSummary'), state.currentMonthDetail, state.currentMonthTimesheet);
      //   }
      // } catch (err) { /* silently ignored */ }
      try { draft?.schedule?.(controller.ctx, controller.ctx?.picker?.value || controller.ctx?.initialYM); } catch (e) { /* silently ignored */ }
      try { controller.scheduleAutoSave(); } catch (e) { /* silently ignored */ }
    });
    tableHost.addEventListener('focusin', (e) => {
      const el = e.target?.closest?.('input.se-time[data-field="checkIn"], input.se-time[data-field="checkOut"]');
      if (!el) return;
    });
    // Prevent scroll jump when clicking on select dropdowns
    tableHost.addEventListener('mousedown', (e) => {
      const sel = e.target?.closest?.('select');
      if (!sel) return;
      const sh = document.querySelector('.kintai-main');
      if (!sh) return;
      const st = sh.scrollTop;
      const sl = sh.scrollLeft;
      requestAnimationFrame(() => {
        if (sh.scrollTop !== st) sh.scrollTop = st;
        if (sh.scrollLeft !== sl) sh.scrollLeft = sl;
      });
    });
    tableHost.addEventListener('click', async (e) => {
      const dateCell = e.target?.closest?.('td.sticky-col-1');
      if (dateCell) {
        const tr = dateCell.closest?.('[data-row="1"][data-date]');
        if (!tr) return;
        if (role !== 'employee') return;
        if (!state.editableMonth) {
          alert('この月は入力できません。');
          return;
        }
        const dateStr = String(tr.dataset.date || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return;
        const clsSel = tr.querySelector('select[data-field="classification"]');
        if (!clsSel) return;
        const offDay = String(tr.dataset.baseOff || '') === '1';
        if (offDay) {
          alert('休日には有給申請できません。');
          return;
        }
        if (!confirm(`${dateStr} を有給休暇として申請しますか？`)) return;
        try {
          await ensurePaidLeaveRequest(tr, dateStr);
          clsSel.value = '有給休暇';
          try { tr.dataset.kubunConfirmed = '1'; } catch (e) { /* silently ignored */ }
          try { applyHolidayLock(tr); } catch (e) { /* silently ignored */ }
          try { render.recomputeRow(tr); } catch (e) { /* silently ignored */ }
          try { await controller.saveRowTimesNow(tr); } catch (e) { /* silently ignored */ }
        } catch (err) {
          alert(String(err?.message || '有給申請に失敗しました'));
        }
        return;
      }
      const ck = e.target?.closest?.('input.se-check[data-field]');
      if (ck) {
        if (!state.editableMonth) { e.preventDefault(); alert('この月は入力できません。'); return; }
        const tr = ck.closest?.('[data-row="1"][data-date]');
        if (!tr) return;
        if (ck.hasAttribute('disabled')) return;
        try { tr.dataset.dirty = '1'; } catch (e) { /* silently ignored */ }
        const field = String(ck.getAttribute('data-field') || '');
        const ckOn = tr.querySelector('input[data-field="ckOnsite"]');
        const ckRe = tr.querySelector('input[data-field="ckRemote"]');
        const ckSa = tr.querySelector('input[data-field="ckSatellite"]');
        if (ck.checked) {
          if (field !== 'ckOnsite' && ckOn) ckOn.checked = false;
          if (field !== 'ckRemote' && ckRe) ckRe.checked = false;
          if (field !== 'ckSatellite' && ckSa) ckSa.checked = false;
        }
        // Hide/show 現場(任意) field: only visible when 現場 is checked.
        // 入力済みの値はここで消さない — 出社/在宅と切り替えてから再度「現場」を
        // 選び直したときに、前に入力した現場名が消えてしまう不具合があったため。
        const locInput = tr.querySelector('input[data-field="location"]');
        if (locInput) {
          const isSatellite = ckSa && ckSa.checked;
          locInput.style.visibility = isSatellite ? 'visible' : 'hidden';
        }
          if (e.target.dataset.field === 'classification') {
            const val = e.target.value;
            e.target.classList.toggle('is-holiday', val === '休日' || val === '代替休日');
            e.target.classList.toggle('is-absence', val === '欠勤');
            e.target.classList.toggle('is-planned', !val);
          }
          recomputeRow(tr);
        try { draft?.schedule?.(controller.ctx, controller.ctx?.picker?.value || controller.ctx?.initialYM); } catch (e) { /* silently ignored */ }
        try { controller.scheduleAutoSave(); } catch (e) { /* silently ignored */ }
        return;
      }
      const btn = e.target?.closest?.('button[data-action]');
      if (!btn) return;
      const tr = btn.closest?.('[data-row="1"][data-date]');
      if (!tr) return;
      const action = String(btn.dataset.action || '');
      const dateStr = String(tr.dataset.date || '');
      if (action === 'add') {
        e.preventDefault();
        try { await controller.addSegmentRow(dateStr); } catch (e) { console.error(e); }
        return;
      }
      if (action === 'clear') {
        const idRaw = String(tr.dataset.id || '').trim();
        const msg = idRaw ? 'この行を削除（またはクリア）しますか？' : 'この行の入力内容をクリアしますか？';
        if (confirm(msg)) {
          // Reset manual flags when clearing
          tr.querySelectorAll('input.se-time').forEach(el => {
            el.dataset.manual = '';
          });
          try { await controller.clearRow(tr); } catch (e) { /* silently ignored */ }
          try { draft?.schedule?.(controller.ctx, controller.ctx?.picker?.value || controller.ctx?.initialYM); } catch (e) { /* silently ignored */ }
        }
        return;
      }
      if (action === 'history') {
        controller.tableHistory(dateStr);
      }
      if (action === 'clear-checkout') {
        e.preventDefault();
        try { await controller.clearCheckOut(tr); } catch (e) { console.error(e); }
        return;
      }
    });
  };

  const bindPdfModal = () => {
    const btnOpen = document.querySelector('#btnExportWeek');
    const modal = document.querySelector('#employmentNoticeModal');
    const btnClose = document.querySelector('#btnEnmClose');
    const btnCloseBottom = document.querySelector('#btnEnmCloseBottom');
    const backdrop = document.querySelector('#enmBackdrop');
    const btnPrint = document.querySelector('#btnEnmPrint');

    if (!btnOpen || !modal) return;

    // Enable the button since we have the feature now
    btnOpen.removeAttribute('disabled');

    const closeModal = () => {
      modal.setAttribute('hidden', '');
    };

    // Dữ liệu 現場 + 作業内容 của tháng đang xem — dựng lại mỗi lần openModal,
    // dùng cho PDF riêng "現場・作業内容出力".
    let enmSiteWorkRows = [];

    // Cache map ngày lễ Nhật (祝日) theo năm: { 'YYYY-MM-DD': '元日', ... }
    // Dùng để hiển thị TÊN ngày lễ ở cột 事由 cho các ngày đỏ.
    const holidayNameCache = {}; // year -> { dateStr: name }
    const loadHolidayNames = async (year) => {
      if (holidayNameCache[year]) return holidayNameCache[year];
      const map = {};
      try {
        const r = await core.fetchJSONAuth(`/api/attendance/calendar?year=${encodeURIComponent(year)}&lang=ja`);
        const detail = Array.isArray(r?.detail) ? r.detail : [];
        // Chỉ lấy các loại là ngày lễ (祝日 / nghỉ công ty), bỏ qua thứ 7/CN thường.
        const holidayTypes = new Set(['jp_auto', 'jp_substitute', 'jp_bridge', 'fixed', 'custom']);
        for (const it of detail) {
          const ds = String(it?.date || '').slice(0, 10);
          const nm = it?.name || it?.label || '';
          if (ds && nm && holidayTypes.has(String(it?.type || ''))) {
            // Tên có thể ở dạng "山の日 振替休日 / Substitute..." → lấy phần trước dấu "/".
            map[ds] = String(nm).split('/')[0].trim();
          }
        }
      } catch (e) { /* không có mạng/không lấy được thì bỏ qua, cột 事由 để trống */ }
      holidayNameCache[year] = map;
      return map;
    };

    const openModal = async (show = true) => {
      // Get current date
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      const enmDateEl = document.querySelector('#enmDate');
      if (enmDateEl) enmDateEl.textContent = `${yyyy}年${mm}月${dd}日`;

      // Dòng tiêu đề: 年 月 ・ 名前 (kiểu mẫu hành chính)
      const targetMonthStr = document.querySelector('#monthPicker')?.value || '';
      const ymEl = document.querySelector('#enmYmLine');
      if (ymEl && targetMonthStr) {
        const [year, month] = targetMonthStr.split('-');
        ymEl.textContent = `${year}年　${parseInt(month, 10)}月`;
      }
      const nameEl = document.querySelector('#enmNameLine');
      if (nameEl) {
        nameEl.textContent = (document.querySelector('#staffName')?.textContent || '').trim() || '';
      }

      // Build daily table rows AND calculate summary dynamically based ONLY on actual records up to today
      const dailyTbody = document.querySelector('#enmDailyTable tbody');
      let totalWorkDays = 0;

      // Ensure we get the latest timesheet
      const timesheetData = state.currentMonthTimesheet || {};
      const days = Array.isArray(timesheetData.days) ? timesheetData.days : [];
      const totals = timesheetData.totals || {};

      // Tải tên ngày lễ (祝日) của năm tương ứng để điền vào cột 事由.
      const targetYear = parseInt((targetMonthStr || '').slice(0, 4), 10) || today.getFullYear();
      const holidayNames = await loadHolidayNames(targetYear);
      
      const parseHmToMin = (hmStr) => {
        if (!hmStr) return 0;
        const parts = String(hmStr).trim().split(':');
        if (parts.length !== 2) return 0;
        return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
      };
      // Escape HTML + xuống dòng → <br> (dùng cho 現場名 / 備考)
      const escHtmlEnm = (s) => String(s || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
      // 作業内容: nối các dòng bằng ・ thay vì xuống dòng → đoạn liền, tiết kiệm chiều cao, dễ ép 1 trang.
      // Thêm WORD JOINER (\u2060) ngay sau mỗi ・ để dấu ・ luôn dính với chữ đứng sau,
      // không bị trơ ở cuối dòng rồi chữ nhảy xuống dòng mới.
      const formatWorkContent = (s) => {
        const raw = String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const joined = raw
          .split(/\r?\n/)
          .map(line => line.trim().replace(/^[・･]+/, '').replace(/[・･]+$/, '').trim()) // bỏ ・ thừa ở đầu/cuối mỗi dòng
          .filter(line => line.length > 0)
          .join('・\u2060');
        // Gộp mọi cụm ・ liên tiếp (kể cả do nhân viên tự nhập) thành 1 dấu ・.
        return joined.replace(/[・･](?:\u2060?[・･])+/g, '・\u2060');
      };
      
      if (dailyTbody) {
        dailyTbody.innerHTML = '';
        enmSiteWorkRows = []; // reset dữ liệu 現場+作業内容 cho tháng đang dựng
        const rows = document.querySelectorAll('#monthTableReal tbody tr[data-date]');
        
        // Lấy ngày hiện tại để xác định "quá khứ" và "tương lai"
        const currentYmd = new Date().toLocaleDateString('sv-SE'); // "YYYY-MM-DD"
        
        rows.forEach(tr => {
          const dateStr = tr.dataset.date || ''; // "YYYY-MM-DD"
          let dayDisplay = '';
          if (dateStr) {
            const d = parseInt(dateStr.slice(8, 10), 10);
            const dow = ['日', '月', '火', '水', '木', '金', '土'][new Date(dateStr).getDay()];
            // Số ngày + thứ, KHÔNG lặp tháng (tiêu đề phía trên đã có 年月 rồi)
            dayDisplay = `${d} ${dow}`;
          }
          
          const isFuture = dateStr > currentYmd;
          
          // Lấy dữ liệu timesheet chuẩn từ server nếu có
          const tsDay = days.find(d => d.date && d.date.slice(0, 10) === dateStr);
          
          // Trích xuất các trường từ UI
          const selKubun = tr.querySelector('select[data-field="classification"]');
          let kubun = selKubun ? selKubun.value : '';
          
          const inEl = tr.querySelector('input[data-field="checkIn"]');
          const outEl = tr.querySelector('input[data-field="checkOut"]');
          // Update the detection logic to check for the 'is-auto' class since dataset.actual is not reliable here
          const hasActualIn = inEl && inEl.value && !inEl.classList.contains('is-auto');
          const hasActualOut = outEl && outEl.value && !outEl.classList.contains('is-auto');
          let inHm = inEl ? inEl.value : '';
          let outHm = outEl ? outEl.value : '';
          
          // Apply rounding if 丸め mode selected
          const enmMode = document.querySelector('#enmRoundMode')?.value || 'actual';
          if (enmMode === 'round' && hasActualIn && hasActualOut && inHm && outHm) {
            const rStep = 30;
            const shiftStartStr = tr.dataset.shiftStart || '08:00';
            const shiftEndStr = tr.dataset.shiftEnd || '17:00';
            const hmToMin = (hm) => { const p = String(hm||'').split(':'); return parseInt(p[0],10)*60+parseInt(p[1],10); };
            const minToHm = (m) => `${String(Math.floor(m/60)%24).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
            const shiftStartMin = hmToMin(shiftStartStr);
            const shiftEndMin = hmToMin(shiftEndStr);
            // Clock-in: round UP to nearest 30 minutes (do not clamp to shift start)
            // e.g. 07:17 -> 07:30, 07:31 -> 08:00, 06:59 -> 07:00
            const rawInMin = hmToMin(inHm);
            const rInMin2 = Math.ceil(rawInMin / rStep) * rStep;
            inHm = minToHm(rInMin2);
            // Clock-out: always round DOWN to 30 minutes — same as 給与 (attendance.rules.js, 会社の丸めルール).
            const rawOutMin = hmToMin(outHm);
            if (rawOutMin > shiftEndMin) {
              const otRaw = rawOutMin - shiftEndMin;
              const otRounded = Math.floor(otRaw / rStep) * rStep;
              outHm = minToHm(shiftEndMin + otRounded);
            } else {
              outHm = minToHm(Math.max(shiftStartMin, Math.floor(rawOutMin / rStep) * rStep));
            }
          }

          const formatHm = (min) => {
            if (min == null) return '0:00';
            const m = Math.max(0, Number(min || 0));
            const h = Math.floor(m / 60);
            const r = Math.floor(m % 60);
            if (h === 0 && r === 0) return '0:00';
            return `${h}:${String(r).padStart(2, '0')}`;
          };

          let timeIn = inHm;
          let timeOut = outHm;
          let breakNormal = '0:00';
          const breakSel = tr.querySelector('select[data-field="break"]');
          if (breakSel) {
             breakNormal = breakSel.value || '0:00';
          }
          
          let breakNight = '0:00';
          const nightBreakSel = tr.querySelector('select[data-field="nightBreak"]'); // Changed from nightBreakMinutes to nightBreak
          if (nightBreakSel) {
             const val = nightBreakSel.value;
             if (val === '60' || val === '1:00') breakNight = '1:00';
             else if (val === '30' || val === '0:30') breakNight = '0:30';
             else breakNight = '0:00';
          }
          let workedTime = '0:00';
          let excessTime = '0:00';
          
          let isOnsite = tr.querySelector('input[data-field="ckOnsite"]')?.checked ? '〇' : '';
          let isRemote = tr.querySelector('input[data-field="ckRemote"]')?.checked ? '〇' : '';
          let isTravel = tr.querySelector('input[data-field="ckSatellite"]')?.checked ? '〇' : '';
          // Tên hiện trường (現場名) khi làm tại 現場
          const locEl = tr.querySelector('input[data-field="location"]');
          const locName = locEl ? String(locEl.value || '').trim() : '';
          
          const notesEl = tr.querySelector('input[data-field="notes"]');
          let notes = notesEl ? notesEl.value : '';
          // 作業内容 (memo) — lấy để in ra bảng 就業状況通知書
          const memoEl = tr.querySelector('[data-field="memo"]');
          let workContent = memoEl ? String(memoEl.value || '') : '';

          let dayWorkMins = 0;
          let dayOvertimeMins = 0;
          let dayNightMins = 0;
          
          if (tsDay) {
            // Lấy thẳng số phút từ server tính toán chuẩn xác
            dayWorkMins = tsDay.regularMinutes || 0;
            dayOvertimeMins = tsDay.overtimeMinutes || 0;
            dayNightMins = tsDay.nightMinutes || 0;
            
            workedTime = formatHm(dayWorkMins);
            excessTime = formatHm(dayOvertimeMins);
          } else if (inHm && outHm && !isFuture) {
            // Fallback nếu không có dữ liệu từ server (chỉ để dự phòng)
            let start = parseHmToMin(inHm);
            let end = parseHmToMin(outHm);
            if (end < start) end += 24 * 60; // Làm qua ngày hôm sau
            
            let nightWork = 0;
            const nightRanges = [[0, 300], [1320, 1740], [2760, 3180]]; // 0:00-5:00, 22:00-29:00
            for (const [rStart, rEnd] of nightRanges) {
                const overlapStart = Math.max(start, rStart);
                const overlapEnd = Math.min(end, rEnd);
                if (overlapStart < overlapEnd) nightWork += (overlapEnd - overlapStart);
            }
            const nightBreakMins = parseHmToMin(breakNight);
            dayNightMins = Math.max(0, nightWork - nightBreakMins);
          }
          
          // Logic 予定 và Ẩn giờ nếu chưa làm:
          const isPlanned = tr.classList.contains('planned');
          const isHolidayKubun = kubun === '休日' || kubun === '代替休日';
          const isLeaveKubun = kubun === '有給休暇' || kubun === '無給休暇' || kubun === '欠勤';
          
          // Xóa từng ô giờ nếu chưa có dữ liệu thực tế
          if (!hasActualIn) timeIn = '';
          if (!hasActualOut) timeOut = '';

          // Nếu chưa hoàn thành ca (chưa in hoặc chưa out), xóa các giờ tính toán
          if (!hasActualIn || !hasActualOut) {
             breakNormal = '';
             breakNight = '';
             workedTime = '';
             excessTime = '';
             dayWorkMins = 0;
             dayOvertimeMins = 0;
             dayNightMins = 0;
          }

          if (!hasActualIn && !hasActualOut) {
             if (isFuture || isPlanned) {
                if (!kubun || kubun === '出勤') kubun = '予定';
             }
             // Xóa cả địa điểm nếu là ngày chưa làm
             isOnsite = '';
             isRemote = '';
             isTravel = '';
          } else if (hasActualIn && hasActualOut) {
             // Calculate work time
             if (enmMode === 'round') {
               // Use rounded times to calculate
               const hmToMin2 = (hm) => { const p = String(hm||'').split(':'); return parseInt(p[0],10)*60+parseInt(p[1],10); };
               const brMin = parseHmToMin(breakNormal);
               let startM = hmToMin2(inHm);
               let endM = hmToMin2(outHm);
               if (endM < startM) endM += 24 * 60;
               const totalMins = Math.max(0, (endM - startM) - brMin);
               workedTime = formatHm(totalMins);
               dayWorkMins = totalMins;
               const shiftStartStr = tr.dataset.shiftStart || '08:00';
               const shiftEndStr = tr.dataset.shiftEnd || '17:00';
               const scheduled = Math.max(0, hmToMin2(shiftEndStr) - hmToMin2(shiftStartStr) - brMin);
               dayOvertimeMins = Math.max(0, totalMins - scheduled);
               excessTime = formatHm(dayOvertimeMins);
             } else {
               const workedCell = tr.querySelector('td[data-field="worked"]');
               const excessCell = tr.querySelector('td[data-field="excess"]');
               if (workedCell) {
                   workedTime = workedCell.textContent.trim();
                   dayWorkMins = parseHmToMin(workedTime);
               }
               if (excessCell) {
                   excessTime = excessCell.textContent.trim();
                   dayOvertimeMins = parseHmToMin(excessTime);
               }
             }
          }
          
          // Đảm bảo xóa vòng tròn "Nơi làm việc" (出社/在宅/出張) nếu là các ngày nghỉ/phép
          if (isHolidayKubun || isLeaveKubun || kubun === '予定') {
             isOnsite = '';
             isRemote = '';
             isTravel = '';
          }

          // 現場: nếu nhân viên có nhập tên hiện trường (location) thì ưu tiên hiển thị
          // tên đó — kể cả khi đánh dấu 出社/在宅. Không có tên mới hiện 現場/出社/在宅.
          // Ngày nghỉ/phép/予定 không hiển thị nơi làm (isOnsite/... đã bị reset ở trên).
          const isWorkContext = isOnsite || isRemote || isTravel;
          let placeCol = '';
          if (locName && isWorkContext) placeCol = escHtmlEnm(locName);
          else if (isTravel) placeCol = '現場';
          else if (isOnsite) placeCol = '出社';
          else if (isRemote) placeCol = '在宅';

          // Đếm số ngày đi làm thực tế (có giờ vào/ra, không phải nghỉ/phép/kế hoạch)
          if ((hasActualIn || hasActualOut) && !isHolidayKubun && !isLeaveKubun && kubun !== '予定') {
            totalWorkDays++;
          }

          // 中抜け時間: tổng thời gian đi ra giữa giờ (外出) trong ngày. Chỉ hiển thị
          // khi có dữ liệu thật (> 0), ngược lại để TRỐNG (không in 0:00).
          let nakanukeMins = 0;
          if (tsDay && Array.isArray(tsDay.goOutRecords)) {
            for (const g of tsDay.goOutRecords) {
              const go = g && g.go_out_time ? new Date(g.go_out_time).getTime() : NaN;
              const ret = g && g.return_time ? new Date(g.return_time).getTime() : NaN;
              if (!isNaN(go) && !isNaN(ret) && ret > go) {
                nakanukeMins += Math.round((ret - go) / 60000);
              }
            }
          }
          // Fallback: nếu server có sẵn số phút 中抜け ở trường riêng thì dùng.
          if (!nakanukeMins && tsDay) {
            nakanukeMins = tsDay.nakanukeMinutes || tsDay.outsideMinutes || 0;
          }
          const nakanukeTime = nakanukeMins > 0 ? formatHm(nakanukeMins) : '';

          // ── Ngày nghỉ: căn cứ theo LỊCH LÀM VIỆC của từng người (class 'off' trên
          //    hàng gốc = ngày nghỉ theo lịch, gồm CN + ngày nghỉ; thứ 7 làm việc của
          //    bộ phận như 工事部 KHÔNG có class 'off' nên sẽ không bị coi là nghỉ),
          //    hoặc theo phân loại nghỉ/phép (休日/代替休日/有給...).
          //    Ngày nghỉ → bỏ chữ 予定 ở cột 事由 và tô nền xám cả hàng.
          const isScheduledOff = tr.classList.contains('off');
          const hasNoActual = !hasActualIn && !hasActualOut;
          // Chỉ tô xám khi thực sự NGHỈ (không có giờ làm thực tế). Nếu nhân viên đi
          // làm vào ngày nghỉ/lịch nghỉ thì vẫn tính là ngày làm → không tô xám.
          const isRestRow = hasNoActual && (isHolidayKubun || isLeaveKubun || isScheduledOff);
          if (isRestRow && kubun === '予定') {
            kubun = ''; // ngày nghỉ không cần hiển thị 予定
          }
          // Ngày lễ (lịch đỏ): hiển thị TÊN ngày lễ ở cột 事由 (元日, 海の日...).
          // Chỉ điền khi ô đang trống hoặc chỉ là 休日 chung, để không đè phép cụ thể.
          const holidayName = holidayNames[dateStr] || '';
          if (isRestRow && holidayName && (kubun === '' || kubun === '休日')) {
            kubun = holidayName;
          }
          const rowClass = isRestRow ? ' class="enm-rest-row"' : '';

          // 中抜け時間: ngày nghỉ/lịch đỏ → để TRỐNG. Ngày làm mà không có số →
          // hiển thị 0:00.
          const nakanukeDisplay = isRestRow ? '' : (nakanukeTime || '0:00');

          const html = `
            <tr${rowClass}>
              <td>${dayDisplay}</td>
              <td class="enm-reason">${kubun}</td>
              <td class="enm-mark">${isOnsite}</td>
              <td class="enm-mark">${isRemote}</td>
              <td class="enm-mark">${isTravel}</td>
              <td>${timeIn}</td>
              <td>${timeOut}</td>
              <td>${breakNormal}</td>
              <td>${breakNight}</td>
              <td>${nakanukeDisplay}</td>
              <td>${workedTime}</td>
              <td>${excessTime}</td>
              <td class="left-align enm-note">${escHtmlEnm(notes)}</td>
            </tr>
          `;
          dailyTbody.insertAdjacentHTML('beforeend', html);

          // Lưu dữ liệu 現場 + 作業内容 cho PDF riêng (nút 現場・作業内容出力).
          // placeCol = tên hiện trường/出社/在宅/現場; workContent = nội dung công việc.
          enmSiteWorkRows.push({
            day: dayDisplay,
            rest: isRestRow,
            site: placeCol,               // đã là HTML an toàn (escHtmlEnm ở trên)
            work: formatWorkContent(workContent),
          });
        });
      }
      
      // 合計日数: tổng số ngày đi làm thực tế trong tháng
      const totalDaysEl = document.querySelector('#enmTotalDays');
      if (totalDaysEl) totalDaysEl.textContent = `${totalWorkDays}日`;

      if (show) modal.removeAttribute('hidden');
    };

    // ── Bấm nút 就業状況通知書出力 ──
    //  • Desktop: mở hộp thoại in (chữ chuẩn) → chọn PDF に保存.
    //  • Điện thoại: sinh file PDF và TẢI VỀ máy (vì mobile chặn tự động in).
    // Điện thoại/tablet: in từ iframe ẩn KHÔNG đáng tin (nhiều trình duyệt in
    // nhầm trang cha hoặc không in) → phải mở CỬA SỔ THẬT rồi in. Desktop thì
    // in iframe ẩn cho gọn.
    const isMobileDevice = () =>
      /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(navigator.userAgent)
      || (navigator.maxTouchPoints > 1 && !/Windows NT/i.test(navigator.userAgent));

    // Mở CỬA SỔ MỚI chứa ĐÚNG HTML in (giống hệt desktop) rồi in. Dùng cho mobile.
    const printInNewWindow = (html) => {
      const w = window.open('', '_blank');
      if (!w) { alert('ポップアップがブロックされました。許可してください。'); return false; }
      w.document.open();
      w.document.write(html);
      // Tự động gọi in sau khi trang (và font) tải xong bên trong cửa sổ mới.
      w.document.write(`<script>
        (function(){
          function go(){ try{ window.focus(); window.print(); }catch(e){} }
          var fr = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
          Promise.race([ fr.then(function(){return new Promise(function(r){setTimeout(r,300);});}),
                         new Promise(function(r){setTimeout(r,1200);}) ]).then(go).catch(go);
        })();
      <\/script>`);
      w.document.close();
      return true;
    };

    const exportPdf = async () => {
      await openModal(false);                    // build nội dung (không hiện modal)
      const iframe = await renderPrintIframe();   // iframe khổ giấy CỐ ĐỊNH (đẹp, giống nhau mọi máy)

      // IN CÙNG MỘT IFRAME trên MỌI thiết bị → PDF trên điện thoại GIỐNG HỆT desktop
      // (cùng iframe kích thước mm cố định, không bị viewport điện thoại co giãn).
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch (e) {
        // Dự phòng cực hiếm: nếu trình duyệt chặn in iframe → mở cửa sổ thật.
        if (iframe._printHtml) printInNewWindow(iframe._printHtml);
      }
    };

    btnOpen.addEventListener('click', (e) => {
      e.preventDefault();
      exportPdf();
    });

    // ── Nút 現場・作業内容出力: PDF riêng chỉ gồm 日 / 現場 / 作業内容 ──
    const btnSites = document.querySelector('#btnExportSites');
    if (btnSites) {
      btnSites.removeAttribute('disabled');

      const renderSitesIframe = () => new Promise((resolve) => {
        // Khổ giấy: dùng chung lựa chọn với bảng chính.
        const paperVal = document.querySelector('#enmPaperSize')?.value || 'A4-portrait';
        const [paperName, paperOrient] = paperVal.split('-');
        const PAPER_MM = { A4: { w: 210, h: 297 }, A3: { w: 297, h: 420 } };
        const base = PAPER_MM[paperName] || PAPER_MM.A4;
        const isLandscape = paperOrient === 'landscape';
        const pageWmm = isLandscape ? base.h : base.w;
        const pageHmm = isLandscape ? base.w : base.h;
        const PAD_MM = 5;
        const pageSizeCss = `${paperName} ${paperOrient}`;
        const MM2PX = 96 / 25.4;

        // Tiêu đề: 年月 + tên nhân viên (lấy từ dòng đã dựng trong modal).
        const ymText = (document.querySelector('#enmYmLine')?.textContent || '').trim();
        const nameText = (document.querySelector('#enmNameLine')?.textContent
          || document.querySelector('#staffName')?.textContent || '').trim();

        // Dựng các hàng ngày: 日 / 現場 / 作業内容 (dữ liệu đã gom ở openModal).
        let rowsHtml = '';
        for (const r of enmSiteWorkRows) {
          const cls = r.rest ? ' class="sw-rest"' : '';
          rowsHtml += `<tr${cls}><td class="sw-day">${r.day}</td>`
            + `<td class="sw-site">${r.site || ''}</td>`
            + `<td class="sw-work">${r.work || ''}</td></tr>`;
        }

        let iframe = document.getElementById('print-iframe-sites');
        if (!iframe) {
          iframe = document.createElement('iframe');
          iframe.id = 'print-iframe-sites';
          iframe.style.cssText = 'position:fixed;left:0;top:0;border:none;opacity:0;z-index:-9999;pointer-events:none;';
          document.body.appendChild(iframe);
        }
        iframe.style.width = `${Math.round(pageWmm * MM2PX)}px`;
        iframe.style.height = `${Math.round(pageHmm * MM2PX)}px`;

        const empNameClean = nameText.replace(/[\\/:*?"<>|]/g, '');
        const docTitle = empNameClean ? `現場作業内容_${empNameClean}` : '現場作業内容';

        const sitesHtml = `
          <!DOCTYPE html><html><head><title>${docTitle}</title><style>
            @page { margin: 0; size: ${pageSizeCss}; }
            html, body { width: ${pageWmm}mm; margin: 0; padding: 0; overflow: hidden;
              font-family: "Meiryo","Hiragino Kaku Gothic ProN","MS PGothic",sans-serif; color:#000;
              -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .sw-page { width: ${pageWmm}mm; height: ${pageHmm - 0.6}mm; padding: ${PAD_MM}mm;
              box-sizing: border-box; overflow: hidden; display:flex; flex-direction:column; }
            table.sw-tbl { flex:0 0 auto; }
            table.sw-tbl tbody tr, table.sw-tbl tbody td { height:28px; }
            .sw-title { text-align:center; font-size:24px; letter-spacing:10px; text-indent:10px;
              font-weight:bold; margin:0 0 4px; }
            .sw-head { display:flex; align-items:flex-end; gap:12px; font-size:15px; margin:0 0 5px; }
            .sw-head .sw-ym { border-bottom:1px solid #000; padding:0 8px 2px; min-width:150px; }
            .sw-head .sw-nm { border-bottom:1px solid #000; padding:0 12px 2px; flex:1; font-weight:700; font-size:18px; }
            table.sw-tbl { width:100%; border-collapse:collapse; table-layout:fixed; }
            table.sw-tbl th, table.sw-tbl td { border:0.5px solid #888; padding:1px 6px;
              vertical-align:middle; word-break:break-word; overflow:hidden; }
            table.sw-tbl th { background:#cbd5e1; text-align:center; font-weight:normal; font-size:12px; height:24px; }
            /* GHIM chiều cao hàng cố định → 31 ngày + header LUÔN vừa 1 trang.
               Nội dung 作業内容 dài sẽ bị cắt bớt (overflow:hidden) chứ KHÔNG đẩy
               hàng cao ra làm tràn trang. */
            .sw-company { flex:0 0 auto; margin-top:auto; }
            table.sw-tbl td.sw-day { text-align:center; width:12%; white-space:nowrap; font-size:12px; }
            table.sw-tbl td.sw-site { width:20%; font-size:11px; line-height:1.15; text-align:center; }
            table.sw-tbl td.sw-work { width:68%; font-size:11px; line-height:1.15; }
            table.sw-tbl tr.sw-rest td { background:#d9d9d9; }
            .sw-company { text-align:right; font-size:16px; font-weight:700; }
          </style></head><body>
            <div class="sw-page">
              <div class="sw-title">作業報告書</div>
              <div class="sw-head"><span class="sw-ym">${ymText}</span>
                <span>名前：</span><span class="sw-nm">${nameText}</span></div>
              <table class="sw-tbl">
                <thead><tr><th style="width:12%;">日</th><th style="width:20%;">現場</th><th style="width:68%;">作業内容</th></tr></thead>
                <tbody>${rowsHtml}</tbody>
              </table>
              <div class="sw-company">飯塚塗研株式会社</div>
            </div>
          </body></html>`;
        iframe.contentWindow.document.open();
        iframe.contentWindow.document.write(sitesHtml);
        iframe.contentWindow.document.close();
        iframe._printHtml = sitesHtml; // để in bằng cửa sổ mới trên điện thoại

        const win = iframe.contentWindow;
        // Chiều cao lấp đầy + chia đều các hàng do FLEXBOX lo (không cần JS đo).
        const fontsReady = (win.document.fonts && win.document.fonts.ready) ? win.document.fonts.ready : Promise.resolve();
        Promise.race([
          fontsReady.then(() => new Promise(r => setTimeout(r, 250))),
          new Promise(r => setTimeout(r, 1200)),
        ]).then(() => win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve(iframe))))
          .catch(() => resolve(iframe));
      });

      btnSites.addEventListener('click', async (e) => {
        e.preventDefault();
        await openModal(false);                  // dựng dữ liệu enmSiteWorkRows (không hiện modal)
        const iframe = await renderSitesIframe();
        try {
          iframe.contentWindow.focus();
          iframe.contentWindow.print();
        } catch (e) {
          if (iframe._printHtml) printInNewWindow(iframe._printHtml);
        }
      });
    }

    if (btnClose) btnClose.addEventListener('click', closeModal);
    if (btnCloseBottom) btnCloseBottom.addEventListener('click', closeModal);
    if (backdrop) backdrop.addEventListener('click', closeModal);

    // Dựng iframe in (CSS print + auto-fit) và trả về Promise<iframe> sau khi
    // đã fit xong (CHƯA print). Dùng chung cho: in trực tiếp và sinh PDF.
    const renderPrintIframe = () => new Promise((resolve) => {
      {
        const printContent = document.querySelector('#enmPrintArea').innerHTML;

        // ── Khổ giấy do người dùng chọn (A4/A3, dọc/ngang) ──────────────
        const paperVal = document.querySelector('#enmPaperSize')?.value || 'A4-portrait';
        const [paperName, paperOrient] = paperVal.split('-'); // ví dụ: 'A4', 'portrait'
        // Kích thước giấy (mm) theo chiều dọc gốc
        const PAPER_MM = { A4: { w: 210, h: 297 }, A3: { w: 297, h: 420 } };
        const base = PAPER_MM[paperName] || PAPER_MM.A4;
        const isLandscape = paperOrient === 'landscape';
        const pageWmm = isLandscape ? base.h : base.w; // bề rộng trang khi in
        const pageHmm = isLandscape ? base.w : base.h; // chiều cao trang khi in
        // Lề trang (mm) — mỏng để bản PDF to/đẹp, tận dụng tối đa A4.
        // (Luồng dùng: bấm nút → lưu PDF → mở PDF in ra, nên không cần chừa lề máy in.)
        const PAD_MM = 5;
        const availHmm = pageHmm - PAD_MM * 2;
        const fitHmm = availHmm - 3;
        const pageSizeCss = `${paperName} ${paperOrient}`;

        // Kích thước iframe cố định theo khổ giấy (px = mm * 96/25.4). KHÔNG dùng
        // 100vw/100vh — trên điện thoại viewport hẹp khiến layout đo sai, gây cắt
        // mất ngày cuối tháng và bóp cột. Kích thước cố định đảm bảo layout giống
        // hệt trên mọi thiết bị (desktop và mobile).
        const MM2PX = 96 / 25.4;
        const iframeWpx = Math.round(pageWmm * MM2PX);
        const iframeHpx = Math.round(pageHmm * MM2PX);

        let iframe = document.getElementById('print-iframe');
        if (!iframe) {
          iframe = document.createElement('iframe');
          iframe.id = 'print-iframe';
          iframe.style.position = 'fixed';
          iframe.style.left = '0';
          iframe.style.top = '0';
          iframe.style.border = 'none';
          iframe.style.opacity = '0';
          iframe.style.zIndex = '-9999';
          iframe.style.pointerEvents = 'none';
          document.body.appendChild(iframe);
        }
        // Đặt lại kích thước mỗi lần (khổ giấy có thể thay đổi giữa các lần in).
        iframe.style.width = `${iframeWpx}px`;
        iframe.style.height = `${iframeHpx}px`;

        // Tên file khi lưu PDF = tiêu đề trang in. Thêm tên nhân viên đang xem.
        const empName = (document.querySelector('#enmNameLine')?.textContent
          || document.querySelector('#staffName')?.textContent || '').trim()
          .replace(/[\\/:*?"<>|]/g, ''); // bỏ ký tự không hợp lệ cho tên file
        const docTitle = empName ? `月次勤怠入力管理_${empName}` : '月次勤怠入力管理';

        const printHtml = `
          <!DOCTYPE html>
          <html>
            <head>
              <title>${docTitle}</title>
              <style>
                @page { 
                   /* margin:0 → dù người dùng chọn 余白=なし cũng KHÔNG phá bố cục.
                      Lề đẹp được tạo bằng padding bên trong #printScale (PAD_MM). */
                   margin: 0;
                   size: ${pageSizeCss}; 
                }
                body { 
                  font-family: "Meiryo", "Hiragino Kaku Gothic ProN", "MS PGothic", sans-serif; 
                  color: #000; 
                  margin: 0; 
                  padding: 0;
                  box-sizing: border-box;
                  -webkit-print-color-adjust: exact; 
                  print-color-adjust: exact;
                }
                /* ---------- IN-IFRAME PRINT CSS (A4, chữ đủ lớn, 30 ngày vừa 1 trang) ---------- */
                .enm-title { text-align: center; font-size: 22px; letter-spacing: 10px; text-indent: 10px; margin-top: 0; margin-bottom: 3px; font-weight: bold; }
                .enm-info { display: flex; justify-content: space-between; margin-bottom: 2px; font-size: 13px; font-weight: normal; }
                .enm-company { font-size: 15px; font-weight: 700; }
                .enm-table { width: 100%; border-collapse: collapse; margin-bottom: 6px; border: 1px solid #000; }
                .enm-table th, .enm-table td { border: 1px solid #000; padding: 5px 6px; font-size: 12px; font-weight: normal; }
                .enm-table th { background: #e2e8f0 !important; text-align: center; }
                .enm-table td { text-align: left; }
                .enm-table.right-align td { text-align: right; }
                .enm-table.center-align td { text-align: center; }
                .enm-daily-table { width: 100%; border-collapse: collapse; border: 0.5px solid #888; margin-bottom: 0; table-layout: fixed; }
                /* Chống chia trang trong bảng + thead lặp sang trang 2 khi in. */
                .enm-daily-table thead { display: table-row-group; }
                .enm-daily-table tr, .enm-daily-table td, .enm-daily-table th { page-break-inside: avoid; break-inside: avoid; }
                #printScale, #printScale * { page-break-inside: avoid; break-inside: avoid; }
                /* Ô số liệu: đủ lớn dễ đọc, cân đối để 30 ngày + 1 header row vừa trong A4 dọc */
                .enm-daily-table th, .enm-daily-table td { border: 0.5px solid #888; padding: 4px 3px; font-size: 15px; line-height: 1.3; font-weight: normal; text-align: center; vertical-align: middle; min-height: 26px; }
                .enm-daily-table th { background: #cbd5e1 !important; font-weight: normal; font-size: 12px; line-height: 1.35; padding: 5px 3px; }
                /* Hàng ngày nghỉ: tô nền xám cả hàng. */
                .enm-daily-table tbody tr.enm-rest-row td { background: #d9d9d9 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                .enm-daily-table td.left-align { text-align: left; }
                /* Ô 出社/在宅/現場: chỉ chứa dấu 〇, căn giữa, chữ vừa phải. */
                .enm-daily-table td.enm-mark { text-align: center; font-size: 15px; }
                .enm-daily-table th, .enm-daily-table td { white-space: nowrap; word-break: keep-all; }
                /* Cột 事由: tên ngày lễ dài (国民の休日, 敬老の日...) phải xuống dòng
                   trong ô, KHÔNG tràn ra ngoài. Chữ nhỏ hơn 1 chút + cho wrap. */
                .enm-daily-table td.enm-reason {
                  white-space: normal; word-break: break-all; overflow: hidden;
                  font-size: 12px; line-height: 1.15; padding-left: 2px; padding-right: 2px;
                }
                /* Cột 日 (chỉ số ngày): in đậm nhẹ */
                .enm-daily-table thead tr:first-child th:nth-child(1), .enm-daily-table td:nth-child(1) { white-space: normal; word-break: keep-all; overflow: visible; padding-left: 2px; padding-right: 2px; font-weight: normal; }
                
                /* Tất cả vạch (dọc & ngang) đều MỎNG và ĐỒNG ĐỀU: 0.5px solid #888.
                   KHÔNG để nét đậm/nhạt lẫn lộn. */
                .enm-daily-table, .enm-daily-table th, .enm-daily-table td { border: 0.5px solid #888 !important; }
                /* 作業内容: giữ nhỏ (như yêu cầu), cho xuống dòng, padding hẹp để tiết kiệm chiều cao */
                .enm-daily-table td.enm-work {
                  white-space: normal; word-break: break-word; text-align: left;
                  font-size: 9.5px; line-height: 1.22; padding: 1px 3px;
                }
                /* 備考: chữ lớn hơn 作業内容, gần ngang với số liệu nhưng nhỏ hơn 1 chút */
                .enm-daily-table td.enm-note {
                  white-space: normal; word-break: break-word; text-align: left;
                  font-size: 15px; line-height: 1.35;
                }
                /* Dòng tiêu đề kiểu mẫu: 年 月 ・ 名前 ・ 印 */
                .enm-name-line { display: flex; align-items: flex-end; gap: 0; margin: 2px 0 4px; font-size: 14px; font-weight: normal; }
                .enm-name-line .enm-ym,
                .enm-name-line .enm-name-label,
                .enm-name-line .enm-name-val { border-bottom: 1px solid #000; padding-bottom: 3px; }
                .enm-name-line .enm-ym { min-width: 150px; }
                .enm-name-line .enm-name-label { margin-left: 8px; padding-left: 4px; }
                .enm-name-line .enm-name-val { flex: 1; font-weight: 700; font-size: 20px; padding: 0 8px 3px; min-height: 24px; }
                .enm-name-line .enm-stamp { display: inline-flex; align-items: center; justify-content: center; font-size: 15px; margin-left: 10px; }
                .enm-name-line .enm-total-inline { margin-left: 20px; font-size: 17px; font-weight: 700; white-space: nowrap; }
                .enm-footer-text { font-size: 13px; margin-top: 1px; text-align: right; padding-right: 10px; font-weight: normal; }
                
                /* body = đúng 1 trang vật lý. Lề nằm TRONG #printScale (padding). */
                html, body {
                  width: ${pageWmm}mm;
                  margin: 0;
                  padding: 0;
                  overflow: hidden;
                }
                .print-container {
                  width: 100%;
                  box-sizing: border-box;
                  overflow: hidden;
                }
                /* Wrapper phủ gần đúng 1 trang (trừ 0.6mm chống sai số làm dây sang
                   trang 2). Lề đẹp 4 phía = padding PAD_MM bên trong (border-box),
                   nên KHÔNG phụ thuộc 余白 của hộp thoại in. Vùng nội dung thực =
                   (pageWmm - 2*PAD) × (pageHmm - 2*PAD) = availWmm × availHmm. */
                /* Khung cao ĐÚNG vùng in (availHmm = pageHmm - 2*PAD). KHÔNG dùng
                   overflow:hidden + height dư (thứ này đang CẮT mất ngày cuối).
                   Dùng flexbox để bảng TỰ giãn lấp đầy trang, các hàng chia đều →
                   đủ tháng, không khoảng trắng, KHÔNG cắt. */
                #printScale {
                  transform-origin: top left;
                  width: ${pageWmm}mm;
                  height: ${pageHmm - 0.6}mm;
                  padding: ${PAD_MM}mm;
                  box-sizing: border-box;
                  display: flex;
                  flex-direction: column;
                  overflow: hidden;
                }
                #printScale > .enm-paper {
                  box-sizing: border-box; width: 100%;
                  flex: 1 1 auto; min-height: 0;
                  display: flex; flex-direction: column;
                }
                /* KHÔNG cho bảng flex-stretch (flex:0 0 auto). Bảng flex-stretch là
                   nguyên nhân header bị PHÌNH: trình duyệt (nhất là trên điện thoại)
                   dồn phần chiều cao dôi vào hàng thead. Nay bảng cao TỰ NHIÊN =
                   thead cố định + tbody chiều cao cố định → header GIỐNG HỆT desktop
                   trên mọi thiết bị. */
                #printScale > .enm-paper > .enm-daily-table { flex: 0 0 auto; width: 100%; }
                #printScale > .enm-paper > .enm-footer-text { flex: 0 0 auto; margin-top: auto; }
                /* Tên công ty: xuống CUỐI trang, canh mép PHẢI. */
                #printScale > .enm-paper > .enm-company-bottom { flex: 0 0 auto; text-align: right; font-size: 17px; font-weight: 700; margin-top: 4px; padding-right: 6px; }
                /* CHIỀU CAO HÀNG TBODY CỐ ĐỊNH → bảng không phình, header ổn định. */
                #printScale .enm-daily-table tbody tr { height: 28px !important; }
                #printScale .enm-daily-table tbody td { height: 28px !important; min-height: 0 !important; padding-top: 1px !important; padding-bottom: 1px !important; }
                /* ── KHOÁ CHIỀU CAO HIỂN THỊ CỦA HEADER ──
                   Vì các ô thead có rowspan=2 + border-collapse + table-layout:fixed,
                   khi tbody bị giãn thì thuật toán bảng đẩy một phần chiều cao dôi
                   LÊN hàng thead → chữ 日/開始/終了 lệch xuống, mỗi nhân viên một kiểu.
                   Cách chặn triệt để: bọc chữ header trong <div class="thc"> có CHIỀU
                   CAO CỐ ĐỊNH. Dù ô <th> có bị kéo cao bao nhiêu, khối chữ vẫn giữ
                   nguyên chiều cao & căn giữa → header GIỐNG HỆT NHAU cho mọi người. */
                #printScale .enm-daily-table thead th { padding: 0 !important; min-height: 0 !important; vertical-align: middle !important; line-height: 1 !important; }
                /* Ghim CỨNG chiều cao 2 hàng header → dù bảng bị flex kéo giãn cũng
                   KHÔNG hút chiều cao vào header (chống chữ header trùng/dồn xuống). */
                #printScale .enm-daily-table thead tr:nth-child(1) { height: 18px !important; }
                #printScale .enm-daily-table thead tr:nth-child(2) { height: 18px !important; }
                #printScale .enm-daily-table thead .thc {
                  display: flex; align-items: center; justify-content: center;
                  text-align: center; line-height: 1.2; overflow: hidden; box-sizing: border-box;
                }
                /* thc2 (rowspan=2) = tổng 2 hàng đơn (2 × thc1) để ô rowspan KHÔNG
                   yêu cầu cao hơn tổng 2 hàng → không ép hàng phình thêm. */
                #printScale .enm-daily-table thead .thc1 { height: 18px; }  /* ô 1 hàng */
                #printScale .enm-daily-table thead .thc2 { height: 36px; }  /* ô rowspan=2 = 2×18 */
                .print-container .enm-title { margin-top: 0 !important; margin-bottom: 3px !important; font-size: 22px !important; letter-spacing: 10px !important; text-indent: 10px !important; }
                .print-container h4 { margin: 2px 0 1px 0 !important; }
                .print-container .enm-table th, .print-container .enm-table td { padding: 4px 5px !important; font-size: 12px !important; font-weight: normal !important; }
                #printScale .enm-paper > div:last-child { margin-top: 1px !important; margin-bottom: 0 !important; }
              </style>
            </head>
            <body>
              <div class="print-container">
                <div id="printScale">
                  ${printContent}
                </div>
              </div>
            </body>
          </html>
        `;
        iframe.contentWindow.document.open();
        iframe.contentWindow.document.write(printHtml);
        iframe.contentWindow.document.close();
        // Lưu HTML in để dùng lại khi mở cửa sổ mới trên điện thoại (in native
        // từ iframe ẩn không đáng tin trên mobile → phải mở window thật).
        iframe._printHtml = printHtml;
        iframe._docTitle = docTitle;

        // ── LAYOUT CỐ ĐỊNH (KHÔNG auto-fit) ──
        // Trước đây hàm này đo nội dung từng nhân viên rồi ZOOM nhỏ (người nội dung
        // nhiều) hoặc GIÃN hàng (người nội dung ít) → chính là lý do "mỗi người một
        // cỡ chữ / khoảng cách khác nhau". Nay BỎ HẲN việc đo-động: cỡ chữ + chiều
        // cao hàng đều cố định trong CSS, nên MỌI nhân viên có form GIỐNG HỆT NHAU.
        // Hàm chỉ còn chờ font/layout ổn định rồi trả iframe để in.
        let printed = false;
        const doAutoFitAndPrint = () => {
          if (printed) return; // tránh chạy trùng khi cả fonts.ready lẫn timeout cùng gọi
          printed = true;
          try {
            const doc = iframe.contentWindow.document;
            const scaleEl = doc.getElementById('printScale');
            const table = doc.getElementById('enmDailyTable');
            const bodyRows = table ? table.querySelectorAll('tbody tr') : [];
            const paper = scaleEl ? scaleEl.querySelector('.enm-paper') : null;
            // Chiều cao lấp đầy + chia đều các hàng do FLEXBOX lo (không cần JS đo).
            const container = null;
            if (false && scaleEl && paper) {
              // Reset trước khi đo
              paper.style.zoom = '';
              paper.style.transform = '';
              paper.style.width = '';
              if (container) container.style.height = '';
              bodyRows.forEach((r) => {
                r.style.height = '';
                if (r.firstElementChild) r.firstElementChild.style.height = '';
              });

              // Chiều cao vùng in 1 trang (content-box của printScale), đo px thực.
              const measurePx = (mm) => {
                const p = doc.createElement('div');
                p.style.cssText = `position:absolute;visibility:hidden;height:${mm}mm;`;
                doc.body.appendChild(p);
                const h = p.getBoundingClientRect().height;
                doc.body.removeChild(p);
                return h;
              };
              // Mốc = availHmm gần như full (chỉ trừ 1mm an toàn) để tối ưu diện tích.
              // Chỉ ZOOM thu nhỏ khi nội dung THỰC SỰ vượt mốc này với ngưỡng +15px
              // (rất cao — ưu tiên chữ lớn trước; nếu phải thu nhỏ thì cũng chỉ nhẹ).
              // Mốc = availHmm gần như full (chỉ trừ 1mm an toàn). Chỉ ZOOM thu nhỏ
              // khi nội dung THỰC SỰ vượt (ngưỡng +15px, ưu tiên giữ chữ to).
              const fillH = measurePx(availHmm - 1);
              const overflowLimit = fillH;

              // ĐO CHIỀU CAO THẬT: tạm bỏ height/overflow của khung và flex của paper
              // để nội dung 30 ngày hiện đầy đủ (không bị flex nén / overflow cắt),
              // nhờ đó phát hiện đúng khi nào cần zoom thu nhỏ.
              const savedScaleH = scaleEl.style.height;
              const savedScaleOv = scaleEl.style.overflow;
              const savedPaperFlex = paper.style.flex;
              scaleEl.style.height = 'auto';
              scaleEl.style.overflow = 'visible';
              paper.style.flex = '0 0 auto';
              // ép bảng cao tự nhiên khi đo
              const tableEl = paper.querySelector('#enmDailyTable');
              const savedTableFlex = tableEl ? tableEl.style.flex : '';
              if (tableEl) tableEl.style.flex = '0 0 auto';

              const contentH = paper.scrollHeight; // chiều cao thật (px)

              // Khôi phục lại để flexbox/overflow hoạt động bình thường cho render.
              scaleEl.style.height = savedScaleH;
              scaleEl.style.overflow = savedScaleOv;
              paper.style.flex = savedPaperFlex;
              if (tableEl) tableEl.style.flex = savedTableFlex;

              try { console.log('[ENM fit] contentH=', Math.round(contentH), 'overflowLimit=', Math.round(overflowLimit), 'rows=', bodyRows.length, 'availHmm=', availHmm); } catch(_) {}
              if (contentH > overflowLimit + 15) {
                // TRÀN: nội dung quá nhiều → thu nhỏ ĐỀU bằng zoom.
                let z = Math.max(0.55, (overflowLimit / contentH) * 0.99);
                paper.style.zoom = String(z);
                // Sau zoom, đo lại chiều cao thật (cũng tạm bỏ ép flex) để siết cho vừa.
                let dbgIter = 0;
                for (let i = 0; i < 15; i++) {
                  scaleEl.style.height = 'auto'; scaleEl.style.overflow = 'visible'; paper.style.flex = '0 0 auto';
                  if (tableEl) tableEl.style.flex = '0 0 auto';
                  const h = paper.getBoundingClientRect().height; // gồm cả zoom
                  scaleEl.style.height = savedScaleH; scaleEl.style.overflow = savedScaleOv; paper.style.flex = savedPaperFlex;
                  if (tableEl) tableEl.style.flex = savedTableFlex;
                  dbgIter++;
                  if (h <= overflowLimit) break;
                  z = Math.max(0.55, z * 0.97);
                  paper.style.zoom = String(z);
                }
                try { console.log('[ENM fit] ZOOM applied, final zoom=', paper.style.zoom, 'iters=', dbgIter); } catch(_) {}
              } else if (bodyRows.length) {
                // THỪA: giãn đều chiều cao các hàng để đáy nội dung chạm sát mép dưới
                // càng nhiều càng tốt — ưu tiên không để khoảng trắng thừa.
                const rect0 = scaleEl.getBoundingClientRect();
                const cs0 = iframe.contentWindow.getComputedStyle(scaleEl);
                const padTop = parseFloat(cs0.paddingTop) || 0;
                // Gần sát 100%: fillH chỉ còn 0.3mm an toàn ở đáy.
                const targetBottom = rect0.top + padTop + (fillH - measurePx(0.3));
                const lastEl = paper.lastElementChild;
                const measureBottom = () => (lastEl ? lastEl.getBoundingClientRect().bottom : paper.getBoundingClientRect().bottom);
                // Giãn cực mạnh: 200 vòng, ngưỡng dừng cực thấp, phân bổ tất cả cell.
                for (let pass = 0; pass < 200; pass++) {
                  const extra = targetBottom - measureBottom();
                  // Đã sát đáy hoặc hơi lệch lên 0.05px → dừng.
                  if (extra <= 0.05) break;
                  const perRow = extra / bodyRows.length;
                  if (perRow < 0.01) break;
                  bodyRows.forEach((r) => {
                    const cells = r.querySelectorAll('td, th');
                    if (cells.length) {
                      const firstCell = cells[0];
                      const h = firstCell.getBoundingClientRect().height;
                      const nh = `${h + perRow}px`;
                      r.style.height = nh;
                      cells.forEach((c) => { c.style.height = nh; });
                    } else {
                      const h = r.getBoundingClientRect().height;
                      r.style.height = `${h + perRow}px`;
                    }
                  });
                }
              }
            }
          } catch (e) { /* bỏ qua nếu không đo/scale được */ }
          // Tháng 31 ngày (hoặc ngày có 2 dòng) với hàng cố định 28px thì vượt 1 trang
          // → overflow:hidden cắt mất dòng cuối (tên công ty). Chỉ khi tràn mới hạ
          // chiều cao hàng từng 1px (tối thiểu 20px) cho đến khi tên công ty nằm gọn
          // trong trang. Tháng vừa trang thì giữ nguyên 28px như cũ.
          try {
            const doc = iframe.contentWindow.document;
            const scaleEl = doc.getElementById('printScale');
            const lastEl = scaleEl && scaleEl.querySelector('.enm-company-bottom');
            const rowsEls = scaleEl ? scaleEl.querySelectorAll('.enm-daily-table tbody tr') : [];
            if (scaleEl && lastEl && rowsEls.length) {
              const mmPx = scaleEl.getBoundingClientRect().height / (pageHmm - 0.6);
              const limit = () => scaleEl.getBoundingClientRect().bottom - (PAD_MM + 2) * mmPx;
              const setRowH = (h) => rowsEls.forEach((r) => {
                r.style.setProperty('height', `${h}px`, 'important');
                r.querySelectorAll('td').forEach((c) => c.style.setProperty('height', `${h}px`, 'important'));
              });
              for (let h = 27; h >= 20 && lastEl.getBoundingClientRect().bottom > limit(); h--) setRowH(h);
            }
          } catch (e) { /* bỏ qua nếu không đo được */ }
          // Chờ thêm 1 nhịp để layout sau zoom/giãn áp dụng xong (đặc biệt trên
          // điện thoại chậm) rồi mới trả iframe → print/chụp đúng trạng thái đã fit.
          setTimeout(() => resolve(iframe), 150);
        };

        // Chờ font + layout ổn định rồi mới đo. Trên điện thoại font Nhật tải chậm
        // và iframe ẩn bị throttle rAF, nên chờ chắc chắn bằng nhiều mốc thời gian.
        const startAutoFit = () => {
          const win = iframe.contentWindow;
          const run = () => win.requestAnimationFrame(() => win.requestAnimationFrame(doAutoFitAndPrint));
          const fontsReady = (win.document.fonts && win.document.fonts.ready)
            ? win.document.fonts.ready : Promise.resolve();
          // Chờ cả fonts.ready lẫn một khoảng thời gian tối thiểu để chắc layout xong.
          Promise.race([
            fontsReady.then(() => new Promise(r => setTimeout(r, 250))),
            new Promise(r => setTimeout(r, 1200)), // dự phòng nếu fonts.ready không resolve
          ]).then(run).catch(run);
        };
        startAutoFit();
      }
    });

    // Nút 印刷/PDF保存 trong modal (nếu ai mở modal): in trực tiếp qua iframe.
    if (btnPrint) {
      btnPrint.addEventListener('click', async () => {
        const iframe = await renderPrintIframe();
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      });
    }
  };

  // ─── 実績表 Report Matrix ───────────────────────────────────────────────────
  const bindReportMatrix = () => {
    const btn = document.getElementById('btnReportMatrix');
    const modal = document.getElementById('reportMatrixModal');
    if (!btn || !modal) return;

    const backdrop = document.getElementById('rmBackdrop');
    const closeBtn = document.getElementById('rmClose');
    const closeBottom = document.getElementById('rmCloseBottom');
    const printBtn = document.getElementById('rmPrint');
    const content = document.getElementById('rmContent');
    const tabs = modal.querySelectorAll('[data-rm-tab]');
    let currentMode = 'time';
    let matrixData = null;

    const closeModal = () => modal.setAttribute('hidden', '');
    if (backdrop) backdrop.addEventListener('click', closeModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (closeBottom) closeBottom.addEventListener('click', closeModal);

    const getDow = (y, m, d) => ['日','月','火','水','木','金','土'][new Date(y, m - 1, d).getDay()];

    const renderMatrix = () => {
      if (!matrixData || !content) return;
      const { year, lastDay, employees, month } = matrixData;
      const [, mon] = month.split('-').map(Number);
      const title = `${year}年${mon}月 飯塚塗研株式会社 実績表`;
      const modeLabel = currentMode === 'time' ? '出退勤時間' : currentMode === 'round' ? '出退勤時間(丸め)' : '勤務時間';
      const modeLabelColor = currentMode === 'round' ? '#2563eb' : currentMode === 'hours' ? '#059669' : '#dc2626';

      let html = `<div style="text-align:center;font-size:15px;font-weight:700;margin:0 0 12px;">${title}</div>`;
      html += `<div style="text-align:right;font-size:10px;color:${modeLabelColor};font-weight:600;margin-bottom:8px;">表示形式: ${modeLabel}</div>`;
      html += `<table style="border-collapse:collapse;width:100%;font-size:9px;table-layout:fixed;"><thead><tr>`;
      html += `<th style="border:1px solid #ccc;padding:3px 2px;background:#fff;text-align:left;width:70px;font-size:8px;overflow:hidden;"></th>`;
      for (let d = 1; d <= lastDay; d++) {
        const dow = getDow(year, mon, d);
        const color = dow === '日' ? '#dc2626' : dow === '土' ? '#2563eb' : '#333';
        html += `<th style="border:1px solid #ccc;padding:1px;text-align:center;font-weight:400;font-size:8px;"><div style="font-weight:700;">${d}</div><div style="font-size:7px;color:${color};">(${dow})</div></th>`;
      }
      html += `<th style="border:1px solid #ccc;padding:1px;text-align:center;font-weight:700;font-size:8px;width:32px;">計</th></tr></thead><tbody>`;

      for (const emp of employees) {
        html += `<tr><td style="border:1px solid #ccc;padding:1px 2px;white-space:nowrap;font-weight:700;font-size:8px;overflow:hidden;text-overflow:ellipsis;">${emp.username || emp.employeeCode}</td>`;
        let totalMin = 0;
        for (let d = 1; d <= lastDay; d++) {
          const cell = emp.days[d];
          let cellText = '';
          if (cell) {
            const halfHourDisplay = (min) => (min && min > 0) ? (min / 60).toFixed(1) : '';
            if (currentMode === 'time') {
              if (cell.checkIn && cell.checkOut) cellText = `${cell.checkIn}<br>${cell.checkOut}`;
              else if (cell.checkIn) cellText = cell.checkIn;
            } else if (currentMode === 'round') {
              if (cell.roundedIn && cell.roundedOut) cellText = `${cell.roundedIn}<br>${cell.roundedOut}`;
            } else {
              // 勤務時間: show half-hour formatted values (0.0, 0.5, 1.0...)
              const useMin = (cell.roundedWorkedMin != null && cell.roundedWorkedMin > 0) ? cell.roundedWorkedMin : cell.workedMin;
              cellText = useMin && useMin > 0 ? halfHourDisplay(useMin) : '';
            }
            // For totals, prefer roundedWorkedMin when available (to reflect half-hour rounding)
            if (cell.workedMin > 0) {
              const addMin = (cell.roundedWorkedMin != null && cell.roundedWorkedMin > 0) ? cell.roundedWorkedMin : cell.workedMin;
              totalMin += addMin;
            }
          }
          html += `<td style="border:1px solid #ddd;padding:0 1px;text-align:center;font-size:7px;line-height:1.1;overflow:hidden;">${cellText}</td>`;
        }
        const totalH = (totalMin / 60).toFixed(1);
        html += `<td style="border:1px solid #ccc;padding:2px 4px;text-align:center;font-weight:700;font-size:9px;">${totalMin > 0 ? totalH : ''}</td></tr>`;
      }

      // Summary rows
      html += `<tr style="font-weight:700;font-size:9px;"><td style="border:1px solid #ccc;padding:2px 4px;">出勤人数</td>`;
      let totalAttend = 0;
      for (let d = 1; d <= lastDay; d++) {
        const s = matrixData.dailySummary[d];
        const cnt = s?.attendCount || 0;
        totalAttend += cnt;
        html += `<td style="border:1px solid #ddd;text-align:center;">${cnt || '-'}</td>`;
      }
      html += `<td style="border:1px solid #ccc;text-align:center;">${totalAttend}</td></tr>`;

      html += `<tr style="font-weight:700;font-size:9px;"><td style="border:1px solid #ccc;padding:2px 4px;">勤務時間(h)</td>`;
      let grandTotalH = 0;
      for (let d = 1; d <= lastDay; d++) {
        const s = matrixData.dailySummary[d];
        const h = s?.totalWorkedHours || 0;
        grandTotalH += h;
        html += `<td style="border:1px solid #ddd;text-align:center;">${h > 0 ? h.toFixed(1) : '-'}</td>`;
      }
      html += `<td style="border:1px solid #ccc;text-align:center;">${grandTotalH.toFixed(1)}</td></tr>`;

      html += `</tbody></table>`;
      content.innerHTML = html;
    };

    // Tab switching
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        currentMode = tab.dataset.rmTab;
        tabs.forEach(t => {
          t.style.background = t === tab ? '#1e40af' : '#fff';
          t.style.color = t === tab ? '#fff' : '#334155';
        });
        renderMatrix();
      });
    });

    // Print
    if (printBtn) {
      printBtn.addEventListener('click', () => {
        const printContent = document.getElementById('rmPrintArea')?.innerHTML || '';
        const w = window.open('', '_blank', 'width=1200,height=800');
        w.document.write(`<html><head><title>実績表</title><style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif; padding: 15px; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #ccc; padding: 2px 3px; font-size: 9px; }
          @media print { 
            body { padding: 5px; }
            @page { size: landscape; margin: 5mm; } 
          }
        </style></head><body>${printContent}</body></html>`);
        w.document.close();
        setTimeout(() => { w.print(); }, 300);
      });
    }

    // Open in new full-screen window (not modal)
    btn.addEventListener('click', async () => {
      const monthPicker = document.getElementById('monthPicker');
      const ym = monthPicker?.value || '';
      if (!ym) { alert('対象年月を選択してください'); return; }
      try {
        const { fetchJSONAuth } = core;
        matrixData = await fetchJSONAuth(`/api/attendance/month/report-matrix?month=${encodeURIComponent(ym)}`);
        // Open new window - render entirely inside the new window
        const w = window.open('', '_blank');
        if (!w) { alert('ポップアップがブロックされました。許可してください。'); return; }
        const tabsHtml = `<div style="display:flex;gap:8px;justify-content:center;margin-bottom:12px;">
          <button onclick="switchMode('time')" id="t_time" style="padding:6px 16px;border:1px solid #ccc;border-radius:4px;background:#1e40af;color:#fff;font-weight:700;cursor:pointer;">出退勤時間</button>
          <button onclick="switchMode('round')" id="t_round" style="padding:6px 16px;border:1px solid #ccc;border-radius:4px;background:#fff;color:#333;cursor:pointer;">出退勤時間(丸め)</button>
          <button onclick="switchMode('hours')" id="t_hours" style="padding:6px 16px;border:1px solid #ccc;border-radius:4px;background:#fff;color:#333;cursor:pointer;">勤務時間</button>
        </div>`;
        w.document.write(`<html><head><title>実績表</title><style>
          * { box-sizing:border-box; margin:0; padding:0; }
          body { font-family:"Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif; padding:20px; }
          table { border-collapse:collapse; width:100%; }
          th,td { border:1px solid #ccc; padding:2px 3px; font-size:9px; }
          thead { display:table-header-group; }
          tbody tr { page-break-inside:avoid; }
          .print-btn { position:fixed; top:10px; right:20px; padding:8px 20px; background:#1e40af; color:#fff; border:none; border-radius:6px; font-size:13px; cursor:pointer; z-index:999; }
          @media print { .no-print { display:none !important; } thead { display:table-header-group; } @page { size:landscape; margin:5mm; } }
        </style></head><body>
          <button class="print-btn no-print" onclick="window.print()">印刷 / PDF保存</button>
          <div class="no-print">${tabsHtml}</div>
          <div id="matrixContent"></div>
          <script>
            const data = ${JSON.stringify(matrixData)};
            let mode = 'time';
            function getDow(y,m,d){return['日','月','火','水','木','金','土'][new Date(y,m-1,d).getDay()];}
            function switchMode(m){
              mode=m;
              document.querySelectorAll('[id^="t_"]').forEach(b=>{b.style.background=b.id==='t_'+m?'#1e40af':'#fff';b.style.color=b.id==='t_'+m?'#fff':'#333';});
              render();
            }
            function render(){
              const{year,lastDay,employees,month,dailySummary}=data;
              const[,mon]=month.split('-').map(Number);
              const title=year+'年'+mon+'月 飯塚塗研株式会社 実績表';
              const modeLabel=mode==='time'?'出退勤時間':mode==='round'?'出退勤時間(丸め)':'勤務時間';
              const modeLabelColor=mode==='round'?'#2563eb':mode==='hours'?'#059669':'#dc2626';
              let h='<div style="text-align:center;font-size:16px;font-weight:700;margin:0 0 10px;">'+title+'</div>';
              h+='<div style="text-align:right;font-size:10px;color:'+modeLabelColor+';font-weight:600;margin-bottom:8px;">表示形式: '+modeLabel+'</div>';
              h+='<table style="table-layout:fixed;"><thead><tr><th style="width:80px;text-align:left;font-size:10px;"></th>';
              for(let d=1;d<=lastDay;d++){const dow=getDow(year,mon,d);const c=dow==='日'?'#dc2626':dow==='土'?'#2563eb':'#333';h+='<th style="text-align:center;font-size:9px;"><div style="font-weight:700;">'+d+'</div><div style="font-size:8px;color:'+c+';">('+dow+')</div></th>';}
              h+='<th style="width:40px;text-align:center;font-weight:700;font-size:10px;">計</th></tr></thead><tbody>';
              for(const emp of employees){
                h+='<tr><td style="font-weight:700;font-size:10px;white-space:nowrap;overflow:hidden;">'+( emp.username||emp.employeeCode)+'</td>';
                let totalMin=0;
                for(let d=1;d<=lastDay;d++){
                  const cell=emp.days[d];let t='';
                  if(cell){
                    if(mode==='time'){if(cell.checkIn&&cell.checkOut)t=cell.checkIn+'<br>'+cell.checkOut;else if(cell.checkIn)t=cell.checkIn;}
                    else if(mode==='round'){if(cell.roundedIn&&cell.roundedOut)t=cell.roundedIn+'<br>'+cell.roundedOut;}
                    else{
                      const useMin = (cell.roundedWorkedMin != null && cell.roundedWorkedMin > 0) ? cell.roundedWorkedMin : cell.workedMin;
                      t = useMin && useMin > 0 ? (useMin / 60).toFixed(1) : '';
                    }
                    if (cell.workedMin > 0) {
                      const addMin = (cell.roundedWorkedMin != null && cell.roundedWorkedMin > 0) ? cell.roundedWorkedMin : cell.workedMin;
                      totalMin += addMin;
                    }
                  }
                  h+='<td style="text-align:center;font-size:9px;line-height:1.2;">'+t+'</td>';
                }
                h+='<td style="text-align:center;font-weight:700;font-size:10px;">'+(totalMin>0?(totalMin/60).toFixed(1):'')+'</td></tr>';
              }
              h+='<tr style="font-weight:700;font-size:10px;"><td>出勤人数</td>';
              for(let d=1;d<=lastDay;d++){const s=dailySummary[d];h+='<td style="text-align:center;">'+(s&&s.attendCount?s.attendCount:'-')+'</td>';}
              h+='<td style="text-align:center;">'+employees.filter(e=>e.totalHours>0).length+'</td></tr>';
              h+='<tr style="font-weight:700;font-size:10px;"><td>勤務時間(h)</td>';
              let gt=0;for(let d=1;d<=lastDay;d++){const s=dailySummary[d];const hh=s?s.totalWorkedHours:0;gt+=hh;h+='<td style="text-align:center;">'+(hh>0?hh.toFixed(2):'-')+'</td>';}
              h+='<td style="text-align:center;">'+gt.toFixed(2)+'</td></tr>';
              h+='</tbody></table>';
              document.getElementById('matrixContent').innerHTML=h;
            }
            render(); // Auto-render on page load
          </script>
        </body></html>`);
        w.document.close();
      } catch (e) {
        alert('エラー: ' + e.message);
      }
    });
  };

  const bind = () => {
    bindDirtyOnBlur();
    bindWindowResize();
    bindAutoReloadOnReturn();
    bindCollapseToggles();
    bindTabs();
    bindWorkflowButtons();
    bindUserPicker();
    bindTargetDateSelect();
    try { controller.syncMonthHScroll?.(); } catch (e) { /* silently ignored */ }
    bindMonthNav();
    bindSaveExportImport();
    bindSummaryEditor();
    bindTableHost();
    bindPdfModal();
    bindReportMatrix();
    try { wireUserMenu(); } catch (e) { /* silently ignored */ }
  };

  const boot = async () => {
    if (!controller) return;
    const ok = await controller.init();
    if (!ok) return;
    bind();
    await controller.setMonth(controller.ctx.initialYM, true, { spinner: false });
    hideSpinner();
    bindUserPicker();
  };

  const Events = { boot, bind, bindUserPicker };
  root.Events = Events;
  globalThis.AttendanceMonthly = root;
})();
// end
