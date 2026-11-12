import{api as h}from"../../shared/api/client.js";async function Q({content:l}){await R({content:l})}async function R({content:l}){const J=new URLSearchParams(window.location.search).get("standalone")==="1"?"100dvh":"calc(100vh - var(--topbar-height) - var(--subbar-height))";l.className=(l.className||"")+" shift-page-content",l.style.cssText="margin: 0; padding: 0; width: 100%; display: flex; flex-direction: column; background: #FFFFFF; flex: 1; min-width: 0;",l.innerHTML="";const y=document.createElement("div");y.className="admin-shifts shift-fiori-override ui-c",y.dataset.ui="shifts",y.style.cssText="display: flex; flex-direction: column; flex: 1 1 0%; min-height: 0;";const w=document.createElement("div");w.className="ui-ph",w.innerHTML='<h2>\u30B7\u30D5\u30C8\u7BA1\u7406</h2><span class="ui-sp"></span><a class="ui-btn" href="/admin/attendance/shifts/bulk-assign" style="text-decoration:none;">\u4E00\u62EC\u5272\u5F53\uFF08\u8907\u6570\u5F93\u696D\u54E1\uFF09</a>',y.appendChild(w);const u=document.createElement("div");u.className="form-card",u.style.cssText=`
    background: #fff;
    border: none;
    box-shadow: none;
    border-radius: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    flex: 1 1 0%;
    min-height: 0;
    margin: 0;
  `;const k=document.createElement("div");k.className="form-title",k.textContent="\u30B7\u30D5\u30C8\u7BA1\u7406",k.style.display="none",u.appendChild(k);const b=document.createElement("div");b.className="form-actions shift-form-actions ui-panel",b.style.borderTop="",b.style.borderBottom="";const g=document.createElement("div");g.className="shift-inputs-wrap";const C=(e,n)=>{const t=document.createElement("div");t.className="shift-field-wrapper";const a=document.createElement("label");return a.className="shift-field-label",a.textContent=e,n.id&&(a.htmlFor=n.id),t.appendChild(a),t.appendChild(n),t};let c=document.createElement("input");c.type="text",c.name="shift_name",c.id="shiftNameInput",c.placeholder="\u4F8B: day_8_17",c.className="shift-input";let f=document.createElement("input");f.type="time",f.name="shift_start",f.id="shiftStartInput",f.value="08:00",f.className="shift-input";let m=document.createElement("input");m.type="time",m.name="shift_end",m.id="shiftEndInput",m.value="17:00",m.className="shift-input";let x=document.createElement("select");x.name="shift_break",x.id="shiftBreakSelect",x.className="shift-input",x.innerHTML='<option value="180">180\u5206 (3\u6642\u9593)</option><option value="150">150\u5206 (2\u6642\u9593\u534A)</option><option value="120">120\u5206 (2\u6642\u9593)</option><option value="90">90\u5206</option><option value="60" selected>60\u5206</option><option value="45">45\u5206</option><option value="30">30\u5206</option><option value="0">0\u5206</option>',g.appendChild(C("\u540D\u79F0",c)),g.appendChild(C("\u958B\u59CB\u6642\u9593",f)),g.appendChild(C("\u7D42\u4E86\u6642\u9593",m)),g.appendChild(C("\u4F11\u61A9\u6642\u9593",x));const E=document.createElement("div");E.className="shift-btns-wrap";let s=document.createElement("button");s.type="button",s.className="shift-btn shift-btn-add ui-btn primary",s.textContent="\u8FFD\u52A0";let r=document.createElement("button");r.type="button",r.className="shift-btn shift-btn-update ui-btn",r.textContent="\u66F4\u65B0",r.disabled=!0,r.style.opacity="0.5",r.style.cursor="not-allowed",E.appendChild(s),E.appendChild(r);const F=()=>({name:I(c.value),start_time:String(f.value||"").trim(),end_time:String(m.value||"").trim(),break_minutes:parseInt(String(x.value||"0"),10)}),j=e=>!(!e.name||!/^\d{2}:\d{2}$/.test(e.start_time)||!/^\d{2}:\d{2}$/.test(e.end_time)),P=async()=>{const e=await h.get("/attendance/shifts/definitions");p=Array.isArray(e)?e:[],A(p),Y()},Y=()=>{c.value="",f.value="08:00",m.value="17:00",x.value="60",r.disabled=!0,r.style.opacity="0.5",r.style.cursor="not-allowed",s.disabled=!1,s.style.opacity="1",s.style.cursor="pointer"},W=()=>{r.disabled=!1,r.style.opacity="1",r.style.cursor="pointer",s.disabled=!0,s.style.opacity="0.5",s.style.cursor="not-allowed"};s.addEventListener("click",async e=>{e.preventDefault();const n=F();if(!j(n)){alert("\u540D\u79F0\u30FB\u958B\u59CB\u30FB\u7D42\u4E86\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044");return}if(U(n.name)){alert("\u540C\u3058\u540D\u79F0\u306E\u30B7\u30D5\u30C8\u304C\u65E2\u306B\u5B58\u5728\u3057\u307E\u3059\u3002\u66F4\u65B0\u3059\u308B\u5834\u5408\u306F\u300C\u66F4\u65B0\u300D\u3092\u62BC\u3057\u3066\u304F\u3060\u3055\u3044\u3002");return}await h.post("/attendance/shifts/definitions",n),await P(),Y()}),r.addEventListener("click",async e=>{e.preventDefault();const n=F();if(!j(n)){alert("\u540D\u79F0\u30FB\u958B\u59CB\u30FB\u7D42\u4E86\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044");return}if(!U(n.name)){alert("\u66F4\u65B0\u3067\u304D\u307E\u305B\u3093: \u5BFE\u8C61\u306E\u30B7\u30D5\u30C8\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3002\u8FFD\u52A0\u3059\u308B\u5834\u5408\u306F\u300C\u8FFD\u52A0\u300D\u3092\u62BC\u3057\u3066\u304F\u3060\u3055\u3044\u3002");return}await h.post("/attendance/shifts/definitions",n),await P()}),b.appendChild(Object.assign(document.createElement("div"),{className:"ui-ptitle",textContent:"\u30B7\u30D5\u30C8\u767B\u9332"})),g.classList.add("ui-filters"),g.appendChild(E),b.appendChild(g),u.appendChild(b);const bulkAssignLink=document.createElement("a");bulkAssignLink.href="/admin/attendance/shifts/bulk-assign";bulkAssignLink.textContent="一括割当（複数従業員）";bulkAssignLink.style.cssText="display:inline-block;margin:8px 16px;color:#0b2c66;font-weight:700;text-decoration:underline;";const N=document.createElement("div");N.className="shift-list-container ui-panel",N.appendChild(Object.assign(document.createElement("div"),{className:"ui-ptitle",textContent:"\u30B7\u30D5\u30C8\u4E00\u89A7"}));const S=document.createElement("table");S.className="excel-table shift-desktop-table",S.innerHTML=`
    <thead><tr>
      <th style="width:160px;">\u540D\u79F0</th>
      <th style="width:120px; text-align:center;">\u958B\u59CB\u6642\u9593</th>
      <th style="width:120px; text-align:center;">\u7D42\u4E86\u6642\u9593</th>
      <th style="width:100px; text-align:center;">\u4F11\u61A9\u6642\u9593</th>
      <th style="width:120px; text-align:center;">\u6240\u5B9A\u6642\u9593(\u5206)</th>
      <th style="width:80px; text-align:center;">\u524A\u9664</th>
    </tr></thead>
    <tbody></tbody>
  `,N.appendChild(S);const _=document.createElement("div");_.className="shift-mobile-list",N.appendChild(_);let p=[];const I=e=>String(e||"").trim(),U=e=>{const n=I(e);return n&&(Array.isArray(p)?p:[]).find(t=>I(t?.name)===n)||null},z=e=>e&&e.length>=5?e.substring(0,5):"",A=e=>{const n=S.querySelector("tbody");n.innerHTML="",_.innerHTML="";for(const t of Array.isArray(e)?e:[]){const a=document.createElement("tr"),B=document.createElement("td");B.textContent=t.name||"",B.style.textAlign="center";const D=document.createElement("td");D.textContent=z(t.start_time||""),D.style.textAlign="center";const $=document.createElement("td");$.textContent=z(t.end_time||""),$.style.textAlign="center";const M=document.createElement("td");M.textContent=String(t.break_minutes??0)+"\u5206",M.style.textAlign="center";const H=document.createElement("td");H.textContent=String(t.standard_minutes??""),H.style.textAlign="center";const q=document.createElement("td");q.style.textAlign="center";const T=document.createElement("button");T.className="btn-danger",T.textContent="\u524A\u9664",T.addEventListener("click",async o=>{o.preventDefault(),o.stopPropagation();const d=Number(t.id);if(!d){alert("\u524A\u9664\u3067\u304D\u307E\u305B\u3093: ID\u304C\u3042\u308A\u307E\u305B\u3093");return}if(confirm(`${t.name||""} \u3092\u524A\u9664\u3057\u307E\u3059\u304B\uFF1F`))try{await h.del(`/attendance/shifts/definitions/${d}`);const i=await h.get("/attendance/shifts/definitions");p=Array.isArray(i)?i:[],A(i)}catch(i){if(String(i?.message||i||"").toLowerCase().includes("409")){alert("\u3053\u306E\u30B7\u30D5\u30C8\u306F\u4F7F\u7528\u4E2D\u306E\u305F\u3081\u524A\u9664\u3067\u304D\u307E\u305B\u3093");return}alert("\u524A\u9664\u306B\u5931\u6557\u3057\u307E\u3057\u305F")}}),q.appendChild(T),a.appendChild(B),a.appendChild(D),a.appendChild($),a.appendChild(M),a.appendChild(H),a.appendChild(q),a.addEventListener("click",()=>{try{const o=document.querySelector('.form-actions input[type="text"]'),d=document.querySelectorAll('.form-actions input[type="time"]'),i=document.querySelector(".form-actions select");if(!o||d.length<2||!i)return;o.value=t.name||"",d[0].value=t.start_time||"",d[1].value=t.end_time||"",i.value=String(t.break_minutes??0),W()}catch{}}),n.appendChild(a);const v=document.createElement("div");v.className="shift-card",v.innerHTML=`
        <div class="shift-card-header">
          <span class="shift-card-title">${t.name||""}</span>
          <button class="shift-card-del-btn" aria-label="\u524A\u9664">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
          </button>
        </div>
        <div class="shift-card-body">
          <div class="shift-card-row">
            <span class="shift-card-label">\u6642\u9593:</span>
            <span class="shift-card-value">${z(t.start_time||"")} - ${z(t.end_time||"")}</span>
          </div>
          <div class="shift-card-row">
            <span class="shift-card-label">\u4F11\u61A9:</span>
            <span class="shift-card-value">${String(t.break_minutes??0)}\u5206</span>
          </div>
          <div class="shift-card-row">
            <span class="shift-card-label">\u6240\u5B9A:</span>
            <span class="shift-card-value">${String(t.standard_minutes??"")}\u5206</span>
          </div>
        </div>
      `,v.querySelector(".shift-card-del-btn").addEventListener("click",async o=>{o.preventDefault(),o.stopPropagation();const d=Number(t.id);if(!d){alert("\u524A\u9664\u3067\u304D\u307E\u305B\u3093: ID\u304C\u3042\u308A\u307E\u305B\u3093");return}if(confirm(`${t.name||""} \u3092\u524A\u9664\u3057\u307E\u3059\u304B\uFF1F`))try{await h.del(`/attendance/shifts/definitions/${d}`);const i=await h.get("/attendance/shifts/definitions");p=Array.isArray(i)?i:[],A(i)}catch(i){if(String(i?.message||i||"").toLowerCase().includes("409")){alert("\u3053\u306E\u30B7\u30D5\u30C8\u306F\u4F7F\u7528\u4E2D\u306E\u305F\u3081\u524A\u9664\u3067\u304D\u307E\u305B\u3093");return}alert("\u524A\u9664\u306B\u5931\u6557\u3057\u307E\u3057\u305F")}}),v.addEventListener("click",()=>{try{const o=document.querySelector('.form-actions input[type="text"]'),d=document.querySelectorAll('.form-actions input[type="time"]'),i=document.querySelector(".form-actions select");if(!o||d.length<2||!i)return;o.value=t.name||"",d[0].value=t.start_time||"",d[1].value=t.end_time||"",i.value=String(t.break_minutes??0),W()}catch{}}),_.appendChild(v)}};try{p=await h.get("/attendance/shifts/definitions")}catch{p=[]}A(p);const L=document.createElement("div");L.className="table-container",L.style.cssText="padding: 0;",L.appendChild(N),u.appendChild(L),y.appendChild(u),l.innerHTML="",l.innerHTML=`
    <style>
      .shift-page-content { flex: 1 1 0%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
      .table-container { flex: 1 1 0%; min-height: 0; overflow-y: auto; overflow-x: auto; -webkit-overflow-scrolling: touch; }
      @media (max-width: 768px) {
        .shift-page-content { flex: 1 1 0% !important; min-height: 0 !important; overflow: hidden !important; display: flex !important; flex-direction: column !important; }
        .table-container { flex: 1 1 0% !important; min-height: 0 !important; overflow-y: auto !important; overflow-x: hidden !important; -webkit-overflow-scrolling: touch !important; }
        #adminContent.card { padding: 0 !important; }
      }
      .shift-fiori-override .form-title {
        font-size: 16px !important;
        font-weight: 700 !important;
        color: #111827 !important;
        letter-spacing: -0.01em;
        margin: 0 !important;
        padding: 4px 24px 8px 24px !important;
        border-bottom: none !important;
      }
      .shift-fiori-override .form-card {
        background: #fff !important;
        border: none !important;
        box-shadow: none !important;
        border-radius: 0 !important;
        padding: 0 !important;
        display: flex;
        flex-direction: column;
        flex: 1;
      }
      .shift-fiori-override .form-card .form-title {
        padding: 0 24px 12px 24px !important;
      }
      .shift-fiori-override .excel-table {
        margin: 0 !important;
        border-top: none !important;
        width: 100%;
        border-collapse: collapse;
      }
      .shift-fiori-override .excel-table th {
        padding: 6px 12px !important;
        font-size: 12px !important;
        background: #f8fafc !important;
        color: #475569 !important;
        border-bottom: 1px solid #e2e8f0 !important;
        position: sticky;
        top: 0;
        z-index: 10;
        text-align: left;
      }
      .shift-fiori-override .excel-table td {
        padding: 6px 12px !important;
        font-size: 13px !important;
        vertical-align: middle !important;
        border-bottom: 1px solid #f1f5f9 !important;
      }
      .shift-fiori-override .excel-table {
        border-collapse: collapse !important;
        width: 100% !important;
      }
      .shift-fiori-override .excel-table th {
        background-color: #e6f2ff !important;
        color: #0f172a !important;
        font-weight: 600 !important;
        border: 1px solid #cbd5e1 !important;
        padding: 4px 8px !important;
        font-size: 13px !important;
        text-align: center !important;
        white-space: nowrap;
      }
      .shift-fiori-override .excel-table td {
        border: 1px solid #cbd5e1 !important;
        padding: 2px 8px !important;
        font-size: 13px !important;
        vertical-align: middle !important;
        text-align: center !important;
      }
      .shift-fiori-override .excel-table tbody tr {
        cursor: pointer;
        transition: background-color 0.15s;
      }
      .shift-fiori-override .excel-table tbody tr:hover td {
        background-color: #f8fafc !important;
      }
      .shift-fiori-override input[type="text"],
      .shift-fiori-override input[type="time"],
      .shift-fiori-override select {
        height: 30px !important;
        font-size: 13px !important;
        padding: 0 10px !important;
        border-radius: 4px !important;
        box-sizing: border-box;
        border: 1px solid #e4e7ed;
        outline: none;
        transition: all 0.2s;
        background: #fff;
        color: #0f172a;
      }
      .shift-fiori-override input[type="text"]:focus,
      .shift-fiori-override input[type="time"]:focus,
      .shift-fiori-override select:focus {
        border-color: #3b82f6;
        box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
      }
      .shift-fiori-override .btn-primary,
      .shift-fiori-override .btn-secondary,
      .shift-fiori-override .btn-danger {
        height: 30px !important;
        min-height: 30px !important;
        font-size: 13px !important;
        padding: 0 12px !important;
        border-radius: 4px !important;
        box-sizing: border-box !important;
        border: none;
        cursor: pointer;
        font-weight: 500;
        transition: all 0.2s;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: auto !important;
        min-width: 60px !important;
      }
      .shift-fiori-override .btn-primary {
        background-color: #0a6ed1 !important;
        border: 1px solid #0a6ed1 !important;
        color: #ffffff !important;
      }
      .shift-fiori-override .btn-primary:hover {
        background-color: #0854a0 !important;
        border-color: #0854a0 !important;
        box-shadow: 0 1px 3px rgba(0,0,0,0.15) !important;
      }
      .shift-fiori-override .btn-secondary {
        background-color: transparent !important;
        border: 1px solid #0a6ed1 !important;
        color: #0a6ed1 !important;
      }
      .shift-fiori-override .btn-secondary:hover {
        background-color: #e5f0fa !important;
      }
      .shift-fiori-override .btn-danger {
        background: #fef2f2 !important;
        color: #dc2626 !important;
        border: 1px solid #fca5a5 !important;
        padding: 0 10px !important;
        height: 26px !important;
        font-size: 12px !important;
      }
      .shift-fiori-override .btn-danger:hover {
        background: #fee2e2 !important;
        border-color: #f87171 !important;
      }
      .shift-fiori-override .form-actions {
        padding: 0 24px 16px 24px !important;
        background: #f8fafc;
        border-top: 1px solid #e2e8f0;
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        flex-shrink: 0;
      }
      .shift-fiori-override .table-container {
        padding: 0 16px 24px 16px;
      }
      .shift-form-actions { display: flex; flex-wrap: wrap; gap: 12px; }
      .shift-inputs-wrap { display: flex; flex-wrap: wrap; gap: 8px; flex: 1; align-items: flex-end; }
      .shift-field-wrapper { display: flex; flex-direction: column; gap: 2px; }
      .shift-field-label { font-size: 12px; font-weight: 600; color: #475569; margin-left: 2px; }
      .shift-btns-wrap { display: flex; gap: 8px; flex-shrink: 0; align-items: flex-end; }
      .shift-input { height: 38px; border-radius: 6px; border: 1px solid #e4e7ed; padding: 0 12px; font-size: 14px; box-sizing: border-box; }
      .shift-btn { height: 40px !important; padding: 0 24px !important; border-radius: 6px !important; font-size: 14px !important; font-weight: 600 !important; cursor: pointer; box-sizing: border-box !important; display: inline-flex !important; align-items: center !important; justify-content: center !important; transition: all 0.2s ease !important; min-width: 90px !important; }
      .shift-btn:disabled { opacity: 0.5 !important; cursor: not-allowed !important; }
      
      .shift-btn-add { background: #2563eb !important; color: #ffffff !important; border: 1px solid #2563eb !important; box-shadow: 0 1px 2px rgba(37, 99, 235, 0.1) !important; }
      .shift-btn-add:hover:not(:disabled) { background: #1d4ed8 !important; border-color: #1d4ed8 !important; box-shadow: 0 4px 6px rgba(37, 99, 235, 0.2) !important; transform: translateY(-1px); }
      .shift-btn-add:active:not(:disabled) { transform: translateY(0); box-shadow: 0 1px 2px rgba(37, 99, 235, 0.1) !important; }
      
      .shift-btn-update { background: #ffffff !important; border: 1px solid #2563eb !important; color: #2563eb !important; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05) !important; }
      .shift-btn-update:hover:not(:disabled) { background: #eff6ff !important; box-shadow: 0 4px 6px rgba(37, 99, 235, 0.1) !important; transform: translateY(-1px); }
      .shift-btn-update:active:not(:disabled) { transform: translateY(0); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05) !important; }
      
      .shift-list-container { margin-top: 16px; }
      .shift-mobile-list { display: none; }
      
      .shift-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin-bottom: 12px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
      .shift-card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px; }
      .shift-card-title { font-weight: 700; font-size: 15px; color: #0f172a; }
      .shift-card-del-btn { background: #fef2f2; color: #ef4444; border: 1px solid #fecaca; border-radius: 4px; padding: 4px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
      .shift-card-row { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 14px; }
      .shift-card-label { color: #64748b; }
      .shift-card-value { color: #334155; font-weight: 500; }
      
      @media (max-width: 768px) {
        .shift-form-actions { flex-direction: column; align-items: stretch; padding: 10px !important; gap: 8px !important; }
        .shift-inputs-wrap { display: grid !important; grid-template-columns: repeat(3, 1fr); gap: 6px !important; width: 100%; align-items: start; }
        .shift-field-wrapper { width: 100%; align-items: center; flex-direction: row; justify-content: space-between; gap: 4px; }
        .shift-field-label { flex-shrink: 0; width: 60px; font-size: 11px; margin: 0; }
        
        .shift-field-wrapper:nth-child(1) { grid-column: 1 / -1; align-items: center; flex-direction: row; } /* Name full width */
        .shift-field-wrapper:nth-child(2) { grid-column: 1 / 2; flex-direction: column; align-items: flex-start; } /* Start time */
        .shift-field-wrapper:nth-child(2) .shift-field-label { width: auto; margin-bottom: 2px; }
        .shift-field-wrapper:nth-child(3) { grid-column: 2 / 3; flex-direction: column; align-items: flex-start; } /* End time */
        .shift-field-wrapper:nth-child(3) .shift-field-label { width: auto; margin-bottom: 2px; }
        .shift-field-wrapper:nth-child(4) { grid-column: 3 / 4; flex-direction: column; align-items: flex-start; } /* Break time */
        .shift-field-wrapper:nth-child(4) .shift-field-label { width: auto; margin-bottom: 2px; }
        
        .shift-input { width: 100% !important; margin: 0 !important; height: 32px !important; font-size: 12px !important; padding: 0 4px !important; flex: 1; }
        .shift-btns-wrap { display: grid; grid-template-columns: 1fr 1fr; width: 100%; gap: 8px !important; margin-top: 4px; }
        .shift-btn { width: 100%; height: 36px !important; min-height: 36px !important; border-radius: 6px !important; font-size: 13px !important; }
        
        .shift-desktop-table { display: none !important; }
        .shift-mobile-list { display: block; }
      }
    </style>
  `,l.appendChild(y)}export{Q as mount,R as mountShifts};
