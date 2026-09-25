/* ============ Schach — Online mit Freunden ============
 * Konten, Freundesliste und Live-Partien über Firebase (dasselbe Projekt und
 * dieselben Konten wie BörsenTycoon). Damit das funktioniert, müssen die
 * Regeln aus web/boersentycoon/firestore.rules in der Firebase-Konsole
 * veröffentlicht sein (siehe ONLINE_SETUP.md).
 *
 * Datenmodell:
 *   chessProfiles/{uid}   { name, friendCode }
 *   chessFriends/{a_b}    { members: [a, b], names: {uid: name}, requestedBy, status: pending|accepted }
 *   chessGames/{id}       { players, white, black, whiteName, blackName, createdBy,
 *                           status: invited|active|finished, moves: ['e2e4', ...],
 *                           result: '1-0'|'0-1'|'1/2-1/2'|null, reason, drawOffer }
 */
'use strict';

const OL = {
  auth: null, db: null, user: null, profile: null,
  friends: [], games: [], unsubs: [], gameUnsub: null,
};
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const OL_SECTIONS = ['ol-off', 'ol-login', 'ol-name', 'ol-lobby'];

const serverTime = () => firebase.firestore.FieldValue.serverTimestamp();
const toUci = (h) => sqName(h.from) + sqName(h.to) + (h.promo || '');
const parseUci = (u) => [sqIndex(u.slice(0, 2)), sqIndex(u.slice(2, 4)), u[4] || null];
const myUid = () => OL.user && OL.user.uid;

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

function olShow(id) {
  for (const s of OL_SECTIONS) $(s).hidden = s !== id;
}

function olMsg(text, isError = false) {
  const p = $('ol-msg');
  p.textContent = text || '';
  p.classList.toggle('error', isError);
  p.hidden = !text;
  // Hinweise verschwinden von selbst, Fehler bleiben stehen
  clearTimeout(olMsg.timer);
  if (text && !isError) olMsg.timer = setTimeout(() => { p.hidden = true; }, 6000);
}

function olErrorText(e) {
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
    'permission-denied': 'Keine Berechtigung. Sind die neuen Firestore-Regeln schon veröffentlicht? (siehe ONLINE_SETUP.md)',
    'unavailable': 'Keine Verbindung zum Server. Prüfe dein Internet.',
  };
  return map[code] || (e && e.message) || 'Unbekannter Fehler.';
}

function olError(e) {
  console.error(e);
  olMsg(olErrorText(e), true);
}

// ---------- Start & Anmeldung ----------
function olInit() {
  if (typeof firebase === 'undefined' || typeof FIREBASE_CONFIG === 'undefined' || !FIREBASE_CONFIGURED) {
    olShow('ol-off');
    return;
  }
  try {
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    OL.auth = firebase.auth();
    OL.db = firebase.firestore();
  } catch (e) {
    console.error(e);
    olShow('ol-off');
    return;
  }
  OL.auth.onAuthStateChanged(onAuth);
}

async function onAuth(user) {
  olStopListeners();
  OL.user = user;
  OL.profile = null;
  olMsg('');
  if (!user) {
    if (online) { leaveOnlineGame(); load(); }
    olShow('ol-login');
    return;
  }
  try {
    const snap = await OL.db.collection('chessProfiles').doc(user.uid).get();
    OL.profile = snap.exists ? snap.data() : null;
  } catch (e) {
    olShow('ol-login');
    olError(e);
    return;
  }
  if (!OL.profile || !OL.profile.name) {
    $('ol-name-input').value = (user.email || '').split('@')[0].slice(0, 20);
    olShow('ol-name');
    return;
  }
  olStartLobby();
}

async function olLogin(register) {
  const email = $('ol-email').value.trim();
  const pw = $('ol-password').value;
  olMsg('');
  try {
    if (register) await OL.auth.createUserWithEmailAndPassword(email, pw);
    else await OL.auth.signInWithEmailAndPassword(email, pw);
    $('ol-password').value = '';
  } catch (e) {
    olError(e);
  }
}

async function olResetPassword() {
  const email = $('ol-email').value.trim();
  if (!email) { olMsg('Gib oben deine E-Mail ein, dann schicke ich dir einen Link zum Zurücksetzen.', true); return; }
  try {
    await OL.auth.sendPasswordResetEmail(email);
    olMsg(`Link zum Zurücksetzen an ${email} geschickt.`);
  } catch (e) { olError(e); }
}

