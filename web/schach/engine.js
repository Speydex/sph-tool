/* ============ Schach — Regel-Engine + Computer-Gegner ============
 * Wird doppelt benutzt: als normales <script> (Regeln für die Oberfläche)
 * und als Web Worker (Computer rechnet, ohne die Seite einzufrieren).
 *
 * Brett: Array mit 64 Feldern, Index 0 = a8, 7 = h8, 56 = a1, 63 = h1.
 * Figuren: FEN-Buchstaben, Großbuchstaben = Weiß (P N B R Q K).
 */
'use strict';

const FILES = 'abcdefgh';
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const QUEEN = DIAG.concat(ORTH);

// Deutsche Figurenbuchstaben für die Zugnotation
const DE_LETTER = { n: 'S', b: 'L', r: 'T', q: 'D', k: 'K' };

function sqName(i) { return FILES[i & 7] + (8 - (i >> 3)); }
function sqIndex(s) { return (8 - Number(s[1])) * 8 + FILES.indexOf(s[0]); }
function colorOf(p) { return p ? (p === p.toUpperCase() ? 'w' : 'b') : null; }
function other(c) { return c === 'w' ? 'b' : 'w'; }

function parseFEN(fen) {
  const [pos, turn, cast, ep, half, full] = fen.split(' ');
  const board = [];
  for (const ch of pos) {
    if (ch === '/') continue;
    if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) board.push(null);
    else board.push(ch);
  }
  return {
    board, turn,
    castling: cast === '-' ? '' : cast,
    ep: ep === '-' ? -1 : sqIndex(ep),
    half: Number(half) || 0,
    full: Number(full) || 1,
  };
}

function initialState() { return parseFEN(START_FEN); }

// Schlüssel für Stellungswiederholung (dreifache Wiederholung = Remis)
function positionKey(s) {
  return s.board.map(p => p || '.').join('') + s.turn + s.castling + s.ep;
}

// ---------- Angriffe ----------
function isAttacked(b, sq, by) {
  const r = sq >> 3, c = sq & 7;
  // Bauern
  const pr = by === 'w' ? r + 1 : r - 1;
  const pawn = by === 'w' ? 'P' : 'p';
  if (pr >= 0 && pr < 8) {
    if (c > 0 && b[pr * 8 + c - 1] === pawn) return true;
    if (c < 7 && b[pr * 8 + c + 1] === pawn) return true;
  }
  const knight = by === 'w' ? 'N' : 'n';
  for (const [dr, dc] of KNIGHT) {
    const r1 = r + dr, c1 = c + dc;
    if (r1 >= 0 && r1 < 8 && c1 >= 0 && c1 < 8 && b[r1 * 8 + c1] === knight) return true;
  }
  const king = by === 'w' ? 'K' : 'k';
  for (const [dr, dc] of KING) {
    const r1 = r + dr, c1 = c + dc;
    if (r1 >= 0 && r1 < 8 && c1 >= 0 && c1 < 8 && b[r1 * 8 + c1] === king) return true;
  }
  const bishop = by === 'w' ? 'B' : 'b', rook = by === 'w' ? 'R' : 'r', queen = by === 'w' ? 'Q' : 'q';
  for (const [dr, dc] of DIAG) {
    let r1 = r + dr, c1 = c + dc;
    while (r1 >= 0 && r1 < 8 && c1 >= 0 && c1 < 8) {
      const p = b[r1 * 8 + c1];
      if (p) { if (p === bishop || p === queen) return true; break; }
      r1 += dr; c1 += dc;
    }
  }
  for (const [dr, dc] of ORTH) {
    let r1 = r + dr, c1 = c + dc;
    while (r1 >= 0 && r1 < 8 && c1 >= 0 && c1 < 8) {
      const p = b[r1 * 8 + c1];
      if (p) { if (p === rook || p === queen) return true; break; }
      r1 += dr; c1 += dc;
    }
  }
  return false;
}

function kingSquare(b, color) { return b.indexOf(color === 'w' ? 'K' : 'k'); }

function inCheck(s, color = s.turn) {
  return isAttacked(s.board, kingSquare(s.board, color), other(color));
}

// ---------- Zuggenerierung ----------
function addPawnMove(out, from, to, piece, captured, promotes) {
  if (promotes) {
    for (const promo of ['q', 'r', 'b', 'n']) out.push({ from, to, piece, captured, promo });
  } else {
    out.push({ from, to, piece, captured });
  }
}

