/* ============ Schach — Oberfläche ============ */
'use strict';

const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const VS15 = '︎'; // verhindert, dass iOS den Bauern als Emoji zeichnet
const PIECE_NAME = { k: 'König', q: 'Dame', r: 'Turm', b: 'Läufer', n: 'Springer', p: 'Bauer' };
const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const LEVELS = { 1: { depth: 1, randomness: 150 }, 2: { depth: 2, randomness: 30 }, 3: { depth: 3, randomness: 0 }, 4: { depth: 4, randomness: 0 } };
const SAVE_KEY = 'schach-spiel-v1';

const $ = (id) => document.getElementById(id);
const boardEl = $('board');

// ---------- Spielzustand ----------
let states, history, keys;   // Stellungen, gespielte Züge (mit SAN), Stellungs-Schlüssel
let legal = [];              // legale Züge der aktuellen Stellung
let selected = -1;           // ausgewähltes Feld
let flipped = false;
let result = null;           // { title, text } wenn Partie vorbei
let thinking = false;
let aiRequest = 0;
let pendingPromo = null;

const current = () => states[states.length - 1];
const mode = () => $('mode').value;
const humanColor = () => (mode() === 'ai-b' ? 'b' : 'w');
const isAiTurn = () => mode() !== 'local' && !result && current().turn !== humanColor();

// ---------- Computer (Web Worker, mit Fallback) ----------
let worker = null;
try {
  const src = document.querySelector('script[src^="engine.js"]').src;
  worker = new Worker(src);
  worker.onmessage = (e) => onAiMove(e.data.id, e.data.move);
  worker.onerror = () => { worker = null; };
} catch (e) { worker = null; }

function requestAiMove() {
  if (!isAiTurn() || thinking) return;
  thinking = true;
  const id = ++aiRequest;
  const lvl = LEVELS[$('level').value];
  render();
  const payload = { id, state: current(), depth: lvl.depth, randomness: lvl.randomness };
  // kleine Pause, damit der Zug nicht "sofort" erscheint
  setTimeout(() => {
    if (id !== aiRequest) return;
    if (worker) worker.postMessage(payload);
    else onAiMove(id, bestMove(payload.state, payload.depth, payload.randomness));
  }, 250);
}

function onAiMove(id, move) {
  if (id !== aiRequest) return; // veraltete Antwort (z. B. nach "Neues Spiel")
  thinking = false;
  if (!move) return;
  const m = legal.find(l => l.from === move.from && l.to === move.to && l.promo === move.promo);
  if (m) play(m);
}

function cancelAi() { aiRequest++; thinking = false; }

// ---------- Spielablauf ----------
function newGame() {
  cancelAi();
  states = [initialState()];
  history = [];
  keys = [positionKey(states[0])];
  flipped = humanColor() === 'b';
  afterChange();
}

function play(m) {
  const s = current();
  const san = toSAN(s, m, legal);
  const ns = makeMove(s, m);
  states.push(ns);
  history.push({ from: m.from, to: m.to, promo: m.promo || null, san });
  keys.push(positionKey(ns));
  selected = -1;
  afterChange();
}

function undo() {
  if (history.length === 0) return;
  cancelAi();
  let n = 1;
  if (mode() !== 'local') {
    // bis der Mensch wieder am Zug ist
    n = current().turn === humanColor() ? 2 : 1;
    if (n > history.length) n = history.length;
  }
  for (let i = 0; i < n; i++) { states.pop(); history.pop(); keys.pop(); }
  selected = -1;
  afterChange();
}

function afterChange() {
  const s = current();
  legal = legalMoves(s);
  result = computeResult(s);
  save();
  render();
  if (result) setTimeout(() => showGameOver(), 400);
  else requestAiMove();
}

function computeResult(s) {
  const side = s.turn === 'w' ? 'Weiß' : 'Schwarz';
  const winner = s.turn === 'w' ? 'Schwarz' : 'Weiß';
  if (!legal.length) {
    if (inCheck(s)) return { title: `Schachmatt – ${winner} gewinnt!`, text: `${side} ist schachmatt.` };
    return { title: 'Remis', text: `Patt: ${side} hat keinen legalen Zug, steht aber nicht im Schach.` };
  }
  if (s.half >= 100) return { title: 'Remis', text: '50 Züge ohne Bauernzug oder Schlagen.' };
  if (insufficientMaterial(s.board)) return { title: 'Remis', text: 'Zu wenig Material zum Mattsetzen.' };
  const k = keys[keys.length - 1];
  if (keys.filter(x => x === k).length >= 3) return { title: 'Remis', text: 'Dreifache Stellungswiederholung.' };
  return null;
}

// ---------- Speichern ----------
function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      moves: history.map(h => [h.from, h.to, h.promo]),
      mode: mode(), level: $('level').value, flipped,
    }));
  } catch (e) { /* privates Fenster o. Ä. — dann eben ohne Speichern */ }
}