async function olNewCode() {
  for (let tries = 0; tries < 5; tries++) {
    let code = '';
    for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    const taken = await OL.db.collection('chessProfiles').where('friendCode', '==', code).limit(1).get();
    if (taken.empty) return code;
  }
  throw new Error('Konnte keinen freien Freundescode finden. Versuch es nochmal.');
}

async function olSaveName(e) {
  e.preventDefault();
  const name = $('ol-name-input').value.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 20) { olMsg('Der Name muss 2 bis 20 Zeichen lang sein.', true); return; }
  try {
    const friendCode = (OL.profile && OL.profile.friendCode) || await olNewCode();
    await OL.db.collection('chessProfiles').doc(myUid()).set({ name, friendCode, updatedAt: serverTime() }, { merge: true });
    OL.profile = { name, friendCode };
    olMsg('');
    olStartLobby();
  } catch (err) { olError(err); }
}

function olStopListeners() {
  for (const u of OL.unsubs) u();
  OL.unsubs = [];
  OL.friends = [];
  OL.games = [];
}

// ---------- Lobby ----------
function olStartLobby() {
  olStopListeners();
  olShow('ol-lobby');
  $('ol-me').textContent = OL.profile.name;
  $('ol-code').textContent = OL.profile.friendCode;
  const uid = myUid();
  OL.unsubs.push(OL.db.collection('chessFriends').where('members', 'array-contains', uid)
    .onSnapshot(snap => {
      OL.friends = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      olRenderLobby();
    }, olError));
  OL.unsubs.push(OL.db.collection('chessGames').where('players', 'array-contains', uid)
    .onSnapshot(snap => {
      OL.games = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      olRenderLobby();
    }, olError));
  olRenderLobby();
}

const otherUid = (members) => members.find(m => m !== myUid());
const opponentOf = (g) => (g.white === myUid() ? g.blackName : g.whiteName);
const myColorIn = (g) => (g.white === myUid() ? 'w' : 'b');
const myTurnIn = (g) => g.status === 'active' && ((g.moves || []).length % 2 === 0 ? 'w' : 'b') === myColorIn(g);
const timeOf = (g) => (g.updatedAt && g.updatedAt.toMillis ? g.updatedAt.toMillis() : Date.now());

