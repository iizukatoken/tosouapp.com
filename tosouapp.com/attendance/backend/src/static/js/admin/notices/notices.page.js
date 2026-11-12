import{requireAdmin as K}from"../_shared/require-admin.js";import{fetchJSONAuth as $}from"../../api/http.api.js";const c=i=>String(i??"").replace(/[&<>"']/g,o=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[o]),O=i=>{if(parseInt(String(i&&i.target_user_id?i.target_user_id:0),10)||0)return"\u500B\u4EBA";const x=i&&i.target_date?String(i.target_date).slice(0,10):"",u=i&&i.target_month?String(i.target_month).slice(0,7):"";return x||u||"\u5168\u4F53"},X=i=>{const o=String(i&&i.created_at?i.created_at:"");return o.length>=16?o.slice(0,16).replace("T"," "):o||"\u2014"};async function W(){const i=await K();if(!i)return;try{const d=document.querySelector("#userName");d&&(d.textContent=i.username||i.email||"\u7BA1\u7406\u8005")}catch{}try{const d=document.querySelector("#status");d&&(d.textContent="")}catch{}const o=document.querySelector("#adminContent");if(!o)return;const x=String(i&&i.role?i.role:"").toLowerCase();let u=null;const V=async()=>{if(u)return u;const p=await $(x==="manager"?"/api/manager/users":"/api/admin/users").catch(()=>[]),m=(Array.isArray(p)?p:p&&Array.isArray(p.rows)?p.rows:[]).map(n=>({id:parseInt(String(n&&n.id?n.id:0),10)||0,username:String(n&&(n.username||n.email)?n.username||n.email:"").trim(),employeeCode:String(n&&(n.employee_code||n.employeeCode)?n.employee_code||n.employeeCode:"").trim(),role:String(n&&n.role?n.role:"").toLowerCase()})).filter(n=>n.id);return u=x==="manager"?m:m.filter(n=>n.role==="employee"),u},_=async()=>{const d="/api/notices/admin?limit=80",p="/api/notices/admin";let l=[],m="";try{const t=await $(d);l=t&&Array.isArray(t.rows)?t.rows:[]}catch(t){m=String(t&&t.message?t.message:t||""),l=[]}let n=[];try{n=await V()}catch{}const P=(()=>{try{return!!(window.matchMedia&&window.matchMedia("(max-width: 768px)").matches)}catch{return!1}})(),q="adminNotices.composer.visible",C=(()=>{try{const t=localStorage.getItem(q);if(t==="0")return!1;if(t==="1")return!0}catch{}return!0})(),N="adminNotices.table.visible",A=(()=>{try{const t=localStorage.getItem(N);if(t==="0")return!1;if(t==="1")return!0}catch{}return!0})(),G=t=>{const e=parseInt(String(t&&t.target_user_id?t.target_user_id:0),10)||0;if(!e)return"\u5168\u793E\u54E1";const a=String(t&&t.target_employee_code?t.target_employee_code:"").trim(),r=String(t&&(t.target_username||t.target_email)?t.target_username||t.target_email:"").trim();return[a,r].filter(Boolean).join(" ")||`ID:${e}`},L=t=>{const e=parseInt(String(t&&t.target_user_id?t.target_user_id:0),10)||0,a=String(t&&t.target_read_at?t.target_read_at:"").trim();if(e){if(!a)return"\u672A\u8AAD";const b=a.includes("T")?a.replace("T"," "):a;return`\u65E2\u8AAD ${b.length>=16?b.slice(11,16):b}`}const r=parseInt(String(t&&t.read_count?t.read_count:0),10)||0;return r?`\u65E2\u8AAD ${r}`:"\u672A\u8AAD"},U=P?`
            <colgroup>
              <col style="width:78px;">
              <col style="width:auto;">
              <col style="width:74px;">
            </colgroup>
        `:`
            <colgroup>
              <col style="width:120px;">
              <col style="width:auto;">
              <col style="width:180px;">
              <col style="width:120px;">
              <col style="width:150px;">
              <col style="width:90px;">
            </colgroup>
        `,F=P?`
              <tr>
                <th>\u5BFE\u8C61</th>
                <th>\u5185\u5BB9</th>
                <th>\u65E2\u8AAD</th>
              </tr>
        `:`
              <tr>
                <th>\u5BFE\u8C61</th>
                <th>\u5185\u5BB9</th>
                <th>\u5B9B\u5148</th>
                <th>\u65E2\u8AAD</th>
                <th>\u4F5C\u6210</th>
                <th style="text-align:right;">\u64CD\u4F5C</th>
              </tr>
        `,y=20;let s=1;const w=Math.max(1,Math.ceil(l.length/y)),z=()=>l.slice((s-1)*y,s*y),I=t=>t.length?t.map(e=>P?`
                    <tr>
                      <td class="notice-target">${c(O(e))}</td>
                      <td class="notice-message">${c(e&&e.message?e.message:"")}</td>
                      <td class="notice-created">${c(L(e))}</td>
                    </tr>
                  `:`
                    <tr>
                      <td class="notice-target">${c(O(e))}</td>
                      <td class="notice-message">${c(e&&e.message?e.message:"")}</td>
                      <td class="notice-created">${c(G(e))}</td>
                      <td class="notice-created">${c(L(e))}</td>
                      <td class="notice-created">${c(X(e))}</td>
                      <td class="notice-actions">
                        <button type="button" class="se-mini-btn" data-notice-del="${c(e&&e.id!=null?e.id:"")}">\u524A\u9664</button>
                      </td>
                    </tr>
                  `).join(""):`<tr><td colspan="${P?3:6}" class="notice-empty">\u307E\u3060\u304A\u77E5\u3089\u305B\u304C\u3042\u308A\u307E\u305B\u3093</td></tr>`,J=I(z());o.innerHTML=`
      <style>
        .notice-page h3 { font-weight: 900; letter-spacing: .2px; }
        .notice-card {
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          background: #fff;
          padding: 12px;
        }
        .notice-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }
        .notice-sub {
          font-size: 12px;
          font-weight: 800;
          color: #334155;
        }
        .notice-controls {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .notice-input,
        .notice-select,
        .notice-btn {
          height: 34px;
          border: 1px solid #cbd5e1;
          border-radius: 10px;
          padding: 0 10px;
          font-weight: 900;
          color: #0b2c66;
          background: #fff;
          box-sizing: border-box;
        }
        .notice-btn { cursor: pointer; }
        .notice-btn:hover { background: #f8fafc; }
        .notice-btn.primary {
          border-color: #0b2c66;
          background: #0b2c66;
          color: #fff;
          cursor: pointer;
          padding: 0 12px;
        }
        .notice-btn.primary:hover { background: #0a285c; }
        .notice-textarea {
          width: 100%;
          margin-top: 10px;
          border: 1px solid #cbd5e1;
          border-radius: 12px;
          padding: 10px 12px;
          font-weight: 700;
          font-size: 14px;
          line-height: 1.6;
          resize: none;
          min-height: 120px;
          overflow: hidden;
          box-sizing: border-box;
          display: block;
          max-width: 100%;
        }
        .notice-table-wrap {
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          background: #fff;
          overflow: auto;
          max-width: 100%;
        }
        .notice-table {
          width: 100%;
          border-collapse: collapse;
          border: 1px solid #e5e7eb;
        }
        .notice-table th {
          text-align: left;
          padding: 10px 12px;
          font-weight: 900;
          font-size: 12px;
          border: 1px solid #e5e7eb;
          background: #f8fafc;
          color: #0f172a;
          position: sticky;
          top: 0;
          z-index: 1;
        }
        .notice-table td {
          padding: 10px 12px;
          border: 1px solid #e5e7eb;
          vertical-align: top;
        }
        .notice-table tr:nth-child(even) td { background: #fbfdff; }
        .notice-table tr:hover td { background: #f1f5f9; }
        .notice-target { font-weight: 900; color: #0b2c66; white-space: nowrap; }
        .notice-message { font-weight: 700; color: #0f172a; white-space: pre-wrap; word-break: break-all; max-width: 400px; }
        .notice-created { font-weight: 700; color: #475569; white-space: nowrap; }
        .notice-actions { text-align: right; white-space: nowrap; }
        .notice-empty { padding: 12px; color: #64748b; font-weight: 800; }
        .notice-listbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-top: 8px;
          margin-bottom: 6px;
        }
        .notice-switch {
          position: relative;
          display: inline-block;
          width: 38px;
          height: 20px;
          flex: 0 0 auto;
          border-radius: 999px;
          overflow: hidden;
        }
        .notice-switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }
        .notice-switch-track {
          position: absolute;
          inset: 0;
          border-radius: 999px;
          background: #0b2c66;
          border: 1px solid #0b2c66;
          cursor: pointer;
          transition: background .15s ease, border-color .15s ease;
        }
        .notice-switch-track::before {
          content: '';
          position: absolute;
          width: 16px;
          height: 16px;
          left: 2px;
          top: 1px;
          border-radius: 50%;
          background: #fff;
          transition: transform .15s ease;
          box-shadow: 0 2px 8px rgba(2, 6, 23, .18);
        }
        .notice-switch input:not(:checked) + .notice-switch-track {
          background: #e2e8f0;
          border-color: #cbd5e1;
        }
        .notice-switch input:checked + .notice-switch-track::before {
          transform: translateX(18px);
        }
        @media (max-width: 768px) {
          .notice-page {
            margin-top: -2px;
            overflow-x: hidden;
          }
          .notice-page > div:first-child {
            gap: 8px !important;
          }
          .notice-page > div:first-child > h3 {
            font-size: 22px;
            line-height: 1.2;
          }
          .notice-page > div:first-child > div {
            font-size: 11px !important;
          }
          .notice-card {
            padding: 8px;
            border-radius: 10px;
          }
          .notice-controls {
            display: grid;
            grid-template-columns: minmax(0, 1fr) 64px 48px 78px;
            align-items: center;
            gap: 6px;
            overflow: visible;
            padding-bottom: 2px;
          }
          .notice-select,
          .notice-input,
          .notice-btn {
            height: 30px;
            border-radius: 8px;
            font-size: 11px;
            padding: 0 7px;
          }
          .notice-select#noticeRecipient {
            min-width: 0 !important;
            width: 100% !important;
            grid-column: 1 / 2;
          }
          .notice-select#noticeScope {
            min-width: 64px;
            width: 64px;
            grid-column: 2 / 3;
          }
          .notice-btn.primary {
            min-width: 44px;
            width: 44px;
            padding: 0 6px;
            grid-column: 3 / 4;
          }
          .notice-controls #btnNoticeComposerToggle {
            min-width: 72px;
            width: 72px;
            grid-column: 4 / 5;
            white-space: normal;
            min-height: 30px;
            height: auto;
            line-height: 1.15;
            padding: 3px 6px;
          }
          .notice-controls #noticeDate,
          .notice-controls #noticeMonth {
            grid-column: 1 / 3;
            width: 100%;
            min-width: 0 !important;
          }
          .notice-textarea {
            min-height: 84px;
            font-size: 12px;
            margin-top: 6px;
          }
          .notice-table-wrap {
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
          }
          .notice-table {
            min-width: 0;
            width: 100%;
            table-layout: fixed;
          }
          .notice-table th,
          .notice-table td {
            white-space: nowrap;
            word-break: normal;
            writing-mode: horizontal-tb;
            text-orientation: mixed;
            padding: 6px 7px;
            font-size: 11px;
          }
          .notice-message {
            white-space: normal;
            min-width: 0;
          }
          .notice-created {
            min-width: 0;
          }
        }
      </style>

      <div class="notice-page ui-c" data-ui="notices"><div class="ui-ph"><h2>\u304A\u77E5\u3089\u305B</h2></div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
      </div>

      <div style="margin-top:12px;display:grid;grid-template-columns:1fr;gap:10px;">
        <div class="notice-card ui-panel"><div class="ui-ptitle">\u304A\u77E5\u3089\u305B\u306E\u767B\u9332</div>
          ${m?`
            <div style="border:1px solid #fecaca;background:#fff1f2;color:#7f1d1d;border-radius:12px;padding:10px 12px;font-weight:900;margin-bottom:10px;">
              API\u30A8\u30E9\u30FC: ${c(m)}
              <div style="margin-top:6px;font-weight:800;font-size:12px;opacity:.9;">
                origin: ${c(window.location.origin)} / GET ${c(d)} / POST ${c(p)}
              </div>
            </div>
          `:""}
          <div class="notice-controls ui-filters">
            <select id="noticeRecipient" class="notice-select" style="min-width:240px;">
              <option value="">\u5168\u793E\u54E1</option>
              ${n.map(t=>`<option value="${c(t.id)}">${c([t.employeeCode,t.username].filter(Boolean).join(" "))}</option>`).join("")}
            </select>
            <select id="noticeScope" class="notice-select">
              <option value="global">\u5168\u4F53</option>
              <option value="date">\u65E5\u4ED8</option>
              <option value="month">\u6708</option>
            </select>
            <input id="noticeDate" type="date" class="notice-input" style="display:none;">
            <input id="noticeMonth" type="month" class="notice-input" style="display:none;">
            <button id="btnNoticePost" type="button" class="notice-btn primary">\u767B\u9332</button>
            <button id="btnNoticeComposerToggle" type="button" class="notice-btn">${C?"\u5165\u529B\u6B04\u3092\u96A0\u3059":"\u5165\u529B\u6B04\u3092\u8868\u793A"}</button>
          </div>
          <div id="noticeComposerBody" ${C?"":"hidden"}>
            <textarea id="noticeMessage" class="notice-textarea" placeholder="\u901A\u77E5\u5185\u5BB9\u3092\u5165\u529B"></textarea>
            <div id="noticeError" style="display:none;margin-top:8px;color:#b00020;font-weight:800;"></div>
          </div>
        </div>

        <div class="ui-panel"><div class="notice-listbar ui-ptitle">
          <div class="notice-sub">\u304A\u77E5\u3089\u305B\u4E00\u89A7</div><span class="ui-sp"></span>
          <label class="notice-switch" title="\u4E00\u89A7\u3092\u8868\u793A/\u975E\u8868\u793A">
            <input id="toggleNoticeTable" type="checkbox" ${A?"checked":""}>
            <span class="notice-switch-track"></span>
          </label>
        </div>
        <div id="noticeTableSection" ${A?"":"hidden"}>
        <div class="notice-table-wrap">
          <table class="notice-table">
            ${U}
            <thead>
              ${F}
            </thead>
            <tbody id="noticeTableBody">
              ${J}
            </tbody>
          </table>
        </div>
        <div id="noticePagination" style="display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:8px;padding:4px 12px;font-size:13px;color:#475569;font-weight:600;">
          ${l.length>y?`\u30DA\u30FC\u30B8 ${s} / ${w} (${l.length}\u4EF6)\u3000<button id="noticePrevPage" type="button" style="padding:4px 10px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;cursor:pointer;font-weight:700;">\u25C0</button> <button id="noticeNextPage" type="button" style="padding:4px 10px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;cursor:pointer;font-weight:700;">\u25B6</button>`:`${l.length}\u4EF6`}
        </div>
        </div></div>
      </div>
      </div>
    `;const E=()=>{const t=o.querySelector("#noticeTableBody"),e=o.querySelector("#noticePagination");t&&(t.innerHTML=I(z())),e&&l.length>y&&(e.innerHTML=`\u30DA\u30FC\u30B8 ${s} / ${w} (${l.length}\u4EF6)\u3000<button id="noticePrevPage" type="button" style="padding:4px 10px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;cursor:pointer;font-weight:700;" ${s<=1?"disabled":""}>\u25C0</button> <button id="noticeNextPage" type="button" style="padding:4px 10px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;cursor:pointer;font-weight:700;" ${s>=w?"disabled":""}>\u25B6</button>`,e.querySelector("#noticePrevPage")?.addEventListener("click",()=>{s>1&&(s--,E())}),e.querySelector("#noticeNextPage")?.addEventListener("click",()=>{s<w&&(s++,E())})),o.querySelectorAll("[data-notice-del]").forEach(a=>{a.addEventListener("click",async()=>{const r=a.dataset.noticeDel;if(!(!r||!confirm("\u3053\u306E\u901A\u77E5\u3092\u524A\u9664\u3057\u307E\u3059\u304B\uFF1F")))try{await $(`/api/notices/admin/${r}`,{method:"DELETE"}),await _()}catch{}})})};o.querySelector("#noticePrevPage")?.addEventListener("click",()=>{s>1&&(s--,E())}),o.querySelector("#noticeNextPage")?.addEventListener("click",()=>{s<w&&(s++,E())});const f=t=>{const e=o.querySelector("#noticeError");if(e){if(!t){e.style.display="none",e.textContent="";return}e.style.display="block",e.textContent=t}},M=o.querySelector("#btnNoticeComposerToggle");M&&M.addEventListener("click",()=>{const t=o.querySelector("#noticeComposerBody"),a=!!!(t&&t.hasAttribute&&t.hasAttribute("hidden"));if(a)try{t&&t.setAttribute("hidden","")}catch{}else try{t&&t.removeAttribute("hidden")}catch{}try{localStorage.setItem(q,a?"0":"1")}catch{}try{o.querySelector("#btnNoticeComposerToggle").textContent=a?"\u5165\u529B\u6B04\u3092\u8868\u793A":"\u5165\u529B\u6B04\u3092\u96A0\u3059"}catch{}});const T=o.querySelector("#toggleNoticeTable");T&&T.addEventListener("change",()=>{const t=T,e=o.querySelector("#noticeTableSection"),a=!!t.checked;if(a)try{e&&e.removeAttribute("hidden")}catch{}else try{e&&e.setAttribute("hidden","")}catch{}try{localStorage.setItem(N,a?"1":"0")}catch{}});const D=o.querySelector("#noticeRecipient"),h=o.querySelector("#noticeScope"),v=o.querySelector("#noticeDate"),S=o.querySelector("#noticeMonth"),g=o.querySelector("#noticeMessage"),j=()=>{if(g)try{g.style.height="0px";const t=Math.max(120,g.scrollHeight);g.style.height=`${t}px`}catch{}},H=()=>{const t=String(h&&h.value!=null?h.value:"global");v&&(v.style.display=t==="date"?"":"none"),S&&(S.style.display=t==="month"?"":"none")};h&&h.addEventListener("change",H),H(),g&&g.addEventListener("input",j),j();const R=o.querySelector("#btnNoticePost");R&&R.addEventListener("click",async()=>{f("");const t=D?String(D.value||"").trim():"",e=String(h&&h.value!=null?h.value:"global"),a=e==="date"?String(v&&v.value?v.value:"").slice(0,10):null,r=e==="month"?String(S&&S.value?S.value:"").slice(0,7):null,b=String(g&&g.value!=null?g.value:"").trim();if(!b){f("\u5185\u5BB9\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044");return}try{await $(p,{method:"POST",body:JSON.stringify({targetUserId:t||null,targetDate:a,targetMonth:r,message:b})}),await _()}catch(k){const B=String(k&&k.message?k.message:k||"");f(B==="Not Found"?`Not Found: ${window.location.origin}${p}`:B||"\u767B\u9332\u306B\u5931\u6557\u3057\u307E\u3057\u305F")}}),o.querySelectorAll("[data-notice-del]").forEach(t=>{t.addEventListener("click",async()=>{f("");const e=t.getAttribute("data-notice-del");if(window.confirm("\u524A\u9664\u3057\u307E\u3059\u304B\uFF1F"))try{await $(`/api/notices/admin/${encodeURIComponent(String(e||""))}`,{method:"DELETE"}),await _()}catch(r){f(r&&r.message?r.message:"\u524A\u9664\u306B\u5931\u6557\u3057\u307E\u3057\u305F")}})})};await _()}export{W as mount};
