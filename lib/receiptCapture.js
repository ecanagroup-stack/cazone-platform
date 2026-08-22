'use client';

// Captures the actual on-screen receipt (styled HTML/CSS — fonts, spacing, colors, logo, everything)
// as an image via html2canvas, so the shared file looks exactly like what's rendered on screen. This
// trades a larger file size for looking right, which is the tradeoff that's actually wanted here —
// stays in sync with the on-screen layout automatically, since it's a capture of that same DOM rather
// than a hand-maintained parallel drawing routine. html2canvas/jsPDF are dynamically imported so they
// only load once a share button is actually clicked.

const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;
const MARGIN_PT = 24;

async function captureElement(elementId) {
  const html2canvas = (await import('html2canvas')).default;
  const el = document.getElementById(elementId);
  if (!el) throw new Error('Nothing to export');

  // On a phone, .receipt-page is shown zoomed out to fit the screen (see globals.css) — capture at
  // its true, un-zoomed size regardless, so a share triggered from a phone isn't lower-resolution
  // than one triggered from a desktop.
  const wrapper = el.closest('.receipt-page');
  const prevZoom = wrapper?.style.zoom;
  if (wrapper) wrapper.style.zoom = '1';
  try {
    // useCORS: the org logo is served from Vercel Blob — a different origin than the app — so without
    // this, html2canvas silently fails to draw it instead of just omitting it.
    return await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
  } finally {
    if (wrapper) wrapper.style.zoom = prevZoom || '';
  }
}

// Fits imgW/imgH within maxW/maxH, preserving aspect ratio, never cropped or stretched — shared by
// both the PDF and JPG outputs so they lay the captured receipt out identically on an A4-shaped page.
function fitWithin(imgW, imgH, maxW, maxH) {
  let w = maxW;
  let h = w * (imgH / imgW);
  if (h > maxH) {
    h = maxH;
    w = h * (imgW / imgH);
  }
  return { w, h };
}

async function shareOrDownload(file, filename, title, saveFallback) {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: title || filename });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return; // user closed the share sheet — not a failure
    }
  }
  saveFallback();
}

export async function shareReceiptAsPdf(elementId, filename, title, options = {}) {
  const { orientation = 'portrait' } = options;
  const canvas = await captureElement(elementId);
  const { jsPDF } = await import('jspdf');
  const imgData = canvas.toDataURL('image/png');

  // A real A4 page, not a page shaped like the captured div — the captured image is scaled to fit
  // within it and placed at the top, margined like an actual document instead of a tall, narrow
  // "mobile" strip. Landscape swaps which dimension is "width" vs "height" (e.g. wide tables).
  const pageW = orientation === 'landscape' ? A4_HEIGHT_PT : A4_WIDTH_PT;
  const pageH = orientation === 'landscape' ? A4_WIDTH_PT : A4_HEIGHT_PT;
  const pdf = new jsPDF({ orientation, unit: 'pt', format: 'a4' });
  const maxW = pageW - MARGIN_PT * 2;
  const maxH = pageH - MARGIN_PT * 2;
  const { w, h } = fitWithin(canvas.width, canvas.height, maxW, maxH);
  const x = (pageW - w) / 2;

  pdf.addImage(imgData, 'PNG', x, MARGIN_PT, w, h);

  const blob = pdf.output('blob');
  const file = new File([blob], filename, { type: 'application/pdf' });
  await shareOrDownload(file, filename, title, () => pdf.save(filename));
}

export async function shareReceiptAsJpg(elementId, filename, title, options = {}) {
  const { orientation = 'portrait' } = options;
  const canvas = await captureElement(elementId);

  // Mirrors the PDF exactly: a full A4-shaped page (white background), the captured receipt fit
  // within the same margin, at the same position — just rasterized as one JPEG instead of a PDF page.
  const dpi = 150;
  const ptToPx = dpi / 72;
  const pageWpt = orientation === 'landscape' ? A4_HEIGHT_PT : A4_WIDTH_PT;
  const pageHpt = orientation === 'landscape' ? A4_WIDTH_PT : A4_HEIGHT_PT;
  const pageCanvas = document.createElement('canvas');
  pageCanvas.width = Math.round(pageWpt * ptToPx);
  pageCanvas.height = Math.round(pageHpt * ptToPx);
  const pageCtx = pageCanvas.getContext('2d');
  pageCtx.fillStyle = '#ffffff';
  pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);

  const marginPx = MARGIN_PT * ptToPx;
  const maxW = pageCanvas.width - marginPx * 2;
  const maxH = pageCanvas.height - marginPx * 2;
  const { w, h } = fitWithin(canvas.width, canvas.height, maxW, maxH);
  const x = (pageCanvas.width - w) / 2;

  pageCtx.drawImage(canvas, x, marginPx, w, h);

  const blob = await new Promise((resolve) => pageCanvas.toBlob(resolve, 'image/jpeg', 0.92));
  const file = new File([blob], filename, { type: 'image/jpeg' });
  await shareOrDownload(file, filename, title, () => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}