function olRenderLobby() {
  if (!OL.profile) return;
  const uid = myUid();

  // Einladungen und Anfragen an mich
  const invites = $('ol-invites');
  invites.innerHTML = '';
  for (const f of OL.friends.filter(f => f.status === 'pending' && f.requestedBy !== uid)) {
    const li = el('li', 'row');
    li.append(el('span', 'grow', `${f.names[f.requestedBy]} möchte mit dir befreundet sein`),
      button('Annehmen', () => olAcceptFriend(f), 'primary small'),
      button('Ablehnen', () => olRemoveFriend(f), 'small'));
    invites.appendChild(li);
  }
  for (const g of OL.games.filter(g => g.status === 'invited' && g.createdBy !== uid)) {
    const li = el('li', 'row');
    li.append(el('span', 'grow', `${opponentOf(g)} fordert dich heraus (du spielst ${myColorIn(g) === 'w' ? 'Weiß' : 'Schwarz'})`),
      button('Annehmen', () => olAcceptGame(g), 'primary small'),
      button('Ablehnen', () => olDeleteGame(g), 'small'));
    invites.appendChild(li);
  }
  $('ol-invites-box').hidden = !invites.children.length;

  // Laufende Partien
  const games = $('ol-games');
  games.innerHTML = '';
  const running = OL.games
    .filter(g => g.status === 'active' || (g.status === 'invited' && g.createdBy === uid))
    .sort((a, b) => timeOf(b) - timeOf(a));
  for (const g of running) {
    const li = el('li', 'row');
    const state = g.status === 'invited' ? 'wartet auf Annahme' : myTurnIn(g) ? 'Du bist dran' : `${opponentOf(g)} ist dran`;
    const info = el('span', 'grow');
    info.append(el('b', null, `gegen ${opponentOf(g)}`), el('span', 'dim' + (myTurnIn(g) ? ' your-turn' : ''), ` · ${state}`));
    li.append(info, button(online && online.id === g.id ? 'Offen' : 'Öffnen', () => olOpenGame(g.id), 'small'));
    games.appendChild(li);
  }
  if (!running.length) games.appendChild(el('li', 'dim', 'Keine laufenden Partien. Fordere unten einen Freund heraus.'));

  // Beendete Partien (die letzten 5)
  const done = $('ol-done');
  done.innerHTML = '';
  const finished = OL.games.filter(g => g.status === 'finished').sort((a, b) => timeOf(b) - timeOf(a)).slice(0, 5);
  for (const g of finished) {
    const mine = myColorIn(g) === 'w' ? '1-0' : '0-1';
    const outcome = g.result === '1/2-1/2' ? 'Remis' : g.result === mine ? 'Gewonnen' : 'Verloren';
    const li = el('li', 'row');
    li.append(el('span', 'grow', `gegen ${opponentOf(g)} · ${outcome}`), button('Ansehen', () => olOpenGame(g.id), 'small'));
    done.appendChild(li);
  }
  $('ol-done-box').hidden = !finished.length;

  // Freunde
  const friends = $('ol-friends');
  friends.innerHTML = '';
  const accepted = OL.friends.filter(f => f.status === 'accepted')
    .sort((a, b) => a.names[otherUid(a.members)].localeCompare(b.names[otherUid(b.members)]));
  for (const f of accepted) {
    const other = otherUid(f.members);
    const li = el('li', 'row');
    const remove = button('✕', () => olRemoveFriend(f, true), 'small icon');
    remove.title = 'Freund entfernen';
    li.append(el('span', 'grow', f.names[other]), button('Herausfordern', () => olChallenge(other, f.names[other]), 'primary small'), remove);
    friends.appendChild(li);
  }
  for (const f of OL.friends.filter(f => f.status === 'pending' && f.requestedBy === uid)) {
    const li = el('li', 'row');
    li.append(el('span', 'grow dim', `${f.names[otherUid(f.members)]} (Anfrage gesendet)`), button('Zurückziehen', () => olRemoveFriend(f), 'small'));
    friends.appendChild(li);
  }
  if (!friends.children.length) friends.appendChild(el('li', 'dim', 'Noch keine Freunde. Gib oben den Freundescode eines Freundes ein.'));

  const myTurns = OL.games.filter(myTurnIn).length;
  document.title = myTurns ? `(${myTurns}) Schach – du bist dran` : 'Schach';
  if (online) renderOnlineGameControls();
}

// ---------- Freunde ----------
async function olAddFriend(e) {
  e.preventDefault();
  const code = $('ol-add-code').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!code) return;
  if (code === OL.profile.friendCode) { olMsg('Das ist dein eigener Code. Gib den Code deines Freundes ein.', true); return; }
  try {
    const found = await OL.db.collection('chessProfiles').where('friendCode', '==', code).limit(1).get();
    if (found.empty) { olMsg(`Niemand hat den Freundescode ${code}.`, true); return; }
    const other = found.docs[0];
    const otherName = other.data().name;
    const pairId = [myUid(), other.id].sort().join('_');
    const existing = OL.friends.find(f => f.id === pairId);
    if (existing && existing.status === 'accepted') { olMsg(`Du bist schon mit ${otherName} befreundet.`); return; }
    if (existing && existing.requestedBy === other.id) { await olAcceptFriend(existing); return; }
    if (existing) { olMsg(`Du hast ${otherName} schon eine Anfrage geschickt.`); return; }
    await OL.db.collection('chessFriends').doc(pairId).set({
      members: [myUid(), other.id],
      names: { [myUid()]: OL.profile.name, [other.id]: otherName },
      requestedBy: myUid(),
      status: 'pending',
      createdAt: serverTime(),
    });
    $('ol-add-code').value = '';
    olMsg(`Freundschaftsanfrage an ${otherName} geschickt.`);
  } catch (err) { olError(err); }
}

async function olAcceptFriend(f) {
  try {
    await OL.db.collection('chessFriends').doc(f.id).update({ status: 'accepted' });
    olMsg(`Du bist jetzt mit ${f.names[otherUid(f.members)]} befreundet.`);
  } catch (e) { olError(e); }
}