function load() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { data = null; }
  if (data && data.mode) $('mode').value = data.mode;
  if (data && data.level) $('level').value = data.level;
  states = [initialState()];
  history = [];
  keys = [positionKey(states[0])];
  flipped = humanColor() === 'b';
  if (data && Array.isArray(data.moves)) {
    for (const [from, to, promo] of data.moves) {
      const s = current();
      const lm = legalMoves(s);
      const m = lm.find(x => x.from === from && x.to === to && (x.promo || null) === promo);
      if (!m) break;
      const ns = makeMove(s, m);
      history.push({ from, to, promo, san: toSAN(s, m, lm) });
      states.push(ns);
      keys.push(positionKey(ns));
    }
    if (typeof data.flipped === 'boolean') flipped = data.flipped;
  }
  afterChange();
}

// ---------- Eingabe ----------
function canMoveNow() {
  if (result || thinking || pendingPromo) return false;
  return mode() === 'local' || current().turn === humanColor();
}

function ownPieceAt(sq) {
  const p = current().board[sq];
  return p && (p === p.toUpperCase() ? 'w' : 'b') === current().turn;
}

function tryMove(from, to) {
  const options = legal.filter(m => m.from === from && m.to === to);
  if (!options.length) return false;
  if (options.length > 1) { askPromotion(options); return true; }
  play(options[0]);
  return true;
}

function onSquareClick(sq) {
  if (!canMoveNow()) return;
  if (selected !== -1 && selected !== sq && tryMove(selected, sq)) return;
  selected = (ownPieceAt(sq) && selected !== sq) ? sq : -1;
  render();
}

function askPromotion(options) {
  pendingPromo = options;
  const white = current().turn === 'w';
  const box = $('promo-choices');
  box.innerHTML = '';
  for (const t of ['q', 'r', 'b', 'n']) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'piece ' + (white ? 'white' : 'black');
    btn.textContent = GLYPH[t] + VS15;
    btn.title = PIECE_NAME[t];
    btn.onclick = () => {
      $('promo').hidden = true;
      pendingPromo = null;
      play(options.find(m => m.promo === t));
    };
    box.appendChild(btn);
  }
  $('promo').hidden = false;
}

// Ziehen mit Maus/Finger
let drag = null;

boardEl.addEventListener('pointerdown', (e) => {
  const sqEl = e.target.closest('.sq');
  if (!sqEl || !canMoveNow()) return;
  const sq = Number(sqEl.dataset.sq);
  if (!ownPieceAt(sq)) { onSquareClick(sq); return; }
  e.preventDefault();
  const wasSelected = selected === sq;
  selected = sq;
  render();
  const pieceEl = boardEl.querySelector(`.sq[data-sq="${sq}"] .piece`);
  drag = { from: sq, wasSelected, startX: e.clientX, startY: e.clientY, moved: false, pieceEl, ghost: null };
  boardEl.setPointerCapture(e.pointerId);
});

boardEl.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
  if (!drag.moved && Math.hypot(dx, dy) < 6) return;
  if (!drag.moved) {
    drag.moved = true;
    const ghost = drag.pieceEl.cloneNode(true);
    ghost.classList.add('ghost');
    ghost.style.fontSize = getComputedStyle(drag.pieceEl).fontSize;
    document.body.appendChild(ghost);
    drag.ghost = ghost;
    drag.pieceEl.classList.add('dragging');
  }
  drag.ghost.style.left = e.clientX + 'px';
  drag.ghost.style.top = e.clientY + 'px';
});

function endDrag(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (d.ghost) d.ghost.remove();
  if (d.pieceEl) d.pieceEl.classList.remove('dragging');
  if (!d.moved) {
    // normaler Klick: zweiter Klick auf dieselbe Figur hebt Auswahl auf
    if (d.wasSelected) { selected = -1; render(); }
    return;
  }
  const target = document.elementFromPoint(e.clientX, e.clientY);
  const sqEl = target && target.closest('.sq');
  if (sqEl && tryMove(d.from, Number(sqEl.dataset.sq))) return;
  render();
}
boardEl.addEventListener('pointerup', endDrag);
boardEl.addEventListener('pointercancel', (e) => { if (drag) { drag.moved = false; endDrag(e); } });

