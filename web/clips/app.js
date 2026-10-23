/* ============ Clips — Videos nur für dich und deine Freunde ============
 * Läuft komplett im Browser über Firebase (dasselbe Projekt und dieselben
 * Konten wie BörsenTycoon und Schach). Die Regeln aus
 * web/boersentycoon/firestore.rules müssen in der Firebase-Konsole
 * veröffentlicht sein (siehe CLIPS_SETUP.md).
 *
 * Datenmodell:
 *   clipsMembers/{uid}              { name, nameKey, photo, joinedAt }   wer drin ist
 *   clipsBanned/{uid}               { name, at }                vom Admin gesperrt
 *   clipsSeen/{uid}                 { ids: {videoId: ms} }      welche Videos man schon gesehen hat
 *   clipsNames/{nameKey}            { uid }                     sorgt dafür, dass jeder Name nur einmal vorkommt
 *   clipsVideos/{id}                { owner, caption, type, size, chunks, duration,
 *                                     thumb, likes, comments, ready, createdAt }
 *   clipsVideos/{id}/chunks/{00..}  { data: Bytes }             das Video in Stücken < 1 MB
 *   clipsVideos/{id}/likes/{uid}    { at }
 *   clipsVideos/{id}/comments/{id}  { uid, text, createdAt }
 */
'use strict';

const ADMIN_EMAIL = 'stark.liam2011@gmail.com';
const CHUNK_BYTES = 900 * 1024;
const MAX_CHUNKS = 40;
const FEED_PAGE = 60;
const SEEN_AFTER_S = 2;      // so lange muss ein Video laufen, bis es als gesehen zählt
const URL_CACHE = 8;

const S = {
  auth: null, db: null, user: null, me: null,
  members: new Map(),
  unsubs: [],
  feedLimit: FEED_PAGE,
  feedVideos: [],           // alles, was die Datenbank gerade liefert
  order: null,              // Reihenfolge im Feed (Video-IDs), einmal pro Sitzung berechnet
  seen: new Map(),          // videoId -> wann zuletzt gesehen (ms)
  seenDirty: {},
  feed: null, player: null,
  view: 'feed',
  liked: new Map(),         // videoId -> true/false (nur was schon geladen wurde)
  urls: new Map(),          // videoId -> Promise<objectURL>, älteste zuerst
  muted: true,
  upload: { probe: null, busy: false },
  comments: { video: null, unsub: null },
};

const $ = (id) => document.getElementById(id);
const serverTime = () => firebase.firestore.FieldValue.serverTimestamp();
const inc = (n) => firebase.firestore.FieldValue.increment(n);
const myUid = () => S.user && S.user.uid;
const isAdmin = () => !!(S.user && S.user.email === ADMIN_EMAIL);
const videos = () => S.db.collection('clipsVideos');
const chunkId = (i) => String(i).padStart(2, '0');

// ---------- Hilfen ----------
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function button(text, onClick, cls) {
  const b = el('button', cls || '', text);
  b.type = 'button';
  b.onclick = onClick;
  return b;
}

function toast(text, isError = false) {
  const t = $('toast');
  t.textContent = text;
  t.classList.toggle('error', isError);
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, isError ? 6000 : 3000);
}

function errorText(e) {
  const code = (e && e.code) || '';
  const map = {
    'auth/invalid-email': 'Die E-Mail-Adresse ist ungültig.',
    'auth/missing-password': 'Bitte gib ein Passwort ein.',
    'auth/weak-password': 'Das Passwort muss mindestens 6 Zeichen haben.',
    'auth/email-already-in-use': 'Für diese E-Mail gibt es schon ein Konto. Melde dich an.',
    'auth/invalid-credential': 'E-Mail oder Passwort ist falsch.',
    'auth/wrong-password': 'E-Mail oder Passwort ist falsch.',
    'auth/user-not-found': 'E-Mail oder Passwort ist falsch.',
    'auth/too-many-requests': 'Zu viele Versuche. Warte kurz und versuch es dann nochmal.',
    'auth/network-request-failed': 'Keine Internetverbindung.',
    'permission-denied': 'Keine Berechtigung. Sind die Firestore-Regeln für Clips schon veröffentlicht? (siehe CLIPS_SETUP.md)',
    'unavailable': 'Keine Verbindung zum Server. Prüfe dein Internet.',
  };
  return map[code] || (e && e.message) || 'Unbekannter Fehler.';
}

function showError(e) {
  console.error(e);
  toast(errorText(e), true);
}

function nameOf(uid) {
  const m = S.members.get(uid);
  return m ? m.name : 'Ehemaliges Mitglied';
}

function initial(name) {
  return (name || '?').trim().charAt(0).toUpperCase() || '?';
}

function avatar(uid, cls = '') {
  const name = nameOf(uid);
  const m = S.members.get(uid);
  if (m && m.photo) {
    const a = el('span', 'avatar photo ' + cls);
    a.style.backgroundImage = `url("${m.photo}")`;
    a.setAttribute('aria-label', name);
    return a;
  }
  const a = el('span', 'avatar ' + cls, initial(name));
  // Jede Person bekommt immer dieselbe Farbe
  let hash = 0;
  for (const ch of uid) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  a.style.setProperty('--hue', hash % 360);
  return a;
}

function millis(ts) {
  return ts && ts.toMillis ? ts.toMillis() : Date.now();
}

function ago(ts) {
  const s = Math.max(0, (Date.now() - millis(ts)) / 1000);
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `vor ${Math.floor(s / 60)} Min.`;
  if (s < 86400) return `vor ${Math.floor(s / 3600)} Std.`;
  const d = Math.floor(s / 86400);
  if (d < 7) return d === 1 ? 'gestern' : `vor ${d} Tagen`;
  return new Date(millis(ts)).toLocaleDateString('de-DE');
}

function count(n) {
  n = n || 0;
  return n >= 1000 ? (n / 1000).toFixed(1).replace('.0', '') + 'k' : String(n);
}

