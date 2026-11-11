import{fetchJSONAuth as i}from"../../api/http.api.js";async function a({content:t}){const e=await i("/api/admin/audit");t.innerHTML="<h3>\u76E3\u67FB\u30ED\u30B0</h3>";const n=document.createElement("pre");n.textContent=JSON.stringify(e,null,2),t.appendChild(n)}export{a as mountAudit};