async function olRemoveFriend(f, confirmFirst = false) {
  const name = f.names[otherUid(f.members)];
  // confirm() gibt es nicht überall (z. B. eingebettete Ansichten), daher zweimal tippen
  if (confirmFirst && olRemoveFriend.pending !== f.id) {
    olRemoveFriend.pending = f.id;
    olMsg(`Nochmal auf ✕ tippen, um ${name} zu entfernen.`);
    return;
  }
  olRemoveFriend.pending = null;
  try {
    await OL.db.collection('chessFriends').doc(f.id).delete();
    olMsg('');
  } catch (e) { olError(e); }
}

async function olCopyCode() {
  const code = OL.profile.friendCode;
  try {
    await navigator.clipboard.writeText(code);
    olMsg('Freundescode kopiert.');
  } catch (e) {
    const range = document.createRange();
    range.selectNodeContents($('ol-code'));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

// ---------- Partien ----------
async function olChallenge(friendUid, friendName, color) {
  const pref = color || $('ol-color').value;
  const myColor = pref === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : pref;
  const uid = myUid();
  const white = myColor === 'w' ? uid : friendUid;
  const black = myColor === 'w' ? friendUid : uid;
  try {
    const ref = await OL.db.collection('chessGames').add({
      players: [uid, friendUid], white, black,
      whiteName: myColor === 'w' ? OL.profile.name : friendName,
      blackName: myColor === 'w' ? friendName : OL.profile.name,
      createdBy: uid, status: 'invited', moves: [],
      result: null, reason: null, drawOffer: null,
      createdAt: serverTime(), updatedAt: serverTime(),
    });
    olMsg(`Einladung an ${friendName} geschickt. Die Partie startet, sobald sie angenommen wird.`);
    olOpenGame(ref.id);
  } catch (e) { olError(e); }
}

async function olAcceptGame(g) {
  try {
    await OL.db.collection('chessGames').doc(g.id).update({ status: 'active', updatedAt: serverTime() });
    olOpenGame(g.id);
  } catch (e) { olError(e); }
}

async function olDeleteGame(g) {
  try { await OL.db.collection('chessGames').doc(g.id).delete(); } catch (e) { olError(e); }
}

function olOpenGame(id) {
  if (OL.gameUnsub) OL.gameUnsub();
  cancelAi();
  $('gameover').hidden = true;
  $('promo').hidden = true;
  pendingPromo = null;
  OL.gameUnsub = OL.db.collection('chessGames').doc(id).onSnapshot(snap => {
    if (!snap.exists) {
      if (online && online.id === id) {
        const wasCreator = online.data.createdBy === myUid();
        leaveOnlineGame();
        load();
        olMsg(wasCreator ? 'Die Einladung wurde abgelehnt oder zurückgezogen.' : 'Die Einladung gibt es nicht mehr.');
      }
      return;
    }
    const data = snap.data();
    const first = !online || online.id !== id;
    online = { id, color: data.white === myUid() ? 'w' : 'b', data };
    if (first) {
      flipped = online.color === 'b';
      selected = -1;
      result = null;
    }
    olSyncBoard();
    olRenderLobby();
  }, err => { olError(err); leaveOnlineGame(); load(); });
}

// Brett an den Stand in der Cloud angleichen
function olSyncBoard() {
  const serverMoves = online.data.moves || [];
  const local = history.map(toUci);
  const same = serverMoves.length === local.length && serverMoves.every((u, i) => u === local[i]);
  if (!same) {
    replayMoves(serverMoves.map(parseUci));
    selected = -1;
    if (pendingPromo) { pendingPromo = null; $('promo').hidden = true; }
  }
  afterChange();
}

async function sendOnlineMove(m, res) {
  const { id } = online;
  const ref = OL.db.collection('chessGames').doc(id);
  const expected = history.length - 1;
  const move = toUci(history[history.length - 1]);
  try {
    await OL.db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const d = snap.data();
      if (!d || d.status !== 'active' || (d.moves || []).length !== expected) {
        throw new Error('Die Partie hat sich inzwischen geändert. Das Brett wurde aktualisiert.');
      }
      const update = { moves: d.moves.concat(move), drawOffer: null, updatedAt: serverTime() };
      if (res) Object.assign(update, { status: 'finished', result: res.code, reason: res.text });
      tx.update(ref, update);
    });
  } catch (e) {
    olError(e);
    if (online && online.id === id) olSyncBoard();
  }
}

