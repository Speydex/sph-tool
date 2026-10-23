/* ============ Clips — Videos nur für dich und deine Freunde ============
 * Läuft komplett im Browser über Firebase (dasselbe Projekt und dieselben
 * Konten wie BörsenTycoon und Schach). Die Regeln aus
 * web/boersentycoon/firestore.rules müssen in der Firebase-Konsole
 * veröffentlicht sein (siehe CLIPS_SETUP.md).
 *
 * Datenmodell:
 *   clipsMembers/{uid}              { name, nameKey, photo, following: [uid], joinedAt }   wer drin ist
 *   clipsBanned/{uid}               { name, at }                vom Admin gesperrt
 *   clipsSeen/{uid}                 { ids: {videoId: ms} }      welche Videos man schon gesehen hat
 *   clipsReports/{videoId_uid}      { videoId, owner, reporter, reason, at }   gemeldete Videos (nur Admin liest)
 *   clipsVideos/{id}.reports        Anzahl Meldungen; ab 1 ist das Video ausgeblendet, bis der Admin entscheidet
 *   clipsNames/{nameKey}            { uid }                     sorgt dafür, dass jeder Name nur einmal vorkommt
 *   clipsVideos/{id}                { owner, caption, type, size, chunks, duration,
 *                                     thumb, likes, comments, ready, createdAt }
 *                                   oder per Link: { owner, caption, kind: 'link', provider,
 *                                     embedId, url, thumb, chunks: 0, likes, comments, ready, createdAt }
 *   clipsVideos/{id}/chunks/{00..}  { data: Bytes }             das Video in Stücken < 1 MB
 *   clipsVideos/{id}/likes/{uid}    { at }
 *   clipsVideos/{id}/comments/{id}  { uid, text, createdAt }
 */
'use strict';

const ADMIN_EMAIL = 'stark.liam2011@gmail.com';
const CHUNK_BYTES = 900 * 1024;
const MAX_CHUNKS = 300;
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
  feedMode: 'all',          // 'all' = Für dich, 'following' = nur Leute, denen man folgt
  allVideos: null,          // für die Suche: alle Videos (einmal geladen)
  seen: new Map(),          // videoId -> wann zuletzt gesehen (ms)
  seenDirty: {},
  feed: null, player: null,
  view: 'feed',
  liked: new Map(),         // videoId -> true/false (nur was schon geladen wurde)
  urls: new Map(),          // videoId -> Promise<objectURL>, älteste zuerst
  muted: true,
  upload: { probe: null, link: null, busy: false },
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

// Symbole (statt Emojis): schlichte Strich-Icons, die überall gleich aussehen
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  heart: '<path d="M12 20.5s-7.5-4.6-9.5-9.2C1.2 8.2 3.2 4.5 6.8 4.5c2.1 0 3.6 1.2 5.2 3 1.6-1.8 3.1-3 5.2-3 3.6 0 5.6 3.7 4.3 6.8-2 4.6-9.5 9.2-9.5 9.2z"/>',
  comment: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  soundOn: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  soundOff: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="m17 9 5 6M22 9l-5 6"/>',
  play: '<path d="M7 4.5v15l13-7.5z"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  camera: '<rect x="2.5" y="6" width="13" height="12" rx="2"/><path d="m15.5 10.5 6-3.5v10l-6-3.5z"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h12l-2.5 4.5L17 13H5"/>',
};