function videoData(doc) {
  return { id: doc.id, ...doc.data({ serverTimestamps: 'estimate' }) };
}

function screen(id) {
  for (const s of ['screen-off', 'screen-login', 'screen-join', 'screen-app']) $(s).hidden = s !== id;
}

// ---------- Start & Anmeldung ----------
function init() {
  if (typeof firebase === 'undefined' || typeof FIREBASE_CONFIG === 'undefined' || !FIREBASE_CONFIGURED) {
    screen('screen-off');
    return;
  }
  try {
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    S.auth = firebase.auth();
    S.db = firebase.firestore();
  } catch (e) {
    console.error(e);
    screen('screen-off');
    return;
  }
  S.auth.onAuthStateChanged(onAuth);
}

async function onAuth(user) {
  const kicked = S.kicked;
  S.kicked = false;
  stopApp();
  S.user = user;
  S.me = null;
  if (!user) {
    screen('screen-login');
    return;
  }
  try {
    const snap = await S.db.collection('clipsMembers').doc(user.uid).get();
    S.me = snap.exists ? snap.data() : null;
  } catch (e) {
    screen('screen-login');
    showError(e);
    return;
  }
  if (!S.me) {
    showJoin(kicked ? 'Du bist nicht mehr in der Gruppe.' : '');
    return;
  }
  startApp();
}

function showJoin(message) {
  $('join-name').value = $('join-name').value || (S.user.email || '').split('@')[0].slice(0, 20);
  $('join-intro').textContent = isAdmin()
    ? 'Du bist der Admin von Clips. Wähl einen Namen, dann kannst du loslegen.'
    : 'Fast geschafft! Wähl noch einen Namen, dann bist du drin.';
  screen('screen-join');
  if (message) toast(message, true);
}

async function login(register) {
  const email = $('login-email').value.trim();
  const pw = $('login-password').value;
  try {
    if (register) await S.auth.createUserWithEmailAndPassword(email, pw);
    else await S.auth.signInWithEmailAndPassword(email, pw);
    $('login-password').value = '';
  } catch (e) { showError(e); }
}

async function resetPassword() {
  const email = $('login-email').value.trim();
  if (!email) { toast('Gib oben deine E-Mail ein, dann schicke ich dir einen Link zum Zurücksetzen.', true); return; }
  try {
    await S.auth.sendPasswordResetEmail(email);
    toast(`Link zum Zurücksetzen an ${email} geschickt.`);
  } catch (e) { showError(e); }
}

function cleanName(raw) {
  return raw.trim().replace(/\s+/g, ' ');
}

// Groß-/Kleinschreibung zählt nicht: „Max“ und „max“ sind derselbe Name. Nur
// A–Z, weil die Firestore-Regeln (lower()) Umlaute nicht umwandeln.
const nameKey = (name) => name.replace(/[A-Z]+/g, (c) => c.toLowerCase());
const names = () => S.db.collection('clipsNames');

function nameProblem(name) {
  if (name.length < 2 || name.length > 20) return 'Der Name muss 2 bis 20 Zeichen lang sein.';
  if (name.includes('/') || /^\.+$/.test(name) || /^__.*__$/.test(name)) return 'Dieser Name geht leider nicht. Lass „/“ weg.';
  return null;
}

// Prüft, ob der Name noch frei ist (oder schon mir gehört)
async function nameOwner(name) {
  const snap = await names().doc(nameKey(name)).get();
  return snap.exists ? snap.data().uid : null;
}

// Name reservieren und ins Profil schreiben, alten Namen freigeben. Alles in
// einem Rutsch, damit nie zwei Leute denselben Namen bekommen.
async function claimName(name, memberData = null) {
  const key = nameKey(name);
  const owner = await nameOwner(name);
  if (owner && owner !== myUid()) throw new Error(`Den Namen „${name}“ hat schon jemand. Such dir einen anderen aus.`);
  const batch = S.db.batch();
  if (!owner) batch.set(names().doc(key), { uid: myUid() });
  const ref = S.db.collection('clipsMembers').doc(myUid());
  if (memberData) {
    batch.set(ref, { ...memberData, name, nameKey: key });
  } else {
    batch.update(ref, { name, nameKey: key });
    const old = S.me && S.me.nameKey;
    if (old && old !== key) batch.delete(names().doc(old));
  }
  await batch.commit();
}

async function join(e) {
  e.preventDefault();
  const name = cleanName($('join-name').value);
  const problem = nameProblem(name);
  if (problem) { toast(problem, true); return; }
  try {
    await claimName(name, { joinedAt: serverTime() });
    S.me = { name, nameKey: nameKey(name) };
    startApp();
  } catch (err) {
    if (err.code !== 'permission-denied') { showError(err); return; }
    const banned = await S.db.collection('clipsBanned').doc(myUid()).get().then(s => s.exists, () => false);
    toast(banned
      ? 'Der Admin hat dich aus Clips entfernt. Du kannst nicht wieder beitreten.'
      : 'Beitreten hat nicht geklappt. Sind die neuen Firestore-Regeln schon veröffentlicht? (siehe CLIPS_SETUP.md)', true);
  }
}

// Wer vor der Namens-Regel beigetreten ist, reserviert seinen Namen jetzt nachträglich
async function migrateName() {
  if (migrateName.running || migrateName.failed) return;
  migrateName.running = true;
  try {
    await claimName(S.me.name);
  } catch (e) {
    console.warn(e);
    migrateName.failed = true;
    toast(`Den Namen „${S.me.name}“ gibt es doppelt. Bitte wähl im Profil einen neuen.`, true);
  }
  migrateName.running = false;
}

