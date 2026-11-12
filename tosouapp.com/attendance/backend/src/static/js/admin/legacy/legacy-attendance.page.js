import{escapeHtml as v,delegate as Pt}from"../_shared/dom.js";import{api as vt,downloadWithAuth as Z}from"../../shared/api/client.js";import{createPage as Wt}from"../../shared/page/createPage.js";import{createCleanup as Xt}from"../../shared/page/createCleanup.js";async function Kt(F){return await kt(F)}async function kt({content:F,listUsers:tt,getTimesheet:Et,getAttendanceDay:Ft,updateAttendanceSegment:Gt,buildTimesheetExportURL:et}){const _=Xt();let B=!0;const ot=new AbortController,N=ot.signal;_.add(()=>{B=!1}),_.add(()=>ot.abort());let rt=[];try{if(!window.location.pathname.includes("/ui/attendance-records")&&typeof tt=="function"){const t=await tt({signal:N});rt=Array.isArray(t)?t:t&&Array.isArray(t.rows)?t.rows:[]}}catch(t){console.warn("Could not fetch users for dropdown:",t)}F.innerHTML="";const nt=t=>{if(!t)return"";const e=String(t);return e.length>=16?e.slice(11,16):e},Ct=t=>{try{const e=String(t||"").slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(e))return!1;const[r,i,o]=e.split("-").map(d=>parseInt(d,10)),a=new Date(Date.UTC(r,i-1,o)).getUTCDay();return a===0||a===6}catch{return!1}},z=new Date(Date.now()+9*3600*1e3).toISOString().slice(0,10),Dt=z.slice(0,7),it=new URLSearchParams(window.location.search).get("standalone")==="1"||window.location.pathname.includes("/ui/attendance-records");if(it)try{const t=document.querySelector(".topbar"),e=document.querySelector(".subbar");t&&(t.style.display="none"),e&&(e.style.display="none");const r=document.querySelector("#adminChrome");r&&(r.style.display="none"),document.body.style.paddingTop="0";const i=document.documentElement;i.style.setProperty("--topbar-height","0px"),i.style.setProperty("--subbar-height","0px")}catch{}const Jt=it?"100vh":"calc(100vh - var(--topbar-height) - var(--subbar-height))",b=document.createElement("div");b.style.cssText="margin: 0; padding: 0; width: 100%; display: flex; flex-direction: column;",b.innerHTML=`
    <style>
      
        
      .attrec-fiori-override {
        height: auto !important;
        overflow: visible !important;
      }
      .attrec-fiori-override .dash-card-title {
        font-size: 16px !important;
        font-weight: 700 !important;
        color: #111827 !important;
        letter-spacing: -0.01em;
        margin: 0 !important;
      }
      .attrec-fiori-override.dash-card {
        background: #ffffff !important;
        border: none !important;
        box-shadow: none !important;
        border-radius: 0 !important;
        padding: 0 0 16px 0 !important;
        margin: 0 !important;
        box-sizing: border-box;
      }
      .attrec-fiori-override .attrec-head {
        padding: 0 0 8px 0 !important;
        border-bottom: none !important;
      }
      .attrec-fiori-override .attrec-controls {
        padding: 0 !important;
        gap: 8px !important;
        margin-top: 0 !important;
      }
      .attrec-fiori-override .attrec-control {
        gap: 8px !important;
      }
      .attrec-fiori-override .mobile-row {
        display: contents; /* On desktop, act as if it's not there */
      }
      .attrec-fiori-override .attrec-input,
      .attrec-fiori-override .attrec-btn {
        height: 30px !important;
        font-size: 13px !important;
        padding: 0 10px !important;
        border-radius: 0 !important;
      }
      .attrec-fiori-override .attrec-table {
        margin: 0 !important;
        padding: 0 0 24px 0 !important;
        border-top: none !important;
        max-height: none !important;
        border: none !important;
      }
      .attrec-fiori-override .attrec-dash-table th {
        padding: 6px 12px !important;
        font-size: 15px !important;
        background: #f8fafc !important;
        color: #475569 !important;
        border-bottom: 1px solid #e2e8f0 !important;
      }
      .attrec-fiori-override .attrec-dash-table td {
        padding: 6px 12px !important;
        font-size: 16px !important;
        vertical-align: middle !important;
        border-bottom: 1px solid #f1f5f9 !important;
      }
      .attrec-fiori-override .attrec-pill {
        font-size: 14px !important;
        padding: 4px 10px !important;
        border-radius: 0 !important;
      }
      .attrec-fiori-override .attrec-summary {
        gap: 6px !important;
      }
      .attrec-fiori-override .attrec-pill {
        display: inline-block !important;
        margin-bottom: 4px !important;
      }
      
      /* Excel Dropdown Styles */
      .excel-dropdown-container {
        position: relative;
        display: inline-block;
      }
      .excel-dropdown-btn {
        display: flex !important;
        align-items: center;
        gap: 6px;
        background: #ffffff !important;
        color: #475569 !important;
        border: 1px solid #cbd5e1 !important;
        box-shadow: 0 1px 2px rgba(0,0,0,0.05) !important;
        height: 34px !important;
        padding: 0 12px !important;
        border-radius: 0 !important;
        font-size: 13px !important;
        font-weight: 500 !important;
      }
      .excel-dropdown-btn:hover {
        background: #f8fafc !important;
      }
      .excel-dropdown-btn::after {
        content: "\u25BC";
        font-size: 10px;
        margin-left: 4px;
      }
      .excel-dropdown-menu {
        display: none;
        position: absolute;
        top: 100%;
        right: 0;
        background-color: white;
        min-width: 160px;
        box-shadow: 0px 8px 16px 0px rgba(0,0,0,0.1);
        z-index: 9999 !important; /* Ensure it is always on top */
        border-radius: 0;
        border: 1px solid #e2e8f0;
        overflow: visible !important; /* Fix cutoff issue */
        margin-top: 4px;
      }
      .excel-dropdown-menu.show {
        display: block;
      }
      .excel-dropdown-menu button {
        color: #334155;
        padding: 10px 16px;
        text-decoration: none;
        display: block;
        width: 100%;
        text-align: left;
        background: none;
        border: none;
        border-bottom: 1px solid #f1f5f9;
        font-size: 13px;
        cursor: pointer;
      }
      .excel-dropdown-menu button:last-child {
        border-bottom: none;
      }
      .excel-dropdown-menu button:hover {
        background-color: #f8fafc;
        color: #0f172a;
      }
      /* Responsive Hide/Show Classes */
      .mobile-only {
        display: none !important;
      }
      .attrec-emp-like-table td.desktop-only {
        display: table-cell !important;
      }
      
      /* Mobile responsive styles for legacy attendance page */
      @media (max-width: 768px) {
        .attrec-fiori-override.dash-card {
          padding: 8px 4px !important;
        }
        .desktop-only {
          display: none !important;
        }
        .attrec-emp-like-table td.mobile-only {
          display: block !important;
        }
        .attrec-emp-like-table td.m-code-cell.mobile-only {
          display: flex !important;
        }
        .attrec-emp-like-table td.m-main-cell.mobile-only {
          display: flex !important;
        }
        .attrec-emp-like-table td.desktop-only {
          display: none !important;
        }
        
        /* Sticky Pagination for Mobile */
        .attrec-mobile-pagination {
          position: fixed !important;
          bottom: 0 !important;
          left: 0 !important;
          right: 0 !important;
          background: #ffffff !important;
          padding: 12px 16px !important;
          box-shadow: none !important;
          z-index: 100 !important;
          border-top: 1px solid #e2e8f0 !important;
          margin-top: 0 !important;
          display: flex !important;
          align-items: center !important;
          justify-content: space-between !important;
        }
        
        /* Add padding to the bottom of the table to prevent overlap with sticky pagination */
        .emp-list-scroll-wrap.attrec-list-scroll-wrap {
          padding-bottom: 60px !important;
        }

        .attrec-fiori-override .dash-card-title {
          display: none !important;
        }
        .attrec-fiori-override .attrec-head {
          padding: 8px 12px 4px 12px !important;
          border-bottom: none !important;
        }
        .attrec-fiori-override .attrec-summary {
          flex-wrap: wrap !important;
          gap: 4px !important;
        }
        .attrec-fiori-override .attrec-controls {
          flex-direction: column !important;
          gap: 12px !important;
          padding: 12px !important;
          background: transparent !important; /* Force transparent background */
          margin: 0 12px 12px 12px !important;
          border-radius: 8px !important;
          border: none !important; /* Remove border */
        }
        .attrec-fiori-override .attrec-control {
          display: flex !important;
          flex-direction: column !important;
          gap: 12px !important; /* Increase gap between items on mobile */
          width: 100% !important;
          background: transparent !important;
          padding: 0 !important;
          border-radius: 0 !important;
          border: none !important;
          box-sizing: border-box !important;
        }
        .attrec-fiori-override .mobile-row {
          display: flex !important;
          gap: 6px !important;
          width: 100% !important;
          align-items: center !important;
        }
        .attrec-fiori-override .attrec-label {
          display: none !important;
        }
        .attrec-fiori-override .attrec-control:nth-child(1) .mobile-row:nth-child(2)::before {
          content: "\u65E5";
          font-weight: 700 !important;
          color: #475569 !important;
          font-size: 13px !important;
          margin-right: 2px !important;
        }
        .attrec-fiori-override .attrec-control:nth-child(2) .mobile-row:nth-child(2)::before {
          content: "\u6708";
          font-weight: 700 !important;
          color: #475569 !important;
          font-size: 13px !important;
          margin-right: 2px !important;
        }
        .attrec-fiori-override .attrec-input {
          flex: 1 !important;
          height: 34px !important;
          font-size: 14px !important;
          border-radius: 6px !important;
          border: 1px solid #cbd5e1 !important;
          padding: 0 8px !important;
          width: 100% !important;
          box-sizing: border-box !important;
        }
        .attrec-fiori-override .attrec-btn {
          flex: 1 !important;
          height: 34px !important;
          border-radius: 6px !important;
          font-size: 12px !important;
          font-weight: 600 !important;
          background: #ffffff !important;
          color: #475569 !important;
          border: 1px solid #cbd5e1 !important;
          box-shadow: 0 1px 2px rgba(0,0,0,0.05) !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          padding: 0 4px !important;
        }
        
        /* Dropdown specific mobile styles */
        .attrec-fiori-override .excel-dropdown-container {
          width: 100% !important;
        }
        .attrec-fiori-override .excel-dropdown-btn {
          width: 100% !important;
          justify-content: space-between !important;
          padding: 0 12px !important;
          border: 1px solid #cbd5e1 !important; /* Ensure border exists on mobile */
          height: 34px !important;
        }
        .attrec-fiori-override .excel-dropdown-menu {
          width: 100% !important;
          left: 0 !important;
        }
        /* Removed #rosterLoad styles as the button is no longer used */
        .attrec-fiori-override .attrec-table {
          padding: 0 12px 12px 12px !important;
        }
        /* Improve mobile cards for table to exactly match employees page */
        .attrec-emp-like-table {
          display: block !important;
          background: transparent !important;
        }
        .attrec-emp-like-table thead {
          display: none !important;
        }
        .attrec-emp-like-table tbody {
          display: flex !important;
          flex-direction: column !important;
          gap: 12px !important;
          background: transparent !important;
        }
        .attrec-emp-like-table tr {
          display: flex !important;
          flex-direction: row !important;
          flex-wrap: wrap !important;
          background: #ffffff !important;
          border: 1px solid #e2e8f0 !important;
          border-radius: 0 !important;
          box-shadow: none !important;
          padding: 0 !important; 
          overflow: hidden !important;
          margin-bottom: 0 !important; 
        }
        .attrec-emp-like-table td {
          display: block !important;
          padding: 0 !important; 
          border-bottom: none !important;
          margin: 0 !important;
          width: 100% !important;
          box-sizing: border-box !important; 
          text-align: left !important;
          min-height: auto !important;
        }
        .attrec-emp-like-table td::before {
          display: none !important;
        }
        .attrec-emp-like-table .m-code-cell {
          width: 90px !important;
          min-width: 90px !important;
          max-width: 90px !important;
          background: #f8fafc !important;
          border-right: 1px solid #e2e8f0 !important;
          padding: 12px !important;
          display: flex !important;
          flex-direction: column !important;
          align-items: flex-start !important;
          text-align: left !important;
          box-sizing: border-box !important;
        }
        .attrec-emp-like-table .m-code-label {
          font-size: 11px !important;
          color: #64748b !important;
          margin-bottom: 4px !important;
        }
        .attrec-emp-like-table .m-code-value {
          font-size: 13px !important;
          font-weight: 700 !important;
          color: #1e293b !important;
          word-break: break-all !important;
        }
        .attrec-emp-like-table .m-main-cell {
          flex: 1 !important;
          min-width: 0 !important;
          padding: 12px 16px !important;
          background: #ffffff !important;
          display: flex !important;
          flex-direction: column !important;
          align-items: flex-start !important;
          text-align: left !important;
          gap: 12px !important;
        }
        .attrec-emp-like-table .m-line {
          display: flex !important;
          align-items: flex-start !important;
          justify-content: flex-start !important;
          width: 100% !important;
          font-size: 13px !important;
          line-height: 1.4 !important;
          text-align: left !important;
        }
        .attrec-emp-like-table .m-k {
          min-width: 70px !important;
          color: #64748b !important;
          flex-shrink: 0 !important;
          text-align: left !important;
        }
        .attrec-emp-like-table .m-v {
          color: #0f172a !important;
          word-break: break-word !important;
          flex: 1 !important;
          text-align: left !important;
        }
        .attrec-emp-like-table .m-v-name {
          font-size: 15px !important;
          font-weight: 700 !important;
        }
        /* Style pill tags inside mobile cards */
        .attrec-emp-like-table .m-v .attrec-pill {
          margin-bottom: 0 !important;
          font-size: 14px !important;
          font-weight: bold !important;
          padding: 4px 10px !important;
          border-radius: 4px !important;
        }
      }
     
      /* Overrided by AI for professional look */
      .attrec-fiori-override .attrec-dash-table th {
        padding: 12px 16px !important;
        font-size: 15px !important;
        background: #f8fafc !important;
        color: #334155 !important;
        border-bottom: 1px solid #e2e8f0 !important;
        font-weight: 700 !important;
      }
      .attrec-fiori-override .attrec-dash-table td {
        padding: 10px 16px !important;
        font-size: 16px !important;
        vertical-align: middle !important;
        border-bottom: 1px solid #e2e8f0 !important;
        color: #0f172a !important;
      }
    </style>
    <div class="dash-card attrec-fiori-override ui-c" data-ui="daily" style="height: auto; display: flex; flex-direction: column; overflow: visible !important; max-width: none;">
      <div class="ui-ph"><h2>\u52E4\u6020\u8A18\u9332\uFF08\u65E5\u5225\uFF09</h2></div>
      <div class="attrec-controls" style="margin: 0 0 10px; flex-shrink: 0; padding: 6px 10px; background: #f1f4f8; border: 1px solid #c3cdda; border-left: 3px solid #0b2c66; overflow: visible !important; display: none !important;">
      </div>
      <div class="attrec-head" style="display: none !important;">
        <div id="rosterSummary" class="attrec-summary" aria-live="polite" style="display: flex; gap: 8px; margin-bottom: 0; align-items: center; flex-wrap: wrap;"></div>
      </div>
      <div class="ui-panel" style="margin:0;"><div class="ui-ptitle">\u52E4\u6020\u4E00\u89A7</div>
      <div id="rosterTable" class="attrec-table" style="height: calc(100vh - 190px); overflow: auto; max-height: calc(100vh - 190px); max-width: 100%;"></div>
      </div>
    </div>
  `,F.appendChild(b);const at=document.getElementById("attHubMobileActions"),lt=`
      <div style="display:flex; align-items:center; justify-content:center; gap:8px;">
        <button type="button" id="rosterPrevDayMobile" aria-label="\u524D\u65E5" style="height:34px; min-width:40px; padding:0 10px; font-size:16px; line-height:1; border:1px solid #cbd5e1; border-radius:8px; background:#fff; color:#0f172a; font-weight:700; cursor:pointer;">\u2039</button>
        <input id="rosterDateMobile" type="date" value="${v(z)}" style="height: 34px; padding: 0 8px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; width: 150px; color: #0f172a; outline: none; margin: 0; box-sizing: border-box; background: #fff; text-align:center; font-weight:600;">
        <button type="button" id="rosterNextDayMobile" aria-label="\u7FCC\u65E5" style="height:34px; min-width:40px; padding:0 10px; font-size:16px; line-height:1; border:1px solid #cbd5e1; border-radius:8px; background:#fff; color:#0f172a; font-weight:700; cursor:pointer;">\u203A</button>
      </div>
    `;if(window.innerWidth<=768)if(at)at.innerHTML=lt;else{const t=document.createElement("div");t.id="rosterMobileDateBar",t.style.cssText="display:flex; align-items:center; justify-content:center; padding:8px 12px; background:#fff; border-bottom:1px solid #e5e7eb;",t.innerHTML=lt,b.insertBefore(t,b.firstChild)}const St=`
        <div class="attrec-control hidden-on-mobile" style="display: flex !important; flex-direction: row !important; align-items: center !important; justify-content: space-between !important; width: 100%; padding: 0 !important; gap: 12px; background: transparent !important; border: none !important; overflow: visible !important;">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <input id="rosterDate" class="attrec-input" type="date" value="${v(z)}" style="width: 140px; border: 1px solid #cbd5e1; height: 34px; box-sizing: border-box; border-radius: 0;" />
            <select id="rosterFilterDept" style="height:34px;border:1px solid #cbd5e1;border-radius:0;padding:0 8px;font-size:12px;color:#334155;background:#fff;cursor:pointer;min-width:90px;"><option value="">\u5168\u90E8\u90E8\u7F72</option></select>
            <select id="rosterFilterStatus" style="height:34px;border:1px solid #cbd5e1;border-radius:0;padding:0 8px;font-size:12px;color:#334155;background:#fff;cursor:pointer;min-width:90px;"><option value="">\u5168\u72B6\u614B</option><option value="working">\u51FA\u52E4\u4E2D</option><option value="checked_out">\u9000\u52E4\u6E08</option><option value="absent">\u672A\u51FA\u52E4</option><option value="late">\u9045\u523B</option><option value="off">\u4F11\u65E5</option><option value="leave">\u4F11\u6687</option></select>
            <div id="rosterSummaryInline" style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;"></div>
          </div>
          <div id="topRightFormContainer" style="display: flex; align-items: center; gap: 8px;"></div>
        </div>
  `,T=b.querySelector(".attrec-controls");T&&(T.innerHTML=St),window.addEventListener("resize",()=>{const t=window.innerWidth<=768;T&&(T.style.display=t?"none":"block")}),T&&(T.style.display=window.innerWidth<=768?"none":"block");const dt=t=>{const c=b.querySelector("#rosterSummaryInline");if(!c)return;const sm=t&&typeof t==="object"?t:{};const working=Number(sm.working||0),checked_out=Number(sm.checked_out||0),absent=Number(sm.absent||0),off=Number(sm.off||0),leave=Number(sm.leave||0),late=Number(sm.late||0);const pill=(txt,bg,color,border,count)=>count>0?`<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 10px;border-radius:4px;font-size:12px;font-weight:700;background:${bg};color:${color};border:1px solid ${border};">${txt} <span style="background:rgba(0,0,0,0.12);border-radius:2px;padding:0 5px;font-size:11px;">${count}</span></span>`:"";c.style.display="flex";c.style.gap="6px";c.style.flexWrap="wrap";c.style.alignItems="center";c.innerHTML=[pill("出勤中","#fef9c3","#854d0e","#fde047",working),pill("退勤済","#dcfce7","#166534","#86efac",checked_out),pill("遅刻","#fff7ed","#c2410c","#fed7aa",late),pill("未出勤","#fef2f2","#991b1b","#fecaca",absent),pill("休日・休暇","#f1f5f9","#475569","#cbd5e1",off+leave)].filter(Boolean).join(" ");const summaryInline=b.querySelector("#rosterSummaryInline");if(summaryInline&&summaryInline!==c){summaryInline.style.display="flex";summaryInline.style.gap="6px";summaryInline.style.flexWrap="wrap";summaryInline.innerHTML=c.innerHTML;}},_rosterCache={date:null,res:null},O=async(t,_opt)=>{const e=b.querySelector("#rosterTable");const _useCache=!!(_opt&&_opt.useCache&&_rosterCache.date===t&&_rosterCache.res);!_useCache&&e&&(e.innerHTML=`
        <div class="empty-state">
          <div style="font-size:28px;">\u23F3</div>
          <div>\u8AAD\u307F\u8FBC\u307F\u4E2D\u2026</div>
        </div>
      `),_useCache||dt(null);try{const r=_useCache?_rosterCache.res:await vt.get(`/api/admin/work-reports?date=${encodeURIComponent(t)}`,{signal:N});if(!B)return;_rosterCache.date=t,_rosterCache.res=r;let i=r&&Array.isArray(r.items)?r.items:[];{const _seen=new Set();i=i.filter(_it=>{const _sig=[_it.userId,_it.status,_it.attendance&&_it.attendance.checkIn,_it.attendance&&_it.attendance.checkOut,_it.report&&_it.report.site,_it.report&&_it.report.work,_it.dailyKubun,_it.workType].join("|");if(_seen.has(_sig))return false;_seen.add(_sig);return true;});}const nowJST=new Date(Date.now()+9*3600*1e3);const nowHHMM=nowJST.getHours().toString().padStart(2,"0")+":"+nowJST.getMinutes().toString().padStart(2,"0");const dateIsToday=t===z;const LATE_THRESHOLD="09:00";const computedSummary={working:0,checked_out:0,absent:0,off:0,leave:0,late:0};for(const _it of i){const _p=_it.status||"";const _ck=_it.attendance&&_it.attendance.checkIn?String(_it.attendance.checkIn).slice(11,16):"";if(_p==="working"||_p==="holiday_working")computedSummary.working++;else if(_p==="checked_out"||_p==="holiday_work")computedSummary.checked_out++;else if(_p==="off"||_p==="not_checked_in"&&(String(_it.dailyKubun||"").includes("\u4F11")))computedSummary.off++;else if(_p==="leave")computedSummary.leave++;else computedSummary.absent++;if(_ck&&_ck>LATE_THRESHOLD&&!_it.isFlex&&!(String(_it.dailyKubun||"").indexOf("\u534A\u4F11")===0))computedSummary.late++;}if(dt(computedSummary),!e)return;if(!i.length){e.innerHTML=`
          <div class="empty-state">
            <div style="font-size:28px;">\u{1F5C2}\uFE0F</div>
            <div>\u30C7\u30FC\u30BF\u304C\u3042\u308A\u307E\u305B\u3093</div>
          </div>
        `;return}let o=1;const a=window.innerWidth<=768,d=999999,u=()=>{if(!e)return;e.innerHTML="";const m=document.createElement("table");m.id="attrecList",m.className="beautiful-table",m.style.tableLayout="auto",m.style.width="auto",m.style.minWidth="100%",m.style.borderCollapse="collapse",m.style.border="none",m.style.borderRadius="0",m.style.overflow="hidden",m.innerHTML=`
          <style>
            .beautiful-table {
              box-shadow: none;
            }
            .beautiful-table thead {
              background-color: #f8fafc;
            }
            .beautiful-table th {
              padding: 2px 12px !important;
              height: 22px !important;
              line-height: 1.15 !important;
              font-weight: 600;
              color: #475569;
              font-size: 12px;
              text-align: center;
              background: #f8fafc;
              border: 1px solid #e2e8f0;
            }
            .beautiful-table td {
              padding: 0 12px !important;
              height: 22px !important;
              line-height: 1.15 !important;
              font-size: 13px;
              color: #334155;
              border: 1px solid #e2e8f0;
              border-bottom: 1px solid #f1f5f9;
              vertical-align: middle;
            }
            /* Badge tr\u1EA1ng th\xE1i kh\xF4ng \u0111\u01B0\u1EE3c k\xE9o h\xE0ng cao l\xEAn */
            .beautiful-table td .attrec-pill {
              padding: 0 10px !important;
              line-height: 1.3 !important;
              font-size: 11px !important;
            }
            .beautiful-table tbody tr:hover td {
              background-color: #f8fafc;
            }
            /* Gi\u1EEF \u0111\u01B0\u1EDDng k\u1EBB ng\u0103n c\u1ED9t \u1ED5n \u0111\u1ECBnh khi hover (kh\xF4ng b\u1ECB "ch\u1EDBp t\u1EAFt") */
            .beautiful-table tbody tr:hover td {
              border-color: #e2e8f0 !important;
              background-clip: padding-box;
            }
            .beautiful-table .attrec-pill {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              padding: 2px 8px;
              border-radius: 0;
              font-size: 12px;
              font-weight: 500;
              background-color: #f1f5f9;
              color: #475569;
              border: 1px solid #e2e8f0;
            }
            .beautiful-table .attrec-pill.ok { background-color: #f0fdf4; color: #166534; border-color: #bbf7d0; }
            .beautiful-table .attrec-pill.warn { background-color: #fffbeb; color: #92400e; border-color: #fde68a; }
            .beautiful-table .attrec-pill.danger { background-color: #fef2f2; color: #991b1b; border-color: #fecaca; }
            
            /* B\u1EA3ng lu\xF4n hi\u1EC3n th\u1ECB d\u1EA1ng b\u1EA3ng b\xECnh th\u01B0\u1EDDng \u1EDF M\u1ECCI k\xEDch th\u01B0\u1EDBc m\xE0n h\xECnh.
               Kh\xF4ng d\xF9ng layout th\u1EBB (card) mobile n\u1EEFa: kh\xF4ng ch\xE8n nh\xE3n ::before,
               kh\xF4ng flex, \u0111\u1EC3 \xF4 kh\xF4ng b\u1ECB "ch\u1EBB \u0111\xF4i" b\u1EDFi d\u1EA3i nh\xE3n. M\xE0n h\xECnh nh\u1ECF th\xEC cu\u1ED9n ngang. */
            .beautiful-table td::before,
            .beautiful-table th::before {
              content: none !important;
              display: none !important;
            }
            .beautiful-table thead {
              display: table-header-group !important;
            }
            .beautiful-table tbody {
              display: table-row-group !important;
            }
            .beautiful-table tr {
              display: table-row !important;
            }
            .beautiful-table td,
            .beautiful-table th {
              display: table-cell !important;
              border: 1px solid #e2e8f0 !important;
            }
            .pagination-btn {
              padding: 6px 12px;
              background: #f8fafc;
              border: 1px solid #cbd5e1;
              border-radius: 0;
              cursor: pointer;
              color: #334155;
              font-size: 13px;
              font-weight: 500;
              transition: all 0.15s;
            }
            .pagination-btn:hover:not(:disabled) {
              background: #e2e8f0;
              color: #0f172a;
            }
            .pagination-btn:disabled {
              opacity: 0.5;
              cursor: not-allowed;
            }
          </style>
          <thead><tr><th>\u793E\u54E1\u756A\u53F7</th><th>\u6C0F\u540D</th><th>\u90E8\u7F72</th><th>\u652F\u5E97</th><th>\u52E4\u52D9\u533A\u5206</th><th>\u72B6\u614B</th><th>\u51FA\u52E4</th><th>\u9000\u52E4</th><th>\u73FE\u5834</th><th>\u4F5C\u696D\u5185\u5BB9</th><th>\u7406\u7531</th><th>\u5099\u8003</th></tr></thead>
        `;const I=document.createElement("tbody"),k=Ct(t),S=t<z;const _fDept=b.querySelector("#rosterFilterDept")?.value||"";const _fStatus=b.querySelector("#rosterFilterStatus")?.value||"";const LATE_THR="09:00";const iFiltered=i.filter(_row=>{const _p=_row.status||"";const _ck=_row.attendance&&_row.attendance.checkIn?String(_row.attendance.checkIn).slice(11,16):"";const _dept=_row.departmentName||"";if(_fDept&&_dept!==_fDept)return false;if(_fStatus){if(_fStatus==="late")return!!(_ck&&_ck>LATE_THR&&!_row.isFlex&&!(String(_row.dailyKubun||"").indexOf("\u534A\u4F11")===0));if(_fStatus==="absent")return _p!=="working"&&_p!=="checked_out"&&_p!=="off"&&_p!=="leave"&&_p!=="holiday_working"&&_p!=="holiday_work";if(_fStatus==="working")return _p==="working"||_p==="holiday_working";if(_fStatus==="checked_out")return _p==="checked_out"||_p==="holiday_work";if(_fStatus==="off")return _p==="off";if(_fStatus==="leave")return _p==="leave";return _p===_fStatus;}return true;});const _depts=[...new Set(i.map(r=>r.departmentName||"").filter(Boolean))].sort();const _dSel=b.querySelector("#rosterFilterDept");if(_dSel&&_dSel.options.length<=1){_depts.forEach(d=>{const op=document.createElement("option");op.value=d;op.textContent=d;_dSel.appendChild(op);});}const L=(o-1)*d,K=Math.min(L+d,iFiltered.length),H=iFiltered.slice(L,K);for(let w=0;w<H.length;w++){const n=H[w],f=w>0?H[w-1]:null,x=f&&f.userId===n.userId;let $="";if(!x){let R=1;for(let j=w+1;j<H.length&&H[j].userId===n.userId;j++)R++;$=R>1?` rowspan="${R}"`:""}const V=n.employeeCode||`EMP${String(n.userId).padStart(3,"0")}`,A=n.username||"",G=n.departmentName||"",p=n.status||"",c=String(n.dailyKubun||"").trim()||(k&&(p==="leave"||p==="off")?"\u4F11\u65E5":""),ht=new Set(["\u6B20\u52E4","\u6709\u7D66\u4F11\u6687","\u534A\u4F11","\u7121\u7D66\u4F11\u6687"]),At=new Set(["\u4F11\u65E5","\u4EE3\u66FF\u4F11\u65E5","\u4F11\u65E5\u4E88\u5B9A"]),zt=new Set(["\u6B20\u52E4","\u6709\u7D66\u4F11\u6687","\u534A\u4F11","\u7121\u7D66\u4F11\u6687","\u4F11\u65E5","\u4EE3\u66FF\u4F11\u65E5","\u4F11\u65E5\u4E88\u5B9A"]),U=At.has(c);let g="",h="",y="";U?(g=c||"\u4F11\u65E5",h="attrec-pill neutral",y=c==="\u534A\u4F11(\u6709\u7D66)"?"background:#0d9488;color:#ffffff;border:1px solid #0f766e;":"background:#f1f5f9;color:#334155;border:1px solid #e2e8f0;"):p==="checked_out"?(g="\u9000\u52E4\u6E08",h="attrec-pill ok",y="background:#dcfce7;color:#166534;border:1px solid #86efac;"):p==="working"||p==="holiday_working"?S?(g="\u9000\u52E4\u5FD8\u308C",h="attrec-pill danger",y="background:#fef2f2;color:#991b1b;border:1px solid #fca5a5;"):(g=p==="working"?"\u51FA\u52E4\u4E2D":"\u4F11\u65E5\u51FA\u52E4\u4E2D",h="attrec-pill warn",y="background:#fef9c3;color:#854d0e;border:1px solid #fde047;"):p==="holiday_work"?(g="\u4F11\u65E5\u51FA\u52E4",h="attrec-pill warn",y="background:#fef9c3;color:#854d0e;border:1px solid #fde047;"):p==="leave"&&ht.has(c)||U?(g=c||"\u4F11\u65E5",h="attrec-pill neutral",y=c==="\u534A\u4F11(\u6709\u7D66)"?"background:#0d9488;color:#ffffff;border:1px solid #0f766e;":"background:#f1f5f9;color:#334155;border:1px solid #e2e8f0;"):p==="off"?(g=c||"\u4F11\u65E5",h="attrec-pill neutral",y="background:#f1f5f9;color:#334155;border:1px solid #e2e8f0;"):p==="leave"?(g=c||"\u4F11\u6687",h="attrec-pill neutral",y=c==="\u534A\u4F11(\u6709\u7D66)"?"background:#0d9488;color:#ffffff;border:1px solid #0f766e;":"background:#f1f5f9;color:#334155;border:1px solid #e2e8f0;"):p==="unregistered"?(g="\u672A\u767B\u9332",h="attrec-pill neutral",y="background:#f8fafc;color:#94a3b8;border:1px solid #e2e8f0;"):p==="checkout_missing"?(g="\u9000\u52E4\u5FD8\u308C",h="attrec-pill danger",y="background:#fef2f2;color:#991b1b;border:1px solid #fca5a5;"):p==="not_punched"?(g="\u672A\u6253\u523B",h="attrec-pill danger",y="background:#fef2f2;color:#991b1b;border:1px solid #fca5a5;"):S?(g="\u6253\u523B\u306A\u3057",h="attrec-pill danger",y="background:#fef2f2;color:#991b1b;border:1px solid #fca5a5;"):(g="\u672A\u51FA\u52E4",h="attrec-pill neutral",y=dateIsToday&&nowHHMM>LATE_THRESHOLD?"background:#fef2f2;color:#991b1b;border:1px solid #fecaca;":"background:#f0f9ff;color:#0369a1;border:1px solid #7dd3fc;");(String(c||"").indexOf("\u534A\u4F11")===0)&&(p==="working"||p==="checked_out")&&(g=c+"\u30FB"+g,y="background:#0d9488;color:#ffffff;border:1px solid #0f766e;");p==="absence"&&(g=c||"欠勤",h="attrec-pill danger",y="background:#fef2f2;color:#991b1b;border:1px solid #fca5a5;");n.kubunConflict&&(g="⚠ "+(c||"休暇")+"（打刻あり）",h="attrec-pill danger",y="background:#fef2f2;color:#991b1b;border:1px solid #fca5a5;");const Bt=U?"":nt(n.attendance?n.attendance.checkIn:void 0),Tt=U?"":nt(n.attendance?n.attendance.checkOut:void 0),Mt=n.report&&n.report.site?n.report.site:"",It=n.report&&n.report.work?n.report.work:"",Y=R=>String(R||"").trim()||"",yt=Y(Bt),wt=Y(Tt),Lt=Y(Mt),Ht=Y(It),J=String(n.workType||(n.report&&n.report.workType?n.report.workType:"")||"").trim(),qt=zt.has(c)||c==="\u534A\u4F11(\u6709\u7D66)"?c:J==="onsite"?"\u51FA\u793E":J==="remote"?"\u5728\u5B85":J==="satellite"?"\u73FE\u5834/\u51FA\u5F35":p==="off"?"\u4F11\u65E5":"",Q=document.createElement("tr");Q.className=p==="checked_out"?"attrec-row checkedout":p==="working"||p==="holiday_work"||p==="holiday_working"?"attrec-row working":(p==="leave"&&ht.has(c),"attrec-row absent");const Ut=`<td data-label="\u793E\u54E1\u756A\u53F7" style="text-align:center; vertical-align:middle;">${v(V)}</td>`,Rt=`<td data-label="\u6C0F\u540D" style="font-weight:600; white-space:nowrap; vertical-align:middle;">${v(A)}</td>`,Nt=`<td data-label="\u90E8\u7F72" style="white-space:nowrap; vertical-align:middle;">${v(G)}</td>`,Yt=n.branchName||"",jt=`<td data-label="\u652F\u5E97" style="white-space:nowrap; vertical-align:middle;">${v(Yt)}</td>`,_t=`<td data-label="\u52E4\u52D9\u533A\u5206" style="white-space:nowrap; vertical-align:middle;">${v(qt)}</td>`,Ot=`<td data-label="\u72B6\u614B" style="text-align:center; white-space:nowrap; vertical-align:middle;"><span class="${h}" style="display:inline-block;box-sizing:border-box;min-width:84px;text-align:center;padding:2px 10px;font-size:12px;font-weight:700;line-height:1.3;border-radius:6px;${y}">${v(g)}</span></td>`;Q.innerHTML=`
            ${Ut}
            ${Rt}
            ${Nt}
            ${jt}
            ${_t}
            ${Ot}
            <td data-label="\u51FA\u52E4" style="text-align:center; font-family:monospace; font-size:14px; white-space:nowrap;${yt?(yt>LATE_THR&&!(String(c||"").indexOf("\u534A\u4F11")===0)?" color:#c2410c; font-weight:700; background:#fff7ed;":" color:#166534; font-weight:600;"):""}">${v(yt)}${yt&&yt>LATE_THR&&!(String(c||"").indexOf("\u534A\u4F11")===0)?`<span style="display:inline-block;margin-left:4px;font-size:10px;font-weight:700;padding:0 4px;background:#fed7aa;color:#c2410c;border-radius:2px;">\u9045\u523B</span>`:""}</td>
            <td data-label="\u9000\u52E4" style="text-align:center; font-family:monospace; font-size:14px; white-space:nowrap;${wt?" color:#0b2c66; font-weight:600;":""}">${v(wt)}</td>
            <td data-label="\u73FE\u5834" style="min-width:150px;"><div style="font-size:13px; color:#475569;">${v(Lt)}</div></td>
            <td data-label="\u4F5C\u696D\u5185\u5BB9" style="width:auto; min-width:200px; max-width:420px;"><div style="font-size:13px; color:#475569; word-break:break-word; white-space:pre-wrap;">${v(Ht)}</div></td>
            <td data-label="\u7406\u7531" style="white-space:nowrap;font-size:13px;color:#475569;">${v(n.reason||"")}</td>
            <td data-label="\u5099\u8003" style="min-width:140px;font-size:13px;color:#475569;word-break:break-word;">${v(n.notes||"")}</td>
          `,I.appendChild(Q);if(Array.isArray(n.extraRows)&&n.extraRows.length&&!U){for(const _x of n.extraRows){const _rs=String(_x.reason||"");const _in=String(_x.in||"");const _out=String(_x.out||"");const _tr=document.createElement("tr");_tr.className="attrec-row extra";_tr.title="\u8FFD\u52A0\u52E4\u52D9\uFF08\u305D\u306E\u65E5\u306B\u8FFD\u52A0\u3057\u305F\u52E4\u52D9\u3002\u5168\u90E8 \u6B8B\u696D\uFF09";_tr.innerHTML=`<td></td><td style="color:#94a3b8;padding-left:14px;">\u21B3</td><td></td><td></td><td style="white-space:nowrap;"><span style="display:inline-block;padding:0 6px;border:1px solid #cbd5e1;background:#f1f5f9;color:#475569;font-size:11px;font-weight:700;">\u8FFD\u52A0\u52E4\u52D9</span></td><td></td><td data-label="\u51FA\u52E4" style="text-align:center;font-family:monospace;font-size:14px;white-space:nowrap;color:#0b2c66;font-weight:600;">${v(_in)}</td><td data-label="\u9000\u52E4" style="text-align:center;font-family:monospace;font-size:14px;white-space:nowrap;color:#0b2c66;font-weight:600;">${v(_out)}</td><td></td><td data-label="\u4F5C\u696D\u5185\u5BB9"><div style="font-size:13px;color:#475569;word-break:break-word;white-space:pre-wrap;">${v(_x.work||"")}</div></td><td data-label="\u7406\u7531" style="white-space:nowrap;font-size:13px;color:#475569;">${v(_rs)}</td><td data-label="\u5099\u8003" style="font-size:13px;color:#475569;word-break:break-word;">${v(_x.notes||"")}</td>`;I.appendChild(_tr)}}}m.appendChild(I);const q=document.createElement("div");if(q.id="attrecTableWrap",q.className="emp-list-scroll-wrap attrec-list-scroll-wrap",q.style.cssText="overflow:visible; width:100%; margin-bottom:0; position:relative;",q.appendChild(m),e.appendChild(q),iFiltered.length>0){const w=Math.ceil(iFiltered.length/d),n=document.createElement("div");if(a){n.className="attrec-mobile-pagination";const f=document.createElement("div");f.innerHTML=`\u5168 <span style="font-weight:700; color:#0f172a;">${iFiltered.length}</span> \u4EF6\u4E2D <span style="font-weight:700; color:#0f172a;">${L+1}</span> - <span style="font-weight:700; color:#0f172a;">${K}</span> \u4EF6\u3092\u8868\u793A`,f.style.color="#64748b",f.style.fontSize="14px";const x=document.createElement("div");x.style.display="flex",x.style.gap="8px";const $=o===1?"#f1f5f9":"#fff",V=o===1?"not-allowed":"pointer",A=document.createElement("button");A.type="button",A.textContent="\u524D\u3078",A.style.cssText=`padding:6px 12px; border:1px solid #cbd5e1; border-radius:4px; background:${$}; color:#475569; cursor:${V}; font-size:14px;`,A.disabled=o===1,A.onclick=()=>{o>1&&(o--,u(),setTimeout(()=>{e&&e.scrollIntoView({behavior:"smooth",block:"start"})},50))};const G=o===w?"#f1f5f9":"#fff",p=o===w?"not-allowed":"pointer",c=document.createElement("button");c.type="button",c.textContent="\u6B21\u3078",c.style.cssText=`padding:6px 12px; border:1px solid #cbd5e1; border-radius:4px; background:${G}; color:#475569; cursor:${p}; font-size:14px;`,c.disabled=o===w,c.onclick=()=>{o<w&&(o++,u(),setTimeout(()=>{e&&e.scrollIntoView({behavior:"smooth",block:"start"})},50))},x.appendChild(A),x.appendChild(c),n.appendChild(f),n.appendChild(x),e.appendChild(n)}else{n.className="attrec-paging desktop-only",n.style.display="flex",n.style.alignItems="center",n.style.justifyContent="flex-start",n.style.gap="15px",n.style.padding="10px 0 20px 0";const f=document.createElement("button");f.type="button",f.textContent="\u524D\u3078",f.className="pagination-btn",f.disabled=o===1,f.onclick=()=>{o>1&&(o--,u())};const x=document.createElement("button");x.type="button",x.textContent="\u6B21\u3078",x.className="pagination-btn",x.disabled=o===w,x.onclick=()=>{o<w&&(o++,u())};const $=document.createElement("span");$.textContent=`${L+1}-${K} / ${iFiltered.length}`,$.style.fontSize="14px",$.style.color="#333",n.appendChild(f),n.appendChild($),n.appendChild(x),e.appendChild(n)}}};u()}catch(r){if(r&&r.name==="AbortError"||!B)return;e&&(e.innerHTML=`
          <div class="empty-state" style="color:#b00020;">
            <div style="font-size:28px;">\u26A0\uFE0F</div>
            <div>\u8AAD\u307F\u8FBC\u307F\u306B\u5931\u6557\u3057\u307E\u3057\u305F: ${v(r&&r.message?r.message:"unknown")}</div>
          </div>
        `)}},C=b.querySelector("#rosterDate"),D=document.getElementById("rosterDateMobile"),pt=async t=>{const e=t.target.value||z;C&&(C.value=e),D&&(D.value=e),await O(e)};C&&C.addEventListener("change",pt),D&&D.addEventListener("change",pt);const _fDeptSel=b.querySelector("#rosterFilterDept"),_fStatusSel=b.querySelector("#rosterFilterStatus");/* 部署・状態の絞り込みは取得済みデータで表だけ描き直す（再取得・読み込み中表示・サマリー消去をしない＝画面がチラつかない） */const _refilter=()=>{if(b.querySelector("#rosterTable"))O(C&&C.value?C.value:z,{useCache:!0})};if(_fDeptSel)_fDeptSel.addEventListener("change",_refilter);if(_fStatusSel)_fStatusSel.addEventListener("change",_refilter);const st=(t,e)=>{const r=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(t||"").slice(0,10));if(!r)return t;const i=new Date(Date.UTC(parseInt(r[1],10),parseInt(r[2],10)-1,parseInt(r[3],10)));return isNaN(i.getTime())?t:(i.setUTCDate(i.getUTCDate()+e),i.toISOString().slice(0,10))},ct=()=>D&&D.value||C&&C.value||z,ut=async t=>{t&&(C&&(C.value=t),D&&(D.value=t),await O(t))},mt=b.querySelector("#rosterPrevDayMobile"),bt=b.querySelector("#rosterNextDayMobile");mt&&mt.addEventListener("click",()=>ut(st(ct(),-1))),bt&&bt.addEventListener("click",()=>ut(st(ct(),1)));let M=null;try{M=await vt.get("/api/auth/me")}catch{}M&&M.role==="employee"&&F.querySelectorAll(".excel-dropdown-container, #rosterExportXlsx, #rosterExportXlsxMobile").forEach(t=>{t&&(t.style.display="none")});const P=()=>M&&M.role!=="admin"&&M.role!=="manager"?(alert("\u6A29\u9650\u304C\u3042\u308A\u307E\u305B\u3093\u3002"),!1):!0,ft=b.querySelector("#rosterExportMonthXlsx"),xt=document.getElementById("rosterExportMonthXlsxMobile"),gt=async()=>{if(!P())return;const t=b.querySelector("#rosterMonth"),e=document.getElementById("rosterMonthMobile"),r=t&&t.value?t.value:e&&e.value?e.value:Dt,i=`/api/admin/work-reports/export.xlsx?period=month&month=${encodeURIComponent(r)}`;try{await Z(i,`attendance_month_${r}.xlsx`)}catch(o){alert(String(o&&o.message?o.message:"\u30A8\u30AF\u30B9\u30DD\u30FC\u30C8\u306B\u5931\u6557\u3057\u307E\u3057\u305F"))}};ft&&ft.addEventListener("click",gt),xt&&xt.addEventListener("click",gt);const _exportBtnBar=document.createElement("div");_exportBtnBar.id="dailyExportBar";_exportBtnBar.style.cssText="display:inline-flex;align-items:center;gap:6px;";const _svgXlsx='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>';const _svgPdf='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13h1a2 2 0 0 1 0 4H9v-4z"/></svg>';const _Ntt=document.createElement("button");_Ntt.type="button";_Ntt.id="rosterExportDayXlsx";_Ntt.innerHTML=_svgXlsx+" Excel \u51FA\u529B";_Ntt.style.cssText="display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 12px;border:1px solid #86efac;background:#f0fdf4;color:#166534;font-size:12px;font-weight:600;cursor:pointer;border-radius:4px;";const _Ott=document.createElement("button");_Ott.type="button";_Ott.id="rosterExportDayPdf";_Ott.innerHTML=_svgPdf+" PDF \u51FA\u529B";_Ott.style.cssText="display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 12px;border:1px solid #fca5a5;background:#fef2f2;color:#991b1b;font-size:12px;font-weight:600;cursor:pointer;border-radius:4px;";const _Qtt=async(btn,fmt)=>{btn.disabled=!0;const orig=btn.innerHTML;btn.textContent="\u51FA\u529B\u4E2D...";try{const d=ct();const url=`/api/admin/work-reports/export-daily?date=${encodeURIComponent(d)}&format=${fmt}`;const resp=await fetch(url,{credentials:"include"});if(!resp.ok){const e=await resp.json().catch(()=>({}));throw new Error(e.message||`HTTP ${resp.status}`);}const blob=await resp.blob();const ext=fmt==="pdf"?"pdf":"xlsx";const filename=`\u52E4\u6020\u8A18\u9332_${d}.${ext}`;const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();document.body.removeChild(a);setTimeout(()=>URL.revokeObjectURL(a.href),10000);}catch(e){alert("\u30A8\u30AF\u30B9\u30DD\u30FC\u30C8\u306B\u5931\u6557\u3057\u307E\u3057\u305F: "+(e&&e.message||e));}finally{btn.disabled=!1;btn.innerHTML=orig;}};_Ntt.onclick=()=>_Qtt(_Ntt,"xlsx");_Ott.onclick=()=>_Qtt(_Ott,"pdf");_exportBtnBar.appendChild(_Ntt);_exportBtnBar.appendChild(_Ott);// Inject sau khi O(z) chạy xong để đảm bảo DOM đã sẵn sàng