function icon(name, cls = '') {
  const t = document.createElement('template');
  t.innerHTML = `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
  return t.content.firstChild;
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
  if (badWord(name)) return 'Dieser Name ist hier nicht erlaubt. Such dir einen anderen aus.';
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
    const before = JSON.stringify((S.me && S.me.following) || []);
    S.me = S.members.get(myUid());
    if (!S.me.nameKey) migrateName();
    // Neuen Leuten gefolgt oder entfolgt: „Folge ich“-Feed neu sortieren
    if (S.feedMode === 'following' && before !== JSON.stringify(S.me.following || []) && S.order) arrangeFeed({ reset: true });
    S.feed.refreshNames();
    if (S.player) S.player.refreshNames();
    if (S.view === 'profile') renderProfile(S.profileUid);
    if (S.view === 'search') renderSearch();
  }, err => {
    // Passiert, wenn der Admin einen rauswirft: Mitgliedschaft neu prüfen
    if (err.code === 'permission-denied') {
      S.kicked = true;
      onAuth(S.user);
    } else showError(err);
  }));
  watchReports();
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
    S.feedVideos = snap.docs.map(videoData).filter(visible);
    arrangeFeed();
  }, showError);
}

// Gemeldete Videos sind ausgeblendet, bis der Admin sie freigibt
function visible(v) {
  return v.ready && !(v.reports > 0);
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
      + (follows(v.owner) ? 8 : 0)             // Leute, denen man folgt, kommen öfter
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
  const source = S.feedMode === 'following' ? S.feedVideos.filter(v => follows(v.owner)) : S.feedVideos;
  const byId = new Map(source.map(v => [v.id, v]));
  let pending = [];
  if (reset || !S.order || !S.order.length) {
    S.order = rankVideos(source).map(v => v.id);
  } else {
    S.order = S.order.filter(id => byId.has(id));
    const known = new Set(S.order);
    const oldest = Math.min(...S.order.map(id => millis(byId.get(id).createdAt)));
    const extra = source.filter(v => !known.has(v.id));
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
  $('feed-empty').hidden = source.length > 0;
  const followingMode = S.feedMode === 'following';
  $('feed-empty-text').textContent = followingMode
    ? (myFollowing().size ? 'Die Leute, denen du folgst, haben noch nichts gepostet.' : 'Du folgst noch niemandem.')
    : 'Noch keine Videos.';
  $('feed-empty-btn').textContent = followingMode ? 'Kanäle suchen' : 'Erstes Video posten';
  $('feed-empty-btn').dataset.go = followingMode ? 'search' : 'upload';
}

function setFeedMode(mode) {
  if (S.feedMode === mode) return;
  S.feedMode = mode;
  for (const b of document.querySelectorAll('.feed-mode')) b.classList.toggle('active', b.dataset.mode === mode);
  arrangeFeed({ reset: true });
  S.feed.root.scrollTo({ top: 0 });
}

// ---------- Folgen ----------
function myFollowing() {
  return new Set((S.me && S.me.following) || []);
}

function follows(uid) {
  return myFollowing().has(uid);
}

function followerCount(uid) {
  let n = 0;
  for (const m of S.members.values()) if ((m.following || []).includes(uid)) n++;
  return n;
}

async function toggleFollow(uid) {
  if (uid === myUid()) return;
  const was = follows(uid);
  const field = firebase.firestore.FieldValue;
  try {
    await S.db.collection('clipsMembers').doc(myUid())
      .update({ following: was ? field.arrayRemove(uid) : field.arrayUnion(uid) });
    toast(was ? `Du folgst ${nameOf(uid)} nicht mehr.` : `Du folgst jetzt ${nameOf(uid)}.`);
  } catch (e) { showError(e); }
}

function followButton(uid, cls = '') {
  const on = follows(uid);
  const b = button(on ? 'Folge ich' : 'Folgen', (e) => { e.stopPropagation(); toggleFollow(uid); },
    (on ? 'small following ' : 'small primary ') + cls);
  return b;
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

const VIEWS = ['feed', 'search', 'upload', 'profile'];

function go(view) {
  if (S.upload.busy && view !== 'upload') { toast('Warte, bis dein Video hochgeladen ist.'); return; }
  S.view = view;
  for (const v of VIEWS) $('view-' + v).hidden = v !== view;
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.go === view);
  closePlayer();
  if (view === 'search') openSearch();
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

// ---------- Videos per Link (TikTok, YouTube) ----------
// Solche Videos werden nicht in Clips gespeichert, sondern eingebettet: Sie
// laufen über den Player von TikTok bzw. YouTube.
const PROVIDERS = { tiktok: 'TikTok', youtube: 'YouTube' };

function parseVideoLink(raw) {
  let u;
  try { u = new URL(raw.trim()); } catch (e) { return null; }
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '');
  const parts = u.pathname.split('/').filter(Boolean);
  if (host === 'youtu.be' && parts[0]) return { provider: 'youtube', id: parts[0] };
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const id = u.searchParams.get('v') || (['shorts', 'embed', 'live'].includes(parts[0]) ? parts[1] : null);
    return id ? { provider: 'youtube', id } : null;
  }
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) {
    const i = parts.indexOf('video');
    const id = i >= 0 ? parts[i + 1] : (parts[0] === 'player' || parts[0] === 'embed' ? parts[parts.length - 1] : null);
    // Kurzlinks (vm.tiktok.com/…) werden unten über TikTok aufgelöst
    return { provider: 'tiktok', id: id && /^\d+$/.test(id) ? id : null };
  }
  return null;
}

async function resolveVideoLink(raw) {
  const link = parseVideoLink(raw);
  if (!link) throw new Error('Das ist kein TikTok- oder YouTube-Link.');
  const url = raw.trim();
  let info = {};
  try {
    const api = link.provider === 'youtube'
      ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`
      : `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
    const res = await fetch(api);
    if (res.ok) info = await res.json();
  } catch (e) { console.warn('oEmbed nicht erreichbar', e); }
  const id = link.id || info.embed_product_id;
  if (!id || !/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw new Error('Zu diesem Link wurde kein Video gefunden. Ist das Video öffentlich?');
  const thumb = link.provider === 'youtube' ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : (info.thumbnail_url || null);
  return { provider: link.provider, embedId: id, url: url.slice(0, 500), title: info.title || '', thumb };
}

function embedUrl(v) {
  if (v.provider === 'youtube') {
    return `https://www.youtube-nocookie.com/embed/${v.embedId}?autoplay=1&mute=1&playsinline=1&loop=1&playlist=${v.embedId}`
      + '&controls=0&rel=0&modestbranding=1&enablejsapi=1';
  }
  return `https://www.tiktok.com/player/v1/${v.embedId}?autoplay=1&muted=1&loop=1&controls=0&progress_bar=0`
    + '&play_button=0&volume_control=0&fullscreen_button=0&timestamp=0&music_info=0&description=0&rel=0'
    + '&native_context_menu=0&closed_caption=0';
}

