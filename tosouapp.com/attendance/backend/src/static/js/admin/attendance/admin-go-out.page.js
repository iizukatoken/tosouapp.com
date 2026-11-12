import{fetchJSONAuth as O}from"../../api/http.api.js";async function Y({content:k}){const U=new URLSearchParams(window.location.search).get("standalone")==="1"?"100vh":"calc(100vh - var(--topbar-height) - var(--subbar-height))";k.className=(k.className||"")+" go-out-page-content",k.style.cssText="margin: 0; padding: 0; width: 100%; display: flex; flex-direction: column; flex: 1; min-width: 0;",k.innerHTML=`
    <style>
      .go-out-page-content { flex: 1 1 0%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
      .go-out-table-wrapper { flex: 1 1 0%; min-height: 0; overflow-y: auto; overflow-x: auto; -webkit-overflow-scrolling: touch; }
      @media (max-width: 768px) {
        .go-out-page-content { flex: 1 1 0% !important; min-height: 0 !important; overflow: hidden !important; display: flex !important; flex-direction: column !important; }
        .go-out-table-wrapper { flex: 1 1 0% !important; min-height: 0 !important; overflow-y: auto !important; overflow-x: hidden !important; -webkit-overflow-scrolling: touch !important; }
        #adminContent.card { padding: 0 !important; }
      }
      .go-out-table { width: 100%; border-collapse: collapse; min-width: 900px; margin: 0; font-size: 13px; table-layout: auto; }
      .go-out-table th { padding: 6px 12px; font-size: 12px; background: #f8fafc; color: #475569; border: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; }
      .go-out-table td { border: 1px solid #e2e8f0; padding: 6px 12px; vertical-align: middle; border-bottom: 1px solid #f1f5f9; }
      .go-out-table tbody tr:hover td { background-color: #f1f5f9; }

      /* Dark mode */
      :root[data-theme='dark'] .go-out-page-content { background: #0f172a !important; }
      :root[data-theme='dark'] .go-out-table th { background: #1e293b !important; color: #fbbf24 !important; border-color: #334155 !important; }
      :root[data-theme='dark'] .go-out-table td { background: #111827 !important; color: #c4b5fd !important; border-color: #334155 !important; }
      :root[data-theme='dark'] .go-out-table tbody tr:hover td { background: #1e293b !important; }
      :root[data-theme='dark'] .go-out-table tbody tr:nth-child(even) td { background: #0f172a !important; }
      :root[data-theme='dark'] .pagination-container { color: #94a3b8 !important; }
      :root[data-theme='dark'] .pagination-container select,
      :root[data-theme='dark'] .pagination-container button { background: #1e293b !important; border-color: #475569 !important; color: #e2e8f0 !important; }
      :root[data-theme='dark'] .pagination-container button:disabled { background: #0f172a !important; color: #475569 !important; }
      :root[data-theme='dark'] .go-out-root-container { background: #0f172a !important; }
      :root[data-theme='dark'] .go-out-table-wrapper { background: #111827 !important; }
      :root[data-theme='dark'] .page-header-container { background: transparent !important; }
      
      @media (max-width: 768px) {
        .go-out-table th, .go-out-table td { font-size: 11px; padding: 4px; }
        .go-out-table-wrapper {
          border: none !important;
          box-shadow: none !important;
          background: transparent !important;
          max-height: none !important;
        }
        .go-out-table { min-width: 100%; }
        .go-out-table thead { display: none; }
        .go-out-table tbody { display: block; background: transparent !important; }
        .go-out-table tr {
          display: block;
          background: white !important;
          margin-bottom: 12px;
          border-radius: 8px;
          padding: 16px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
          border: 1px solid #e2e8f0;
          transition: none !important;
        }
        .go-out-table td {
          display: block;
          padding: 0 !important;
          border: none !important;
          text-align: left !important;
        }
        .td-date-status { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 8px; font-weight: bold; color: #334155; }
        .td-employee { font-weight: bold; font-size: 15px; margin-bottom: 12px; color: #1e293b; }
        .td-time { display: flex; gap: 8px; color: #475569; font-family: monospace; font-size: 14px; margin-bottom: 4px; }
        .td-time-label { width: 40px; display: inline-block; color: #64748b; font-family: sans-serif; font-size: 13px; }
        .td-type-reason { display: flex; gap: 8px; margin-bottom: 4px; align-items: flex-start; font-size: 13px; color: #475569; }
        .td-type-label { width: 40px; display: inline-block; color: #64748b; }
        .td-actions { margin-top: 16px; padding-top: 12px; border-top: 1px solid #e2e8f0; text-align: right; }
        
        .desktop-cell { display: none !important; }
        .mobile-cell { display: block !important; }
        
        /* Hide all pagination controls on mobile */
        .pagination-container {
          display: none !important;
        }
        
        /* Remove outer card styling on mobile to avoid card-in-card */
        #adminContent.card {
          border: none !important;
          box-shadow: none !important;
          background: transparent !important;
        }
        .go-out-root-container {
          background: transparent !important;
        }
        .page-header-container {
          padding: 16px 0 8px 0 !important;
        }
        .go-out-table-wrapper {
          padding: 0 !important;
        }
        
        /* Mobile Header Adjustments */
        .page-header-title {
          display: none !important; /* Hide "\u5916\u51FA\u7BA1\u7406" on mobile */
        }
        .page-header-container {
          display: none !important; /* Hide completely on mobile since we move date picker to top header */
        }
        #goOutAdminFilterMonth {
          width: 130px !important; /* Make date picker smaller */
          height: 32px !important; /* Make it slightly thinner */
          font-size: 13px !important;
          margin: 0 !important;
        }
      }
      @media (min-width: 769px) {
        .mobile-cell { display: none !important; }
        .desktop-cell { display: table-cell; }
      }
      
      /* Hover effects replaced for CSP compliance */
      #goOutAdminFilterMonth:focus { border-color: #3b82f6 !important; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1) !important; }
      .go-out-row:hover { background-color: #f1f5f9 !important; }
      .btn-force-end:hover { background-color: #fef2f2 !important; }
      .btn-edit:hover { background-color: #eff6ff !important; }
    </style>
    <div class="ui-c go-out-root-container" style="max-width:none;">
      <div class="ui-ph">
        <h2>\u5916\u51FA\u7BA1\u7406</h2>
        <span class="ui-sp"></span>
        <input type="month" id="goOutAdminFilterMonth" class="ui-inp" style="width:140px;" title="\u5BFE\u8C61\u6708" aria-label="\u5BFE\u8C61\u6708">
        <span style="width:1px;height:18px;background:#c3cdda;margin:0 4px;"></span>
        <button id="goOutExportPdf" type="button" class="ui-btn">PDF\u51FA\u529B</button>
      </div>
      <div class="ui-panel">
        <div class="ui-ptitle">\u5916\u51FA\u4E00\u89A7 <span class="ui-sub" id="goOutAdminItemCount">\u5168 0 \u4EF6</span></div>
        <div class="ui-tablewrap">
          <table class="go-out-table" style="width:100%;">
            <thead>
              <tr>
                <th>\u65E5\u4ED8</th><th>\u793E\u54E1\u540D</th><th>\u5916\u51FA</th><th>\u623B\u308A</th><th>\u6642\u9593</th>
                <th>\u533A\u5206</th><th>\u7406\u7531</th><th>\u72B6\u614B</th><th>\u64CD\u4F5C</th>
              </tr>
            </thead>
            <tbody id="goOutAdminTableBody">
              <tr><td colspan="9" style="text-align:center;color:#94a3b8;">\u8AAD\u307F\u8FBC\u307F\u4E2D...</td></tr>
            </tbody>
          </table>
        </div>
        <div class="ui-pager">
          <span>\u8868\u793A\u4EF6\u6570:
            <select id="goOutAdminPageSize" class="ui-inp" style="height:22px;margin-left:4px;">
              <option value="10">10</option>
              <option value="20" selected>20</option>
              <option value="50">50</option>
            </select>
          </span>
          <span style="display:flex;gap:4px;align-items:center;">
            <button id="goOutAdminPrevPage" type="button" class="ui-btn sm" disabled>\u524D\u3078</button>
            <span id="goOutAdminPageInfo">\u30DA\u30FC\u30B8 1 / 1</span>
            <button id="goOutAdminNextPage" type="button" class="ui-btn sm" disabled>\u6B21\u3078</button>
          </span>
        </div>
      </div>
    </div>
  `;const D=document.getElementById("goOutAdminTableBody"),g=document.getElementById("goOutAdminFilterMonth"),E=document.getElementById("attHubMobileActions");if(E&&window.innerWidth<=768){const n=g.cloneNode(!0);n.id="goOutAdminFilterMonthMobile",E.innerHTML="",E.appendChild(n),n.addEventListener("change",t=>{g.value=t.target.value,c()}),n.addEventListener("input",t=>{g.value=t.target.value,c()})}const S=new Date,B=`${S.getFullYear()}-${String(S.getMonth()+1).padStart(2,"0")}`;g.value=B,document.getElementById("goOutAdminFilterMonthMobile")&&(document.getElementById("goOutAdminFilterMonthMobile").value=B);let m=[],l=1;const x=n=>{if(!n)return"\u2014";const s=String(n).replace("T"," ");const m=/(\d{2}):(\d{2})/.exec(s.slice(11,16));return m?`${m[1]}:${m[2]}`:"\u2014"},L=(n,t)=>{if(!n||!t||n==="\u2014"||t==="\u2014")return null;const o=p=>{const[r,s]=p.split(":").map(Number);return r*60+s},e=o(n),d=o(t);return e==null||d==null?null:e===d?0:d>e?d-e:d+1440-e},N=n=>{const t=Math.max(0,Number(n||0)),o=Math.floor(t/60),e=Math.floor(t%60);return`${String(o)}:${String(e).padStart(2,"0")}`},a=n=>String(n||"").replace(/[&<"'>]/g,function(t){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[t]}),c=async()=>{const n=document.getElementById("goOutAdminFilterMonth");if(!n)return;const t=n.value,o=document.getElementById("goOutAdminTableBody");o&&(o.innerHTML='<tr><td colspan="9" style="text-align: center; padding: 20px; color: #64748b;">\u8AAD\u307F\u8FBC\u307F\u4E2D...</td></tr>');try{const e=new URLSearchParams;t&&/^\d{4}-\d{2}$/.test(t)&&e.append("month",t),m=await O(`/api/attendance/go-out/admin-list?${e.toString()}`)||[],l=1,f()}catch(e){document.getElementById("goOutAdminTableBody")&&(document.getElementById("goOutAdminTableBody").innerHTML=`<tr><td colspan="9" style="text-align: center; padding: 20px; color: #ef4444;">\u30A8\u30E9\u30FC: ${e.message}</td></tr>`)}},f=()=>{const n=window.innerWidth<=768,t=document.getElementById("goOutAdminPageSize");if(!t)return;const o=n?m.length:parseInt(t.value,10),e=m.length,d=Math.max(1,Math.ceil(e/o));l>d&&(l=d);const p=document.getElementById("goOutAdminItemCount");p&&(p.textContent=`\u5168 ${e} \u4EF6`);const r=document.getElementById("goOutAdminPageInfo");r&&(r.textContent=`\u30DA\u30FC\u30B8 ${l} / ${d}`);const s=document.getElementById("goOutAdminPrevPage");s&&(s.disabled=l<=1);const h=document.getElementById("goOutAdminNextPage");h&&(h.disabled=l>=d);const b=document.getElementById("goOutAdminTableBody");if(e===0){b&&(b.innerHTML='<tr><td colspan="9" style="text-align: center; padding: 20px; color: #64748b;">\u30C7\u30FC\u30BF\u304C\u3042\u308A\u307E\u305B\u3093</td></tr>');return}const z=(l-1)*o,T=m.slice(z,z+o);let u="";T.forEach((i,j)=>{const y=x(i.go_out_time),$=x(i.return_time);let A="\u2014";if(y!=="\u2014"&&$!=="\u2014"){const H=L(y,$);H!=null&&(A=N(H))}const G=i.status==="\u5916\u51FA\u4E2D"?"#d97706":i.status==="\u4FEE\u6B63\u6E08\u307F"?"#059669":"#475569",J=i.status==="\u5916\u51FA\u4E2D"?"#fef3c7":i.status==="\u4FEE\u6B63\u6E08\u307F"?"#d1fae5":"#f1f5f9",V=(i.type==="\u696D\u52D9","white"),W=i.type==="\u696D\u52D9"?"#3b82f6":"#ef4444";let M="";i.status==="\u5916\u51FA\u4E2D"&&(M+=`
          <button class="btn-force-end" data-id="${i.id}" data-date="${i.date}" data-gotime="${y}" style="background: transparent; color: #ef4444; border: none; padding: 0 4px; font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; text-decoration: underline;">
            \u5F37\u5236\u7D42\u4E86
          </button>
        `),M+=`
        <button class="btn-edit" data-id="${i.id}" data-json='${a(JSON.stringify(i))}' style="background: transparent; color: #3b82f6; border: none; padding: 0 4px; font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; text-decoration: underline;">
          \u7DE8\u96C6
        </button>
      `;const F=j%2===0?"white":"#f8fafc",v=a(i.reason||""),R=v.length>15?v.substring(0,15)+"...":v,w=a(i.admin_note||""),_=w.length>15?w.substring(0,15)+"...":w;u+=`
        <tr class="go-out-row" data-bg="${F}">
          <!-- Mobile View -->
          <td class="mobile-cell">
            <div class="td-date-status">
              <span>${a(i.date)}</span>
              <span style="font-size: 12px; color: #1e293b;">${a(i.status)}</span>
            </div>
            <div class="td-employee">${a(i.employeeName)}</div>
            <div class="td-time" style="display: flex; align-items: stretch;">
              <span class="td-time-label" style="display: inline-flex; align-items: center; justify-content: center; width: 60px; min-height: 32px; background: #e0f2fe; color: #1e3a8a; font-weight: bold; font-size: 12px; border-radius: 4px; border: 1px solid #bae6fd; margin-right: 12px; flex-shrink: 0;">\u6642\u9593</span>
              <span style="display: inline-flex; align-items: center; min-height: 32px;">${y} \u301C ${$} (\u7D4C\u904E: ${A})</span>
            </div>
            <div class="td-type-reason" style="margin-top: 8px; display: flex; align-items: stretch;">
              <span class="td-type-label" style="display: inline-flex; align-items: center; justify-content: center; width: 60px; min-height: 32px; background: #e0f2fe; color: #1e3a8a; font-weight: bold; font-size: 12px; border-radius: 4px; border: 1px solid #bae6fd; margin-right: 12px; flex-shrink: 0;">\u533A\u5206</span>
              <span style="display: inline-flex; align-items: center; min-height: 32px; font-size: 12px;">${a(i.type)}</span>
            </div>
            <div class="td-type-reason" style="margin-top: 8px; display: flex; align-items: stretch;">
              <span class="td-type-label" style="display: inline-flex; align-items: center; justify-content: center; width: 60px; min-height: 48px; background: #e0f2fe; color: #1e3a8a; font-weight: bold; font-size: 12px; border-radius: 4px; border: 1px solid #bae6fd; margin-right: 12px; flex-shrink: 0;">\u7406\u7531</span>
              <span style="display: inline-flex; align-items: center; min-height: 48px; flex: 1;">
                <div>
                  <div style="line-height: 1.4;">${v}</div>
                  ${i.admin_note?`<div style="font-size: 11px; color: #94a3b8; margin-top: 4px; line-height: 1.3;">(\u5099\u8003: ${w})</div>`:""}
                </div>
              </span>
            </div>
            <div class="td-actions" style="margin-top: 16px; padding-top: 12px; border-top: 1px solid #e2e8f0; display: flex; justify-content: flex-end; gap: 8px;">
              ${M}
            </div>
          </td>

          <!-- Desktop View -->
          <td class="desktop-cell" style="padding: 2px 8px !important; font-size: 13px; color: #1e293b; text-align: center;">${a(i.date)}</td>
          <td class="desktop-cell" style="padding: 2px 8px !important; font-size: 13px; color: #1e293b; font-weight: 500; text-align: center;">${a(i.employeeName)}</td>
          <td class="desktop-cell" style="padding: 2px 8px !important; font-size: 13px; font-family: monospace; text-align: center;">${y}</td>
          <td class="desktop-cell" style="padding: 2px 8px !important; font-size: 13px; font-family: monospace; text-align: center;">${$}</td>
          <td class="desktop-cell" style="padding: 2px 8px !important; font-size: 13px; font-family: monospace; text-align: center; color: #64748b;">${A}</td>
          <td class="desktop-cell" style="padding: 2px 8px !important; font-size: 13px; text-align: center;">${a(i.type)}</td>
          <td class="desktop-cell" style="padding: 2px 8px !important; font-size: 13px; color: #475569; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left;">
            <div title="${v}" style="line-height: 1.2;">${R}</div>
            ${i.admin_note?`<div title="${w}" style="font-size: 11px; color: #94a3b8; margin-top: 2px; line-height: 1.1;">(\u5099\u8003: ${_})</div>`:""}
          </td>
          <td class="desktop-cell" style="padding: 2px 8px !important; font-size: 13px; text-align: center;">${a(i.status)}</td>
          <td class="desktop-cell" style="padding: 2px 8px !important; font-size: 13px; white-space: nowrap; text-align: center;">${M}</td>
        </tr>
      `}),b&&(b.innerHTML=u),document.querySelectorAll(".btn-force-end").forEach(i=>{i.addEventListener("click",P)}),document.querySelectorAll(".btn-edit").forEach(i=>{i.addEventListener("click",C)})},P=async n=>{const t=n.target.closest(".btn-force-end");if(!t)return;const o=t.dataset.id,e=t.dataset.date,d=t.dataset.gotime,p=prompt(`\u5916\u51FA\u4E2D\u306E\u8A18\u9332\u3092\u7D42\u4E86\u3057\u307E\u3059\u304B\uFF1F
\u623B\u308A\u6642\u9593\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\uFF08HH:MM \u5F62\u5F0F\uFF09\u3002

\u203B\u65E5\u307E\u305F\u304E\u306E\u5834\u5408\u306F\u300C23:59\u300D\u306A\u3069\u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002`,"23:59");if(p===null)return;if(!/^\\d{2}:\\d{2}$/.test(p)){alert("\u7121\u52B9\u306A\u6642\u9593\u5F62\u5F0F\u3067\u3059\u3002HH:MM \u3067\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002");return}const r=t.innerHTML;try{t.disabled=!0,t.innerHTML="\u51E6\u7406\u4E2D...";const s=`${e}T${p}:00`;await O(`/api/attendance/go-out/admin/${o}/force-end`,{method:"PUT",body:JSON.stringify({returnTime:s,adminNote:"\u7BA1\u7406\u8005\u306B\u3088\u308A\u4FEE\u6B63\uFF08\u5F37\u5236\u7D42\u4E86\uFF09"})}),await c()}catch(s){alert(s.message||"\u30A8\u30E9\u30FC\u304C\u767A\u751F\u3057\u307E\u3057\u305F"),t.disabled=!1,t.innerHTML=r}},C=n=>{const t=n.target.closest(".btn-edit");if(!t)return;const o=JSON.parse(t.dataset.json),e=document.createElement("div");e.style.cssText="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center;";const d=x(o.go_out_time)==="\u2014"?"":x(o.go_out_time),p=x(o.return_time)==="\u2014"?"":x(o.return_time);e.innerHTML=`
      <div style="background: white; border-radius: 8px; width: 400px; max-width: 90%; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
        <div style="background: #0f2c62; color: white; padding: 12px 16px; font-weight: bold; font-size: 16px;">\u5916\u51FA\u8A18\u9332\u306E\u7DE8\u96C6</div>
        <div style="padding: 20px;">
          <div style="margin-bottom: 12px;">
            <label style="display: block; font-size: 13px; font-weight: bold; color: #334155; margin-bottom: 4px;">\u793E\u54E1\u540D</label>
            <div style="font-size: 14px; color: #1e293b;">${a(o.employeeName)} (${a(o.date)})</div>
          </div>
          
          <div style="display: flex; gap: 12px; margin-bottom: 12px;">
            <div style="flex: 1;">
              <label style="display: block; font-size: 13px; font-weight: bold; color: #334155; margin-bottom: 4px;">\u5916\u51FA\u6642\u9593</label>
              <input type="time" id="editGoTime" value="${d}" style="width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 4px; box-sizing: border-box;">
            </div>
            <div style="flex: 1;">
              <label style="display: block; font-size: 13px; font-weight: bold; color: #334155; margin-bottom: 4px;">\u623B\u308A\u6642\u9593</label>
              <input type="time" id="editRetTime" value="${p}" style="width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 4px; box-sizing: border-box;">
            </div>
          </div>

          <div style="margin-bottom: 12px;">
            <label style="display: block; font-size: 13px; font-weight: bold; color: #334155; margin-bottom: 4px;">\u533A\u5206</label>
            <select id="editType" style="width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 4px; box-sizing: border-box;">
              <option value="\u696D\u52D9" ${o.type==="\u696D\u52D9"?"selected":""}>\u696D\u52D9</option>
              <option value="\u79C1\u7528" ${o.type==="\u79C1\u7528"?"selected":""}>\u79C1\u7528</option>
            </select>
          </div>

          <div style="margin-bottom: 12px;">
            <label style="display: block; font-size: 13px; font-weight: bold; color: #334155; margin-bottom: 4px;">\u7406\u7531</label>
            <input type="text" id="editReason" value="${a(o.reason||"")}" style="width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 4px; box-sizing: border-box;">
          </div>

          <div style="margin-bottom: 20px;">
            <label style="display: block; font-size: 13px; font-weight: bold; color: #334155; margin-bottom: 4px;">\u5099\u8003 (\u7BA1\u7406\u8005\u306E\u4FEE\u6B63\u7406\u7531\u306A\u3069)</label>
            <input type="text" id="editAdminNote" value="${a(o.admin_note||"")}" style="width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 4px; box-sizing: border-box;" placeholder="\u4F8B\uFF1A\u6253\u523B\u5FD8\u308C\u306E\u305F\u3081\u4FEE\u6B63">
          </div>

          <div style="display: flex; gap: 12px; justify-content: flex-end;">
            <button id="btnCancelEdit" style="background: white; border: 1px solid #cbd5e1; color: #475569; padding: 8px 16px; border-radius: 4px; cursor: pointer;">\u30AD\u30E3\u30F3\u30BB\u30EB</button>
            <button id="btnSaveEdit" style="background: #059669; border: none; color: white; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: bold;">\u4FDD\u5B58\u3057\u3066\u4FEE\u6B63\u6E08\u307F\u306B\u3059\u308B</button>
          </div>
        </div>
      </div>
    `,document.body.appendChild(e),e.querySelector("#btnCancelEdit").addEventListener("click",()=>{document.body.removeChild(e)}),e.querySelector("#btnSaveEdit").addEventListener("click",async r=>{const s=e.querySelector("#editGoTime").value,h=e.querySelector("#editRetTime").value,b=e.querySelector("#editType").value,z=e.querySelector("#editReason").value,T=e.querySelector("#editAdminNote").value;if(!s){alert("\u5916\u51FA\u6642\u9593\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044");return}r.target.disabled=!0,r.target.textContent="\u4FDD\u5B58\u4E2D...";try{const u=`${o.date}T${s}:00`,i=h?`${o.date}T${h}:00`:null;await O(`/api/attendance/go-out/admin/${o.id}`,{method:"PUT",body:JSON.stringify({goOutTime:u,returnTime:i,type:b,reason:z,adminNote:T||"\u7BA1\u7406\u8005\u306B\u3088\u308A\u4FEE\u6B63"})}),document.body.removeChild(e),await c()}catch(u){alert(u.message||"\u30A8\u30E9\u30FC\u304C\u767A\u751F\u3057\u307E\u3057\u305F"),r.target.disabled=!1,r.target.textContent="\u4FDD\u5B58\u3057\u3066\u4FEE\u6B63\u6E08\u307F\u306B\u3059\u308B"}})};document.getElementById("goOutAdminPageSize").addEventListener("change",()=>{l=1,f()}),document.getElementById("goOutAdminPrevPage").addEventListener("click",()=>{l>1&&(l--,f())}),document.getElementById("goOutAdminNextPage").addEventListener("click",()=>{const n=parseInt(document.getElementById("goOutAdminPageSize").value,10),t=Math.ceil(m.length/n);l<t&&(l++,f())}),document.getElementById("goOutAdminFilterMonth").addEventListener("change",c),document.getElementById("goOutAdminFilterMonth").addEventListener("input",c);document.getElementById("goOutExportPdf")?.addEventListener("click",async()=>{const btn=document.getElementById("goOutExportPdf");const month=document.getElementById("goOutAdminFilterMonth")?.value||B;const orig=btn.innerHTML;btn.disabled=true;btn.textContent="出力中...";try{const resp=await fetch(`/api/attendance/go-out/export.pdf?month=${encodeURIComponent(month)}`,{credentials:"include"});if(!resp.ok){const e=await resp.json().catch(()=>({}));throw new Error(e.message||`HTTP ${resp.status}`);}const blob=await resp.blob();const url=URL.createObjectURL(blob);const lnk=document.createElement("a");lnk.href=url;lnk.download=`\u5916\u51FA\u7BA1\u7406_${month}.pdf`;document.body.appendChild(lnk);lnk.click();document.body.removeChild(lnk);setTimeout(()=>URL.revokeObjectURL(url),10000);}catch(err){alert("PDF\u51FA\u529B\u306B\u5931\u6557\u3057\u307E\u3057\u305F: "+(err.message||err));}finally{btn.disabled=false;btn.innerHTML=orig;}});const I=()=>{m.length>0&&document.getElementById("goOutAdminItemCount")&&f();const n=document.getElementById("attHubMobileActions"),t=document.getElementById("goOutAdminFilterMonthMobile");if(window.innerWidth<=768){if(n&&!t){const o=g.cloneNode(!0);o.id="goOutAdminFilterMonthMobile",o.value=g.value,n.innerHTML="",n.appendChild(o),o.addEventListener("change",e=>{g.value=e.target.value,c()}),o.addEventListener("input",e=>{g.value=e.target.value,c()})}}else n&&(n.innerHTML="")};return window.addEventListener("resize",I),c(),()=>{window.removeEventListener("resize",I)}}export{Y as mountGoOut};