// ---------- App ----------
function startApp() {
  stopApp();
  screen('screen-app');
  S.feed = new Feed($('feed'), { onNearEnd: loadMore });
  S.unsubs.push(S.db.collection('clipsMembers').onSnapshot(snap => {
    S.members = new Map(snap.docs.map(d => [d.id, d.data()]));
    if (!S.members.has(myUid())) {
      // Vom Admin entfernt
      S.kicked = true;
      onAuth(S.user);
      return;
    }
    S.me = S.members.get(myUid());
    if (!S.me.nameKey) migrateName();
    S.feed.refreshNames();
    if (S.player) S.player.refreshNames();
    if (S.view === 'profile') renderProfile(S.profileUid);
  }, err => {
    // Passiert, wenn der Admin einen rauswirft: Mitgliedschaft neu prüfen
    if (err.code === 'permission-denied') {
      S.kicked = true;
      onAuth(S.user);
    } else showError(err);
  }));
  const token = (startApp.token = (startApp.token || 0) + 1);
  // Erst wissen, was schon gesehen wurde, dann den Feed sortieren
  loadSeen().then(() => { if (token === startApp.token && S.feed) subscribeFeed(); });
  go('feed');
}

function stopApp() {
  for (const u of S.unsubs) u();
  S.unsubs = [];
  if (S.feedUnsub) S.feedUnsub();
  S.feedUnsub = null;
  closeComments();
  closePlayer();
  if (S.feed) S.feed.destroy();
  S.feed = null;
  S.feedLimit = FEED_PAGE;
  S.feedVideos = [];
  S.order = null;
  S.wantTop = null;
  flushSeen();
  S.seen = new Map();
  S.liked.clear();
  for (const p of S.urls.values()) p.then(URL.revokeObjectURL, () => {});
  S.urls.clear();
}

function subscribeFeed() {
  if (S.feedUnsub) S.feedUnsub();
  S.feedUnsub = videos().orderBy('createdAt', 'desc').limit(S.feedLimit).onSnapshot(snap => {
    S.feedFull = snap.size >= S.feedLimit;
    S.feedVideos = snap.docs.map(videoData).filter(v => v.ready);
    arrangeFeed();
  }, showError);
}

