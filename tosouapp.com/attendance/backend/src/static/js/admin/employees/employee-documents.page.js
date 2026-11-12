import { requireAdmin } from '../_shared/require-admin.js';
import { fetchJSONAuth, fetchResponseAuth } from '../../api/http.api.js';

async function viewWithAuth(url) {
  // Mở tab trống NGAY (đồng bộ, trong cùng click handler) để trình duyệt
  // không chặn popup — rồi mới điều hướng nó sau khi tải xong file.
  const newTab = window.open('', '_blank');
  try {
    const res = await fetchResponseAuth(url);
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try { message = (await res.json()).message || message; } catch { /* ignore */ }
      throw new Error(message);
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    if (newTab) {
      newTab.location.href = objectUrl;
    } else {
      // Popup bị chặn — fallback: mở ngay trong tab hiện tại.
      window.location.href = objectUrl;
    }
  } catch (err) {
    if (newTab) newTab.close();
    throw err;
  }
}

async function downloadWithAuth(url, fallbackName) {
  const res = await fetchResponseAuth(url);
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try { message = (await res.json()).message || message; } catch { /* ignore */ }
    throw new Error(message);
  }
  let filename = fallbackName || 'download';
  const disposition = res.headers.get('content-disposition');
  if (disposition) {
    const utf8Match = /filename\*=UTF-8''([^;\n]*)/i.exec(disposition);
    if (utf8Match && utf8Match[1]) {
      filename = decodeURIComponent(utf8Match[1]);
    } else {
      const plainMatch = /filename[^;=\n]*=(['"]?)([^;\n]*)\1/.exec(disposition);
      if (plainMatch && plainMatch[2]) filename = plainMatch[2];
    }
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  a.click();
  setTimeout(() => { try { URL.revokeObjectURL(objectUrl); } catch { /* ignore */ } }, 1000);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

function formatDate(value) {
  const s = String(value || '');
  return s.length >= 10 ? s.slice(0, 10) : (s || '—');
}

function formatSize(bytes) {
  const n = Number(bytes || 0);
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

async function loadDocuments(userId) {
  const res = await fetchJSONAuth(`/api/employee/documents?userId=${encodeURIComponent(userId)}&pageSize=100`);
  return (res && Array.isArray(res.data)) ? res.data : [];
}

function renderList(listEl, docs, onDelete, onView, onDownload) {
  if (!docs.length) {
    listEl.innerHTML = '<div style="padding:16px;color:#6a6d70;">まだ書類がありません。</div>';
    return;
  }
  listEl.innerHTML = `
    <table class="excel-table" style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="background:#fafbfc;">
          <th style="text-align:left;padding:8px 12px;border:1px solid #edeff0;">種類</th>
          <th style="text-align:left;padding:8px 12px;border:1px solid #edeff0;">タイトル</th>
          <th style="text-align:left;padding:8px 12px;border:1px solid #edeff0;">サイズ</th>
          <th style="text-align:left;padding:8px 12px;border:1px solid #edeff0;">登録日</th>
          <th style="text-align:left;padding:8px 12px;border:1px solid #edeff0;"></th>
        </tr>
      </thead>
      <tbody>
        ${docs.map((d) => `
          <tr data-id="${d.id}">
            <td style="padding:8px 12px;border:1px solid #edeff0;">${escapeHtml(d.type)}</td>
            <td style="padding:8px 12px;border:1px solid #edeff0;">${escapeHtml(d.title || d.filename)}</td>
            <td style="padding:8px 12px;border:1px solid #edeff0;">${formatSize(d.size)}</td>
            <td style="padding:8px 12px;border:1px solid #edeff0;">${formatDate(d.createdAt)}</td>
            <td style="padding:8px 12px;border:1px solid #edeff0;white-space:nowrap;">
              <button type="button" class="btn-doc-view" data-id="${d.id}" style="border:none;background:none;color:#0b2c66;font-weight:700;text-decoration:underline;cursor:pointer;padding:0;margin-right:14px;">表示</button>
              <button type="button" class="btn-doc-dl" data-id="${d.id}" style="border:none;background:none;color:#0b2c66;font-weight:700;text-decoration:underline;cursor:pointer;padding:0;margin-right:14px;">ダウンロード</button>
              <button type="button" class="btn-doc-delete" data-id="${d.id}" style="border:1px solid #fecaca;background:#fff1f2;color:#b91c1c;border-radius:6px;padding:4px 10px;cursor:pointer;font-weight:700;">削除</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  listEl.querySelectorAll('.btn-doc-delete').forEach((btn) => {
    btn.addEventListener('click', () => onDelete(btn.getAttribute('data-id')));
  });
  listEl.querySelectorAll('.btn-doc-view').forEach((btn) => {
    btn.addEventListener('click', () => onView(btn.getAttribute('data-id')));
  });
  listEl.querySelectorAll('.btn-doc-dl').forEach((btn) => {
    btn.addEventListener('click', () => onDownload(btn.getAttribute('data-id')));
  });
}

async function mount({ content }) {
  const profile = await requireAdmin();
  if (!profile) return;

  const container = content || document.querySelector('#adminContent');
  if (!container) return;

  const params = new URLSearchParams(window.location.search);
  const userId = params.get('userId');
  const userName = params.get('name') || `従業員 #${userId}`;

  if (!userId) {
    container.innerHTML = '<div class="ui-c"><div class="ui-ph"><h2>書類</h2></div><div class="ui-note">社員が選ばれていません。社員管理から開いてください。</div></div>';
    return;
  }

  container.className = 'card wide';
  // 画面の見た目は 勤怠記録 と同じ共通UI（/static/css/admin-ui.css の .ui-c）
  container.innerHTML = `
    <div class="ui-c">
      <div class="ui-ph">
        <h2>${escapeHtml(userName)} — 書類</h2>
        <span class="ui-sp"></span>
        <a href="/admin/employees?detail=${encodeURIComponent(userId)}" class="ui-btn" style="text-decoration:none;">&larr; 従業員詳細へ戻る</a>
      </div>
      <div class="ui-panel">
        <div class="ui-ptitle">書類のアップロード</div>
        <form id="docUploadForm" class="ui-filters">
          <div class="ui-f"><label for="docType">種類 *</label><input type="text" id="docType" class="ui-inp" placeholder="例: 契約書, 身分証" required style="min-width:160px;"></div>
          <div class="ui-f"><label for="docTitle">タイトル</label><input type="text" id="docTitle" class="ui-inp" placeholder="任意" style="min-width:200px;"></div>
          <div class="ui-f"><label for="docFile">ファイル（画像 / PDF, 10MBまで）*</label><input type="file" id="docFile" accept="image/*,application/pdf" required style="font-size:12px;"></div>
          <button type="submit" id="btnDocUpload" class="ui-btn primary">アップロード</button>
        </form>
        <div id="docUploadStatus" style="padding:0 10px;font-weight:700;"></div>
      </div>
      <div class="ui-panel">
        <div class="ui-ptitle">書類一覧</div>
        <div id="docList" style="padding:0;"></div>
      </div>
    </div>
  `;

  const listEl = container.querySelector('#docList');
  const statusEl = container.querySelector('#docUploadStatus');
  let currentDocs = [];

  const refresh = async () => {
    listEl.innerHTML = '<div style="padding:16px;color:#6a6d70;">読み込み中...</div>';
    try {
      currentDocs = await loadDocuments(userId);
      renderList(listEl, currentDocs, handleDelete, handleView, handleDownload);
    } catch (err) {
      listEl.innerHTML = `<div style="padding:16px;color:#b91c1c;">読み込み失敗: ${escapeHtml(err?.message || 'unknown')}</div>`;
    }
  };

  const handleView = async (id) => {
    try {
      await viewWithAuth(`/api/employee/documents/${encodeURIComponent(id)}/download`);
    } catch (err) {
      window.alert(String(err?.message || '表示に失敗しました'));
    }
  };

  const handleDownload = async (id) => {
    const doc = currentDocs.find((d) => String(d.id) === String(id));
    try {
      await downloadWithAuth(`/api/employee/documents/${encodeURIComponent(id)}/download`, doc?.title || doc?.filename);
    } catch (err) {
      window.alert(String(err?.message || 'ダウンロードに失敗しました'));
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('この書類を削除しますか？')) return;
    try {
      await fetchJSONAuth(`/api/employee/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await refresh();
    } catch (err) {
      window.alert(String(err?.message || '削除に失敗しました'));
    }
  };

  container.querySelector('#docUploadForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const type = container.querySelector('#docType').value.trim();
    const title = container.querySelector('#docTitle').value.trim();
    const fileInput = container.querySelector('#docFile');
    const file = fileInput.files && fileInput.files[0];
    if (!type || !file) {
      statusEl.style.color = '#b91c1c';
      statusEl.textContent = '種類とファイルは必須です。';
      return;
    }
    const btn = container.querySelector('#btnDocUpload');
    btn.disabled = true;
    statusEl.style.color = '#0b2c66';
    statusEl.textContent = 'アップロード中...';
    try {
      const formData = new FormData();
      formData.append('userId', userId);
      formData.append('type', type);
      if (title) formData.append('title', title);
      formData.append('file', file);
      await fetchJSONAuth('/api/employee/documents', { method: 'POST', body: formData });
      statusEl.style.color = '#166534';
      statusEl.textContent = 'アップロード完了';
      container.querySelector('#docUploadForm').reset();
      await refresh();
    } catch (err) {
      statusEl.style.color = '#b91c1c';
      statusEl.textContent = String(err?.message || 'アップロードに失敗しました');
    } finally {
      btn.disabled = false;
    }
  });

  await refresh();
}

export { mount };