// Tut für den Feed so, als wäre es ein <video>: play, pause, muted, src.
// Gesteuert wird der fremde Player per postMessage.
class EmbedPlayer {
  constructor(v) {
    this.v = v;
    this.el = el('iframe', 'embed');
    this.el.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
    this.el.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    this.el.title = PROVIDERS[v.provider] + '-Video';
    this.embedUrl = embedUrl(v);
    this.paused = true;
    this._muted = true;
    this.onSeen = null;
    this.el.addEventListener('load', () => setTimeout(() => this.sync(), 800));
  }

  send(cmd) {
    const w = this.el.contentWindow;
    if (!w || !this.el.getAttribute('src')) return;
    if (this.v.provider === 'youtube') {
      const func = { play: 'playVideo', pause: 'pauseVideo', mute: 'mute', unMute: 'unMute' }[cmd];
      w.postMessage(JSON.stringify({ event: 'command', func, args: [] }), '*');
    } else {
      w.postMessage({ type: cmd, value: null, 'x-tiktok-player': true }, '*');
    }
  }

  sync() {
    this.send(this.paused ? 'pause' : 'play');
    this.send(this._muted ? 'mute' : 'unMute');
  }

  get muted() { return this._muted; }
  set muted(m) { this._muted = m; this.send(m ? 'mute' : 'unMute'); }
  set src(url) { this.el.src = url; }
  getAttribute(name) { return this.el.getAttribute(name); }
  removeAttribute(name) { this.el.removeAttribute(name); clearTimeout(this.seenTimer); }
  load() { /* nichts zu tun, removeAttribute('src') hat den Player schon entladen */ }
  set poster(_) { /* Vorschaubild zeigt der fremde Player selbst */ }
  get poster() { return ''; }