// ---------- Algorithmus: was als Nächstes kommt ----------
// Zuerst Videos von anderen, die man noch nicht gesehen hat: neue und
// beliebte weiter vorne, mit etwas Zufall, damit es nicht immer gleich ist.
// Danach eigene und schon gesehene Videos, die am längsten nicht mehr
// gesehenen zuerst. Dieselbe Person kommt möglichst nicht zweimal hintereinander.
function rankVideos(list) {
  const now = Date.now();
  const fresh = [];
  const old = [];
  for (const v of list) (v.owner !== myUid() && !S.seen.has(v.id) ? fresh : old).push(v);
  const score = (v) => {
    const hours = (now - millis(v.createdAt)) / 3600000;
    return 10 * Math.pow(0.5, hours / 48)     // Frische: halbiert sich alle 2 Tage
      + 2 * Math.log1p(v.likes || 0)
      + 2 * Math.log1p(v.comments || 0)
      + 4 * Math.random();
  };
  const lastSeen = (v) => (S.seen.get(v.id) || millis(v.createdAt)) + Math.random() * 6 * 3600000;
  const byScore = fresh.map(v => [score(v), v]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
  const byLastSeen = old.map(v => [lastSeen(v), v]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  return [...spreadOwners(byScore), ...spreadOwners(byLastSeen)];
}

function spreadOwners(list) {
  const rest = [...list];
  const out = [];
  while (rest.length) {
    const prev = out[out.length - 1];
    const i = rest.findIndex(v => !prev || v.owner !== prev.owner);
    out.push(rest.splice(Math.max(i, 0), 1)[0]);
  }
  return out;
}

// Die Reihenfolge bleibt während der Sitzung stehen, sonst springt der Feed.
// Neu gepostete Videos von anderen gibt es über „Neue Videos“, ältere (beim
// Weiterscrollen nachgeladene) kommen hinten dran.
function arrangeFeed({ reset = false } = {}) {
  const byId = new Map(S.feedVideos.map(v => [v.id, v]));
  let pending = [];
  if (reset || !S.order || !S.order.length) {
    S.order = rankVideos(S.feedVideos).map(v => v.id);
  } else {
    S.order = S.order.filter(id => byId.has(id));
    const known = new Set(S.order);
    const oldest = Math.min(...S.order.map(id => millis(byId.get(id).createdAt)));
    const extra = S.feedVideos.filter(v => !known.has(v.id));
    pending = extra.filter(v => millis(v.createdAt) > oldest && v.id !== S.wantTop);
    const older = extra.filter(v => !pending.includes(v) && v.id !== S.wantTop);
    S.order.push(...rankVideos(older).map(v => v.id));
  }
  if (S.wantTop && byId.has(S.wantTop)) {
    // Das eigene, gerade gepostete Video direkt oben zeigen
    S.order = [S.wantTop, ...S.order.filter(id => id !== S.wantTop)];
    S.wantTop = null;
    requestAnimationFrame(() => S.feed && S.feed.root.scrollTo({ top: 0 }));
  }
  S.feed.update(S.order.map(id => byId.get(id)));
  $('feed-new').hidden = !pending.length;
  $('feed-empty').hidden = S.feedVideos.length > 0;
}

function showNewVideos() {
  arrangeFeed({ reset: true });
  S.feed.root.scrollTo({ top: 0 });
}

// ---------- Gesehen merken ----------
// Im Konto (damit es auf allen Geräten gilt) und zusätzlich im Browser.
const seenKey = () => 'clips-seen-' + myUid();

async function loadSeen() {
  S.seen = new Map();
  try {
    for (const [id, t] of Object.entries(JSON.parse(localStorage.getItem(seenKey()) || '{}'))) S.seen.set(id, t);
  } catch (e) { /* Browser-Speicher nicht verfügbar */ }
  try {
    const snap = await S.db.collection('clipsSeen').doc(myUid()).get();
    const ids = (snap.exists && snap.data().ids) || {};
    for (const [id, t] of Object.entries(ids)) if (!(S.seen.get(id) >= t)) S.seen.set(id, t);
  } catch (e) { console.warn('Gesehene Videos nicht geladen', e); }
}

function markSeen(id) {
  const t = Date.now();
  S.seen.set(id, t);
  S.seenDirty[id] = t;
  try { localStorage.setItem(seenKey(), JSON.stringify(Object.fromEntries(S.seen))); } catch (e) { /* egal */ }
  clearTimeout(markSeen.timer);
  markSeen.timer = setTimeout(flushSeen, 5000);
}

function flushSeen() {
  clearTimeout(markSeen.timer);
  const ids = S.seenDirty;
  if (!S.db || !S.user || !Object.keys(ids).length) return;
  S.seenDirty = {};
  S.db.collection('clipsSeen').doc(S.user.uid).set({ ids }, { merge: true })
    .catch(e => console.warn('Gesehen nicht gespeichert', e));
}

function loadMore() {
  if (!S.feedFull) return;
  S.feedFull = false;
  S.feedLimit += FEED_PAGE;
  subscribeFeed();
}

function go(view) {
  if (S.upload.busy && view !== 'upload') { toast('Warte, bis dein Video hochgeladen ist.'); return; }
  S.view = view;
  for (const v of ['feed', 'upload', 'profile']) $('view-' + v).hidden = v !== view;
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.go === view);
  closePlayer();
  if (view === 'feed') S.feed.resume();
  else S.feed.pause();
  if (view === 'profile') renderProfile(myUid());
  if (view !== 'upload') $('upload-preview').pause();
  $('sound').hidden = view !== 'feed';
}

// ---------- Videos laden ----------
// Ein Video liegt in mehreren Datenbank-Dokumenten; hier wird es wieder
// zusammengesetzt. Die letzten paar bleiben im Speicher, damit Zurückscrollen
// nichts neu lädt.
function videoUrl(v) {
  if (S.urls.has(v.id)) {
    const p = S.urls.get(v.id);
    S.urls.delete(v.id);
    S.urls.set(v.id, p);
    return p;
  }
  const ref = videos().doc(v.id).collection('chunks');
  const p = Promise.all(Array.from({ length: v.chunks }, (_, i) => ref.doc(chunkId(i)).get()))
    .then(snaps => {
      const parts = snaps.map(s => {
        if (!s.exists) throw new Error('Video ist unvollständig.');
        return s.data().data.toUint8Array();
      });
      return URL.createObjectURL(new Blob(parts, { type: v.type || 'video/mp4' }));
    });
  p.catch(() => S.urls.delete(v.id));
  S.urls.set(v.id, p);
  while (S.urls.size > URL_CACHE) {
    const [oldId, oldP] = S.urls.entries().next().value;
    S.urls.delete(oldId);
    oldP.then(url => {
      for (const f of [S.feed, S.player]) if (f) f.forget(oldId);
      URL.revokeObjectURL(url);
    }, () => {});
  }
  return p;
}

async function loadLiked(id) {
  if (S.liked.has(id)) return S.liked.get(id);
  try {
    const snap = await videos().doc(id).collection('likes').doc(myUid()).get();
    S.liked.set(id, snap.exists);
  } catch (e) {
    console.warn(e);
  }
  return !!S.liked.get(id);
}

// ---------- Feed (TikTok-artiges Hochwischen) ----------
class Feed {
  constructor(root, { onNearEnd } = {}) {
    this.root = root;
    this.onNearEnd = onNearEnd;
    this.videos = [];
    this.slides = new Map();
    this.current = null;
    this.paused = false;
    this.root.innerHTML = '';
    this.observer = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting) this.activate(e.target.dataset.id);
        else if (this.current === e.target.dataset.id) this.stop(this.current);
      }
    }, { root, threshold: 0.6 });
  }

  destroy() {
    this.observer.disconnect();
    for (const s of this.slides.values()) s.video.pause();
    this.root.innerHTML = '';
    this.slides.clear();
  }

  // Liste in genau dieser Reihenfolge anzeigen. Vorhandene Slides werden
  // wiederverwendet, damit laufende Videos nicht neu starten.
  update(keep) {
    for (const [id, s] of this.slides) {
      if (!keep.some(v => v.id === id)) {
        this.observer.unobserve(s.root);
        s.video.pause();
        s.root.remove();
        this.slides.delete(id);
        if (this.current === id) this.current = null;
      }
    }
    let prev = null;
    for (const v of keep) {
      let s = this.slides.get(v.id);
      if (s) {
        s.data = v;
        this.fill(s);
      } else {
        s = this.makeSlide(v);
        this.slides.set(v.id, s);
        this.observer.observe(s.root);
      }
      const want = prev ? prev.root.nextSibling : this.root.firstChild;
      if (want !== s.root) this.root.insertBefore(s.root, want);
      prev = s;
    }
    this.videos = keep;
  }

  scrollToId(id) {
    const s = this.slides.get(id);
    if (s) this.root.scrollTop = s.root.offsetTop;
  }

  refreshNames() {
    for (const s of this.slides.values()) this.fill(s);
  }

  makeSlide(v) {
    const root = el('div', 'slide');
    root.dataset.id = v.id;
    const video = el('video');
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.loop = true;
    video.preload = 'auto';
    const spinner = el('div', 'spinner');
    const paused = el('div', 'paused-icon', '▶');
    const fail = el('p', 'slide-error');
    const tap = el('div', 'tap-area');

    const meta = el('div', 'meta');
    const who = button('', () => openProfile(s.data.owner), 'who');
    const when = el('span', 'when');
    const caption = el('p', 'caption');
    meta.append(who, when, caption);

    const actions = el('div', 'actions');
    const prof = button('', () => openProfile(s.data.owner), 'act');
    const like = button('', () => this.toggleLike(s), 'act like');
    like.append(el('span', 'ico', '♥'), el('span', 'n'));
    const comment = button('', () => openComments(s.data), 'act');
    comment.append(el('span', 'ico', '💬'), el('span', 'n'));
    const del = button('', () => this.askDelete(s), 'act del');
    del.append(el('span', 'ico', '🗑'), el('span', 'n', 'Löschen'));
    actions.append(prof, like, comment, del);

    root.append(video, spinner, paused, fail, tap, meta, actions);
    const s = { root, video, spinner, paused, fail, who, when, caption, prof, like, comment, del, data: v };

    // Einmal tippen = Pause, zweimal = Like
    let lastTap = 0;
    let single = null;
    tap.addEventListener('click', (e) => {
      const now = Date.now();
      if (now - lastTap < 300) {
        clearTimeout(single);
        lastTap = 0;
        this.burst(s, e);
        if (!S.liked.get(s.data.id)) this.toggleLike(s);
        return;
      }
      lastTap = now;
      single = setTimeout(() => this.togglePause(s), 300);
    });
    video.addEventListener('waiting', () => { spinner.hidden = false; });
    video.addEventListener('timeupdate', () => {
      if (s.counted || !video.duration) return;
      if (video.currentTime >= Math.min(SEEN_AFTER_S, video.duration * 0.8)) {
        s.counted = true;
        markSeen(s.data.id);
      }
    });
    video.addEventListener('playing', () => { spinner.hidden = true; paused.hidden = true; });
    spinner.hidden = true;
    paused.hidden = true;
    fail.hidden = true;
    this.fill(s);
    return s;
  }

  fill(s) {
    const v = s.data;
    if (v.thumb && s.video.poster !== v.thumb) s.video.poster = v.thumb;
    s.who.textContent = '@' + nameOf(v.owner);
    s.when.textContent = ' · ' + ago(v.createdAt);
    s.caption.textContent = v.caption || '';
    s.caption.hidden = !v.caption;
    s.prof.replaceChildren(avatar(v.owner, 'big'));
    s.like.querySelector('.n').textContent = count(v.likes);
    s.like.classList.toggle('on', !!S.liked.get(v.id));
    s.comment.querySelector('.n').textContent = count(v.comments);
    s.del.hidden = !(v.owner === myUid() || isAdmin());
    if (s.armed) {
      s.del.classList.add('armed');
      s.del.querySelector('.n').textContent = 'Sicher?';
    } else {
      s.del.classList.remove('armed');
      s.del.querySelector('.n').textContent = 'Löschen';
    }
  }

  async activate(id) {
    if (this.current && this.current !== id) this.stop(this.current);
    this.current = id;
    const idx = this.videos.findIndex(v => v.id === id);
    if (idx >= this.videos.length - 3 && this.onNearEnd) this.onNearEnd();
    // Nachbarn schon mal vorladen
    for (const n of [this.videos[idx + 1], this.videos[idx - 1]]) if (n) videoUrl(n).catch(() => {});
    // Weit entfernte Videos aus dem Speicher werfen
    for (const [sid, s] of this.slides) {
      const i = this.videos.findIndex(v => v.id === sid);
      if (Math.abs(i - idx) > 2 && s.video.getAttribute('src')) this.forget(sid);
    }
    const s = this.slides.get(id);
    if (!s) return;
    loadLiked(id).then(() => this.fill(s));
    if (!this.paused) this.play(s);
  }

  async play(s) {
    s.paused.hidden = true;
    s.fail.hidden = true;
    if (!s.video.getAttribute('src')) {
      s.spinner.hidden = false;
      try {
        const url = await videoUrl(s.data);
        if (this.current !== s.data.id) return;
        s.video.src = url;
      } catch (e) {
        console.error(e);
        s.spinner.hidden = true;
        s.fail.textContent = 'Video konnte nicht geladen werden.';
        s.fail.hidden = false;
        return;
      }
    }
    if (this.paused || this.current !== s.data.id) return;
    s.video.muted = S.muted;
    try {
      await s.video.play();
    } catch (e) {
      if (e.name === 'NotAllowedError' && !s.video.muted) {
        // Ohne vorheriges Tippen erlaubt der Browser nur stummes Abspielen
        setMuted(true);
        s.video.muted = true;
        try { await s.video.play(); } catch (e2) { s.paused.hidden = false; }
      } else if (e.name !== 'AbortError') {
        s.paused.hidden = false;
      }
    }
    s.spinner.hidden = true;
  }

  stop(id) {
    const s = this.slides.get(id);
    if (s) s.video.pause();
  }

  forget(id) {
    const s = this.slides.get(id);
    if (!s || this.current === id) return;
    s.video.pause();
    s.video.removeAttribute('src');
    s.video.load();
  }

  pause() {
    this.paused = true;
    if (this.current) this.stop(this.current);
  }

  resume() {
    this.paused = false;
    const s = this.current && this.slides.get(this.current);
    if (s && !s.userPaused) this.play(s);
  }

  togglePause(s) {
    if (s.video.paused) {
      s.userPaused = false;
      if (S.muted && !setMuted.touched) setMuted(false);
      this.play(s);
    } else {
      s.userPaused = true;
      s.video.pause();
      s.paused.hidden = false;
    }
  }

  burst(s, e) {
    const h = el('span', 'heart-burst', '♥');
    const r = s.root.getBoundingClientRect();
    h.style.left = (e.clientX - r.left) + 'px';
    h.style.top = (e.clientY - r.top) + 'px';
    s.root.appendChild(h);
    setTimeout(() => h.remove(), 800);
  }

  async toggleLike(s) {
    const id = s.data.id;
    if (s.liking) return;
    s.liking = true;
    const was = await loadLiked(id);
    const ref = videos().doc(id);
    const batch = S.db.batch();
    if (was) batch.delete(ref.collection('likes').doc(myUid()));
    else batch.set(ref.collection('likes').doc(myUid()), { at: serverTime() });
    batch.update(ref, { likes: inc(was ? -1 : 1) });
    // Sofort anzeigen, die Datenbank zieht gleich nach
    S.liked.set(id, !was);
    s.data = { ...s.data, likes: (s.data.likes || 0) + (was ? -1 : 1) };
    this.fill(s);
    try {
      await batch.commit();
    } catch (e) {
      S.liked.set(id, was);
      s.data = { ...s.data, likes: (s.data.likes || 0) + (was ? 1 : -1) };
      this.fill(s);
      showError(e);
    }
    s.liking = false;
  }

  askDelete(s) {
    if (!s.armed) {
      s.armed = true;
      this.fill(s);
      setTimeout(() => { s.armed = false; this.fill(s); }, 3000);
      return;
    }
    s.armed = false;
    deleteVideo(s.data);
  }
}