// Pseudo-legale Züge (eigener König evtl. noch im Schach).
// capturesOnly: nur Schlagzüge + Umwandlungen (für die Ruhesuche des Computers).
function pseudoMoves(s, capturesOnly = false) {
  const out = [];
  const b = s.board, us = s.turn;
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (!p || colorOf(p) !== us) continue;
    const r = i >> 3, c = i & 7, t = p.toLowerCase();

    if (t === 'p') {
      const dir = us === 'w' ? -1 : 1;
      const startRow = us === 'w' ? 6 : 1, lastRow = us === 'w' ? 0 : 7;
      const r1 = r + dir;
      const f = r1 * 8 + c;
      if (!b[f] && (!capturesOnly || r1 === lastRow)) {
        addPawnMove(out, i, f, p, null, r1 === lastRow);
        const f2 = (r + 2 * dir) * 8 + c;
        if (!capturesOnly && r === startRow && !b[f2]) out.push({ from: i, to: f2, piece: p, flag: 'double' });
      }
      for (const dc of [-1, 1]) {
        const c1 = c + dc;
        if (c1 < 0 || c1 > 7) continue;
        const t2 = r1 * 8 + c1;
        if (b[t2] && colorOf(b[t2]) !== us) addPawnMove(out, i, t2, p, b[t2], r1 === lastRow);
        else if (t2 === s.ep) out.push({ from: i, to: t2, piece: p, captured: us === 'w' ? 'p' : 'P', flag: 'ep' });
      }
    } else if (t === 'n' || t === 'k') {
      for (const [dr, dc] of (t === 'n' ? KNIGHT : KING)) {
        const r1 = r + dr, c1 = c + dc;
        if (r1 < 0 || r1 > 7 || c1 < 0 || c1 > 7) continue;
        const f = r1 * 8 + c1;
        if (b[f] ? colorOf(b[f]) !== us : !capturesOnly) out.push({ from: i, to: f, piece: p, captured: b[f] });
      }
    } else {
      const dirs = t === 'b' ? DIAG : t === 'r' ? ORTH : QUEEN;
      for (const [dr, dc] of dirs) {
        let r1 = r + dr, c1 = c + dc;
        while (r1 >= 0 && r1 < 8 && c1 >= 0 && c1 < 8) {
          const f = r1 * 8 + c1;
          if (b[f]) {
            if (colorOf(b[f]) !== us) out.push({ from: i, to: f, piece: p, captured: b[f] });
            break;
          }
          if (!capturesOnly) out.push({ from: i, to: f, piece: p, captured: null });
          r1 += dr; c1 += dc;
        }
      }
    }
  }

  // Rochade
  if (!capturesOnly && s.castling) {
    const them = other(us);
    const row = us === 'w' ? 7 : 0;
    const e = row * 8 + 4;
    const k = us === 'w' ? 'K' : 'k';
    if (b[e] === k && !isAttacked(b, e, them)) {
      const [kRight, qRight] = us === 'w' ? ['K', 'Q'] : ['k', 'q'];
      if (s.castling.includes(kRight) && !b[e + 1] && !b[e + 2] &&
          !isAttacked(b, e + 1, them) && !isAttacked(b, e + 2, them)) {
        out.push({ from: e, to: e + 2, piece: k, flag: 'castleK' });
      }
      if (s.castling.includes(qRight) && !b[e - 1] && !b[e - 2] && !b[e - 3] &&
          !isAttacked(b, e - 1, them) && !isAttacked(b, e - 2, them)) {
        out.push({ from: e, to: e - 2, piece: k, flag: 'castleQ' });
      }
    }
  }
  return out;
}

const CORNER_RIGHTS = { 0: 'q', 7: 'k', 56: 'Q', 63: 'K' };

function makeMove(s, m) {
  const b = s.board.slice();
  const us = s.turn;
  b[m.from] = null;
  b[m.to] = m.promo ? (us === 'w' ? m.promo.toUpperCase() : m.promo) : m.piece;
  if (m.flag === 'ep') b[m.to + (us === 'w' ? 8 : -8)] = null;
  if (m.flag === 'castleK') { b[m.to - 1] = b[m.to + 1]; b[m.to + 1] = null; }
  if (m.flag === 'castleQ') { b[m.to + 1] = b[m.to - 2]; b[m.to - 2] = null; }

  let castling = s.castling;
  if (castling) {
    if (m.piece === 'K') castling = castling.replace(/[KQ]/g, '');
    if (m.piece === 'k') castling = castling.replace(/[kq]/g, '');
    for (const sq of [m.from, m.to]) {
      if (CORNER_RIGHTS[sq]) castling = castling.replace(CORNER_RIGHTS[sq], '');
    }
  }
  const isPawn = m.piece === 'P' || m.piece === 'p';
  return {
    board: b,
    turn: other(us),
    castling,
    ep: m.flag === 'double' ? (m.from + m.to) / 2 : -1,
    half: isPawn || m.captured ? 0 : s.half + 1,
    full: s.full + (us === 'b' ? 1 : 0),
  };
}

function isLegalAfter(s, m) {
  const ns = makeMove(s, m);
  return isAttacked(ns.board, kingSquare(ns.board, s.turn), ns.turn) ? null : ns;
}

function legalMoves(s) {
  return pseudoMoves(s).filter(m => isLegalAfter(s, m));
}

function insufficientMaterial(b) {
  const minors = [];
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (!p || p === 'K' || p === 'k') continue;
    const t = p.toLowerCase();
    if (t === 'p' || t === 'r' || t === 'q') return false;
    minors.push({ t, sqColor: ((i >> 3) + (i & 7)) & 1 });
  }
  if (minors.length <= 1) return true;
  // Nur Läufer, alle auf gleichfarbigen Feldern
  return minors.every(m => m.t === 'b') && minors.every(m => m.sqColor === minors[0].sqColor);
}

