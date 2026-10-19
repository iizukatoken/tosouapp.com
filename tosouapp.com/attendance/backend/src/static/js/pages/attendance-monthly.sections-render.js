(function(){const J=globalThis.AttendanceMonthly||{},W=J.Core||globalThis.MonthlyMonthlyCore||{},v=J.State||globalThis.MonthlyMonthlyState||{},Rt=J.Api||globalThis.MonthlyMonthlyApi||{},Yt=J.Render||globalThis.MonthlyMonthlyRender||{},{esc:e,fmtHm:H,fromDateTime:K,diffMinutesAllowOvernight:dt,fetchJSONAuth:V,showErr:ee}=W,{renderTable:Tt}=Yt,{loadMonth:rt}=Rt,ct=async(w,$)=>{if(!w)return;const _=Array.isArray($?.shiftAssignments)?$.shiftAssignments:[],D=c=>/^\d{4}-\d{2}-\d{2}$/.test(String(c||"").slice(0,10)),k=(c,t)=>{const n=String(c||"").slice(0,10);if(!D(n))return null;const s=parseInt(n.slice(0,4),10),u=parseInt(n.slice(5,7),10)-1,o=parseInt(n.slice(8,10),10),l=new Date(Date.UTC(s,u,o,0,0,0));l.setUTCDate(l.getUTCDate()+Number(t||0));const h=l.getUTCFullYear(),a=String(l.getUTCMonth()+1).padStart(2,"0"),p=String(l.getUTCDate()).padStart(2,"0");return`${h}-${a}-${p}`},d=c=>{const t=c?.shift||null;return[String(t&&t.id!=null?t.id:""),String(t&&t.name!=null?t.name:""),String(t&&t.start_time!=null?t.start_time:""),String(t&&t.end_time!=null?t.end_time:""),String(t&&t.break_minutes!=null?t.break_minutes:""),String(t&&t.standard_minutes!=null?t.standard_minutes:"")].join("|")},i=(()=>{const c=_.map(n=>({...n,start_date:D(n?.start_date)?String(n.start_date).slice(0,10):null,end_date:D(n?.end_date)?String(n.end_date).slice(0,10):null,_k:d(n)})).filter(n=>!!n.start_date).sort((n,s)=>String(n.start_date).localeCompare(String(s.start_date))),t=[];for(let n=0;n<c.length;n++){const s={...c[n]},u=c[n+1]||null;if(u?.start_date&&(!s.end_date||s.end_date>=u.start_date)&&(s.end_date=k(u.start_date,-1)),s.end_date&&s.end_date<s.start_date)continue;const o=t[t.length-1]||null;if(o&&o._k===s._k){const l=o.end_date?k(o.end_date,1):null;if(!o.end_date||l===s.start_date){o.end_date=o.end_date==null||s.end_date==null?null:o.end_date>s.end_date?o.end_date:s.end_date;continue}}t.push(s)}return t.map(({_k:n,...s})=>s)})();let x=i.length?i:_;if(!x.length)try{const c=String(profile?.role||"").toLowerCase(),t=c!=="employee"&&v.currentViewingUserId?String(v.currentViewingUserId):"",n=String((document.querySelector("#monthPicker2")||document.querySelector("#monthPicker"))?.value||"").trim(),s=[];t&&s.push(`userId=${encodeURIComponent(t)}`),/^\d{4}-\d{2}$/.test(n)&&s.push(`ym=${encodeURIComponent(n)}`);const u=s.length?"?"+s.join("&"):"",l=(await V("/api/attendance/user-profile"+u))?.contract?.shift||null;if(l&&(l.start_time||l.end_time)&&(x=[{shift:{id:l.id||null,name:l.name||"",start_time:l.start_time||"",end_time:l.end_time||"",break_minutes:l.break_minutes||0,standard_minutes:l.standard_minutes||null},start_date:null,end_date:null,_suggest:!0}],(c==="admin"||c==="manager")&&l.id))try{const h=String((document.querySelector("#monthPicker2")||document.querySelector("#monthPicker"))?.value||"").trim(),a=/^\d{4}-\d{2}$/.test(h)?`${h}-01`:null;if(a){await V("/api/attendance/shifts/assign",{method:"POST",body:JSON.stringify({userId:v.currentViewingUserId||void 0,shiftId:l.id,startDate:a,endDate:null})});const{detail:p,timesheet:m}=await rt(h,c==="employee"?null:v.currentViewingUserId||null);v.currentMonthDetail=p,v.currentMonthTimesheet=m,x=Array.isArray(p?.shiftAssignments)?p.shiftAssignments:x}}catch{}}catch{}const O=c=>{const t=Number(c);return!Number.isFinite(t)||t<0?"\u2014":H(t)},f=c=>{const t=Number(c);return!Number.isFinite(t)||t<0?"\u2014":H(t)},g=document.createElement("table");g.innerHTML=`
    <thead>
      <tr>
        <th>No</th>
        <th>\u30B7\u30D5\u30C8</th>
        <th>\u958B\u59CB\u6642\u523B</th>
        <th>\u7D42\u4E86\u6642\u523B</th>
        <th>\u4F11\u61A9\u6642\u9593</th>
        <th>\u6240\u5B9A\u52B4\u50CD\u6642\u9593</th>
        <th>\u9069\u7528\u958B\u59CB\u65E5</th>
        <th>\u9069\u7528\u7D42\u4E86\u65E5</th>
      </tr>
    </thead>
    <tbody>
      ${x.length?x.map((c,t)=>{const n=c?.shift||null,s=n?n.name||"":"\u2014",u=n&&n.start_time||"\u2014",o=n&&n.end_time||"\u2014",l=n?O(n.break_minutes):"\u2014",h=n?f(n.standard_minutes):"\u2014",a=c?.start_date||"\u2014",p=c?.end_date||"\u2014",m=c?._suggest?"\uFF08\u793E\u54E1\u60C5\u5831\uFF09":"";return`<tr>
            <td>${e(t+1)}</td>
            <td>${e(s)}${e(m)}</td>
            <td>${e(u)}</td>
            <td>${e(o)}</td>
            <td>${e(l)}</td>
            <td>${e(h)}</td>
            <td>${e(a)}</td>
            <td>${e(p)}</td>
          </tr>`}).join(""):'<tr><td colspan="8" style="text-align:center;color:#64748b;font-weight:800;">\u30B7\u30D5\u30C8\u304C\u672A\u8A2D\u5B9A\u3067\u3059\uFF08\u7BA1\u7406\u8005\u304C\u30B7\u30D5\u30C8\u3092\u5272\u308A\u5F53\u3066\u3057\u3066\u304F\u3060\u3055\u3044\uFF09</td></tr>'}
    </tbody>
  `,w.innerHTML="",w.appendChild(g)},ut=async(w,$,_)=>{if(!w)return;const D=String(_?.role||"").toLowerCase(),k=!1;let d=Array.isArray($?.workDetails)?$.workDetails:[];if(!d.length)try{const t=D!=="employee"&&v.currentViewingUserId?String(v.currentViewingUserId):"",n=String((document.querySelector("#monthPicker2")||document.querySelector("#monthPicker"))?.value||"").trim(),s=[];t&&s.push(`userId=${encodeURIComponent(t)}`),/^\d{4}-\d{2}$/.test(n)&&s.push(`ym=${encodeURIComponent(n)}`);const u=s.length?"?"+s.join("&"):"",o=await V("/api/attendance/user-profile"+u);if(Array.isArray(o?.workDetails)&&o.workDetails.length){const l=o.workDetails[0];if(d=[{id:null,startDate:l.start_date||"",endDate:l.end_date||"",companyName:l.company_name||"",workPlaceAddress:l.work_place_address||"",workContent:l.work_content||"",roleTitle:l.role_title||"",responsibilityLevel:l.responsibility_level||"",_suggest:!0}],D==="admin"||D==="manager")try{const h=String((document.querySelector("#monthPicker2")||document.querySelector("#monthPicker"))?.value||"").trim(),a=/^\d{4}-\d{2}$/.test(h)?`${h}-01`:d[0].startDate||"";await V("/api/attendance/work-details",{method:"POST",body:JSON.stringify({userId:v.currentViewingUserId||void 0,startDate:a||null,endDate:d[0].endDate||null,companyName:d[0].companyName||"",workPlaceAddress:d[0].workPlaceAddress||"",workContent:d[0].workContent||"",roleTitle:d[0].roleTitle||"",responsibilityLevel:d[0].responsibilityLevel||""})});const{detail:p,timesheet:m}=await rt(h,D==="employee"?null:v.currentViewingUserId||null);v.currentMonthDetail=p,v.currentMonthTimesheet=m,d=Array.isArray(p?.workDetails)?p.workDetails:d}catch{}}}catch{}const i=t=>e(t??""),x=document.createElement("table");if(x.innerHTML=`
    <thead>
      <tr>
        <th>\u4F01\u696D\u540D</th>
        <th>\u9069\u7528\u7D42\u4E86\u65E5</th>
        <th>\u5C31\u696D\u5148\u4F4F\u6240</th>
        <th>\u696D\u52D9\u5185\u5BB9</th>
        <th>\u5F79\u8077</th>
        <th>\u8CAC\u4EFB\u306E\u7A0B\u5EA6</th>
        ${k?"<th>\u64CD\u4F5C</th>":""}
      </tr>
    </thead>
    <tbody>
      ${d.length?d.map(t=>{const n=t?.id,s=t?.companyName||"",u=t?.endDate||"\u2014",o=t?.workPlaceAddress||"",l=t?.workContent||"",h=t?.roleTitle||"",a=t?.responsibilityLevel||"",p=k?`
            <td style="white-space:nowrap;">
              ${t?._suggest?'<button type="button" class="se-mini-btn" data-wd-action="apply" data-wd-id="suggest">\u9069\u7528</button>':`
                <button type="button" class="se-mini-btn" data-wd-action="edit" data-wd-id="${i(n)}">\u7DE8\u96C6</button>
                <button type="button" class="se-mini-btn" data-wd-action="del" data-wd-id="${i(n)}">\u524A\u9664</button>
              `}
            </td>
          `:"";return`<tr>
            <td>${i(s)}</td>
            <td>${i(u)}</td>
            <td>${i(o)}</td>
            <td>${i(l)}</td>
            <td>${i(h)}</td>
            <td>${i(a)}</td>
            ${p}
          </tr>`}).join(""):`<tr><td colspan="${k?7:6}" style="text-align:center;color:#64748b;font-weight:800;">\u696D\u52D9\u5185\u5BB9\u304C\u672A\u8A2D\u5B9A\u3067\u3059\uFF08\u7BA1\u7406\u8005\u304C\u767B\u9332\u3057\u3066\u304F\u3060\u3055\u3044\uFF09</td></tr>`}
    </tbody>
  `,w.innerHTML="",k){const t=document.createElement("div");t.style.display="flex",t.style.alignItems="center",t.style.justifyContent="flex-end",t.style.gap="8px",t.style.marginBottom="8px",t.innerHTML='<button type="button" class="se-btn small" id="btnWorkDetailAdd">\u8FFD\u52A0</button>',w.appendChild(t)}if(w.appendChild(x),!k)return;const O=t=>/^\d{4}-\d{2}-\d{2}$/.test(String(t||"").slice(0,10)),f=(t,n)=>{const s=window.prompt(t,String(n??""));return s==null?null:String(s)},g=(t,n,s)=>{const u=window.prompt(t,String(n??""));if(u==null)return null;const o=String(u).trim();return!o&&s?"":O(o)?o:(alert("\u65E5\u4ED8\u306FYYYY-MM-DD\u5F62\u5F0F\u3067\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044"),null)},c=async()=>{const t=String((document.querySelector("#monthPicker2")||document.querySelector("#monthPicker"))?.value||"").trim(),n=/^\d{4}-\d{2}$/.test(t)?`${t}-01`:"",s=g("\u9069\u7528\u958B\u59CB\u65E5 (YYYY-MM-DD)",n,!1);if(s==null)return;const u=g("\u9069\u7528\u7D42\u4E86\u65E5 (YYYY-MM-DD / \u7A7A\u6B04=\u306A\u3057)","",!0);if(u==null)return;const o=f("\u4F01\u696D\u540D","");if(o==null)return;const l=f("\u5C31\u696D\u5148\u4F4F\u6240","");if(l==null)return;const h=f("\u696D\u52D9\u5185\u5BB9","");if(h==null)return;const a=f("\u5F79\u8077","");if(a==null)return;const p=f("\u8CAC\u4EFB\u306E\u7A0B\u5EA6","");if(p==null)return;await V("/api/attendance/work-details",{method:"POST",body:JSON.stringify({userId:v.currentViewingUserId||void 0,startDate:s,endDate:u||null,companyName:o,workPlaceAddress:l,workContent:h,roleTitle:a,responsibilityLevel:p})});const S=(document.querySelector("#monthPicker2")||document.querySelector("#monthPicker"))?.value||"";if(/^\d{4}-\d{2}$/.test(S)){const{detail:I,timesheet:P}=await rt(S,D==="employee"?null:v.currentViewingUserId||null);v.currentMonthDetail=I,v.currentMonthTimesheet=P,ct(document.querySelector("#contractTable"),I),ut(document.querySelector("#workDetailTable"),I,_),mt(document.querySelector("#monthSummaryTable")||document.querySelector("#monthSummary"),I,P),Tt(document.querySelector("#monthTable"),I,_)}};w.querySelector("#btnWorkDetailAdd")?.addEventListener("click",async()=>{try{await c()}catch(t){alert(String(t?.message||"\u4FDD\u5B58\u306B\u5931\u6557\u3057\u307E\u3057\u305F"))}}),w.querySelectorAll("button[data-wd-action][data-wd-id]").forEach(t=>{t.addEventListener("click",async()=>{const n=String(t.getAttribute("data-wd-action")||""),s=String(t.getAttribute("data-wd-id")||""),u=parseInt(s,10);if(!(n!=="apply"&&!u))try{const o=n==="apply"?d.find(a=>a?._suggest)||null:d.find(a=>String(a?.id)===String(u))||null;if(!o)return;if(n==="del"){if(!confirm("\u524A\u9664\u3057\u307E\u3059\u3002\u3088\u308D\u3057\u3044\u3067\u3059\u304B\uFF1F"))return;await V(`/api/attendance/work-details/${encodeURIComponent(String(u))}`,{method:"DELETE",body:JSON.stringify({userId:v.currentViewingUserId||void 0})})}else if(n==="apply"){const a=String((document.querySelector("#monthPicker2")||document.querySelector("#monthPicker"))?.value||"").trim(),p=/^\d{4}-\d{2}$/.test(a)?`${a}-01`:o.startDate||"";await V("/api/attendance/work-details",{method:"POST",body:JSON.stringify({userId:v.currentViewingUserId||void 0,startDate:p||null,endDate:o.endDate||null,companyName:o.companyName||o.company_name||"",workPlaceAddress:o.workPlaceAddress||o.work_place_address||"",workContent:o.workContent||o.work_content||"",roleTitle:o.roleTitle||o.role_title||"",responsibilityLevel:o.responsibilityLevel||o.responsibility_level||""})})}else if(n==="edit"){const a=g("\u9069\u7528\u958B\u59CB\u65E5 (YYYY-MM-DD)",o.startDate||"",!1);if(a==null)return;const p=g("\u9069\u7528\u7D42\u4E86\u65E5 (YYYY-MM-DD / \u7A7A\u6B04=\u306A\u3057)",o.endDate||"",!0);if(p==null)return;const m=f("\u4F01\u696D\u540D",o.companyName||"");if(m==null)return;const S=f("\u5C31\u696D\u5148\u4F4F\u6240",o.workPlaceAddress||"");if(S==null)return;const I=f("\u696D\u52D9\u5185\u5BB9",o.workContent||"");if(I==null)return;const P=f("\u5F79\u8077",o.roleTitle||"");if(P==null)return;const F=f("\u8CAC\u4EFB\u306E\u7A0B\u5EA6",o.responsibilityLevel||"");if(F==null)return;await V(`/api/attendance/work-details/${encodeURIComponent(String(u))}`,{method:"PUT",body:JSON.stringify({userId:v.currentViewingUserId||void 0,startDate:a,endDate:p||null,companyName:m,workPlaceAddress:S,workContent:I,roleTitle:P,responsibilityLevel:F})})}const h=(document.querySelector("#monthPicker2")||document.querySelector("#monthPicker"))?.value||"";if(/^\d{4}-\d{2}$/.test(h)){const{detail:a,timesheet:p}=await rt(h,D==="employee"?null:v.currentViewingUserId||null);v.currentMonthDetail=a,v.currentMonthTimesheet=p,ct(document.querySelector("#contractTable"),a),ut(document.querySelector("#workDetailTable"),a,_),mt(document.querySelector("#monthSummaryTable")||document.querySelector("#monthSummary"),a,p),Tt(document.querySelector("#monthTable"),a,_)}}catch(o){alert(String(o?.message||"\u4FDD\u5B58\u306B\u5931\u6557\u3057\u307E\u3057\u305F"))}})})},Vt=(w,$)=>{if(!w)return;const _=Array.isArray($?.days)?$.days:[],D=[];for(const f of _){const g=Array.isArray(f.goOutRecords)?f.goOutRecords:[];for(const c of g)D.push({date:f.date,goOutTime:c.go_out_time,returnTime:c.return_time,type:c.type,reason:c.reason})}D.sort((f,g)=>{const c=new Date(f.goOutTime).getTime(),t=new Date(g.goOutTime).getTime();return c-t}),w.innerHTML="";const k=document.createElement("div");k.className="goout-history-controls",k.style.display="flex",k.style.justifyContent="flex-end",k.style.alignItems="center",k.style.marginBottom="12px",k.style.flexWrap="wrap",k.style.gap="8px";const d=document.createElement("div");d.className="goout-history-summary",d.style.fontSize="14px",d.style.fontWeight="bold",d.style.color="#1e293b",k.appendChild(d),w.appendChild(k);const i=document.createElement("div");i.style.maxHeight="500px",i.style.overflowY="auto",i.style.overflowX="auto",i.style.WebkitOverflowScrolling="touch",i.style.border="1px solid #dbe4f0",w.appendChild(i);const x=document.createElement("table");x.className="excel-table",x.style.width="100%",x.style.minWidth="400px",x.style.borderCollapse="collapse",x.style.margin="0",i.appendChild(x),(()=>{let f=D,g=0,c=0,t=0;const n=f.length?f.map((o,l)=>{const h=String(o.date||""),a=W.dowJa(h),p=K(o.goOutTime)||"\u2014",m=K(o.returnTime)||"\u2014",S=o.type||"\u2014",I=o.reason||"";let P="\u2014",F=m;if(m==="\u2014"&&(F='<span style="color: #d97706; font-weight: bold; font-size: 12px;"><span style="margin-right: 4px;">\u23F3</span>\u5916\u51FA\u4E2D</span>'),p!=="\u2014"&&m!=="\u2014"){const z=dt(p,m);z!=null&&z>0&&(P=H(z),g+=z,S==="\u696D\u52D9"?c+=z:S==="\u79C1\u7528"&&(t+=z))}return`<tr class="goout-history-row" style="background-color: #ffffff; transition: background-color 0.2s;">
          <td style="text-align: center; border: 1px solid #dbe4f0; color: #1e293b; white-space: nowrap;">${e(h.slice(5).replace("-","/"))}(${e(a)})</td>
          <td style="text-align: center; font-family: monospace, sans-serif; border: 1px solid #dbe4f0; color: #334155;">${e(p)}</td>
          <td style="text-align: center; font-family: monospace, sans-serif; border: 1px solid #dbe4f0; color: #334155;">${F}</td>
          <td style="text-align: center; font-family: monospace, sans-serif; font-weight: 500; border: 1px solid #dbe4f0; color: #334155;">${e(P)}</td>
          <td style="text-align: center; border: 1px solid #dbe4f0; white-space: nowrap;">
            <span class="goout-type-badge" style="display: inline-flex; align-items: center; justify-content: center; border-radius: 4px; font-weight: 500; background: ${S==="\u696D\u52D9"?"#e0f2fe":"#fee2e2"}; color: ${S==="\u696D\u52D9"?"#0369a1":"#b91c1c"}; border: 1px solid ${S==="\u696D\u52D9"?"#bae6fd":"#fecaca"};">
              ${e(S)}
            </span>
          </td>
          <td class="goout-col-reason" style="text-align: left; border: 1px solid #dbe4f0; color: #475569; word-break: break-word;">${e(I)}</td>
        </tr>`}).join(""):'<tr><td colspan="6" style="text-align:center; padding: 16px; color:#64748b; font-weight: 500; background: #fff; border: 1px solid #dbe4f0; font-size: 13px;">\u5916\u51FA\u5C65\u6B74\u304C\u3042\u308A\u307E\u305B\u3093</td></tr>',s="position: sticky; top: 0; z-index: 10; background: #0f2c62; color: #ffffff; text-align: center; font-weight: bold; border: 1px solid #dbe4f0; white-space: nowrap;";x.innerHTML=`
      <thead>
        <tr>
          <th style="${s}">\u65E5\u4ED8</th>
          <th style="${s}">\u5916\u51FA\u6642\u9593</th>
          <th style="${s}">\u623B\u308A\u6642\u9593</th>
          <th style="${s}">\u7D4C\u904E\u6642\u9593</th>
          <th style="${s}">\u533A\u5206</th>
          <th class="goout-col-reason" style="${s}">\u7406\u7531</th>
        </tr>
      </thead>
      <tbody>
        ${n}
      </tbody>
      `;const u=o=>{const l=Math.floor(o/60),h=o%60;return`${l}\u6642\u9593${h}\u5206`};d.innerHTML=`\u4ECA\u6708\u306E\u5408\u8A08\u5916\u51FA\u6642\u9593\uFF1A<span class="goout-summary-total" style="color:#0284c7; font-size: 16px;">${u(g)}</span> <span class="goout-summary-details" style="font-size:12px; color:#64748b; font-weight:normal; margin-left: 8px;">(\u696D\u52D9: ${u(c)} / \u79C1\u7528: ${u(t)})</span>`})()},mt=(w,$,_)=>{if(!w)return;const D=document.querySelector("#btnToggleGoOutHistory"),k=document.querySelector("#monthTable"),d=document.querySelector("#goOutHistoryTable");if(D&&k&&d){const r=D.cloneNode(!0);D.parentNode.replaceChild(r,D),r.addEventListener("click",y=>{y.preventDefault(),r.dataset.mode==="daily"?(k.style.display="none",d.style.display="block",Vt(d,$),r.dataset.mode="history",r.textContent="\u65E5\u6B21\u5B9F\u7E3E\u306B\u623B\u308B",r.style.background="#3b82f6",r.style.borderColor="#3b82f6"):(d.style.display="none",k.style.display="block",r.dataset.mode="daily",r.textContent="\u5916\u51FA\u5C65\u6B74\u3092\u8868\u793A",r.style.background="#10b981",r.style.borderColor="#10b981")})}const i=(()=>{try{const y=document.querySelector("#summarySection")?.querySelector?.(".se-tab.active[data-tab]");return String(y?.dataset?.tab||y?.getAttribute?.("data-tab")||"")||"sumAll"}catch{return"sumAll"}})(),x=Array.isArray($?.days)?$.days:[],O=r=>{const y=String(r?.daily?.location||"").toLowerCase();return y?y.includes("\u793E\u5185")||y.includes("\u5185\u52E4")||y.includes("inhouse"):!1},f=r=>(r?.segments||[]).some(y=>!!y?.checkIn),g=r=>{const y=String(r?.daily?.kubun||"").trim();return y==="\u534A\u4F11"||y==="\u534A\u4F11(\u6709\u7D66)"},c=r=>{const y=String(r?.daily?.workType||"").trim();if(y)return y;const T=Array.isArray(r?.segments)?r.segments:[];for(const C of T){const N=String(C?.workType||"").trim();if(N)return N}return""},t=i==="sumInhouse"?x.filter(O):x,n=t.filter(r=>Number(r?.is_off||0)===1).length,s=t.length?t.length-n:0,u=t.filter(r=>!f(r)&&g(r)).length,o=t.filter(f).length+u*.5,l=t.filter(r=>Number(r?.is_off||0)===1&&f(r)).length,h=Math.max(0,s-(o-l));let a=i==="sumAll"&&_?.days?_.days.reduce((r,y)=>(r.regular+=Number(y?.regularMinutes||0),r.overtime+=Number(y?.overtimeMinutes||0),r.night+=Number(y?.nightMinutes||0),r),{regular:0,overtime:0,night:0}):{regular:0,overtime:0,night:0};if(i==="sumInhouse"){const r={regular:0,overtime:0,night:0};for(const y of t){const T=Array.isArray(y?.segments)?y.segments:[];let C=0;for(const L of T){const q=K(L?.checkIn),E=K(L?.checkOut);if(!q||!E)continue;const R=dt(q,E);R!=null&&R>0&&(C+=R)}if(C<=0)continue;const N=Number(y&&y.daily&&y.daily.breakMinutes!=null?y.daily.breakMinutes:60),A=Math.max(0,C-(Number.isFinite(N)?N:60));r.regular+=Math.min(480,A),r.overtime+=Math.max(0,A-480)}a=r}const p=t.reduce((r,y)=>{if(!f(y))return r;const T=c(y);return T==="onsite"?r.onsite+=1:T==="remote"?r.remote+=1:T==="satellite"&&(r.satellite+=1),r},{onsite:0,remote:0,satellite:0}),m=i==="sumInhouse"?$?.monthSummary?.inhouse||null:$?.monthSummary?.all||null,S=$?.leaveSummary||{};let I=Number(i==="sumInhouse"?0:S?.paidDays||0),P=Number(i==="sumInhouse"?0:S?.substituteDays||0),F=Number(i==="sumInhouse"?0:S?.unpaidDays||0),z=Number(i==="sumInhouse"?0:S?.standbyDays||0),vt=0;_?.days&&_.days.forEach(r=>{(r.segments||[]).forEach(T=>{const C=T.checkIn?T.checkIn.slice(11,16):null,N=T.checkOut?T.checkOut.slice(11,16):null;if(C&&N){const A=j=>{const U=String(j).trim().split(":");return U.length===2?parseInt(U[0],10)*60+parseInt(U[1],10):0};let L=A(C),q=A(N);q<L&&(q+=1440);let E=0;const R=[[0,300],[1320,1740],[2760,3180]];for(const[j,U]of R){const B=Math.max(L,j),et=Math.min(q,U);B<et&&(E+=et-B)}const G=r.daily&&r.daily.nightBreakMinutes?`${Math.floor(r.daily.nightBreakMinutes/60)}:${r.daily.nightBreakMinutes%60}`:"0:00",M=A(G);vt+=Math.max(0,E-M)}})});let yt=Math.max(0,Number(a.regular||0)+Number(a.overtime||0)),ft=0,pt=(()=>{if(i!=="sumAll"||!Array.isArray(_?.days))return Number(a.overtime||0);const r=N=>{const A=new Date(String(N||"").slice(0,10)+"T00:00:00Z"),q=(A.getUTCDay()+6)%7,E=new Date(Date.UTC(A.getUTCFullYear(),A.getUTCMonth(),A.getUTCDate()-q)),R=E.getUTCFullYear(),G=String(E.getUTCMonth()+1).padStart(2,"0"),M=String(E.getUTCDate()).padStart(2,"0");return`${R}-${G}-${M}`};let y=0,T=0;const C={};for(const N of _.days){const A=Number(N?.regularMinutes||0)+Number(N?.overtimeMinutes||0),L=Math.max(0,A-480);y+=L;const q=r(N?.date);C[q]||(C[q]={total:0,dailyOver:0}),C[q].total+=A,C[q].dailyOver+=L}for(const N in C){const A=Math.max(0,(C[N].total||0)-2400),L=Math.max(0,A-(C[N].dailyOver||0));T+=L}return Math.max(0,y+T)})(),Q=s,X=o,Z=l,tt=h,st=p.onsite,at=p.remote,it=p.satellite,ht=!1,_t=0,Nt=0;for(const r of t)if(Array.isArray(r.goOutRecords))for(const y of r.goOutRecords){const T=dt(K(y.go_out_time),K(y.return_time));T>0&&(y.type==="\u79C1\u7528"&&(_t+=T),y.type==="\u696D\u52D9"&&(Nt+=T))}const Wt=String($?.user?.employment_type||"").toLowerCase()==="part_time"||String($?.user?.shift_id||"").includes("baito");try{const r=Array.from(document.querySelectorAll('#monthTable [data-row="1"][data-date]'));if(r.length>0){ht=!0;let y=0,T=0,C=0,N=0,A=0,L=0,q=0,E=0;for(const M of r){const j=M.classList.contains("holiday")||M.classList.contains("sun")||M.classList.contains("sat")||String(M.dataset.baseOff)==="1",U=String(M.querySelector('td[data-field="worked"]')?.textContent||"").trim(),B=String(M.querySelector('td[data-field="excess"]')?.textContent||"").trim(),et=String(M.dataset.workType||""),It=M.querySelector('select[data-field="classification"]'),nt=It?String(It.value||"").trim():"";let jt=!1;if(U&&U!=="0:00"&&U!=="\u2014"&&!M.querySelector('td[data-field="worked"]')?.classList.contains("is-auto")){const Y=U.split(":");Y.length===2&&(y+=parseInt(Y[0],10)*60+parseInt(Y[1],10),jt=!0)}if(B&&B!=="0:00"&&B!=="\u2014"&&!M.querySelector('td[data-field="excess"]')?.classList.contains("is-auto")){const Y=B.split(":");Y.length===2&&(T+=parseInt(Y[0],10)*60+parseInt(Y[1],10))}const Ct=M.querySelector('input.se-time[data-field="checkIn"]'),Ot=M.querySelector('input.se-time[data-field="checkOut"]'),qt=M.querySelector('select[data-field="nightBreak"]'),$t=String(Ct?.value||"").trim(),St=String(Ot?.value||"").trim();if($t&&St){const Y=lt=>{if(!lt)return 0;const ot=String(lt).trim().split(":");return ot.length===2?parseInt(ot[0],10)*60+parseInt(ot[1],10):0};let Pt=Y($t),Dt=Y(St);Dt<Pt&&(Dt+=1440);let Et=0;const Zt=[[0,300],[1320,1740],[2760,3180]];for(const[lt,ot]of Zt){const Ft=Math.max(Pt,lt),zt=Math.min(Dt,ot);Ft<zt&&(Et+=zt-Ft)}const te=Y(qt?qt.value:"");C+=Math.max(0,Et-te)}const Bt=String(Ct?.dataset?.auto||"")==="1",Jt=String(Ot?.dataset?.auto||"")==="1",re=!!$t&&!Bt||!!St&&!Jt,se=M.classList.contains("has-entry")||!!String(M.dataset.id||"").trim(),Kt=nt==="\u4F11\u65E5\u51FA\u52E4",Qt=nt==="\u534A\u4F11"||nt==="\u534A\u4F11(\u6709\u7D66)",Xt=nt==="\u51FA\u52E4"||nt==="\u4EE3\u66FF\u51FA\u52E4"||nt==="\u632F\u66FF\u51FA\u52E4";if(M.dataset.primary==="0")continue;if(!nt){if(!re||j)continue;N++}else if(Kt)A++;else if(Qt)N+=.5;else if(Xt)N++;else continue;const Lt=M.querySelector('input[data-field="ckOnsite"]'),Ht=M.querySelector('input[data-field="ckRemote"]'),Ut=M.querySelector('input[data-field="ckSatellite"]');Lt||Ht||Ut?Lt?.checked?L++:Ht?.checked?q++:Ut?.checked&&E++:et==="onsite"?L++:et==="remote"?q++:et==="satellite"&&E++}yt=y,a.overtime=T,pt=T,X=N,Z=A;var __dk=0,__uk=0;let R=0,G=0;for(const M of r){if(M.dataset.primary==="0")continue;const j=M.querySelector('select[data-field="classification"]'),U=j?String(j.value||"").trim():"";U==="\u4EE3\u66FF\u4F11\u65E5"&&__dk++,U==="\u7121\u7D66\u4F11\u6687"&&__uk++;U==="\u6B20\u52E4"&&R++,U==="\u6709\u7D66\u4F11\u6687"&&G++,U==="\u534A\u4F11(\u6709\u7D66)"&&(G+=.5)}tt=R>0?R:0,G>I&&(I=G),st=L,at=q,it=E}}catch{}a.night=vt,Wt&&(Q=X+tt+Number(I||0)+Number(F||0)+Z),m&&typeof m=="object"&&(Q===0&&(Q=Number(m.plannedDays==null?Q:m.plannedDays)||0),ht||(X=Number(m.attendDays==null?X:m.attendDays)||0,Z=Number(m.holidayWorkDays==null?Z:m.holidayWorkDays)||0),z=Number(m.standbyDays==null?z:m.standbyDays)||0,I=Number(m.paidDays==null?I:m.paidDays)||0,P=Number(m.substituteDays==null?P:m.substituteDays)||0,F=Number(m.unpaidDays==null?F:m.unpaidDays)||0,ft=Number(m.deductionMinutes==null?ft:m.deductionMinutes)||0,ht||(tt=Number(m.absentDays==null?tt:m.absentDays)||0,st=Number(m.onsiteDays==null?st:m.onsiteDays)||0,at=Number(m.remoteDays==null?at:m.remoteDays)||0,it=Number(m.satelliteDays==null?it:m.satelliteDays)||0));P=Math.max(Number(P)||0,Number(__dk)||0),F=Math.max(Number(F)||0,Number(__uk)||0);const At=Number.isFinite(I)?Number(I).toFixed(1):"0.0",gt=Number(S?.grantedDaysTotal||0),bt=Number($?.user?.paidLeaveGrantedTotalDays||0),wt=Number(S?.grantedDays||0),xt=Number($?.user?.paidLeaveGrantedDays||0),Gt=Number.isFinite(gt)&&gt>0?Number(gt).toFixed(1):Number.isFinite(bt)&&bt>0?Number(bt).toFixed(1):Number.isFinite(wt)&&wt>0?Number(wt).toFixed(1):Number.isFinite(xt)&&xt>0?Number(xt).toFixed(1):String($?.user?.paidLeaveEntitlement||"\u2014"),kt=document.createElement("table"),b={planned:"\u6240\u5B9A\u65E5\u6570",attend:"\u51FA\u52E4\u65E5\u6570",holiday:"\u4F11\u65E5\u51FA\u52E4\u65E5\u6570",standby:"\u5F85\u6A5F\u65E5\u6570",total:"\u7DCF\u52B4\u50CD\u6642\u9593",night:"\u6DF1\u591C\u6642\u9593",overtime:"\u7DCF\u6B8B\u696D\u6642\u9593",legal:"\u6CD5\u5B9A\u5916\u6642\u9593",paid:"\u6709\u4F11\u65E5\u6570",entitlement:"\u6709\u7D66\u4ED8\u4E0E",substitute:"\u4EE3\u4F11\u65E5\u6570",unpaid:"\u7121\u7D66\u4F11\u6687",absent:"\u6B20\u52E4\u65E5\u6570",deduction:"\u63A7\u9664\u6642\u9593",onsite:"\u51FA\u793E\u65E5\u6570",remote:"\u5728\u5B85\u65E5\u6570",satellite:"\u73FE\u5834\u65E5\u6570",workGoOut:"\u696D\u52D9\u5916\u51FA",privateGoOut:"\u79C1\u7528\u5916\u51FA"};i==="sumAll"?kt.innerHTML=`
      <thead>
        <tr>
          <th>${e(b.planned)}</th>
          <th style="background:#1d4ed8;color:#fff;">${e(b.attend)}</th>
          <th>${e(b.holiday)}</th>
          <th>\u4EE3\u66FF\u51FA\u52E4</th>
          <th>\u632F\u66FF\u51FA\u52E4</th>
          <th>\u4F11\u65E5\u65E5\u6570</th>
          <th>${e(b.standby)}</th>
          <th style="background:#1e40af;color:#fff;">${e(b.total)}</th>
          <th>${e(b.night)}</th>
          <th style="background:#ea580c;color:#fff;">${e(b.overtime)}</th>
          <th style="background:#dc2626;color:#fff;">${e(b.legal)}</th>
          <th>${e(b.paid)}</th>
          <th>\u534A\u4F11(\u6709\u7D66)</th>
          <th>\u534A\u4F11</th>
          <th>${e(b.entitlement)}</th>
          <th>${e(b.substitute)}</th>
          <th>${e(b.unpaid)}</th>
          <th>${e(b.absent)}</th>
          <th>${e(b.deduction)}</th>
          <th>${e(b.workGoOut)}</th>
          <th>${e(b.privateGoOut)}</th>
          <th>${e(b.onsite)}</th>
          <th>${e(b.remote)}</th>
          <th>${e(b.satellite)}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${e(String(Q??0))}\u65E5</td>
          <td style="background:#dbeafe;font-weight:900;color:#1d4ed8;">${e(String(X??0))}\u65E5</td>
          <td>${e(String(Z??0))}\u65E5</td>
          <td>${e((()=>{let c=0;document.querySelectorAll('#monthTable [data-row="1"][data-date] select[data-field="classification"]').forEach(x=>{String(x.value||"").trim()==="\u4EE3\u66FF\u51FA\u52E4"&&c++});return c+"\u65E5"})())}</td>
          <td>${e((()=>{let c=0;document.querySelectorAll('#monthTable [data-row="1"][data-date] select[data-field="classification"]').forEach(x=>{String(x.value||"").trim()==="\u632F\u66FF\u51FA\u52E4"&&c++});return c+"\u65E5"})())}</td>
          <td>${e((()=>{const d=new Set;document.querySelectorAll('#monthTable [data-row="1"][data-date]').forEach(r=>{const x=r.querySelector('select[data-field="classification"]'),v=x?String(x.value||"").trim():"";(v==="\u4F11\u65E5"||!v&&String(r.dataset.baseOff||"")==="1")&&d.add(r.dataset.date)});return d.size+"\u65E5"})())}</td>
          <td>${e(String(z??0))}\u65E5</td>
          <td style="background:#dbeafe;font-weight:900;color:#1e40af;">${e(H(yt))}</td>
          <td>${e(H(a.night))}</td>
          <td style="background:#fff7ed;font-weight:900;color:#ea580c;">${e(H(a.overtime))}</td>
          <td style="background:#fef2f2;font-weight:900;color:#dc2626;">${e(H(pt))}</td>
          <td>${e(String(At??0))}\u65E5</td>
          <td>${e((()=>{let c=0;document.querySelectorAll('#monthTable [data-row="1"][data-date] select[data-field="classification"]').forEach(x=>{String(x.value||"").trim()==="\u534A\u4F11(\u6709\u7D66)"&&c++});return (c*.5).toFixed(1)+"\u65E5"})())}</td>
          <td>${e((()=>{let c=0;document.querySelectorAll('#monthTable [data-row="1"][data-date] select[data-field="classification"]').forEach(x=>{String(x.value||"").trim()==="\u534A\u4F11"&&c++});return (c*.5).toFixed(1)+"\u65E5"})())}</td>
          <td>${e(String(Gt??0))}\u65E5</td>
          <td>${e(String(P??0))}\u65E5</td>
          <td>${e(String(F??0))}\u65E5</td>
          <td>${e(String(tt??0))}\u65E5</td>
          <td>${e(H(ft))}</td>
          <td>${e(H(Nt))}</td>
          <td>${e(H(_t))}</td>
          <td>${e(String(st??0))}\u65E5</td>
          <td>${e(String(at??0))}\u65E5</td>
          <td>${e(String(it??0))}\u65E5</td>
        </tr>
      </tbody>
    `:kt.innerHTML=`
      <thead>
        <tr>
          <th>${e(b.planned)}</th>
          <th style="background:#1d4ed8;color:#fff;">${e(b.attend)}</th>
          <th>${e(b.holiday)}</th>
          <th>${e(b.standby)}</th>
          <th style="background:#1e40af;color:#fff;">${e(b.total)}</th>
          <th>${e(b.night)}</th>
          <th style="background:#ea580c;color:#fff;">${e(b.overtime)}</th>
          <th style="background:#dc2626;color:#fff;">${e(b.legal)}</th>
          <th>${e(b.paid)}</th>
          <th>${e(b.substitute)}</th>
          <th>${e(b.unpaid)}</th>
          <th>${e(b.absent)}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${e(String(Q??0))}\u65E5</td>
          <td style="background:#dbeafe;font-weight:900;color:#1d4ed8;">${e(String(X??0))}\u65E5</td>
          <td>${e(String(Z??0))}\u65E5</td>
          <td>${e(String(z??0))}\u65E5</td>
          <td style="background:#dbeafe;font-weight:900;color:#1e40af;">${e(H(yt))}</td>
          <td>${e(H(a.night))}</td>
          <td style="background:#fff7ed;font-weight:900;color:#ea580c;">${e(H(a.overtime))}</td>
          <td style="background:#fef2f2;font-weight:900;color:#dc2626;">${e(H(pt))}</td>
          <td>${e(String(At??0))}\u65E5</td>
          <td>${e(String(P??0))}\u65E5</td>
          <td>${e(String(F??0))}\u65E5</td>
          <td>${e(String(tt??0))}\u65E5</td>
        </tr>
      </tbody>
    `,w.innerHTML="",w.appendChild(kt)},Mt={renderContract:ct,renderWorkDetail:ut,renderSummary:mt,renderPlan:(w,$,_)=>{if(!w)return;const D=Array.isArray($?.days)?$.days:[],k=document.createElement("table");k.innerHTML=`
    <thead>
      <tr>
        <th>\u65E5\u4ED8</th>
        <th>\u52E4\u52D9\u533A\u5206</th>
        <th>\u4F01\u696D\u540D</th>
        <th>\u958B\u59CB\u6642\u523B</th>
        <th>\u7D42\u4E86\u6642\u523B</th>
        <th>\u4F11\u61A9\u6642\u9593</th>
        <th>\u6DF1\u591C\u4F11\u61A9</th>
        <th>\u52E4\u52D9\u6642\u9593</th>
        <th>\u52E4\u52D9\u5F62\u614B</th>
      </tr>
    </thead>
    <tbody>
      ${D.map(d=>{const i=String(d?.date||""),x=W.dowJa(i),O=Number(d?.is_off||0)===1,f=d?.plan||null,g=d?.shift||null,c=O?"\u4F11\u65E5":"\u51FA\u52E4",t=f?.location||"",n=f?.startTime||g?.start_time||"",s=f?.endTime||g?.end_time||"",u=f?.breakMinutes!=null?f.breakMinutes:g?.break_minutes||0,o=f?.nightBreakMinutes||0,l=f?.workType||(O?"":"\u5951\u7D04\u306A\u3057");let h=0;if(n&&s){const a=W.parseHm(n),p=W.parseHm(s);if(a!=null&&p!=null){const m=p>=a?p-a:p+1440-a;h=Math.max(0,m-u-o)}}return`<tr class="${O?"off":""}">
            <td>${e(i.slice(5).replace("-","/"))}(${e(x)})</td>
            <td>${e(c)}</td>
            <td><input type="text" class="se-input plan-input" data-date="${i}" data-field="location" value="${e(t)}"></td>
            <td><input type="time" class="se-input plan-input" data-date="${i}" data-field="startTime" value="${e(n)}"></td>
            <td><input type="time" class="se-input plan-input" data-date="${i}" data-field="endTime" value="${e(s)}"></td>
            <td>
              <select class="se-select plan-input" data-date="${i}" data-field="breakMinutes">
                <option value="180" ${u===180?"selected":""}>3:00</option>
                <option value="150" ${u===150?"selected":""}>2:30</option>
                <option value="120" ${u===120?"selected":""}>2:00</option>
                <option value="90" ${u===90?"selected":""}>1:30</option>
                <option value="60" ${u===60?"selected":""}>1:00</option>
                <option value="45" ${u===45?"selected":""}>0:45</option>
                <option value="30" ${u===30?"selected":""}>0:30</option>
                <option value="0" ${u===0?"selected":""}>0:00</option>
              </select>
            </td>
            <td>0:00</td>
            <td>${e(W.fmtHm(h))}</td>
            <td><input type="text" class="se-input plan-input" data-date="${i}" data-field="workType" value="${e(l)}"></td>
          </tr>`}).join("")}
    </tbody>
    `,w.innerHTML="",w.appendChild(k),w.querySelectorAll(".plan-input").forEach(d=>{d.addEventListener("change",async i=>{const x=d.dataset.date,O=d.dataset.field,f=d.value,g=d.closest("tr"),c=D.find(t=>t.date===x)?.plan||{};c[O]=O==="breakMinutes"?parseInt(f,10):f;try{await V("/api/attendance/plan",{method:"PUT",body:JSON.stringify({date:x,plan:c})});const t=g.querySelector('[data-field="startTime"]').value,n=g.querySelector('[data-field="endTime"]').value,s=parseInt(g.querySelector('[data-field="breakMinutes"]').value,10);if(t&&n){const u=W.parseHm(t),o=W.parseHm(n),l=o>=u?o-u:o+1440-u,h=Math.max(0,l-s);g.children[7].textContent=W.fmtHm(h)}}catch(t){console.error("Plan save failed:",t)}})})},renderYearSummary:async(w,$={})=>{if(!w)return;const _=$.userId||v.currentViewingUserId||null,D=$.month||"",k=D?parseInt(String(D).slice(0,4),10):new Date(Date.now()+9*3600*1e3).getFullYear();w.innerHTML='<div style="text-align:center;padding:16px;color:#64748b;">\u8AAD\u8FBC\u4E2D...</div>';try{const d=_?`&userId=${encodeURIComponent(_)}`:"",i=await V(`/api/attendance/annual-summary?year=${k}${d}`);if(!i){w.innerHTML='<div style="text-align:center;padding:16px;color:#94a3b8;">\u30C7\u30FC\u30BF\u306A\u3057</div>';return}const x=i.annualOvertime||{},O=i.monthsOver45h||{},f=Array.isArray(i.recentMonths)?i.recentMonths:[],g=i.paidLeave||{},c=i.singleMonthMax||{},t="#dc2626",n="#1e293b",s=x.exceeds?t:n,u=O.exceeds?t:n,o=c.exceeds100h?t:n,l=S=>S?S.replace("-","/")+"\uFF5E":"",h=[...f].reverse(),a=h.map(S=>`<th style="padding:4px 10px;font-size:11px;font-weight:600;white-space:nowrap;border:1px solid #dbe4f0;background:#f1f5f9;">${l(S.month)}</th>`).join(""),p=h.map(S=>`<td style="padding:6px 10px;text-align:center;font-weight:700;font-size:13px;border:1px solid #dbe4f0;">${S.formatted||"0:00"}</td>`).join(""),m=g.grantDate?`\u6700\u7D42\u4ED8\u4E0E\u65E5\uFF1A${g.grantDate}`:"\u6700\u7D42\u4ED8\u4E0E\u65E5\uFF1A.....";w.innerHTML=`
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;border:1px solid #dbe4f0;font-size:13px;background:#fff;">
            <thead>
              <tr style="background:#f8fafc;">
                <th colspan="2" style="padding:6px 12px;text-align:center;border:1px solid #dbe4f0;font-weight:700;font-size:12px;">\u5E74\u9593\u8D85\u904E\u6642\u9593</th>
                <th style="padding:6px 12px;text-align:center;border:1px solid #dbe4f0;font-weight:700;font-size:12px;">45\u6642\u9593\u8D85\u904E\u56DE\u6570</th>
                <th colspan="${h.length}" style="padding:6px 12px;text-align:center;border:1px solid #dbe4f0;font-weight:700;font-size:12px;">\u76F4\u8FD1\u8907\u6570\u6708\u5E73\u5747\u6CD5\u5B9A\u5916\u52B4\u50CD\u6642\u9593</th>
                <th colspan="3" style="padding:6px 12px;text-align:center;border:1px solid #dbe4f0;font-weight:700;font-size:12px;">\u6709\u7D66\u4F11\u6687</th>
              </tr>
              <tr style="background:#f1f5f9;">
                <th style="padding:4px 8px;font-size:11px;border:1px solid #dbe4f0;">\u5B9F\u7E3E/\u4E0A\u9650</th>
                <th style="padding:4px 8px;font-size:11px;border:1px solid #dbe4f0;">\u5358\u6708\u6700\u5927</th>
                <th style="padding:4px 8px;font-size:11px;border:1px solid #dbe4f0;">\u56DE\u6570/\u4E0A\u9650</th>
                ${a}
                <th style="padding:4px 8px;font-size:11px;border:1px solid #dbe4f0;white-space:nowrap;">(${m})</th>
                <th style="padding:4px 8px;font-size:11px;border:1px solid #dbe4f0;">\u6700\u7D42\u4ED8\u4E0E\u304B\u3089\u306E\u53D6\u5F97</th>
                <th style="padding:4px 8px;font-size:11px;border:1px solid #dbe4f0;">\u6B8B\u65E5\u6570</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="padding:8px 12px;text-align:center;font-weight:700;font-size:14px;border:1px solid #dbe4f0;color:${s};">
                  ${x.totalFormatted||"0:00"}/${x.limitFormatted||"720:00"}
                </td>
                <td style="padding:8px 12px;text-align:center;font-weight:700;font-size:14px;border:1px solid #dbe4f0;color:${o};">
                  ${c.maxFormatted||"0:00"}
                </td>
                <td style="padding:8px 12px;text-align:center;font-weight:700;font-size:14px;border:1px solid #dbe4f0;color:${u};">
                  ${O.count||0}\u56DE/${O.limit||6}\u56DE
                </td>
                ${p}
                <td style="padding:8px 12px;text-align:center;font-weight:700;font-size:14px;border:1px solid #dbe4f0;">
                  ${g.totalGranted!=null?Number(g.totalGranted).toFixed(1)+"\u65E5":"\u2014"}
                </td>
                <td style="padding:8px 12px;text-align:center;font-weight:700;font-size:14px;border:1px solid #dbe4f0;">
                  ${g.usedSinceGrant!=null?Number(g.usedSinceGrant).toFixed(1)+"\u65E5":"0.0\u65E5"}
                </td>
                <td style="padding:8px 12px;text-align:center;font-weight:700;font-size:14px;border:1px solid #dbe4f0;">
                  ${g.remaining!=null?Number(g.remaining).toFixed(0)+"\u65E5":"0\u65E5"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div style="margin-top:6px;font-size:11px;color:#64748b;">
          \u203B 36\u5354\u5B9A\u4E0A\u9650: \u5E74\u9593720\u6642\u9593 / \u670845\u6642\u9593\u8D85\u904E\u306F\u5E746\u56DE\u307E\u3067 / \u5358\u6708100\u6642\u9593\u672A\u6E80 / \u8907\u6570\u6708\u5E73\u574780\u6642\u9593\u4EE5\u5185
        </div>
      `}catch(d){w.innerHTML=`<div style="text-align:center;padding:16px;color:#ef4444;">\u5E74\u9593\u30B5\u30DE\u30EA\u306E\u8AAD\u8FBC\u306B\u5931\u6557\u3057\u307E\u3057\u305F (${d?.message||d})</div>`,console.error("[\u5E74\u9593\u30B5\u30DE\u30EA]",d)}}};J.SectionsRender=Mt,globalThis.AttendanceMonthly=J,globalThis.MonthlyMonthlySectionsRender=Mt})();