function setMuted(m) {
  S.muted = m;
  setMuted.touched = true;
  $('sound').textContent = m ? '🔇' : '🔊';
  for (const f of [S.feed, S.player]) {
    const s = f && f.current && f.slides.get(f.current);
    if (s) s.video.muted = m;
  }
}

async function deleteVideo(v, quiet = false) {
  const ref = videos().doc(v.id);
  try {
    if (!quiet) toast('Video wird gelöscht …');
    // Erst die Unterdokumente, sonst können die Regeln den Besitzer nicht mehr prüfen
    const batch = S.db.batch();
    for (let i = 0; i < v.chunks; i++) batch.delete(ref.collection('chunks').doc(chunkId(i)));
    for (const sub of ['likes', 'comments']) {
      const snap = await ref.collection(sub).get();
      snap.forEach(d => batch.delete(d.ref));
    }
    await batch.commit();
    await ref.delete();
    if (quiet) return;
    toast('Video gelöscht.');
    if (S.view === 'profile') renderProfile(S.profileUid);
    if (S.player) {
      S.player.update(S.player.videos.filter(x => x.id !== v.id));
      if (!S.player.videos.length) closePlayer();
    }
  } catch (e) {
    if (quiet) console.warn(e);
    else showError(e);
  }
}

// ---------- Profile ----------
function openProfile(uid) {
  closePlayer();
  if (S.view !== 'profile') {
    S.view = 'profile';
    for (const v of ['feed', 'upload', 'profile']) $('view-' + v).hidden = v !== 'profile';
    for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.go === 'profile' && uid === myUid());
    S.feed.pause();
    $('sound').hidden = true;
  }
  renderProfile(uid);
}

