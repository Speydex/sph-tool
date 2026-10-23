/* ============ Clips — Video vorbereiten ============
 * Handyvideos sind oft 50 MB und mehr. Damit sie in die kostenlose
 * Firebase-Datenbank passen, werden sie vor dem Hochladen im Browser
 * verkleinert: Das Video wird einmal (unsichtbar) abgespielt, Bild für Bild
 * auf ein kleineres Canvas gemalt und mit dem Ton neu aufgenommen. Das dauert
 * so lange wie das Video selbst.
 */
'use strict';

// Keine feste Längengrenze. Begrenzt ist nur die Größe (300 Datenbank-Stücke à
// 900 KB); mit der niedrigsten Bitrate passen gut 60 Minuten hinein.
const MAX_BYTES = 260 * 1024 * 1024;
const TARGET_BYTES = 30 * 1024 * 1024;     // bis hierhin volle Qualität, danach weniger Bitrate
const DIRECT_MAX_BYTES = 8 * 1024 * 1024;  // kleine mp4/webm direkt hochladen
const TARGET_LONG_SIDE = 960;
const VIDEO_BITRATE = 1200000;
const MIN_VIDEO_BITRATE = 450000;
const AUDIO_BITRATE = 96000;

// mp4 zuerst, weil das überall abspielbar ist (auch auf iPhones)
const RECORDER_TYPES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

function recorderType() {
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return null;
  return RECORDER_TYPES.find(t => MediaRecorder.isTypeSupported(t)) || null;
}

function waitFor(target, event, ms = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('Das Video lädt nicht.')); }, ms);
    const ok = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('Diese Datei kann dein Browser nicht als Video lesen.')); };
    function cleanup() {
      clearTimeout(timer);
      target.removeEventListener(event, ok);
      target.removeEventListener('error', fail);
    }
    target.addEventListener(event, ok);
    target.addEventListener('error', fail);
  });
}

// Manche Browser malen nur Videos, die wirklich im Dokument hängen
function hiddenVideo(src) {
  const v = document.createElement('video');
  v.className = 'offscreen';
  v.preload = 'auto';
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.src = src;
  document.body.appendChild(v);
  return v;
}

function disposeVideo(v) {
  v.pause();
  URL.revokeObjectURL(v.src);
  v.removeAttribute('src');
  v.load();
  v.remove();
}

// Datei laden und Länge/Größe auslesen. Das Ergebnis ist für genau einen
// compressVideo()-Aufruf gedacht.
async function probeVideo(file) {
  const v = hiddenVideo(URL.createObjectURL(file));
  try {
    await waitFor(v, 'loadedmetadata');
  } catch (e) {
    disposeVideo(v);
    throw e;
  }
  if (!v.videoWidth) {
    disposeVideo(v);
    throw new Error('In dieser Datei ist kein Bild. Wähle ein Video aus.');
  }
  return { file, el: v, duration: v.duration, width: v.videoWidth, height: v.videoHeight };
}

function needsCompression(probe) {
  return !(probe.file.size <= DIRECT_MAX_BYTES && /^video\/(mp4|webm)$/.test(probe.file.type));
}

// Muss direkt im Klick-Handler gestartet werden, sonst blockiert der Browser
// das Abspielen mit Ton.
function compressVideo(probe, onProgress) {
  const type = recorderType();
  const v = probe.el;
  // Kurze Videos in guter Qualität, lange so, dass sie trotzdem unter TARGET_BYTES bleiben
  const seconds = isFinite(probe.duration) && probe.duration > 0 ? probe.duration : 600;
  const bitrate = Math.round(Math.max(MIN_VIDEO_BITRATE,
    Math.min(VIDEO_BITRATE, TARGET_BYTES * 8 / seconds - AUDIO_BITRATE)));
  const longSide = bitrate < 900000 ? 720 : TARGET_LONG_SIDE;
  const scale = Math.min(1, longSide / Math.max(probe.width, probe.height));
  const w = Math.max(2, Math.round(probe.width * scale / 2) * 2);
  const h = Math.max(2, Math.round(probe.height * scale / 2) * 2);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillRect(0, 0, w, h);
  const tracks = canvas.captureStream(30).getVideoTracks();

  let audio = null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) {
    try {
      audio = new AC();
      const dest = audio.createMediaStreamDestination();
      audio.createMediaElementSource(v).connect(dest);
      tracks.push(...dest.stream.getAudioTracks());
      audio.resume();
    } catch (e) {
      console.warn('Ton kann nicht mit aufgenommen werden', e);
      audio = null;
    }
  }

  const rec = new MediaRecorder(new MediaStream(tracks), {
    mimeType: type, videoBitsPerSecond: bitrate, audioBitsPerSecond: AUDIO_BITRATE,
  });
  const parts = [];
  rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
  const recorded = new Promise((resolve, reject) => {
    rec.onstop = () => resolve(new Blob(parts, { type: type.split(';')[0] }));
    rec.onerror = (e) => reject(e.error || new Error('Aufnahme fehlgeschlagen.'));
  });

  let stopped = false;
  const finish = () => {
    if (stopped) return;
    stopped = true;
    if (rec.state !== 'inactive') rec.stop();
    tracks.forEach(t => t.stop());
  };
  const draw = () => {
    if (stopped) return;
    ctx.drawImage(v, 0, 0, w, h);
    if (probe.duration) onProgress(Math.min(1, v.currentTime / probe.duration));
    if (v.ended) finish();
    else requestAnimationFrame(draw);
  };

  v.muted = false;
  v.onended = finish;
  rec.start(1000);
  return v.play()
    .then(() => { requestAnimationFrame(draw); return recorded; })
    // mime mit Codecs merken: damit kann das Video später stückweise (gestreamt) laufen
    .then(blob => ({ blob, type: blob.type, mime: type }))
    .catch(e => {
      finish();
      if (e && e.name === 'NotAllowedError') throw new Error('Der Browser hat das Abspielen blockiert. Tippe nochmal auf Posten.');
      throw e;
    })
    .finally(() => {
      if (audio) audio.close();
      disposeVideo(v);
    });
}

// Kleines Vorschaubild (JPEG als Data-URL, ca. 10 KB)
async function makeThumb(blob) {
  const v = hiddenVideo(URL.createObjectURL(blob));
  v.muted = true;
  try {
    await waitFor(v, 'loadeddata', 8000);
    const at = isFinite(v.duration) && v.duration > 0 ? Math.min(0.5, v.duration / 2) : 0;
    if (at > 0) {
      v.currentTime = at;
      await waitFor(v, 'seeked', 5000);
    }
    const scale = 180 / v.videoWidth;
    const canvas = document.createElement('canvas');
    canvas.width = 180;
    canvas.height = Math.round(v.videoHeight * scale);
    canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.6);
  } finally {
    disposeVideo(v);
  }
}

// Profilbild: quadratisch zugeschnitten, 200 × 200 px als JPEG (ca. 15 KB)
async function makePhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => { throw new Error('Dieses Bild kann dein Browser nicht öffnen. Nimm ein JPG oder PNG.'); });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 200;
    canvas.getContext('2d').drawImage(img,
      (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 200, 200);
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}