setTimeout(()=>{const _summaryEl=b.querySelector("#rosterSummaryInline");if(_summaryEl&&_summaryEl.parentElement){_summaryEl.parentElement.appendChild(_exportBtnBar);}else{const _ctrl=b.querySelector(".attrec-control");if(_ctrl)_ctrl.appendChild(_exportBtnBar);}},0);await O(z);const s=document.createElement("form"),W=new Date(Date.now()+9*3600*1e3).toISOString().slice(0,4);s.style.display="flex",s.style.alignItems="center",s.style.gap="8px";const $t=rt.filter(t=>t.role!=="admin"&&t.role!=="manager");s.innerHTML=`
    <select id="tsUser" style="height:34px; border:1px solid #cbd5e1; border-radius:4px; padding:0 8px; font-size:13px; max-width: 150px;">${$t.map(t=>`<option value="${t.id}">${t.id} ${t.username||t.email}</option>`).join("")}</select>
    <input id="tsYear" placeholder="Year(YYYY)" value="${W}" style="width:90px; height:34px; border:1px solid #cbd5e1; border-radius:4px; padding:0 8px; font-size:13px;">
    <button type="button" id="tsExportXlsx" class="attrec-btn" style="height:34px; padding:0 12px; background:#fff; border:1px solid #cbd5e1; border-radius:4px; font-size:13px; font-weight:600; cursor:pointer;">Excel</button>
    <input id="tsFrom" placeholder="From(YYYY-MM-DD)" style="width:140px; height:34px; border:1px solid #cbd5e1; border-radius:4px; padding:0 8px; font-size:13px;">
    <input id="tsTo" placeholder="To(YYYY-MM-DD)" style="width:140px; height:34px; border:1px solid #cbd5e1; border-radius:4px; padding:0 8px; font-size:13px;">
    <button type="submit" class="attrec-btn" style="height:34px; padding:0 12px; background:#fff; border:1px solid #cbd5e1; border-radius:4px; font-size:13px; font-weight:600; cursor:pointer;">\u8868\u793A</button>
    <button type="button" id="tsExport" class="attrec-btn" style="height:34px; padding:0 12px; background:#fff; border:1px solid #cbd5e1; border-radius:4px; font-size:13px; font-weight:600; cursor:pointer;">CSV</button>
  `;const l=document.createElement("div"),E=document.createElement("div");let X=null;if(Pt(l,'button[data-action="day-detail"]',"click",async(t,e)=>{const r=e.dataset.date||"";if(!r||!X)return;const i=await Ft(X,r,{signal:N});if(!B)return;E.innerHTML=`<h4 style="margin-top:0;">${r} \u8A73\u7D30</h4>`;const o=document.createElement("table");o.className="beautiful-table",o.style.width="100%",o.style.borderCollapse="collapse",o.innerHTML=`
      <thead>
        <tr>
          <th style="padding:10px; border-bottom:2px solid #cbd5e1; background:#f8fafc; text-align:left;">ID</th>
          <th style="padding:10px; border-bottom:2px solid #cbd5e1; background:#f8fafc; text-align:left;">\u51FA\u52E4</th>
          <th style="padding:10px; border-bottom:2px solid #cbd5e1; background:#f8fafc; text-align:left;">\u9000\u52E4</th>
        </tr>
      </thead>`;const a=document.createElement("tbody");for(const d of i.segments||[]){const u=document.createElement("tr");u.style.borderBottom="1px solid #e2e8f0",u.innerHTML=`
        <td style="padding:10px;">${d.id}</td>
        <td style="padding:10px;">${d.checkIn?d.checkIn.substring(11,16):""}</td>
        <td style="padding:10px;">${d.checkOut?d.checkOut.substring(11,16):""}</td>
      `,a.appendChild(u)}o.appendChild(a),E.appendChild(o)}),s.addEventListener("submit",async t=>{t.preventDefault();const e=parseInt(s.querySelector("#tsUser").value,10),r=s.querySelector("#tsFrom").value.trim(),i=s.querySelector("#tsTo").value.trim();if(!e){alert("\u793E\u54E1\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044");return}if(!r||!i){alert("\u300CFrom\u300D\u3068\u300CTo\u300D\u306E\u65E5\u4ED8\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002");return}X=e;try{const o=await Et(e,r,i,{signal:N});if(!B)return;l.innerHTML="",E.innerHTML="",l.style.position="fixed",l.style.top="50%",l.style.left="50%",l.style.transform="translate(-50%, -50%)",l.style.backgroundColor="#fff",l.style.padding="20px",l.style.boxShadow="0 4px 20px rgba(0,0,0,0.15)",l.style.borderRadius="8px",l.style.zIndex="1000",l.style.maxHeight="80vh",l.style.overflowY="auto",l.style.width="90%",l.style.maxWidth="800px";const a=document.createElement("div");a.id="tsOverlay",a.style.position="fixed",a.style.top="0",a.style.left="0",a.style.width="100vw",a.style.height="100vh",a.style.backgroundColor="rgba(0,0,0,0.4)",a.style.zIndex="999",a.addEventListener("click",()=>{l.style.display="none",a.remove(),E.innerHTML=""}),document.body.appendChild(a);const d=document.createElement("div");d.style.display="flex",d.style.justifyContent="space-between",d.style.alignItems="center",d.style.marginBottom="15px",d.innerHTML=`
          <h3 style="margin:0; font-size:18px; color:#1e293b;">\u30BF\u30A4\u30E0\u30B7\u30FC\u30C8\u8A73\u7D30: ${(s.querySelector("#tsUser")?.selectedOptions?.[0]?.textContent?.trim()||"").replace(/^\d+\s+/,"")} (${r} ~ ${i})</h3>
          <button type="button" id="tsCloseBtn" style="background:none; border:none; font-size:24px; cursor:pointer; color:#64748b;">&times;</button>
        `,l.appendChild(d),d.querySelector("#tsCloseBtn").addEventListener("click",()=>{l.style.display="none",a.remove(),E.innerHTML=""});const u=document.createElement("table");u.className="beautiful-table",u.style.width="100%",u.style.borderCollapse="collapse",u.innerHTML=`
          <thead>
            <tr>
              <th style="padding:10px; border-bottom:2px solid #cbd5e1; background:#f8fafc; text-align:left;">\u65E5\u4ED8</th>
              <th style="padding:10px; border-bottom:2px solid #cbd5e1; background:#f8fafc; text-align:right;">\u901A\u5E38(\u6642\u9593)</th>
              <th style="padding:10px; border-bottom:2px solid #cbd5e1; background:#f8fafc; text-align:right;">\u6B8B\u696D(\u6642\u9593)</th>
              <th style="padding:10px; border-bottom:2px solid #cbd5e1; background:#f8fafc; text-align:right;">\u6DF1\u591C(\u6642\u9593)</th>
              <th style="padding:10px; border-bottom:2px solid #cbd5e1; background:#f8fafc; text-align:center;">\u64CD\u4F5C</th>
            </tr>
          </thead>`;const m=document.createElement("tbody"),I=k=>{if(k==null||isNaN(k))return"0:00";const S=Math.floor(k/60),L=k%60;return`${S}:${L.toString().padStart(2,"0")}`};for(const k of o.days||[]){const S=document.createElement("tr");S.style.borderBottom="1px solid #e2e8f0",S.innerHTML=`
            <td style="padding:10px;">${k.date}</td>
            <td style="padding:10px; text-align:right;">${I(k.regularMinutes)}</td>
            <td style="padding:10px; text-align:right;">${I(k.overtimeMinutes)}</td>
            <td style="padding:10px; text-align:right;">${I(k.nightMinutes)}</td>
            <td style="padding:10px; text-align:center;"><button type="button" class="attrec-btn" style="padding:4px 10px; font-size:12px;" data-action="day-detail" data-date="${k.date}">\u8A73\u7D30</button></td>
          `,m.appendChild(S)}u.appendChild(m),l.appendChild(u),l.style.display="block",E.style.marginTop="20px",E.style.borderTop="1px solid #e2e8f0",E.style.paddingTop="15px",l.appendChild(E)}catch(o){if(o&&o.name==="AbortError"||!B)return;alert(String(o&&o.message?o.message:"\u30C7\u30FC\u30BF\u306E\u53D6\u5F97\u306B\u5931\u6557\u3057\u307E\u3057\u305F"))}}),s.querySelector("#tsExport").addEventListener("click",async()=>{if(!P())return;const t=parseInt(s.querySelector("#tsUser").value,10),e=s.querySelector("#tsFrom").value.trim(),r=s.querySelector("#tsTo").value.trim();if(!t){alert("\u793E\u54E1\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044");return}if(!e||!r){alert("\u300CFrom\u300D\u3068\u300CTo\u300D\u306E\u65E5\u4ED8\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002");return}const i=typeof et=="function"?et(String(t),e,r):`/api/admin/export/timesheet.csv?userIds=${encodeURIComponent(String(t))}&from=${encodeURIComponent(e)}&to=${encodeURIComponent(r)}`;try{await Z(i,`timesheet_${t}.csv`)}catch(o){alert(String(o&&o.message?o.message:"\u30A8\u30AF\u30B9\u30DD\u30FC\u30C8\u306B\u5931\u6557\u3057\u307E\u3057\u305F"))}}),s.querySelector("#tsExportXlsx").addEventListener("click",async()=>{if(!P())return;const t=parseInt(s.querySelector("#tsUser").value,10),e=s.querySelector("#tsYear"),r=String(e&&e.value?e.value:W).trim()||W,i=`/api/admin/employees/${encodeURIComponent(String(t))}/export.xlsx?year=${encodeURIComponent(r)}`;try{const o=s.querySelector("#tsUser"),a=(o&&o.options&&o.options[o.selectedIndex]?o.options[o.selectedIndex].text:String(t)).split(" "),d=a.length>1?a.slice(1).join("_"):String(t);await Z(i,`${d}_${r}.xlsx`)}catch(o){alert(String(o&&o.message?o.message:"\u30A8\u30AF\u30B9\u30DD\u30FC\u30C8\u306B\u5931\u6557\u3057\u307E\u3057\u305F"))}}),!window.location.pathname.includes("/ui/attendance-records")){const t=b.querySelector("#topRightFormContainer");if(t)t.appendChild(s);else{const e=document.createElement("details");e.open=!0,e.style.marginBottom="12px",e.innerHTML='<summary style="cursor:pointer;font-weight:900;padding:10px 0;">\u500B\u4EBA\u30BF\u30A4\u30E0\u30B7\u30FC\u30C8\uFF08\u8A73\u7D30\uFF09</summary>',e.appendChild(s),F.insertBefore(e,b)}F.appendChild(l),F.appendChild(E)}return()=>{try{F.innerHTML=""}catch{}_.run()}}const Vt=Wt({mount:kt});export{Vt as attendancePage,Kt as mountAttendance};