async function renderProfile(uid) {
  S.profileUid = uid;
  const box = $('profile');
  const token = (renderProfile.token = (renderProfile.token || 0) + 1);
  let list = [];
  try {
    const snap = await videos().where('owner', '==', uid).get();
    list = snap.docs.map(videoData).sort((a, b) => millis(b.createdAt) - millis(a.createdAt));
  } catch (e) { showError(e); }
  if (token !== renderProfile.token) return;
  const own = uid === myUid();
  if (!own) list = list.filter(v => v.ready);

  box.innerHTML = '';
  const head = el('div', 'profile-head');
  if (!own) head.append(button('‹ Zurück', () => go('feed'), 'link back'));
  head.append(avatar(uid, 'huge'), el('h2', null, nameOf(uid)));
  const stats = el('p', 'stats');
  const likes = list.reduce((n, v) => n + (v.likes || 0), 0);
  stats.append(el('span', null, `${list.filter(v => v.ready).length} Videos`), el('span', null, `${likes} Likes`));
  head.append(stats);
  box.append(head);

  if (own) {
    const photo = el('div', 'row photo-row');
    const pick = el('label', 'button-like small', S.me.photo ? 'Profilbild ändern' : 'Profilbild hinzufügen');
    const file = el('input', 'sr-only');
    file.type = 'file';
    file.accept = 'image/*';
    file.onchange = () => file.files[0] && setPhoto(file.files[0]);
    pick.append(file);
    photo.append(pick);
    if (S.me.photo) photo.append(button('Entfernen', () => setPhoto(null), 'small'));
    box.append(photo);

    const rename = el('form', 'row rename');
    const input = el('input', 'grow');
    input.value = S.me.name;
    input.maxLength = 20;
    input.setAttribute('aria-label', 'Dein Name');
    rename.append(input, el('button', '', 'Name ändern'));
    rename.onsubmit = async (e) => {
      e.preventDefault();
      const name = cleanName(input.value);
      const problem = nameProblem(name);
      if (problem) { toast(problem, true); return; }
      if (name === S.me.name && S.me.nameKey) return;
      try {
        await claimName(name);
        toast('Name geändert.');
      } catch (err) { showError(err); }
    };
    box.append(rename);
  }

  const grid = el('div', 'grid');
  list.forEach((v) => {
    const cell = el('button', 'cell');
    cell.type = 'button';
    if (v.thumb) cell.style.backgroundImage = `url("${v.thumb}")`;
    if (v.ready) {
      cell.append(el('span', 'cell-likes', `♥ ${count(v.likes)}`));
      cell.onclick = () => openPlayer(list.filter(x => x.ready), v.id);
    } else {
      cell.classList.add('broken');
      cell.append(el('span', 'cell-note', 'Upload abgebrochen – tippen zum Löschen'));
      cell.onclick = () => deleteVideo(v);
    }
    grid.append(cell);
  });
  if (!list.length) grid.append(el('p', 'dim', own ? 'Du hast noch keine Videos gepostet.' : 'Noch keine Videos.'));
  box.append(grid);

  if (own) renderGroup(box);
}

