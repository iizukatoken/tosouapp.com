import{fetchJSONAuth as m}from"../../api/http.api.js";let s=null,__adjCanDelete=!1;const E=new Date;let f=`${E.getFullYear()}-${String(E.getMonth()+1).padStart(2,"0")}`,g=[],l=1;const C=15;let $=null;const y=Object.create(null),H=Object.create(null),T=Object.create(null);async function U({content:t}){s=t,s.style.visibility="",s.parentElement&&(s.parentElement.style.padding="0");const a=new URLSearchParams(window.location.search).get("standalone")==="1"?"100dvh":"calc(100dvh - var(--topbar-height) - var(--subbar-height))";s.className=(s.className||"")+" adjust-page-content",s.style.cssText="margin: 0; padding: 0; width: 100%; display: flex; flex-direction: column; background: #FFFFFF; flex: 1; min-width: 0;",window.addEventListener("resize",()=>{s&&document.getElementById("btnMonthPrev")&&R()}),await I()&&await D()}function R(){const t=document.getElementById("attHubMobileActions");if(window.innerWidth<=768&&t){let e=document.getElementById("adjustMonthNavMobile");if(!e){e=document.createElement("div"),e.id="adjustMonthNavMobile",e.style.cssText="display:flex; align-items:center; gap:4px;";const n=document.createElement("button");n.innerHTML="&#8249;",n.style.cssText="background:transparent; border:none; padding:4px 8px; font-size:18px; color:#0a6ed1; cursor:pointer;",n.onclick=()=>{f=L(f,-1),l=1,u()};const a=document.createElement("button");a.innerHTML="&#8250;",a.style.cssText="background:transparent; border:none; padding:4px 8px; font-size:18px; color:#0a6ed1; cursor:pointer;",a.onclick=()=>{f=L(f,1),l=1,u()};const i=document.createElement("span");i.id="adjustMonthLabelMobile",i.style.cssText="font-weight:600; font-size:14px; color:#1e293b; min-width:60px; text-align:center;",e.appendChild(n),e.appendChild(i),e.appendChild(a),t.innerHTML="",t.appendChild(e)}document.getElementById("adjustMonthLabelMobile").textContent=A(f)}else t&&(t.innerHTML="")}function p(t){return String(t??"").replace(/[&<>"']/g,e=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[e])}function P(t){if(!t)return"\u2014";const e=String(t).slice(0,16).replace("T"," "),[n,a]=e.split(" ");return n?`<span class="dt-date" style="display:block; font-size:11px; color:#94a3b8; letter-spacing:0.3px;">${n}</span><span class="dt-time" style="display:inline-block; font-size:13px; font-weight:700; color:#0369a1; background:#e0f2fe; padding:1px 7px; border-radius:4px; letter-spacing:0.5px;">${a||""}</span>`:"\u2014"}function L(t,e){const[n,a]=t.split("-").map(Number),i=new Date(n,a-1+e,1);return`${i.getFullYear()}-${String(i.getMonth()+1).padStart(2,"0")}`}function A(t){const[e,n]=t.split("-").map(Number);return`${e}\u5E74${n}\u6708`}function B(t){return t?String(t).slice(0,16).replace("T"," "):""}function S(t,e,n){const a={approve:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',reject:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',chat:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 10h.01M12 10h.01M16 10h.01M21 12a8 8 0 0 1-8 8H7l-4 3v-7a8 8 0 1 1 18-4Z"/></svg>',delete:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>'};return`<button class="adj-action-btn ${t==="delete"?"danger":t}" data-id="${e}" title="${p(n)}" aria-label="${p(n)}" type="button">${a[t]||""}</button>`}async function I(){try{const t=await m("/api/auth/me"),e=String(t?.role||"").toLowerCase();__adjCanDelete=e==="admin";if(!t||e!=="admin"&&e!=="manager")return window.location.replace("/ui/login"),!1;const n=document.querySelector("#userName");return n&&(n.textContent=t.username||t.email||"User"),!0}catch{return window.location.replace("/ui/login"),!1}}async function q(t,e){H[t]=!0,delete T[t],e?e():u();try{const n=await m(`/api/adjust/${t}/messages`);y[t]=Array.isArray(n)?n:[]}catch(n){throw T[t]=n?.message||"unknown",y[t]=[],n}finally{delete H[t],e?e():String($)===String(t)&&u()}}async function V(t,e){await m(`/api/adjust/${t}/messages`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:e})}),await q(t)}async function N(t,e,n=""){try{const __r=await m(`/api/adjust/${t}/status`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:e,adminNote:n})});if(e==="approved"&&__r&&__r.applied&&__r.applied.ok===false){alert("承認しましたが、勤怠への反映に失敗しました: "+(__r.applied.error||"")+"\n月次勤怠入力で確認してください。")}const a=g.find(i=>String(i.id)===String(t));return a&&(a.status=e,a.admin_note=e==="rejected"?n:null),delete y[t],String($)===String(t)&&await q(t),u(),!0}catch(a){return alert("\u30B9\u30C6\u30FC\u30BF\u30B9\u66F4\u65B0\u306B\u5931\u6557\u3057\u307E\u3057\u305F: "+(a?.message||"unknown")),!1}}function _(t){const e=g.find(d=>String(d.id)===String(t)),n=e?p(e.username||e.email||e.userId||"\u2014"):"\u2014",a=document.createElement("div");a.style.cssText="position:fixed;inset:0;background:rgba(15,23,42,0.48);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;",a.innerHTML=`
    <div style="width:100%;max-width:560px;background:#fff;border-radius:12px;box-shadow:0 20px 45px rgba(15,23,42,0.25);overflow:hidden;">
      <div style="padding:16px 20px;border-bottom:1px solid #e2e8f0;font-weight:700;color:#0f172a;">\u5DEE\u623B\u3057\u7406\u7531\u3092\u5165\u529B</div>
      <div style="padding:16px 20px;">
        <div style="font-size:12px;color:#64748b;margin-bottom:8px;">\u5BFE\u8C61\u30E6\u30FC\u30B6\u30FC: ${n}</div>
        <textarea id="rejectReasonInput" style="width:100%;min-height:140px;resize:vertical;border:1px solid #cbd5e1;border-radius:8px;padding:10px 12px;box-sizing:border-box;font:inherit;" placeholder="\u4F8B: \u51FA\u52E4\u6642\u523B\u306E\u6839\u62E0\u304C\u4E0D\u8DB3\u3057\u3066\u3044\u307E\u3059\u3002\u6B63\u3057\u3044\u6642\u523B\u3068\u88DC\u8DB3\u3092\u8FFD\u8A18\u3057\u3066\u518D\u7533\u8ACB\u3057\u3066\u304F\u3060\u3055\u3044\u3002">${p(e?.admin_note||"")}</textarea>
        <div id="rejectReasonError" style="display:none;color:#b91c1c;font-size:12px;margin-top:8px;"></div>
      </div>
      <div style="padding:12px 20px;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end;gap:8px;background:#f8fafc;">
        <button type="button" id="btnRejectCancel" style="height:36px;padding:0 14px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;color:#334155;cursor:pointer;">\u30AD\u30E3\u30F3\u30BB\u30EB</button>
        <button type="button" id="btnRejectSave" style="height:36px;padding:0 14px;border-radius:8px;border:1px solid #f59e0b;background:#f59e0b;color:#fff;cursor:pointer;font-weight:600;">\u5DEE\u623B\u3057\u3059\u308B</button>
      </div>
    </div>
  `;const i=()=>{try{document.body.removeChild(a)}catch{}};document.body.appendChild(a),a.querySelector("#btnRejectCancel")?.addEventListener("click",i),a.addEventListener("click",d=>{d.target===a&&i()}),a.querySelector("#rejectReasonInput")?.focus(),a.querySelector("#btnRejectSave")?.addEventListener("click",async d=>{const c=d.currentTarget,r=a.querySelector("#rejectReasonInput"),o=a.querySelector("#rejectReasonError"),b=String(r?.value||"").trim();if(!b){o&&(o.textContent="\u5DEE\u623B\u3057\u7406\u7531\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002",o.style.display="block"),r?.focus();return}c.disabled=!0,c.textContent="\u9001\u4FE1\u4E2D...",await N(t,"rejected",b)?i():(c.disabled=!1,c.textContent="\u5DEE\u623B\u3057\u3059\u308B")})}function F(t){const e=g.find(r=>String(r.id)===String(t));if(!e)return;const n=document.createElement("div");n.style.cssText="position:fixed;inset:0;background:rgba(15,23,42,0.48);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;";const a=()=>{const r=Array.isArray(y[t])?y[t]:[],o=!!H[t],b=String(T[t]||"").trim(),x=e.admin_note?`<div style="margin-bottom:8px;padding:8px 10px;border-radius:8px;background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;font-size:12px;"><strong>\u5DEE\u623B\u3057\u7406\u7531:</strong> ${p(e.admin_note)}</div>`:"",v=b?`<div style="margin-bottom:8px;padding:8px 10px;border-radius:8px;background:#fef2f2;border:1px solid #fecaca;color:#991b1b;font-size:12px;">\u3084\u308A\u53D6\u308A\u306E\u8AAD\u307F\u8FBC\u307F\u306B\u5931\u6557\u3057\u307E\u3057\u305F: ${p(b)}</div>`:"",z=o?'<div style="color:#64748b;font-size:12px;">\u8AAD\u307F\u8FBC\u307F\u4E2D...</div>':r.length?r.map(h=>{const w=String(h.sender_user_id)!==String(e.userId),j=w?"#dbeafe":"#f8fafc",k=w?"flex-end":"flex-start",M=p(h.sender_name||(w?"\u7BA1\u7406\u8005":"\u793E\u54E1"));return`
                <div style="display:flex;justify-content:${k};margin-bottom:8px;">
                  <div style="max-width:85%;background:${j};border:1px solid #dbeafe;border-radius:12px;padding:8px 10px;">
                    <div style="font-size:11px;font-weight:700;color:#334155;margin-bottom:4px;">${M}</div>
                    <div style="font-size:12px;color:#0f172a;white-space:pre-wrap;word-break:break-word;">${p(h.message||"")}</div>
                    <div style="font-size:10px;color:#64748b;margin-top:4px;">${p(B(h.created_at))}</div>
                  </div>
                </div>
              `}).join(""):'<div style="color:#64748b;font-size:12px;">\u307E\u3060\u3084\u308A\u53D6\u308A\u306F\u3042\u308A\u307E\u305B\u3093\u3002</div>';return`
      <div style="width:100%;max-width:560px;background:#fff;border-radius:12px;box-shadow:0 20px 45px rgba(15,23,42,0.25);overflow:hidden;display:flex;flex-direction:column;max-height:85vh;">
        <div style="padding:16px 20px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;">
          <div style="font-weight:700;color:#0f172a;font-size:15px;">\u3084\u308A\u53D6\u308A - ${p(e.username||e.email||e.userId||"\u2014")}</div>
          <button type="button" id="btnChatClose" style="background:none;border:none;font-size:20px;cursor:pointer;color:#64748b;padding:0;line-height:1;">&times;</button>
        </div>
        <div style="padding:16px 20px;overflow-y:auto;flex:1;background:#f8fafc;">
          ${x}
          ${v}
          ${z}
        </div>
        <div style="padding:12px 20px;border-top:1px solid #e2e8f0;background:#fff;display:flex;gap:8px;align-items:flex-end;">
          <textarea id="chatInputText" placeholder="\u30E1\u30C3\u30BB\u30FC\u30B8\u3092\u5165\u529B..." style="flex:1;min-height:72px;resize:vertical;border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px;box-sizing:border-box;font:inherit;"></textarea>
          <button id="btnChatSend" type="button" style="height:36px;padding:0 14px;border-radius:8px;border:1px solid #005eb8;background:#005eb8;color:#fff;cursor:pointer;font-weight:600;">\u9001\u4FE1</button>
        </div>
      </div>
    `},i=()=>{n.innerHTML=a(),c();const r=n.children[0].children[1];r&&(r.scrollTop=r.scrollHeight)},d=()=>{try{document.body.removeChild(n)}catch{}$=null},c=()=>{n.querySelector("#btnChatClose")?.addEventListener("click",d),n.querySelector("#btnChatSend")?.addEventListener("click",async r=>{const o=r.currentTarget,b=n.querySelector("#chatInputText"),x=String(b?.value||"").trim();if(!x){b?.focus();return}o.disabled=!0,o.textContent="\u9001\u4FE1\u4E2D...";try{await m(`/api/adjust/${t}/messages`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:x})}),await q(t,i)}catch(v){T[t]=v?.message||"unknown",i()}})};n.addEventListener("click",r=>{r.target===n&&d()}),document.body.appendChild(n),i(),y[t]||q(t,i)}function O(){s.querySelectorAll(".adj-action-btn.approve").forEach(d=>{d.addEventListener("click",c=>{const r=c.currentTarget.dataset.id;confirm("\u3053\u306E\u7533\u8ACB\u3092\u627F\u8A8D\u3057\u307E\u3059\u304B\uFF1F")&&N(r,"approved")})}),s.querySelectorAll(".adj-action-btn.reject").forEach(d=>{d.addEventListener("click",c=>{_(c.currentTarget.dataset.id)})}),s.querySelectorAll(".adj-action-btn.chat").forEach(d=>{d.addEventListener("click",async c=>{const r=c.currentTarget.dataset.id;$=r,F(r)})}),s.querySelectorAll(".adj-action-btn.danger").forEach(d=>{d.addEventListener("click",async c=>{const r=c.currentTarget.dataset.id;if(confirm("\u3053\u306E\u7533\u8ACB\u3092\u524A\u9664\u3057\u307E\u3059\u304B\uFF1F\u3053\u306E\u64CD\u4F5C\u306F\u53D6\u308A\u6D88\u305B\u307E\u305B\u3093\u3002"))try{await m(`/api/adjust/${r}`,{method:"DELETE"}),g=g.filter(o=>String(o.id)!==String(r)),String($)===String(r)&&($=null),delete y[r],u()}catch(o){alert("\u524A\u9664\u306B\u5931\u6557\u3057\u307E\u3057\u305F: "+(o?.message||"unknown"))}})});const t=s.querySelector("#btnMonthPrev"),e=s.querySelector("#btnMonthNext"),n=s.querySelector("#btnMonthNow"),a=s.querySelector("#btnPagePrev"),i=s.querySelector("#btnPageNext");t&&(t.onclick=()=>{f=L(f,-1),l=1,u()}),e&&(e.onclick=()=>{f=L(f,1),l=1,u()}),n&&(n.onclick=()=>{const d=new Date;f=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`,l=1,u()}),a&&(a.onclick=()=>{l>1&&(l--,u())}),i&&(i.onclick=()=>{l++,u()});const x=s.querySelector("#btnExportXlsx"),X=s.querySelector("#btnExportPdf");async function W(fmt,btn){const label=btn?.textContent?.trim()||fmt.toUpperCase();if(btn){btn.disabled=!0;btn.textContent="\u51FA\u529B\u4E2D...";}try{const url=`/api/adjust/admin/export?month=${encodeURIComponent(f)}&format=${fmt}`;const resp=await fetch(url,{credentials:"include"});if(!resp.ok){const e=await resp.json().catch(()=>({}));throw new Error(e.message||`HTTP ${resp.status}`);}const blob=await resp.blob();const ext=fmt==="pdf"?"pdf":"xlsx";const filename=`\u8ABF\u6574\u7533\u8ACB_${f}.${ext}`;const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();document.body.removeChild(a);setTimeout(()=>URL.revokeObjectURL(a.href),10000);}catch(err){alert(`\u30A8\u30AF\u30B9\u30DD\u30FC\u30C8\u306B\u5931\u6557\u3057\u307E\u3057\u305F: ${err.message||err}`);}finally{if(btn){btn.disabled=!1;btn.innerHTML=fmt==="xlsx"?'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg> Excel':'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13h1a2 2 0 0 1 0 4H9v-4z"/></svg> PDF';}}}x&&(x.onclick=()=>W("xlsx",x)),X&&(X.onclick=()=>W("pdf",X))}function u(){const e=new URLSearchParams(window.location.search).get("standalone")==="1"?"100dvh":"calc(100dvh - var(--topbar-height) - var(--subbar-height))",n=g.filter(o=>(o.created_at?String(o.created_at).slice(0,7):"")===f),a=n.filter(o=>o.status==="pending").length,i=f===`${E.getFullYear()}-${String(E.getMonth()+1).padStart(2,"0")}`,d=Math.ceil(n.length/C)||1;l>d&&(l=d),l<1&&(l=1);const c=n.slice((l-1)*C,l*C),r=c.map(o=>{const b=p(o.username||o.email||o.userId||"\u2014"),x=P(o.created_at),v=P(o.requestedCheckIn),z=P(o.requestedCheckOut),h=String(o.status||"pending"),w=`
          <div style="white-space:pre-wrap;word-break:break-word;">${p(o.reason||"")}</div>
          ${o.admin_note?`<div style="margin-top:6px;font-size:12px;color:#9a3412;background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;padding:6px 8px;"><strong>\u5DEE\u623B\u3057\u7406\u7531:</strong> ${p(o.admin_note)}</div>`:""}
        `;let j="\u5374\u4E0B",k="adj-status-rejected",M=`
          ${S("chat",o.id,"\u3084\u308A\u53D6\u308A")}
          ${__adjCanDelete?S("delete",o.id,"\u524A\u9664"):""}
        `;return h==="pending"?(j="\u78BA\u8A8D\u5F85\u3061",k="adj-status-pending",M=`
            ${S("approve",o.id,"\u627F\u8A8D")}
            ${S("reject",o.id,"\u5374\u4E0B")}
            ${S("chat",o.id,"\u3084\u308A\u53D6\u308A")}
            ${__adjCanDelete?S("delete",o.id,"\u524A\u9664"):""}
          `):h==="approved"&&(j="\u627F\u8A8D\u6E08\u307F",k="adj-status-approved"),`
          <tr class="adj-desktop-row">
            <td style="font-weight:500;">${b}</td>
            <td style="font-family:monospace;">${x}</td>
            <td style="font-family:monospace;">${v}</td>
            <td style="font-family:monospace;">${z}</td>
            <td>${w}</td>
            <td><span class="${k}">${j}</span></td>
            <td style="white-space:nowrap;text-align:right;">${M}</td>
          </tr>
          <tr class="adj-mobile-row">
            <td colspan="7" class="adj-mobile-cell">
              <div class="adj-card">
                <div class="adj-card-header">
                  <div class="adj-card-user">${b}</div>
                  <span class="${k}">${j}</span>
                </div>
                <div class="adj-card-body">
                  <div class="adj-card-row">
                    <span class="adj-card-label">\u4F5C\u6210</span>
                    <span class="adj-card-value">${x}</span>
                  </div>
                  <div class="adj-card-row">
                    <span class="adj-card-label">\u4FEE\u6B63(\u51FA\u52E4)</span>
                    <span class="adj-card-value">${v}</span>
                  </div>
                  <div class="adj-card-row">
                    <span class="adj-card-label">\u4FEE\u6B63(\u9000\u52E4)</span>
                    <span class="adj-card-value">${z}</span>
                  </div>
                  <div class="adj-card-reason">
                    <div class="adj-card-label" style="margin-bottom:4px;">\u7406\u7531 / \u5DEE\u623B\u3057\u5185\u5BB9</div>
                    <div class="adj-card-reason-content">${w}</div>
                  </div>
                </div>
                <div class="adj-card-actions">
                  ${M}
                </div>
              </div>
            </td>
          </tr>
        `}).join("");s.innerHTML=`
    <style>
      .adjust-page-content { flex: 1 1 0%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
      .adj-table-card { flex: 1 1 0%; min-height: 0; overflow-y: auto; overflow-x: auto; -webkit-overflow-scrolling: touch; }
      
      .sap-card { background:#ffffff; border:none; box-shadow:none; margin:0; display:flex; flex-direction:column; overflow:hidden; flex: 1; min-height: 0; }
      .adj-table { width:100%; border-collapse:collapse; font-size:13px; table-layout:auto; font-family:"72","72full",Arial,Helvetica,sans-serif; }
      .adj-table th { background-color:#f8fafc; color:#475569; padding:8px 16px; font-size:12px; font-weight:600; text-align:left; border-bottom:1px solid #e2e8f0; border: 1px solid #e2e8f0; }
      .adj-table td { padding:8px 16px; vertical-align:middle; border-bottom:1px solid #f1f5f9; color:#0f172a; border: 1px solid #e2e8f0; }
      .adj-table tbody tr:hover td { background-color:#f8fafc; }
      
      .adj-table th { background-color: #e6f2ff !important; color: #0f172a !important; font-weight: 600 !important; border: 1px solid #cbd5e1 !important; padding: 6px 8px !important; text-align: center !important; white-space: nowrap; }
      .adj-table td { border: 1px solid #cbd5e1 !important; padding: 6px 8px !important; }
      
      .adj-month-nav { display:flex; align-items:center; padding:16px 24px; justify-content:space-between; flex-shrink:0; background:#ffffff; border-bottom:1px solid #e5e5e5; }
      .adj-month-nav-right { display:flex; align-items:center; gap:8px; }
      .adj-month-btn { background:transparent; border:1px solid #cbd5e1; border-radius:4px; padding:4px 12px; cursor:pointer; color:#475569; font-weight:500; height:32px; transition:background 0.2s; font-size: 13px; display: inline-flex; align-items: center; justify-content: center; }
      .adj-month-btn:hover:not([disabled]) { background:#f1f5f9; }
      .adj-month-btn[disabled] { color:#94a3b8; cursor:not-allowed; background:#f8fafc; border-color:#e2e8f0; }
      .adj-month-label { font-weight:600; margin:0 8px; font-size:15px; color:#1e293b; }
      .adj-pending-badge { background:#ef4444; color:white; padding:2px 8px; border-radius:12px; font-size:11px; margin-left:12px; font-weight:bold; }
      .adj-table-card { margin:0; padding: 16px 24px; }
      .adj-status-pending, .adj-status-approved, .adj-status-rejected { display:inline-flex; align-items:center; padding:2px 8px; border-radius:6px; font-size:12px; font-weight:600; border-width:1px; border-style:solid; }
      .adj-status-pending { background:#fff7ed; color:#ea580c; border-color:#fdba74; }
      .adj-status-approved { background:#f0fdf4; color:#16a34a; border-color:#bbf7d0; }
      .adj-status-rejected { background:#fef2f2; color:#dc2626; border-color:#fecaca; }
      .adj-action-btn { width:32px; height:32px; border-radius:4px; border:1px solid #cbd5e1; background:#fff; color:#475569; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; margin:0 2px; transition:background 0.2s; }
      .adj-action-btn:hover { background:#f1f5f9; }
      .adj-action-btn.danger { color:#dc2626; border-color:#fecaca; background:#fef2f2; }
      .adj-action-btn.danger:hover { background:#fee2e2; }
      .adj-action-btn.approve { color:#16a34a; border-color:#bbf7d0; background:#f0fdf4; }
      .adj-action-btn.approve:hover { background:#dcfce7; }
      .adj-action-btn.reject { color:#ea580c; border-color:#fdba74; background:#fff7ed; }
      .adj-action-btn.reject:hover { background:#ffedd5; }
      
      .adj-mobile-row { display: none; }
      
      @media (max-width: 768px) {
        .adjust-page-content { flex: 1 1 0% !important; min-height: 0 !important; overflow: hidden !important; display: flex !important; flex-direction: column !important; }
        .adj-table-card { flex: 1 1 0% !important; min-height: 0 !important; overflow-y: auto !important; overflow-x: hidden !important; -webkit-overflow-scrolling: touch !important; padding: 12px !important; }
        #adminContent.card { padding: 0 !important; border: none !important; box-shadow: none !important; background: transparent !important; }
        
        .adj-month-nav { display: none !important; }
        
        .adj-table { border: none !important; }
        .adj-table thead { display: none; }
        .adj-desktop-row { display: none; }
        .adj-mobile-row { display: table-row; }
        
        .adj-mobile-cell { padding: 0 !important; border: none !important; background: transparent !important; }
        .adj-mobile-cell:hover { background: transparent !important; }
        
        .adj-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 12px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); overflow: hidden; }
        .adj-card-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid #f1f5f9; background: #f8fafc; }
        .adj-card-user { font-weight: 700; font-size: 15px; color: #0f172a; }
        
        .adj-card-body { padding: 12px 16px; }
        .adj-card-row { display: flex; align-items: center; margin-bottom: 8px; font-size: 13px; }
        .adj-card-label { color: #64748b; width: 80px; flex-shrink: 0; font-weight: 500; }
        .adj-card-value { color: #1e293b; font-family: monospace; font-size: 14px; }
        
        .adj-card-reason { margin-top: 12px; padding-top: 12px; border-top: 1px dashed #e2e8f0; }
        .adj-card-reason-content { font-size: 13px; color: #334155; line-height: 1.5; }
        
        .adj-card-actions { display: flex; justify-content: flex-end; padding: 12px 16px; border-top: 1px solid #f1f5f9; background: #f8fafc; gap: 8px; }
      }
    </style>
    <div class="sap-card">
      <div class="adj-month-nav">
        <h2 style="margin:0; font-size:16px; font-weight:700; color:#1e293b; display:none;">\u8ABF\u6574\u7533\u8ACB\u4E00\u89A7</h2>
        <div class="adj-month-nav-right">
          <button id="btnMonthPrev" class="adj-month-btn" title="\u524D\u6708">&#8249;</button>
          <span class="adj-month-label">
            ${A(f)}
            ${a>0?`<span class="adj-pending-badge">${a}\u4EF6 \u78BA\u8A8D\u5F85\u3061</span>`:""}
          </span>
          <button id="btnMonthNext" class="adj-month-btn" title="\u7FCC\u6708">&#8250;</button>
          <div style="width:1px;height:20px;background:#e2e8f0;margin:0 4px;flex-shrink:0;"></div>
          <button id="btnExportXlsx" class="adj-month-btn" title="Excel\u51FA\u529B" style="background:#f0fdf4;border-color:#86efac;color:#166534;gap:4px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>
            Excel
          </button>
          <button id="btnExportPdf" class="adj-month-btn" title="PDF\u51FA\u529B" style="background:#fef2f2;border-color:#fca5a5;color:#991b1b;gap:4px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13h1a2 2 0 0 1 0 4H9v-4z"/></svg>
            PDF
          </button>
        </div>
      </div>
      <div class="adj-table-card">
        ${c.length===0?`
          <div style="padding:48px 24px;text-align:center;color:#6a6d70;font-size:14px;background:#ffffff;">\u8A72\u5F53\u3059\u308B\u7533\u8ACB\u30C7\u30FC\u30BF\u304C\u3042\u308A\u307E\u305B\u3093\u3002</div>
        `:`
          <table class="adj-table">
            <thead style="position:sticky;top:0;z-index:10;">
              <tr>
                <th style="width:120px;">\u30E6\u30FC\u30B6\u30FC</th>
                <th style="width:140px;">\u4F5C\u6210</th>
                <th style="width:140px;">\u4FEE\u6B63(\u51FA\u52E4)</th>
                <th style="width:140px;">\u4FEE\u6B63(\u9000\u52E4)</th>
                <th style="width:280px;">\u7406\u7531 / \u5DEE\u623B\u3057\u5185\u5BB9</th>
                <th style="width:100px;">\u72B6\u614B</th>
                <th style="width:140px;text-align:right;">\u30A2\u30AF\u30B7\u30E7\u30F3</th>
              </tr>
            </thead>
            <tbody style="background:white;">${r}</tbody>
          </table>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 24px;border-top:1px solid #e5e5e5;${d<=1?"display:none;":""}">
            <span style="font-size:13px;color:#6a6d70;">${n.length} \u4EF6\u4E2D ${(l-1)*C+1} - ${Math.min(l*C,n.length)} \u4EF6\u3092\u8868\u793A</span>
            <div style="display:flex;gap:8px;align-items:center;">
              <button id="btnPagePrev" class="adj-month-btn" ${l===1?"disabled":""}>\u524D\u3078</button>
              <span style="font-size:13px;color:#32363a;">${l} / ${d}</span>
              <button id="btnPageNext" class="adj-month-btn" ${l===d?"disabled":""}>\u6B21\u3078</button>
            </div>
          </div>
        `}
      </div>
    </div>
  `,O()}async function D(){if(s){s.innerHTML='<div style="color:#475569;padding:16px;">\u8AAD\u307F\u8FBC\u307F\u4E2D\u2026</div>';try{g=await m("/api/adjust/admin"),Array.isArray(g)||(g=[]),u()}catch(t){s.innerHTML=`<div style="color:#b00020;padding:16px;">\u53D6\u5F97\u5931\u6557: ${p(t?.message||"unknown")}</div>`}}}export{U as mount};