// ---------- Notation (deutsch: K D T L S) ----------
function toSAN(s, m, legal = legalMoves(s)) {
  let san;
  if (m.flag === 'castleK') san = 'O-O';
  else if (m.flag === 'castleQ') san = 'O-O-O';
  else {
    const t = m.piece.toLowerCase();
    const cap = m.captured ? 'x' : '';
    if (t === 'p') {
      san = (cap ? FILES[m.from & 7] + 'x' : '') + sqName(m.to);
      if (m.promo) san += '=' + DE_LETTER[m.promo];
    } else {
      let dis = '';
      const rivals = legal.filter(o => o.piece === m.piece && o.to === m.to && o.from !== m.from);
      if (rivals.length) {
        const sameFile = rivals.some(o => (o.from & 7) === (m.from & 7));
        const sameRank = rivals.some(o => (o.from >> 3) === (m.from >> 3));
        if (!sameFile) dis = FILES[m.from & 7];
        else if (!sameRank) dis = String(8 - (m.from >> 3));
        else dis = sqName(m.from);
      }
      san = DE_LETTER[t] + dis + cap + sqName(m.to);
    }
  }
  const ns = makeMove(s, m);
  if (inCheck(ns)) san += legalMoves(ns).length ? '+' : '#';
  return san;
}

// ---------- Bewertung ----------
const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Figur-Feld-Tabellen aus Sicht von Weiß (Index 0 = a8)
const PST = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20],
  r: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20],
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20],
  kEnd: [
    -50, -40, -30, -20, -20, -30, -40, -50,
    -30, -20, -10, 0, 0, -10, -20, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -30, 0, 0, 0, 0, -30, -30,
    -50, -30, -30, -30, -30, -30, -30, -50],
};

// Bewertung aus Sicht der Seite am Zug (positiv = gut für s.turn)
function evaluate(s) {
  const b = s.board;
  let score = 0, heavy = 0;
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (p && 'qrQR'.includes(p)) heavy += VALUE[p.toLowerCase()];
  }
  const endgame = heavy <= 1300;
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (!p) continue;
    const t = p.toLowerCase();
    const white = p !== t;
    const idx = white ? i : (7 - (i >> 3)) * 8 + (i & 7);
    const table = t === 'k' && endgame ? PST.kEnd : PST[t];
    const v = VALUE[t] + table[idx];
    score += white ? v : -v;
  }
  return s.turn === 'w' ? score : -score;
}

// ---------- Suche (Negamax mit Alpha-Beta + Ruhesuche) ----------
const MATE = 100000;

function orderMoves(moves) {
  for (const m of moves) {
    m.sort = (m.captured ? 10 * VALUE[m.captured.toLowerCase()] - VALUE[m.piece.toLowerCase()] + 1000 : 0) +
             (m.promo ? VALUE[m.promo] : 0);
  }
  return moves.sort((a, b) => b.sort - a.sort);
}

function quiesce(s, alpha, beta, qdepth) {
  const stand = evaluate(s);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  if (qdepth >= 6) return alpha;
  for (const m of orderMoves(pseudoMoves(s, true))) {
    const ns = isLegalAfter(s, m);
    if (!ns) continue;
    const score = -quiesce(ns, -beta, -alpha, qdepth + 1);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(s, depth, alpha, beta, ply) {
  if (s.half >= 100) return 0;
  const moves = legalMoves(s);
  if (!moves.length) return inCheck(s) ? -MATE + ply : 0;
  if (depth <= 0) return quiesce(s, alpha, beta, 0);
  for (const m of orderMoves(moves)) {
    const score = -negamax(makeMove(s, m), depth - 1, -beta, -alpha, ply + 1);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

// Liefert den besten Zug. randomness (in Centipawns) macht leichte Stufen menschlicher.
function bestMove(s, depth, randomness = 0) {
  const moves = orderMoves(legalMoves(s));
  if (!moves.length) return null;
  let best = null, bestScore = -Infinity;
  let alpha = -Infinity;
  for (const m of moves) {
    let score = -negamax(makeMove(s, m), depth - 1, -Infinity, randomness ? Infinity : -alpha, 1);
    if (randomness) score += Math.random() * randomness;
    if (score > bestScore) { bestScore = score; best = m; }
    if (score > alpha) alpha = score;
  }
  return best;
}

// ---------- Web-Worker-Modus ----------
if (typeof window === 'undefined' && typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = (e) => {
    const { state, depth, randomness, id } = e.data;
    self.postMessage({ id, move: bestMove(state, depth, randomness) });
  };
}

// Für Tests unter Node
if (typeof module !== 'undefined') {
  module.exports = {
    START_FEN, parseFEN, initialState, legalMoves, makeMove, inCheck, toSAN,
    bestMove, insufficientMaterial, positionKey, sqName, sqIndex,
  };
}