async function olUpdateGame(fields) {
  if (!online) return;
  try {
    await OL.db.collection('chessGames').doc(online.id).update({ ...fields, updatedAt: serverTime() });
  } catch (e) { olError(e); }
}

function olResign() {
  if (olResign.armed !== online.id) {
    olResign.armed = online.id;
    renderOnlineGameControls();
    return;
  }
  olResign.armed = null;
  olUpdateGame({
    status: 'finished',
    result: online.color === 'w' ? '0-1' : '1-0',
    reason: `${OL.profile.name} hat aufgegeben.`,
    drawOffer: null,
  });
}

function leaveOnlineGame() {
  if (OL.gameUnsub) OL.gameUnsub();
  OL.gameUnsub = null;
  online = null;
  olResign.armed = null;
  document.title = 'Schach';
  if (OL.profile) olRenderLobby();
}

// Wird von app.js aufgerufen
function opponentName() {
  if (!online) return '';
  return online.color === 'w' ? online.data.blackName : online.data.whiteName;
}

function onlineResult() {
  const d = online.data;
  if (d.status !== 'finished' || !d.result) return null;
  const title = d.result === '1/2-1/2' ? 'Remis' : `${d.result === '1-0' ? d.whiteName : d.blackName} gewinnt!`;
  return { title, text: d.reason || '', code: d.result };
}

function renderOnlineGameControls() {
  const box = $('online-game');
  box.hidden = !online;
  if (!online) return;
  const d = online.data;
  const opp = opponentName();
  const me = myUid();
  $('og-title').textContent = `Online gegen ${opp}`;
  const actions = $('og-actions');
  actions.innerHTML = '';
  const info = $('og-info');
  info.textContent = '';

  if (d.status === 'invited') {
    if (d.createdBy === me) {
      info.textContent = `Einladung verschickt. Sobald ${opp} annimmt, geht es los.`;
      actions.append(button('Einladung zurückziehen', () => olDeleteGame({ id: online.id })));
    } else {
      info.textContent = `${opp} fordert dich heraus.`;
      actions.append(button('Annehmen', () => olAcceptGame({ id: online.id }), 'primary'),
        button('Ablehnen', () => olDeleteGame({ id: online.id })));
    }
  } else if (d.status === 'active') {
    if (d.drawOffer && d.drawOffer !== me) {
      info.textContent = `${opp} bietet Remis an.`;
      actions.append(
        button('Remis annehmen', () => olUpdateGame({ status: 'finished', result: '1/2-1/2', reason: 'Remis vereinbart.', drawOffer: null }), 'primary'),
        button('Ablehnen', () => olUpdateGame({ drawOffer: null })));
    } else {
      const offer = button(d.drawOffer === me ? 'Remis angeboten' : '½ Remis anbieten', () => olUpdateGame({ drawOffer: me }));
      offer.disabled = d.drawOffer === me;
      actions.append(offer);
    }
    actions.append(button(olResign.armed === online.id ? 'Wirklich aufgeben?' : '⚑ Aufgeben', olResign, olResign.armed === online.id ? 'danger' : ''));
  } else if (d.status === 'finished') {
    const other = online.color === 'w' ? d.black : d.white;
    actions.append(button('Revanche', () => olChallenge(other, opp, online.color === 'w' ? 'b' : 'w'), 'primary'));
  }
}

// ---------- Knöpfe ----------
$('ol-login').onsubmit = (e) => { e.preventDefault(); olLogin(false); };
$('ol-register').onclick = () => olLogin(true);
$('ol-forgot').onclick = olResetPassword;
$('ol-name').onsubmit = olSaveName;
$('ol-add').onsubmit = olAddFriend;
$('ol-copy').onclick = olCopyCode;
$('ol-rename').onclick = () => { $('ol-name-input').value = OL.profile.name; olShow('ol-name'); };
$('ol-logout').onclick = () => { if (online) { leaveOnlineGame(); load(); } OL.auth.signOut(); };

olInit();