// ---------- Darstellung ----------
function render() {
  const s = current();
  const last = history[history.length - 1];
  const targets = new Map();
  if (selected !== -1) for (const m of legal) if (m.from === selected) targets.set(m.to, !!m.captured);
  const checkSq = inCheck(s) ? s.board.indexOf(s.turn === 'w' ? 'K' : 'k') : -1;

  boardEl.innerHTML = '';
  for (let v = 0; v < 64; v++) {
    const sq = flipped ? 63 - v : v;
    const r = sq >> 3, c = sq & 7;
    const el = document.createElement('div');
    el.className = 'sq ' + ((r + c) % 2 ? 'dark' : 'light');
    el.dataset.sq = sq;
    el.setAttribute('role', 'gridcell');
    el.setAttribute('aria-label', sqName(sq));
    if (last && (sq === last.from || sq === last.to)) el.classList.add('last');
    if (sq === selected) el.classList.add('selected');
    if (sq === checkSq) el.classList.add('check');
    if (targets.has(sq)) el.classList.add(targets.get(sq) ? 'target-capture' : 'target');

    const p = s.board[sq];
    if (p) {
      const span = document.createElement('span');
      const white = p === p.toUpperCase();
      span.className = 'piece ' + (white ? 'white' : 'black');
      span.textContent = GLYPH[p.toLowerCase()] + VS15;
      el.appendChild(span);
      el.setAttribute('aria-label', `${sqName(sq)} ${white ? 'weißer' : 'schwarzer'} ${PIECE_NAME[p.toLowerCase()]}`);
    }
    // Koordinaten am Rand
    if (v % 8 === 0) addCoord(el, 'rank', String(8 - r));
    if (v >= 56) addCoord(el, 'file', 'abcdefgh'[c]);
    boardEl.appendChild(el);
  }

  renderPlayers(s);
  renderMoves();
  renderStatus(s);
  $('btn-undo').disabled = history.length === 0;
  $('level-setting').hidden = mode() === 'local';
  $('board').classList.toggle('busy', thinking);
}

function addCoord(el, cls, text) {
  const c = document.createElement('span');
  c.className = 'coord ' + cls;
  c.textContent = text;
  el.appendChild(c);
}

function renderPlayers(s) {
  const topColor = flipped ? 'w' : 'b';
  const bottomColor = other(topColor);
  const label = (color) => {
    const name = color === 'w' ? 'Weiß' : 'Schwarz';
    if (mode() === 'local') return name;
    return color === humanColor() ? `${name} (Du)` : `${name} (Computer)`;
  };
  $('name-top').textContent = label(topColor);
  $('name-bottom').textContent = label(bottomColor);
  $('row-top').classList.toggle('to-move', !result && s.turn === topColor);
  $('row-bottom').classList.toggle('to-move', !result && s.turn === bottomColor);

  // Geschlagene Figuren = Startaufstellung minus aktuelle Figuren
  const count = {};
  for (const p of 'PPPPPPPPNNBBRRQKpppppppp' + 'nnbbrrqk') count[p] = (count[p] || 0) + 1;
  for (const p of s.board) if (p) count[p]--;
  const lost = (color) => {
    const list = [];
    for (const t of ['q', 'r', 'b', 'n', 'p']) {
      const p = color === 'w' ? t.toUpperCase() : t;
      for (let i = 0; i < Math.max(0, count[p] || 0); i++) list.push(t);
    }
    return list;
  };
  let material = 0;
  for (const p of s.board) if (p) material += (p === p.toUpperCase() ? 1 : -1) * PIECE_VALUE[p.toLowerCase()];
  const show = (el, color) => {
    // Neben einem Spieler stehen die Figuren, die er geschlagen hat
    const taken = lost(other(color));
    const adv = color === 'w' ? material : -material;
    el.innerHTML = '';
    for (const t of taken) {
      const span = document.createElement('span');
      span.className = 'piece ' + (color === 'w' ? 'black' : 'white');
      span.textContent = GLYPH[t] + VS15;
      el.appendChild(span);
    }
    if (adv > 0) {
      const b = document.createElement('span');
      b.className = 'adv';
      b.textContent = '+' + adv;
      el.appendChild(b);
    }
  };
  show($('captured-top'), topColor);
  show($('captured-bottom'), bottomColor);
}

function renderMoves() {
  const ol = $('moves');
  ol.innerHTML = '';
  for (let i = 0; i < history.length; i += 2) {
    const li = document.createElement('li');
    for (const h of [history[i], history[i + 1]]) {
      const span = document.createElement('span');
      span.className = 'san';
      span.textContent = h ? h.san : '';
      if (h && h === history[history.length - 1]) span.classList.add('latest');
      li.appendChild(span);
    }
    ol.appendChild(li);
  }
  ol.scrollTop = ol.scrollHeight;
}

function renderStatus(s) {
  const side = s.turn === 'w' ? 'Weiß' : 'Schwarz';
  let text;
  if (result) text = result.title;
  else if (thinking) text = 'Computer denkt nach …';
  else {
    text = `${side} ist am Zug`;
    if (mode() !== 'local' && s.turn === humanColor()) text = 'Du bist am Zug';
    if (inCheck(s)) text += ' – Schach!';
  }
  $('status').textContent = text;
  $('status').classList.toggle('alert', !result && inCheck(s));
}

function showGameOver() {
  if (!result) return;
  $('gameover-title').textContent = result.title;
  $('gameover-text').textContent = result.text;
  $('gameover').hidden = false;
}

// ---------- Knöpfe ----------
$('btn-new').onclick = newGame;
$('gameover-new').onclick = () => { $('gameover').hidden = true; newGame(); };
$('gameover-close').onclick = () => { $('gameover').hidden = true; };
$('btn-undo').onclick = () => { $('gameover').hidden = true; $('promo').hidden = true; pendingPromo = null; undo(); };
$('btn-flip').onclick = () => { flipped = !flipped; save(); render(); };
$('mode').onchange = () => { $('gameover').hidden = true; newGame(); };
$('level').onchange = () => { save(); render(); };

load();
