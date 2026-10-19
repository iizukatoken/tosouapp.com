'use strict';
(function () {
  async function downloadPDF() {
    const btn = document.getElementById('btnDownload');
    const noPrint = document.querySelector('.no-print');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = '生成中...';
    try {
      noPrint && (noPrint.style.visibility = 'hidden');

      // 用紙部分 (.sheet) だけを PDF にする (画面の灰色の背景・影は入れない)
      const sheet = document.querySelector('.sheet') || document.body;
      const prevShadow = sheet.style.boxShadow;
      sheet.style.boxShadow = 'none';
      const canvas = await window.html2canvas(sheet, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        windowWidth: document.body.scrollWidth,
        windowHeight: document.body.scrollHeight
      });
      sheet.style.boxShadow = prevShadow;

      noPrint && (noPrint.style.visibility = '');

      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();   // 210mm
      const pageH = pdf.internal.pageSize.getHeight();  // 297mm
      const margin = 15;
      const contentW = pageW - 2 * margin;              // 180mm
      const ratio = canvas.height / canvas.width;
      const imgH = ratio * contentW;

      if (imgH <= pageH - 2 * margin) {
        // Single page
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', margin, margin, contentW, imgH);
      } else {
        // Multi-page: slice canvas per page
        const usableH = pageH - 2 * margin;
        const pxPerMm = canvas.width / contentW;
        const sliceH = Math.ceil(usableH * pxPerMm);
        let offsetPx = 0;
        let page = 0;
        while (offsetPx < canvas.height) {
          if (page > 0) pdf.addPage();
          const h = Math.min(sliceH, canvas.height - offsetPx);
          const slice = document.createElement('canvas');
          slice.width = canvas.width;
          slice.height = h;
          slice.getContext('2d').drawImage(canvas, 0, offsetPx, canvas.width, h, 0, 0, canvas.width, h);
          const sliceImgH = (h / pxPerMm);
          pdf.addImage(slice.toDataURL('image/jpeg', 0.95), 'JPEG', margin, margin, contentW, sliceImgH);
          offsetPx += h;
          page++;
        }
      }

      const meta = document.getElementById('printMeta');
      const month = meta ? meta.dataset.month : '';
      const user = meta ? meta.dataset.user : '';
      pdf.save(`交通費精算書_${user}_${month}.pdf`);

    } catch (err) {
      noPrint && (noPrint.style.visibility = '');
      alert('PDF生成に失敗しました: ' + err.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '⬇ PDFダウンロード';
      }
    }
  }

  function doPrint() {
    try { window.focus(); window.print(); } catch (e) { /* ignore */ }
  }

  window.addEventListener('DOMContentLoaded', function () {
    document.getElementById('btnDownload')?.addEventListener('click', downloadPDF);
    document.getElementById('btnPrint')?.addEventListener('click', doPrint);
  });
})();
