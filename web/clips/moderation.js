/* ============ Clips — Moderation ============
 * Damit nichts Nicht-Jugendfreies reinkommt:
 *  1. Bilderkennung (NSFWJS, läuft komplett im Browser): Vor dem Hochladen
 *     werden Einzelbilder aus dem Video geprüft, ebenso Profilbilder und
 *     YouTube-Vorschaubilder. Das Modell (ca. 6 MB) wird erst geladen, wenn
 *     es gebraucht wird.
 *  2. Wortfilter für Beschreibungen, Kommentare und Namen.
 *  3. Melden (in app.js): gemeldete Videos verschwinden, bis der Admin sie prüft.
 * Die Prüfung läuft im Browser der Person, die etwas postet. Ein perfekter
 * Schutz ist das nicht, aber es fängt das Meiste ab.
 */
'use strict';

const NSFW_BASE = 'https://cdn.jsdelivr.net/npm/nsfwjs@4.4.0/dist/';
const NSFW_SCRIPTS = [
  'browser/nsfwjs.min.js',
  'models/mobilenet_v2/model.min.js',
  'models/mobilenet_v2/group1-shard1of1.min.js',
];

// Ab wann ein Bild als nicht jugendfrei gilt (Wahrscheinlichkeiten 0–1)
const BLOCK = { Porn: 0.55, Hentai: 0.7, Sexy: 0.9 };
const SUSPICIOUS = { Porn: 0.3, Hentai: 0.45, Sexy: 0.75 };

const MOD = { model: null, loading: null };

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.crossOrigin = 'anonymous';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Die Inhaltsprüfung konnte nicht geladen werden. Prüfe dein Internet.'));
    document.head.appendChild(s);
  });
}

function nsfwModel() {
  if (MOD.model) return Promise.resolve(MOD.model);
  if (!MOD.loading) {
    MOD.loading = (async () => {
      for (const file of NSFW_SCRIPTS) await loadScript(NSFW_BASE + file);
      MOD.model = await nsfwjs.load('MobileNetV2');
      return MOD.model;
    })();
    MOD.loading.catch(() => { MOD.loading = null; });
  }
  return MOD.loading;
}

function scores(predictions) {
  const p = {};
  for (const x of predictions) p[x.className] = x.probability;
  return p;
}

const over = (p, limits) => Object.keys(limits).some(k => (p[k] || 0) >= limits[k]);

// Ein Bild/Canvas/Video-Bild prüfen: 'ok', 'suspicious' oder 'blocked'
async function rateImage(source) {
  const model = await nsfwModel();
  const p = scores(await model.classify(source));
  return over(p, BLOCK) ? 'blocked' : over(p, SUSPICIOUS) ? 'suspicious' : 'ok';
}

function waitEvent(target, event, ms = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { done(); reject(new Error('Das Video konnte nicht geprüft werden.')); }, ms);
    const ok = () => { done(); resolve(); };
    const fail = () => { done(); reject(new Error('Das Video konnte nicht geprüft werden.')); };
    function done() {
      clearTimeout(timer);
      target.removeEventListener(event, ok);
      target.removeEventListener('error', fail);
    }
    target.addEventListener(event, ok);
    target.addEventListener('error', fail);
  });
}

// Video prüfen: verteilt über die ganze Länge Einzelbilder ansehen.
// Gesperrt wird bei einem eindeutigen Bild oder mehreren verdächtigen.
async function checkVideo(blob, duration, onProgress) {
  await nsfwModel();
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.className = 'offscreen';
  v.src = URL.createObjectURL(blob);
  document.body.appendChild(v);
  try {
    await waitEvent(v, 'loadeddata');
    const length = isFinite(v.duration) && v.duration > 0 ? v.duration : (duration || 0);
    const frames = Math.max(6, Math.min(30, Math.round(length / 3)));
    const canvas = document.createElement('canvas');
    const scale = 320 / Math.max(v.videoWidth, v.videoHeight);
    canvas.width = Math.max(1, Math.round(v.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(v.videoHeight * scale));
    const ctx = canvas.getContext('2d');
    let suspicious = 0;
    for (let i = 0; i < frames; i++) {
      if (length > 0) {
        v.currentTime = Math.min(length - 0.05, (i + 0.5) * length / frames);
        await waitEvent(v, 'seeked');
      }
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const r = await rateImage(canvas);
      if (r === 'blocked') return false;
      if (r === 'suspicious' && ++suspicious >= 2) return false;
      onProgress((i + 1) / frames);
      if (length <= 0) break;
    }
    return true;
  } finally {
    URL.revokeObjectURL(v.src);
    v.removeAttribute('src');
    v.load();
    v.remove();
  }
}

// Bild aus einer URL oder Data-URL prüfen (Profilbild, YouTube-Vorschau)
async function checkImageUrl(url) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  await img.decode();
  return (await rateImage(img)) !== 'blocked';
}

// ---------- Wortfilter ----------
// Eindeutige Wörter werden auch mitten im Wort gefunden („pornoseite“),
// kurze nur als ganzes Wort (damit z. B. „Essex“ oder „Dickens“ nicht stören).
const BAD_PARTS = [
  'porn', 'hentai', 'xvideos', 'xhamster', 'onlyfans', 'brazzers', 'redtube', 'youporn',
  'blowjob', 'handjob', 'deepthroat', 'masturb', 'wichs', 'dildo', 'vibrator', 'orgasm',
  'ficken', 'fickt', 'gefickt', 'bumsen', 'muschi', 'fotze', 'titten', 'nackbild', 'nacktbild',
  'nacktfoto', 'nudes', 'pimmel', 'sperma', 'erotik', 'stripper',
  'vergewaltig', 'kinderporn', 'pädo', 'paedo', 'hurensohn', 'nutte', 'schlampe',
  'siegheil', 'heilhitler', 'nigger', 'nigga', 'kanake',
];
const BAD_WORDS = [
  'sex', 'sexy', 'xxx', 'nsfw', 'nackt', 'nude', 'naked', 'fick', 'penis', 'vagina', 'boobs',
  'tits', 'pussy', 'cock', 'cum', 'horny', 'milf', 'anal', 'hure',
];

function normalizeForFilter(text) {
  return (text || '').toLowerCase()
    .replace(/[0@4]/g, (c) => ({ 0: 'o', '@': 'a', 4: 'a' }[c]))
    .replace(/[1!|]/g, 'i').replace(/3/g, 'e').replace(/[5$]/g, 's').replace(/7/g, 't')
    .replace(/ß/g, 'ss')
    .replace(/(.)\1{2,}/g, '$1$1')
    // „p.o.r.n“ oder „p-o-r-n“ → „porn“
    .replace(/[._\-*~'"`]/g, '')
    // „p o r n“ (einzelne Buchstaben mit Leerzeichen) → „porn“
    .replace(/(^|\s)([a-zäöü])(?=\s[a-zäöü](\s|$))/g, '$1$2#')
    .replace(/#\s/g, '');
}

// Gibt das gefundene Wort zurück oder null
function badWord(text) {
  if (/(^|\D)18\s*\+/.test(text || '')) return '18+';
  // Doppelte Buchstaben zusammenfassen, damit „pooorn“ wie „porn“ zählt
  const single = (s) => s.replace(/(.)\1+/g, '$1');
  const words = normalizeForFilter(text).split(/[^a-zäöü0-9]+/).filter(Boolean).map(single);
  const part = BAD_PARTS.find(p => words.some(w => w.includes(single(p))));
  if (part) return part;
  const set = new Set(words);
  return BAD_WORDS.find(w => set.has(single(w))) || null;
}
