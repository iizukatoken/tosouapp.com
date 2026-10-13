(function () {
  const root = globalThis.AttendanceMonthly || {};
  const core = root.Core || globalThis.MonthlyMonthlyCore || {};
  const state = root.State || globalThis.MonthlyMonthlyState || {};

  const {
    $,
    esc,
    fmtHm,
    fmtWorkHours,
    makeClientId,
    dowJa,
    fromDateTime,
    diffMinutesAllowOvernight,
    isFutureMonth,
    parseHm,
    computeStatus,
    showErr
  } = core;

  const renderTableFull = (host, detail, profile) => {
    if (!host) return;
    const days = Array.isArray(detail?.days) ? detail.days : [];
    const table = document.createElement('table');
    table.id = 'monthTableReal';
    table.className = 'se-month-table-real';
    table.innerHTML = `
    <thead>
      <tr class="tier2">
        <th class="sticky-col-1">日付</th>
        <th>勤務区分</th>
        <th style="width: 56px !important; min-width: 56px !important; max-width: 56px !important; text-align: center; box-sizing: border-box;">出社</th>
        <th style="width: 56px !important; min-width: 56px !important; max-width: 56px !important; text-align: center; box-sizing: border-box;">在宅</th>
        <th style="width: 56px !important; min-width: 56px !important; max-width: 56px !important; text-align: center; box-sizing: border-box;">現場</th>
        <th>現場（任意）</th>
        <th>作業内容</th>
        <th style="width: 40px !important; min-width: 40px !important; max-width: 40px !important; text-align: center; box-sizing: border-box; padding: 0 !important; letter-spacing: -1px; font-size: 10px;">開始時間</th>
        <th style="width: 40px !important; min-width: 40px !important; max-width: 40px !important; text-align: center; box-sizing: border-box; padding: 0 !important; letter-spacing: -1px; font-size: 10px;">終了時間</th>
        <th style="width: 50px !important; min-width: 50px !important; max-width: 50px !important; text-align: center; box-sizing: border-box; padding: 0 !important; letter-spacing: -1px; font-size: 10px;">休憩時間</th>
        <th style="width: 50px !important; min-width: 50px !important; max-width: 50px !important; text-align: center; box-sizing: border-box; padding: 0 !important; letter-spacing: -1px; font-size: 10px;">深夜休憩</th>
        <th style="width: 40px !important; min-width: 40px !important; max-width: 40px !important; text-align: center; box-sizing: border-box; padding: 0 !important; letter-spacing: -1px; font-size: 10px;">勤務時間</th>
        <th style="width: 40px !important; min-width: 40px !important; max-width: 40px !important; text-align: center; box-sizing: border-box; padding: 0 !important; letter-spacing: -1px; font-size: 10px;">超過時間</th>
        <th>遅刻/早退</th>
      <th>理由</th>
      <th>備考</th>
      <th>ステータス</th>
        <th>承認者</th>
      <th style="width: 60px !important; min-width: 60px !important; max-width: 60px !important; text-align: center; box-sizing: border-box; padding-left: 0; padding-right: 0;">行操作</th>
      <th>履歴</th>
      </tr>
    </thead>
  `;
    const tbody = document.createElement('tbody');
    const buildTr = (dateStr, isOff, shift, daily, seg, goOutRecords, showDateDow, shiftRequest, canAddMore, autoOff) => {
      const primary = !!showDateDow;
      const dow = dowJa(dateStr);
        // Phải theo chính sách lịch của backend (có tính phòng ban), không ép Thứ 7/Chủ nhật ở đây.
        const offDay = !!isOff;
        
        const kubunConfirmed = Number(daily?.kubunConfirmed || 0) === 1;
        let kubunInitRaw = String(daily?.kubun || '').trim();
        const role = String(profile?.role || '').toLowerCase();
        const isEmployee = role === 'employee';
        const isPartTime = String(profile?.employment_type || '').toLowerCase() === 'part_time' || String(detail?.user?.employment_type || '').toLowerCase() === 'part_time' || String(profile?.shift?.id || '').includes('baito') || String(detail?.user?.shift_id || '').includes('baito');

      if (isPartTime) {
        if (kubunInitRaw === '休み') {
          kubunInitRaw = '休日';
        }
      }

      // Luôn thêm 休日 vào các lựa chọn nếu là admin/manager
    
      let kubunOptions = [];
      if (isPartTime) {
        // Part-time: chỉ 5 lựa chọn cần thiết, không có 半休/代替休日/振替出勤/休日出勤
        kubunOptions = ['出勤', '休日', '欠勤', '有給休暇'];
      } else {
        if (offDay) {
          kubunOptions = ['休日', '休日出勤', '代替出勤', '振替出勤'];
        } else {
          kubunOptions = ['出勤', '半休', '半休(有給)', '欠勤', '有給休暇', '無給休暇', '代替休日'];
          if (!isEmployee) {
            kubunOptions.unshift('休日');
          }
        }
      }

      const shiftStart = String(shift?.start_time || '08:00').trim();
      const shiftEnd = String(shift?.end_time || '17:00').trim();
      const shiftStartOk = /^\d{1,2}:\d{2}$/.test(shiftStart);
      const shiftEndOk = /^\d{1,2}:\d{2}$/.test(shiftEnd);
      const inHmRaw = fromDateTime(seg?.checkIn);
      const outHmRaw = fromDateTime(seg?.checkOut);
      const segWt = String(seg?.workType || '').trim();
      const segLabels = String(seg?.labels || '').trim();
      // Bỏ qua các dòng placeholder dạng ca (dòng auto theo kế hoạch), chỉ giữ chấm công thật.
      const isShiftPlaceholder = false;
      const inHm = isShiftPlaceholder ? '' : inHmRaw;
      const outHm = isShiftPlaceholder ? '' : outHmRaw;
      
      const hasActualIn = !!inHm;
      const hasActualOut = !!outHm;
      const hasActual = hasActualIn || hasActualOut;

      // Dữ liệu đã lưu của nhân viên phải hiển thị đúng như đã lưu, không tự đổi/xoá: nếu kubun đã lưu
      // không có trong danh sách lựa chọn của ngày (vd 休日出勤 trên Thứ 7 nay là ngày làm việc theo 休日設定)
      // thì thêm nó vào danh sách để giữ nguyên giá trị.
      if (kubunInitRaw && !kubunOptions.includes(kubunInitRaw)) kubunOptions.push(kubunInitRaw);
      let kubunInit = kubunOptions.includes(kubunInitRaw) ? kubunInitRaw : ''; 
      let plannedLabel = offDay ? '【休日予定】' : '【出勤予定】';
      let plannedKubun = offDay ? '休日' : '出勤';
      
      // Nếu đã có giờ checkIn hoặc checkOut, xóa bỏ chữ "予定" vì đã thành sự thật
      if (hasActualIn || hasActualOut) {
        plannedLabel = offDay ? '休日' : '出勤';
      }

      // Đối với part-time, ngày thường (không phải offDay) là lịch linh hoạt (không có lịch cố định)
      // Nhưng các ngày offDay (Thứ 7, CN, Lễ) vẫn là ngày nghỉ cố định của công ty.
      if (isPartTime) {
        // Kiểm tra dữ liệu đăng ký ca làm việc (Shift Request) từ trang シフト登録
        if (shiftRequest) {
          if (shiftRequest.status === 'WORKING') {
            plannedLabel = (hasActualIn || hasActualOut) ? '出勤' : '【出勤予定】';
            plannedKubun = '出勤';
          } else if (shiftRequest.status === 'OFF') {
            plannedLabel = (hasActualIn || hasActualOut) ? '休日' : '【休日予定】';
            plannedKubun = '休日';
          } else {
            // shiftRequest = 'NONE' hoặc không rõ ràng, xử lý theo ngày lễ
            plannedLabel = offDay ? ((hasActualIn || hasActualOut) ? '休日' : '【休日予定】') : '【予定なし】';
            plannedKubun = offDay ? '休日' : '';
          }
        } else {
          // Nếu không có dữ liệu đăng ký ca, áp dụng quy tắc ngày nghỉ cố định của công ty
          if (offDay) {
            plannedLabel = (hasActualIn || hasActualOut) ? '休日' : '【休日予定】';
            plannedKubun = '休日';
          } else {
            plannedLabel = '【予定なし】';
            plannedKubun = '';
          }
        }
      } else {
        // Đối với Seishain
        if (shiftRequest) {
          if (shiftRequest.status === 'LEAVE') {
             const lType = shiftRequest.leaveType;
             if (lType === 'paid') {
               plannedKubun = '有給休暇';
               plannedLabel = '【有給休暇】';
             } else if (lType === 'unpaid') {
               plannedKubun = '欠勤';
               plannedLabel = '【欠勤】';
             } else if (lType === 'special') {
               plannedKubun = '無給休暇';
               plannedLabel = '【無給休暇】';
             }
             
             // Nếu chưa có lý do được lưu, lấy lý do từ shift_request
             if (!daily?.reason && shiftRequest.reason) {
                if (daily) daily.reason = shiftRequest.reason;
             }
          } else if (shiftRequest.status === 'WORKING') {
            // Kiểm tra detail để xác định kiểu đi làm ngày nghỉ (振替出勤 hoặc 休日出勤)
            const detail = String(shiftRequest.detail || shiftRequest.reason || '').trim();
            if (offDay && detail === '休日出勤') {
              plannedLabel = (hasActualIn || hasActualOut) ? '休日出勤' : '【休日出勤】';
              plannedKubun = '休日出勤';
            } else if (offDay && detail === '振替出勤') {
              plannedLabel = (hasActualIn || hasActualOut) ? '振替出勤' : '【振替出勤】';
              plannedKubun = '振替出勤';
            } else if (offDay) {
              plannedLabel = (hasActualIn || hasActualOut) ? '休日出勤' : '【休日出勤】';
              plannedKubun = '休日出勤';
            } else {
              plannedLabel = (hasActualIn || hasActualOut) ? '出勤' : '【出勤予定】';
              plannedKubun = '出勤';
            }
          } else if (shiftRequest.status === 'OFF') {
            plannedLabel = (hasActualIn || hasActualOut) ? '休日' : '【休日予定】';
            plannedKubun = '休日';
          }
        }
      }

      // Tự động 休日: backend đã xác định ngày này (đã đến ngày, không chấm công,
      // không có kubun/ca đi làm cụ thể) nên hiển thị 休日 luôn — không còn 予定なし/【休日予定】,
      // không bắt nhân viên phải nhập tay. Chọn thẳng option "休日" thật để tránh
      // trùng lặp (placeholder + option cùng chữ "休日").
      const isAutoHolidayDay = !!autoOff && !hasActualIn && !hasActualOut && !kubunInit;
      if (isAutoHolidayDay) {
        kubunInit = '休日';
        plannedKubun = '休日';
      }

      const workKubunSet = new Set(['出勤', '半休', '半休(有給)', '振替出勤', '休日出勤', '代替出勤']);
      const effectiveKubun = kubunInit || plannedKubun;
      const isWorkDay = workKubunSet.has(effectiveKubun);
      const isHankyuu = effectiveKubun === '半休' || effectiveKubun === '半休(有給)';
      const isHolidayKubun = effectiveKubun === '休日' || effectiveKubun === '代替休日' || effectiveKubun === '休み';
      // 正社員が休日 (部署の休日設定で休みの日) に出勤、または 休日出勤: 定時が無いので遅刻・早退は付けない。
      // 6時間以下の勤務なら休憩の既定値は 0 (労基法: 6時間以下は休憩不要)。
      const isHolidayWork = !isPartTime && isWorkDay && (!!offDay || effectiveKubun === '休日出勤');

      // Nếu là ngày nghỉ nhưng đã có check-in/out thực tế mà kubun chưa đặt thì suy ra 休日出勤 để hiển thị
      // Part-time: đi làm ngày nghỉ vẫn tính cùng mức lương nên coi là 出勤 (không phải 休日出勤)
      if (offDay && !kubunInit) {
        if (hasActual) kubunInit = isPartTime ? '出勤' : '休日出勤';
      }
      // Chỉ coi dòng là "thực tế" khi có giờ chấm công hiển thị (không phải placeholder).
      // Với các phân loại ngày làm việc, chỉ chấm công thật mới làm dòng thành "thực tế".
      // Điều này tránh việc giá trị auto/theo kế hoạch bị hiển thị như 出勤 đã xác nhận.
      // Giữ hiển thị kubun đã lưu rõ ràng ngay cả khi chưa có check-in/out.
      // Logic cũ ẩn kubun làm việc (ví dụ 出勤) trừ khi có chấm công thực tế,
      // khiến sau khi reload trông như "chưa lưu".
      // Không reset kubunInit của ngày auto-休日 (nó là 休日 do hệ thống tự đặt, không phải chưa lưu)
      const allowDailyAsActual = hasActual || kubunConfirmed || isAutoHolidayDay;
      if (!allowDailyAsActual) kubunInit = '';

      // Ngày auto-休日 coi như đã xác định: không phải "予定/未申請" và không làm mờ dòng.
      const isPlanned = !isAutoHolidayDay && !kubunInit && !hasActual && !kubunConfirmed;
      const canEditWorkRow = !!state.editableMonth && ((isWorkDay || hasActual) && !!kubunInit || !isEmployee);
      
      // Coi các dòng ngày làm việc mà không có checkin/checkout thật là dạng theo kế hoạch để làm mờ.
      const isPlannedLikeWork = !hasActual && isWorkDay;

      // Kiểm tra quyền: nếu là employee mà đã có lựa chọn hoặc dữ liệu thực tế thì tắt các lựa chọn theo kế hoạch
      const disablePlanned = isEmployee && (kubunInit !== '' || hasActual);

      // CHỐT: Chỉ hiển thị giờ dự kiến nếu là ngày đi làm (isWorkDay) HOẶC là ngày nghỉ nhưng có dữ liệu làm việc (hasActual). Ngày nghỉ không có lịch làm việc thì để trống.
      // Cho phép part-time chưa nộp lịch (ngày thường) cũng hiện giờ làm mặc định nhạt.
      const isPartTimeNoPlanOnWorkDay = isPartTime && !offDay && !plannedKubun && !kubunInit;
      // CHỐT: Nếu kubun là ngày nghỉ (代替休日, 休日, 休み), hoặc nghỉ phép (有給, 無給, 欠勤), LUÔN ẩn giờ dù có actual data
      // 半休: chỉ hiện giờ nếu có actual data (không auto-fill giờ mặc định)
      const isLeaveKubun = effectiveKubun === '有給休暇' || effectiveKubun === '無給休暇' || effectiveKubun === '欠勤';
      const shouldShowDefaultShift = (isHolidayKubun || isLeaveKubun) ? false : (isHankyuu ? hasActual : (isWorkDay || hasActual || isPartTimeNoPlanOnWorkDay));

      // ĐỐI VỚI CA PHỤ (!primary): Không tự động điền giờ dự kiến, để trống cho người dùng tự nhập.
      const finalIn = shouldShowDefaultShift ? (inHm || (primary ? shiftStart : '')) : '';
      const finalOut = shouldShowDefaultShift ? (outHm || (primary ? shiftEnd : '')) : '';

      // QUAN TRỌNG: Gán cờ manual cho ô nếu đã có dữ liệu thực tế (checkIn/checkOut không phải tự động)
      const isManualIn = !!inHm;
      const isManualOut = !!outHm;

      const autoIn = primary && shouldShowDefaultShift && !inHm && shiftStartOk;
      const autoOut = primary && shouldShowDefaultShift && !outHm && shiftEndOk;
      
      // Logic hiển thị ở cấp từng ô:
      const inAutoCls = autoIn ? 'is-auto' : '';
      const outAutoCls = autoOut ? 'is-auto' : '';

      // Cho phép sửa giờ checkIn/checkOut nếu:
      // 1. Không phải employee (admin/manager) HOẶC
      // 2. Là employee nhưng dòng này là dòng phụ (không phải primary) - tức là dòng mới thêm hoặc ca thứ 2, thứ 3
      const canEditCheckTime = canEditWorkRow && (!isEmployee || !primary);
      const canEditBreakTime = canEditWorkRow;

      const shiftBrRaw = Number(shift?.break_minutes ?? 60);
      const shiftBrMin = Number.isFinite(shiftBrRaw) && shiftBrRaw >= 0 ? shiftBrRaw : 60;
      
      let defaultBr = 60;
      if (isHankyuu) {
        defaultBr = 0;
      } else if (shift && shift.break_minutes != null) {
        defaultBr = Number(shift.break_minutes);
      } else if (isPartTime) {
        const sM = parseHm(shiftStart);
        const eM = parseHm(shiftEnd);
        if (sM && eM && (eM.total - sM.total <= 5 * 60)) {
          defaultBr = 0;
        }
      }
      if (isHolidayWork && finalIn && finalOut) {
        const spanMin = diffMinutesAllowOvernight(finalIn, finalOut);
        if (spanMin != null && spanMin > 0 && spanMin <= 6 * 60) defaultBr = 0;
      }

      // Nếu dòng này là giờ tự động (chưa có check-in thực tế), ưu tiên dùng giờ nghỉ mặc định của ca (defaultBr)
      // Nhưng nếu user đã lưu breakMinutes thủ công, dùng giá trị đã lưu.
      // 半休: break luôn = 0 (làm nửa ngày không cần nghỉ trưa)
      const brMin = isHankyuu ? 0 : (shouldShowDefaultShift ? (primary ? (autoIn ? (daily && daily.breakMinutes !== null && daily.breakMinutes !== undefined ? Number(daily.breakMinutes) : defaultBr) : Number(daily?.breakMinutes ?? defaultBr)) : defaultBr) : 0);
      const nbMin = isHankyuu ? 0 : (shouldShowDefaultShift ? (primary ? (autoIn ? (daily && daily.nightBreakMinutes !== null && daily.nightBreakMinutes !== undefined ? Number(daily.nightBreakMinutes) : 0) : Number(daily?.nightBreakMinutes ?? 0)) : 0) : 0);
      const totalBmin = brMin + nbMin;

      // Show planned work hours (faded) only for work days
      const workHm = (shouldShowDefaultShift && finalIn && finalOut) ? (fmtWorkHours(finalIn, finalOut, totalBmin) || '') : '';
      const isAutoWork = shouldShowDefaultShift && (autoIn || autoOut) && !!workHm;
      const hasCompletedActual = hasActualIn && hasActualOut;
      const workAutoCls = (isAutoWork && !hasCompletedActual) ? 'is-auto' : '';

      // OT Calculation
      const whMin = (() => {
        let inEff = finalIn;
        if (shiftStartOk && finalIn && finalIn < shiftStart) inEff = shiftStart;
        const raw = diffMinutesAllowOvernight(inEff, finalOut);
        return (raw == null || raw <= 0) ? 0 : Math.max(0, raw - totalBmin);
      })();
      const otMin = (() => {
        const outM = parseHm(finalOut);
        const stM = parseHm(shiftStart);
        const etM = parseHm(shiftEnd);
        if (outM != null && etM != null) {
          const overnight = (stM != null && etM < stM);
          const endAbs = overnight ? (etM + 24 * 60) : etM;
          const outAbs = (overnight && stM != null && outM < stM) ? (outM + 24 * 60) : outM;
          return Math.max(0, outAbs - endAbs);
        }
        // Fallback: nếu không có shift info, giả định ca kết thúc 17:00
        if (outM != null) {
          const defaultEnd = 17 * 60;
          return Math.max(0, outM - defaultEnd);
        }
        return 0;
      })();
      const otHm = (hasActual && otMin > 0 && finalIn && finalOut) ? fmtHm(otMin) : '';
      const otAutoCls = (otMin > 0 && isAutoWork && !hasCompletedActual) ? 'is-auto' : '';

      const statusStr = String(state.currentMonthStatus || '');
      const approved = statusStr === 'approved';
      const approverName = String(detail?.monthStatus?.approverName || '').trim();
      const isAdminView = String(profile?.role || '').toLowerCase() === 'admin' || String(profile?.role || '').toLowerCase() === 'manager';
      const hasAny = !!(finalIn || finalOut);
      const leaveKubunSet = new Set(['休日', '代替休日', '有給休暇', '無給休暇', '欠勤']);
      const isRegularOffRow = !!isOff && !hasActual && (effectiveKubun === '休日' || effectiveKubun === '代替休日');
      const isLeaveApplied = !!kubunInit && leaveKubunSet.has(effectiveKubun) && !hasActual && !isRegularOffRow;
      let text = '未承認';
      let cls = 'warn';
      if (approved) {
        text = '承認済み';
        cls = 'ok';
      } else if (isPlanned && !hasActual) {
        text = '未申請';
        cls = 'warn';
      } else if (isLeaveApplied) {
        text = isAdminView ? '承認待ち' : '未確認';
        cls = 'warn';
      } else if (isRegularOffRow) {
        text = '—';
        cls = 'warn';
      } else if (hasActual) {
        text = isAdminView ? '承認待ち' : '未確認';
        cls = 'warn';
      } else {
        text = '—';
        cls = 'warn';
      }
      const st = {
        text,
        cls,
        approver: approved ? (approverName || '—') : '—'
      };

      const tr = document.createElement('tr');
      if (dow === '日') tr.classList.add('off', 'sun');
      else if (isOff) tr.classList.add('off', 'holiday');
      else if (dow === '土') tr.classList.add('sat');
      if (dow === '土' && (inHm || outHm)) tr.classList.add('worked');
      if (isPlanned) tr.classList.add('planned');
      if (hasActual) tr.classList.add('has-entry');
      if (!isWorkDay) tr.classList.add('leave');

      tr.dataset.row = '1';
      tr.dataset.date = dateStr;
      tr.dataset.baseOff = isOff ? '1' : '0';
      tr.dataset.id = seg?.id ? String(seg.id) : '';
      tr.dataset.clientId = tr.dataset.id ? '' : (seg?.clientId || makeClientId());
      tr.dataset.primary = primary ? '1' : '0';
      tr.dataset.kubunConfirmed = kubunConfirmed ? '1' : '';
      tr.dataset.shiftStart = shiftStartOk ? shiftStart : '08:00';
      tr.dataset.lateMinutes = String(daily?.lateMinutes || daily?.late_minutes || '');
      tr.dataset.earlyMinutes = String(daily?.earlyMinutes || daily?.early_minutes || '');
      tr.dataset.reasonBase = String(daily?.reason || (shiftRequest && !isPartTime && shiftRequest.status === 'LEAVE' ? shiftRequest.reason : ''));

      const wtValRaw = (() => {
        const dailyWt = allowDailyAsActual && primary ? daily?.workType : '';
        const v = String(seg?.workType || dailyWt || '').trim();
        return (v === 'onsite' || v === 'remote' || v === 'satellite') ? v : '';
      })();
      tr.dataset.workTypeBase = wtValRaw;

      const wtVal = (() => {
        if (isHolidayKubun || effectiveKubun === '欠勤') return '';
        return wtValRaw;
      })();
      tr.dataset.workType = wtVal;
      
      const dLoc = String(daily?.location || '');
      const dMemo = String(daily?.memo || '');
      const dReason = String(daily?.reason || (shiftRequest && !isPartTime && shiftRequest.status === 'LEAVE' ? shiftRequest.reason : ''));
      const dNotes = String(daily?.notes || '');
      // Đối với dòng phụ, `location`, `memo` (作業内容) và `notes` (備考) phải là dữ liệu của segment đó (nếu có), nếu không có thì để trống
      // Tránh việc copy y nguyên dữ liệu của ngày (dLoc, dMemo, dNotes) xuống các dòng phụ
      const segLoc = String(seg?.location || '');
      const segMemo = String(seg?.memo || '');
      const segNotes = String(seg?.notes || '');
      
      // Cho phép primary dòng sử dụng giá trị của segment nếu có (khi đã được lưu), nếu không thì fallback về daily
      const finalLoc = primary ? (segLoc || dLoc) : segLoc;
      const finalMemo = primary ? (segMemo || dMemo) : segMemo;
      const finalNotes = primary ? (segNotes || dNotes) : segNotes;
      
      const isHolidayHide = isHolidayKubun || isLeaveKubun || isHankyuu;
      const hideStyle = isHolidayHide ? 'visibility: hidden;' : '';
      // 半休: chỉ ẩn break, không ẩn checkboxes (出社/在宅/現場)
      const hideCheckboxStyle = (isHolidayKubun || isLeaveKubun) ? 'visibility: hidden;' : '';
      const brVal = (() => {
        if (!shouldShowDefaultShift) return '0:00';
        if (brMin === 180) return '3:00';
        if (brMin === 150) return '2:30';
        if (brMin === 120) return '2:00';
        if (brMin === 90) return '1:30';
        if (brMin === 60) return '1:00';
        if (brMin === 45) return '0:45';
        if (brMin === 30) return '0:30';
        if (brMin === 0) return '0:00';
        
        // Return calculated default if it doesn't match standard dropdown values
        if (brMin > 0) {
          const h = Math.floor(brMin / 60);
          const m = brMin % 60;
          return `${h}:${String(m).padStart(2, '0')}`;
        }
        
        return '1:00'; // fallback
      })();
      const nbVal = nbMin === 60 ? '1:00' : nbMin === 30 ? '0:30' : '0:00';

      const dowColor = (isOff && dow !== '土') || dow === '日' ? '#e11d48' : (dow === '土') ? '#1d4ed8' : '#334155';
      const dateMmdd = dateStr.slice(5).replace('-', '/');
      const todayStr = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
      const isFuture = dateStr > todayStr;
      
      tr.dataset.locationBase = finalLoc;
      tr.dataset.memoBase = finalMemo;
      tr.dataset.notesBase = finalNotes;
      tr.dataset.actualIn = hasActualIn ? inHm : '';
      tr.dataset.actualOut = hasActualOut ? outHm : '';

      const kubunOptionsHtml = `
      <option value="" ${disablePlanned ? 'disabled' : ''} ${kubunInit === '' ? 'selected' : ''}>${esc(plannedLabel)}</option>
      ${kubunOptions.map((k) => {
        let disabledOpt = '';
        let optStyle = '';
        if (k === '休日' || k === '代替休日') optStyle = 'color:#e11d48; font-weight:bold;';
        else if (k === '欠勤') optStyle = 'color:#ea580c; font-weight:bold;';
        
        return `<option value="${esc(k)}" ${kubunInit === k ? 'selected' : ''} ${disabledOpt} style="${optStyle}">${esc(k)}</option>`;
      }).join('')}
    `;

      let goOutHtml = '';
      if (goOutRecords && goOutRecords.length > 0) {
        const totalPrivate = goOutRecords.filter(g => g.type === '私用').length;
        const totalWork = goOutRecords.filter(g => g.type === '業務').length;
        let tooltip = goOutRecords.map(g => {
          const inTime = g.go_out_time ? g.go_out_time.slice(11, 16) : '--:--';
          const outTime = g.return_time ? g.return_time.slice(11, 16) : '--:--';
          return `${g.type}: ${inTime} - ${outTime}`;
        }).join('&#10;');
        
        let badges = [];
        if (totalWork > 0) badges.push(`<span class="se-badge" style="background:#0284c7;color:#fff;font-size:10px;padding:2px 4px;border-radius:4px;margin-right:2px;" title="${tooltip}">業務外出:${totalWork}</span>`);
        if (totalPrivate > 0) badges.push(`<span class="se-badge" style="background:#ea580c;color:#fff;font-size:10px;padding:2px 4px;border-radius:4px;" title="${tooltip}">私用外出:${totalPrivate}</span>`);
        
        goOutHtml = `<div style="margin-top:4px;">${badges.join('')}</div>`;
      }

      const kubunClass = kubunInit === '' ? 'is-planned' : (kubunInit === '休日' || kubunInit === '代替休日' ? 'is-holiday' : (kubunInit === '欠勤' ? 'is-absence' : ''));

      const rowId = seg?.id ? `id${seg.id}` : (seg?.clientId || makeClientId());

      tr.innerHTML = `
      <td class="sticky-col-1">${showDateDow ? `<span style="font-weight:900; color:${esc(dowColor)};">${esc(dateMmdd)}(${esc(dow)})</span>` : ''}</td>
      <td>
        <div class="se-kubun-wrap" style="${!showDateDow ? 'visibility:hidden;' : ''}">
          <select id="classification_${dateStr}_${rowId}" name="classification_${dateStr}_${rowId}" class="se-select se-kubun-select ${kubunClass}" data-field="classification" ${state.editableMonth ? '' : 'disabled'}>
            ${kubunOptionsHtml}
          </select>
          <input id="furikaeDate_${dateStr}_${rowId}" name="furikaeDate_${dateStr}_${rowId}" class="se-input se-furikae-date" data-field="furikaeHolidayDate" type="date" value="${esc(daily?.furikae_holiday_date ? String(daily.furikae_holiday_date).slice(0, 10) : '')}" title="振替休日の日付" placeholder="振替休日" style="width:110px;font-size:11px;margin-top:2px;${kubunInit === '振替出勤' ? '' : 'display:none;'}" ${state.editableMonth ? '' : 'disabled'}>
        </div>
      </td>
      <td style="width:56px;min-width:56px;max-width:56px;text-align:center;box-sizing:border-box;"><input id="ckOnsite_${dateStr}_${rowId}" name="ckOnsite_${dateStr}_${rowId}" class="se-check" data-field="ckOnsite" type="checkbox" ${wtVal === 'onsite' ? 'checked' : ''} style="${hideCheckboxStyle}" ${!canEditWorkRow ? 'disabled' : ''}></td>
      <td style="width:56px;min-width:56px;max-width:56px;text-align:center;box-sizing:border-box;"><input id="ckRemote_${dateStr}_${rowId}" name="ckRemote_${dateStr}_${rowId}" class="se-check" data-field="ckRemote" type="checkbox" ${wtVal === 'remote' ? 'checked' : ''} style="${hideCheckboxStyle}" ${!canEditWorkRow ? 'disabled' : ''}></td>
      <td style="width:56px;min-width:56px;max-width:56px;text-align:center;box-sizing:border-box;"><input id="ckSatellite_${dateStr}_${rowId}" name="ckSatellite_${dateStr}_${rowId}" class="se-check" data-field="ckSatellite" type="checkbox" ${wtVal === 'satellite' ? 'checked' : ''} style="${hideCheckboxStyle}" ${!canEditWorkRow ? 'disabled' : ''}></td>
      <td><input id="location_${dateStr}_${rowId}" name="location_${dateStr}_${rowId}" class="se-input" data-field="location" type="text" value="${esc(finalLoc)}" style="${hideCheckboxStyle}${wtVal !== 'satellite' ? 'visibility:hidden;' : ''}" ${!canEditWorkRow ? 'disabled' : ''}></td>
      <td><textarea id="memo_${dateStr}_${rowId}" name="memo_${dateStr}_${rowId}" class="se-input" data-field="memo" rows="1" style="resize:vertical; min-height:28px; ${hideCheckboxStyle}" ${!canEditWorkRow ? 'disabled' : ''}>${esc(finalMemo)}</textarea></td>
      <td class="se-time-cell">
        <div class="se-time-wrap">
          <input id="checkIn_${dateStr}_${rowId}" name="checkIn_${dateStr}_${rowId}" class="se-time ${inAutoCls}" data-field="checkIn" type="time" value="${esc(finalIn)}" ${!canEditCheckTime ? 'disabled data-fixed-disabled="1"' : ''} data-auto="${autoIn ? '1' : ''}" data-auto-val="${esc(autoIn ? shiftStart : '')}" data-manual="${isManualIn ? '1' : ''}" data-actual="${esc(inHm)}">
        </div>
      </td>
      <td class="se-time-cell">
        <div class="se-time-wrap">
          <input id="checkOut_${dateStr}_${rowId}" name="checkOut_${dateStr}_${rowId}" class="se-time ${outAutoCls}" data-field="checkOut" type="time" value="${esc(finalOut)}" ${!canEditCheckTime ? 'disabled data-fixed-disabled="1"' : ''} data-auto="${autoOut ? '1' : ''}" data-auto-val="${esc(autoOut ? shiftEnd : '')}" data-manual="${isManualOut ? '1' : ''}" data-actual="${esc(outHm)}">
        </div>
      </td>
      <td>
        <select id="break_${dateStr}_${rowId}" name="break_${dateStr}_${rowId}" class="se-select" data-field="break" ${!canEditBreakTime ? 'disabled data-fixed-disabled="1"' : ''} data-actual="${esc(brVal)}" ${!isHankyuu && daily && (daily.breakMinutes !== null && daily.breakMinutes !== undefined) ? 'data-manual="1"' : ''} data-auto="0" style="${hideStyle}">
          <option value="3:00" ${brVal === '3:00' ? 'selected' : ''}>3:00</option>
          <option value="2:30" ${brVal === '2:30' ? 'selected' : ''}>2:30</option>
          <option value="2:00" ${brVal === '2:00' ? 'selected' : ''}>2:00</option>
          <option value="1:30" ${brVal === '1:30' ? 'selected' : ''}>1:30</option>
          <option value="1:00" ${brVal === '1:00' ? 'selected' : ''}>1:00</option>
          <option value="0:45" ${brVal === '0:45' ? 'selected' : ''}>0:45</option>
          <option value="0:30" ${brVal === '0:30' ? 'selected' : ''}>0:30</option>
          <option value="0:00" ${brVal === '0:00' ? 'selected' : ''}>0:00</option>
          ${!['3:00','2:30','2:00','1:30','1:00','0:45','0:30','0:00'].includes(brVal) ? `<option value="${esc(brVal)}" selected>${esc(brVal)}</option>` : ''}
        </select>
      </td>
      <td>
        <select id="nightBreak_${dateStr}_${rowId}" name="nightBreak_${dateStr}_${rowId}" class="se-select" data-field="nightBreak" ${!canEditBreakTime ? 'disabled data-fixed-disabled="1"' : ''} data-actual="${esc(nbVal)}" data-auto="0" ${daily && (daily.nightBreakMinutes !== null && daily.nightBreakMinutes !== undefined) ? 'data-manual="1"' : ''} style="${hideStyle}">
          <option value="0:00" ${nbVal === '0:00' ? 'selected' : ''}>0:00</option>
          <option value="0:30" ${nbVal === '0:30' ? 'selected' : ''}>0:30</option>
          <option value="1:00" ${nbVal === '1:00' ? 'selected' : ''}>1:00</option>
        </select>
      </td>
      <td data-field="worked" class="${workAutoCls}" style="text-align:center; font-weight:900;color:#0f172a; font-size:12px; letter-spacing:-0.5px;">${esc(workHm)}</td>
      <td data-field="excess" class="${otAutoCls}" style="text-align:center;color:#0f172a;font-weight:900; font-size:12px; letter-spacing:-0.5px;">${esc(otHm)}</td>
      <td data-field="lateEarly" style="text-align:center;color:#64748b;">${(() => {
        if (!isWorkDay) return '—';
        // 半休/半休(有給) は半日休みが正規のため遅刻・早退を計上しない
        if (isHankyuu) return '—';
        // Không tính đi muộn / về sớm cho các ca làm thêm (dòng phụ)
        if (!primary) return '—';
        
        const inM = parseHm(finalIn);
        const stM = parseHm(shiftStart);
        const outM = parseHm(finalOut);
        const etM = parseHm(shiftEnd);
        const late = !isHolidayWork && (inM!=null && stM!=null && inM>stM);
        const early = (() => {
          if (isHolidayWork) return false;
          if (outM==null || stM==null || etM==null) return false;
          const overnight = etM < stM;
          const endAbs = overnight ? (etM + 24*60) : etM;
          const outAbs = overnight && outM < stM ? (outM + 24*60) : outM;
          return outAbs < endAbs;
        })();
        let txt = late && early ? '遅刻/早退' : late ? '遅刻' : early ? '早退' : '—';
        // 休日出勤日は以前 日次画面が自動保存した遅刻・早退分も表示しない (データ自体は変更しない)
        const lateMin = isHolidayWork ? 0 : Number(daily?.lateMinutes || daily?.late_minutes || 0);
        const earlyMin = isHolidayWork ? 0 : Number(daily?.earlyMinutes || daily?.early_minutes || 0);

        if (txt === '—' && (lateMin > 0 || earlyMin > 0)) {
           txt = lateMin > 0 && earlyMin > 0 ? '遅刻/早退' : lateMin > 0 ? '遅刻' : '早退';
        }
        
        let sub = [];
        if (lateMin > 0) sub.push(`遅刻:${lateMin}分`);
        if (earlyMin > 0) sub.push(`早退:${earlyMin}分`);
        if (sub.length > 0) {
          return `<div>${txt === '—' ? '' : txt}</div><div style="font-size:10px; color:#ef4444; line-height:1.2; margin-top:2px;">${sub.join('<br>')}</div>`;
        }
        return txt;
      })()}</td>
      <td>
        <div style="${!showDateDow ? 'visibility:hidden;' : ''}">
          <select id="reason_${dateStr}_${rowId}" name="reason_${dateStr}_${rowId}" class="se-select" data-field="reason" ${state.editableMonth ? '' : 'disabled'} style="width:140px;${(effectiveKubun === '欠勤' || effectiveKubun === '遅刻' || effectiveKubun === '早退' || effectiveKubun === '有給休暇' || effectiveKubun === '無給休暇' || effectiveKubun === '代替休日' || Number(daily?.lateMinutes || daily?.late_minutes || 0) > 0 || Number(daily?.earlyMinutes || daily?.early_minutes || 0) > 0 || (isWorkDay && finalIn && shiftStartOk && parseHm(finalIn) != null && parseHm(shiftStart) != null && parseHm(finalIn) > parseHm(shiftStart))) ? '' : 'visibility:hidden;'}">
            <option value=""></option>
            <option value="私用" ${dReason === '私用' || dReason === 'private' || dReason === '私用のため' ? 'selected' : ''}>私用</option>
            <option value="私用（詳細）" ${dReason === '私用（詳細）' ? 'selected' : ''}>私用（詳細）</option>
            <option value="体調不良" ${dReason === '体調不良' ? 'selected' : ''}>体調不良</option>
            <option value="家庭の事情" ${dReason === '家庭の事情' ? 'selected' : ''}>家庭の事情</option>
            <option value="定期健診" ${dReason === '定期健診' ? 'selected' : ''}>定期健診</option>
            <option value="通院" ${dReason === '通院' ? 'selected' : ''}>通院</option>
            <option value="交通機関の乱れ" ${dReason === '交通機関の乱れ' ? 'selected' : ''}>交通機関の乱れ</option>
            <option value="悪天候" ${dReason === '悪天候' ? 'selected' : ''}>悪天候</option>
            <option value="事故" ${dReason === '事故' ? 'selected' : ''}>事故</option>
            <option value="忌引" ${dReason === '忌引' ? 'selected' : ''}>忌引</option>
            <option value="その他" ${dReason === 'その他' || dReason === 'other' ? 'selected' : ''}>その他</option>
          </select>
        </div>
      </td>
      <td>
        <div>
          <input id="notes_${dateStr}_${rowId}" name="notes_${dateStr}_${rowId}" class="se-input" data-field="notes" type="text" value="${esc(finalNotes)}" ${!state.editableMonth ? 'disabled' : ''} style="width:100%; box-sizing:border-box;" placeholder="">
          ${goOutHtml}
        </div>
      </td>
      <td>
        <div class="se-status-wrap">
          <span class="se-status ${esc(st.cls)}">${esc(st.text)}</span>
        </div>
      </td>
      <td style="text-align:center;color:#0f172a;font-weight:800;">${showDateDow ? esc(st.approver) : '—'}</td>
      <td style="text-align:center;">
         <div style="display:flex; justify-content:center; gap:4px; flex-wrap:wrap;">
           ${showDateDow ? `<button type="button" class="se-icon-btn primary" data-action="add" ${(state.editableMonth && canAddMore) ? '' : 'disabled'} title="${canAddMore ? '行追加' : '1日は最大3件まで'}" style="font-weight:bold; font-size:14px; padding:0; width:22px; height:22px;">+</button>` : ''}
           <button type="button" class="se-icon-btn secondary" data-action="clear" ${state.editableMonth ? '' : 'disabled'} title="行クリア" style="padding:0; width:22px; height:22px;">×</button>
           ${(isAdminView && hasActualOut) ? `<button type="button" class="se-icon-btn warn" data-action="clear-checkout" ${state.editableMonth ? '' : 'disabled'} title="退勤打刻を削除（チェックインのみ残す）" style="font-size:10px; padding:0 3px; width:auto; min-width:30px; height:22px; background:#fef3c7; color:#92400e; border:1px solid #f59e0b;">退勤削除</button>` : ''}
         </div>
       </td>
      <td style="text-align:center;">${showDateDow ? `<button type="button" class="se-mini-btn" data-action="history">表示</button>` : ''}</td>
    `;
      return tr;
    };

    for (const d of days) {
      const dateStr = String(d?.date || '');
      const isOff = Number(d?.is_off || 0) === 1;
      const shift = d?.shift || null;
      const daily = d?.daily || null;
      const segs = Array.isArray(d?.segments) ? d.segments : [];
      const goOutRecords = Array.isArray(d?.goOutRecords) ? d.goOutRecords : [];
      
      // Lấy tất cả segments, sắp xếp theo giờ checkIn (tăng dần). Các dòng trống (chưa có checkIn) sẽ nằm ở cuối.
      const list0 = segs.length ? [...segs].sort((a, b) => {
        const timeA = String(a?.checkIn || '');
        const timeB = String(b?.checkIn || '');
        if (!timeA && timeB) return 1; // A trống thì A nằm sau
        if (timeA && !timeB) return -1; // B trống thì B nằm sau
        return timeA.localeCompare(timeB);
      }) : [null];
      const canAddMore = list0.length < 3;
      
      for (let i = 0; i < list0.length; i++) {
        const seg = list0[i];
        const isFirst = (i === 0);
        tbody.appendChild(buildTr(dateStr, isOff, shift, daily, seg, goOutRecords, isFirst, d.shiftRequest, canAddMore, Number(d?.autoOff || 0) === 1));
      }
    }
    table.appendChild(tbody);
    // Use native sticky header via CSS; avoid cloning header to prevent drift
    host.innerHTML = '';
    const isLocked = !state.editableMonth;
    const wrapClass = isLocked ? 'se-month-table-wrap is-locked' : 'se-month-table-wrap';
    const container = document.createElement('div');
    container.className = wrapClass;
    const scrollWrap = document.createElement('div');
    scrollWrap.className = 'se-month-scroll';
    scrollWrap.appendChild(table);
    container.appendChild(scrollWrap);
    host.appendChild(container);

    // Force style refresh if locked
    if (isLocked) {
      requestAnimationFrame(() => {
        container.classList.add('is-locked-ready');
      });
    }

    // Sync column widths to avoid drift across environments
    // Apply immediately (not in requestAnimationFrame) to prevent initial layout shift
    const syncCols = (attempt = 0) => {
      try {
        const active = document.activeElement;
        if (active && table.contains(active)) {
          const tag = String(active.tagName || '').toLowerCase();
          const type = tag === 'input' ? String(active.getAttribute('type') || '').toLowerCase() : '';
          if (type === 'time') return;
        }
        
        const defaultWidths = [
          75, 110, 45, 45, 45, 120, 150, 80, 80, 75, 75, 70, 70, 80, 100, 150, 90, 80, 50, 50
        ]; // 20 columns
        
        const cg = document.createElement('colgroup');
        for (const w of defaultWidths) {
          const col = document.createElement('col');
          col.style.width = `${w}px`;
          cg.appendChild(col);
        }
        table.querySelector('colgroup')?.remove();
        table.insertAdjacentElement('afterbegin', cg);
        table.style.tableLayout = 'fixed';
      } catch (e) { /* silently ignored */ }
    };
    syncCols(); // Apply immediately to prevent initial layout shift
    try {
      const key = '__seMonthlyColSync';
      const w = window;
      if (!w[key]) {
        w[key] = { handlers: new Set() };
        window.addEventListener('resize', () => {
          try {
            requestAnimationFrame(() => {
              const hs = w[key]?.handlers;
              if (!hs) return;
              for (const fn of Array.from(hs)) {
                try { fn(); } catch (e) { /* silently ignored */ }
              }
            });
          } catch (e) { /* silently ignored */ }
        }, { passive: true });
      }
      const reg = () => {
        if (!table.isConnected) {
          try { w[key]?.handlers?.delete(reg); } catch (e) { /* silently ignored */ }
          return;
        }
        syncCols();
      };
      w[key].handlers.add(reg);
    } catch (e) { /* silently ignored */ }
  };

  const renderTable = (host, detail, profile) => {
    renderTableFull(host, detail, profile);
  };

  const markRowSaved = (rowEl) => {
    try {
      rowEl.classList.add('saved');
      const token = String(Date.now());
      rowEl.dataset.savedAt = token;
      try { rowEl.dataset.dirty = ''; } catch (e) { /* silently ignored */ }
      setTimeout(() => {
        try {
          if (rowEl.dataset.savedAt !== token) return;
          rowEl.classList.remove('saved');
        } catch (e) { /* silently ignored */ }
      }, 5000);
    } catch (e) { /* silently ignored */ }
  };

  const recomputeRow = (rowEl) => {
    try {
      const dateStr = String(rowEl.dataset.date || '');
      const dow = dowJa(dateStr);
      const baseOff = String(rowEl.dataset.baseOff || '') === '1';
      
      const clsSel = rowEl.querySelector('select[data-field="classification"]');
      const inEl = rowEl.querySelector('input[data-field="checkIn"]');
      const outEl = rowEl.querySelector('input[data-field="checkOut"]');
      const brSel = rowEl.querySelector('select[data-field="break"]');
      const nbSel = rowEl.querySelector('select[data-field="nightBreak"]');
      const ckOn = rowEl.querySelector('input[data-field="ckOnsite"]');
      const ckRe = rowEl.querySelector('input[data-field="ckRemote"]');
      const ckSa = rowEl.querySelector('input[data-field="ckSatellite"]');
      const locEl = rowEl.querySelector('input[data-field="location"]');
      const reasonSel = rowEl.querySelector('select[data-field="reason"]');
      const memoEl = rowEl.querySelector('[data-field="memo"]');
      const notesEl = rowEl.querySelector('input[data-field="notes"]');
      const worked = rowEl.querySelector('[data-field="worked"]');
      const excess = rowEl.querySelector('[data-field="excess"]');
      const lateEarly = rowEl.querySelector('[data-field="lateEarly"]');
      const statusWrap = rowEl.querySelector('.se-status-wrap');
      const monthApproved = String(state.currentMonthStatus || '') === 'approved';
      if (monthApproved) {
        // Approved month must never appear as "unsaved" on row badges.
        try { rowEl.dataset.dirty = ''; } catch (e) { /* silently ignored */ }
      }

      const idVal = String(rowEl.dataset.id || '').trim();
      const confirmed = String(rowEl.dataset.kubunConfirmed || '') === '1';
      const inManual = String(inEl?.dataset?.manual || '') === '1';
      const outManual = String(outEl?.dataset?.manual || '') === '1';

      const cls = String(clsSel?.value || '').trim();
      const offDay = baseOff;
      const workKubunSet = new Set(['出勤', '半休', '半休(有給)', '振替出勤', '休日出勤', '代替出勤']);
      const effectiveKubun = cls || (offDay ? '休日' : '出勤');

      // Show/hide furikae date picker based on kubun
      const furikaeDateEl = rowEl.querySelector('input[data-field="furikaeHolidayDate"]');
      if (furikaeDateEl) {
        furikaeDateEl.style.display = cls === '振替出勤' ? '' : 'none';
      }
      const isHolidayKubun = effectiveKubun === '休日' || effectiveKubun === '代替休日';
      const isHankyuu = effectiveKubun === '半休' || effectiveKubun === '半休(有給)';
      const isLeaveKubun = effectiveKubun === '有給休暇' || effectiveKubun === '無給休暇' || effectiveKubun === '欠勤';
      const isWorkDay = workKubunSet.has(effectiveKubun);
      // 正社員の休日出勤: 遅刻・早退なし・6時間以下なら休憩既定 0 (初回描画と同じルール)
      const isPartTimeUser = String(state.currentMonthDetail?.user?.employment_type || '').toLowerCase() === 'part_time';
      const isHolidayWork = !isPartTimeUser && isWorkDay && (!!offDay || effectiveKubun === '休日出勤');
      const isPlanned = !cls && !idVal && !confirmed;
      
      let currentRole = '';
      try { currentRole = String(state?.profile?.role || '').toLowerCase(); } catch (e) { /* silently ignored */ }
      const isEmployee = currentRole === 'employee';
      const isPrimaryRow = String(rowEl.dataset.primary || '') === '1';
      
      const canEditWorkInputs = !!state.editableMonth && (isWorkDay && !!cls || !isEmployee);
      
      // Cho phép sửa giờ checkIn/checkOut nếu:
      // 1. Không phải employee (admin/manager) HOẶC
      // 2. Là employee nhưng dòng này là dòng phụ (không phải primary)
      const canEditCheckTime = canEditWorkInputs && (!isEmployee || !isPrimaryRow);
      const inValNow = String(inEl?.value || '').trim();
      const outValNow = String(outEl?.value || '').trim();
      const inAutoNow = String(inEl?.dataset?.auto || '') === '1';
      const outAutoNow = String(outEl?.dataset?.auto || '') === '1';
      const inAutoVal = String(inEl?.dataset?.autoVal || '').trim();
      const outAutoVal = String(outEl?.dataset?.autoVal || '').trim();
      const inIsPlannedAuto = !!(inValNow && inAutoNow && !inManual && inAutoVal && inValNow === inAutoVal);
      const outIsPlannedAuto = !!(outValNow && outAutoNow && !outManual && outAutoVal && outValNow === outAutoVal);
      const hasActualInNow = !!(inValNow && !inIsPlannedAuto);
      const hasActualOutNow = !!(outValNow && !outIsPlannedAuto);
      const hasActualNow = !!idVal || hasActualInNow || hasActualOutNow;
      const isPlannedLikeWork = isWorkDay && !hasActualNow;
      const visualPlanned = isPlanned || isPlannedLikeWork;

      if (clsSel) {
        clsSel.classList.toggle('is-planned', !cls);
      }

      [inEl, outEl].forEach((el) => {
        if (!el) return;
        if (canEditCheckTime) el.removeAttribute('disabled');
        else el.setAttribute('disabled', '');
      });
      
      [brSel, nbSel, ckOn, ckRe, ckSa].forEach((el) => {
        if (!el) return;
        if (canEditWorkInputs) {
          // 半休: ẩn break/nightBreak vì làm nửa ngày không cần nghỉ trưa
          if (isHankyuu && (el === brSel || el === nbSel)) {
            el.style.visibility = 'hidden';
          } else {
            el.removeAttribute('disabled');
            el.style.visibility = 'visible';
          }
        } else {
          el.setAttribute('disabled', '');
          if (isHolidayKubun || isLeaveKubun) {
            el.style.visibility = 'hidden';
          } else if (isHankyuu && (el === brSel || el === nbSel)) {
            el.style.visibility = 'hidden';
          }
        }
      });
      
      [locEl, memoEl].forEach((el) => {
        if (!el) return;
        if (canEditWorkInputs) {
          el.removeAttribute('disabled');
          // 現場(任意): only show when 現場 checkbox is checked
          if (el === locEl) {
            const isSatellite = ckSa && ckSa.checked;
            el.style.visibility = isSatellite ? 'visible' : 'hidden';
          } else {
            el.style.visibility = 'visible';
          }
        } else {
          el.setAttribute('disabled', '');
          if (isHolidayKubun || isLeaveKubun) {
            el.style.visibility = 'hidden';
          } else if (el === locEl) {
            const isSatellite = ckSa && ckSa.checked;
            el.style.visibility = isSatellite ? 'visible' : 'hidden';
          }
        }
      });
      if (notesEl) {
        if (state.editableMonth) {
          notesEl.removeAttribute('disabled');
        } else {
          notesEl.setAttribute('disabled', '');
        }
        notesEl.style.visibility = 'visible';
      }

      if (statusWrap) {
        let roleStr = currentRole;
        const isAdminView = roleStr === 'admin' || roleStr === 'manager';
        const isRegularOffRowNow = !!offDay && !hasActualNow && (effectiveKubun === '休日' || effectiveKubun === '代替休日');
        const leaveKubunSetNow = new Set(['休日', '代替休日', '有給休暇', '無給休暇', '欠勤']);
        const isLeaveAppliedNow = !!cls && leaveKubunSetNow.has(cls) && !hasActualNow && !isRegularOffRowNow;
        let stText = '未承認';
        let stCls = 'warn';
        if (monthApproved) {
          stText = '承認済み';
          stCls = 'ok';
        } else if (isPlanned && !hasActualNow) {
          stText = '未申請';
        } else if (isLeaveAppliedNow) {
          stText = isAdminView ? '承認待ち' : '未確認';
        } else if (isRegularOffRowNow) {
          stText = '—';
        } else if (hasActualNow) {
          stText = isAdminView ? '承認待ち' : '未確認';
        } else {
          stText = '未申請';
        }
        const stSpan = statusWrap.querySelector('span.se-status');
        if (stSpan) {
          if (stSpan.textContent !== stText) stSpan.textContent = stText;
          stSpan.classList.remove('ok','warn','danger');
          stSpan.classList.add(stCls);
        }
      }

      // Removed reason visibility logic from here

      // Update Planned option visibility/disability (Admin/Manager can always select Planned)
      const isEmployeeRole = currentRole === 'employee';
      if (clsSel && isEmployeeRole) {
        const plannedOpt = clsSel.querySelector('option[value=""]');
        if (plannedOpt) {
          const shouldDisable = !!cls || hasActualNow;
          if (plannedOpt.disabled !== shouldDisable) {
            plannedOpt.disabled = shouldDisable;
          }
        }
      } else if (clsSel && !isEmployeeRole) {
        // Admin/Manager can always select Planned
        const plannedOpt = clsSel.querySelector('option[value=""]');
        if (plannedOpt && plannedOpt.disabled) {
          plannedOpt.disabled = false;
        }
      }
      
      // Update options dynamically if needed based on role
      if (clsSel) {
        let hasHolidayOpt = false;
        Array.from(clsSel.options).forEach(opt => {
          if (opt.value === '休日') hasHolidayOpt = true;
        });
        
        if (!isEmployeeRole && !offDay && !hasHolidayOpt) {
           const newOpt = document.createElement('option');
           newOpt.value = '休日';
           newOpt.textContent = '休日';
           // Insert after the planned label (which is index 0)
           if (clsSel.options.length > 1) {
             clsSel.insertBefore(newOpt, clsSel.options[1]);
           } else {
             clsSel.appendChild(newOpt);
           }
        }
      }

      // Xử lý visual class cho dòng (Màu nền cuối tuần)
      const rowClasses = ['sun', 'holiday', 'sat', 'worked', 'planned', 'leave'];
      rowClasses.forEach(c => {
        const shouldHave = (c === 'sun' && dow === '日') ||
                          (c === 'holiday' && ! (dow === '日') && offDay) ||
                          (c === 'sat' && dow === '土') ||
                          (c === 'planned' && isPlanned) ||
                          (c === 'leave' && !isWorkDay);
        if (rowEl.classList.contains(c) !== shouldHave) {
          rowEl.classList.toggle(c, shouldHave);
        }
      });

      const dowSpan = rowEl.querySelector('td.sticky-col-1 span.dow');
      if (dowSpan) {
        const color = (offDay || dow === '日') ? '#b91c1c' : (dow === '土') ? '#1d4ed8' : '#334155';
        if (dowSpan.style.color !== color) dowSpan.style.color = color;
      }

      // Logic xóa giờ cho ngày nghỉ (Holiday)
      if (!isWorkDay && !!cls) {
        // Nếu là ngày nghỉ, chúng ta xóa trắng giờ nếu không phải đang có ID hoặc không phải là nhập tay mới
        // Tuy nhiên, nếu người dùng VỪA chọn sang "休日", chúng ta nên xóa luôn giờ cũ.
        if (inEl && inEl.value !== '') {
          inEl.value = '';
          inEl.dataset.auto = '';
          inEl.dataset.autoVal = '';
          inEl.dataset.manual = ''; // Reset manual flag when switching to holiday
        }
        if (outEl && outEl.value !== '') {
          outEl.value = '';
          outEl.dataset.auto = '';
          outEl.dataset.autoVal = '';
          outEl.dataset.manual = '';
        }
        if (brSel && brSel.value !== '0:00') {
          brSel.value = '0:00';
          brSel.dataset.auto = '';
        }
        if (nbSel && nbSel.value !== '0:00') nbSel.value = '0:00';
        if (ckOn && ckOn.checked) ckOn.checked = false;
        if (ckRe && ckRe.checked) ckRe.checked = false;
        if (ckSa && ckSa.checked) ckSa.checked = false;
      } else if (isWorkDay) {
        // 半休: giờ trống, nghỉ trưa 0:00, không auto-fill
        if (isHankyuu) {
          if (inEl && !inManual) {
            inEl.value = '';
            inEl.dataset.auto = '';
            inEl.dataset.autoVal = '';
          }
          if (outEl && !outManual) {
            outEl.value = '';
            outEl.dataset.auto = '';
            outEl.dataset.autoVal = '';
          }
          if (brSel && brSel.dataset.manual !== '1') {
            brSel.value = '0:00';
            brSel.dataset.auto = '1';
          }
          if (nbSel) nbSel.value = '0:00';
        } else {
        // Áp dụng giờ mặc định cho ngày đi làm
        const dayShift = (() => {
          try {
            const ds = dateStr.slice(0, 10);
            const days = Array.isArray(state.currentMonthDetail?.days) ? state.currentMonthDetail.days : [];
            return days.find(d => String(d?.date || '').slice(0, 10) === ds)?.shift || null;
          } catch (e) { return null; }
        })();
        const shiftStart = String(dayShift?.start_time || '08:00').trim();
        const shiftEnd = String(dayShift?.end_time || '17:00').trim();

        if (inEl && !String(inEl.value || '').trim() && !inManual) {
          inEl.value = shiftStart;
          inEl.dataset.auto = '1';
          inEl.dataset.autoVal = shiftStart;
        }
        if (outEl && !String(outEl.value || '').trim() && !outManual) {
          outEl.value = shiftEnd;
          outEl.dataset.auto = '1';
          outEl.dataset.autoVal = shiftEnd;
        }
        if (brSel && (!brSel.value || brSel.dataset.auto === '1') && brSel.dataset.manual !== '1') {
          let rawBr = 60;
          if (dayShift && dayShift.break_minutes != null) {
            rawBr = Number(dayShift.break_minutes);
          } else if (String(state.currentMonthDetail?.user?.employment_type || '').toLowerCase() === 'part_time') {
            const stM = parseHm(shiftStart);
            const etM = parseHm(shiftEnd);
            if (stM && etM && (etM.total - stM.total <= 5 * 60)) {
              rawBr = 0;
            }
          }
          if (isHolidayWork && inEl?.value && outEl?.value) {
            const spanMin = diffMinutesAllowOvernight(String(inEl.value), String(outEl.value));
            if (spanMin != null && spanMin > 0 && spanMin <= 6 * 60) rawBr = 0;
          }
          const brVal = rawBr === 45 ? '0:45' : rawBr === 30 ? '0:30' : rawBr === 0 ? '0:00' : '1:00';
          if (brSel.value !== brVal) {
            brSel.value = brVal;
            brSel.dataset.auto = '1';
          }
        }
        } // end else (non-半休 workday)
      } else {
        if (ckOn) ckOn.checked = false;
        if (ckRe) ckRe.checked = false;
        if (ckSa) ckSa.checked = false;
        rowEl.dataset.workType = '';
      }



      // Xử lý hiển thị ĐẬM / NHẠT
      const inVal = String(inEl?.value || '');
      const outVal = String(outEl?.value || '');
      
      const inAuto = String(inEl?.dataset?.auto || '') === '1';
      const outAuto = String(outEl?.dataset?.auto || '') === '1';

      // QUY TẮC HIỂN THỊ ĐẬM/NHẠT:
      // - Nhạt (is-auto) CHỈ KHI: (là giờ tự động) VÀ (trạng thái dự kiến - isPlanned) VÀ (CHƯA bị người dùng sửa - !inManual)
      if (inEl) {
        const hasVal = String(inEl.value || '').trim() !== '';
        const shouldBeAuto = inAuto && !inManual && !hasActualInNow;
        // Nếu có giá trị nhưng không phải là autoVal ban đầu, nó phải ĐẬM
        const forceBold = hasVal && inAuto && String(inEl.value) !== String(inEl.dataset.autoVal);
        const finalAuto = shouldBeAuto && !forceBold;
        if (inEl.classList.contains('is-auto') !== finalAuto) {
          inEl.classList.toggle('is-auto', finalAuto);
        }
      }
      if (outEl) {
        const hasVal = String(outEl.value || '').trim() !== '';
        const shouldBeAuto = outAuto && !outManual && !hasActualOutNow;
        const forceBold = hasVal && outAuto && String(outEl.value) !== String(outEl.dataset.autoVal);
        const finalAuto = shouldBeAuto && !forceBold;
        if (outEl.classList.contains('is-auto') !== finalAuto) {
          outEl.classList.toggle('is-auto', finalAuto);
        }
      }
      // Break / NightBreak: luôn hiển thị đậm (không bao giờ nhạt)
      if (brSel && brSel.classList.contains('is-auto')) {
        brSel.classList.remove('is-auto');
      }
      if (nbSel && nbSel.classList.contains('is-auto')) {
        nbSel.classList.remove('is-auto');
      }
      const b = String(brSel?.value || '0:00');
      const bmin = (() => {
        const pts = b.split(':');
        if (pts.length === 2) return (parseInt(pts[0], 10) || 0) * 60 + (parseInt(pts[1], 10) || 0);
        return 60;
      })();
      const nb = String(nbSel?.value || '0:00');
      const nbmin = (() => {
        const pts = nb.split(':');
        if (pts.length === 2) return (parseInt(pts[0], 10) || 0) * 60 + (parseInt(pts[1], 10) || 0);
        return 0;
      })();
      const totalBmin = bmin + nbmin;

      const dayShiftInfo = (() => {
        try {
          const ds = dateStr.slice(0, 10);
          const days = Array.isArray(state.currentMonthDetail?.days) ? state.currentMonthDetail.days : [];
          const s = days.find(d => String(d?.date || '').slice(0, 10) === ds)?.shift || null;
          if (!s) return null;
          const st = String(s.start_time || '08:00').trim();
          const et = String(s.end_time || '17:00').trim();
          const stM = parseHm(st);
          const etM = parseHm(et);
          return { st, et, stM, etM };
        } catch (e) { return null; }
      })();

      const whMin = (() => {
        if (!isWorkDay) return 0;
        let inEff = inVal;
        if (dayShiftInfo?.st && inVal && inVal < dayShiftInfo.st) inEff = dayShiftInfo.st;
        const raw = diffMinutesAllowOvernight(inEff, outVal);
        return (raw == null || raw <= 0) ? 0 : Math.max(0, raw - totalBmin);
      })();
      const otMin = (() => {
        if (!isWorkDay) return 0;
        const outM = parseHm(outVal);
        const stM = dayShiftInfo?.stM;
        const etM = dayShiftInfo?.etM;
        if (outM != null && etM != null) {
          const overnight = (stM != null && etM < stM);
          const endAbs = overnight ? (etM + 24 * 60) : etM;
          const outAbs = (overnight && stM != null && outM < stM) ? (outM + 24 * 60) : outM;
          return Math.max(0, outAbs - endAbs);
        }
        // Fallback: nếu không có shift info, giả định ca kết thúc 17:00
        if (outM != null) {
          const defaultEnd = 17 * 60; // 17:00
          return Math.max(0, outM - defaultEnd);
        }
        return 0;
      })();

      const whStr = !isWorkDay ? '' : (fmtWorkHours(inVal, outVal, totalBmin) || '');
      const isAutoWork = isWorkDay && (inAuto || outAuto) && !!whStr;

      if (worked) {
        const text = !isWorkDay ? '' : ((inVal && outVal) ? whStr : (isAutoWork ? whStr : ''));
        if (worked.textContent !== text) worked.textContent = text;
        const hasCompletedActualNow = hasActualInNow && hasActualOutNow;
        const shouldWorkAuto = isWorkDay && isAutoWork && !hasCompletedActualNow;
        if (worked.classList.contains('is-auto') !== shouldWorkAuto) {
          worked.classList.toggle('is-auto', shouldWorkAuto);
        }
      }
      if (excess) {
        const text = !isWorkDay ? '' : ((inVal && outVal && whMin > 0 && otMin > 0) ? fmtHm(otMin) : '');
        if (excess.textContent !== text) excess.textContent = text;
        const hasCompletedActualNow = hasActualInNow && hasActualOutNow;
        const shouldExcessAuto = isAutoWork && otMin > 0 && !hasCompletedActualNow;
        if (excess.classList.contains('is-auto') !== shouldExcessAuto) {
          excess.classList.toggle('is-auto', shouldExcessAuto);
        }
      }
      if (lateEarly) {
        let text = '—';
        // Chỉ tính toán đi muộn/về sớm cho dòng chính (primary row)
        // 半休/半休(有給) は半日休みが正規のため遅刻・早退を計上しない
        if (isPrimaryRow && !isHankyuu) {
          const a = parseHm(inVal);
          const b2 = parseHm(outVal);
          if (isWorkDay && a != null && b2 != null) {
            const baseStart = dayShiftInfo?.stM || (8 * 60);
            const baseEnd = dayShiftInfo?.etM || (17 * 60);
            const late = !isHolidayWork && a > baseStart;
            const early = !isHolidayWork && b2 < baseEnd;
            text = late && early ? '遅刻/早退' : late ? '遅刻' : early ? '早退' : '—';
            
            // Thêm cảnh báo nếu giờ quá bất thường
            if (a < 300 || (b2 > a && b2 > 1560) || (b2 < a && b2 > 120)) {
               lateEarly.style.color = '#e11d48'; // Màu đỏ cảnh báo
               text += ' (要確認)';
            } else {
               lateEarly.style.color = '#64748b';
            }
          }
        }
        if (lateEarly.textContent !== text) lateEarly.textContent = text;
      }

      // Update reason visibility/disability based on kubun and updated lateEarlyText
      if (reasonSel) {
        const lateEarlyText = lateEarly ? lateEarly.textContent : '—';
        const showReason = effectiveKubun === '欠勤' || effectiveKubun === '有給休暇' || effectiveKubun === '無給休暇' || effectiveKubun === '代替休日' || (lateEarlyText && lateEarlyText !== '—');
        if (showReason) {
          reasonSel.style.visibility = 'visible';
          reasonSel.disabled = !state.editableMonth;
        } else {
          // 現場(任意)と同じ理由で value は消さない — 保存時にこの select の value を
          // そのまま読むため (attendance-monthly.controller.js)、一時的に非表示になった
          // だけで選択済みの理由が消えてしまうと、後で条件が戻った時に選び直しが必要になる。
          reasonSel.style.visibility = 'hidden';
          reasonSel.disabled = true;
        }
      }

      if (clsSel) {
        const shouldBePlanned = !cls;
        clsSel.classList.toggle('is-planned', shouldBePlanned);
        clsSel.classList.toggle('is-holiday', cls === '休日' || cls === '代替休日');
        clsSel.classList.toggle('is-absence', cls === '欠勤');
      }
    } catch (e) { console.warn('recomputeRow error:', e); }
  };

  const mod = { renderTableFull, renderTable, markRowSaved, recomputeRow };
  root.Render = mod;
  globalThis.AttendanceMonthly = root;
  globalThis.MonthlyMonthlyRender = mod;
})();
