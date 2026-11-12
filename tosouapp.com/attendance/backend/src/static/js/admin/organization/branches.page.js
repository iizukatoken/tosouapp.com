import{fetchJSONAuth as o}from"../../api/http.api.js";async function u(h={}){const g=h&&h.content||document.querySelector("#adminContent");if(!g)return;g.innerHTML=`
    <div class="ui-c branch-page" style="max-width:900px;">
      <div class="ui-ph">
        <h2 class="branch-title">\u652F\u5E97\u7BA1\u7406</h2>
      </div>
      <div class="ui-panel">
        <div class="ui-ptitle">\u65B0\u898F\u4F5C\u6210</div>
        <div class="ui-filters branch-new">
          <div class="ui-f"><label for="branchNewName">\u652F\u5E97\u540D</label><input id="branchNewName" type="text" class="ui-inp" placeholder="\u4F8B: \u6771\u4EAC\u652F\u5E97" style="width:200px;"></div>
          <div class="ui-f"><label for="branchNewCode">\u30B3\u30FC\u30C9\uFF08\u4EFB\u610F\uFF09</label><input id="branchNewCode" type="text" class="ui-inp" style="width:110px;"></div>
          <button id="btnCreateBranch" type="button" class="ui-btn primary">\u4F5C\u6210</button>
        </div>
      </div>
      <div class="ui-panel">
        <div class="ui-ptitle">\u652F\u5E97\u4E00\u89A7</div>
        <div id="branchTableWrap" class="branch-table-wrap ui-tablewrap">
          <table class="branch-table" style="width:100%;table-layout:fixed;">
            <colgroup>
              <col style="width:44px;"><col style="width:90px;"><col style="width:200px;"><col style="width:70px;"><col style="width:180px;"><col style="width:130px;">
            </colgroup>
            <thead>
              <tr><th>ID</th><th>\u30B3\u30FC\u30C9</th><th>\u540D\u524D</th><th>\u793E\u54E1\u6570</th><th>\u7BA1\u7406\u8005</th><th>\u64CD\u4F5C</th></tr>
            </thead>
            <tbody id="branchTableBody">
              <tr><td colspan="6" style="text-align:center;color:#94a3b8;">\u8AAD\u307F\u8FBC\u307F\u4E2D...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;function p(t){return String(t||"").replace(/[<>&"']/g,d=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;"})[d])}async function c(){const t=document.getElementById("branchTableBody");try{const d=await o("/api/branches"),r=d?.data||d||[];if(!r.length){t.innerHTML='<tr><td colspan="6" style="text-align:center;padding:24px;color:#94a3b8;">\u652F\u5E97\u304C\u307E\u3060\u767B\u9332\u3055\u308C\u3066\u3044\u307E\u305B\u3093</td></tr>';return}t.innerHTML=r.map(e=>`
        <tr class="branch-row" style="border-bottom:1px solid #f1f5f9;">
          <td data-label="ID" style="padding:6px 10px;">${e.id}</td>
          <td data-label="\u30B3\u30FC\u30C9" style="padding:6px 10px;overflow:hidden;"><input data-id="${e.id}" data-field="code" value="${p(e.code||"")}" style="width:100%;height:28px;border:1px solid #e2e8f0;border-radius:4px;padding:0 6px;font-size:12px;box-sizing:border-box;"></td>
          <td data-label="\u540D\u524D" style="padding:6px 10px;overflow:hidden;"><input data-id="${e.id}" data-field="name" value="${p(e.name)}" style="width:100%;height:28px;border:1px solid #e2e8f0;border-radius:4px;padding:0 6px;font-size:13px;box-sizing:border-box;"></td>
          <td data-label="\u793E\u54E1\u6570" style="padding:6px 10px;">${e.employeeCount||0}\u4EBA</td>
          <td data-label="\u7BA1\u7406\u8005" style="padding:6px 10px;overflow:hidden;">
            <select data-id="${e.id}" data-field="manager" style="width:100%;height:28px;border:1px solid #e2e8f0;border-radius:4px;font-size:11px;padding:0 2px;box-sizing:border-box;overflow:hidden;text-overflow:ellipsis;">
              <option value="">\u672A\u8A2D\u5B9A</option>
            </select>
          </td>
          <td data-label="\u64CD\u4F5C" style="padding:6px 10px;white-space:nowrap;">
            <button data-save="${e.id}" style="padding:2px 10px;background:#2563eb;color:#fff;border:none;border-radius:4px;font-size:12px;cursor:pointer;margin-right:4px;">\u4FDD\u5B58</button>
            <button data-delete="${e.id}" style="padding:2px 10px;background:#fff;color:#dc2626;border:1px solid #fca5a5;border-radius:4px;font-size:12px;cursor:pointer;">\u524A\u9664</button>
          </td>
        </tr>
      `).join("");try{const e=await o("/api/admin/users?role=manager"),a=await o("/api/admin/users?role=admin"),x=[...e?.rows||e||[],...a?.rows||a||[]];t.querySelectorAll('select[data-field="manager"]').forEach(i=>{const b=i.dataset.id,l=r.find(n=>String(n.id)===b);x.forEach(n=>{const s=document.createElement("option");s.value=n.id,s.textContent=n.username||n.email,l&&String(l.manager_user_id)===String(n.id)&&(s.selected=!0),i.appendChild(s)})})}catch{}t.querySelectorAll("[data-save]").forEach(e=>{e.addEventListener("click",async()=>{const a=e.dataset.save,x=t.querySelector(`input[data-id="${a}"][data-field="name"]`)?.value,i=t.querySelector(`input[data-id="${a}"][data-field="code"]`)?.value,b=t.querySelector(`select[data-id="${a}"][data-field="manager"]`)?.value||null;try{await o(`/api/branches/${a}`,{method:"PATCH",body:JSON.stringify({name:x,code:i,managerUserId:b||null})}),e.textContent="\u2713",setTimeout(()=>{e.textContent="\u4FDD\u5B58"},1e3)}catch(l){alert("\u4FDD\u5B58\u5931\u6557: "+l.message)}})}),t.querySelectorAll("[data-delete]").forEach(e=>{e.addEventListener("click",async()=>{if(confirm("\u3053\u306E\u652F\u5E97\u3092\u524A\u9664\u3057\u307E\u3059\u304B\uFF1F\u6240\u5C5E\u793E\u54E1\u306E\u652F\u5E97\u8A2D\u5B9A\u304C\u89E3\u9664\u3055\u308C\u307E\u3059\u3002"))try{await o(`/api/branches/${e.dataset.delete}`,{method:"DELETE"}),await c()}catch(a){alert("\u524A\u9664\u5931\u6557: "+a.message)}})})}catch(d){t.innerHTML=`<tr><td colspan="6" style="text-align:center;padding:24px;color:#ef4444;">\u30A8\u30E9\u30FC: ${p(d.message)}</td></tr>`}}document.getElementById("btnCreateBranch")?.addEventListener("click",async()=>{const t=document.getElementById("branchNewName")?.value?.trim(),d=document.getElementById("branchNewCode")?.value?.trim();if(!t){alert("\u652F\u5E97\u540D\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044");return}try{await o("/api/branches",{method:"POST",body:JSON.stringify({name:t,code:d})}),document.getElementById("branchNewName").value="",document.getElementById("branchNewCode").value="",await c()}catch(r){alert("\u4F5C\u6210\u5931\u6557: "+r.message)}}),await c()}export{u as mount};