  play() {
    this.paused = false;
    this.send('play');
    clearTimeout(this.seenTimer);
    this.seenTimer = setTimeout(() => { if (!this.paused && this.onSeen) this.onSeen(); }, 3000);
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
    clearTimeout(this.seenTimer);
    this.send('pause');
  }
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
    const embed = v.kind === 'link';
    const video = embed ? new EmbedPlayer(v) : el('video');
    if (!embed) {
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.loop = true;
      video.preload = 'auto';
    }
    const spinner = el('div', 'spinner');
    const paused = el('div', 'paused-icon');
    paused.append(icon('play', 'filled'));
    const fail = el('p', 'slide-error');
    const tap = el('div', 'tap-area');

    const meta = el('div', 'meta');
    const who = button('', () => openProfile(s.data.owner), 'who');
    const when = el('span', 'when');
    const caption = el('p', 'caption');
    meta.append(who, when, caption);

    const actions = el('div', 'actions');
    const prof = button('', () => openProfile(s.data.owner), 'act prof');
    const like = button('', () => this.toggleLike(s), 'act like');
    like.append(icon('heart', 'ico'), el('span', 'n'));
    const comment = button('', () => openComments(s.data), 'act');
    comment.append(icon('comment', 'ico'), el('span', 'n'));
    const rep = button('', () => openReport(s.data), 'act rep');
    rep.append(icon('flag', 'ico'), el('span', 'n', 'Melden'));
    const del = button('', () => this.askDelete(s), 'act del');
    del.append(icon('trash', 'ico'), el('span', 'n', 'Löschen'));
    actions.append(prof, like, comment, rep, del);

    root.append(embed ? video.el : video, spinner, paused, fail, tap, meta, actions);
    const s = { root, video, embed, spinner, paused, fail, who, when, caption, prof, like, comment, rep, del, data: v };
    if (embed) {
      video.onSeen = () => {
        if (!s.counted) { s.counted = true; markSeen(v.id); }
      };
    }

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
    if (!embed) this.listenVideo(s);
    spinner.hidden = true;
    paused.hidden = true;
    fail.hidden = true;
    this.fill(s);
    return s;
  }

  listenVideo(s) {
    const { video, spinner, paused } = s;
    video.addEventListener('waiting', () => { spinner.hidden = false; });
    video.addEventListener('timeupdate', () => {
      if (s.counted || !video.duration) return;
      if (video.currentTime >= Math.min(SEEN_AFTER_S, video.duration * 0.8)) {
        s.counted = true;
        markSeen(s.data.id);
      }
    });
    video.addEventListener('playing', () => { spinner.hidden = true; paused.hidden = true; });
  }

  fill(s) {
    const v = s.data;
    if (v.thumb && s.video.poster !== v.thumb) s.video.poster = v.thumb;
    s.who.textContent = '@' + nameOf(v.owner);
    s.when.textContent = ' · ' + ago(v.createdAt) + (s.embed ? ' · ' + PROVIDERS[v.provider] : '');
    s.caption.textContent = v.caption || '';
    s.caption.hidden = !v.caption;
    s.prof.replaceChildren(avatar(v.owner, 'big'));
    if (v.owner !== myUid() && !follows(v.owner)) {
      // Kleines Plus unter dem Profilbild wie bei TikTok
      const plus = el('span', 'follow-badge');
      plus.append(icon('plus'));
      plus.title = 'Folgen';
      plus.onclick = (e) => { e.stopPropagation(); toggleFollow(v.owner); };
      s.prof.append(plus);
    }
    s.like.querySelector('.n').textContent = count(v.likes);
    s.like.classList.toggle('on', !!S.liked.get(v.id));
    s.comment.querySelector('.n').textContent = count(v.comments);
    s.del.hidden = !(v.owner === myUid() || isAdmin());
    s.rep.hidden = v.owner === myUid() || v.reports > 0;
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
    for (const n of [this.videos[idx + 1], this.videos[idx - 1]]) if (n && n.kind !== 'link') videoUrl(n).catch(() => {});
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
        const url = s.embed ? s.video.embedUrl : await videoUrl(s.data);
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
    const h = el('span', 'heart-burst');
    h.append(icon('heart', 'filled'));
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
  $('sound').replaceChildren(icon(m ? 'soundOff' : 'soundOn'));
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
    const refs = [];
    for (let i = 0; i < v.chunks; i++) refs.push(ref.collection('chunks').doc(chunkId(i)));
    if (isAdmin()) {
      const reports = await S.db.collection('clipsReports').where('videoId', '==', v.id).get();
      reports.forEach(d => refs.push(d.ref));
    }
    for (const sub of ['likes', 'comments']) {
      const snap = await ref.collection(sub).get();
      snap.forEach(d => refs.push(d.ref));
    }
    // Ein Batch darf höchstens 500 Schreibvorgänge haben
    for (let i = 0; i < refs.length; i += 400) {
      const batch = S.db.batch();
      refs.slice(i, i + 400).forEach(r => batch.delete(r));
      await batch.commit();
    }
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
    S.profileBack = S.view;
    S.view = 'profile';
    for (const v of VIEWS) $('view-' + v).hidden = v !== 'profile';
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
  if (!own) list = list.filter(visible);

  box.innerHTML = '';
  const head = el('div', 'profile-head');
  if (!own) head.append(button('‹ Zurück', () => go(S.profileBack || 'feed'), 'link back'));
  head.append(avatar(uid, 'huge'), el('h2', null, nameOf(uid)));
  const stats = el('p', 'stats');
  const likes = list.reduce((n, v) => n + (v.likes || 0), 0);
  const followingCount = ((S.members.get(uid) || {}).following || []).filter(f => S.members.has(f)).length;
  stats.append(
    stat(list.filter(v => v.ready).length, 'Videos'),
    stat(followerCount(uid), 'Follower'),
    stat(followingCount, 'Folgt'),
    stat(likes, 'Likes'));
  head.append(stats);
  if (!own && S.members.has(uid)) head.append(followButton(uid, 'follow-big'));
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
    if (visible(v)) {
      grid.append(videoCell(v, () => openPlayer(list.filter(visible), v.id)));
      return;
    }
    if (v.ready) {
      // Eigenes gemeldetes Video: nur für einen selbst sichtbar
      const cell = videoCell(v, () => openPlayer([v], v.id));
      cell.classList.add('broken');
      cell.append(el('span', 'cell-note', 'Gemeldet – wird vom Admin geprüft'));
      grid.append(cell);
      return;
    }
    const cell = el('button', 'cell');
    cell.type = 'button';
    if (v.thumb) cell.style.backgroundImage = `url("${v.thumb}")`;
    cell.classList.add('broken');
    cell.append(el('span', 'cell-note', 'Upload abgebrochen – tippen zum Löschen'));
    cell.onclick = () => deleteVideo(v);
    grid.append(cell);
  });
  if (!list.length) grid.append(el('p', 'dim', own ? 'Du hast noch keine Videos gepostet.' : 'Noch keine Videos.'));
  box.append(grid);

  if (own) renderGroup(box);
}

