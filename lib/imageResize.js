// Client-side only — resizes an image file down to a small square PNG before upload, so the
// sidebar/topbar avatar doesn't fetch the full-size logo. Ported from ecana_shop-app's
// resizeImageToPng helper (same approach: draw onto a canvas, export as PNG blob).
export function resizeImageToPng(file, maxDimension = 200) {
  return new Promise((resolve, reject) => {
    if (file.type === 'image/svg+xml') { reject(new Error('SVG cannot be resized client-side')); return; }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('Could not resize image')); return; }
        resolve(new File([blob], 'logo-small.png', { type: 'image/png' }));
      }, 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not load image')); };
    img.src = url;
  });
}