function renderGroup(box) {
  const sec = el('section', 'group');
  sec.append(el('h3', null, `Gruppe (${S.members.size})`));
  const ul = el('ul', 'list');
  const sorted = [...S.members.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  for (const [uid, m] of sorted) {
    const li = el('li', 'row');
    const open = button('', () => openProfile(uid), 'member grow');
    open.append(avatar(uid), el('span', null, m.name + (uid === myUid() ? ' (du)' : '')));
    li.append(open);
    if (isAdmin() && uid !== myUid()) {
      li.append(button('Entfernen', () => removeMember(uid, m.name, li), 'small'));
    }
    ul.append(li);
  }
  sec.append(ul);
  box.append(sec);

  const share = el('section', 'group');
  share.append(el('h3', null, 'Freunde einladen'));
  share.append(el('p', 'dim small', 'Schick deinen Freunden einfach den Link. Wer sich anmeldet und einen Namen wählt, ist drin.'));
  share.append(button('Link kopieren', () => copy(appLink()), 'primary'));
  box.append(share);

  if (isAdmin()) {
    const ban = el('section', 'group');
    ban.append(el('h3', null, 'Gesperrt'));
    const ul = el('ul', 'list');
    ban.append(ul);
    box.append(ban);
    loadBanned(ul);
  }

  const out = el('section', 'group');
  out.append(button('Abmelden', () => S.auth.signOut(), 'link'));
  box.append(out);
}

function appLink() {
  return `${location.origin}${location.pathname}`;
}

async function loadBanned(ul) {
  try {
    const snap = await S.db.collection('clipsBanned').get();
    ul.innerHTML = '';
    snap.forEach(d => {
      const li = el('li', 'row');
      li.append(el('span', 'grow', d.data().name || 'Unbekannt'),
        button('Entsperren', async () => {
          try { await d.ref.delete(); li.remove(); toast(`${d.data().name} kann wieder beitreten.`); } catch (e) { showError(e); }
        }, 'small'));
      ul.append(li);
    });
    if (snap.empty) ul.append(el('li', 'dim', 'Niemand ist gesperrt.'));
  } catch (e) { showError(e); }
}

async function copy(text, okText = 'Link kopiert.') {
  try {
    await navigator.clipboard.writeText(text);
    toast(okText);
  } catch (e) {
    window.prompt('Zum Kopieren:', text);
  }
}

async function setPhoto(file) {
  try {
    const photo = file ? await makePhoto(file) : null;
    await S.db.collection('clipsMembers').doc(myUid()).update({ photo });
    toast(file ? 'Profilbild gespeichert.' : 'Profilbild entfernt.');
  } catch (e) { showError(e); }
}

async function removeMember(uid, name, li) {
  if (li.dataset.armed !== '1') {
    li.dataset.armed = '1';
    toast(`Nochmal auf „Entfernen“ tippen, um ${name} aus der Gruppe zu werfen und zu sperren.`);
    setTimeout(() => { li.dataset.armed = ''; }, 4000);
    return;
  }
  try {
    const batch = S.db.batch();
    batch.delete(S.db.collection('clipsMembers').doc(uid));
    const key = (S.members.get(uid) || {}).nameKey;
    if (key) batch.delete(names().doc(key));
    // Sperren, sonst könnte die Person über den Link einfach wieder beitreten
    batch.set(S.db.collection('clipsBanned').doc(uid), { name, at: serverTime() });
    await batch.commit();
    toast(`${name} ist raus und gesperrt. Entsperren kannst du unten im Profil.`);
  } catch (e) { showError(e); }
}

// ---------- Player für Profil-Videos ----------
function openPlayer(list, startId) {
  closePlayer();
  $('player').hidden = false;
  S.player = new Feed($('player-feed'));
  S.player.update(list);
  requestAnimationFrame(() => S.player && S.player.scrollToId(startId));
  $('sound').hidden = false;
}

function closePlayer() {
  if (!S.player) return;
  S.player.destroy();
  S.player = null;
  $('player').hidden = true;
  if (S.view !== 'feed') $('sound').hidden = true;
}

// ---------- Kommentare ----------
function openComments(v) {
  closeComments();
  S.comments.video = v;
  $('comments').hidden = false;
  $('comments-title').textContent = 'Kommentare';
  const list = $('comments-list');
  list.innerHTML = '';
  list.append(el('li', 'dim', 'Lädt …'));
  S.comments.unsub = videos().doc(v.id).collection('comments').orderBy('createdAt').limit(300)
    .onSnapshot(snap => {
      list.innerHTML = '';
      $('comments-title').textContent = `${snap.size} Kommentar${snap.size === 1 ? '' : 'e'}`;
      snap.forEach(d => {
        const c = d.data({ serverTimestamps: 'estimate' });
        const li = el('li', 'comment');
        const body = el('div', 'grow');
        const top = el('p', 'comment-top');
        top.append(el('b', null, nameOf(c.uid)), el('span', 'dim', ' · ' + ago(c.createdAt)));
        body.append(top, el('p', 'comment-text', c.text));
        li.append(avatar(c.uid), body);
        if (c.uid === myUid() || v.owner === myUid() || isAdmin()) {
          const del = button('✕', () => deleteComment(v, d.id), 'link small');
          del.setAttribute('aria-label', 'Kommentar löschen');
          li.append(del);
        }
        list.append(li);
      });
      if (snap.empty) list.append(el('li', 'dim', 'Noch keine Kommentare. Schreib den ersten!'));
      list.scrollTop = list.scrollHeight;
    }, showError);
}

function closeComments() {
  if (S.comments.unsub) S.comments.unsub();
  S.comments.unsub = null;
  S.comments.video = null;
  $('comments').hidden = true;
}

async function sendComment(e) {
  e.preventDefault();
  const v = S.comments.video;
  const input = $('comments-input');
  const text = input.value.trim();
  if (!v || !text) return;
  const ref = videos().doc(v.id);
  const batch = S.db.batch();
  batch.set(ref.collection('comments').doc(), { uid: myUid(), text, createdAt: serverTime() });
  batch.update(ref, { comments: inc(1) });
  input.value = '';
  try { await batch.commit(); } catch (err) { input.value = text; showError(err); }
}

async function deleteComment(v, id) {
  const ref = videos().doc(v.id);
  const batch = S.db.batch();
  batch.delete(ref.collection('comments').doc(id));
  batch.update(ref, { comments: inc(-1) });
  try { await batch.commit(); } catch (e) { showError(e); }
}

// ---------- Hochladen ----------
async function pickFile() {
  const file = $('upload-file').files[0];
  const preview = $('upload-preview');
  const info = $('upload-info');
  if (S.upload.probe) disposeVideo(S.upload.probe.el);
  S.upload.probe = null;
  $('upload-submit').disabled = true;
  if (preview.src) URL.revokeObjectURL(preview.src);
  preview.hidden = true;
  info.hidden = true;
  if (!file) return;
  try {
    const probe = await probeVideo(file);
    if (isFinite(probe.duration) && probe.duration > MAX_SECONDS + 0.5) {
      disposeVideo(probe.el);
      throw new Error(`Das Video ist ${minutes(probe.duration)} Minuten lang. Erlaubt sind höchstens ${MAX_SECONDS / 60} Minuten – schneide es vorher kürzer.`);
    }
    if (needsCompression(probe) && !recorderType() && file.size > MAX_BYTES) {
      disposeVideo(probe.el);
      throw new Error('Das Video ist zu groß, und dein Browser kann es nicht verkleinern. Probier es in Chrome oder Safari.');
    }
    S.upload.probe = probe;
    preview.src = URL.createObjectURL(file);
    preview.hidden = false;
    preview.play().catch(() => {});
    const mb = (file.size / 1024 / 1024).toFixed(1);
    info.textContent = `${minutes(probe.duration || 0)} Min. · ${mb} MB` +
      (needsCompression(probe) && recorderType() ? ' · wird vor dem Hochladen verkleinert (dauert so lange wie das Video, lass die Seite dabei offen)' : '');
    info.hidden = false;
    $('upload-submit').disabled = false;
  } catch (e) {
    $('upload-file').value = '';
    showError(e);
  }
}

// 95 -> „1:35“
function minutes(seconds) {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function progress(step, part) {
  $('upload-progress').hidden = false;
  $('upload-step').textContent = step;
  $('upload-bar').style.width = Math.round(part * 100) + '%';
}

// Der erste Teil läuft absichtlich ohne await: Das Verkleinern spielt das
// Video mit Ton ab, und das erlaubt der Browser nur direkt nach dem Tippen.
function postVideo(e) {
  e.preventDefault();
  const probe = S.upload.probe;
  if (!probe || S.upload.busy) return;
  S.upload.probe = null;
  S.upload.busy = true;
  $('upload-submit').disabled = true;
  $('upload-file').disabled = true;
  $('upload-preview').pause();

  let prepared;
  if (needsCompression(probe) && recorderType()) {
    progress('Video wird verkleinert … 0 %', 0);
    prepared = compressVideo(probe, p => progress(`Video wird verkleinert … ${Math.round(p * 100)} %`, p));
  } else {
    disposeVideo(probe.el);
    prepared = Promise.resolve({ blob: probe.file, type: probe.file.type || 'video/mp4' });
  }
  finishUpload(prepared, probe.duration);
}

async function finishUpload(prepared, duration) {
  const caption = $('upload-caption').value.trim().slice(0, 150);
  let ref = null;
  try {
    const { blob, type } = await prepared;
    if (blob.size > MAX_BYTES) throw new Error(`Das Video ist auch verkleinert noch ${(blob.size / 1024 / 1024).toFixed(0)} MB groß. Nimm ein kürzeres.`);
    progress('Vorschaubild …', 0);
    const thumb = await makeThumb(blob).catch(() => null);
    const chunks = Math.ceil(blob.size / CHUNK_BYTES);
    ref = videos().doc();
    await ref.set({
      owner: myUid(), caption, type, size: blob.size, chunks,
      duration: isFinite(duration) ? Math.round(duration * 10) / 10 : 0,
      thumb, likes: 0, comments: 0, ready: false, createdAt: serverTime(),
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    for (let i = 0; i < chunks; i++) {
      progress(`Hochladen … ${Math.round(i / chunks * 100)} %`, i / chunks);
      const part = bytes.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES);
      await ref.collection('chunks').doc(chunkId(i)).set({ data: firebase.firestore.Blob.fromUint8Array(part) });
    }
    S.wantTop = ref.id;
    await ref.update({ ready: true });
    progress('Fertig!', 1);
    resetUpload();
    S.upload.busy = false;
    toast('Video gepostet 🎉');
    go('feed');
    S.feed.root.scrollTo({ top: 0 });
  } catch (err) {
    S.upload.busy = false;
    showError(err);
    if (ref) deleteVideo({ id: ref.id, chunks: MAX_CHUNKS }, true);
    resetUpload(true);
  }
}

function resetUpload(keepCaption = false) {
  $('upload-file').disabled = false;
  $('upload-file').value = '';
  if (!keepCaption) $('upload-caption').value = '';
  $('upload-progress').hidden = true;
  const preview = $('upload-preview');
  preview.pause();
  if (preview.src) URL.revokeObjectURL(preview.src);
  preview.removeAttribute('src');
  preview.hidden = true;
  $('upload-info').hidden = true;
  $('upload-submit').disabled = true;
}

// ---------- Knöpfe ----------
$('login-form').onsubmit = (e) => { e.preventDefault(); login(false); };
$('login-register').onclick = () => login(true);
$('login-forgot').onclick = resetPassword;
$('join-form').onsubmit = join;
$('join-logout').onclick = () => S.auth.signOut();
for (const b of document.querySelectorAll('[data-go]')) b.onclick = () => go(b.dataset.go);
$('feed-new').onclick = showNewVideos;
$('player-close').onclick = () => { closePlayer(); if (S.view === 'feed') S.feed.resume(); };
$('sound').onclick = () => setMuted(!S.muted);
$('comments-close').onclick = closeComments;
$('comments').onclick = (e) => { if (e.target === $('comments')) closeComments(); };
$('comments-form').onsubmit = sendComment;
$('upload-file').onchange = pickFile;
$('upload-form').onsubmit = postVideo;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) flushSeen();
  for (const f of [S.feed, S.player]) {
    if (!f) continue;
    if (document.hidden) f.stop(f.current);
    else if (f === S.player || (S.view === 'feed' && !S.player)) f.resume();
  }
});

init();