function stat(n, label) {
  const s = el('span', 'stat');
  s.append(el('b', null, count(n)), el('span', null, label));
  return s;
}

// ---------- Suche ----------
async function openSearch() {
  renderSearch();
  // Für die Suche alle Videos einmal holen (der Feed lädt nur die neuesten)
  if (!S.allVideos || Date.now() - S.allVideosAt > 60000) {
    try {
      const snap = await videos().orderBy('createdAt', 'desc').limit(500).get();
      S.allVideos = snap.docs.map(videoData).filter(visible);
      S.allVideosAt = Date.now();
      if (S.view === 'search') renderSearch();
    } catch (e) { showError(e); }
  }
}

function normalize(text) {
  return (text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function renderSearch() {
  const box = $('search-results');
  const q = normalize($('search-input').value.trim()).replace(/^@/, '');
  box.innerHTML = '';

  // Kanäle
  const channels = [...S.members.entries()]
    .filter(([uid, m]) => !q || normalize(m.name).includes(q))
    .sort((a, b) => followerCount(b[0]) - followerCount(a[0]) || a[1].name.localeCompare(b[1].name));
  const all = S.allVideos || [];
  if (channels.length) {
    box.append(el('h3', 'search-head', q ? 'Kanäle' : 'Alle Kanäle'));
    const ul = el('ul', 'list channels');
    for (const [uid, m] of channels.slice(0, q ? 20 : 50)) {
      const li = el('li', 'row');
      const open = button('', () => openProfile(uid), 'member grow');
      const text = el('span', 'channel-text');
      const n = all.filter(v => v.owner === uid).length;
      text.append(el('b', null, m.name + (uid === myUid() ? ' (du)' : '')),
        el('span', 'dim small', `${followerCount(uid)} Follower · ${n} Videos`));
      open.append(avatar(uid, 'mid'), text);
      li.append(open);
      if (uid !== myUid()) li.append(followButton(uid));
      ul.append(li);
    }
    box.append(ul);
  }

  // Videos: Beschreibung, #hashtags oder Name passen
  if (q) {
    const found = all.filter(v => normalize(v.caption).includes(q) || normalize(nameOf(v.owner)).includes(q));
    if (found.length || channels.length) box.append(el('h3', 'search-head', 'Videos'));
    if (found.length) {
      const grid = el('div', 'grid');
      for (const v of found) grid.append(videoCell(v, () => openPlayer(found, v.id), true));
      box.append(grid);
    }
    if (!found.length && !channels.length) box.append(el('p', 'dim', `Nichts gefunden für „${$('search-input').value.trim()}“.`));
    else if (!found.length) box.append(el('p', 'dim', 'Keine passenden Videos.'));
  } else if (!S.allVideos) {
    box.append(el('p', 'dim', 'Lädt …'));
  }
}

// Vorschaubild für Raster (Profil und Suche)
function videoCell(v, onClick, withName = false) {
  const cell = el('button', 'cell');
  cell.type = 'button';
  if (v.thumb) cell.style.backgroundImage = `url("${v.thumb}")`;
  const likes = el('span', 'cell-likes');
  likes.append(icon('heart', 'filled'), document.createTextNode(count(v.likes)));
  cell.append(likes);
  if (withName) cell.append(el('span', 'cell-name', '@' + nameOf(v.owner)));
  if (v.kind === 'link') cell.append(el('span', 'cell-provider', PROVIDERS[v.provider]));
  if (v.caption) cell.title = v.caption;
  cell.onclick = onClick;
  return cell;
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
    const rep = el('section', 'group');
    rep.append(el('h3', null, 'Gemeldete Videos'));
    const repList = el('ul', 'list reports');
    rep.append(repList);
    // Ganz oben im Profil, damit der Admin Meldungen sofort sieht
    box.insertBefore(rep, box.querySelector('.grid'));
    loadReports(repList);

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

// ---------- Melden ----------
const REASONS = {
  nsfw: 'Nicht jugendfrei', violence: 'Gewalt/Ekliges', bullying: 'Beleidigung/Mobbing', other: 'Anderes',
};

function openReport(v) {
  S.reporting = v;
  $('report').hidden = false;
}

function closeReport() {
  S.reporting = null;
  $('report').hidden = true;
}

async function sendReport(reason) {
  const v = S.reporting;
  closeReport();
  if (!v) return;
  const ref = videos().doc(v.id);
  const batch = S.db.batch();
  batch.set(S.db.collection('clipsReports').doc(`${v.id}_${myUid()}`), {
    videoId: v.id, owner: v.owner, reporter: myUid(), reason, at: serverTime(),
  });
  batch.update(ref, { reports: inc(1) });
  try {
    await batch.commit();
    toast('Danke! Das Video ist ausgeblendet, bis der Admin es geprüft hat.');
    if (S.player) {
      S.player.update(S.player.videos.filter(x => x.id !== v.id));
      if (!S.player.videos.length) closePlayer();
    }
  } catch (e) {
    if (e.code === 'permission-denied') toast('Du hast dieses Video schon gemeldet.', true);
    else showError(e);
  }
}

// Für den Admin: Liste der gemeldeten Videos mit Gründen
async function loadReports(ul) {
  try {
    const snap = await videos().where('reports', '>', 0).get();
    ul.innerHTML = '';
    for (const d of snap.docs) {
      const v = videoData(d);
      const reasons = await S.db.collection('clipsReports').where('videoId', '==', v.id).get();
      const why = [...new Set(reasons.docs.map(r => REASONS[r.data().reason] || 'Anderes'))].join(', ');
      const li = el('li', 'report-item');
      const thumb = el('button', 'report-thumb');
      thumb.type = 'button';
      if (v.thumb) thumb.style.backgroundImage = `url("${v.thumb}")`;
      thumb.onclick = () => openPlayer([v], v.id);
      const info = el('div', 'grow');
      info.append(el('b', null, `@${nameOf(v.owner)}`), el('p', 'dim small', v.caption || '(ohne Beschreibung)'),
        el('p', 'small', `${v.reports}× gemeldet: ${why}`));
      const btns = el('div', 'row');
      btns.append(
        button('Ansehen', () => openPlayer([v], v.id), 'small'),
        button('Freigeben', () => approveVideo(v, reasons.docs), 'small'),
        button('Löschen', () => deleteVideo(v).then(() => renderProfile(myUid())), 'small danger'));
      info.append(btns);
      li.append(thumb, info);
      ul.append(li);
    }
    if (snap.empty) ul.append(el('li', 'dim', 'Nichts gemeldet.'));
    S.reportCount = snap.size;
    updateReportBadge();
  } catch (e) { showError(e); }
}

async function approveVideo(v, reportDocs) {
  const batch = S.db.batch();
  reportDocs.forEach(d => batch.delete(d.ref));
  batch.update(videos().doc(v.id), { reports: 0 });
  try {
    await batch.commit();
    toast('Video freigegeben. Alle sehen es wieder.');
    renderProfile(myUid());
  } catch (e) { showError(e); }
}

// Roter Punkt am Profil-Tab, wenn es etwas zu prüfen gibt
function watchReports() {
  if (!isAdmin()) return;
  S.unsubs.push(videos().where('reports', '>', 0).onSnapshot(snap => {
    S.reportCount = snap.size;
    updateReportBadge();
  }, e => console.warn(e)));
}

function updateReportBadge() {
  const tab = document.querySelector('.tab[data-go=profile]');
  if (tab) tab.classList.toggle('has-badge', isAdmin() && S.reportCount > 0);
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
    if (photo) {
      toast('Bild wird geprüft …');
      if (!(await checkImageUrl(photo))) throw new Error('Dieses Bild ist hier nicht erlaubt. Nimm ein anderes.');
    }
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
          const del = button('', () => deleteComment(v, d.id), 'link small');
          del.append(icon('close'));
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
  if (badWord(text)) { toast('Dein Kommentar enthält ein Wort, das hier nicht erlaubt ist.', true); return; }
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
// Link einfügen: erkennen, Vorschau zeigen, Posten freischalten
async function pickLink() {
  const raw = $('upload-link').value.trim();
  const box = $('link-preview');
  S.upload.link = null;
  box.hidden = true;
  if (!raw) { $('upload-submit').disabled = !S.upload.probe; return; }
  // Ein Link ersetzt eine ausgewählte Datei
  if (S.upload.probe) { disposeVideo(S.upload.probe.el); S.upload.probe = null; }
  $('upload-file').value = '';
  $('upload-preview').hidden = true;
  $('upload-info').hidden = true;
  $('upload-submit').disabled = true;
  const token = (pickLink.token = (pickLink.token || 0) + 1);
  box.replaceChildren(el('p', 'dim small', 'Link wird geprüft …'));
  box.hidden = false;
  try {
    const link = await resolveVideoLink(raw);
    if (token !== pickLink.token) return;
    if (badWord(link.title)) throw new Error('Dieses Video ist hier nicht erlaubt.');
    S.upload.link = link;
    box.innerHTML = '';
    if (link.thumb) {
      const img = el('img', 'link-thumb');
      img.src = link.thumb;
      img.alt = '';
      box.append(img);
    }
    const text = el('div', 'link-text');
    text.append(el('b', null, `${PROVIDERS[link.provider]}-Video erkannt`), el('span', 'dim small', link.title || link.url));
    box.append(text);
    if (!$('upload-caption').value.trim() && link.title) $('upload-caption').value = link.title.slice(0, 150);
    $('upload-submit').disabled = false;
  } catch (e) {
    if (token !== pickLink.token) return;
    box.replaceChildren(el('p', 'error-text small', e.message));
  }
}

async function postLink() {
  const link = S.upload.link;
  if (!link || S.upload.busy) return;
  S.upload.busy = true;
  $('upload-submit').disabled = true;
  try {
    if (badWord(link.title)) throw new Error(BLOCKED_VIDEO);
    if (link.thumb) {
      toast('Video wird geprüft …');
      // Vorschaubild prüfen. Lädt es nicht (z. B. TikTok), entscheidet der Titel.
      const ok = await checkImageUrl(link.thumb).catch(e => (e.message.includes('Inhaltsprüfung') ? Promise.reject(e) : true));
      if (!ok) throw new Error(BLOCKED_VIDEO);
    }
    const ref = videos().doc();
    S.wantTop = ref.id;
    await ref.set({
      owner: myUid(), caption: $('upload-caption').value.trim().slice(0, 150),
      kind: 'link', provider: link.provider, embedId: link.embedId, url: link.url, thumb: link.thumb,
      chunks: 0, likes: 0, comments: 0, ready: true, createdAt: serverTime(),
    });
    resetUpload();
    S.upload.busy = false;
    toast('Video gepostet!');
    go('feed');
    S.feed.root.scrollTo({ top: 0 });
  } catch (e) {
    S.upload.busy = false;
    $('upload-submit').disabled = false;
    showError(e);
  }
}

const BLOCKED_VIDEO = 'Das Video wurde nicht hochgeladen, weil es nicht jugendfrei aussieht. '
  + 'Falls das ein Irrtum ist, sag dem Admin Bescheid.';

function postVideo(e) {
  e.preventDefault();
  if (badWord($('upload-caption').value)) {
    toast('In der Beschreibung steht ein Wort, das hier nicht erlaubt ist.', true);
    return;
  }
  if (S.upload.link) { postLink(); return; }
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
    if (blob.size > MAX_BYTES) throw new Error(`Das Video ist auch verkleinert noch ${(blob.size / 1024 / 1024).toFixed(0)} MB groß. Das ist zu groß für die Datenbank – schneide es etwas kürzer.`);
    progress('Inhalt wird geprüft …', 0);
    const clean = await checkVideo(blob, duration, p => progress(`Inhalt wird geprüft … ${Math.round(p * 100)} %`, p));
    if (!clean) throw new Error(BLOCKED_VIDEO);
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
    toast('Video gepostet!');
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
  S.upload.link = null;
  $('upload-link').value = '';
  $('link-preview').hidden = true;
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
for (const b of document.querySelectorAll('.feed-mode')) b.onclick = () => setFeedMode(b.dataset.mode);
$('search-input').oninput = renderSearch;
$('search-form').onsubmit = (e) => { e.preventDefault(); $('search-input').blur(); };
$('player-close').onclick = () => { closePlayer(); if (S.view === 'feed') S.feed.resume(); };
$('sound').onclick = () => setMuted(!S.muted);
$('comments-close').onclick = closeComments;
$('comments').onclick = (e) => { if (e.target === $('comments')) closeComments(); };
$('comments-form').onsubmit = sendComment;
$('report-close').onclick = closeReport;
$('report').onclick = (e) => { if (e.target === $('report')) closeReport(); };
for (const b of document.querySelectorAll('[data-reason]')) b.onclick = () => sendReport(b.dataset.reason);
$('upload-file').onchange = () => {
  // Eine Datei ersetzt einen eingefügten Link
  S.upload.link = null;
  $('upload-link').value = '';
  $('link-preview').hidden = true;
  pickFile();
};
$('upload-link').oninput = () => { clearTimeout(pickLink.timer); pickLink.timer = setTimeout(pickLink, 400); };
$('upload-form').onsubmit = postVideo;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) flushSeen();
  for (const f of [S.feed, S.player]) {
    if (!f) continue;
    if (document.hidden) f.stop(f.current);
    else if (f === S.player || (S.view === 'feed' && !S.player)) f.resume();
  }
});

// Platzhalter <span data-icon="…"> im HTML durch die Symbole ersetzen
for (const e of document.querySelectorAll('[data-icon]')) e.replaceWith(icon(e.dataset.icon, e.className));

init();
