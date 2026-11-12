import{escapeHtml as l}from"../_shared/dom.js";import{api as u}from"../../shared/api/client.js";let v=null;async function T({content:h}){v=new AbortController;let f=[],$=[],_=[],x=[],p="",b=new Date().getFullYear(),s=null;const M=o=>{try{const[i,c,a]=String(o).slice(0,10).split("-").map(Number),t=new Date(Date.UTC(i,c-1,a));return["\u65E5","\u6708","\u706B","\u6C34","\u6728","\u91D1","\u571F"][t.getUTCDay()]}catch{return""}},j=o=>{try{const[i,c,a]=String(o).slice(0,10).split("-").map(Number),r=new Date(Date.UTC(i,c-1,a)).getUTCDay();return r===0?"hol-dow-sun":r===6?"hol-dow-sat":""}catch{return""}},D=o=>({jp_auto:"\u795D\u65E5",jp_substitute:"\u632F\u66FF\u4F11\u65E5",jp_bridge:"\u56FD\u6C11\u306E\u4F11\u65E5",custom:"\u4F1A\u793E\u8A2D\u5B9A",fixed:"\u4F1A\u793E\u6307\u5B9A",annual:"\u5E74\u6B21",special:"\u7279\u5225"})[o]||o||"\u2014",C=[{value:"custom",label:"\u4F1A\u793E\u8A2D\u5B9A"},{value:"fixed",label:"\u4F1A\u793E\u6307\u5B9A"},{value:"annual",label:"\u5E74\u6B21\u4F11\u6687"},{value:"special",label:"\u7279\u5225\u4F11\u6687"}],L=o=>["jp_auto","jp_substitute","jp_bridge"].includes(o),q=async()=>{try{const o=await u.get("/admin/departments");if(Array.isArray(o)&&o.length>0){f=o;return}}catch(o){console.warn("[holidays] /admin/departments failed, will use fallback:",o.message||o)}},k=async()=>{try{const o=await u.get(`/holidays/jp?year=${b}`);$=Array.isArray(o.holidays)?o.holidays:[],_=Array.isArray(o.companyHolidays)?o.companyHolidays:[],Array.isArray(o.departments)&&o.departments.length>0&&f.length===0&&(f=o.departments)}catch(o){console.error("[holidays] Failed to load JP holidays:",o),$=[],_=[]}},m=async()=>{try{const o=new URLSearchParams({year:b});p&&o.set("department_id",p);const i=await u.get(`/holidays?${o.toString()}`);x=Array.isArray(i.rows)?i.rows:[]}catch(o){console.error("[holidays] Failed to load dept holidays:",o),x=[]}},A=()=>{const o=$.map(t=>({id:null,date:String(t.date||"").slice(0,10),name:t.name||"",name_en:t.name_en||"",type:t.type,is_off:1,department_name:"\u2014",department_id:null,source:"jp"})),i=_.map(t=>({id:null,date:String(t.date||"").slice(0,10),name:t.name||"",name_en:"",type:t.type||"fixed",is_off:1,department_name:"\u5168\u793E",department_id:null,source:"company"})),c=x.map(t=>({id:t.id,date:String(t.date||"").slice(0,10),name:t.name||"",name_en:"",type:t.type,is_off:t.is_off,department_name:t.department_name||f.find(r=>String(r.id)===String(t.department_id))?.name||"",department_id:t.department_id,source:"dept"})),a=[...o,...i,...c];return a.sort((t,r)=>t.date.localeCompare(r.date)),a},g=()=>{if(!h)return;const o=A(),i=f.map(e=>`<option value="${l(e.id)}" ${String(e.id)===String(p)?"selected":""}>${l(e.name)}</option>`).join(""),c=[];for(let e=b-2;e<=b+2;e++)c.push(`<option value="${e}" ${e===b?"selected":""}>${e}\u5E74</option>`);const a=o.filter(e=>e.source==="jp").length,t=o.filter(e=>e.source==="company").length,r=o.filter(e=>e.source==="dept").length,y=o.map(e=>{const n=e.source==="jp",d=e.source==="company",S=n||d;return`
        <tr class="${n?"hol-row-jp":d?"hol-row-company":"hol-row-dept"}">
          <td class="${j(e.date)}">${l(e.date)}</td>
          <td class="${j(e.date)}">${l(M(e.date))}</td>
          <td>${n?'<span class="hol-badge-jp">\u795D\u65E5</span>':d?'<span class="hol-badge-company">\u5168\u793E</span>':l(e.department_name)}</td>
          <td>${l(e.name)}${e.name_en?` <span class="hol-name-en">${l(e.name_en)}</span>`:""}</td>
          <td><span class="hol-pill ${e.is_off?"hol-pill-off":"hol-pill-on"}">${e.is_off?"\u4F11":"\u51FA\u52E4"}</span></td>
          <td>${l(D(e.type))}</td>
          <td class="hol-actions-cell">
            ${S?'<span class="hol-fixed-label">\u56FA\u5B9A</span>':`
              <button class="hol-btn-edit" data-id="${l(e.id)}" title="\u7DE8\u96C6">\u270F\uFE0F</button>
              <button class="hol-btn-del" data-id="${l(e.id)}" title="\u524A\u9664">\u{1F5D1}\uFE0F</button>
            `}
          </td>
        </tr>
      `}).join("");h.innerHTML=`
      <style>
        .hol-page { display:flex; flex-direction:column; height:100%; padding:24px; box-sizing:border-box; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
        .hol-toolbar { display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin-bottom:16px; }
        .hol-toolbar select, .hol-toolbar button { height:36px; border-radius:6px; border:1px solid #cbd5e1; padding:0 12px; font-size:13px; background:#fff; cursor:pointer; }
        .hol-toolbar button.primary { background:#1e40af; color:#fff; border-color:#1e40af; font-weight:600; }
        .hol-toolbar button.primary:hover { background:#1e3a8a; }
        .hol-toolbar button.danger { background:#fff; color:#dc2626; border-color:#fca5a5; }
        .hol-toolbar button.danger:hover { background:#fef2f2; }
        .hol-stats { display:flex; gap:12px; flex-wrap:wrap; font-size:13px; color:#64748b; margin-bottom:12px; align-items:center; }
        .hol-stats strong { color:#1e293b; }
        .hol-stat-badge { display:inline-flex; align-items:center; gap:4px; height:26px; padding:0 10px; border-radius:0; border:1px solid #c3ccd8; font-size:11.5px; font-weight:600; }
        .hol-stat-jp { background:#fef3c7; color:#92400e; }
        .hol-stat-company { background:#dbeafe; color:#1e40af; }
        .hol-stat-dept { background:#e0e7ff; color:#4338ca; }
        .hol-table-wrap { flex:1; overflow:auto; border:0; border-radius:0; background:#fff; }
        .hol-table { width:100%; border-collapse:collapse; font-size:13px; }
        .hol-table thead { background:#f8fafc; position:sticky; top:0; z-index:1; }
        .hol-table th { padding:10px 12px; text-align:left; font-weight:600; color:#475569; border-bottom:2px solid #e2e8f0; white-space:nowrap; }
        .hol-table td { padding:9px 12px; border-bottom:1px solid #f1f5f9; color:#1e293b; }
        .hol-table tbody tr:hover { background:#f8fafc; }
        .hol-row-jp { background:#fffbeb; }
        .hol-row-jp:hover { background:#fef3c7 !important; }
        .hol-row-company { background:#eff6ff; }
        .hol-row-company:hover { background:#dbeafe !important; }
        .hol-row-dept { background:#fff; }
        .hol-badge-jp { display:inline-block; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:700; background:#fde68a; color:#92400e; }
        .hol-badge-company { display:inline-block; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:700; background:#bfdbfe; color:#1e40af; }
        .hol-name-en { color:#94a3b8; font-size:11px; }
        .hol-pill { display:inline-block; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600; }
        .hol-pill-off { background:#fee2e2; color:#dc2626; }
        .hol-pill-on { background:#dcfce7; color:#16a34a; }
        .hol-fixed-label { font-size:11px; color:#94a3b8; font-style:italic; }
        .hol-actions-cell { white-space:nowrap; }
        .hol-btn-edit, .hol-btn-del { background:none; border:none; cursor:pointer; font-size:15px; padding:4px; border-radius:4px; }
        .hol-btn-edit:hover { background:#e0f2fe; }
        .hol-btn-del:hover { background:#fee2e2; }
        .hol-dow-sun { color:#dc2626; font-weight:600; }
        .hol-dow-sat { color:#2563eb; font-weight:600; }
        .hol-empty { text-align:center; padding:20px; color:#94a3b8; }
        .hol-empty-icon { display:none; }

        /* Modal */
        .hol-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.4); z-index:10000; display:flex; align-items:center; justify-content:center; }
        .hol-modal { background:#fff; border-radius:12px; padding:28px 32px; width:440px; max-width:90vw; box-shadow:0 20px 60px rgba(0,0,0,0.15); }
        .hol-modal h3 { margin:0 0 20px; font-size:16px; color:#1e293b; }
        .hol-modal label { display:block; font-size:12px; font-weight:600; color:#475569; margin-bottom:4px; margin-top:14px; }
        .hol-modal input, .hol-modal select { width:100%; height:36px; border:1px solid #cbd5e1; border-radius:6px; padding:0 10px; font-size:13px; box-sizing:border-box; }
        .hol-modal input:focus, .hol-modal select:focus { outline:none; border-color:#3b82f6; box-shadow:0 0 0 3px rgba(59,130,246,0.1); }
        .hol-modal-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:24px; }
        .hol-modal-actions button { height:36px; padding:0 16px; border-radius:6px; font-size:13px; font-weight:600; cursor:pointer; border:1px solid #cbd5e1; background:#fff; color:#475569; }
        .hol-modal-actions button.save { background:#1e40af; color:#fff; border-color:#1e40af; }
        .hol-modal-actions button.save:hover { background:#1e3a8a; }
        .hol-checkbox-row { display:flex; align-items:center; gap:8px; margin-top:14px; }
        .hol-checkbox-row input[type="checkbox"] { width:auto; height:auto; }
        .hol-hint { font-size:11px; color:#94a3b8; margin-top:4px; }

        @media (max-width:768px) {
          .hol-page { padding:12px; }
          .hol-toolbar { gap:6px; }
          .hol-toolbar select, .hol-toolbar button { height:32px; font-size:12px; padding:0 8px; }
          .hol-table { font-size:12px; }
          .hol-table th, .hol-table td { padding:7px 8px; }
          .hol-modal { padding:20px; width:95vw; }
        }
      </style>
      <div class="hol-page ui-c" style="max-width:none;height:auto;">
        <div class="ui-ph">
          <h2>\u4F11\u65E5\u8A2D\u5B9A</h2>
          <span class="ui-sp"></span>
          <button class="ui-btn danger" id="holBulkDel" ${p?"":'disabled title="\u90E8\u7F72\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044"'}>\u4E00\u62EC\u524A\u9664</button>
          <button class="ui-btn" id="holGenRule">\u5B9A\u671F\u30EB\u30FC\u30EB\u751F\u6210</button>
          <button class="ui-btn primary" id="holAdd">\uFF0B \u4F11\u65E5\u8FFD\u52A0</button>
        </div>
        <div class="ui-panel">
          <div class="ui-ptitle">\u691C\u7D22\u6761\u4EF6</div>
          <div class="ui-filters">
            <div class="ui-f"><label for="holDept">\u90E8\u7F72</label><select id="holDept" class="ui-inp"><option value="">\u5168\u90E8\u7F72</option>${i}</select></div>
            <div class="ui-f"><label for="holYear">\u5E74</label><select id="holYear" class="ui-inp">${c.join("")}</select></div>
          </div>
        </div>
        <div class="hol-stats ui-stats" style="margin-bottom:10px;">
          <span class="hol-stat-badge hol-stat-jp">\u{1F1EF}\u{1F1F5} \u795D\u65E5: ${a}\u4EF6</span>
          <span class="hol-stat-badge hol-stat-company">\u{1F3E2} \u5168\u793E\u4F11\u65E5: ${t}\u4EF6</span>
          <span class="hol-stat-badge hol-stat-dept">\u{1F4CB} \u90E8\u7F72\u8A2D\u5B9A: ${r}\u4EF6</span>
          <span>\u5408\u8A08: <strong>${o.length}</strong>\u4EF6</span>
          ${p?`<span>\u2014 ${l(f.find(e=>String(e.id)===String(p))?.name||"")}</span>`:""}
        </div>
        <div class="ui-panel"><div class="ui-ptitle">\u4F11\u65E5\u4E00\u89A7</div>
        <div class="hol-table-wrap ui-tablewrap">
          ${o.length?`
            <table class="hol-table">
              <thead>
                <tr>
                  <th>\u65E5\u4ED8</th>
                  <th>\u66DC\u65E5</th>
                  <th>\u90E8\u7F72/\u533A\u5206</th>
                  <th>\u540D\u79F0</th>
                  <th>\u4F11\u65E5</th>
                  <th>\u7A2E\u5225</th>
                  <th>\u64CD\u4F5C</th>
                </tr>
              </thead>
              <tbody>${y}</tbody>
            </table>
          `:`
            <div class="hol-empty">
              <div class="hol-empty-icon">\u{1F4C5}</div>
              <div>\u30C7\u30FC\u30BF\u304C\u3042\u308A\u307E\u305B\u3093</div>
            </div>
          `}
        </div></div>
      </div>
    `,h.querySelector("#holDept")?.addEventListener("change",async e=>{p=e.target.value,await m(),g()}),h.querySelector("#holYear")?.addEventListener("change",async e=>{b=parseInt(e.target.value,10),await Promise.all([k(),m()]),g()}),h.querySelector("#holAdd")?.addEventListener("click",()=>{s={id:null,department_id:p||"",date:"",name:"",type:"custom",is_off:!0},z()}),h.querySelector("#holBulkDel")?.addEventListener("click",async()=>{if(!p)return;const e=f.find(n=>String(n.id)===String(p))?.name||"";if(confirm(`\u300C${e}\u300D\u306E ${b}\u5E74 \u306E\u4F1A\u793E\u8A2D\u5B9A\u4F11\u65E5\u3092\u5168\u3066\u524A\u9664\u3057\u307E\u3059\u304B\uFF1F
\u203B \u795D\u65E5\uFF08\u56FD\u306E\u4F11\u65E5\uFF09\u306F\u524A\u9664\u3055\u308C\u307E\u305B\u3093\u3002`))try{await u.del(`/holidays/department/${p}/year/${b}`),await m(),g()}catch(n){alert("\u524A\u9664\u306B\u5931\u6557\u3057\u307E\u3057\u305F: "+(n.message||n))}}),h.querySelector("#holGenRule")?.addEventListener("click",()=>{GR()}),h.querySelectorAll(".hol-btn-edit").forEach(e=>{e.addEventListener("click",()=>{const n=e.dataset.id,d=x.find(S=>String(S.id)===n);d&&(s={...d,date:String(d.date||"").slice(0,10),is_off:!!d.is_off},z())})}),h.querySelectorAll(".hol-btn-del").forEach(e=>{e.addEventListener("click",async()=>{const n=e.dataset.id;if(confirm("\u3053\u306E\u4F11\u65E5\u3092\u524A\u9664\u3057\u307E\u3059\u304B\uFF1F"))try{await u.del(`/holidays/${n}`),await m(),g()}catch(d){alert("\u524A\u9664\u306B\u5931\u6557\u3057\u307E\u3057\u305F: "+(d.message||d))}})})},z=()=>{if(document.querySelector(".hol-overlay")?.remove(),!s)return;const o=!s.id,i=f.map(t=>`<option value="${l(t.id)}" ${String(t.id)===String(s.department_id)?"selected":""}>${l(t.name)}</option>`).join(""),c=C.map(t=>`<option value="${l(t.value)}" ${t.value===s.type?"selected":""}>${l(t.label)}</option>`).join(""),a=document.createElement("div");a.className="hol-overlay",a.innerHTML=`
      <div class="hol-modal">
        <h3>${o?"\u{1F3E2} \u4F1A\u793E\u4F11\u65E5\u3092\u8FFD\u52A0":"\u270F\uFE0F \u4F11\u65E5\u3092\u7DE8\u96C6"}</h3>
        <label>\u5BFE\u8C61 <span style="color:#dc2626">*</span></label>
        <select id="holModalDept" ${o?"":"disabled"}>
          <option value="">\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044</option>
          <option value="__all__" ${s.department_id==="__all__"?"selected":""}>\u{1F3E2} \u5168\u793E\uFF08\u5168\u4F53\uFF09</option>
          ${i}
        </select>
        <div class="hol-hint">\u203B\u300C\u5168\u793E\u300D\u3092\u9078\u3076\u3068\u5168\u793E\u54E1\u306B\u9069\u7528\u3055\u308C\u307E\u3059\uFF08\u304A\u76C6\u30FB\u5E74\u672B\u5E74\u59CB\u306A\u3069\uFF09</div>
        <label>\u65E5\u4ED8 <span style="color:#dc2626">*</span></label>
        <input type="date" id="holModalDate" value="${l(s.date||"")}">
        <label>\u540D\u79F0</label>
        <input type="text" id="holModalName" value="${l(s.name||"")}" placeholder="\u4F8B: \u304A\u76C6\u4F11\u307F\u3001\u5E74\u672B\u5E74\u59CB\u3001\u5275\u7ACB\u8A18\u5FF5\u65E5">
        <label>\u7A2E\u5225</label>
        <select id="holModalType">${c}</select>
        <div class="hol-checkbox-row">
          <input type="checkbox" id="holModalIsOff" ${s.is_off?"checked":""}>
          <label for="holModalIsOff" style="margin:0;cursor:pointer;">\u4F11\u65E5\u3068\u3059\u308B</label>
        </div>
        <div class="hol-modal-actions">
          <button id="holModalCancel">\u30AD\u30E3\u30F3\u30BB\u30EB</button>
          <button class="save" id="holModalSave">${o?"\u767B\u9332":"\u66F4\u65B0"}</button>
        </div>
      </div>
    `,document.body.appendChild(a),a.addEventListener("click",t=>{t.target===a&&w()}),a.querySelector("#holModalCancel").addEventListener("click",w),a.querySelector("#holModalSave").addEventListener("click",async()=>{const t=a.querySelector("#holModalDept").value,r=a.querySelector("#holModalDate").value,y=a.querySelector("#holModalName").value.trim(),e=a.querySelector("#holModalType").value,n=a.querySelector("#holModalIsOff").checked;if(!t){alert("\u5BFE\u8C61\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044");return}if(!r){alert("\u65E5\u4ED8\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044");return}try{t==="__all__"?await u.post("/holidays/company",{date:r,name:y,type:e||"fixed",is_off:n}):o?await u.post("/holidays",{department_id:t,date:r,name:y,type:e,is_off:n}):await u.patch(`/holidays/${s.id}`,{date:r,name:y,type:e,is_off:n}),w(),await Promise.all([k(),m()]),g()}catch(d){console.error("[holidays] Save failed:",d),alert("\u4FDD\u5B58\u306B\u5931\u6557\u3057\u307E\u3057\u305F: "+(d.message||JSON.stringify(d)))}})},GR=()=>{document.querySelector(".hol-overlay")?.remove();const o=f.map(e=>`<option value="${l(e.id)}" ${String(e.id)===String(p)?"selected":""}>${l(e.name)}</option>`).join(""),i=[1,2,3,4,5].map(e=>`<label style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;font-weight:400;"><input type="checkbox" class="holGenWeek" value="${e}" ${e===4?"checked":""}> 第${e}週</label>`).join(""),c=["日","月","火","水","木","金","土"].map((e,n)=>`<option value="${n}" ${n===6?"selected":""}>${e}曜日</option>`).join(""),a=document.createElement("div");a.className="hol-overlay",a.innerHTML=`
      <div class="hol-modal">
        <h3>\u{1F4C5} 定期ルール生成</h3>
        <div class="hol-hint">指定した曜日のうち、選んだ週だけを休みにし、それ以外は出勤日として登録します。（例：土曜日・第4週のみ休み）</div>
        <label>部署 <span style="color:#dc2626">*</span></label>
        <select id="holGenDept"><option value="">選択してください</option>${o}</select>
        <label>年 <span style="color:#dc2626">*</span></label>
        <input type="number" id="holGenYear" value="${b}">
        <label>曜日</label>
        <select id="holGenDow">${c}</select>
        <label>休みにする週</label>
        <div>${i}</div>
        <label style="display:flex;align-items:center;gap:6px;margin-top:10px;font-weight:400;"><input type="checkbox" id="holGenPersist" checked> 毎年自動で適用する（土曜日のみ。年ごとの生成は不要）</label>
        <div class="hol-hint" style="margin-top:4px;">祝日・会社休日に当たる土曜は休みのままです。ルールを解除するには全ての週にチェックを入れて保存してください。</div>
        <div class="hol-modal-actions">
          <button id="holGenCancel">キャンセル</button>
          <button class="save" id="holGenSave">生成</button>
        </div>
      </div>
    `,document.body.appendChild(a),a.addEventListener("click",e=>{e.target===a&&a.remove()}),a.querySelector("#holGenCancel").addEventListener("click",()=>a.remove()),a.querySelector("#holGenSave").addEventListener("click",async()=>{const e=a.querySelector("#holGenDept").value,n=parseInt(a.querySelector("#holGenYear").value,10),d=parseInt(a.querySelector("#holGenDow").value,10),S=[...a.querySelectorAll(".holGenWeek:checked")].map(t=>parseInt(t.value,10));if(!e){alert("部署を選択してください");return}if(!n){alert("年を入力してください");return}if(!S.length){alert("休みにする週を一つ以上選択してください");return}try{const t=await u.post(`/holidays/department/${e}/generate-recurring`,{year:n,weekday:d,off_weeks:S,persist:!!a.querySelector("#holGenPersist")?.checked&&d===6});a.remove(),alert(t.message||"生成しました"),await m(),g()}catch(t){alert("生成に失敗しました: "+(t.message||t))}})},w=()=>{s=null,document.querySelector(".hol-overlay")?.remove()};return await q(),await Promise.all([k(),m()]),g(),()=>{v&&(v.abort(),v=null),w()}}export{T as mount};
