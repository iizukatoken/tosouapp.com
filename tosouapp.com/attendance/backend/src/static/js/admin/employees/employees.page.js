import{requireAdmin as lt}from"../_shared/require-admin.js";import{listEmployees as Fe,getEmployee as We,createEmployee as rt,updateEmployee as ot,deleteEmployee as Le}from"../../api/employees.api.js";import{listDepartments as Ce}from"../../api/departments.api.js";import{listUsers as Te,deleteUser as Ke}from"../../api/users.api.js";import{fetchJSONAuth as T}from"../../api/http.api.js";import{$ as Ae,ensureEmployeePillStyle as it,showNavSpinner as Oe,hideNavSpinner as ie,syncTopbarSearchKeyword as Ve,clearTopbarNoResultState as be,getEmployeesMode as nt,isEmployeesPath as Je}from"./employees.helpers.js?v=20260930-search1";let Q=0;function ne(P){return Array.isArray(P)?P:P&&Array.isArray(P.rows)?P.rows:[]}async function Z(P,ce){be();try{const e=String(location.pathname||"");if(!Je(e))return;sessionStorage.getItem("navSpinner")==="1"&&Oe()}catch{}const F=++Q,A=ce||Ae("#adminContent");if(!A)return;it();const E=new URLSearchParams(location.search),V=E.get("detail"),W=E.get("edit"),Me=E.get("summary"),_e=E.get("create"),Ge=()=>{try{const e=sessionStorage.getItem("empFlashMessage")||"";return e?(sessionStorage.removeItem("empFlashMessage"),e):""}catch{return""}},j=String(P&&P.role||"").toLowerCase(),ae=j==="manager"?"/api/manager":"/api/admin",st=!1,dt="",ge=String(location.pathname||""),Pe=location.hash||"",C=nt(ge,Pe,V,W,Me,_e);try{(ge==="/admin/employees"||ge==="/admin/employees/")&&!Pe&&!V&&!W&&!Me&&!_e&&history.replaceState(null,"","/admin/employees#list")}catch{}try{document.body.classList.remove("employees-wide")}catch{}try{C==="delete"?(document.body.classList.add("emp-delete-mode"),document.documentElement.classList.add("emp-delete-mode")):(document.body.classList.remove("emp-delete-mode"),document.documentElement.classList.remove("emp-delete-mode"))}catch{}try{A.innerHTML=""}catch{}if(C==="detail"&&V){const e=await We(V);if(F!==Q)return;let t=[];try{t=j==="manager"?await T("/api/manager/departments"):await Ce()}catch{t=[]}if(F!==Q)return;let i=[];try{i=(await T("/api/branches"))?.data||[]}catch{i=[]}const o=r=>{const p=t.find(y=>String(y.id)===String(r));return p?p.name:""},m=r=>{const p=String(r||"").toLowerCase();return p==="inactive"?"\u7121\u52B9":p==="retired"?"\u9000\u8077":"\u5728\u8077"},d=r=>{if(!r||String(r)==="-"||String(r)==="0000-00-00")return"\u672A\u767B\u9332";const p=String(r),y=p.match(/^(\d{4})-(\d{2})-(\d{2})/);if(y)return`${y[1]}/${y[2]}/${y[3]}`;try{const x=new Date(p);if(!isNaN(x.getTime()))return`${x.getFullYear()}/${String(x.getMonth()+1).padStart(2,"0")}/${String(x.getDate()).padStart(2,"0")}`}catch{}return p};A.innerHTML="";const f=document.createElement("div");f.className="card detail-card";const s=String(e.tenant_role||e.role||"").toLowerCase(),u=s==="admin"?"\u7BA1\u7406\u8005":s==="manager"?"\u30DE\u30CD\u30FC\u30B8\u30E3\u30FC":s==="employee"?"\u5F93\u696D\u54E1":e.role||"",k=s==="admin"?"admin":s==="manager"?"manager":"employee",$=String(e.employment_type||"").toLowerCase(),g=$==="full_time"?"\u6B63\u793E\u54E1":$==="part_time"?"\u30D1\u30FC\u30C8\u30FB\u30A2\u30EB\u30D0\u30A4\u30C8":$==="contract"?"\u5951\u7D04\u793E\u54E1":e.employment_type||"",c=$==="full_time"?"full":$==="part_time"?"part":$==="contract"?"contract":"",b=String(e.employment_status||"").toLowerCase(),v=b==="retired"?"retired":b==="inactive"?"inactive":"active",S=(e.username||e.email||"").trim(),q=S?S[0].toUpperCase():"?";let l="";try{let r=j==="manager"?await T("/api/manager/users"):await Te();r=r&&r.rows||r;const p=r.find(y=>String(y.id)===String(e.manager_id));l=p?p.username||p.email:""}catch{}const n=`<div style="width:36px;height:36px;border-radius:50%;background:#e2e8f0;color:#475569;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;flex-shrink:0;border:1px solid #cbd5e1;">${q}</div>`,h=(i.find(r=>String(r.id)===String(e.branch_id))||{}).name||"";f.style.cssText="border:1px solid #d0d7de;border-radius:0;background:#fff;box-shadow:none;overflow:hidden;max-width:100%;box-sizing:border-box;",f.innerHTML=`
      <style>
        .sap-obj-header { display:flex; align-items:center; gap:12px; padding:10px 16px; border-bottom:1px solid #d0d7de; background:#f6f8fa; }
        .sap-obj-header .sap-name { font-size:14px; font-weight:700; color:#1c2025; }
        .sap-obj-header .sap-meta { font-size:12px; color:#5a6872; }
        .sap-obj-badges { display:flex; gap:6px; margin-left:auto; }
        .sap-badge { padding:2px 8px; font-size:11px; font-weight:600; border-radius:3px; border:1px solid; }
        .sap-badge-role { background:#ebf5ff; color:#0854a0; border-color:#b0d4f1; }
        .sap-badge-status { background:#f1fdf4; color:#256f3a; border-color:#b0e2c2; }
        .sap-section { border-bottom:1px solid #d0d7de; }
        .sap-section-title { font-size:12px; font-weight:700; color:#32363a; padding:8px 16px; background:#f6f8fa; border-bottom:1px solid #d0d7de; }
        .sap-table { width:100%; box-sizing:border-box; border-collapse:collapse; table-layout:fixed; word-break:break-word; border:1px solid #b8c2cc; }
        .sap-table td { padding:6px 12px; border:1px solid #b8c2cc; font-size:13px; vertical-align:top; }
        .sap-table td.lbl { width:110px; color:#4b5563; background:#eef2f6; font-weight:600; white-space:nowrap; }
        .sap-table td.val { color:#32363a; }
        .sap-table td.val.empty { color:#bcc3ca; }
        .sap-two-col { display:grid; grid-template-columns:1fr 1fr; gap:12px; padding:8px 16px; }
        .sap-two-col > div { min-width:0; }
        .sap-actions { padding:10px 16px; border-top:1px solid #d0d7de; display:flex; gap:6px; background:#f6f8fa; }
        /* 部門管理 > 異動 の 保存/削除 と同じく、ブラウザ標準のボタン表示にする */
        .sap-btn { cursor:pointer; transition:filter .12s, box-shadow .12s; }
        .sap-btn:hover { filter:brightness(.92); box-shadow:0 1px 3px rgba(0,0,0,.18); }
        .sap-btn:active { filter:brightness(.82); box-shadow:inset 0 1px 2px rgba(0,0,0,.25); }
        .sap-btn:focus-visible { outline:2px solid #2563eb; outline-offset:1px; }
        .sap-btn-danger, .sap-btn-del { color:#dc2626; }
        .sap-badge-status.inactive { background:#ffedd5; color:#c2410c; border-color:#fdba74; }
        .sap-badge-status.retired { background:#e5e7eb; color:#4b5563; border-color:#9ca3af; }
        @media (max-width:768px) { .sap-two-col { grid-template-columns:1fr; } }
      </style>
      <div class="sap-obj-header">
        ${n}
        <div>
          <div class="sap-name">${e.username||""}</div>
          <div class="sap-meta">${e.employee_code||"EMP"+String(e.id).padStart(3,"0")} \u30FB ${e.email||""}</div>
        </div>
        <div class="sap-obj-badges">
          <span class="sap-badge sap-badge-role">${u}</span>
          <span class="sap-badge sap-badge-status ${v}">${m(e.employment_status)}</span>
        </div>
      </div>
      <div class="sap-section">
        <div class="sap-section-title">\u57FA\u672C\u60C5\u5831</div>
        <div class="sap-two-col">
          <div>
            <table class="sap-table">
              <tr><td class="lbl">\u793E\u54E1\u756A\u53F7</td><td class="val">${e.employee_code||"EMP"+String(e.id).padStart(3,"0")}</td></tr>
              <tr><td class="lbl">\u6C0F\u540D</td><td class="val">${e.username||""}</td></tr>
              <tr><td class="lbl">\u30E1\u30FC\u30EB</td><td class="val">${e.email||""}</td></tr>
              <tr><td class="lbl">\u96FB\u8A71\u756A\u53F7</td><td class="val ${e.phone?"":"empty"}">${e.phone||"\u2014"}</td></tr>
            </table>
          </div>
          <div>
            <table class="sap-table">
              <tr><td class="lbl">\u751F\u5E74\u6708\u65E5</td><td class="val">${d(e.birth_date)}</td></tr>
              <tr><td class="lbl">\u6027\u5225</td><td class="val">${e.gender==="male"?"\u7537\u6027":e.gender==="female"?"\u5973\u6027":e.gender==="other"?"\u305D\u306E\u4ED6":"\u2014"}</td></tr>
              <tr><td class="lbl">\u4F4F\u6240</td><td class="val ${e.address?"":"empty"}">${e.address||"\u2014"}</td></tr>
            </table>
          </div>
        </div>
      </div>
      <div class="sap-section">
        <div class="sap-section-title">\u8077\u52D9\u60C5\u5831</div>
        <div class="sap-two-col">
          <div>
            <table class="sap-table">
              <tr><td class="lbl">\u652F\u5E97</td><td class="val">${h||"\u672A\u8A2D\u5B9A"}</td></tr>
              <tr><td class="lbl">\u90E8\u7F72</td><td class="val">${o(e.departmentId)||"\u672A\u8A2D\u5B9A"}</td></tr>
              <tr><td class="lbl">\u30B7\u30D5\u30C8</td><td class="val" id="shiftValue">\u2014</td></tr>
              <tr><td class="lbl">\u30DE\u30CD\u30FC\u30B8\u30E3\u30FC</td><td class="val">${l||"\u2014"}</td></tr>
              <tr><td class="lbl">\u96C7\u7528\u5F62\u614B</td><td class="val">${g}</td></tr>
              <tr><td class="lbl">\u30EC\u30D9\u30EB</td><td class="val ${e.level?"":"empty"}">${e.level||"\u2014"}</td></tr>
            </table>
          </div>
          <div>
            <table class="sap-table">
              <tr><td class="lbl">\u5165\u793E\u65E5</td><td class="val">${d(e.hire_date)}</td></tr>
              <tr><td class="lbl">\u8A66\u7528\u958B\u59CB</td><td class="val">${d(e.probation_date)}</td></tr>
              <tr><td class="lbl">\u6B63\u793E\u54E1\u5316</td><td class="val">${d(e.official_date)}</td></tr>
              <tr><td class="lbl">\u5951\u7D04\u7D42\u4E86</td><td class="val">${d(e.contract_end)}</td></tr>
              <tr><td class="lbl">\u57FA\u672C\u7D66</td><td class="val">${e.base_salary==null?"\u2014":"\xA5"+Number(e.base_salary).toLocaleString()}</td></tr>
            </table>
          </div>
        </div>
      </div>
      <div class="sap-section">
        <div class="sap-section-title">\u5199\u771F</div>
        <div style="padding:8px 16px;"><div id="detailAvatarGallery" style="display:flex;gap:8px;flex-wrap:wrap;min-height:32px;"><span style="color:#6a6d70;font-size:12px;">\u8AAD\u307F\u8FBC\u307F\u4E2D...</span></div></div>
      </div>
      <div class="sap-actions">
        <button type="button" class="sap-btn" id="btnDetailEdit" href="/admin/employees?edit=${e.id}">\u7DE8\u96C6</button>
        <button type="button" class="sap-btn" id="btnDetailDocuments" href="/admin/employees/documents?userId=${e.id}&name=${encodeURIComponent(e.username||e.email||"")}">\u66F8\u985E</button>
        ${j==="admin"?(v==="active"?`<button type="button" class="sap-btn sap-btn-danger" id="btnDetailDisable" data-uid="${e.id}">\u7121\u52B9\u5316</button>`:`<button type="button" class="sap-btn sap-btn-enable" id="btnDetailEnable" data-uid="${e.id}">\u6709\u52B9\u306B\u623B\u3059</button>`):""}
        ${j==="admin"?`<button type="button" class="sap-btn sap-btn-del" id="btnDetailDelete" data-uid="${e.id}">\u524A\u9664</button>`:""}
        <button type="button" class="sap-btn" id="btnDetailBack" href="/admin/employees#list">\u4E00\u89A7\u3078</button>
      </div>
    `,A.appendChild(f),f.querySelectorAll(".sap-actions button[href]").forEach(r=>r.addEventListener("click",p=>{p.defaultPrevented||(window.location.href=r.getAttribute("href"))})),f.querySelector("#btnDetailEnable")?.addEventListener("click",async()=>{if(confirm(`この社員（${e.username||e.email}）を有効（在職）に戻しますか？ログインできるようになります。`))try{await ot(e.id,{employmentStatus:"active"}),alert("有効に戻しました（状態: 在職）"),await Z(P)}catch(r){alert(String(r?.message||"有効化に失敗しました"))}}),f.querySelector("#btnDetailDisable")?.addEventListener("click",async()=>{if(confirm(`\u3053\u306E\u793E\u54E1\uFF08${e.username||e.email}\uFF09\u3092\u7121\u52B9\u5316\u3057\u307E\u3059\u304B\uFF1F`))try{await Le(e.id),alert("\u7121\u52B9\u5316\u3057\u307E\u3057\u305F\uFF08\u72B6\u614B: \u7121\u52B9/\u4F11\u8077\uFF09"),history.replaceState(null,"","/admin/employees#list"),await Z(P)}catch(r){alert(String(r?.message||"\u7121\u52B9\u5316\u306B\u5931\u6557\u3057\u307E\u3057\u305F"))}}),f.querySelector("#btnDetailDelete")?.addEventListener("click",async()=>{if(confirm(`\u3053\u306E\u793E\u54E1\uFF08${e.username||e.email}\uFF09\u3092\u5B8C\u5168\u306B\u524A\u9664\u3057\u307E\u3059\u304B\uFF1F\u3053\u306E\u64CD\u4F5C\u306F\u53D6\u308A\u6D88\u305B\u307E\u305B\u3093\u3002`))try{await Ke(String(e.id)),alert("\u524A\u9664\u3057\u307E\u3057\u305F"),history.replaceState(null,"","/admin/employees#list"),await Z(P)}catch(r){alert(String(r?.message||"\u524A\u9664\u306B\u5931\u6557\u3057\u307E\u3057\u305F"))}});try{const r=new Date(Date.now()+324e5).toISOString().slice(0,10),p=await T(`/api/attendance/shifts/assignments?userId=${encodeURIComponent(String(e.id))}&from=1900-01-01&to=2999-12-31`),x=(p&&Array.isArray(p.items)?p.items:[]).find(_=>{const J=String(_.start_date||"").slice(0,10),te=String(_.end_date||"").slice(0,10),he=!!J&&J<=r,at=!te||te>=r;return he&&at})||null;let M="\u2014",L="\u2014",D="\u2014";const H=`${String(x?.start_date||"\u2014")}${x?.end_date?" \u301C "+String(x.end_date):""}`;if(x){let _=null;if(x.shiftId)try{_=(await T("/api/attendance/shifts/definitions")||[]).find(te=>String(te.id)===String(x.shiftId))||null}catch{}x.shift&&typeof x.shift=="object"?(M=String(x.shift.name||""),L=String(x.shift.start_time||"\u2014"),D=String(x.shift.end_time||"\u2014"),(!L||L==="\u2014"||!D||D==="\u2014")&&_&&(L=String(_.start_time||L||"\u2014"),D=String(_.end_time||D||"\u2014"))):(M=String(_?_.name||"":x.shift||""),L=_?String(_.start_time||"\u2014"):"\u2014",D=_?String(_.end_time||"\u2014"):"\u2014")}const O=f.querySelector("#shiftValue");if(O){const _=M&&M!=="\u2014"?M:"\u2014",J=L&&L!=="\u2014"&&D&&D!=="\u2014"?`${L}-${D}`:"\u2014",te=H&&!H.startsWith("\u2014")?` ${H}`:"";O.innerHTML=`<span style="display:inline-block;padding:4px 12px;border-radius:999px;background:#eef5ff;color:#0b2c66;font-weight:700;margin-right:8px;">${_}</span><span style="font-weight:700;color:#334155;margin-right:8px;">${J}</span><span style="color:#64748b;">${te}</span>`}}catch{}try{const r=f.querySelector("#detailAvatarGallery");if(r){const p=await T(`${ae}/employees/${encodeURIComponent(String(e.id))}/photos`),y=Array.isArray(p)?p:[];y.length?r.innerHTML=y.map(x=>{const M=String(x?.url||"").trim(),L=encodeURI(M),D=String(x?.originalName||"").trim();return`
              <a href="${L}" target="_blank" rel="noopener noreferrer" style="border:1px solid #cbd5e1;border-radius:8px;padding:6px;background:#fff;text-decoration:none;">
                <img src="${L}" alt="${D||"photo"}" style="width:72px;height:72px;object-fit:cover;border-radius:6px;display:block;">
                <div style="max-width:96px;font-size:11px;color:#334155;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:4px;" title="${D}">${D||"photo"}</div>
              </a>
            `}).join(""):r.innerHTML='<span style="color:#64748b;">\u4FDD\u5B58\u6E08\u307F\u5199\u771F\u306F\u3042\u308A\u307E\u305B\u3093\uFF08\u7DE8\u96C6\u753B\u9762\u304B\u3089\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9\u3067\u304D\u307E\u3059\uFF09</span>'}}catch{const p=f.querySelector("#detailAvatarGallery");p&&(p.innerHTML='<span style="color:#b91c1c;">\u5199\u771F\u306E\u8AAD\u307F\u8FBC\u307F\u306B\u5931\u6557\u3057\u307E\u3057\u305F</span>')}try{const r=["q","dept","employmentType","role","status","hireFrom","hireTo","sortKey","sortDir","page"],p=new URLSearchParams;for(const H of r){const O=E.get(H);O&&p.set(H,O)}const y=p.toString(),x=`/admin/employees${y?"?"+y:""}#list`,M=`/admin/employees?edit=${e.id}${y?"&"+y:""}`,L=f.querySelector("#btnDetailEdit");L&&L.setAttribute("href",M);const D=f.querySelector("#btnDetailBack");D&&(D.setAttribute("href",x),D.addEventListener("click",H=>{H.preventDefault(),window.location.href="/admin/employees"}))}catch{}ie();return}A.innerHTML="";const Ie=Ge();let _flashUid="";try{_flashUid=sessionStorage.getItem("empFlashUserId")||"",sessionStorage.removeItem("empFlashUserId")}catch{}if(Ie){/* 保存成功はトースト表示（画面右上に重ねて出すので一覧がずれない）。3秒で自動で消え、×で即閉じも可 */try{document.querySelectorAll(".emp-toast").forEach(t=>t.remove())}catch{}const e=document.createElement("div");e.className="emp-toast",e.setAttribute("role","status"),e.setAttribute("aria-live","polite"),e.style.cssText="position:fixed;top:64px;right:20px;z-index:3000;display:flex;align-items:center;gap:10px;max-width:420px;padding:10px 12px 10px 14px;background:#f0fdf4;color:#166534;border:1px solid #86efac;border-left:4px solid #16a34a;box-shadow:0 8px 24px rgba(15,23,42,.14);font-size:13px;font-weight:600;opacity:0;transform:translateY(-8px);transition:opacity .25s ease,transform .25s ease;";const _ic=document.createElement("span");_ic.textContent="✓",_ic.style.cssText="flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:999px;background:#16a34a;color:#fff;font-size:12px;font-weight:700;",e.appendChild(_ic);const _msg=document.createElement("span");_msg.textContent=Ie,_msg.style.flex="1 1 auto",e.appendChild(_msg);const _x=document.createElement("button");_x.type="button",_x.textContent="×",_x.setAttribute("aria-label","閉じる"),_x.style.cssText="flex:0 0 auto;border:none;background:transparent;color:#166534;font-size:18px;line-height:1;cursor:pointer;padding:0 2px;",e.appendChild(_x);document.body.appendChild(e),requestAnimationFrame(()=>{e.style.opacity="1",e.style.transform="translateY(0)"});const _hide=()=>{e.style.opacity="0",e.style.transform="translateY(-8px)",setTimeout(()=>{try{e.remove()}catch{}},300)};_x.addEventListener("click",_hide),setTimeout(_hide,3e3)}/* 直前に保存した社員の行を一時的にハイライトする（一覧の描画後に呼ぶ） */const _flashRow=()=>{if(!_flashUid)return;const r=document.querySelector(`tr[data-detail-id="${CSS.escape(_flashUid)}"]`);_flashUid="";if(!r)return;r.querySelectorAll("td").forEach(td=>{td.style.transition="background-color 2.4s ease",td.style.setProperty("background-color","#dcfce7","important")});try{r.scrollIntoView({block:"nearest"})}catch{}setTimeout(()=>{r.querySelectorAll("td").forEach(td=>td.style.setProperty("background-color","transparent","important"))},600),setTimeout(()=>{r.querySelectorAll("td").forEach(td=>{td.style.removeProperty("background-color"),td.style.removeProperty("transition")})},3200)};let I=[],le=[],G=[];const re=e=>/forbidden|access denied|insufficient permission/i.test(String(e&&e.message||"")),Ye=e=>!0;try{if(j==="manager"){const e=await T("/api/manager/users");I=ne(e)}else I=ne(await Fe())}catch(e){if(re(e)||G.push(`\u4E00\u89A7: ${e&&e.message?e.message:"unknown"}`),j!=="manager")try{const t=await T("/api/manager/users");I=ne(t)}catch(t){re(t)||G.push(`\u4E00\u89A7(\u7BA1\u7406\u8005\u4E88\u5099): ${t&&t.message?t.message:"unknown"}`);try{I=ne(await Te())}catch(i){re(i)||G.push(`\u4E00\u89A7(\u4E88\u5099): ${i&&i.message?i.message:"unknown"}`),I=[]}}else try{I=ne(await Fe())}catch(t){re(t)||G.push(`\u4E00\u89A7(\u4E88\u5099): ${t&&t.message?t.message:"unknown"}`),I=[]}}if(F!==Q)return;try{I=(I||[]).filter(Ye)}catch{I=[]}try{le=j==="manager"?await T("/api/manager/departments"):await Ce()}catch(e){re(e)||G.push(`\u90E8\u7F72: ${e&&e.message?e.message:"unknown"}`);try{le=j==="manager"?await Ce():await T("/api/manager/departments")}catch(t){re(t)||G.push(`\u90E8\u7F72(\u4E88\u5099): ${t&&t.message?t.message:"unknown"}`),le=[]}}let Y=[];try{Y=(await T("/api/branches"))?.data||[]}catch{Y=[]}let pe=[];const ze=j==="sysadmin"||j==="owner";if(ze)try{pe=(await T("/api/platform/tenants"))?.tenants||[]}catch{pe=[]}if(F!==Q)return;if(j==="manager"&&(!I||I.length===0))try{const e=document.createElement("div");e.style.color="#0b2c66",e.style.margin="8px 0",e.style.fontWeight="700",e.textContent="\u5F93\u696D\u54E1\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3002\u5F93\u696D\u54E1\u304C\u672A\u767B\u9332\u304B\u3001\u8868\u793A\u6761\u4EF6\u306B\u4E00\u81F4\u3057\u307E\u305B\u3093\u3002",A.appendChild(e)}catch{}if(G.length){const e=document.createElement("div");e.style.color="#b00020",e.style.margin="8px 0",e.textContent=`\u8AAD\u307F\u8FBC\u307F\u30A8\u30E9\u30FC: ${G.join(" / ")}`,A.appendChild(e)}if(W){const e=await We(W);if(F!==Q)return;A.innerHTML="";const t=document.createElement("form");t.innerHTML=`
      <style>
        .emp-edit-wrap { max-width:960px; margin:0 auto; }
        .emp-edit-wrap .emp-add-form td input, .emp-edit-wrap .emp-add-form td select { transition:border-color .15s,box-shadow .15s; outline:none; }
        .emp-edit-wrap .emp-add-form td input:focus, .emp-edit-wrap .emp-add-form td select:focus { border-color:#2563eb; box-shadow:0 0 0 2px rgba(37,99,235,.12); }
        .emp-edit-wrap .emp-add-form .section-header { background:#f1f5f9; padding:10px 16px; font-weight:700; font-size:13px; color:#0f172a; border-bottom:1px solid #d1d5db; }
        .emp-edit-wrap .emp-add-form .field-label { width:120px; padding:9px 14px; border-bottom:1px solid #e5e7eb; font-size:13px; font-weight:500; color:#374151; background:#f8fafc; vertical-align:middle; white-space:nowrap; }
        .emp-edit-wrap .emp-add-form .field-value { padding:8px 12px; border-bottom:1px solid #e5e7eb; vertical-align:middle; }
        .emp-edit-wrap .emp-add-form .field-value input, .emp-edit-wrap .emp-add-form .field-value select { width:100%; height:32px; border:1px solid #d1d5db; padding:0 8px; font-size:13px; box-sizing:border-box; background:#fff; color:#0f172a; }
        .emp-edit-wrap .emp-add-form .field-value select { cursor:pointer; }
        .emp-edit-wrap .emp-add-form tr:last-child .field-label, .emp-edit-wrap .emp-add-form tr:last-child .field-value { border-bottom:none; }
        .emp-edit-2col { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px; }
        @media(max-width:700px){ .emp-edit-2col { grid-template-columns:1fr; } }
        .emp-edit-2col .emp-add-form { margin-bottom:0; }
        :root[data-theme='dark'] .emp-edit-wrap .emp-add-form { border-color:#334155!important; background:#111827!important; }
        :root[data-theme='dark'] .emp-edit-wrap .emp-add-form .section-header { background:#1e293b!important; color:#93c5fd!important; border-color:#334155!important; }
        :root[data-theme='dark'] .emp-edit-wrap .emp-add-form .field-label { background:#111827!important; color:#fff!important; border-color:#1e293b!important; }
        :root[data-theme='dark'] .emp-edit-wrap .emp-add-form .field-value { border-color:#1e293b!important; }
        :root[data-theme='dark'] .emp-edit-wrap .emp-add-form .field-value input,
        :root[data-theme='dark'] .emp-edit-wrap .emp-add-form .field-value select { background:#1e293b!important; color:#f1f5f9!important; border-color:#475569!important; }
      </style>

      <div class="emp-edit-wrap">
        <div style="margin-bottom:12px;"><a id="editBack" class="btn" href="#list">\u2190 \u793E\u54E1\u4E00\u89A7\u3078\u623B\u308B</a></div>
        <h4 style="margin:0 0 16px;font-size:17px;font-weight:700;color:#0f172a;">\u793E\u54E1\u7DE8\u96C6\uFF08${e.employee_code||"EMP"+String(e.id).padStart(3,"0")}\uFF09</h4>

        <!-- 2 c\u1ED9t: \u57FA\u672C\u60C5\u5831 + \u8077\u52D9\u60C5\u5831 -->
        <div class="emp-edit-2col">
          <div class="emp-add-form" style="border:1px solid #cbd5e1;box-shadow:0 1px 3px rgba(0,0,0,.04);">
            <div class="section-header">\u57FA\u672C\u60C5\u5831</div>
            <table style="width:100%;border-collapse:collapse;">
              <tr><td class="field-label">\u793E\u54E1\u756A\u53F7</td><td class="field-value"><span style="font-size:13px;color:#334155;font-weight:600;">${e.employee_code||"EMP"+String(e.id).padStart(3,"0")}</span></td></tr>
              <tr><td class="field-label">\u6C0F\u540D <span style="color:#ef4444">*</span></td><td class="field-value"><input id="empName" value="${e.username||""}"></td></tr>
              <tr><td class="field-label">\u30E1\u30FC\u30EB <span style="color:#ef4444">*</span></td><td class="field-value"><input id="empEmail" type="email" value="${e.email||""}"></td></tr>
              <tr><td class="field-label">\u30D1\u30B9\u30EF\u30FC\u30C9</td><td class="field-value"><input id="empPw" type="password" placeholder="\u5909\u66F4\u3059\u308B\u5834\u5408\u306E\u307F\u5165\u529B" autocomplete="new-password"></td></tr>
              <tr><td class="field-label">\u751F\u5E74\u6708\u65E5</td><td class="field-value"><input id="empBirth" type="date" value="${e.birth_date||""}"></td></tr>
              <tr><td class="field-label">\u6027\u5225</td><td class="field-value"><select id="empGender"><option value=""></option><option value="">\u672A\u8A2D\u5B9A</option><option value="male" ${e.gender==="male"?"selected":""}>\u7537\u6027</option><option value="female" ${e.gender==="female"?"selected":""}>\u5973\u6027</option><option value="other" ${e.gender==="other"?"selected":""}>\u305D\u306E\u4ED6</option></select></td></tr>
              <tr><td class="field-label">\u96FB\u8A71\u756A\u53F7</td><td class="field-value"><input id="empPhone" value="${e.phone||""}" placeholder="080-1234-5678"></td></tr>
              <tr><td class="field-label">\u4F4F\u6240</td><td class="field-value"><input id="empAddr" value="${e.address||""}" placeholder="\u6771\u4EAC\u90FD..."></td></tr>
            </table>
          </div>

          <div class="emp-add-form" style="border:1px solid #cbd5e1;box-shadow:0 1px 3px rgba(0,0,0,.04);">
            <div class="section-header">\u8077\u52D9\u60C5\u5831</div>
            <table style="width:100%;border-collapse:collapse;">
              <tr><td class="field-label">\u652F\u5E97</td><td class="field-value"><select id="empBranch"><option value=""></option><option value="">\u672A\u8A2D\u5B9A</option></select></td></tr>
              <tr><td class="field-label">\u90E8\u7F72</td><td class="field-value"><select id="empDept" data-orig="${e.departmentId||""}"><option value=""></option><option value="">\u672A\u8A2D\u5B9A</option>${le.map(l=>`<option value="${l.id}" ${String(e.departmentId||"")===String(l.id)?"selected":""}>${l.name}</option>`).join("")}</select></td></tr>
              <tr id="empDeptDateRow" style="display:none;"><td class="field-label">異動日</td><td class="field-value"><input type="date" id="empDeptDate"><div style="font-size:11px;color:#64748b;margin-top:4px;">この日から新しい部署になります。前日までの勤怠・交通費は元の部署のまま集計されます。</div></td></tr>
              <tr><td class="field-label">\u5F79\u5272 <span style="color:#ef4444">*</span></td><td class="field-value"><select id="empRole"><option value=""></option><option value="employee" ${String(e.tenant_role||e.role||"").toLowerCase()==="employee"?"selected":""}>\u5F93\u696D\u54E1</option><option value="manager" ${String(e.tenant_role||e.role||"").toLowerCase()==="manager"?"selected":""}>\u30DE\u30CD\u30FC\u30B8\u30E3\u30FC</option><option value="admin" ${String(e.tenant_role||e.role||"").toLowerCase()==="admin"?"selected":""}>\u7BA1\u7406\u8005</option></select></td></tr>
              <tr><td class="field-label">\u96C7\u7528\u5F62\u614B <span style="color:#ef4444">*</span></td><td class="field-value"><select id="empType"><option value=""></option><option value="full_time" ${e.employment_type==="full_time"?"selected":""}>\u6B63\u793E\u54E1</option><option value="part_time" ${e.employment_type==="part_time"?"selected":""}>\u30D1\u30FC\u30C8\u30FB\u30A2\u30EB\u30D0\u30A4\u30C8</option><option value="contract" ${e.employment_type==="contract"?"selected":""}>\u5951\u7D04\u793E\u54E1</option></select></td></tr>
              <tr><td class="field-label">\u72B6\u614B <span style="color:#ef4444">*</span></td><td class="field-value"><select id="empStatus"><option value=""></option><option value="active" ${String(e.employment_status||"")==="active"?"selected":""}>\u5728\u8077</option><option value="inactive" ${String(e.employment_status||"")==="inactive"?"selected":""}>\u7121\u52B9/\u4F11\u8077</option><option value="retired" ${String(e.employment_status||"")==="retired"?"selected":""}>\u9000\u8077</option></select></td></tr>
              <tr><td class="field-label">\u30DE\u30CD\u30FC\u30B8\u30E3\u30FC</td><td class="field-value"><select id="empManager"><option value=""></option><option value="">\u672A\u8A2D\u5B9A</option>${I.filter(l=>l.role==="manager").map(l=>`<option value="${l.id}" ${String(e.manager_id||"")===String(l.id)?"selected":""}>${l.username||l.email}</option>`).join("")}</select></td></tr>
              <tr><td class="field-label">\u30EC\u30D9\u30EB</td><td class="field-value"><input id="empLevel" value="${e.level||""}" placeholder="L1/L2/Senior"></td></tr>
              <tr><td class="field-label">\u5165\u793E\u65E5</td><td class="field-value"><input id="empHireDate" type="date" value="${(e.hire_date||e.join_date||"").slice(0,10)}"></td></tr>
              <tr><td class="field-label">\u8A66\u7528\u958B\u59CB</td><td class="field-value"><input id="empProbDate" type="date" value="${(e.probation_date||"").slice(0,10)}"></td></tr>
              <tr><td class="field-label">\u6B63\u793E\u54E1\u5316</td><td class="field-value"><input id="empOfficialDate" type="date" value="${(e.official_date||"").slice(0,10)}"></td></tr>
              <tr><td class="field-label">\u5951\u7D04\u7D42\u4E86</td><td class="field-value"><input id="empContractEnd" type="date" value="${(e.contract_end||"").slice(0,10)}"></td></tr>
              <tr><td class="field-label">\u57FA\u672C\u7D66</td><td class="field-value"><input id="empBaseSalary" type="number" step="0.01" value="${e.base_salary==null?"":e.base_salary}" placeholder="\u5186"></td></tr>
            </table>
          </div>
        </div>

        <!-- \u30B7\u30D5\u30C8\u5272\u5F53 -->
        <div class="emp-add-form" style="border:1px solid #cbd5e1;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.04);">
          <div class="section-header">\u30B7\u30D5\u30C8\u5272\u5F53</div>
          <table style="width:100%;max-width:520px;border-collapse:collapse;">
            <tr><td class="field-label">\u30B7\u30D5\u30C8</td><td class="field-value"><select id="saShift"><option value="">\u30B7\u30D5\u30C8</option></select></td></tr>
            <tr><td class="field-label">\u9069\u7528\u958B\u59CB\u65E5</td><td class="field-value"><input id="saStart" type="date"></td></tr>
            <tr><td class="field-label">\u9069\u7528\u7D42\u4E86\u65E5</td><td class="field-value"><input id="saEnd" type="date"></td></tr>
          </table>
          <div style="padding:8px 16px;border-top:1px solid #e5e7eb;display:flex;gap:8px;">
            <button type="button" class="btn" id="btnSaAdd">\u8FFD\u52A0</button>
          </div>
          <div id="saStatus" style="font-size:12px;color:#64748b;padding:2px 16px 6px;"></div>
          <div id="saList" style="border-top:1px solid #e5e7eb;padding:8px 16px;font-size:12px;"></div>
        </div>

        <!-- \u5951\u7D04\u5185\u5BB9\u30FB\u696D\u52D9\u5185\u5BB9 -->
        <div class="emp-add-form" style="border:1px solid #cbd5e1;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.04);">
          <div class="section-header">\u5951\u7D04\u5185\u5BB9\u30FB\u696D\u52D9\u5185\u5BB9</div>
          <table style="width:100%;max-width:520px;border-collapse:collapse;">
            <tr><td class="field-label">\u958B\u59CB\u65E5</td><td class="field-value"><input id="wdStart" type="date"></td></tr>
            <tr><td class="field-label">\u7D42\u4E86\u65E5</td><td class="field-value"><input id="wdEnd" type="date"></td></tr>
            <tr><td class="field-label">\u4F01\u696D\u540D</td><td class="field-value"><input id="wdCompany" placeholder="\u4F01\u696D\u540D"></td></tr>
            <tr><td class="field-label">\u5C31\u696D\u5148\u4F4F\u6240</td><td class="field-value"><input id="wdAddr" placeholder="\u4F4F\u6240"></td></tr>
            <tr><td class="field-label">\u696D\u52D9\u5185\u5BB9</td><td class="field-value"><input id="wdWork" placeholder="\u696D\u52D9\u5185\u5BB9"></td></tr>
            <tr><td class="field-label">\u5F79\u8077</td><td class="field-value"><input id="wdRole" placeholder="\u5F79\u8077"></td></tr>
            <tr><td class="field-label">\u8CAC\u4EFB\u7A0B\u5EA6</td><td class="field-value"><input id="wdResp" placeholder="\u8CAC\u4EFB\u7A0B\u5EA6"></td></tr>
          </table>
          <div style="padding:8px 16px;border-top:1px solid #e5e7eb;display:flex;gap:8px;">
            <button type="button" class="btn" id="btnWdAdd">\u4FDD\u5B58</button>
          </div>
          <div id="wdStatus" style="font-size:12px;color:#64748b;padding:2px 16px 6px;"></div>
          <div id="wdList" style="border-top:1px solid #e5e7eb;padding:8px 16px;font-size:12px;"></div>
        </div>

        <!-- \u30D7\u30ED\u30D5\u30A3\u30FC\u30EB\u5199\u771F -->
        <div class="emp-add-form" style="border:1px solid #cbd5e1;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.04);">
          <div class="section-header">\u30D7\u30ED\u30D5\u30A3\u30FC\u30EB\u5199\u771F</div>
          <table style="width:100%;max-width:520px;border-collapse:collapse;">
            <tr>
              <td class="field-label">\u73FE\u5728\u306E\u5199\u771F</td>
              <td class="field-value">
                <div id="avatarPreviewBox" style="width:72px;height:72px;border-radius:6px;border:1px solid #cbd5e1;display:flex;align-items:center;justify-content:center;background:#f8fafc;overflow:hidden;color:#94a3b8;font-size:11px;">
                  ${e.avatar_url?`<img src="${e.avatar_url}" style="width:100%;height:100%;object-fit:cover;">`:"No Image"}
                </div>
              </td>
            </tr>
            <tr>
              <td class="field-label">\u5199\u771F\u3092\u9078\u3076</td>
              <td class="field-value">
                <!-- input file \u1EA9n \u2014 trigger b\u1EB1ng n\xFAt custom -->
                <input id="empAvatarFile" type="file" accept="image/*" multiple style="display:none;">
                <div style="display:flex;align-items:center;gap:8px;">
                  <button type="button" class="btn" id="btnChooseFile" onclick="document.getElementById('empAvatarFile').click()">\u30D5\u30A1\u30A4\u30EB\u3092\u9078\u3076</button>
                  <span id="empFileLabel" style="font-size:13px;color:#64748b;">\u9078\u629E\u3055\u308C\u3066\u3044\u307E\u305B\u3093</span>
                </div>
                <!-- Preview \u1EA3nh \u0111\xE3 ch\u1ECDn (tr\u01B0\u1EDBc khi upload) -->
                <div id="empAvatarSelectedPreview" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;"></div>
              </td>
            </tr>
            <tr id="rowUpload" style="display:none;">
              <td class="field-label">\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9</td>
              <td class="field-value" style="display:flex;align-items:center;gap:10px;border-bottom:none;">
                <button type="button" id="btnAvatarUpload" class="btn" style="background:#0f172a;color:#fff;border-color:#0f172a;">\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9</button>
                <span id="avatarUploadStatus" style="font-size:13px;color:#334155;"></span>
              </td>
            </tr>
            <tr>
              <td class="field-label">\u4FDD\u5B58\u6E08\u307F\u5199\u771F</td>
              <td class="field-value"><div id="empAvatarGallery" style="display:flex;gap:8px;flex-wrap:wrap;min-height:20px;"></div></td>
            </tr>
          </table>
        </div>

        <div class="form-actions" style="padding:12px 0;display:flex;justify-content:flex-end;align-items:center;gap:12px;">
          <div id="empEditMsg" style="color:#f87171;font-weight:600;font-size:14px;flex:1;text-align:left;display:none;"></div>
          <a id="btnCancelEdit" href="#list" style="background:transparent;color:#64748b;border:none;font-weight:bold;min-width:80px;height:40px;display:inline-flex;align-items:center;justify-content:center;text-decoration:none;cursor:pointer;">\u30AD\u30E3\u30F3\u30BB\u30EB</a>
          <button type="submit" style="background:#0f172a;color:#fff;border:none;padding:0 28px;height:40px;font-weight:700;font-size:14px;border-radius:4px;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;">
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
            \u66F4\u65B0
          </button>
        </div>
      </div>
`;try{const l=["q","dept","employmentType","role","status","hireFrom","hireTo","sortKey","sortDir","page","code","showAll"],n=new URLSearchParams;for(const x of l){const M=E.get(x);M&&n.set(x,M)}const h=n.toString(),r=`/admin/employees${h?"?"+h:""}#list`,p=t.querySelector("#editBack"),y=t.querySelector("#btnCancelEdit");p&&p.setAttribute("href",r),y&&y.setAttribute("href",r)}catch{}try{const l=t.querySelector("#empBranch");l&&Y.length&&(l.innerHTML='<option value=""></option><option value="">\u672A\u8A2D\u5B9A</option>'+Y.map(n=>`<option value="${n.id}" ${String(e.branch_id||e.branchId||"")===String(n.id)?"selected":""}>${n.name}</option>`).join(""))}catch{}t.addEventListener("submit",async l=>{l.preventDefault();const n=t.querySelector('button[type="submit"]');n&&(n.disabled=!0,n.textContent="\u4FDD\u5B58\u4E2D...");try{const h={username:document.querySelector("#empName").value.trim(),email:document.querySelector("#empEmail").value.trim(),role:document.querySelector("#empRole").value,branchId:document.querySelector("#empBranch").value?parseInt(document.querySelector("#empBranch").value,10):null,departmentId:document.querySelector("#empDept").value?parseInt(document.querySelector("#empDept").value,10):null,departmentEffectiveDate:(()=>{const r=document.querySelector("#empDeptDateRow"),d=document.querySelector("#empDeptDate");return r&&d&&r.style.display!=="none"&&d.value||null})(),level:(document.querySelector("#empLevel").value||"").trim()||null,managerId:document.querySelector("#empManager").value?parseInt(document.querySelector("#empManager").value,10):null,employmentType:document.querySelector("#empType").value,hireDate:document.querySelector("#empHireDate").value.trim()||null,probationDate:document.querySelector("#empProbDate").value.trim()||null,officialDate:document.querySelector("#empOfficialDate").value.trim()||null,contractEnd:document.querySelector("#empContractEnd").value.trim()||null,baseSalary:(document.querySelector("#empBaseSalary").value||"").trim()||null,birthDate:document.querySelector("#empBirth").value.trim()||null,gender:document.querySelector("#empGender").value||null,phone:(document.querySelector("#empPhone").value||"").trim()||null,employmentStatus:document.querySelector("#empStatus").value,address:(document.querySelector("#empAddr").value||"").trim()||null};if(!h.role||!h.employmentType||!h.employmentStatus){alert("役割・雇用形態・状態は必須です。空欄のまま保存できません。");return}await ot(e.id,h);const r=document.querySelector("#empPw").value;r&&r.length>=6&&await T(`/api/admin/users/${e.id}/password`,{method:"PATCH",body:JSON.stringify({password:r})});let p=0;const y=t.querySelector("#empAvatarFile"),x=t.querySelector("#avatarUploadStatus"),M=y&&y.files?Array.from(y.files):[];if(M.length)try{x&&(x.textContent="\u753B\u50CF\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9\u4E2D...");const L=new FormData;M.forEach(H=>L.append("files",H));const D=await T(`${ae}/employees/${encodeURIComponent(String(e.id))}/photos`,{method:"POST",body:L});p=Number(D?.count||M.length||0),x&&(x.textContent=`\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9\u5B8C\u4E86 (${p}\u4EF6)`);try{y.value=""}catch{}}catch(L){throw x&&(x.textContent=String(L?.message||"\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9\u5931\u6557")),new Error(`\u793E\u54E1\u60C5\u5831\u306F\u4FDD\u5B58\u6E08\u307F\u3067\u3059\u304C\u3001\u5199\u771F\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9\u306B\u5931\u6557\u3057\u307E\u3057\u305F: ${String(L?.message||"")}`)}try{const _nm=String(document.querySelector("#empName")?.value||e.username||"").trim(),L=(_nm?`${_nm}\u3055\u3093\u306E\u60C5\u5831\u3092\u4FDD\u5B58\u3057\u307E\u3057\u305F`:"\u4FDD\u5B58\u3057\u307E\u3057\u305F")+(p>0?`\uFF08\u5199\u771F${p}\u4EF6\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9\uFF09`:"");sessionStorage.setItem("empFlashMessage",L),sessionStorage.setItem("empFlashUserId",String(e.id))}catch{}try{const L=["q","dept","employmentType","role","status","hireFrom","hireTo","sortKey","sortDir","page","code","showAll"],D=new URLSearchParams;for(const O of L){const _=E.get(O);_&&D.set(O,_)}const H=D.toString();history.replaceState(null,"",`/admin/employees${H?"?"+H:""}#list`)}catch{}await Z(P)}catch(h){window.alert(String(h?.message||"\u4FDD\u5B58\u306B\u5931\u6557\u3057\u307E\u3057\u305F"))}finally{n&&(n.disabled=!1,n.textContent="\u66F4\u65B0")}});const i=t.querySelector("#empAvatarGallery"),o=t.querySelector("#empAvatarSelectedPreview"),m=l=>{if(!o)return;const n=Array.isArray(l)?l:[],h=t.querySelector("#empFileLabel"),r=t.querySelector("#rowUpload");h&&(h.textContent=n.length?n.map(y=>y.name).join(", "):"\u9078\u629E\u3055\u308C\u3066\u3044\u307E\u305B\u3093"),r&&(r.style.display=n.length?"":"none");const p=t.querySelector("#avatarUploadStatus");if(p&&n.length&&(p.textContent=""),!n.length){o.innerHTML='<span style="color:#94a3b8;">\u9078\u629E\u4E2D\u306E\u753B\u50CF\u306F\u3042\u308A\u307E\u305B\u3093</span>';return}o.innerHTML=n.map(y=>{const x=String(y?.name||"").trim()||"photo",M=URL.createObjectURL(y),L=encodeURI(M);return`
          <a href="${L}" target="_blank" rel="noopener noreferrer" style="border:1px solid #cbd5e1;border-radius:8px;padding:6px;background:#fff;text-decoration:none;">
            <img src="${L}" alt="${x}" style="width:72px;height:72px;object-fit:cover;border-radius:6px;display:block;">
            <div style="max-width:96px;font-size:11px;color:#334155;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:4px;" title="${x}">${x}</div>
          </a>
        `}).join("")};m([]);const d=l=>{if(!i)return;const n=Array.isArray(l)?l:[];if(!n.length){i.innerHTML='<span style="color:#64748b;">\u4FDD\u5B58\u6E08\u307F\u5199\u771F\u306F\u3042\u308A\u307E\u305B\u3093</span>';return}i.innerHTML=n.map(h=>{const r=String(h?.id||""),p=String(h?.url||"").trim(),y=encodeURI(p),x=String(h?.originalName||"").trim();return`
          <div style="border:1px solid #cbd5e1;border-radius:8px;padding:6px;background:#fff;">
            <a href="${y}" target="_blank" rel="noopener noreferrer">
              <img src="${y}" alt="${x||"photo"}" style="width:72px;height:72px;object-fit:cover;border-radius:6px;display:block;">
            </a>
            <div style="max-width:96px;font-size:11px;color:#334155;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:4px;" title="${x}">${x||"photo"}</div>
            <button type="button" class="btn-avatar-del" data-photo-id="${r}" style="margin-top:4px;font-size:11px;">\u524A\u9664</button>
          </div>
        `}).join(""),i.querySelectorAll(".btn-avatar-del").forEach(h=>{h.addEventListener("click",async r=>{const p=String(r.currentTarget?.dataset?.photoId||"").trim();if(p&&window.confirm("\u3053\u306E\u5199\u771F\u3092\u524A\u9664\u3057\u307E\u3059\u304B\uFF1F"))try{await T(`${ae}/employees/${encodeURIComponent(String(e.id))}/photos/${encodeURIComponent(p)}`,{method:"DELETE"}),await f()}catch(y){window.alert(String(y?.message||"\u524A\u9664\u306B\u5931\u6557\u3057\u307E\u3057\u305F"))}})})},f=async()=>{try{const l=await T(`${ae}/employees/${encodeURIComponent(String(e.id))}/photos`);d(l)}catch{d([])}};await f();const s=t.querySelector("#empAvatarFile");s&&s.addEventListener("change",()=>{const l=s.files?Array.from(s.files):[];m(l)});const u=t.querySelector("#btnAvatarUpload");u&&u.addEventListener("click",async l=>{l.preventDefault();try{const n=t.querySelector("#empAvatarFile"),h=t.querySelector("#avatarUploadStatus"),r=n&&n.files?Array.from(n.files):[];if(!r.length){h&&(h.textContent="\u30D5\u30A1\u30A4\u30EB\u672A\u9078\u629E");return}const p=new FormData;r.forEach(M=>p.append("files",M));const y=await T(`${ae}/employees/${encodeURIComponent(String(e.id))}/photos`,{method:"POST",body:p});h&&(h.textContent=`\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9\u5B8C\u4E86 (${Number(y?.count||r.length)}\u4EF6)`);try{n.value=""}catch{}m([]);const x=t.querySelector("#rowUpload");x&&(x.style.display="none"),await f()}catch(n){const h=t.querySelector("#avatarUploadStatus");h&&(h.textContent=String(n?.message||"\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9\u5931\u6557"))}}),t.querySelector("#editBack").addEventListener("click",async l=>{l.preventDefault();try{const n=["q","dept","employmentType","role","status","hireFrom","hireTo","sortKey","sortDir","page","code","showAll"],h=new URLSearchParams;for(const p of n){const y=E.get(p);y&&h.set(p,y)}const r=h.toString();history.replaceState(null,"",`/admin/employees${r?"?"+r:""}#list`)}catch{}await Z(P)}),t.querySelector("#btnCancelEdit").addEventListener("click",async l=>{l.preventDefault();try{const n=["q","dept","employmentType","role","status","hireFrom","hireTo","sortKey","sortDir","page","code","showAll"],h=new URLSearchParams;for(const p of n){const y=E.get(p);y&&h.set(p,y)}const r=h.toString();history.replaceState(null,"",`/admin/employees${r?"?"+r:""}#list`)}catch{}await Z(P)});const k=String(e.id),$=l=>t.querySelector(l),g=l=>{const n=$("#saStatus");n&&(n.textContent=l||"")},c=l=>{const n=$("#wdStatus");n&&(n.textContent=l||"")},b=l=>String($(l)?.value||"").trim(),v=l=>{const n=String(l||"").slice(0,10);return/^\d{4}-\d{2}-\d{2}$/.test(n)?n:""},S=async()=>{const l=$("#saShift");if(l)try{const n=await T("/api/attendance/shifts/definitions"),h=Array.isArray(n)?n:[];l.innerHTML=`<option value="">\u30B7\u30D5\u30C8</option>${h.map(r=>`<option value="${r.id}">${r.name} ${r.start_time}-${r.end_time}</option>`).join("")}`}catch{l.innerHTML='<option value="">\u30B7\u30D5\u30C8</option>'}},saListLoad=async()=>{const l=$("#saList");if(!l)return;l.innerHTML="\u8AAD\u307F\u8FBC\u307F\u4E2D...";try{const n=await T(`/api/attendance/shifts/assignments?userId=${encodeURIComponent(k)}`),h=n&&Array.isArray(n.items)?n.items:[];if(!h.length){l.innerHTML='<span style="color:#94a3b8;">\u5272\u5F53\u6E08\u307F\u30B7\u30D5\u30C8\u306F\u3042\u308A\u307E\u305B\u3093</span>';return}l.innerHTML=h.map(r=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid #f1f5f9;"><span>${r.shift?r.shift.name+" ("+r.shift.start_time+"-"+r.shift.end_time+")":"?"} ${r.start_date}${r.end_date?" \u301C "+r.end_date:" \u301C \uFF08\u7D99\u7D9A\uFF09"}</span><button type="button" class="sa-del" data-id="${r.id}" style="border:1px solid #fecaca;background:#fff1f2;color:#b91c1c;border-radius:6px;padding:2px 8px;cursor:pointer;">\u524A\u9664</button></div>`).join(""),l.querySelectorAll(".sa-del").forEach(r=>{r.addEventListener("click",async()=>{if(window.confirm("\u3053\u306E\u30B7\u30D5\u30C8\u5272\u5F53\u3092\u524A\u9664\u3057\u307E\u3059\u304B\uFF1F"))try{await T(`/api/attendance/shifts/assignments/${encodeURIComponent(r.dataset.id)}`,{method:"DELETE"}),await saListLoad()}catch(p){window.alert(String(p?.message||"\u524A\u9664\u5931\u6557"))}})})}catch(n){l.innerHTML=`<span style="color:#b91c1c;">\u8AAD\u307F\u8FBC\u307F\u5931\u6557: ${String(n?.message||"")}</span>`}};$("#btnSaAdd")?.addEventListener("click",async()=>{const l=b("#saShift"),n=b("#saStart"),h=b("#saEnd");if(!l||!n){g("\u30B7\u30D5\u30C8/\u9069\u7528\u958B\u59CB\u65E5\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044");return}g("\u4FDD\u5B58\u4E2D...");try{await T("/api/attendance/shifts/assign",{method:"POST",body:JSON.stringify({userId:k,shiftId:l,startDate:n,endDate:h||null})}),["#saShift","#saStart","#saEnd"].forEach(r=>{const p=$(r);p&&(p.value="")}),g("\u4FDD\u5B58\u3057\u307E\u3057\u305F"),await saListLoad()}catch(r){g(String(r?.message||"\u4FDD\u5B58\u5931\u6557"))}});const q=l=>/^\d{4}-\d{2}-\d{2}$/.test(String(l||"").slice(0,10));const wdListLoad=async()=>{const l=$("#wdList");if(!l)return;l.innerHTML='\u8AAD\u307F\u8FBC\u307F\u4E2D...';try{const n=await T(`/api/attendance/work-details?userId=${encodeURIComponent(k)}`),h=Array.isArray(n?.items)?n.items:[];if(!h.length){l.innerHTML='<span style="color:#94a3b8;">\u767B\u9332\u6E08\u307F\u306E\u5951\u7D04\u5185\u5BB9\u306F\u3042\u308A\u307E\u305B\u3093</span>';return}l.innerHTML='<table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr><th style="text-align:left;padding:4px 8px;background:#f1f5f9;border:1px solid #e2e8f0;">\u958B\u59CB\u65E5</th><th style="text-align:left;padding:4px 8px;background:#f1f5f9;border:1px solid #e2e8f0;">\u7D42\u4E86\u65E5</th><th style="text-align:left;padding:4px 8px;background:#f1f5f9;border:1px solid #e2e8f0;">\u4F01\u696D\u540D</th><th style="text-align:left;padding:4px 8px;background:#f1f5f9;border:1px solid #e2e8f0;">\u5C31\u696D\u5148\u4F4F\u6240</th><th style="text-align:left;padding:4px 8px;background:#f1f5f9;border:1px solid #e2e8f0;">\u696D\u52D9\u5185\u5BB9</th><th style="text-align:left;padding:4px 8px;background:#f1f5f9;border:1px solid #e2e8f0;">\u5F79\u8077</th><th style="text-align:left;padding:4px 8px;background:#f1f5f9;border:1px solid #e2e8f0;">\u8CAC\u4EFB\u7A0B\u5EA6</th><th style="padding:4px 8px;background:#f1f5f9;border:1px solid #e2e8f0;">\u64CD\u4F5C</th></tr></thead><tbody>'+h.map(r=>`<tr><td style="padding:4px 8px;border:1px solid #e2e8f0;">${String(r.startDate||r.start_date||'—')}</td><td style="padding:4px 8px;border:1px solid #e2e8f0;">${String(r.endDate||r.end_date||'—')}</td><td style="padding:4px 8px;border:1px solid #e2e8f0;">${String(r.companyName||r.company_name||'')}</td><td style="padding:4px 8px;border:1px solid #e2e8f0;">${String(r.workPlaceAddress||r.work_place_address||'')}</td><td style="padding:4px 8px;border:1px solid #e2e8f0;">${String(r.workContent||r.work_content||'')}</td><td style="padding:4px 8px;border:1px solid #e2e8f0;">${String(r.roleTitle||r.role_title||'')}</td><td style="padding:4px 8px;border:1px solid #e2e8f0;">${String(r.responsibilityLevel||r.responsibility_level||'')}</td><td style="padding:4px 8px;border:1px solid #e2e8f0;white-space:nowrap;"><button type="button" class="wd-del" data-id="${r.id}" style="border:1px solid #fecaca;background:#fff1f2;color:#b91c1c;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px;">\u524A\u9664</button></td></tr>`).join('')+'</tbody></table>';l.querySelectorAll(".wd-del").forEach(r=>{r.addEventListener("click",async()=>{if(window.confirm("\u3053\u306E\u5951\u7D04\u5185\u5BB9\u3092\u524A\u9664\u3057\u307E\u3059\u304B\uFF1F"))try{await T(`/api/attendance/work-details/${encodeURIComponent(r.dataset.id)}`,{method:"DELETE",body:JSON.stringify({userId:k})}),c("\u524A\u9664\u3057\u307E\u3057\u305F"),await wdListLoad()}catch(p){c(String(p?.message||"\u524A\u9664\u5931\u6557"))}})})}catch(n){l.innerHTML=`<span style="color:#b91c1c;">\u8AAD\u307F\u8FBC\u307F\u5931\u6557: ${String(n?.message||"")}</span>`}};$("#btnWdAdd")?.addEventListener("click",async()=>{const l={userId:k,startDate:v(b("#wdStart")),endDate:v(b("#wdEnd"))||null,companyName:b("#wdCompany"),workPlaceAddress:b("#wdAddr"),workContent:b("#wdWork"),roleTitle:b("#wdRole"),responsibilityLevel:b("#wdResp")};if(!l.startDate){c("\u958B\u59CB\u65E5\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044");return}if(!q(l.startDate)||l.endDate&&!q(l.endDate)){c("\u65E5\u4ED8\u306FYYYY-MM-DD\u5F62\u5F0F\u3067\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044");return}c("\u4FDD\u5B58\u4E2D...");try{await T("/api/attendance/work-details",{method:"POST",body:JSON.stringify(l)}),["#wdStart","#wdEnd","#wdCompany","#wdAddr","#wdWork","#wdRole","#wdResp"].forEach(n=>{const h=$(n);h&&(h.value="")}),c("\u4FDD\u5B58\u3057\u307E\u3057\u305F"),await wdListLoad()}catch(n){c(String(n?.message||"\u4FDD\u5B58\u5931\u6557"))}}),S().catch(()=>{}),saListLoad().catch(()=>{}),wdListLoad().catch(()=>{}),A.appendChild(t),ie();return}if(C==="edit"){A.innerHTML="";const e=document.createElement("form");e.innerHTML=`
      <div class="form-card form-compact form-sm form-narrow">
        <div class="form-title">\u3010\u793E\u54E1\u7DE8\u96C6\u3011</div>
        <div class="form-sep"></div>
        <div class="form-grid">
          <div class="form-label">\u793E\u54E1\u756A\u53F7</div>
          <div class="form-input">
            <span class="bracket"><input id="editKey" placeholder="EMP001 \u307E\u305F\u306F ID \u6570\u5B57"></span>
          </div>
        </div>
        <div id="editKeyErr" style="color:#b00020;display:none;margin-top:8px;"></div>
        <div class="form-actions" style="margin-top:8px;">
          <button type="submit">\u7DE8\u96C6\u3078</button>
        </div>
      </div>
    `,e.addEventListener("submit",async t=>{t.preventDefault();const i=e.querySelector("#editKeyErr"),o=(document.querySelector("#editKey").value||"").trim();if(!o){i&&(i.style.display="block",i.textContent="\u793E\u54E1\u756A\u53F7\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002");try{const d=document.querySelector("#editKey");d&&d.focus&&d.focus()}catch{}return}i&&(i.style.display="none",i.textContent="");let m=null;if(/^\d+$/.test(o))m=parseInt(o,10);else try{Oe();let d=await Promise.race([T(j==="manager"?"/api/manager/users":"/api/admin/employees"),new Promise((s,u)=>setTimeout(()=>u(new Error("timeout")),8e3))]);d=d&&d.rows||d;const f=d.find(s=>{const u=String(s.employee_code||"").toUpperCase(),k=("EMP"+String(s.id).padStart(3,"0")).toUpperCase();return u===o.toUpperCase()||k===o.toUpperCase()});f&&(m=f.id)}catch(d){alert(String(d&&d.message?d.message:"\u8AAD\u307F\u8FBC\u307F\u30A8\u30E9\u30FC"))}finally{ie()}if(!m)return alert("\u5BFE\u8C61\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093");window.location.href=`/admin/employees?edit=${m}`}),A.appendChild(e);try{const t=document.querySelector("#editKey");t&&t.focus&&t.focus()}catch{}ie();return}if(C==="add"){const e=document.createElement("form");e.id="add";let t=[];if(j!=="manager")try{t=ne(await Te())}catch{t=[]}if(F!==Q)return;const i=(j!=="manager"?t.filter(c=>String(c.role)==="manager"):[]).map(c=>`<option value="${c.id}">${c.username||c.email}</option>`).join("");e.innerHTML=`
      <style>
        .emp-add-form td input, .emp-add-form td select { transition: border-color .15s, box-shadow .15s; outline:none; }
        .emp-add-form td input:focus, .emp-add-form td select:focus { border-color:#2563eb; box-shadow:0 0 0 2px rgba(37,99,235,.12); }
        .emp-add-form .section-header { background:#f1f5f9; padding:12px 20px; font-weight:700; font-size:14px; color:#0f172a; border-bottom:1px solid #d1d5db; letter-spacing:0.3px; }
        .emp-add-form .field-label { width:130px; padding:12px 20px; border-bottom:1px solid #e5e7eb; font-size:13px; font-weight:500; color:#374151; background:#f8fafc; vertical-align:middle; }
        .emp-add-form .field-value { padding:10px 16px; border-bottom:1px solid #e5e7eb; vertical-align:middle; }
        .emp-add-form .field-value input, .emp-add-form .field-value select { width:100%; max-width:420px; height:34px; border:1px solid #d1d5db; padding:0 10px; font-size:14px; box-sizing:border-box; background:#fff; color:#0f172a; }
        .emp-add-form .field-value select { cursor:pointer; }
        .emp-add-form tr:last-child .field-label, .emp-add-form tr:last-child .field-value { border-bottom:none; }
        /* 部門管理 > 異動 と同じブラウザ標準ボタン + ホバー効果 */
        .emp-wiz-btn { cursor:pointer; transition:filter .12s, box-shadow .12s; }
        .emp-wiz-btn:hover { filter:brightness(.92); box-shadow:0 1px 3px rgba(0,0,0,.18); }
        .emp-wiz-btn:active { filter:brightness(.82); box-shadow:inset 0 1px 2px rgba(0,0,0,.25); }
        .emp-wiz-btn:focus-visible { outline:2px solid #2563eb; outline-offset:1px; }

        /* Dark mode */
        :root[data-theme='dark'] .emp-add-form { border-color:#334155 !important; background:#111827 !important; }
        :root[data-theme='dark'] .emp-add-form .section-header { background:#1e293b !important; color:#93c5fd !important; border-color:#334155 !important; font-size:15px !important; }
        :root[data-theme='dark'] .emp-add-form .field-label { background:#111827 !important; color:#ffffff !important; border-color:#1e293b !important; font-weight:600 !important; }
        :root[data-theme='dark'] .emp-add-form .field-value { border-color:#1e293b !important; background:#111827 !important; }
        :root[data-theme='dark'] .emp-add-form .field-value input,
        :root[data-theme='dark'] .emp-add-form .field-value select { background:#1e293b !important; color:#f1f5f9 !important; border-color:#475569 !important; border-radius:6px !important; }
        :root[data-theme='dark'] .emp-add-form .field-value input:focus,
        :root[data-theme='dark'] .emp-add-form .field-value select:focus { border-color:#3b82f6 !important; box-shadow:0 0 0 2px rgba(59,130,246,.2) !important; }
        :root[data-theme='dark'] .emp-add-form .field-value input::placeholder { color:#64748b !important; }
        :root[data-theme='dark'] .emp-add-form div[style*="border-right"] { border-color:#334155 !important; }
      </style>
      <div style="margin-bottom:20px;"><a id="addBack" class="btn" href="#list" style="color:#475569;text-decoration:none;font-size:13px;display:inline-flex;align-items:center;gap:4px;">\u2190 \u793E\u54E1\u4E00\u89A7\u3078\u623B\u308B</a></div>
      
      <!-- Step Indicator -->
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:20px;flex-wrap:wrap;">
        <div id="stepInd1" style="display:flex;align-items:center;gap:6px;">
          <span style="width:28px;height:28px;border-radius:50%;background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;">1</span>
          <span style="font-size:13px;font-weight:600;color:#0f172a;">\u57FA\u672C\u60C5\u5831</span>
        </div>
        <div style="flex:0 0 40px;height:2px;background:#cbd5e1;"></div>
        <div id="stepInd2" style="display:flex;align-items:center;gap:6px;opacity:0.4;">
          <span style="width:28px;height:28px;border-radius:50%;background:#94a3b8;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;">2</span>
          <span style="font-size:13px;font-weight:600;color:#64748b;">\u8077\u52D9\u60C5\u5831</span>
        </div>
        <div style="flex:0 0 40px;height:2px;background:#cbd5e1;"></div>
        <div id="stepInd3" style="display:flex;align-items:center;gap:6px;opacity:0.4;">
          <span style="width:28px;height:28px;border-radius:50%;background:#94a3b8;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;">3</span>
          <span style="font-size:13px;font-weight:600;color:#64748b;">\u30B7\u30D5\u30C8\u5272\u5F53</span>
        </div>
        <div style="flex:0 0 40px;height:2px;background:#cbd5e1;"></div>
        <div id="stepInd4" style="display:flex;align-items:center;gap:6px;opacity:0.4;">
          <span style="width:28px;height:28px;border-radius:50%;background:#94a3b8;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;">4</span>
          <span style="font-size:13px;font-weight:600;color:#64748b;">\u5951\u7D04\u5185\u5BB9</span>
        </div>
      </div>

      <!-- Step 1: \u57FA\u672C\u60C5\u5831 -->
      <div id="step1" class="emp-add-form" style="border:1px solid #cbd5e1; margin-bottom:20px; box-shadow:0 1px 3px rgba(0,0,0,.04);">
        <div class="section-header">\u57FA\u672C\u60C5\u5831</div>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td class="field-label">\u6240\u5C5E\u4F1A\u793E <span style="color:#ef4444">*</span></td><td class="field-value"><select id="empTenantSelect" style="font-weight:600;"><option value="">\u8AAD\u307F\u8FBC\u307F\u4E2D...</option></select></td></tr>
          <tr><td class="field-label">\u793E\u54E1\u756A\u53F7 <span style="color:#ef4444">*</span></td><td class="field-value"><input id="empCode" placeholder="\u4F8B: EMP001"></td></tr>
          <tr><td class="field-label">\u6C0F\u540D <span style="color:#ef4444">*</span></td><td class="field-value"><input id="empName" placeholder="\u5C71\u7530 \u592A\u90CE"></td></tr>
          <tr><td class="field-label">\u30E1\u30FC\u30EB <span style="color:#ef4444">*</span></td><td class="field-value"><input id="empEmail" type="email" placeholder="example@company.com"></td></tr>
          <tr><td class="field-label">\u30D1\u30B9\u30EF\u30FC\u30C9 <span style="color:#ef4444">*</span></td><td class="field-value"><input id="empPass" type="password" placeholder="8\u6587\u5B57\u4EE5\u4E0A\uFF08\u5927\u6587\u5B57\u30FB\u5C0F\u6587\u5B57\u30FB\u6570\u5B57\u3092\u542B\u3080\uFF09" autocomplete="new-password"></td></tr>
          <tr><td class="field-label">\u751F\u5E74\u6708\u65E5</td><td class="field-value"><input id="empBirth" type="date"></td></tr>
          <tr><td class="field-label">\u6027\u5225</td><td class="field-value"><select id="empGender"><option value="">\u672A\u9078\u629E</option><option value="male">\u7537\u6027</option><option value="female">\u5973\u6027</option><option value="other">\u305D\u306E\u4ED6</option></select></td></tr>
          <tr><td class="field-label">\u96FB\u8A71\u756A\u53F7</td><td class="field-value"><input id="empPhone" placeholder="080-1234-5678"></td></tr>
          <tr><td class="field-label">\u4F4F\u6240</td><td class="field-value"><input id="empAddr" placeholder="\u6771\u4EAC\u90FD..."></td></tr>
        </table>
        <div style="display:flex;justify-content:flex-end;padding:16px 20px;border-top:1px solid #e2e8f0;align-items:center;gap:12px;">
          <div id="empStepMsg" style="color:#ef4444;font-weight:500;font-size:13px;display:none;flex:1;"></div>
          <button type="button" id="btnNext" class="emp-wiz-btn">
            \u6B21\u3078 \u2192
          </button>
        </div>
      </div>

      <!-- Step 2: \u8077\u52D9\u60C5\u5831 -->
      <div id="step2" class="emp-add-form" style="border:1px solid #cbd5e1; margin-bottom:20px; box-shadow:0 1px 3px rgba(0,0,0,.04); display:none;">
        <div class="section-header">\u8077\u52D9\u60C5\u5831</div>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td class="field-label">\u652F\u5E97</td><td class="field-value"><select id="empBranch"><option value="">\u672A\u8A2D\u5B9A</option></select></td></tr>
          <tr><td class="field-label">\u90E8\u7F72</td><td class="field-value"><select id="empDept"><option value="">\u672A\u8A2D\u5B9A</option>${le.map(c=>`<option value="${c.id}">${c.name}</option>`).join("")}</select></td></tr>
          <tr><td class="field-label">\u5F79\u5272 <span style="color:#ef4444">*</span></td><td class="field-value"><select id="empRole"><option value="employee">\u5F93\u696D\u54E1</option><option value="manager">\u30DE\u30CD\u30FC\u30B8\u30E3\u30FC</option><option value="admin">\u7BA1\u7406\u8005</option></select></td></tr>
          <tr><td class="field-label">\u30DE\u30CD\u30FC\u30B8\u30E3\u30FC</td><td class="field-value"><select id="empManager"><option value="">\u672A\u8A2D\u5B9A</option>${i}</select></td></tr>
          <tr><td class="field-label">\u30EC\u30D9\u30EB</td><td class="field-value"><input id="empLevel" placeholder="\u4F8B: L1/L2/Senior"></td></tr>
          <tr><td class="field-label">\u96C7\u7528\u5F62\u614B <span style="color:#ef4444">*</span></td><td class="field-value"><select id="empType"><option value="full_time">\u6B63\u793E\u54E1</option><option value="part_time">\u30D1\u30FC\u30C8\u30FB\u30A2\u30EB\u30D0\u30A4\u30C8</option><option value="contract">\u5951\u7D04\u793E\u54E1</option></select></td></tr>
          <tr><td class="field-label">\u5165\u793E\u65E5</td><td class="field-value"><input id="empJoinDate" type="date"></td></tr>
          <tr><td class="field-label">\u8A66\u7528\u958B\u59CB</td><td class="field-value"><input id="empProbDate" type="date"></td></tr>
          <tr><td class="field-label">\u6B63\u793E\u54E1\u5316</td><td class="field-value"><input id="empOfficialDate" type="date"></td></tr>
          <tr><td class="field-label">\u5951\u7D04\u7D42\u4E86\u65E5</td><td class="field-value"><input id="empContractEnd" type="date"></td></tr>
          <tr><td class="field-label">\u57FA\u672C\u7D66</td><td class="field-value"><input id="empBaseSalary" type="number" step="0.01" placeholder="\u5186"></td></tr>
          <tr><td class="field-label">\u72B6\u614B <span style="color:#ef4444">*</span></td><td class="field-value"><select id="empStatus"><option value="active">\u5728\u8077</option><option value="inactive">\u4F11\u8077/\u7121\u52B9</option><option value="retired">\u9000\u8077</option></select></td></tr>
          <tr><td class="field-label">\u753B\u50CF</td><td class="field-value"><input id="empAvatarUrl" placeholder="\u753B\u50CFURL (\u4EFB\u610F)"><input id="empAvatarFile" type="file" accept="image/*" multiple style="margin-top:8px;font-size:12px;"></td></tr>
        </table>

        <div style="display:flex;justify-content:space-between;padding:16px 20px;border-top:1px solid #e2e8f0;">
          <button type="button" id="btnPrev" class="emp-wiz-btn">
            \u2190 \u623B\u308B
          </button>
          <button type="button" id="btnNext2" class="emp-wiz-btn">
            \u6B21\u3078 \u2192
          </button>
        </div>
      </div>

      <!-- Step 3: \u30B7\u30D5\u30C8\u5272\u5F53 (\u4EFB\u610F) -->
      <div id="step3" class="emp-add-form" style="border:1px solid #cbd5e1; margin-bottom:20px; box-shadow:0 1px 3px rgba(0,0,0,.04); display:none;">
        <div class="section-header">\u30B7\u30D5\u30C8\u5272\u5F53\uFF08\u4EFB\u610F\uFF09</div>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td class="field-label">\u30B7\u30D5\u30C8</td><td class="field-value"><select id="empShiftAssign"><option value="">\u30B7\u30D5\u30C8</option></select></td></tr>
          <tr><td class="field-label">\u958B\u59CB\u65E5</td><td class="field-value"><input id="empShiftStart" type="date"></td></tr>
          <tr><td class="field-label">\u7D42\u4E86\u65E5</td><td class="field-value"><input id="empShiftEnd" type="date"></td></tr>
        </table>
        <div style="display:flex;justify-content:space-between;padding:16px 20px;border-top:1px solid #e2e8f0;">
          <button type="button" id="btnPrev3" class="emp-wiz-btn">
            \u2190 \u623B\u308B
          </button>
          <button type="button" id="btnNext3" class="emp-wiz-btn">
            \u6B21\u3078 \u2192
          </button>
        </div>
      </div>

      <!-- Step 4: \u5951\u7D04\u5185\u5BB9\u30FB\u696D\u52D9\u5185\u5BB9 (\u4EFB\u610F) -->
      <div id="step4" class="emp-add-form" style="border:1px solid #cbd5e1; margin-bottom:20px; box-shadow:0 1px 3px rgba(0,0,0,.04); display:none;">
        <div class="section-header">\u5951\u7D04\u5185\u5BB9\u30FB\u696D\u52D9\u5185\u5BB9\uFF08\u4EFB\u610F\uFF09</div>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td class="field-label">\u958B\u59CB\u65E5</td><td class="field-value"><input id="empWdStart" type="date"></td></tr>
          <tr><td class="field-label">\u7D42\u4E86\u65E5</td><td class="field-value"><input id="empWdEnd" type="date"></td></tr>
          <tr><td class="field-label">\u4F01\u696D\u540D</td><td class="field-value"><input id="empWdCompany" placeholder="\u4F01\u696D\u540D"></td></tr>
          <tr><td class="field-label">\u5C31\u696D\u5148\u4F4F\u6240</td><td class="field-value"><input id="empWdAddr" placeholder="\u4F4F\u6240"></td></tr>
          <tr><td class="field-label">\u696D\u52D9\u5185\u5BB9</td><td class="field-value"><input id="empWdWork" placeholder="\u696D\u52D9\u5185\u5BB9"></td></tr>
          <tr><td class="field-label">\u5F79\u8077</td><td class="field-value"><input id="empWdRole" placeholder="\u5F79\u8077"></td></tr>
          <tr><td class="field-label">\u8CAC\u4EFB\u7A0B\u5EA6</td><td class="field-value"><input id="empWdResp" placeholder="\u8CAC\u4EFB\u7A0B\u5EA6"></td></tr>
        </table>
        <div style="display:flex;justify-content:space-between;padding:16px 20px;border-top:1px solid #e2e8f0;">
          <button type="button" id="btnPrev4" class="emp-wiz-btn">
            \u2190 \u623B\u308B
          </button>
          <div style="display:flex;align-items:center;gap:12px;">
            <div id="empCreateMsg" style="color:#ef4444;font-weight:500;font-size:13px;display:none;"></div>
            <button type="submit" class="emp-wiz-btn">
              \u793E\u54E1\u3092\u4F5C\u6210
            </button>
          </div>
        </div>
      </div>
`,e.querySelector("#addBack").addEventListener("click",async c=>{c.preventDefault();try{const b=["q","dept","employmentType","role","status","hireFrom","hireTo","sortKey","sortDir","page","code","showAll"],v=new URLSearchParams;for(const q of b){const l=E.get(q);l&&v.set(q,l)}const S=v.toString();history.replaceState(null,"",`/admin/employees${S?"?"+S:""}#list`)}catch{}await Z(P)});try{const c=e.querySelector("#empBranch");c&&Y.length&&(c.innerHTML='<option value="">\u672A\u8A2D\u5B9A</option>'+Y.map(b=>`<option value="${b.id}">${b.name}</option>`).join(""))}catch{}try{const c=e.querySelector("#empShiftAssign");if(c){const b=await T("/api/attendance/shifts/definitions").catch(()=>[]),v=(Array.isArray(b)?b:[]).map(S=>`<option value="${S.id}">${S.name} ${S.start_time||""}-${S.end_time||""}</option>`).join("");c.innerHTML=`<option value="">\u30B7\u30D5\u30C8</option>${v}`}}catch{}try{const c=e.querySelector("#empTenantSelect");if(c)if(ze&&pe.length>0){const v=String(P?.tenantId||"");c.innerHTML='<option value="">\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044</option>'+pe.map(S=>`<option value="${S.id}"${String(S.id)===v?" selected":""}>${S.name}</option>`).join("")}else{let v=P?.tenantId||"",S=P?.tenantName||"";if(!v)try{const q=await T("/api/auth/me");v=q?.tenantId||q?.tenant_id||"",S=q?.tenantName||q?.tenant_name||"",!v&&q?.tenants&&q.tenants.length>0&&(v=q.tenants[0].id||"",S=q.tenants[0].name||"")}catch{}if(!v)try{const q=sessionStorage.getItem("accessToken")||"";if(q){const l=JSON.parse(atob(q.split(".")[1]));v=l.tid||l.tenant_id||""}}catch{}if(v)c.innerHTML=`<option value="${v}" selected>${S||"\u4F1A\u793E #"+v}</option>`;else try{const q=await T("/api/auth/my-tenants"),l=q?.tenants||q||[];Array.isArray(l)&&l.length>0?c.innerHTML=l.map(n=>`<option value="${n.id}">${n.name}</option>`).join(""):c.innerHTML='<option value="">\u30C6\u30CA\u30F3\u30C8\u672A\u8A2D\u5B9A</option>'}catch{c.innerHTML='<option value="">\u30C6\u30CA\u30F3\u30C8\u672A\u8A2D\u5B9A</option>'}}const b=e.querySelector("#empTenantSelect");b&&b.addEventListener("change",async()=>{const v=b.value,S=e.querySelector("#empDept");if(!S)return;S.innerHTML='<option value="">\u8AAD\u307F\u8FBC\u307F\u4E2D...</option>';try{const n=await T("/api/admin/departments",{headers:v?{"X-Tenant-Id":v}:{}}),h=Array.isArray(n)?n:n?.rows||n?.departments||[];S.innerHTML='<option value="">\u672A\u8A2D\u5B9A</option>'+h.map(r=>`<option value="${r.id}">${r.name}</option>`).join("")}catch{S.innerHTML='<option value="">\u672A\u8A2D\u5B9A</option>'}const q=e.querySelector("#empBranch");if(q)try{const n=await T("/api/branches",{headers:v?{"X-Tenant-Id":v}:{}}),h=Array.isArray(n)?n:n?.data||[];q.innerHTML='<option value="">\u672A\u8A2D\u5B9A</option>'+h.map(r=>`<option value="${r.id}">${r.name}</option>`).join("")}catch{q.innerHTML='<option value="">\u672A\u8A2D\u5B9A</option>'}})}catch{}const o=[1,2,3,4].map(c=>e.querySelector(`#step${c}`)),m=[1,2,3,4].map(c=>e.querySelector(`#stepInd${c}`)),d=e.querySelector("#btnNext"),f=e.querySelector("#btnPrev"),s=c=>{o.forEach((b,v)=>{b&&(b.style.display=v===c-1?"block":"none")}),m.forEach((b,v)=>{if(!b)return;const S=v===c-1;b.style.opacity=S?"1":"0.4";const q=b.querySelector("span");q&&(q.style.background=S?"#0f172a":"#94a3b8")})},u=()=>{const c=e.querySelector("#empTenantSelect")?.value,b=e.querySelector("#empCode")?.value?.trim(),v=e.querySelector("#empName")?.value?.trim(),S=e.querySelector("#empEmail")?.value?.trim(),q=e.querySelector("#empPass")?.value,l=[];if(c||l.push("\u6240\u5C5E\u4F1A\u793E"),b||l.push("\u793E\u54E1\u756A\u53F7"),v||l.push("\u6C0F\u540D"),S||l.push("\u30E1\u30FC\u30EB"),q||l.push("\u30D1\u30B9\u30EF\u30FC\u30C9"),l.length>0){const h=e.querySelector("#empStepMsg");h?(h.textContent=`${l.join("\u3001")} \u306F\u5FC5\u9808\u3067\u3059\u3002`,h.style.display="block"):alert(`${l.join("\u3001")} \u306F\u5FC5\u9808\u3067\u3059\u3002`);return}const n=e.querySelector("#empStepMsg");n&&(n.style.display="none"),s(2)},k=()=>s(1),$=()=>s(3),g=()=>s(4);if(e.querySelector("#btnNext2")&&e.querySelector("#btnNext2").addEventListener("click",$),e.querySelector("#btnPrev3")&&e.querySelector("#btnPrev3").addEventListener("click",u),e.querySelector("#btnNext3")&&e.querySelector("#btnNext3").addEventListener("click",g),e.querySelector("#btnPrev4")&&e.querySelector("#btnPrev4").addEventListener("click",$),d&&d.addEventListener("click",u),f&&f.addEventListener("click",k),e.addEventListener("submit",async c=>{c.preventDefault();const b=e.querySelector("#empCreateMsg"),v=e.querySelector('button[type="submit"]'),S={employeeCode:document.querySelector("#empCode").value.trim(),username:document.querySelector("#empName").value.trim(),email:document.querySelector("#empEmail").value.trim(),password:document.querySelector("#empPass").value,role:document.querySelector("#empRole").value,branchId:document.querySelector("#empBranch").value?parseInt(document.querySelector("#empBranch").value,10):null,departmentId:document.querySelector("#empDept").value?parseInt(document.querySelector("#empDept").value,10):null,level:(document.querySelector("#empLevel").value||"").trim()||null,managerId:document.querySelector("#empManager").value?parseInt(document.querySelector("#empManager").value,10):null,employmentType:document.querySelector("#empType").value,hireDate:document.querySelector("#empJoinDate").value.trim()||null,probationDate:document.querySelector("#empProbDate").value.trim()||null,officialDate:document.querySelector("#empOfficialDate").value.trim()||null,contractEnd:document.querySelector("#empContractEnd").value.trim()||null,baseSalary:(document.querySelector("#empBaseSalary").value||"").trim()||null,birthDate:document.querySelector("#empBirth").value.trim()||null,gender:document.querySelector("#empGender").value||null,phone:(document.querySelector("#empPhone").value||"").trim()||null,address:(document.querySelector("#empAddr").value||"").trim()||null,employmentStatus:document.querySelector("#empStatus").value,avatarUrl:(document.querySelector("#empAvatarUrl").value||"").trim()||null};if(!S.username||!S.email||!S.password){b&&(b.style.display="block",b.style.color="#f87171",b.textContent="\u6C0F\u540D\u30FB\u30E1\u30FC\u30EB\u30FB\u30D1\u30B9\u30EF\u30FC\u30C9\u306F\u5FC5\u9808\u3067\u3059\u3002");return}if(b&&(b.style.display="none"),!window.confirm("\u4F5C\u6210\u3057\u307E\u3059\u304B\uFF1F"))return;const l=document.querySelector("#empTenantSelect")?.value||"",n=l?{headers:{"X-Tenant-Id":l}}:void 0;v&&(v.disabled=!0,v.innerHTML='\u4F5C\u6210\u4E2D...');try{const h=await rt(S,n);try{if(h&&h.id){const r=l?{headers:{"X-Tenant-Id":l}}:{},p=(document.querySelector("#empShiftAssign")?.value||"").trim(),y=(document.querySelector("#empShiftStart")?.value||"").trim(),x=(document.querySelector("#empShiftEnd")?.value||"").trim();p&&y&&await T("/api/attendance/shifts/assign",{...r,method:"POST",body:JSON.stringify({userId:h.id,shiftId:p,startDate:y,endDate:x||null})}).catch(()=>{});const M=(document.querySelector("#empWdStart")?.value||"").trim(),L=(document.querySelector("#empWdEnd")?.value||"").trim(),D=(document.querySelector("#empWdCompany")?.value||"").trim(),H=(document.querySelector("#empWdAddr")?.value||"").trim(),O=(document.querySelector("#empWdWork")?.value||"").trim(),_=(document.querySelector("#empWdRole")?.value||"").trim(),J=(document.querySelector("#empWdResp")?.value||"").trim();if(D||H||O||_||J){const he=M||S.hireDate||y||"";he&&await T("/api/attendance/work-details",{...r,method:"POST",body:JSON.stringify({userId:h.id,startDate:he,endDate:L||null,companyName:D,workPlaceAddress:H,workContent:O,roleTitle:_,responsibilityLevel:J})}).catch(()=>{})}}}catch{}try{const r=document.querySelector("#empAvatarFile");if(r&&r.files&&r.files.length&&h&&h.id){const p=new FormData;Array.from(r.files).forEach(y=>p.append("files",y)),await T(`${ae}/employees/${encodeURIComponent(String(h.id))}/photos`,{method:"POST",body:p})}}catch{}v&&(v.style.background="transparent",v.style.borderColor="transparent",v.style.color="#10b981",v.innerHTML='<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg> <span>\u4F5C\u6210\u6210\u529F</span>');try{sessionStorage.setItem("navSpinner","1")}catch{}try{sessionStorage.setItem("empFlashMessage",S.username?`${S.username}さんを作成しました`:"社員を作成しました"),h&&h.id&&sessionStorage.setItem("empFlashUserId",String(h.id))}catch{}setTimeout(()=>{window.location.href="/admin/employees#list"},1e3);return}catch(h){const r=String(h&&h.message?h.message:""),p=r.toLowerCase();if(b)if(b.style.display="block",b.style.color="#f87171",r.includes("\u793E\u54E1\u756A\u53F7")||p.includes("uniq_employee_code")||p.includes("duplicate entry")){b.textContent="\u793E\u54E1\u756A\u53F7\u304C\u65E2\u306B\u5B58\u5728\u3057\u307E\u3059\u3002\u5225\u306E\u756A\u53F7\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002";try{const y=document.querySelector("#empCode");y&&y.focus&&y.focus()}catch{}}else if(r.includes("Email")||p.includes("email")){b.textContent=r;try{const y=document.querySelector("#empEmail");y&&y.focus&&y.focus()}catch{}}else b.textContent="\u4F5C\u6210\u5931\u6557: "+(r||"error")}finally{v&&(v.disabled=!1,v.innerHTML='\u793E\u54E1\u3092\u4F5C\u6210')}}),F!==Q)return;A.appendChild(e),ie();return}const w=document.createElement("div");w.style.margin=C==="delete"?"0 0 8px":"4px 0 12px",w.className=C==="delete"?"emp-filters emp-del-wrap":"emp-filters filter-bar";let oe=null;if(C==="delete"?w.innerHTML=`
      <table class="excel-table emp-del-filter" style="margin:0 0 10px; width:720px; min-width:680px;">
        <thead>
          <tr>
            <th colspan="2">
              <div class="del-head"><div class="form-title">\u3010\u793E\u54E1\u524A\u9664\u3011</div></div>
            </th>
          </tr>
          <tr>
            <th colspan="2">
              <div class="del-tabs">
                <button type="button" id="tabSearch" class="tab active">\u793E\u54E1\u691C\u7D22</button>
                <button type="button" id="tabShowAll" class="tab">\u5168\u54E1\u8868\u793A</button>
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="width:120px;">\u793E\u54E1\u756A\u53F7</td>
            <td><input id="empSearchCode" placeholder="EMP\u756A\u53F7/\u30B3\u30FC\u30C9"></td>
          </tr>
          <tr>
            <td style="width:120px;">\u540D\u524D</td>
            <td><input id="empSearchName" placeholder="\u540D\u524D"></td>
          </tr>
          <tr>
            <td></td>
            <td class="actions"><button type="button" id="btnEmpSearch" class="btn btn-search">\u691C\u7D22</button></td>
          </tr>
        </tbody>
      </table>
      <div id="empListBox" style="display:none"></div>
    `:w.innerHTML=`
      <div class="fi">
        <div class="fi-label">\u793E\u54E1\u756A\u53F7</div>
        <input id="empSearchCode" class="fi-code" placeholder="EMP\u756A\u53F7/\u30B3\u30FC\u30C9">
      </div>
      <div class="fi">
        <div class="fi-label">\u30AD\u30FC\u30EF\u30FC\u30C9</div>
        <input id="empSearchKeyword" class="fi-name" placeholder="\u6C0F\u540D\u30FB\u30E1\u30FC\u30EB">
      </div>
      <div class="fi">
        <div class="fi-label">\u652F\u5E97</div>
        <select id="empFilterBranch" class="fi-select"><option value="">\u5168\u652F\u5E97</option>${Y.map(e=>`<option value="${e.id}">${e.name}</option>`).join("")}</select>
      </div>
      <div class="fi fi-action">
        <button type="button" id="btnEmpSearch" class="btn">\u691C\u7D22</button>
      </div>
    `,A.appendChild(w),C==="delete")try{let e=document.querySelector("#empDelFilterStyle");e||(e=document.createElement("style"),e.id="empDelFilterStyle",e.textContent=`
          html.emp-delete-mode, body.emp-delete-mode { height: 100%; overflow: hidden; }
          .admin.emp-delete-mode .content { height: 100vh; overflow: hidden; box-sizing: border-box; }
          .admin.emp-delete-mode #adminContent { height: calc(100vh - var(--topbar-height) - 24px); overflow: hidden; }
          .emp-del-wrap { display: flex; flex-direction: column; max-width: 1300px; width: 100%; margin: 0 auto; padding: 8px 12px; height: 100%; box-sizing: border-box; }
          .del-head { display: inline-flex; margin-bottom: 0; }
          .del-tabs { display: inline-flex; gap: 8px; margin-bottom: 0; }
          .del-tabs .tab { height: 28px; padding: 0 10px; border-radius: 8px; border: 1px solid #d0d8e4; background: #f3f6fb; color: #1f3b63; }
          .del-tabs .tab.active { background: #2b6cb0; color: #fff; border-color: #1e4e8c; }
          .emp-del-filter { table-layout: fixed; border-collapse: separate; border-spacing: 0; background: #fff; border: 1px solid #e5eaf0; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 2px rgba(16,24,40,.06); }
          .emp-del-filter thead th { background: #eaf2ff; color:#0d2c5b; font-weight:600; border-bottom:1px solid #e1e8f5; }
          .emp-del-filter tbody tr { height: 42px; }
          .emp-del-filter tbody tr td:first-child { width: 140px; white-space: nowrap; color: #0d2c5b; background:#f8fbff; border-right:1px solid #e3edf8; }
          .emp-del-filter tbody tr td:not(.actions) > * { width: 100%; }
          .emp-del-filter tbody td { padding: 10px 12px; vertical-align: middle; border-top: 1px solid #eef2f7; }
          .emp-del-filter input,
          .emp-del-filter select { height: 36px; border-radius: 0; background: #fcfdff; border: 1.5px solid #bcd0e6; padding: 6px 12px; box-sizing: border-box; display: block; }
          .emp-del-filter input::placeholder { color: #94a3b8; }
          .emp-del-filter input:focus,
          .emp-del-filter select:focus { border-color: #2b67b3; box-shadow: 0 0 0 3px rgba(43,103,179,.12); outline: none; }
          .emp-del-filter td.actions { text-align: center; }
          .emp-del-filter .date-range { display: flex; align-items: center; gap: 6px; }
          .emp-del-filter .date-range input { flex: 1 1 0; display: inline-block; min-width: 160px; }
          .emp-del-filter .date-range .tilde { width: 12px; text-align: center; color: #64748b; }
          .emp-del-filter .btn-search { height: 36px; border-radius: 0; padding: 0 16px; background: #2b6cb0; border: 1px solid #1e4e8c; color: #fff; transition: background-color .15s ease, border-color .15s ease; }
          .emp-del-filter .btn-search:hover { background: #255ea7; border-color: #1e4e8c; }
          .emp-del-filter .btn-search:active { background: #1f4e8a; border-color: #163b6e; }
          #empListBox { display:block; width:100%; margin-top:0; overflow: auto; flex: 1 1 auto; min-height: 0; }
          .emp-del-list thead { position: sticky; top: 0; z-index: 199; }
          .emp-del-list thead th { position: sticky; top: 0; z-index: 200; }
          .emp-del-toolbar { display: flex; justify-content: flex-end; margin: 8px 0 0; position: static; top: auto; z-index: auto; background: transparent; }
          .emp-bulk-disable { height: 36px; border-radius: 10px; padding: 0 16px; background: linear-gradient(180deg, #2b6cb0 0%, #255ea7 100%); border: 1px solid #1e4e8c; color: #fff; font-weight: 600; letter-spacing: .03em; box-shadow: 0 1px 2px rgba(16,24,40,.06); transition: background-color .15s ease, border-color .15s ease, transform .02s ease; }
          .emp-bulk-disable:hover { background: linear-gradient(180deg, #336fb3 0%, #2b62a9 100%); border-color: #1e4e8c; }
          .emp-bulk-disable:active { transform: translateY(1px); }
          .emp-bulk-disable:focus { outline: 3px solid rgba(43,103,179,.20); outline-offset: 2px; }
        `,document.head.appendChild(e))}catch{}const a={showAll:!1,searchVisible:!1,code:"",q:"",branch:"",dept:"",employmentType:"",status:"",sortKey:"id",sortDir:"asc",page:1,pageSize:10};let ve=null;try{a.showAll=(E.get("showAll")||"")==="1"||(E.get("showAll")||"").toLowerCase()==="true",a.searchVisible=(E.get("search")||"")==="1"||(E.get("search")||"").toLowerCase()==="true",a.code=(E.get("code")||"").trim().toLowerCase(),a.q=(E.get("q")||"").trim().toLowerCase(),a.branch=(E.get("branch")||"").trim(),a.dept=(E.get("dept")||"").trim(),a.employmentType=(E.get("employmentType")||E.get("type")||"").trim().toLowerCase(),a.status=(E.get("status")||"").trim().toLowerCase(),a.sortKey=E.get("sortKey")||a.sortKey,a.sortDir=E.get("sortDir")||a.sortDir,a.page=parseInt(E.get("page")||String(a.page),10)||a.page}catch{}const X=e=>{try{const t=new URLSearchParams;a.code&&t.set("code",a.code),C==="delete"&&a.showAll&&t.set("showAll","1"),C==="delete"&&a.searchVisible&&t.set("search","1"),a.q&&t.set("q",a.q),a.dept&&t.set("dept",a.dept),a.employmentType&&t.set("employmentType",a.employmentType),a.status&&t.set("status",a.status),a.sortKey&&a.sortKey!=="id"&&t.set("sortKey",a.sortKey),a.sortDir&&a.sortDir!=="asc"&&t.set("sortDir",a.sortDir),a.page&&a.page>1&&t.set("page",String(a.page));const i=t.toString();history.replaceState(null,"",`/admin/employees${i?"?"+i:""}${e||""}`)}catch{}},U=document.createElement("div");U.id="empSearchHint",U.style.display="none",U.style.color="#b00020",U.style.fontWeight="700",U.style.marginTop="6px",U.textContent="\u691C\u7D22\u6761\u4EF6\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044";try{const e=w.querySelector("table"),t=w.querySelector(".fi-action");e&&C==="delete"?e.after(U):t?t.after(U):w.appendChild(U)}catch{}const B=document.createElement("table");B.id="list",B.className="excel-table"+(C==="delete"?" emp-del-list":""),B.style.tableLayout="auto",B.style.width="100%",B.style.minWidth="100%",B.innerHTML=`
    <thead>
      <tr>
        ${C==="delete"?'<th class="sel-col" style="min-width:40px;">\u9078\u629E</th>':""}
        <th data-sort="id" style="min-width:90px;">\u793E\u54E1\u756A\u53F7</th>
        <th data-sort="username" style="min-width:80px;">\u6C0F\u540D</th>
        <th data-sort="email" style="min-width:180px;">\u30E1\u30FC\u30EB</th>
        <th data-sort="branch" style="min-width:80px;">\u652F\u5E97</th>
        <th data-sort="department" style="min-width:80px;">\u90E8\u7F72</th>
        <th data-sort="role" style="min-width:80px;">\u5F79\u5272</th>
        <th data-sort="employment_type" style="min-width:100px;">\u96C7\u7528\u5F62\u614B</th>
        <th data-sort="employment_status" style="min-width:60px;">\u72B6\u614B</th>
        <th data-sort="hire_date" style="min-width:90px;">\u5165\u793E\u65E5</th>
        <th data-sort="created_at" style="min-width:90px;">\u4F5C\u6210\u65E5</th>
      </tr>
    </thead>
  `;const ee=document.createElement("tbody");B.appendChild(ee);const z=document.createElement("div");z.className="emp-list-scroll-wrap",z.appendChild(B);const xe=()=>{try{return window.matchMedia?window.matchMedia("(max-width: 576px)").matches:!1}catch{return!1}};let Se=null;const se=()=>{try{const e=()=>{try{z.classList.remove("has-freeze-overlay")}catch{}try{const k=z.querySelector(".emp-freeze-overlay");k&&k.remove()}catch{}};try{z.classList.remove("use-pin-overlay");const k=z.querySelector(".emp-pin-panel");k&&k.remove()}catch{}e();const t=!!(window.matchMedia&&window.matchMedia("(max-width: 768px)").matches),i=xe();if(!(C!=="delete"&&t&&!i))return;const m=B.querySelector("thead tr");if(!m)return;const d=Array.from(m.children);if(d.length<2)return;const f=Math.max(72,Math.ceil(d[0].getBoundingClientRect().width||0)),s=Math.max(88,Math.ceil(d[1].getBoundingClientRect().width||0));z.style.setProperty("--pin-col-1",`${f}px`),z.style.setProperty("--pin-col-2",`${s}px`);const u=(k,$)=>{k&&(k.style.width=`${$}px`,k.style.minWidth=`${$}px`,k.style.maxWidth=`${$}px`)};u(d[0],f),u(d[1],s),Array.from(ee.querySelectorAll("tr")).forEach(k=>{const $=k.children;u($[0],f),u($[1],s)})}catch{}};if(!z.dataset.pinBound){z.dataset.pinBound="1";try{window.addEventListener("resize",()=>{try{se()}catch{}})}catch{}try{window.addEventListener("orientationchange",()=>{try{se()}catch{}})}catch{}}const N=document.createElement("div");if(N.style.margin="8px 0",N.style.display="flex",N.style.alignItems="center",N.style.justifyContent="space-between",N.innerHTML=`
    <div class="pager-left">
      <button type="button" id="empPrev">\u524D\u3078</button>
      <span id="empPageInfo" style="margin:0 8px;"></span>
      <button type="button" id="empNext">\u6B21\u3078</button>
    </div>
    <div class="pager-right">
      <label for="empPageSize">\u8868\u793A\u4EF6\u6570:</label>
      <select id="empPageSize">
        <option value="10">10</option>
        <option value="25">25</option>
        <option value="50">50</option>
        <option value="100">100</option>
      </select>
    </div>
  `,C==="delete"){const e=document.createElement("div");e.className="emp-del-toolbar",e.innerHTML='<div class="pager-right" id="empBulkBox"><button type="button" id="empBulkDisable" class="emp-bulk-disable" aria-label="\u9078\u629E\u3092\u7121\u52B9\u5316">\u9078\u629E\u3092\u7121\u52B9\u5316</button></div>',e.style.display="";const t=w.querySelector("#empListBox");t?(t.appendChild(z),t.appendChild(N),w.appendChild(e)):(w.appendChild(z),w.appendChild(N),w.appendChild(e))}else A.appendChild(z),A.appendChild(N);const R=document.createElement("div");R.id="empNoResultCenter",R.style.display="none",R.style.minHeight="52vh",R.style.alignItems="center",R.style.justifyContent="center",R.style.textAlign="center",R.style.fontWeight="800",R.style.fontSize="20px",R.style.color="#0b2c66",R.textContent="\u8A72\u5F53\u30C7\u30FC\u30BF\u304C\u3042\u308A\u307E\u305B\u3093",A.appendChild(R);const Xe=()=>{try{w.style.setProperty("display","none","important")}catch{}},Ne=()=>{try{w.style.removeProperty("display")}catch{}},me=e=>"EMP"+String(e).padStart(3,"0"),de=e=>{const t=le.find(i=>String(i.id)===String(e));return t?t.name:""},we=e=>{const t=String(e||"").toLowerCase();return t==="inactive"?"\u7121\u52B9":t==="retired"?"\u9000\u8077":"\u5728\u8077"},Qe=e=>{const t=String(e||"").toLowerCase();return`<span class="status-pill ${t==="inactive"?"inactive":t==="retired"?"retired":"active"}">${we(t)}</span>`},Be=e=>{const t=String(e||"").toLowerCase();return t==="admin"?"\u7BA1\u7406\u8005":t==="manager"?"\u30DE\u30CD\u30FC\u30B8\u30E3\u30FC":t==="employee"?"\u5F93\u696D\u54E1":e||""},He=e=>{const t=String(e||"").toLowerCase();return t==="full_time"?"\u6B63\u793E\u54E1":t==="part_time"?"\u30D1\u30FC\u30C8\u30FB\u30A2\u30EB\u30D0\u30A4\u30C8":t==="contract"?"\u5951\u7D04\u793E\u54E1":e||""},Ze=e=>{const t=String(e||"").toLowerCase();return`<span class="role-pill ${t==="admin"?"admin":t==="manager"?"manager":"employee"}">${Be(t)}</span>`},je=e=>{const t=String(e||"").toLowerCase();return`<span class="type-pill ${t==="full_time"?"full":t==="part_time"?"part":t==="contract"?"contract":"other"}">${He(t)}</span>`},ke=e=>{if(e==null)return"";const t=String(e).trim();return t&&t!=="-"?t:""},ue=e=>{const t=ke(e);return t||'<span class="unreg" title="\u672A\u767B\u9332">\u2014</span>'},fe=e=>String(e).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;"),$e=e=>{if(!e||String(e)==="-"||String(e)==="0000-00-00")return'<span class="unreg" title="\u672A\u767B\u9332">\u2014</span>';const t=String(e),i=t.match(/^(\d{4})-(\d{2})-(\d{2})/);if(i)return`${i[1]}/${i[2]}/${i[3]}`;try{const o=new Date(t);if(!isNaN(o.getTime()))return`${o.getFullYear()}/${String(o.getMonth()+1).padStart(2,"0")}/${String(o.getDate()).padStart(2,"0")}`}catch{}return t},ye=e=>String(e||"").trim().replace(/\s+/g," ").toLowerCase(),Ue=()=>{const e=[];return a.code&&e.push(`\u793E\u54E1\u756A\u53F7:${a.code}`),a.q&&e.push(`KW:${a.q}`),a.dept&&e.push(`\u90E8\u7F72:${de(a.dept)||a.dept}`),a.employmentType&&e.push(`\u96C7\u7528\u5F62\u614B:${He(a.employmentType)||a.employmentType}`),a.status&&e.push(`\u72B6\u614B:${we(a.status)||a.status}`),e.join(" / ")},qe=()=>{let e=I.slice();a.branch&&(e=e.filter(o=>String(o.branch_id||"")===String(a.branch))),a.dept&&(e=e.filter(o=>String(o.departmentId||"")===String(a.dept))),a.employmentType&&(e=e.filter(o=>String(o.employment_type||"").toLowerCase()===a.employmentType)),a.status&&(e=e.filter(o=>String(o.employment_status||"").toLowerCase()===a.status)),a.code&&(e=e.filter(o=>{const m=ye(o.employee_code),d=ye("emp"+String(o.id).padStart(3,"0"));return m===a.code||d===a.code})),a.q&&(e=e.filter(o=>{const m=ye(o.username),d=ye(o.email);return m.includes(a.q)||d.includes(a.q)}));const t=a.sortKey,i=a.sortDir==="asc"?1:-1;return e.sort((o,m)=>{if(t!=="employment_status"){const st=u=>{const x=String(u&&u.employment_status||"").toLowerCase();return x==="inactive"?1:x==="retired"?2:0},sr=st(o)-st(m);if(sr)return sr}const d=u=>String(u&&(u.employee_code||me(u.id))||"").toUpperCase();if(t==="hire_date"){const u=String(o&&o.hire_date||""),k=String(m&&m.hire_date||"");if(u!==k)return u?k?u.localeCompare(k)*i:-1:1;const $=d(o).localeCompare(d(m));return $!==0?$:Number(o?.id||0)-Number(m?.id||0)}const f=t==="department"?de(o.departmentId):t==="id"?d(o):o[t]||"",s=t==="department"?de(m.departmentId):t==="id"?d(m):m[t]||"";return String(f).localeCompare(String(s))*i}),e},K=()=>{const e=qe(),t=e.length,i=!!(a.code||a.q||a.dept||a.employmentType||a.status);Ve(a.q||a.code);const o=(a.page-1)*a.pageSize,m=e.slice(o,o+a.pageSize),d=xe();if(Se=d,ee.innerHTML="",!t){if(i){const c=Ue()?`\u300C${Ue()}\u300D\u306F\u898B\u3064\u304B\u308A\u307E\u305B\u3093`:"\u8A72\u5F53\u30C7\u30FC\u30BF\u304C\u3042\u308A\u307E\u305B\u3093";R.textContent=c;try{R.style.display="flex"}catch{}Xe();try{oe&&(oe.style.display="none")}catch{}}else{try{R.style.display="none"}catch{}Ne();try{oe&&(oe.style.display="")}catch{}}be();try{B.style.display="none"}catch{}try{z.style.display="none"}catch{}try{N.style.display="none"}catch{}const g=A.querySelector("#empPageInfo");g&&(g.textContent="");return}try{R.style.display="none"}catch{}Ne();try{oe&&(oe.style.display="")}catch{}be();try{B.style.display=""}catch{}try{z.style.display=""}catch{}try{N.style.display=""}catch{}for(const g of m){const c=document.createElement("tr"),b=String(g.employment_status||"").toLowerCase();c.className=`emp-row ${b||"active"}`,C!=="delete"&&(c.classList.add("emp-row-clickable"),c.dataset.detailId=String(g.id));const v=ke(g.email),S=ke(de(g.departmentId));d&&C!=="delete"?(c.classList.add("mobile-flat"),c.innerHTML=`
          <td class="m-code-cell">
            <div class="m-code-label">\u793E\u54E1\u756A\u53F7</div>
            <div class="m-code-value">${g.employee_code||me(g.id)}</div>
          </td>
          <td class="m-main-cell" colspan="8">
            <div class="m-line"><span class="m-k">\u6C0F\u540D:</span> <span class="m-v"><a class="emp-name-link" href="/admin/employees?detail=${g.id}">${g.username||""}</a>${""}</span></div>
            <div class="m-line"${v?` title="${fe(v)}"`:""}><span class="m-k">\u30E1\u30FC\u30EB:</span> <span class="m-v">${ue(v)}</span></div>
            <div class="m-line"${S?` title="${fe(S)}"`:""}><span class="m-k">\u90E8\u7F72:</span> <span class="m-v">${ue(S)}</span></div>
            <div class="m-line"><span class="m-k">\u5F79\u5272:</span> <span class="m-v">${Be(g.role)}</span></div>
            <div class="m-line"><span class="m-k">\u96C7\u7528\u5F62\u614B:</span> <span class="m-v">${je(g.employment_type)}</span></div>
            <div class="m-line"><span class="m-k">\u72B6\u614B:</span> <span class="m-v">${we(g.employment_status)}</span></div>
            <div class="m-line"><span class="m-k">\u5165\u793E\u65E5:</span> <span class="m-v">${$e(g.hire_date)}</span></div>
          </td>
        `):c.innerHTML=`
        ${C==="delete"?`<td class="sel-col" data-label="\u9078\u629E"><input type="checkbox" class="empSel" value="${g.id}"></td>`:""}
        <td class="col-code" data-label="\u793E\u54E1\u756A\u53F7" style="font-weight:600;">${g.employee_code||me(g.id)}</td>
        <td class="col-name" data-label="\u6C0F\u540D"><a class="emp-name-link" href="/admin/employees?detail=${g.id}">${g.username||""}</a>${""}</td>
        <td class="col-email" data-label="\u30E1\u30FC\u30EB"${v?` title="${fe(v)}"`:""}>${ue(v)}</td>
        <td class="col-branch" data-label="\u652F\u5E97">${(Y.find(q=>String(q.id)===String(g.branch_id))||{}).name||"\u2014"}</td>
        <td class="col-dept" data-label="\u90E8\u7F72"${S?` title="${fe(S)}"`:""}>${ue(S)}</td>
        <td data-label="\u5F79\u5272">${Ze(g.role)}</td>
        <td data-label="\u96C7\u7528\u5F62\u614B">${je(g.employment_type)}</td>
        <td data-label="\u72B6\u614B">${Qe(g.employment_status)}</td>
        <td data-label="\u5165\u793E\u65E5">${$e(g.hire_date)}</td>
        <td data-label="\u4F5C\u6210\u65E5">${$e(g.created_at)}</td>
      `,ee.appendChild(c)}ee.dataset.rowClickWired||(ee.dataset.rowClickWired="1",ee.addEventListener("click",g=>{const c=g.target;if(c.closest("a, button, input, select, label"))return;const b=c.closest("tr.emp-row-clickable");!b||!b.dataset.detailId||(window.location.href=`/admin/employees?detail=${encodeURIComponent(b.dataset.detailId)}`)}));const f=t?Math.min(t,o+1):0,s=Math.min(t,o+m.length),u=A.querySelector("#empPageInfo"),k=A.querySelector("#empPrev"),$=A.querySelector("#empNext");if(u){const g=Math.max(1,Math.ceil(t/a.pageSize));u.textContent=`${f}-${s} / ${t} (${g}\u30DA\u30FC\u30B8)`,k&&(k.disabled=a.page<=1,k.style.display=""),$&&($.disabled=a.page>=g,$.style.display=""),t===0?u.style.display="none":u.style.display=""}if(d)try{z.style.removeProperty("--pin-col-1"),z.style.removeProperty("--pin-col-2")}catch{}else{se();try{setTimeout(()=>se(),80)}catch{}try{setTimeout(()=>se(),220)}catch{}}},Re=()=>{try{const e=xe();if(Se===null||e===Se)return;K()}catch{}};if(!z.dataset.layoutBound){z.dataset.layoutBound="1";try{window.addEventListener("resize",Re,{passive:!0})}catch{}try{window.addEventListener("orientationchange",Re)}catch{}}if(K(),_flashRow(),C==="delete")try{const e=w.querySelector("#empListBox"),t=w.querySelector(".emp-del-filter tbody"),i=w.querySelector(".emp-del-toolbar"),o=a.showAll||a.searchVisible;e&&(e.style.display=o?"":"none"),B.style.display=o?"":"none",N.style.display=o?"":"none",i&&(i.style.display=o?"":"none"),t&&(t.style.display="");const m=w.querySelector("#tabSearch"),d=w.querySelector("#tabShowAll"),f=()=>{const s=a.showAll||a.searchVisible;a.showAll?(m&&m.classList.remove("active"),d&&d.classList.add("active")):(m&&m.classList.add("active"),d&&d.classList.remove("active")),e&&(e.style.display=s?"":"none"),B.style.display=s?"":"none",N.style.display=s?"":"none",i&&(i.style.display=s?"":"none"),t&&(t.style.display="")};f(),m&&m.addEventListener("click",()=>{a.showAll=!1,a.searchVisible=!1;try{U.style.display="none"}catch{}f(),X("#delete")}),d&&d.addEventListener("click",()=>{a.showAll=!0,a.searchVisible=!1,a.page=1;try{U.style.display="none"}catch{}f(),K(),X("#delete")})}catch{}try{const e=w.querySelector("#empSearchCode");e&&(e.value=E.get("code")||"");const t=w.querySelector("#empSearchKeyword")||w.querySelector("#empSearchName");t&&(t.value=E.get("q")||"");const i=w.querySelector("#empFilterDept");i&&(i.value=a.dept);const o=w.querySelector("#empFilterType");o&&(o.value=a.employmentType);const m=w.querySelector("#empFilterStatus");if(m&&(m.value=a.status),U){const d=!!((E.get("code")||"").trim()||(E.get("q")||"").trim()||a.dept||a.employmentType||a.status);U.style.display="none"}}catch{}C!=="delete"&&["#empSearchCode","#empSearchKeyword","#empSearchName"].forEach(sel=>{const el=w.querySelector(sel);el&&el.addEventListener("input",()=>{if(String(el.value||"").trim())return;const fv=x=>{const n=w.querySelector(x);return String(n&&n.value!=null?n.value:"").trim()};try{ve&&clearTimeout(ve)}catch{}a.code=fv("#empSearchCode").toLowerCase(),a.q=(fv("#empSearchKeyword")||fv("#empSearchName")).toLowerCase(),a.branch=fv("#empFilterBranch"),a.dept=fv("#empFilterDept"),a.employmentType=fv("#empFilterType").toLowerCase(),a.status=fv("#empFilterStatus").toLowerCase(),a.page=1;try{U.style.display="none"}catch{}K(),X("#list")})}),w.querySelector("#btnEmpSearch").addEventListener("click",()=>{const e=w.querySelector("#empSearchCode"),t=w.querySelector("#empSearchKeyword")||w.querySelector("#empSearchName"),i=w.querySelector("#empFilterBranch"),o=w.querySelector("#empFilterDept"),m=w.querySelector("#empFilterType"),d=w.querySelector("#empFilterStatus");a.code=String(e&&e.value!=null?e.value:"").trim().toLowerCase(),a.q=String(t&&t.value!=null?t.value:"").trim().toLowerCase(),a.branch=String(i&&i.value!=null?i.value:"").trim(),a.dept=String(o&&o.value!=null?o.value:"").trim(),a.employmentType=String(m&&m.value!=null?m.value:"").trim().toLowerCase(),a.status=String(d&&d.value!=null?d.value:"").trim().toLowerCase(),a.page=1;const f=!!(a.code||a.q||a.branch||a.dept||a.employmentType||a.status);if(!f&&!(C==="delete"&&a.showAll)){Ve(""),be();try{U.style.display="block"}catch{}try{const s=w.querySelector("#empSearchCode");s&&s.focus&&s.focus()}catch{}if(C==="delete")try{const s=w.querySelector("#empListBox");s&&(s.style.display="none"),B.style.display="none",N.style.display="none";const u=w.querySelector(".emp-del-toolbar");u&&(u.style.display="none")}catch{}return}try{U.style.display="none"}catch{}if(C==="delete"){if(a.searchVisible=f,!f&&!a.showAll){try{const s=w.querySelector("#empListBox");s&&(s.style.display="none"),B.style.display="none",N.style.display="none";const u=w.querySelector(".emp-del-toolbar");u&&(u.style.display="none")}catch{}return}try{const s=w.querySelector("#empListBox");s&&(s.style.display=""),B.style.display="",N.style.display="";const u=w.querySelector(".emp-del-toolbar");u&&(u.style.display="")}catch{}}if(C!=="delete"&&f&&!qe().length){K(),X("#list");try{ve&&clearTimeout(ve)}catch{}ve=setTimeout(()=>{a.code="",a.q="",a.dept="",a.employmentType="",a.status="",a.page=1;try{e&&(e.value="")}catch{}try{t&&(t.value="")}catch{}try{o&&(o.value="")}catch{}try{m&&(m.value="")}catch{}try{d&&(d.value="")}catch{}K(),X("#list")},1500);return}K(),X(C==="delete"?"#delete":"#list")});const et=N.querySelector("#empPrev"),tt=N.querySelector("#empNext"),Ee=N.querySelector("#empPageSize");if(Ee&&(Ee.value=a.pageSize,Ee.addEventListener("change",e=>{a.pageSize=parseInt(e.target.value,10),a.page=1,K(),X(C==="delete"?"#delete":"#list")})),et.addEventListener("click",()=>{a.page>1&&(a.page-=1,K(),X(C==="delete"?"#delete":"#list"))}),tt.addEventListener("click",()=>{const e=qe().length,t=Math.max(1,Math.ceil(e/a.pageSize));a.page<t&&(a.page+=1,K(),X(C==="delete"?"#delete":"#list"))}),C==="delete"){B.addEventListener("click",t=>{const i=t&&t.target,o=i&&i.closest?i.closest("td"):null;if(!o||i&&i.closest&&i.closest(".emp-ops-wrap")||i&&i.closest&&i.closest("a")||i&&i.matches&&i.matches("input, button, select, label"))return;const m=o.closest("tr"),d=m?m.querySelector(".empSel"):null;d&&(d.checked=!d.checked)});const e=async t=>{if(!(t.target&&t.target.id==="empBulkDisable"))return;const i=Array.from(A.querySelectorAll(".empSel:checked")).map(s=>s.value);if(!i.length){alert("\u5BFE\u8C61\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044");return}const o=document.createElement("div");o.className="modal-overlay";const m=document.createElement("div");m.className="modal";const d=i.map(s=>{const u=I.find(c=>String(c.id)===String(s)),k=u&&u.employee_code?u.employee_code:me(s),$=u&&u.username?u.username:"",g=de(u&&u.departmentId?u.departmentId:null);return`<div class="row"><div>${k}</div><div>${$}\u3000${g}</div></div>`}).join("");m.innerHTML=`
        <div class="modal-head">\u26A0\uFE0F\u3000\u793E\u54E1\u7121\u52B9\u5316\u306E\u78BA\u8A8D</div>
        <div class="modal-body">
          <div>\u4EE5\u4E0B\u306E\u793E\u54E1\u3092\u7121\u52B9\u5316\u3057\u307E\u3059\u304B\uFF1F</div>
          <div class="modal-list">${d}</div>
          <div>\u3053\u306E\u64CD\u4F5C\u306F\u53D6\u308A\u6D88\u3059\u3053\u3068\u304C\u3067\u304D\u307E\u305B\u3093\u3002</div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn" id="modalConfirmDisable">\u7121\u52B9\u5316\u3059\u308B</button>
          <button type="button" class="btn" id="modalCancelDisable">\u30AD\u30E3\u30F3\u30BB\u30EB</button>
        </div>
      `,o.appendChild(m),document.body.appendChild(o);const f=()=>{try{document.body.removeChild(o)}catch{}};o.addEventListener("click",s=>{s.target===o&&f()}),m.querySelector("#modalCancelDisable").addEventListener("click",f),m.querySelector("#modalConfirmDisable").addEventListener("click",async()=>{const s=m.querySelector("#modalConfirmDisable");s.disabled=!0;try{for(const u of i)try{await Le(u)}catch{}for(const u of i){const k=I.find($=>String($.id)===String(u));k&&(k.employment_status="inactive")}K()}finally{f(),alert("\u7121\u52B9\u5316\u3057\u307E\u3057\u305F\uFF08\u72B6\u614B: \u7121\u52B9/\u4F11\u8077\uFF09")}})};w.addEventListener("click",e),N.addEventListener("click",e)}A.addEventListener("click",async e=>{const t=e&&e.target,i=t&&t.closest?t.closest("a"):null;if(i){const f=i.getAttribute("href")||"";if(f.startsWith("/admin/employees?detail=")||f.startsWith("/admin/employees?edit=")){e.preventDefault();const s=new URL(f,window.location.origin),u=["q","dept","employmentType","role","status","hireFrom","hireTo","sortKey","sortDir","page","code"];for(const k of u){const $=E.get(k);$&&!s.searchParams.get(k)&&s.searchParams.set(k,$)}window.location.href=s.pathname+"?"+s.searchParams.toString()+(s.hash||"");return}}const o=e&&e.target,m=o&&o.getAttribute?o.getAttribute("data-delete"):null;if(m){if(confirm("\u3053\u306E\u793E\u54E1\u3092\u7121\u52B9\u5316\u3057\u307E\u3059\u304B\uFF1F"))try{await Le(m);const f=I.find(s=>String(s.id)===String(m));f&&(f.employment_status="inactive"),alert("\u7121\u52B9\u5316\u3057\u307E\u3057\u305F\uFF08\u72B6\u614B: \u7121\u52B9/\u4F11\u8077\uFF09"),K()}catch(f){alert(String(f&&f.message?f.message:"\u7121\u52B9\u5316\u306B\u5931\u6557\u3057\u307E\u3057\u305F"))}return}const d=o&&o.getAttribute?o.getAttribute("data-hard-delete"):null;if(d&&confirm("\u3053\u306E\u793E\u54E1\u3092\u5B8C\u5168\u306B\u524A\u9664\u3057\u307E\u3059\u304B\uFF1F\u3053\u306E\u64CD\u4F5C\u306F\u53D6\u308A\u6D88\u305B\u307E\u305B\u3093\u3002"))try{await Ke(d),I=I.filter(f=>String(f.id)!==String(d)),K()}catch(f){alert(String(f&&f.message?f.message:"\u524A\u9664\u306B\u5931\u6557\u3057\u307E\u3057\u305F"))}}),ie()}let De=null;async function vt(P){const ce=P&&P.content;De||(De=await lt());const F=De;if(!F)return;try{const W=document.querySelector("#userName");W&&(W.textContent=F.username||F.email||"\u7BA1\u7406\u8005")}catch{}const A=Ae("#status");A&&(A.textContent="");const E=ce||Ae("#adminContent");E&&!ce&&(E.className="card wide"),await Z(F,E);const V=()=>{try{if(!Je(location.pathname))return;Z(F,E)}catch{}};return window.addEventListener("hashchange",V),window.addEventListener("popstate",V),()=>{try{window.removeEventListener("hashchange",V)}catch{}try{window.removeEventListener("popstate",V)}catch{}try{document.body.classList.remove("emp-delete-mode"),document.documentElement.classList.remove("emp-delete-mode")}catch{}}}export{vt as mount};
document.addEventListener("change",e=>{const t=e.target;if(!t||t.id!=="empDept"||t.dataset.orig===void 0)return;const r=document.querySelector("#empDeptDateRow"),d=document.querySelector("#empDeptDate");if(!r||!d)return;const n=new Date(Date.now()+324e5).toISOString().slice(0,10),c=!!t.value&&String(t.value)!==String(t.dataset.orig);r.style.display=c?"":"none",d.max=n,c&&!d.value&&(d.value=n)});
