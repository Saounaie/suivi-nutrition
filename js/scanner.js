// Scanner de code-barres. Safari iOS n'a pas BarcodeDetector : on utilise ZXing (copie locale dans vendor/) sur le flux caméra.
const ZXING = 'vendor/zxing-library-0.21.3.min.js';
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

function loadZXing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = ZXING;
    s.onload = () => resolve(window.ZXing);
    s.onerror = () => reject(new Error('Lecteur indisponible'));
    document.head.appendChild(s);
  });
}

/**
 * Lance la caméra dans `video` et appelle onCode(code) à la première lecture.
 * Renvoie une fonction stop(). Lance une Error (message lisible) si la caméra est refusée.
 */
export async function startScanner(video, onCode) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Caméra indisponible sur cet appareil.");
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  } catch (e) {
    throw new Error(e.name === 'NotAllowedError' ? "Accès à la caméra refusé. Autorise-le dans Réglages > Safari > Caméra, ou saisis le code à la main." : "Impossible d'ouvrir la caméra.");
  }
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  video.muted = true;
  await video.play().catch(() => {});

  let stopped = false;
  let timer = null;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
  const found = (code) => { if (!stopped) { stop(); if (navigator.vibrate) navigator.vibrate(60); onCode(code); } };

  if ('BarcodeDetector' in window) {
    try {
      const det = new window.BarcodeDetector({ formats: FORMATS });
      const tick = async () => {
        if (stopped) return;
        try { const r = await det.detect(video); if (r[0]?.rawValue) return found(r[0].rawValue); } catch (_) { /* image pas prête */ }
        timer = setTimeout(tick, 150);
      };
      tick();
      return stop;
    } catch (_) { /* repli ZXing */ }
  }

  const Z = await loadZXing();
  const hints = new Map([[Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E]], [Z.DecodeHintType.TRY_HARDER, true]]);
  const reader = new Z.MultiFormatReader();
  reader.setHints(hints);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const tick = () => {
    if (stopped) return;
    if (video.readyState >= 2 && video.videoWidth) {
      // on ne lit que la bande centrale : plus rapide et moins de faux positifs
      const w = video.videoWidth, h = video.videoHeight;
      const cw = Math.round(w * 0.9), ch = Math.round(h * 0.4);
      canvas.width = cw; canvas.height = ch;
      ctx.drawImage(video, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, cw, ch);
      try {
        const lum = new Z.HTMLCanvasElementLuminanceSource(canvas);
        const res = reader.decodeWithState(new Z.BinaryBitmap(new Z.HybridBinarizer(lum)));
        if (res) return found(res.getText());
      } catch (_) { /* pas de code dans cette image */ }
    }
    timer = setTimeout(tick, 120);
  };
  tick();
  return stop;
}
