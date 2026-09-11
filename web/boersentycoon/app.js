// ============================================================
// BörsenTycoon — Spiel-Engine
// ============================================================
"use strict";

const $ = (id) => document.getElementById(id);
const now = () => Date.now();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];
const uid = () => Math.random().toString(36).slice(2, 10);

function fmtMoney(n) {
  const neg = n < 0;
  n = Math.abs(n);
  let s;
  if (n >= 1e9) s = (n / 1e9).toFixed(2) + " Mrd. €";
  else if (n >= 1e6) s = (n / 1e6).toFixed(2) + " Mio. €";
  else if (n >= 1e4) s = Math.round(n).toLocaleString("de-DE") + " €";
  else s = n.toFixed(2).replace(".", ",") + " €";
  return (neg ? "-" : "") + s;
}
function fmtNum(n) {
  n = Math.round(n);
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return "" + n;
}
function pct(n) { return (n >= 0 ? "+" : "") + (n * 100).toFixed(2) + "%"; }

// ============================================================
// GEMEINSAMER MARKT — deterministisch aus der Wanduhrzeit berechnet
// ============================================================
// Kursverlauf, Flash-Crashes, Welt-Krisen, automatische News und KI-
// Rivalen-Posts hängen NUR von der aktuellen Zeit ab (kein Math.random())
// — dadurch berechnet jedes Gerät exakt dieselben Werte, ganz ohne
// Server/Cloud-Synchronisierung. Persönliche Aktionen (Social-Posts,
// Insider-Infos, Overclock, ...) wirken zusätzlich nur lokal über
// st.localMult, damit sie den geteilten Kurs nicht für alle verfälschen.
const MARKET_TICK_MS = 1500;
// Fester Referenzpunkt, für alle Geräte identisch — MUSS in der
// Vergangenheit liegen: die Regime-Ebene (siehe unten) läuft als echte
// Zufallslauf-Rekursion ab Epoche 0 und bräche für negative Tick-Indizes
// (Referenzpunkt in der Zukunft) einfach ab, ohne Crashes zu erzeugen.
const MARKET_EPOCH = 1704067200000; // 2024-01-01T00:00:00Z

function marketTickIndex(t) { return Math.floor((t - MARKET_EPOCH) / MARKET_TICK_MS); }

function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// Deterministischer Pseudo-Zufallswert in [0,1) für (seed, index) — dieselbe
// Kombination liefert auf jedem Gerät exakt denselben Wert, ohne dass
// irgendetwas seit Spielbeginn nachgerechnet werden muss.
function detRand(seed, index) {
  let a = (hash32(seed) ^ Math.imul(index | 0, 0x9e3779b1)) >>> 0;
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function detRange(seed, index, a, b) { return a + detRand(seed, index) * (b - a); }
function smoothNoise1D(seed, x) {
  const i = Math.floor(x), f = x - i;
  const a = detRand(seed, i) * 2 - 1;
  const b = detRand(seed, i + 1) * 2 - 1;
  const u = f * f * (3 - 2 * f);
  return a + u * (b - a);
}
function fbmNoise(seed, x, octaves) {
  let total = 0, amp = 0.5, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    total += smoothNoise1D(seed + ":o" + o, x * freq) * amp;
    norm += amp;
    amp *= 0.55; freq *= 2.17;
  }
  return total / norm;
}

// Regime-Ebene: seltene, aber heftige und vor allem DAUERHAFTE Crashes/
// Booms pro Aktie — im Gegensatz zum Flash-Crash (kurzer, marktweiter
// Schreck, der immer wieder verschwindet) bleibt ein Regime-Crash bestehen
// und erholt sich, wenn überhaupt, nur langsam über viele weitere Epochen.
// Echte, sequenzielle Zufallslauf-Rekursion (jede Epoche hängt von der
// vorigen ab) statt einer geschlossenen Formel — aber Epochen sind mit 40
// Minuten grob genug, dass selbst nach einem Jahr Laufzeit nur ~13.000
// Schritte anfallen (Bruchteil einer Millisekunde), und ein kleiner
// Fenster-Cache macht wiederholte Abfragen nahe der aktuellen Zeit O(1).
const REGIME_EPOCH_TICKS = Math.round((40 * 60000) / MARKET_TICK_MS);
const REGIME_DECAY = 0.985;
function regimeStep(seed, vol, drift, e, level) {
  const r = detRand(seed + ":roll", e);
  const crashChance = 0.014 + vol * 0.3;
  const boomChance = 0.008 + vol * 0.16;
  let step = (detRand(seed + ":wobble", e) * 2 - 1) * (0.025 + vol * 0.4) + drift * 20;
  if (r < crashChance) {
    // Crashes schlagen härter und schneller zu als Booms sich aufbauen —
    // Angst wirkt stärker als Gier, wie an echten Märkten.
    step -= detRange(seed + ":crashmag", e, 0.45, 1.05) * (0.65 + vol * 6.5);
  } else if (r > 1 - boomChance) {
    step += detRange(seed + ":boommag", e, 0.25, 0.55) * (0.6 + vol * 5);
  }
  return level * REGIME_DECAY + step;
}
// regimeSignal() needs two adjacent epochs (i and i+1) each call, and a
// fresh player's history/ATH seed additionally scans a couple of nearby
// epochs from both ends (see freshState()). A small fixed-size ring buffer
// of recently-touched epochs covers all of that without ever growing or
// shrinking an object's key set — deliberately NOT a {epoch: level} map
// pruned with `delete`: repeatedly adding/deleting object keys tips V8
// into slow "dictionary mode" for that object, which (measured) made an
// earlier version of this ~500x slower. A plain fixed-length array, only
// ever written by index, keeps a stable shape forever.
//
// REGIME_DECAY < 1 means older epochs contribute geometrically less to the
// current level (0.985^550 < 0.0003) — so a cold start (or a big backward
// jump) never needs to replay all the way from epoch 0. That epoch count
// only grows with real time since MARKET_EPOCH, which would otherwise make
// the very first price computation of a session slower every year. Instead
// truncate the replay to the last REGIME_LOOKBACK_EPOCHS and start from
// level 0 there — the true value's contribution from before that point has
// already decayed to nothing, so the approximation error is negligible.
const REGIME_LOOKBACK_EPOCHS = 550;
const REGIME_CACHE_SLOTS = 8;
const regimeCache = {};
function regimeLevelAtEpoch(seed, vol, drift, epochIdx) {
  let cache = regimeCache[seed];
  if (!cache) {
    cache = regimeCache[seed] = {
      epochs: new Array(REGIME_CACHE_SLOTS).fill(-1),
      values: new Array(REGIME_CACHE_SLOTS).fill(0),
      next: 0, maxEpoch: -1, maxValue: 0,
    };
  }
  for (let i = 0; i < REGIME_CACHE_SLOTS; i++) if (cache.epochs[i] === epochIdx) return cache.values[i];

  let level, startE;
  if (epochIdx > cache.maxEpoch && epochIdx - cache.maxEpoch <= REGIME_LOOKBACK_EPOCHS) {
    level = cache.maxValue;
    startE = cache.maxEpoch + 1;
  } else {
    // Rückwärts-/Lücken-Abfrage, oder ein Vorwärts-Sprung, der weiter als
    // das Lookback-Fenster vom bisher bekannten Stand entfernt ist (z.B.
    // der allererste Aufruf für diese Aktie) — auf das Lookback-Fenster
    // begrenzte Neuberechnung statt bis Epoche 0 zurückzulaufen.
    level = 0;
    startE = Math.max(0, epochIdx - REGIME_LOOKBACK_EPOCHS);
  }
  for (let e = startE; e <= epochIdx; e++) {
    level = regimeStep(seed, vol, drift, e, level);
    cache.epochs[cache.next] = e;
    cache.values[cache.next] = level;
    cache.next = (cache.next + 1) % REGIME_CACHE_SLOTS;
  }
  if (epochIdx > cache.maxEpoch) { cache.maxEpoch = epochIdx; cache.maxValue = level; }
  return level;
}
// Sanfter, aber vergleichsweise ZÜGIGER Übergang in den neuen Epochen-Wert
// (der Großteil der Bewegung passiert in den ersten ~15% der Epoche), damit
// sich ein Crash wie "gerade eben passiert" anfühlt statt wie ein 40-
// minütiges Verblassen.
function regimeSignal(seed, vol, drift, tickIndex) {
  const x = tickIndex / REGIME_EPOCH_TICKS;
  const i = Math.floor(x), f = x - i;
  const a = regimeLevelAtEpoch(seed, vol, drift, i);
  const b = regimeLevelAtEpoch(seed, vol, drift, i + 1);
  const uRaw = Math.min(1, f / 0.18);
  const u = uRaw * uRaw * (3 - 2 * uRaw);
  return a + u * (b - a);
}

function sharedStockLogReturn(cfg, tickIndex) {
  const regime = regimeSignal(cfg.id, cfg.vol, cfg.drift, tickIndex);
  const macro = fbmNoise(cfg.id + ":macro", tickIndex / 260, 3);
  const micro = fbmNoise(cfg.id + ":micro", tickIndex / 11, 2);
  return regime + cfg.vol * (macro * 3.2 + micro * 1.6);
}

// Deterministischer Flash-Crash: ca. alle 15-20 Minuten für 20-30s, betrifft alle Aktien.
const FLASHCRASH_WINDOW_TICKS = Math.round((8 * 60000) / MARKET_TICK_MS);
function sharedFlashCrash(tickIndex) {
  const windowIdx = Math.floor(tickIndex / FLASHCRASH_WINDOW_TICKS);
  if (detRand("flashcrash:fire", windowIdx) > 0.4) return null;
  const windowStart = windowIdx * FLASHCRASH_WINDOW_TICKS;
  const startTick = windowStart + Math.floor(detRand("flashcrash:offset", windowIdx) * FLASHCRASH_WINDOW_TICKS * 0.7);
  const durTicks = Math.round(detRange("flashcrash:dur", windowIdx, 20000, 30000) / MARKET_TICK_MS);
  const endTick = startTick + durTicks;
  const active = tickIndex >= startTick && tickIndex <= endTick;
  const depth = detRange("flashcrash:depth", windowIdx, 0.28, 0.5);
  return { windowIdx, startTick, endTick, active, depth };
}

// Deterministische Welt-Krisen: ca. alle 30 Minuten, sektorweiter Boom/Crash.
const CRISIS_WINDOW_TICKS = Math.round((15 * 60000) / MARKET_TICK_MS);
function sharedCrisis(tickIndex) {
  const windowIdx = Math.floor(tickIndex / CRISIS_WINDOW_TICKS);
  if (detRand("crisis:fire", windowIdx) > 0.5) return null;
  const windowStart = windowIdx * CRISIS_WINDOW_TICKS;
  const event = CRISIS_EVENTS[Math.floor(detRand("crisis:pick", windowIdx) * CRISIS_EVENTS.length)];
  const startTick = windowStart + Math.floor(detRand("crisis:offset", windowIdx) * CRISIS_WINDOW_TICKS * 0.5);
  const durTicks = Math.round((event.name === "KI-Durchbruch" ? 120000 : 90000) / MARKET_TICK_MS);
  const active = tickIndex >= startTick && tickIndex <= startTick + durTicks;
  return { windowIdx, startTick, active, event };
}

// Deterministische Breaking-News: ca. alle 15-25s wirkt ein Titel (für alle
// Geräte identisch ausgewählt) kurzzeitig auf eine Aktie.
const NEWS_WINDOW_TICKS = Math.round(17000 / MARKET_TICK_MS);
function sharedNews(tickIndex) {
  const windowIdx = Math.floor(tickIndex / NEWS_WINDOW_TICKS);
  if (detRand("news:fire", windowIdx) > 0.6) return null;
  const windowStart = windowIdx * NEWS_WINDOW_TICKS;
  const item = NEWS_TEMPLATES[Math.floor(detRand("news:item", windowIdx) * NEWS_TEMPLATES.length)];
  const candidates = item.companies || STOCKS.filter((s) => !item.cat || s.cat === item.cat).map((s) => s.id);
  const pool = candidates.length ? candidates : STOCKS.map((s) => s.id);
  const targetId = pool[Math.floor(detRand("news:target", windowIdx) * pool.length)];
  const effect = detRange("news:effect", windowIdx, item.pct[0], item.pct[1]);
  const durTicks = Math.round(35000 / MARKET_TICK_MS);
  const active = tickIndex >= windowStart && tickIndex <= windowStart + durTicks;
  return { windowIdx, windowStart, active, item, targetId, effect };
}

// Deterministische Rivalen-Posts: ca. alle 40s pusht ein KI-Rivale eine
// Aktie aus seinem Fokus-Sektor.
const RIVALPOST_WINDOW_TICKS = Math.round(42000 / MARKET_TICK_MS);
function sharedRivalPost(tickIndex) {
  const windowIdx = Math.floor(tickIndex / RIVALPOST_WINDOW_TICKS);
  const rival = RIVALS[Math.floor(detRand("rival:pick", windowIdx) * RIVALS.length)];
  const pool = STOCKS.filter((s) => s.cat === rival.focus);
  if (!pool.length) return null;
  const target = pool[Math.floor(detRand("rival:stock", windowIdx) * pool.length)];
  const dir = detRand("rival:dir", windowIdx) < 0.5 ? 1 : -1;
  const effect = dir * detRange("rival:mag", windowIdx, 0.02, 0.06);
  const windowStart = windowIdx * RIVALPOST_WINDOW_TICKS;
  const durTicks = Math.round(30000 / MARKET_TICK_MS);
  const active = tickIndex >= windowStart && tickIndex <= windowStart + durTicks;
  return { windowIdx, windowStart, active, rival, stockId: target.id, effect };
}

// Voller geteilter Kurs (ohne persönlichen Multiplikator) für eine Aktie zu einem Tick-Index.
function sharedStockPrice(cfg, tickIndex) {
  let logDelta = sharedStockLogReturn(cfg, tickIndex);
  const crash = sharedFlashCrash(tickIndex);
  if (crash && crash.active) logDelta += Math.log(1 - crash.depth);
  const crisis = sharedCrisis(tickIndex);
  if (crisis && crisis.active) {
    if (crisis.event.boomCat === cfg.cat) logDelta += Math.log(1 + (crisis.event.boomPct || 0) * 0.4);
    if (crisis.event.crashCat === cfg.cat) logDelta += Math.log(1 + (crisis.event.crashPct || 0) * 0.7);
  }
  const news = sharedNews(tickIndex);
  if (news && news.active && news.targetId === cfg.id) logDelta += Math.log(1 + news.effect);
  const rivalPost = sharedRivalPost(tickIndex);
  if (rivalPost && rivalPost.active && rivalPost.stockId === cfg.id) logDelta += Math.log(1 + rivalPost.effect);
  const price = cfg.base * Math.exp(logDelta);
  return clamp(price, cfg.base * 0.03, cfg.base * 60);
}

// Gemeinsamer Krypto-Coin-Kurs, gleiches Prinzip wie oben.
function sharedCoinPrice(tickIndex) {
  const coinVol = 0.07, coinDrift = 0.0005; // Krypto: mindestens so crash-/boomfreudig wie die volatilsten Aktien
  const regime = regimeSignal("coin", coinVol, coinDrift, tickIndex);
  const macro = fbmNoise("coin:macro", tickIndex / 200, 3);
  const micro = fbmNoise("coin:micro", tickIndex / 9, 2);
  const logDelta = regime + coinVol * (macro * 3.2 + micro * 1.6);
  return clamp(COIN_PRICE_BASE * Math.exp(logDelta), COIN_PRICE_BASE * 0.04, COIN_PRICE_BASE * 15);
}

// Wendet einen rein persönlichen Kurs-Effekt an (Social-Post, Insider-Tipp,
// Meme, ...) — verändert nie den geteilten Kurs selbst, nur den lokalen
// Multiplikator dieses Spielers, und aktualisiert st.price sofort für
// direktes visuelles Feedback statt erst beim nächsten Tick.
function applyLocalPriceEffect(cfg, effect) {
  const st = S.stocks[cfg.id];
  st.localMult = clamp((st.localMult || 1) * (1 + effect), 0.15, 6);
  st.price = clamp(sharedStockPrice(cfg, marketTickIndex(now())) * st.localMult, cfg.base * 0.03, cfg.base * 60);
  return st.price;
}

// ============================================================
// STATE
// ============================================================
const SAVE_KEY = "boersentycoon_save_v1";
const PRESTIGE_KEY = "boersentycoon_prestige_v1";

function freshState() {
  const stocks = {};
  // Startkurse/-verlauf werden aus der geteilten Marktformel entnommen (statt
  // flach bei base zu beginnen), damit ein neuer Spieler sofort denselben
  // Kurs und Chart-Verlauf sieht wie alle anderen bereits aktiven Spieler.
  const seedTick = marketTickIndex(now());
  STOCKS.forEach((s) => {
    const history = [];
    let ath = s.base;
    // Ein einziger Scan VORWÄRTS in der Zeit (älteste zuerst) für beide
    // Bedarfe zugleich: grobe Stichprobe über 2000 Ticks für die ATH-
    // Schätzung, plus jeden einzelnen der letzten 30 Ticks für den Chart.
    // Wichtig, dass hier vorwärts statt rückwärts gescannt wird — die
    // Regime-Ebene cached nur den zuletzt erreichten Zeitpunkt, ein
    // rückwärts springender Scan würde bei jeder älteren Stichprobe erneut
    // (teuer) neu rechnen müssen.
    for (let i = 2000; i >= 0; i--) {
      const needAth = i % 8 === 0;
      const needHistory = i < 30;
      if (!needAth && !needHistory) continue;
      const p = sharedStockPrice(s, seedTick - i);
      if (needAth && p > ath) ath = p;
      if (needHistory) history.push(p);
    }
    stocks[s.id] = {
      price: history[history.length - 1], history,
      ath, boostUntil: 0, crashUntil: 0, markerUntil: 0, markerType: "",
      lastPostTick: 0, manipCount: 0, manipWindowStart: 0, localMult: 1,
    };
  });
  const upgrades = {}, employees = {}, luxury = {}, skills = {};
  const coinPrice = sharedCoinPrice(seedTick);
  return {
    cash: STARTING_CASH,
    stocks,
    portfolio: {}, // id -> {shares, avgPrice, short, shortAvg}
    followers: 50, trust: 50, verified: false,
    shitstormUntil: 0, sponsorActive: false, sponsorSince: 0,
    predictions: [], // {stockId, dir, priceAtPost, postedAt, expiresAt, resolved}
    trending: [],
    feed: [],
    viralBoost: 0,
    secHeat: 0,
    frozenUntil: 0,
    raidActive: false,
    coins: 0, coinPrice, coinHistory: [coinPrice],
    rigs: [], fuseTripped: false, powerCap: 4,
    upgrades, employees, luxury, skills, skillPoints: 0,
    estateIndex: 0,
    inbox: [], informantUsesCount: 0,
    ipo: { founded: false, name: "", logo: "🏢", ticker: "", price: 0, issuePrice: 0,
      playerPct: 100, marketCap: 0, dividendRate: 2, hqUnlocked: false, hostileSince: 0 },
    stats: { athNetWorth: STARTING_CASH, biggestWin: 0, biggestLoss: 0, totalTrades: 0, startedAt: now() },
    rouletteHistory: [],
    autopilot: true,
    overclockUntil: 0, overclockCdUntil: 0,
    theme: "default", soundOn: true,
    tutorialStep: 0, tutorialDone: false,
    analyseCdUntil: 0,
    lastNewsAt: 0,
    marketStock: null, // for animation flags
  };
}

let S = null;
let PRESTIGE = { count: 0, followerMult: 1, costReduction: 0 };

function loadPrestige() {
  try {
    const raw = localStorage.getItem(PRESTIGE_KEY);
    if (raw) PRESTIGE = JSON.parse(raw);
  } catch (e) {}
}
function savePrestige() {
  try { localStorage.setItem(PRESTIGE_KEY, JSON.stringify(PRESTIGE)); } catch (e) {}
}

// Ergänzt fehlende/neue Aktien-Felder in einem geladenen Spielstand (neue
// Aktien seit dem letzten Speichern, oder — wie localMult — Felder, die es
// beim Speichern noch gar nicht gab).
function ensureStockFields() {
  STOCKS.forEach((s) => {
    if (!S.stocks[s.id]) S.stocks[s.id] = freshState().stocks[s.id];
    if (typeof S.stocks[s.id].localMult !== "number") S.stocks[s.id].localMult = 1;
  });
}

function loadGame() {
  loadPrestige();
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const loaded = JSON.parse(raw);
      S = Object.assign(freshState(), loaded);
      ensureStockFields();
      return true;
    }
  } catch (e) { console.warn("Save korrupt, neu gestartet.", e); }
  S = freshState();
  return false;
}
function saveGame() {
  try {
    S.savedAt = now();
    localStorage.setItem(SAVE_KEY, JSON.stringify(S));
  } catch (e) {}
}
function hasRealProgress(state) {
  return state.cash !== STARTING_CASH || state.stats.totalTrades > 0 || state.rigs.length > 0
    || state.followers !== 50 || Object.keys(state.upgrades).length > 0 || state.ipo.founded;
}

// ============================================================
// CLOUD AUTH & SYNC (Firebase, optional)
// ============================================================
let fbApp = null, fbAuth = null, fbDb = null;
let cloudUser = null;
let cloudSyncing = false;
let cloudLastSyncedAt = 0;

function cloudInit() {
  if (typeof FIREBASE_CONFIGURED === "undefined" || !FIREBASE_CONFIGURED) { renderLeaderboardUnavailable(); return; }
  if (typeof firebase === "undefined") { console.warn("Firebase-SDK konnte nicht geladen werden — Cloud-Speicher deaktiviert."); renderLeaderboardUnavailable(); return; }
  try {
    fbApp = firebase.initializeApp(FIREBASE_CONFIG);
    fbAuth = firebase.auth();
    fbDb = firebase.firestore();
    fbAuth.onAuthStateChanged(onCloudAuthChanged);
    initLeaderboard();
  } catch (e) { console.warn("Firebase-Init fehlgeschlagen — Cloud-Speicher deaktiviert.", e); fbApp = null; renderLeaderboardUnavailable(); }
}

// ---- Bestenliste (öffentlich lesbar, jede*r schreibt nur den eigenen Eintrag) ----
function leaderboardName(email) {
  const prefix = (email || "Spieler").split("@")[0];
  return (prefix.length > 3 ? prefix.slice(0, 3) : prefix) + "***";
}
function syncLeaderboard() {
  if (!fbDb || !cloudUser) return;
  fbDb.collection("leaderboard").doc(cloudUser.uid).set({
    name: leaderboardName(cloudUser.email),
    netWorth: netWorth(),
    rank: rankFor(netWorth()).name,
    updatedAtMs: now(),
  }).catch(() => {});
}
function initLeaderboard() {
  if (!fbDb) { renderLeaderboardUnavailable(); return; }
  fbDb.collection("leaderboard").orderBy("netWorth", "desc").limit(20).onSnapshot(
    (snap) => {
      const rows = [];
      snap.forEach((doc) => rows.push(Object.assign({ uid: doc.id }, doc.data())));
      renderLeaderboard(rows);
    },
    () => renderLeaderboardRulesOutdated()
  );
}
function renderLeaderboard(rows) {
  const el = $("leaderboard-list");
  if (!el) return;
  if (!rows.length) { el.innerHTML = '<p class="hint">Noch keine Einträge — sei der Erste!</p>'; return; }
  const medals = ["🥇", "🥈", "🥉"];
  el.innerHTML = rows.map((r, i) => `
    <div class="lb-row ${cloudUser && r.uid === cloudUser.uid ? "me" : ""}">
      <span class="lb-rank">${medals[i] || "#" + (i + 1)}</span>
      <span class="lb-name-wrap"><span class="lb-name">${r.name || "Spieler"}</span><span class="lb-title">${r.rank || ""}</span></span>
      <span class="lb-worth">${fmtMoney(r.netWorth || 0)}</span>
    </div>`).join("");
}
function renderLeaderboardUnavailable() {
  const el = $("leaderboard-list");
  if (el) el.innerHTML = '<p class="hint">Bestenliste braucht Cloud-Speicher — diese Funktion ist auf dieser Seite noch nicht eingerichtet.</p>';
}
// Feuert, wenn Firebase konfiguriert ist, das Lesen der Bestenliste aber
// abgelehnt wird — fast immer, weil die Firestore-Regeln noch nicht die
// leaderboard-Collection aus firestore.rules enthalten.
function renderLeaderboardRulesOutdated() {
  const el = $("leaderboard-list");
  if (el) el.innerHTML = '<p class="hint">Bestenliste konnte nicht geladen werden. Das liegt fast immer an veralteten Firestore-Regeln — prüfe, ob der aktuelle Inhalt aus <code>firestore.rules</code> in der Firebase-Konsole unter „Regeln" veröffentlicht ist.</p>';
}

function onCloudAuthChanged(user) {
  cloudUser = user;
  renderAccountUi();
  if (user) resolveCloudOnLogin();
}

async function resolveCloudOnLogin() {
  if (!fbDb || !cloudUser) return;
  try {
    const doc = await fbDb.collection("saves").doc(cloudUser.uid).get();
    if (!doc.exists) { await cloudSaveNow(true); return; }
    const cloud = doc.data();
    const cloudState = JSON.parse(cloud.json);
    const localHasProgress = hasRealProgress(S);
    const cloudHasProgress = hasRealProgress(cloudState);
    if (!localHasProgress && cloudHasProgress) {
      applyCloudState(cloudState);
    } else if (localHasProgress && cloudHasProgress && Math.abs((S.savedAt || 0) - (cloud.updatedAtMs || 0)) > 15000) {
      askCloudConflict(cloudState, cloud.updatedAtMs || 0);
    } else if (!localHasProgress && !cloudHasProgress) {
      applyCloudState(cloudState);
    } else {
      await cloudSaveNow(true);
    }
  } catch (e) { console.warn("Cloud-Spielstand konnte nicht geladen werden.", e); }
}

function applyCloudState(cloudState) {
  S = Object.assign(freshState(), cloudState);
  ensureStockFields();
  saveGame();
  renderAll();
  applyTheme();
  pushNotify("☁️ Cloud-Spielstand geladen", "Dein Fortschritt von einem anderen Gerät wurde geladen.");
}

function askCloudConflict(cloudState, cloudUpdatedAtMs) {
  const cloudDate = cloudUpdatedAtMs ? new Date(cloudUpdatedAtMs).toLocaleString("de-DE") : "unbekannt";
  const localDate = S.savedAt ? new Date(S.savedAt).toLocaleString("de-DE") : "unbekannt";
  openModal(`
    <h2>☁️ Zwei Spielstände gefunden</h2>
    <p>Auf diesem Gerät und in deinem Account gibt es unterschiedliche Spielstände. Welchen möchtest du behalten? Der jeweils andere geht dabei verloren.</p>
    <p style="font-size:0.8rem;color:var(--text-dim)">Cloud zuletzt gespeichert: ${cloudDate}<br>Dieses Gerät zuletzt gespeichert: ${localDate}</p>
    <div class="modal-actions">
      <button class="btn btn-secondary" id="conflict-local">Diesen Browser-Stand behalten</button>
      <button class="btn btn-primary" id="conflict-cloud">Cloud-Stand laden</button>
    </div>`);
  $("conflict-cloud").onclick = () => { applyCloudState(cloudState); closeModal(); };
  $("conflict-local").onclick = () => { cloudSaveNow(true); closeModal(); pushNotify("☁️ Hochgeladen", "Dein lokaler Spielstand überschreibt jetzt die Cloud."); };
}

async function cloudSaveNow(silent) {
  if (!fbDb || !cloudUser) return;
  cloudSyncing = true;
  renderAccountUi();
  try {
    S.savedAt = now();
    await fbDb.collection("saves").doc(cloudUser.uid).set({
      json: JSON.stringify(S),
      email: cloudUser.email,
      updatedAtMs: S.savedAt,
    });
    cloudLastSyncedAt = now();
    syncLeaderboard();
    if (!silent) pushNotify("☁️ Gespeichert", "Dein Fortschritt wurde in die Cloud hochgeladen.");
  } catch (e) { if (!silent) pushNotify("⚠️ Sync fehlgeschlagen", "Cloud-Speichern hat nicht geklappt. Versuch's gleich nochmal."); }
  cloudSyncing = false;
  renderAccountUi();
}

function cloudSyncTick() {
  if (cloudUser && !cloudSyncing) cloudSaveNow(true);
}

async function authRegister(email, password) {
  if (!fbAuth) return { error: "Cloud-Speicher ist nicht eingerichtet." };
  try {
    const cred = await fbAuth.createUserWithEmailAndPassword(email, password);
    await cred.user.sendEmailVerification();
    return { ok: true };
  } catch (e) { return { error: authErrorText(e) }; }
}
async function authLogin(email, password) {
  if (!fbAuth) return { error: "Cloud-Speicher ist nicht eingerichtet." };
  try { await fbAuth.signInWithEmailAndPassword(email, password); return { ok: true }; }
  catch (e) { return { error: authErrorText(e) }; }
}
async function authLogout() {
  if (cloudUser) await cloudSaveNow(true);
  if (fbAuth) await fbAuth.signOut();
}
async function authResetPassword(email) {
  if (!fbAuth) return { error: "Cloud-Speicher ist nicht eingerichtet." };
  try { await fbAuth.sendPasswordResetEmail(email); return { ok: true }; }
  catch (e) { return { error: authErrorText(e) }; }
}
async function authResendVerification() {
  if (cloudUser && !cloudUser.emailVerified) {
    try { await cloudUser.sendEmailVerification(); pushNotify("📧 E-Mail gesendet", "Bestätigungslink wurde erneut verschickt."); }
    catch (e) { pushNotify("⚠️ Fehler", "Konnte die E-Mail nicht senden. Versuch's später nochmal."); }
  }
}
function authErrorText(e) {
  const map = {
    "auth/email-already-in-use": "Diese E-Mail-Adresse ist bereits registriert.",
    "auth/invalid-email": "Das ist keine gültige E-Mail-Adresse.",
    "auth/weak-password": "Das Passwort muss mindestens 6 Zeichen haben.",
    "auth/user-not-found": "Kein Account mit dieser E-Mail gefunden.",
    "auth/wrong-password": "Falsches Passwort.",
    "auth/invalid-credential": "E-Mail oder Passwort ist falsch.",
    "auth/too-many-requests": "Zu viele Versuche. Bitte kurz warten.",
  };
  return map[e.code] || "Etwas ist schiefgelaufen. Bitte nochmal versuchen.";
}

// ============================================================
// AUDIO / JUICE
// ============================================================
let actx = null;
function ensureAudio() { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } }
function playSound(freq = 440, dur = 0.12, type = "sine", vol = 0.08) {
  if (!S.soundOn) return;
  ensureAudio();
  if (!actx) return;
  try {
    const osc = actx.createOscillator();
    const gain = actx.createGain();
    osc.type = type; osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, actx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
    osc.connect(gain); gain.connect(actx.destination);
    osc.start(); osc.stop(actx.currentTime + dur);
  } catch (e) {}
}
const SND = {
  // Trading
  buy: () => playSound(520, 0.1, "triangle"),
  sell: () => playSound(340, 0.1, "triangle"),
  gain: () => playSound(700, 0.15, "sine"),
  loss: () => playSound(180, 0.2, "sawtooth"),
  dividend: () => playSound(950, 0.05, "sine", 0.035),
  crash: () => { playSound(220, 0.2, "sawtooth", 0.09); setTimeout(() => playSound(140, 0.28, "sawtooth", 0.09), 110); },
  // UI
  click: () => playSound(880, 0.05, "square", 0.04),
  tab: () => playSound(520, 0.05, "sine", 0.035),
  toggle: () => playSound(680, 0.06, "triangle", 0.05),
  modalOpen: () => playSound(440, 0.07, "sine", 0.05),
  modalClose: () => playSound(320, 0.06, "sine", 0.04),
  purchase: () => { playSound(500, 0.06, "triangle", 0.06); setTimeout(() => playSound(720, 0.09, "triangle", 0.06), 60); },
  denied: () => playSound(150, 0.15, "sawtooth", 0.07),
  notification: () => { playSound(700, 0.05, "sine", 0.04); setTimeout(() => playSound(880, 0.07, "sine", 0.04), 70); },
  // Generisches Feedback
  alert: () => playSound(240, 0.25, "square", 0.1),
  success: () => { playSound(660, 0.08); setTimeout(() => playSound(880, 0.12), 90); },
  // Social
  post: () => { playSound(600, 0.05, "sine", 0.05); setTimeout(() => playSound(760, 0.08, "sine", 0.05), 70); },
  viral: () => [520, 660, 880, 1040].forEach((f, i) => setTimeout(() => playSound(f, 0.1, "triangle", 0.06), i * 70)),
  followerLoss: () => playSound(200, 0.18, "sawtooth", 0.06),
  // Mining
  wire: () => playSound(900, 0.06, "sine", 0.04),
  overheat: () => playSound(180, 0.3, "sawtooth", 0.08),
  fuseTrip: () => { playSound(120, 0.3, "sawtooth", 0.09); setTimeout(() => playSound(90, 0.35, "sawtooth", 0.09), 150); },
  fuseFixed: () => playSound(700, 0.12, "sine", 0.06),
  coin: () => playSound(1200, 0.04, "square", 0.03),
  // SEC / Recht
  secWarn: () => playSound(260, 0.2, "square", 0.07),
  raid: () => [200, 160, 200, 160].forEach((f, i) => setTimeout(() => playSound(f, 0.15, "sawtooth", 0.09), i * 140)),
  // Meilensteine
  levelUp: () => [440, 554, 659, 880].forEach((f, i) => setTimeout(() => playSound(f, 0.15, "triangle", 0.07), i * 90)),
  ath: () => { playSound(880, 0.1, "sine", 0.07); setTimeout(() => playSound(1100, 0.15, "sine", 0.07), 90); },
  jackpot: () => [660, 880, 1100, 1320].forEach((f, i) => setTimeout(() => playSound(f, 0.18, "triangle", 0.08), i * 80)),
  prestige: () => [440, 554, 659, 880, 1108].forEach((f, i) => setTimeout(() => playSound(f, 0.2, "triangle", 0.07), i * 110)),
  // Casino
  cardFlip: () => playSound(500, 0.04, "square", 0.035),
  dice: () => playSound(rand(300, 500), 0.04, "square", 0.035),
  // Opt-out fuer Stellen, die schon einen eigenen Sound gespielt haben und
  // den automatischen pushNotify-Ton nicht zusaetzlich wollen.
  silent: () => {},
};

function spawnFloat(x, y, text, cls) {
  const el = document.createElement("div");
  el.className = "float-num " + cls;
  el.style.left = x + "px"; el.style.top = y + "px";
  el.textContent = text;
  $("float-layer").appendChild(el);
  setTimeout(() => el.remove(), 1350);
}
function floatAtEl(el, text, cls) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  spawnFloat(r.left + r.width / 2, r.top, text, cls);
}
function floatMoney(el, amount) {
  floatAtEl(el, (amount >= 0 ? "+" : "") + fmtMoney(amount), amount >= 0 ? "pos" : "neg");
}

let shakeTimeout = null;
function screenShake() {
  document.body.classList.add("screen-shake");
  clearTimeout(shakeTimeout);
  shakeTimeout = setTimeout(() => document.body.classList.remove("screen-shake"), 500);
}

// Confetti
const confettiCanvas = () => $("confetti-canvas");
let confettiParticles = [];
let confettiRunning = false;
function resizeConfetti() {
  const c = confettiCanvas();
  c.width = window.innerWidth; c.height = window.innerHeight;
}
window.addEventListener("resize", resizeConfetti);
function spawnConfetti(count = 60) {
  resizeConfetti();
  const colors = ["#2ee6a6", "#ffd166", "#7c5cff", "#00d1ff", "#ff4d6d"];
  for (let i = 0; i < count; i++) {
    confettiParticles.push({
      x: window.innerWidth / 2 + rand(-100, 100), y: window.innerHeight / 3,
      vx: rand(-4, 4), vy: rand(-8, -2), g: 0.18,
      color: choice(colors), size: rand(4, 8), life: 90 + Math.random() * 40, rot: rand(0, 360), vr: rand(-8, 8),
    });
  }
  if (!confettiRunning) { confettiRunning = true; requestAnimationFrame(confettiLoop); }
}
function confettiLoop() {
  const c = confettiCanvas(), ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);
  confettiParticles.forEach((p) => {
    p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life--;
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate((p.rot * Math.PI) / 180);
    ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
    ctx.restore();
  });
  confettiParticles = confettiParticles.filter((p) => p.life > 0 && p.y < window.innerHeight + 50);
  if (confettiParticles.length > 0) requestAnimationFrame(confettiLoop);
  else confettiRunning = false;
}

// Push notifications (Eilmeldungen). `tone` waehlt den Sound — die meisten
// Aufrufe lassen ihn weg und bekommen automatisch den dezenten Standard-Ton;
// nur wirklich markante Momente (Level-Up, Razzia, Crash, ...) geben einen
// eigenen, auffälligeren Ton mit.
const PUSH_MAX_VISIBLE = 3;
function pushNotify(title, text, tone) {
  const stack = $("push-stack");
  // Nie mehr als PUSH_MAX_VISIBLE Meldungen gleichzeitig stapeln — die
  // älteste fliegt sofort raus, statt dass der Bildschirm zugemüllt wird.
  while (stack.children.length >= PUSH_MAX_VISIBLE) stack.removeChild(stack.firstChild);
  const el = document.createElement("div");
  el.className = "push-item";
  el.innerHTML = `<div class="pt">${title}</div><div>${text}</div>`;
  stack.appendChild(el);
  (SND[tone] || SND.notification)();
  setTimeout(() => { el.classList.add("fading"); setTimeout(() => el.remove(), 400); }, 5200);
}

// ============================================================
// DERIVED HELPERS
// ============================================================
function netWorth() {
  let v = S.cash;
  for (const s of STOCKS) {
    const p = S.portfolio[s.id];
    if (p) {
      if (p.shares) v += p.shares * S.stocks[s.id].price;
      if (p.short) v += p.short * (p.shortAvg - S.stocks[s.id].price); // unrealized short pnl
    }
  }
  v += S.coins * S.coinPrice;
  if (S.ipo.founded) v += (S.ipo.playerPct / 100) * S.ipo.marketCap * 0.3; // konservativ angesetzt
  return v;
}
function hasUp(id) { return !!S.upgrades[id]; }
function hasEmp(id) { return !!S.employees[id]; }
function hasLux(id) { return !!S.luxury[id]; }
function hasSkill(id) { return !!S.skills[id]; }
function estate() { return ESTATES[S.estateIndex]; }
function feeRate() {
  let fee = 0.005;
  const swLevel = S.upgrades.trading_software || 0;
  fee *= Math.pow(0.75, swLevel);
  if (hasSkill("wallstreet_wolf")) fee = 0;
  if (estate().taxHaven) fee *= 1 - estate().taxHaven;
  return fee;
}
function secStage() {
  if (S.secHeat > 90) return 4;
  if (S.secHeat > 70) return 3;
  if (S.secHeat > 30) return 2;
  return 1;
}
function postInfluenceMultiplier() {
  let m = 1;
  if (S.verified || hasUp("blue_checkmark")) m *= 2;
  if (secStage() === 2) m *= 0.5;
  return m;
}
function automationActive(flagId) {
  return S.autopilot && hasUp(flagId);
}
function level() { return levelFor(netWorth()); }

// ============================================================
// STOCK ENGINE
// ============================================================
function stockPrice(id) { return S.stocks[id].price; }

function priceTick() {
  const t = now();
  const tickIndex = marketTickIndex(t);
  // Overclock bleibt ein rein persönlicher Effekt (zusätzliches lokales
  // Zittern über localMult), damit er den für alle geteilten Kurs nicht
  // nur für diesen Spieler verändert.
  const overclocking = t < S.overclockUntil;
  const crash = sharedFlashCrash(tickIndex);
  const crashActiveNow = !!(crash && crash.active);
  const crashUntilTs = crashActiveNow ? MARKET_EPOCH + crash.endTick * MARKET_TICK_MS : 0;

  STOCKS.forEach((cfg) => {
    const st = S.stocks[cfg.id];
    if (overclocking) st.localMult = clamp(st.localMult * (1 + (Math.random() * 2 - 1) * cfg.vol * 0.8), 0.15, 6);
    const np = clamp(sharedStockPrice(cfg, tickIndex) * (st.localMult || 1), cfg.base * 0.03, cfg.base * 60);
    st.price = np;
    st.crashUntil = crashUntilTs;
    st.history.push(np);
    if (st.history.length > 40) st.history.shift();
    if (np > st.ath) {
      const wasAth = st.ath;
      st.ath = np;
      // Deutlich seltener melden: mind. 1% über dem alten Hoch, niedrigere
      // Trefferchance, und je Aktie höchstens alle 90s eine Meldung —
      // sonst spammt ein einzelner volatiler Titel den Eilmeldungs-Stapel zu.
      const cooledDown = t - (st.athNotifiedAt || 0) > 90000;
      if (wasAth > 0 && np / wasAth > 1.01 && cooledDown && Math.random() < 0.2) {
        st.athNotifiedAt = t;
        onAllTimeHigh(cfg);
      }
    }
  });

  S.coinPrice = sharedCoinPrice(tickIndex);
  S.coinHistory.push(S.coinPrice);
  if (S.coinHistory.length > 40) S.coinHistory.shift();

  detectMarketEvents(tickIndex, crash, crashActiveNow);
  checkPredictions();
  renderStockGrid();
  renderPortfolio();
  renderHud();
}

function onAllTimeHigh(cfg) {
  pushNotify("🏆 ALL-TIME-HIGH", `${cfg.name} erreicht ein neues Rekordhoch!`, "ath");
}

// Merkt sich, welches Zeitfenster jedes ambiente Markt-Ereignis zuletzt
// gemeldet hat, damit Eilmeldung/Ticker/Screenshake pro Ereignis nur einmal
// (beim Start) statt bei jedem Tick erneut feuern. Rein lokale UI-
// Bookkeeping — beeinflusst den geteilten Kurs selbst nicht.
let marketEventEdge = { flashCrash: false, crisisWindow: -1, newsWindow: -1, rivalWindow: -1 };

function detectMarketEvents(tickIndex, crash, crashActiveNow) {
  if (crashActiveNow && !marketEventEdge.flashCrash) {
    addNewsTicker("📉 BÖRSENCRASH! Alle Kurse brechen ein — Kaufgelegenheit!", "crash");
    pushNotify("💥 FLASH CRASH", "Der Markt stürzt ab! Perfekte Kaufgelegenheit für kurze Zeit.", "crash");
    screenShake();
  }
  marketEventEdge.flashCrash = crashActiveNow;

  const crisis = sharedCrisis(tickIndex);
  const crisisKey = crisis && crisis.active ? crisis.windowIdx : -1;
  if (crisisKey !== -1 && crisisKey !== marketEventEdge.crisisWindow) {
    addNewsTicker(crisis.event.text, crisis.event.boomPct ? "boost" : "crash");
    pushNotify("🌍 WELT-EREIGNIS", crisis.event.text);
    screenShake();
  }
  marketEventEdge.crisisWindow = crisisKey;

  const news = sharedNews(tickIndex);
  const newsKey = news && news.active ? news.windowIdx : -1;
  if (newsKey !== -1 && newsKey !== marketEventEdge.newsWindow) {
    const cfg = STOCKS.find((s) => s.id === news.targetId);
    const text = news.item.text.replace("{company}", cfg.name);
    addNewsTicker(text, news.effect >= 0 ? "boost" : "crash");
    if (Math.abs(news.effect) > 0.2) pushNotify("📰 EILMELDUNG", text);
    S.stocks[news.targetId].markerUntil = now() + 35000;
    S.stocks[news.targetId].markerType = news.effect >= 0 ? "boost" : "crash";
  }
  marketEventEdge.newsWindow = newsKey;

  const rivalPost = sharedRivalPost(tickIndex);
  const rivalKey = rivalPost && rivalPost.active ? rivalPost.windowIdx : -1;
  if (rivalKey !== -1 && rivalKey !== marketEventEdge.rivalWindow) {
    const cfg = STOCKS.find((s) => s.id === rivalPost.stockId);
    addFeedItem(`${rivalPost.rival.emoji} ${rivalPost.rival.name}`, `${choice(RIVAL_COMMENTS_POOL)} (pusht ${cfg.name} ${pct(rivalPost.effect)})`, "rival");
  }
  marketEventEdge.rivalWindow = rivalKey;
}

// Einzige Quelle der Wahrheit für den Ticker-Inhalt. Beide Kopien (Original +
// Duplikat fürs nahtlose Marquee) werden aus demselben Array neu gebaut und
// ihre CSS-Animation wird bei jeder Änderung synchron neu gestartet — sonst
// können die zwei unabhängig laufenden Animationen nach vielen Änderungen
// (lange Spielzeit) leicht auseinanderdriften und sich sichtbar überlappen.
let newsTickerItems = [];
function addNewsTicker(text, cls) {
  newsTickerItems.push({ text, cls });
  if (newsTickerItems.length > 12) newsTickerItems.shift();
  renderNewsTicker();
}
function renderNewsTicker() {
  const content = $("news-ticker-content"), dup = $("news-ticker-content-dup");
  if (!content || !dup) return;
  const html = newsTickerItems
    .map((it) => `<span class="news-item${it.cls ? " " + it.cls : ""}">🔴 ${it.text}</span>`)
    .join("");
  content.innerHTML = html;
  dup.innerHTML = html;
  // Reflow erzwingen, damit beide Kopien garantiert bei Phase 0 neu starten.
  [content, dup].forEach((el) => {
    el.style.animation = "none";
    void el.offsetWidth;
    el.style.animation = "";
  });
}

// ---- Trading Actions ----
function buyStock(id, qty, el) {
  qty = Math.max(1, Math.floor(qty || 1));
  const st = S.stocks[id];
  const cost = st.price * qty * (1 + feeRate());
  if (cost > S.cash) { pushNotify("⚠️ Nicht genug Geld", "Du hast nicht genug Kapital für diesen Kauf.", "denied"); return; }
  S.cash -= cost;
  const p = (S.portfolio[id] = S.portfolio[id] || { shares: 0, avgPrice: 0, short: 0, shortAvg: 0 });
  p.avgPrice = (p.avgPrice * p.shares + st.price * qty) / (p.shares + qty);
  p.shares += qty;
  S.stats.totalTrades++;
  floatMoney(el, -cost);
  SND.buy();
  renderAll();
}
function sellStock(id, qty, el) {
  const p = S.portfolio[id];
  if (!p || p.shares <= 0) return;
  if (now() < S.frozenUntil) { pushNotify("🚨 Konto eingefroren", "Die Finanzaufsicht hat dein Konto vorübergehend gesperrt!"); return; }
  qty = Math.max(1, Math.min(p.shares, Math.floor(qty || 1)));
  const st = S.stocks[id];
  const proceeds = st.price * qty * (1 - feeRate());
  const gain = (st.price - p.avgPrice) * qty;
  S.cash += proceeds;
  p.shares -= qty;
  if (p.shares <= 0) p.avgPrice = 0;
  S.stats.totalTrades++;
  if (gain > S.stats.biggestWin) S.stats.biggestWin = gain;
  if (gain < S.stats.biggestLoss) S.stats.biggestLoss = gain;
  floatMoney(el, gain);
  if (gain > 0) { SND.gain(); if (gain > netWorth() * 0.05) spawnConfetti(70); } else SND.sell();
  renderAll();
}
function shortStock(id, qty, el) {
  if (!hasUp("leverage_unlock")) { pushNotify("🔒 Gesperrt", "Schalte zuerst 'Hebel-Trading' im Upgrade-Menü frei."); return; }
  const maxLev = hasSkill("wallstreet_wolf") ? 10 : 5;
  qty = Math.max(1, Math.floor(qty || 1));
  const st = S.stocks[id];
  const notional = st.price * qty;
  if (notional > S.cash * maxLev) { pushNotify("⚠️ Hebel-Limit", `Maximaler Hebel: ${maxLev}x deiner Kasse.`); return; }
  const p = (S.portfolio[id] = S.portfolio[id] || { shares: 0, avgPrice: 0, short: 0, shortAvg: 0 });
  p.shortAvg = (p.shortAvg * p.short + st.price * qty) / (p.short + qty);
  p.short += qty;
  floatAtEl(el, "SHORT geöffnet", "neg");
  SND.click();
  renderAll();
}
function closeShort(id, qty, el) {
  const p = S.portfolio[id];
  if (!p || p.short <= 0) return;
  qty = Math.max(1, Math.min(p.short, Math.floor(qty || 1)));
  const st = S.stocks[id];
  const gain = (p.shortAvg - st.price) * qty;
  S.cash += gain;
  p.short -= qty;
  if (p.short <= 0) p.shortAvg = 0;
  if (gain > S.stats.biggestWin) S.stats.biggestWin = gain;
  if (gain < S.stats.biggestLoss) S.stats.biggestLoss = gain;
  floatMoney(el, gain);
  gain >= 0 ? SND.gain() : SND.loss();
  renderAll();
}

function payDividends() {
  let total = 0;
  const yieldBase = 0.0035 * (1 + 0.2 * (S.upgrades.dividend_boost || 0));
  const taxCut = estate().taxHaven ? 1 - estate().taxHaven : 1;
  for (const s of STOCKS) {
    const p = S.portfolio[s.id];
    if (p && p.shares > 0) total += p.shares * S.stocks[s.id].price * yieldBase * taxCut;
  }
  if (total > 0.01) {
    S.cash += total;
    // Floating-Zahl + Sound reichen als Feedback — keine zusätzliche
    // Eilmeldung mehr, das lief bei jedem Aktienbesitz alle 30s auf und
    // hat den Eilmeldungs-Stapel zugemüllt.
    floatAtEl($("hud-cash"), "+" + fmtMoney(total), "pos");
    SND.dividend();
  }
}

// ============================================================
// SEC / BAFIN
// ============================================================
function addSecHeat(amount) {
  const reduction = estate().secReduction || 0;
  amount *= 1 - reduction;
  if (hasUp("lobbyarbeit")) amount *= 0.75;
  S.secHeat = clamp(S.secHeat + amount, 0, 100);
}
function secTick() {
  let decay = 0.4;
  if (hasUp("top_kanzlei")) decay *= 1.5;
  if (automationActive("auto_lobbyist")) decay += 0.6;
  S.secHeat = clamp(S.secHeat - decay, 0, 100);
  const stage = secStage();
  if (stage === 3 && Math.random() < 0.02 && now() > S.frozenUntil) {
    S.frozenUntil = now() + 30000;
    pushNotify("🚨 Betriebsprüfung", "Dein Konto wurde für 30 Sekunden eingefroren! Du kannst nicht verkaufen.");
  }
  if (stage === 4 && !S.raidActive) startRaid();
  renderSecBar();
}
function startRaid() {
  S.raidActive = true;
  if (automationActive("anwalts_automatik")) {
    resolveRaid(0.85);
    return;
  }
  screenShake();
  SND.raid();
  let progress = 0;
  const zoneStart = rand(30, 60);
  const html = `
    <h2>🚔 RAZZIA & GERICHTSVERFAHREN</h2>
    <p>Die Finanzaufsicht durchsucht dein Büro! Klicke "Reagieren", wenn der Zeiger in der grünen Zone ist, um die Strafe zu minimieren.</p>
    <div style="height:24px;background:var(--bg);border-radius:8px;position:relative;overflow:hidden;border:1px solid var(--border)">
      <div style="position:absolute;left:${zoneStart}%;width:22%;height:100%;background:var(--green);opacity:0.4"></div>
      <div id="raid-marker" style="position:absolute;top:0;left:0;width:4px;height:100%;background:var(--gold)"></div>
    </div>
    <div class="modal-actions"><button class="btn btn-primary" id="raid-btn">⚖️ Reagieren</button></div>
  `;
  openModal(html);
  const marker = $("raid-marker");
  const start = now();
  let raf;
  function anim() {
    const t = (now() - start) / 1000;
    const pos = (Math.sin(t * 2) * 0.5 + 0.5) * 96;
    marker.style.left = pos + "%";
    raf = requestAnimationFrame(anim);
    progress = pos;
  }
  anim();
  $("raid-btn").onclick = () => {
    cancelAnimationFrame(raf);
    const inZone = progress >= zoneStart && progress <= zoneStart + 22;
    resolveRaid(inZone ? 0.7 : 0.15);
    closeModal();
  };
  // Auto-Timeout nach 15s
  setTimeout(() => { if (S.raidActive) { cancelAnimationFrame(raf); resolveRaid(0.1); closeModal(); } }, 15000);
}
function resolveRaid(leniency) {
  S.raidActive = false;
  let fine = netWorth() * 0.12 * (1 - leniency);
  if (hasUp("junior_anwalt")) fine *= 0.8;
  S.cash -= fine;
  S.secHeat = 35;
  pushNotify("⚖️ Urteil gefällt", `Strafe: ${fmtMoney(fine)}. SEC-Risiko wurde zurückgesetzt.`);
  renderAll();
}

// ============================================================
// SOCIAL MEDIA
// ============================================================
const HYPE_COMMENTS = [
  "To the Moon! 🚀🚀", "Er hat es wieder vorhergesagt! 🚀", "LEGENDE! Sofort gekauft 💰",
  "Diamond Hands 💎🙌", "Bester Trader der Stadt!", "Ich folge jedem Tipp von dir!",
];
const MOCK_COMMENTS = [
  "Paper Hands 🤡", "Lol, das war ja mal falsch 😂", "Vielleicht solltest du aufhören zu posten...",
  "Rekt 📉", "Nicht schon wieder ein Fehltipp...", "Mein Hamster tradet besser.",
];
const RIVAL_COMMENTS_POOL = [
  "Meine Follower haben mit mir 10x mehr verdient! 💸", "Klassischer Anfänger-Move...",
  "Schau lieber, was ICH gerade pushe. 😏", "Das war Glück, nicht Können.",
];

function addFeedItem(user, text, cls) {
  S.feed.unshift({ user, text, cls, at: now() });
  if (S.feed.length > 60) S.feed.pop();
  renderFeed();
}

function postMessage(text, stockId, dir) {
  const followerMult = postInfluenceMultiplier() * (1 + S.viralBoost);
  text = text && text.trim() ? text.trim() : `${STOCKS.find(s=>s.id===stockId).name} macht bald was Großes! ${dir === "up" ? "📈" : "📉"}`;
  addFeedItem("Du", text, "player");
  S.predictions.push({ stockId, dir, priceAtPost: S.stocks[stockId].price, postedAt: now(), expiresAt: now() + 30000, resolved: false });

  // Kurs-Einfluss (begrenzt auf max +/-15%, SEC-Markt-Einfluss-Limit) — wirkt
  // nur auf deinen eigenen lokalen Kurs, nicht auf den geteilten Markt.
  const st = S.stocks[stockId];
  const cfg = STOCKS.find((s) => s.id === stockId);
  const influenceCap = 0.15;
  let influence = clamp((S.followers / 30000) * 0.02 * followerMult, 0, influenceCap);
  if (dir === "down") influence = -influence;
  applyLocalPriceEffect(cfg, influence);
  st.markerUntil = now() + 30000; st.markerType = influence >= 0 ? "boost" : "crash";

  // SEC-Manipulations-Tracking: mehrfaches Pushen derselben Aktie kurz hintereinander
  if (now() - st.manipWindowStart > 60000) { st.manipWindowStart = now(); st.manipCount = 0; }
  st.manipCount++;
  addSecHeat(3 + (st.manipCount > 2 ? 8 : 0));

  // kleiner sofortiger Follower-Tick für Interaktion
  S.followers = Math.max(10, S.followers + randInt(1, 5) * PRESTIGE.followerMult);
  S.viralBoost = 0;
  renderAll();
  SND.post();

  // Zufällige schnelle Reaktion eines KI-Users
  setTimeout(() => {
    addFeedItem(choice(["📊 MarketWatcher99", "😎 TraderTom", "🤖 StonkBot"]), choice(HYPE_COMMENTS.concat(MOCK_COMMENTS)), Math.random() < 0.6 ? "hype" : "mock");
  }, rand(800, 2200));
}

function checkPredictions() {
  const t = now();
  S.predictions.forEach((pr) => {
    if (pr.resolved || t < pr.expiresAt) return;
    pr.resolved = true;
    const cur = S.stocks[pr.stockId].price;
    const changed = (cur - pr.priceAtPost) / pr.priceAtPost;
    const cfg = STOCKS.find((s) => s.id === pr.stockId);
    const correct = (pr.dir === "up" && changed > 0.001) || (pr.dir === "down" && changed < -0.001);
    const wrong = (pr.dir === "up" && changed < -0.001) || (pr.dir === "down" && changed > 0.001);
    if (correct) {
      const gain = 0.15 * PRESTIGE.followerMult * (hasSkill("viral_king") ? 2 : 1);
      S.followers = Math.round(S.followers * (1 + gain));
      S.trust = clamp(S.trust + 5, 0, 100);
      addFeedItem(choice(["🚀 CryptoFan88", "📈 InvestorIna", "🔥 HypeHans"]), `${choice(HYPE_COMMENTS)} (${cfg.name} ${pct(changed)})`, "hype");
      pushNotify("📈 Vorhersage traf ein!", `+${Math.round(gain * 100)}% Follower — ${cfg.name} bewegte sich wie vorhergesagt!`, "success");
    } else if (wrong) {
      const loss = 0.07 * (1 - PRESTIGE.followerMult * 0.05);
      S.followers = Math.max(10, Math.round(S.followers * (1 - loss)));
      S.trust = clamp(S.trust - 6, 0, 100);
      addFeedItem(choice(["😂 SkepticSven", "🤡 ShortSeller", "📉 BearBerta"]), `${choice(MOCK_COMMENTS)} (${cfg.name} ${pct(changed)})`, "mock");
      pushNotify("📉 Vorhersage lag daneben", `${cfg.name} lief entgegengesetzt — Follower-Verlust.`, "followerLoss");
      if (Math.random() < 0.25) startShitstorm();
    }
    renderAll();
  });
  S.predictions = S.predictions.filter((p) => !p.resolved || now() - p.expiresAt < 5000);
}

function startShitstorm() {
  S.shitstormUntil = now() + 60000;
  pushNotify("🌩️ SHITSTORM!", "Deine Follower sind sauer über deinen Fehltipp. Reichweite sinkt vorübergehend.");
  addFeedItem("🌩️ Shitstorm-Bot", "Ganz Twitter zerreißt sich über deinen Tipp... 🔥", "mock");
}
function apologyCampaign() {
  const cost = 15000;
  if (S.cash < cost) { pushNotify("⚠️ Nicht genug Geld", "Entschuldigungs-Kampagne kostet " + fmtMoney(cost), "denied"); return; }
  S.cash -= cost;
  S.shitstormUntil = 0;
  S.trust = clamp(S.trust + 10, 0, 100);
  pushNotify("🕊️ Entschuldigung angenommen", "Der Shitstorm ist vorbei.");
  renderAll();
}

function fakeNewsCampaign() {
  const cost = 25000;
  if (S.cash < cost) { pushNotify("⚠️ Nicht genug Geld", "Fake-News-Kampagne kostet " + fmtMoney(cost), "denied"); return; }
  S.cash -= cost;
  addSecHeat(15);
  const target = choice(STOCKS);
  const success = Math.random() < 0.55;
  const effect = success ? rand(0.1, 0.3) : rand(-0.1, 0.05);
  const st = S.stocks[target.id];
  applyLocalPriceEffect(target, effect);
  st.markerUntil = now() + 45000; st.markerType = effect >= 0 ? "boost" : "crash";
  addNewsTicker(`Gerücht verbreitet sich über ${target.name}...`, effect >= 0 ? "boost" : "crash");
  pushNotify(success ? "🕶️ Kampagne erfolgreich!" : "🕶️ Kampagne verpufft", `${target.name}: ${pct(effect)}`);
  renderAll();
}

function generateMeme(topic) {
  const st = STOCKS.find((s) => topic.includes(s.name)) || choice(STOCKS);
  const matches = Math.random() < 0.6;
  const boost = matches ? rand(0.08, 0.22) : rand(-0.03, 0.05);
  const s = S.stocks[st.id];
  applyLocalPriceEffect(st, boost);
  s.markerUntil = now() + 30000; s.markerType = boost >= 0 ? "boost" : "crash";
  S.followers = Math.round(S.followers * (1 + (matches ? 0.06 : 0.01)) * PRESTIGE.followerMult);
  addFeedItem("Du", `🖼️ Meme gepostet zu ${topic}`, "player");
  addFeedItem("😂 MemeLord42", matches ? "VIRAL! 🔥🔥🔥 Bestes Meme ever" : "Naja, ganz witzig...", matches ? "hype" : "mock");
  pushNotify(matches ? "🖼️ Meme viral!" : "🖼️ Meme gepostet", `${st.name} ${pct(boost)}`);
  renderAll();
}

function refreshTrending() {
  const tags = ["#CryptoCrash", "#AIHype", "#MemeStock", "#ToTheMoon", "#MarketCrash", "#BioBreakthrough", "#SpaceRace", "#SolarBoom"];
  S.trending = [];
  for (let i = 0; i < 3; i++) S.trending.push(choice(tags));
  renderTrending();
}

function checkSponsor() {
  if (!S.sponsorActive && S.followers >= 10000) {
    S.sponsorActive = true; S.sponsorSince = now();
    pushNotify("💼 Sponsoring erhalten!", "Ein Unternehmen zahlt dir jetzt laufende Werbe-Einnahmen.", "levelUp");
  }
  if (!S.verified && S.followers >= 100000) {
    S.verified = true;
    pushNotify("✔️ Verifiziert!", "Du hast den blauen Haken erhalten — doppelte Post-Wirkung!", "jackpot");
    spawnConfetti(100);
  }
}

// Rival-Posts werden jetzt deterministisch in detectMarketEvents() (siehe
// priceTick) ausgelöst, damit sie für alle Spieler zum selben Zeitpunkt
// dieselbe Aktie bewegen statt bei jedem Client zufällig unabhängig.

// ============================================================
// MINING
// ============================================================
function rigCost(type) {
  const owned = S.rigs.filter((r) => r.typeId === type.id).length;
  return Math.round(type.cost * Math.pow(type.scaling, owned));
}
function buyRig(typeId) {
  const type = RIG_TYPES.find((r) => r.id === typeId);
  if (estate().rigSlots <= S.rigs.length) { pushNotify("🚫 Kein Platz mehr", "Kaufe eine größere Immobilie für mehr Rig-Plätze."); return; }
  const cost = rigCost(type);
  if (S.cash < cost) { pushNotify("⚠️ Nicht genug Geld", `Rig kostet ${fmtMoney(cost)}`); return; }
  S.cash -= cost;
  S.rigs.push({ id: uid(), typeId, wired: automationActive("solar_auto_mgr"), temp: 20, overheated: false, boostUntil: 0 });
  renderMining();
  renderHud();
  SND.buy();
}
function wireRig(rigId) {
  const rig = S.rigs.find((r) => r.id === rigId);
  if (!rig || rig.wired) return;
  // Mini-Timing-Spiel: Marker-Position beim Klick entscheidet über Bonus
  const t = (now() % 1000) / 1000;
  const pos = Math.sin(t * Math.PI * 2) * 0.5 + 0.5;
  rig.wired = true;
  SND.wire();
  if (pos > 0.4 && pos < 0.6) { rig.boostUntil = now() + 60000; pushNotify("🔌 Perfekt verkabelt!", "+50% Ertrag für 60 Sekunden.", "success"); }
  renderMining();
}
function coolRig(rigId) {
  const rig = S.rigs.find((r) => r.id === rigId);
  if (!rig) return;
  rig.temp = Math.max(0, rig.temp - 18);
  renderMining();
}
function repairRig(rigId) {
  const rig = S.rigs.find((r) => r.id === rigId);
  if (!rig || !rig.overheated) return;
  rig._repairClicks = (rig._repairClicks || 0) + 1;
  if (rig._repairClicks >= 6) {
    rig.overheated = false; rig.temp = 20; rig._repairClicks = 0;
    pushNotify("🔧 Rig repariert!", "Bonus-Mining-Speed für 30 Sekunden.");
    rig.boostUntil = now() + 30000;
    SND.success();
  }
  renderMining();
}
function totalPower() {
  return S.rigs.reduce((sum, r) => {
    if (!r.wired || r.overheated) return sum;
    const type = RIG_TYPES.find((t) => t.id === r.typeId);
    return sum + type.powerKw;
  }, 0);
}
function powerCapacity() {
  return S.powerCap + estate().rigSlots * 0.4 + (hasUp("smart_grid") ? 20 : 0);
}
function miningTick() {
  const speed = now() < S.overclockUntil ? 3 : 1;
  const autoCool = automationActive("auto_cooling") || automationActive("solar_auto_mgr") || hasEmp("crypto_techniker");
  const noOverheatChance = hasSkill("crypto_guru") ? 0.5 : 0;
  const autoRepair = automationActive("robo_arm") || automationActive("solar_auto_mgr") || hasEmp("crypto_techniker");
  const smartGrid = automationActive("smart_grid") || automationActive("solar_auto_mgr");

  // Stromnetz
  if (!smartGrid && !S.fuseTripped) {
    const usage = totalPower();
    const cap = powerCapacity();
    if (usage > cap && Math.random() < 0.05) {
      S.fuseTripped = true;
      SND.fuseTrip();
      pushNotify("⚡ SICHERUNG RAUS!", "Das Stromnetz ist überlastet. Mining pausiert.", "silent");
    }
  }

  let coinGain = 0;
  S.rigs.forEach((r) => {
    const type = RIG_TYPES.find((t) => t.id === r.typeId);
    if (!r.wired) return;
    if (r.overheated) {
      if (autoRepair) { r.overheated = false; r.temp = 20; }
      return;
    }
    if (S.fuseTripped) return;
    // Temperatur
    if (!autoCool) {
      r.temp += rand(0.5, 1.5) * speed;
      if (r.temp >= 100 && Math.random() > noOverheatChance) { r.overheated = true; r.temp = 100; SND.overheat(); return; }
      else if (r.temp >= 100) r.temp = 60;
    } else {
      r.temp = Math.max(15, r.temp - 5);
    }
    let mult = 1;
    if (now() < r.boostUntil) mult *= 1.5;
    if (hasSkill("crypto_guru")) mult *= 1.5;
    coinGain += type.coinsPerSec * mult * speed;
  });
  S.coins += coinGain;

  // Krypto-Auto-Trader
  if (automationActive("crypto_auto_trader") && S.coins > 0.5) {
    const avg = S.coinHistory.reduce((a, b) => a + b, 0) / S.coinHistory.length;
    if (S.coinPrice > avg * 1.05) sellCoins(true);
  }
  renderMining();
}
function sellCoins(silent) {
  if (S.coins <= 0.001) return;
  const proceeds = S.coins * S.coinPrice * (1 - feeRate());
  S.cash += proceeds;
  if (!silent) { floatMoney($("btn-sell-coins"), proceeds); SND.gain(); }
  S.coins = 0;
  renderAll();
}
function fixFuse() {
  S.fuseTripped = false;
  SND.fuseFixed();
  pushNotify("🔌 Wieder am Netz", "Die Sicherung wurde erfolgreich zurückgesetzt.", "silent");
  renderMining();
}

// ============================================================
// UPGRADES / SKILLS / EMPLOYEES / ESTATE / LUXURY
// ============================================================
function upgradeCost(u) {
  const lvl = S.upgrades[u.id] || 0;
  const scaling = u.scaling || 1.9;
  const cr = 1 - PRESTIGE.costReduction;
  return Math.round(u.baseCost * Math.pow(scaling, lvl) * cr);
}
function buyUpgrade(catKey, id) {
  const u = UPGRADES[catKey].find((x) => x.id === id);
  if (!u) return;
  const lvl = S.upgrades[id] || 0;
  if (lvl >= u.max) return;
  if (u.requiresLevel && level() < u.requiresLevel) { pushNotify("🔒 Gesperrt", `Erfordert Level ${u.requiresLevel}.`, "denied"); return; }
  if (u.requiresFollowers && S.followers < u.requiresFollowers) { pushNotify("🔒 Gesperrt", `Erfordert ${fmtNum(u.requiresFollowers)} Follower.`, "denied"); return; }
  const cost = upgradeCost(u);
  if (S.cash < cost) { pushNotify("⚠️ Nicht genug Geld", fmtMoney(cost) + " nötig.", "denied"); return; }
  S.cash -= cost;
  S.upgrades[id] = lvl + 1;
  SND.purchase();
  pushNotify("✅ Upgrade gekauft", u.name, "silent");
  renderAll();
}
function buySkill(id) {
  const sk = SKILL_TREE.find((s) => s.id === id);
  if (!sk || hasSkill(id)) return;
  if (S.skillPoints < sk.cost) { pushNotify("⚠️ Zu wenig Talentpunkte", `Benötigt: ${sk.cost}`, "denied"); return; }
  S.skillPoints -= sk.cost;
  S.skills[id] = true;
  SND.purchase();
  pushNotify("🌳 Talent freigeschaltet", sk.name, "silent");
  renderAll();
}
function hireEmployee(id) {
  const e = EMPLOYEES.find((x) => x.id === id);
  if (!e || hasEmp(id)) return;
  if (S.cash < e.cost) { pushNotify("⚠️ Nicht genug Geld", fmtMoney(e.cost) + " nötig.", "denied"); return; }
  S.cash -= e.cost;
  S.employees[id] = true;
  SND.purchase();
  pushNotify("👥 Eingestellt", e.name, "silent");
  renderAll();
}
function buyEstate(id) {
  const idx = ESTATES.findIndex((e) => e.id === id);
  if (idx !== S.estateIndex + 1) return;
  const e = ESTATES[idx];
  if (S.cash < e.cost) { pushNotify("⚠️ Nicht genug Geld", fmtMoney(e.cost) + " nötig.", "denied"); return; }
  S.cash -= e.cost;
  S.estateIndex = idx;
  SND.levelUp();
  pushNotify("🏠 Neue Immobilie!", e.name, "silent");
  spawnConfetti(80);
  renderAll();
}
function buyLuxury(id) {
  const l = LUXURY_ITEMS.find((x) => x.id === id);
  if (!l || hasLux(id)) return;
  if (S.cash < l.cost) { pushNotify("⚠️ Nicht genug Geld", fmtMoney(l.cost) + " nötig.", "denied"); return; }
  S.cash -= l.cost;
  S.luxury[id] = true;
  SND.purchase();
  pushNotify("💎 Luxusgut erworben", l.name, "silent");
  spawnConfetti(60);
  renderAll();
}

function runningCosts() {
  const rentMap = [0, 800, 5000, 40000];
  const rent = rentMap[S.estateIndex];
  const powerPrice = automationActive("solar_auto_mgr") ? 0 : totalPower() * 4;
  const salaries = EMPLOYEES.reduce((sum, e) => sum + (hasEmp(e.id) ? e.salaryPerSec : 0), 0);
  return { rent: rent / 3600, power: powerPrice, salaries, total: rent / 3600 + powerPrice + salaries };
}
function costsTick() {
  const c = runningCosts();
  S.cash -= c.total;
  if (S.cash < -50000 && Math.random() < 0.05) pushNotify("🆘 Hohe Schulden!", "Deine laufenden Kosten übersteigen dein Vermögen deutlich!");
}

// ============================================================
// INBOX / INFORMANTEN
// ============================================================
function inboxLoop() {
  const delay = rand(35000, 70000);
  setTimeout(() => {
    spawnInboxMessage();
    inboxLoop();
  }, delay);
}
function spawnInboxMessage() {
  const candidates = INBOX_TEMPLATES.filter((t) => {
    if (t.requiresFollowers && S.followers < t.requiresFollowers) return false;
    if (t.requiresNetWorth && netWorth() < t.requiresNetWorth) return false;
    return true;
  });
  if (!candidates.length) return;
  const tmpl = choice(candidates);
  const company = choice(STOCKS);
  const msg = {
    id: uid(), from: tmpl.from.replace("{company}", company.name),
    subject: tmpl.subject, text: tmpl.text.replace("{company}", company.name),
    options: tmpl.options, read: false, answered: false, companyId: company.id, at: now(),
  };
  S.inbox.unshift(msg);
  if (S.inbox.length > 40) S.inbox.pop();
  renderInboxBadge();
  pushNotify("📥 Neue Nachricht", msg.from + ": " + msg.subject);

  if (automationActive("autonome_pr_kanzlei")) {
    setTimeout(() => answerInbox(msg.id, 0), 1500);
  }
}
function answerInbox(msgId, optionIndex) {
  const msg = S.inbox.find((m) => m.id === msgId);
  if (!msg || msg.answered) return;
  msg.answered = true; msg.read = true;
  const opt = msg.options[optionIndex];
  const eff = opt.effect || {};
  let resultText = "Antwort gesendet: " + opt.label;
  if (eff.trust) S.trust = clamp(S.trust + eff.trust, 0, 100);
  if (eff.cash) { const amt = S.cash * eff.cash; S.cash += amt; resultText += ` (${fmtMoney(amt)})`; }
  if (eff.hype) S.followers = Math.round(S.followers * (1 + eff.hype / 100));
  if (eff.rivalHeat) addSecHeat(eff.rivalHeat * 0.3);
  if (eff.sponsor) { S.sponsorActive = true; }
  if (eff.vipDeal) startInvestorDeal(msg.companyId);
  if (eff.sellStakeBonus) { const p = S.portfolio[msg.companyId]; if (p && p.shares) { const bonus = p.shares * S.stocks[msg.companyId].price * 0.15; S.cash += p.shares * S.stocks[msg.companyId].price + bonus; p.shares = 0; resultText += ` Verkauft mit Prämie: +${fmtMoney(bonus)}`; } }
  if (eff.openInformants) { switchInboxTab("informanten"); }
  if (eff.message) pushNotify("📩 Ergebnis", eff.message);
  else pushNotify("📩 Ergebnis", resultText);
  renderAll();
}
let activeInvestorDeal = null;
function startInvestorDeal(stockId) {
  const cfg = STOCKS.find((s) => s.id === stockId) || choice(STOCKS);
  S.cash += 300000;
  activeInvestorDeal = { stockId: cfg.id, targetPct: 0.2, startPrice: S.stocks[cfg.id].price, deadline: now() + 180000 };
  pushNotify("🦈 Deal angenommen!", `+300.000 € erhalten. Bringe ${cfg.name} in 3 Minuten um 20% nach oben!`);
}
function investorDealTick() {
  if (!activeInvestorDeal) return;
  const d = activeInvestorDeal;
  const cur = S.stocks[d.stockId].price;
  const change = (cur - d.startPrice) / d.startPrice;
  if (change >= d.targetPct) {
    S.cash += 180000;
    pushNotify("🏆 Deal erfüllt!", "+180.000 € Erfolgsprämie vom Großinvestor!");
    activeInvestorDeal = null;
  } else if (now() > d.deadline) {
    S.cash -= 90000;
    S.trust = clamp(S.trust - 10, 0, 100);
    pushNotify("😡 Deal gescheitert", "Konventionalstrafe: -90.000 €");
    activeInvestorDeal = null;
  }
}
function useInformant(idx) {
  const offer = INFORMANT_OFFERS[idx];
  if (S.cash < offer.cost) { pushNotify("⚠️ Nicht genug Geld", fmtMoney(offer.cost) + " nötig."); return; }
  S.cash -= offer.cost;
  addSecHeat(offer.secRisk);
  S.informantUsesCount++;
  const isFake = Math.random() < offer.fakeChance;
  const companies = offer.companies ? offer.companies.map((id) => STOCKS.find((s) => s.id === id)) : [choice(STOCKS)];
  const target = choice(companies);
  if (isFake) {
    pushNotify("😱 Fake-Info!", "Der Informant hat dich reingelegt. Kein Effekt.");
  } else {
    const effect = rand(offer.pct[0], offer.pct[1]);
    setTimeout(() => {
      const st = S.stocks[target.id];
      applyLocalPriceEffect(target, effect);
      st.markerUntil = now() + 45000; st.markerType = effect >= 0 ? "boost" : "crash";
      addNewsTicker(`${target.name} bewegt sich wie vom Informanten vorhergesagt...`, effect >= 0 ? "boost" : "crash");
      renderAll();
    }, 3000);
    pushNotify("🕵️ Info bestätigt!", `${target.name} wird sich in Kürze bewegen...`);
  }
  renderAll();
}

// ============================================================
// IPO
// ============================================================
function ipoUnlocked() { return netWorth() >= 10000000; }
function foundIpo(name, logo, issuePrice) {
  S.ipo.founded = true;
  S.ipo.name = name || "Tycoon Holding AG";
  S.ipo.logo = logo || "🏢";
  S.ipo.ticker = (S.ipo.name.replace(/[^A-Za-z]/g, "").slice(0, 4) || "TYC").toUpperCase();
  S.ipo.issuePrice = clamp(issuePrice || 50, 1, 500);
  S.ipo.price = S.ipo.issuePrice;
  runRoadshow();
}
function runRoadshow() {
  let round = 0, demand = 50;
  const questions = INTERVIEW_QUESTIONS;
  function showRound() {
    if (round >= 3) {
      demand = clamp(demand, 10, 100);
      S.ipo.playerPct = clamp(100 - demand * 0.5, 40, 95);
      S.ipo.marketCap = S.ipo.price * 1000 * (demand / 50);
      pushNotify("🎤 Roadshow beendet", `Nachfrage: ${demand}%. Dein Anteil: ${S.ipo.playerPct.toFixed(0)}%`);
      closeModal();
      renderAll();
      return;
    }
    const q = questions[round];
    const html = `<h2>🎤 Roadshow — Runde ${round + 1}/3</h2><p>${q.q}</p>` +
      q.options.map((o, i) => `<button class="btn btn-secondary" data-oi="${i}" style="display:block;width:100%;margin:6px 0;text-align:left">${o.text}</button>`).join("");
    openModal(html);
    q.options.forEach((o, i) => {
      $("modal-box").querySelector(`[data-oi="${i}"]`).onclick = () => {
        demand += o.hype;
        round++;
        showRound();
      };
    });
  }
  showRound();
}
function ipoTick() {
  if (!S.ipo.founded) return;
  const drift = (S.trust - 50) / 4000 + (S.followers / 5000000) + (Math.random() * 2 - 1) * 0.01;
  S.ipo.price = Math.max(0.5, S.ipo.price * (1 + drift));
  S.ipo.marketCap = S.ipo.price * 100000;
  if (S.ipo.marketCap >= 100000000 && !S.ipo.hqUnlocked) {
    S.ipo.hqUnlocked = true;
    pushNotify("🏙️ Hauptquartier freigeschaltet!", "Dein Wolkenkratzer mit eigenem Logo steht bereit!");
    spawnConfetti(120);
  }
  // Dividenden-Schraube: kostet Cash, erhöht Kauflust -> Marktanteil steigt langsam (Spieleranteil sinkt)
  const divCost = (S.ipo.marketCap * (S.ipo.dividendRate / 100)) / (24 * 3600);
  S.cash -= divCost;
  const marketPressure = 0.002 + (S.ipo.dividendRate / 100) * 0.01;
  S.ipo.playerPct = clamp(S.ipo.playerPct - marketPressure, 0, 100);
  if (S.ipo.playerPct < 50) {
    if (!S.ipo.hostileSince) S.ipo.hostileSince = now();
    else if (now() - S.ipo.hostileSince > 60000) {
      S.cash -= 200000;
      S.ipo.playerPct = 55;
      S.ipo.hostileSince = 0;
      pushNotify("😱 Feindliche Übernahme!", "Rivalisierende Trader haben kurzzeitig die Kontrolle übernommen! Du hast sie mit hohem Kostenaufwand zurückgekauft.");
    }
  } else S.ipo.hostileSince = 0;
}
function buybackShares() {
  const amount = 50000;
  if (S.cash < amount) { pushNotify("⚠️ Nicht genug Geld", fmtMoney(amount) + " nötig."); return; }
  S.cash -= amount;
  const pctGain = (amount / S.ipo.marketCap) * 100;
  S.ipo.playerPct = clamp(S.ipo.playerPct + pctGain, 0, 100);
  pushNotify("💰 Buyback erfolgreich", `+${pctGain.toFixed(2)}% Firmenanteile zurückgekauft.`);
  renderAll();
}

// ============================================================
// MINI-GAMES
// ============================================================
function openModal(html) { $("modal-box").innerHTML = html; $("modal-overlay").hidden = false; SND.modalOpen(); }
function closeModal() { $("modal-overlay").hidden = true; $("modal-box").innerHTML = ""; SND.modalClose(); }
$("modal-overlay") && ($("modal-overlay").onclick = (e) => { if (e.target.id === "modal-overlay") closeModal(); });

const MG_MIN_STAKE = 10;

function resolveBattleAuto(rival) {
  let winChance = clamp(0.5 + S.followers / 200000, 0.3, 0.95);
  if (automationActive("pr_agentur") || automationActive("social_botnet")) winChance = clamp(winChance + 0.15, 0.3, 0.97);
  applyBattleResult(rival, Math.random() < winChance);
}
// Follower-/Feed-Reaktion, gemeinsam genutzt von automatischen und manuellen Battles.
function battleFlavor(rival, win) {
  if (win) {
    S.followers = Math.round(S.followers * 1.1 * PRESTIGE.followerMult);
    addFeedItem("Du", `Hab ${rival.name} im Wortgefecht besiegt! 💪`, "player");
  } else {
    S.followers = Math.max(10, Math.round(S.followers * 0.95));
    addFeedItem(`${rival.emoji} ${rival.name}`, "Zu einfach besiegt. 😏", "rival");
  }
}
// Nur fuer automatisch aufgeloeste Battles (PR-Agentur/Social-Botnet/Herausforderungen) —
// kein Spieler-Einsatz im Spiel, daher fester kleiner Bonus statt Einsatz-Multiplikator.
function applyBattleResult(rival, win) {
  battleFlavor(rival, win);
  if (win) { S.cash += 5000; pushNotify("⚔️ Sieg!", `Du hast ${rival.name} besiegt! +10% Follower, +5.000 €`); SND.success(); }
  else pushNotify("😞 Niederlage", `${rival.name} hat gewonnen. -5% Follower`);
  renderAll();
}
function battleChallengeLoop() {
  setTimeout(() => {
    resolveBattleAuto(choice(RIVALS));
    battleChallengeLoop();
  }, rand(90000, 160000));
}

// ============================================================
// CASINO (Roulette, Blackjack, Spielautomat) — echtes Einsatz-Risiko,
// ohne Cooldown, zum wiederholten Zocken gedacht.
// ============================================================

// Zahlt/kassiert einen Einsatz nach Multiplikator aus (0 = Totalverlust,
// 1 = break-even, >1 = Gewinn).
function resolveBet(stake, multiplier, el) {
  const payout = stake * multiplier;
  const net = payout - stake;
  S.cash += net;
  if (net > S.stats.biggestWin) S.stats.biggestWin = net;
  if (net < S.stats.biggestLoss) S.stats.biggestLoss = net;
  floatMoney(el, net);
  net >= 0 ? SND.gain() : SND.loss();
  if (net > 0 && net > netWorth() * 0.03) spawnConfetti(50);
  renderHud();
  renderStats();
  return net;
}
function checkCasinoStake(id) {
  const stake = Math.floor(parseFloat($(id) ? $(id).value : 0) || 0);
  if (stake < MG_MIN_STAKE) { pushNotify("⚠️ Einsatz zu niedrig", `Mindesteinsatz: ${fmtMoney(MG_MIN_STAKE)}`, "denied"); return null; }
  if (stake > S.cash) { pushNotify("⚠️ Nicht genug Geld", "Dein Einsatz übersteigt deine Kasse.", "denied"); return null; }
  return stake;
}

// Gemeinsame Dreh-zu-Winkel-Mechanik fuer Rad-Spiele (Roulette + Gluecksrad):
// dreht `el` so, dass `targetAngle` (Grad, im Uhrzeigersinn ab oben) am
// Zeiger landet, plus ein paar volle Umdrehungen fuer den Spin-Effekt.
function spinWheelToAngle(el, wheelState, targetAngle, extraSpins) {
  const current = wheelState.rotation % 360;
  const delta = ((-targetAngle - current) % 360 + 360) % 360;
  wheelState.rotation += (extraSpins || 5 * 360) + delta;
  el.style.transform = `rotate(${wheelState.rotation}deg)`;
}

// ---- Roulette (europäisch, 0-36, Standard-Quoten -> ~2,7% Hausvorteil) ----
const ROULETTE_RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
// Echte physische Reihenfolge auf einem europäischen Roulette-Kessel (nicht 0-36 der Reihe nach).
const ROULETTE_WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
function rouletteColor(n) { return n === 0 ? "green" : ROULETTE_RED.has(n) ? "red" : "black"; }
function rouletteColorLabel(c) { return c === "red" ? "Rot" : c === "black" ? "Schwarz" : "Grün"; }
const rouletteWheelState = { rotation: 0 };

function buildRouletteWheelGradient() {
  const seg = 360 / ROULETTE_WHEEL_ORDER.length;
  const stops = ROULETTE_WHEEL_ORDER.map((n, i) => {
    const c = rouletteColor(n);
    const hex = c === "red" ? "#ff4d6d" : c === "black" ? "#1a1d24" : "#2ee6a6";
    return `${hex} ${(i * seg).toFixed(3)}deg ${((i + 1) * seg).toFixed(3)}deg`;
  });
  return `conic-gradient(${stops.join(", ")})`;
}
function updateRouletteBetUI() {
  const type = $("roulette-bet-type").value;
  const box = $("roulette-bet-value");
  if (type === "color") box.innerHTML = `<div class="casino-choice-row"><button class="btn casino-choice red active" data-val="red">Rot</button><button class="btn casino-choice black" data-val="black">Schwarz</button></div>`;
  else if (type === "parity") box.innerHTML = `<div class="casino-choice-row"><button class="btn casino-choice active" data-val="even">Gerade</button><button class="btn casino-choice" data-val="odd">Ungerade</button></div>`;
  else if (type === "dozen") box.innerHTML = `<div class="casino-choice-row"><button class="btn casino-choice active" data-val="1">1–12</button><button class="btn casino-choice" data-val="2">13–24</button><button class="btn casino-choice" data-val="3">25–36</button></div>`;
  else box.innerHTML = `<input type="number" id="roulette-number" min="0" max="36" value="17">`;
  box.querySelectorAll(".casino-choice").forEach((b) => (b.onclick = () => {
    box.querySelectorAll(".casino-choice").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
  }));
}
function spinRoulette() {
  const stake = checkCasinoStake("roulette-stake");
  if (stake === null) return;
  const type = $("roulette-bet-type").value;
  const activeChoice = $("roulette-bet-value").querySelector(".casino-choice.active");
  const betVal = type === "number" ? clamp(parseInt($("roulette-number").value) || 0, 0, 36) : activeChoice ? activeChoice.dataset.val : null;
  if (betVal === null) return;

  $("roulette-spin").disabled = true;
  const resultEl = $("roulette-result");
  resultEl.textContent = "…";
  resultEl.className = "roulette-result spinning";

  const n = randInt(0, 36);
  const idx = ROULETTE_WHEEL_ORDER.indexOf(n);
  const seg = 360 / ROULETTE_WHEEL_ORDER.length;
  const targetAngle = idx * seg + seg / 2;
  spinWheelToAngle($("roulette-wheel"), rouletteWheelState, targetAngle);
  SND.click();

  setTimeout(() => {
    const color = rouletteColor(n);
    resultEl.textContent = n;
    resultEl.className = "roulette-result " + color;
    let win = false, mult = 0;
    if (type === "color" && betVal === color) { win = true; mult = 2; }
    else if (type === "parity") {
      const isEven = n !== 0 && n % 2 === 0;
      if (n !== 0 && (betVal === "even") === isEven) { win = true; mult = 2; }
    } else if (type === "dozen") {
      const d = n === 0 ? 0 : Math.ceil(n / 12);
      if (String(d) === betVal) { win = true; mult = 3; }
    } else if (type === "number") {
      if (n === betVal) { win = true; mult = 36; }
    }
    const net = resolveBet(stake, mult, $("roulette-spin"));
    pushNotify(win ? "🎡 Gewonnen!" : "🎡 Verloren", `${n} (${rouletteColorLabel(color)}) — ${net >= 0 ? "+" : ""}${fmtMoney(net)}`);
    S.rouletteHistory.unshift({ n, color });
    S.rouletteHistory = S.rouletteHistory.slice(0, 14);
    renderRouletteHistory();
    $("roulette-spin").disabled = false;
  }, 3250);
}
function renderRouletteHistory() {
  const el = $("roulette-history");
  if (!el) return;
  el.innerHTML = S.rouletteHistory.map((h) => `<span class="roulette-chip ${h.color}">${h.n}</span>`).join("");
}

// ---- Blackjack (vereinfacht: Dealer zieht bis 17, keine Splits/Doubles;
// beide Handwerte sind jederzeit sichtbar, keine verdeckte Karte) ----
const CARD_SUITS = ["♠️", "♥️", "♦️", "♣️"];
const CARD_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
function drawCard() { return { rank: choice(CARD_RANKS), suit: choice(CARD_SUITS) }; }
function cardValue(rank) { if (rank === "A") return 11; if (rank === "J" || rank === "Q" || rank === "K") return 10; return parseInt(rank); }
function handValue(cards) {
  let total = cards.reduce((s, c) => s + cardValue(c.rank), 0);
  let aces = cards.filter((c) => c.rank === "A").length;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}
function cardStr(c) { return `${c.rank}${c.suit}`; }
function cardColorClass(c) { return c.suit === "♥️" || c.suit === "♦️" ? "bj-card-red" : "bj-card-black"; }

let bjState = null;
function dealBlackjack() {
  const stake = checkCasinoStake("bj-stake");
  if (stake === null) return;
  bjState = { stake, player: [drawCard(), drawCard()], dealer: [drawCard(), drawCard()], done: false };
  SND.cardFlip();
  setTimeout(SND.cardFlip, 90);
  setTimeout(SND.cardFlip, 180);
  setTimeout(SND.cardFlip, 270);
  renderBlackjack();
}
function bjHit() {
  if (!bjState || bjState.done) return;
  bjState.player.push(drawCard());
  SND.cardFlip();
  if (handValue(bjState.player) > 21) finishBlackjack();
  else renderBlackjack();
}
function bjStand() {
  if (!bjState || bjState.done) return;
  while (handValue(bjState.dealer) < 17) bjState.dealer.push(drawCard());
  finishBlackjack();
}
function finishBlackjack() {
  bjState.done = true;
  const pv = handValue(bjState.player), dv = handValue(bjState.dealer);
  const playerBJ = bjState.player.length === 2 && pv === 21;
  const dealerBJ = bjState.dealer.length === 2 && dv === 21;
  let mult, label;
  if (pv > 21) { mult = 0; label = "💥 Überkauft!"; }
  else if (playerBJ && !dealerBJ) { mult = 2.5; label = "🃏 Blackjack!"; }
  else if (dealerBJ && !playerBJ) { mult = 0; label = "😞 Dealer hat Blackjack"; }
  else if (dv > 21) { mult = 2; label = "🏆 Dealer überkauft!"; }
  else if (pv === dv) { mult = 1; label = "🤝 Unentschieden"; }
  else if (pv > dv) { mult = 2; label = "🏆 Gewonnen!"; }
  else { mult = 0; label = "😞 Verloren"; }
  const net = resolveBet(bjState.stake, mult, $("bj-table"));
  pushNotify(label, `${net >= 0 ? "+" : ""}${fmtMoney(net)}`);
  renderBlackjack();
}
function renderBlackjack() {
  const el = $("bj-table");
  if (!bjState) { el.innerHTML = '<p class="hint">Setze einen Einsatz und gib die Karten.</p>'; return; }
  const pv = handValue(bjState.player), dv = handValue(bjState.dealer);
  el.innerHTML = `
    <div class="bj-hand"><div class="bj-label">Dealer (${dv})</div>
      <div class="bj-cards">${bjState.dealer.map((c) => `<span class="bj-card ${cardColorClass(c)}">${cardStr(c)}</span>`).join("")}</div></div>
    <div class="bj-hand"><div class="bj-label">Du (${pv})</div>
      <div class="bj-cards">${bjState.player.map((c) => `<span class="bj-card ${cardColorClass(c)}">${cardStr(c)}</span>`).join("")}</div></div>
    ${!bjState.done
      ? `<div class="casino-choice-row"><button class="btn btn-secondary" id="bj-hit">Karte</button><button class="btn btn-primary" id="bj-stand">Halten</button></div>`
      : `<button class="btn btn-secondary" id="bj-newround" style="width:100%">Neue Runde</button>`}`;
  if (!bjState.done) { $("bj-hit").onclick = bjHit; $("bj-stand").onclick = bjStand; }
  else $("bj-newround").onclick = () => { bjState = null; renderBlackjack(); };
}

// ---- Spielautomat (gewichtete Symbole, austariert auf ~14% Hausvorteil;
// Walzen stoppen nacheinander fuer den klassischen "Klack-klack"-Effekt) ----
const SLOT_SYMBOLS = [
  { s: "🍒", w: 30, pay3: 3, pay2: 1 },
  { s: "🍋", w: 25, pay3: 4.5, pay2: 1 },
  { s: "🔔", w: 20, pay3: 8, pay2: 1.3 },
  { s: "⭐", w: 15, pay3: 14, pay2: 1.6 },
  { s: "💎", w: 7, pay3: 35, pay2: 2.2 },
  { s: "7️⃣", w: 3, pay3: 90, pay2: 3.5 },
];
function spinSlotSymbol() {
  const totalW = SLOT_SYMBOLS.reduce((a, b) => a + b.w, 0);
  let x = Math.random() * totalW;
  for (const sym of SLOT_SYMBOLS) { if (x < sym.w) return sym; x -= sym.w; }
  return SLOT_SYMBOLS[0];
}
function spinSlots() {
  const stake = checkCasinoStake("slots-stake");
  if (stake === null) return;
  $("slots-spin").disabled = true;
  const reelEls = document.querySelectorAll("#slots-reels .slot-reel");
  const result = [spinSlotSymbol(), spinSlotSymbol(), spinSlotSymbol()];
  const stopDelays = [900, 1450, 2100];
  reelEls.forEach((el, i) => {
    el.classList.remove("stopped", "win");
    const iv = setInterval(() => { el.textContent = spinSlotSymbol().s; }, 70);
    setTimeout(() => {
      clearInterval(iv);
      el.textContent = result[i].s;
      el.classList.add("stopped");
      SND.click();
    }, stopDelays[i]);
  });
  setTimeout(() => {
    let mult = 0, label = "Leider nichts...", winners = [];
    if (result[0].s === result[1].s && result[1].s === result[2].s) { mult = result[0].pay3; label = "🎉 JACKPOT-KOMBO!"; winners = [0, 1, 2]; }
    else if (result[0].s === result[1].s) { mult = result[0].pay2; label = "✨ Zwei Treffer!"; winners = [0, 1]; }
    else if (result[1].s === result[2].s) { mult = result[1].pay2; label = "✨ Zwei Treffer!"; winners = [1, 2]; }
    else if (result[0].s === result[2].s) { mult = result[0].pay2; label = "✨ Zwei Treffer!"; winners = [0, 2]; }
    winners.forEach((i) => reelEls[i].classList.add("win"));
    if (winners.length === 3) { SND.jackpot(); spawnConfetti(80); }
    const net = resolveBet(stake, mult, $("slots-spin"));
    const resEl = $("slots-result");
    resEl.textContent = `${label} ${net >= 0 ? "+" : ""}${fmtMoney(net)}`;
    resEl.className = "slots-result " + (net >= 0 ? "pos" : "neg");
    $("slots-spin").disabled = false;
  }, stopDelays[2] + 250);
}

// ---- Würfel (2 Würfel, Tief/Sieben/Hoch, angelehnt an Craps-Side-Bets) ----
const DICE_FACES = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
function rollDice() {
  const stake = checkCasinoStake("dice-stake");
  if (stake === null) return;
  const betType = $("dice-bet-value").querySelector(".casino-choice.active").dataset.val;
  $("dice-roll").disabled = true;
  const d1El = $("dice-die1"), d2El = $("dice-die2");
  d1El.classList.add("rolling"); d2El.classList.add("rolling");
  let ticks = 0;
  const iv = setInterval(() => {
    d1El.textContent = DICE_FACES[randInt(0, 5)];
    d2El.textContent = DICE_FACES[randInt(0, 5)];
    if (ticks % 3 === 0) SND.dice();
    ticks++;
    if (ticks > 12) {
      clearInterval(iv);
      d1El.classList.remove("rolling"); d2El.classList.remove("rolling");
      const d1 = randInt(1, 6), d2 = randInt(1, 6);
      d1El.textContent = DICE_FACES[d1 - 1];
      d2El.textContent = DICE_FACES[d2 - 1];
      const sum = d1 + d2;
      let mult = 0, win = false;
      if (betType === "low" && sum <= 6) { mult = 2.15; win = true; }
      else if (betType === "high" && sum >= 8) { mult = 2.15; win = true; }
      else if (betType === "seven" && sum === 7) { mult = 5; win = true; }
      const net = resolveBet(stake, mult, $("dice-roll"));
      const resEl = $("dice-result");
      resEl.textContent = `Summe: ${sum} — ${net >= 0 ? "+" : ""}${fmtMoney(net)}`;
      resEl.className = "slots-result " + (net >= 0 ? "pos" : "neg");
      win ? SND.success() : SND.dice();
      $("dice-roll").disabled = false;
    }
  }, 80);
}

function initCasino() {
  const wheelEl = $("roulette-wheel");
  if (wheelEl) wheelEl.style.background = buildRouletteWheelGradient();
  $("roulette-bet-type").addEventListener("change", updateRouletteBetUI);
  updateRouletteBetUI();
  $("roulette-spin").addEventListener("click", spinRoulette);
  renderRouletteHistory();
  renderBlackjack();
  $("bj-deal").addEventListener("click", dealBlackjack);
  $("slots-spin").addEventListener("click", spinSlots);
  $("dice-bet-value").querySelectorAll(".casino-choice").forEach((b) => (b.onclick = () => {
    $("dice-bet-value").querySelectorAll(".casino-choice").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
  }));
  $("dice-roll").addEventListener("click", rollDice);
}

// ============================================================
// QTE EVENTS (Insider-Anruf / Meme-Trend)
// ============================================================
function qteLoop() {
  setTimeout(() => {
    Math.random() < 0.5 ? qteInsiderCall() : qteMemeTrend();
    qteLoop();
  }, rand(45000, 60000));
}
function qteInsiderCall() {
  const el = document.createElement("div");
  el.className = "qte-popup";
  el.textContent = "📞 Insider-Anruf! Schnell abheben (5s)...";
  document.body.appendChild(el);
  let done = false;
  el.onclick = () => {
    if (done) return; done = true;
    const st = choice(STOCKS);
    applyLocalPriceEffect(st, 0.2);
    S.stocks[st.id].markerUntil = now() + 20000; S.stocks[st.id].markerType = "boost";
    pushNotify("📞 Heißer Tipp!", `${st.name} +20%!`);
    SND.success(); spawnConfetti(30);
    el.remove(); renderAll();
  };
  setTimeout(() => { if (!done) el.remove(); }, 5000);
}
function qteMemeTrend() {
  const el = document.createElement("div");
  el.className = "qte-popup";
  el.textContent = "🎈 Meme-Trend! Jetzt anklicken für Gratis-Follower!";
  document.body.appendChild(el);
  let done = false;
  el.onclick = () => {
    if (done) return; done = true;
    const gain = Math.round(50 + S.followers * 0.05);
    S.followers += gain;
    pushNotify("🎈 Meme getroffen!", `+${gain} Follower!`);
    SND.success();
    el.remove(); renderAll();
  };
  setTimeout(() => { if (!done) el.remove(); }, 6000);
}

// VIP-Events durch Luxusgüter
function vipEventLoop() {
  setTimeout(() => {
    if (hasLux("sportwagen") || hasLux("privatjet")) {
      const st = choice(STOCKS);
      const effect = rand(0.1, 0.25);
      pushNotify("🥂 VIP-Event", `Insider verrät dir: ${st.name} wird bald steigen!`);
      setTimeout(() => { applyLocalPriceEffect(st, effect); S.stocks[st.id].markerUntil = now() + 30000; S.stocks[st.id].markerType = "boost"; renderAll(); }, 8000);
    }
    if (hasLux("yacht") && Math.random() < 0.4) {
      const amt = rand(10000, 40000);
      S.cash += amt;
      pushNotify("🛥️ Yacht-Networking", `Ein KI-Milliardär investiert ${fmtMoney(amt)} in dich!`);
      renderAll();
    }
    vipEventLoop();
  }, rand(120000, 220000));
}

// ============================================================
// AUTOPILOT ACTIONS
// ============================================================
function autopilotTick() {
  if (!S.autopilot) return;
  // Auto-Trader: kauft Tiefstpreise
  if (hasUp("auto_trader") && S.cash > 200 && Math.random() < 0.3) {
    let best = null, bestDelta = 0;
    STOCKS.forEach((cfg) => {
      const st = S.stocks[cfg.id];
      const avg = st.history.reduce((a, b) => a + b, 0) / st.history.length;
      const delta = (avg - st.price) / avg;
      if (delta > bestDelta) { bestDelta = delta; best = cfg; }
    });
    if (best && bestDelta > 0.03) {
      const qty = Math.max(1, Math.floor((S.cash * 0.1) / S.stocks[best.id].price));
      if (qty >= 1) buyStock(best.id, qty, null);
    }
  }
  // Stop-Loss/Take-Profit
  if (hasUp("stop_loss_bot")) {
    STOCKS.forEach((cfg) => {
      const p = S.portfolio[cfg.id];
      if (p && p.shares > 0) {
        const change = (S.stocks[cfg.id].price - p.avgPrice) / p.avgPrice;
        if (change <= -0.15 || change >= 0.25) sellStock(cfg.id, p.shares, null);
      }
    });
  }
  // Quant V2: Momentum-Trades
  if (hasUp("quant_bot_v2") && S.cash > 500 && Math.random() < 0.2) {
    const cfg = choice(STOCKS);
    const st = S.stocks[cfg.id];
    const hist = st.history;
    const momentum = hist[hist.length - 1] - hist[Math.max(0, hist.length - 6)];
    if (momentum > 0) {
      const qty = Math.max(1, Math.floor((S.cash * 0.05) / st.price));
      if (qty >= 1) buyStock(cfg.id, qty, null);
    }
  }
  // AI-Portfolio-Manager: reinvestiert in Dividendentitel
  if (hasUp("ai_portfolio_mgr") && S.cash > 5000 && Math.random() < 0.1) {
    const cfg = choice(STOCKS.filter((s) => s.cat === "konsum"));
    const qty = Math.max(1, Math.floor((S.cash * 0.15) / S.stocks[cfg.id].price));
    if (qty >= 1) buyStock(cfg.id, qty, null);
  }
  // Ghostwriter KI: postet automatisch
  if (hasUp("ghostwriter") && Math.random() < 0.02) {
    const cfg = choice(STOCKS);
    const hist = S.stocks[cfg.id].history;
    const trendUp = hist[hist.length - 1] >= hist[Math.max(0, hist.length - 6)];
    postMessage(`Ghostwriter-KI: ${cfg.name} sieht stark aus!`, cfg.id, trendUp ? "up" : "down");
  }
}

// ============================================================
// PRESTIGE
// ============================================================
function canPrestige() { return netWorth() >= 50000000; }
function doPrestige() {
  if (!canPrestige()) { pushNotify("🔒 Noch nicht bereit", "Erreiche 50 Mio. € Vermögen für den Ruhestand.", "denied"); return; }
  PRESTIGE.count++;
  PRESTIGE.followerMult = 1 + PRESTIGE.count * 0.2;
  PRESTIGE.costReduction = Math.min(0.5, PRESTIGE.count * 0.1);
  savePrestige();
  S = freshState();
  saveGame();
  pushNotify("♻️ Ruhestand!", `Neustart mit +${Math.round((PRESTIGE.followerMult - 1) * 100)}% Followern & -${Math.round(PRESTIGE.costReduction * 100)}% Kosten dauerhaft!`, "prestige");
  spawnConfetti(150);
  renderAll();
}

// ============================================================
// RENDERING
// ============================================================
function renderHud() {
  $("hud-cash").textContent = fmtMoney(S.cash);
  $("hud-cash").className = "hud-value " + (S.cash >= STARTING_CASH ? "" : "");
  const nw = netWorth();
  $("hud-networth").textContent = fmtMoney(nw);
  $("hud-followers").textContent = fmtNum(S.followers);
  $("hud-rank").textContent = rankFor(nw).name;
  if (nw > S.stats.athNetWorth) S.stats.athNetWorth = nw;
}
function renderSecBar() {
  const stage = secStage();
  $("sec-fill").style.width = S.secHeat.toFixed(1) + "%";
  $("sec-pct").textContent = Math.round(S.secHeat) + "%";
  const names = ["", "Sicher", "Beobachtet", "Betriebsprüfung", "RAZZIA!"];
  const el = $("sec-stage");
  el.textContent = names[stage];
  el.className = "sec-stage stage-" + stage;
}

function sparkline(canvas, history, color) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width = canvas.clientWidth * 2;
  const h = canvas.height = canvas.clientHeight * 2;
  ctx.clearRect(0, 0, w, h);
  const mn = Math.min(...history), mx = Math.max(...history, mn + 0.01);
  ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.beginPath();
  history.forEach((p, i) => {
    const x = (i / (history.length - 1)) * w;
    const y = h - ((p - mn) / (mx - mn)) * (h - 10) - 5;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
}

let lastRenderedPrices = {};
function renderStockGrid() {
  const grid = $("stock-grid");
  const needsInit = grid.children.length !== STOCKS.length;
  if (needsInit) {
    grid.innerHTML = STOCKS.map((cfg) => `
      <div class="stock-card" id="card-${cfg.id}">
        <div class="stock-head">
          <div><div class="stock-name">${cfg.name} <span class="stock-cat">${cfg.ticker}</span></div>
          <div class="stock-cat">${CATEGORIES[cfg.cat].label}</div></div>
          <div class="stock-marker" id="marker-${cfg.id}" style="display:none"></div>
        </div>
        <div class="stock-price" id="price-${cfg.id}"></div>
        <div class="stock-change" id="change-${cfg.id}"></div>
        <canvas class="stock-chart" id="chart-${cfg.id}"></canvas>
        <input type="number" class="qty-input" id="qty-${cfg.id}" value="10" min="1">
        <div class="stock-actions">
          <button class="btn btn-buy" data-act="buy" data-id="${cfg.id}">Kaufen</button>
          <button class="btn btn-sell" data-act="sell" data-id="${cfg.id}">Verkaufen</button>
        </div>
        <div class="stock-actions-2">
          <button class="btn btn-short" data-act="short" data-id="${cfg.id}">Short öffnen</button>
          <button class="btn btn-secondary" data-act="closeshort" data-id="${cfg.id}">Short schließen</button>
        </div>
        <div class="stock-owned" id="owned-${cfg.id}"></div>
      </div>`).join("");
    grid.querySelectorAll("button[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id, act = btn.dataset.act;
        const qty = parseInt($("qty-" + id).value) || 1;
        if (act === "buy") buyStock(id, qty, btn);
        if (act === "sell") sellStock(id, qty, btn);
        if (act === "short") shortStock(id, qty, btn);
        if (act === "closeshort") closeShort(id, qty, btn);
      });
    });
  }
  STOCKS.forEach((cfg) => {
    const st = S.stocks[cfg.id];
    const card = $("card-" + cfg.id);
    const prevPrice = lastRenderedPrices[cfg.id] || st.price;
    const up = st.price >= prevPrice;
    card.classList.toggle("boosted", now() < st.markerUntil && st.markerType === "boost");
    card.classList.toggle("crashed", now() < st.markerUntil && st.markerType === "crash");
    card.classList.toggle("flashcrash", now() < st.crashUntil);
    const priceEl = $("price-" + cfg.id);
    priceEl.textContent = fmtMoney(st.price);
    priceEl.className = "stock-price " + (up ? "up" : "down");
    const change = (st.price - st.history[Math.max(0, st.history.length - 10)]) / st.history[Math.max(0, st.history.length - 10)];
    const chEl = $("change-" + cfg.id);
    chEl.textContent = (up ? "▲ " : "▼ ") + pct(change);
    chEl.className = "stock-change " + (change >= 0 ? "pos" : "neg");
    const marker = $("marker-" + cfg.id);
    if (now() < st.markerUntil) { marker.style.display = "inline-block"; marker.textContent = st.markerType === "boost" ? "🚀 BOOST" : "💥 CRASH"; marker.className = "stock-marker " + st.markerType; }
    else marker.style.display = "none";
    sparkline($("chart-" + cfg.id), st.history, up ? "#2ee6a6" : "#ff4d6d");
    const p = S.portfolio[cfg.id];
    $("owned-" + cfg.id).textContent = p && (p.shares || p.short)
      ? `${p.shares || 0} Aktien${p.short ? ` | Short: ${p.short}` : ""}`
      : "Keine Position";
    lastRenderedPrices[cfg.id] = st.price;
  });
}

function renderPortfolio() {
  const list = $("portfolio-list");
  let html = "";
  let total = 0;
  STOCKS.forEach((cfg) => {
    const p = S.portfolio[cfg.id];
    if (p && (p.shares > 0 || p.short > 0)) {
      const val = p.shares * S.stocks[cfg.id].price;
      total += val;
      const gain = p.shares ? (S.stocks[cfg.id].price - p.avgPrice) * p.shares : 0;
      html += `<div class="portfolio-row"><span>${cfg.name} (${p.shares || 0})</span><span class="${gain >= 0 ? "stock-change pos" : "stock-change neg"}">${fmtMoney(val)} (${gain >= 0 ? "+" : ""}${fmtMoney(gain)})</span></div>`;
    }
  });
  list.innerHTML = html || '<p class="hint">Noch keine Positionen.</p>';
}

function renderFeed() {
  const feed = $("social-feed");
  feed.innerHTML = S.feed.slice(0, 40).map((f) => `<div class="feed-item ${f.cls}"><span class="fi-user">${f.user}</span>: ${f.text}</div>`).join("");
}
function renderTrending() {
  $("trending-topics").innerHTML = S.trending.map((t) => `<span>${t}</span>`).join("");
}
function renderSocial() {
  $("social-followers").textContent = fmtNum(S.followers);
  $("social-trust").textContent = Math.round(S.trust);
  $("verified-badge").hidden = !S.verified;
  $("sponsor-status").textContent = S.sponsorActive ? "💼 Aktiver Sponsoring-Deal" : "";
  const sel = $("post-stock");
  if (sel.children.length !== STOCKS.length) sel.innerHTML = STOCKS.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
  if (now() < S.shitstormUntil) { if (!$("shitstorm-banner")) { const b = document.createElement("div"); b.id = "shitstorm-banner"; b.className = "hint"; b.innerHTML = '🌩️ Shitstorm aktiv! <button class="btn btn-secondary" id="btn-apology" style="margin-left:8px">Entschuldigungs-Kampagne (15.000€)</button>'; $("panel-social").insertBefore(b, $("panel-social").firstChild); $("btn-apology").onclick = apologyCampaign; } }
  else { const b = $("shitstorm-banner"); if (b) b.remove(); }
}

function renderMining() {
  $("coin-balance").textContent = S.coins.toFixed(3) + " Coins (" + fmtMoney(S.coinPrice) + "/Stk.)";
  const usage = totalPower(), cap = powerCapacity();
  $("power-fill").style.width = clamp((usage / cap) * 100, 0, 100) + "%";
  $("power-text").textContent = usage.toFixed(1) + " / " + cap.toFixed(1) + " kW";
  $("fusebox").hidden = !S.fuseTripped;

  const shop = $("rig-shop");
  shop.innerHTML = "<h3>🛒 Rig-Shop</h3>" + RIG_TYPES.map((t) => `
    <div class="rig-shop-item">
      <div style="font-size:1.6rem">${t.icon}</div>
      <div>${t.name}</div>
      <div class="hint" style="font-size:0.7rem">${t.coinsPerSec}/s · ${t.powerKw}kW</div>
      <div style="color:var(--gold);margin:4px 0">${fmtMoney(rigCost(t))}</div>
      <button class="btn btn-primary" data-buy="${t.id}">Kaufen</button>
    </div>`).join("");
  shop.querySelectorAll("[data-buy]").forEach((b) => (b.onclick = () => buyRig(b.dataset.buy)));

  const grid = $("rig-grid");
  grid.innerHTML = S.rigs.map((r) => {
    const type = RIG_TYPES.find((t) => t.id === r.typeId);
    return `<div class="rig-card ${r.overheated ? "overheated" : ""} ${!r.wired ? "unwired" : ""}">
      <div style="font-size:1.5rem">${type.icon}</div>
      <div style="font-size:0.75rem">${type.name}</div>
      ${!r.wired ? `<button class="btn btn-secondary" data-wire="${r.id}" style="margin-top:4px">🔌 Verkabeln</button>` : `
        <div class="rig-temp-bar"><div class="rig-temp-fill" style="width:${r.temp}%;background:${r.temp > 80 ? "var(--red)" : r.temp > 50 ? "var(--gold)" : "var(--green)"}"></div></div>
        <div style="font-size:0.65rem">${Math.round(r.temp)}°C</div>
        ${r.overheated ? `<button class="btn btn-danger" data-repair="${r.id}" style="margin-top:4px">🔧 Reparieren (${r._repairClicks || 0}/6)</button>` : `<button class="btn btn-secondary" data-cool="${r.id}" style="margin-top:4px">❄️ Kühlen</button>`}
      `}
    </div>`;
  }).join("") || '<p class="hint">Noch keine Rigs. Kaufe eines im Shop!</p>';
  grid.querySelectorAll("[data-wire]").forEach((b) => (b.onclick = () => wireRig(b.dataset.wire)));
  grid.querySelectorAll("[data-cool]").forEach((b) => (b.onclick = () => coolRig(b.dataset.cool)));
  grid.querySelectorAll("[data-repair]").forEach((b) => (b.onclick = () => repairRig(b.dataset.repair)));
}

let currentUpgradeTab = "trading";
function renderUpgrades() {
  const list = $("upgrade-list");
  if (currentUpgradeTab === "skills") {
    list.innerHTML = `<p>🌟 Talentpunkte: <strong>${S.skillPoints}</strong> (1 Punkt pro erreichtem Level)</p>` +
      SKILL_TREE.map((sk) => `<div class="upgrade-card ${hasSkill(sk.id) ? "owned" : ""}"><h4>${sk.name}</h4><p>${sk.desc}</p><div class="cost">Kosten: ${sk.cost} Talentpunkt(e)</div><button class="btn btn-primary" data-skill="${sk.id}" ${hasSkill(sk.id) ? "disabled" : ""}>${hasSkill(sk.id) ? "Freigeschaltet" : "Freischalten"}</button></div>`).join("");
    list.querySelectorAll("[data-skill]").forEach((b) => (b.onclick = () => buySkill(b.dataset.skill)));
    return;
  }
  if (currentUpgradeTab === "automation") {
    const all = [].concat(...Object.values(UPGRADES)).filter((u) => u.automation);
    list.innerHTML = all.map((u) => renderUpgradeCard(u, findCatKey(u.id))).join("");
    list.querySelectorAll("[data-buy-up]").forEach((b) => (b.onclick = () => buyUpgrade(b.dataset.cat, b.dataset.buyUp)));
    return;
  }
  const items = UPGRADES[currentUpgradeTab] || [];
  list.innerHTML = items.map((u) => renderUpgradeCard(u, currentUpgradeTab)).join("");
  list.querySelectorAll("[data-buy-up]").forEach((b) => (b.onclick = () => buyUpgrade(b.dataset.cat, b.dataset.buyUp)));
}
function findCatKey(id) { for (const k in UPGRADES) if (UPGRADES[k].find((u) => u.id === id)) return k; return "trading"; }
function renderUpgradeCard(u, catKey) {
  const lvl = S.upgrades[u.id] || 0;
  const maxed = lvl >= u.max;
  const cost = upgradeCost(u);
  const locked = (u.requiresLevel && level() < u.requiresLevel) || (u.requiresFollowers && S.followers < u.requiresFollowers);
  return `<div class="upgrade-card ${maxed ? "owned" : ""}">
    <h4>${u.name} ${u.max > 1 ? `(Stufe ${lvl}/${u.max})` : ""}</h4>
    <p>${u.desc}${u.requiresLevel ? ` — ab Level ${u.requiresLevel}` : ""}${u.requiresFollowers ? ` — ab ${fmtNum(u.requiresFollowers)} Follower` : ""}</p>
    ${!maxed ? `<div class="cost">${u.baseCost === 0 ? "Automatisch bei Erreichen" : fmtMoney(cost)}</div>` : ""}
    <button class="btn btn-primary" data-buy-up="${u.id}" data-cat="${catKey}" ${maxed || locked || u.baseCost === 0 ? "disabled" : ""}>${maxed ? "✅ Maximal" : locked ? "🔒 Gesperrt" : "Kaufen"}</button>
  </div>`;
}

function renderImmobilien() {
  $("estate-grid").innerHTML = ESTATES.map((e, i) => {
    const owned = i <= S.estateIndex;
    const next = i === S.estateIndex + 1;
    return `<div class="estate-card ${owned ? "owned" : ""}">
      <div class="estate-icon">${e.icon}</div><div>${e.name}</div>
      <p style="font-size:0.7rem;color:var(--text-dim)">${e.desc}</p>
      ${owned ? '<span style="color:var(--gold)">✅ Aktuell</span>' : `<div style="color:var(--gold)">${fmtMoney(e.cost)}</div><button class="btn btn-primary" data-estate="${e.id}" ${next ? "" : "disabled"}>${next ? "Kaufen" : "Gesperrt"}</button>`}
    </div>`;
  }).join("");
  $("estate-grid").querySelectorAll("[data-estate]").forEach((b) => (b.onclick = () => buyEstate(b.dataset.estate)));

  $("luxury-grid").innerHTML = LUXURY_ITEMS.map((l) => `<div class="luxury-card ${hasLux(l.id) ? "owned" : ""}">
    <div class="luxury-icon">${l.icon}</div><div>${l.name}</div>
    <p style="font-size:0.7rem;color:var(--text-dim)">${l.desc}</p>
    ${hasLux(l.id) ? '<span style="color:var(--gold)">✅ Im Besitz</span>' : `<div style="color:var(--gold)">${fmtMoney(l.cost)}</div><button class="btn btn-primary" data-lux="${l.id}">Kaufen</button>`}
  </div>`).join("");
  $("luxury-grid").querySelectorAll("[data-lux]").forEach((b) => (b.onclick = () => buyLuxury(b.dataset.lux)));

  $("employee-grid").innerHTML = EMPLOYEES.map((e) => `<div class="employee-card ${hasEmp(e.id) ? "owned" : ""}">
    <div style="font-size:1.6rem">🧑‍💼</div><div>${e.name}</div>
    <p style="font-size:0.7rem;color:var(--text-dim)">${e.desc}</p>
    ${hasEmp(e.id) ? `<span style="color:var(--gold)">✅ Angestellt (${e.salaryPerSec}€/s)</span>` : `<div style="color:var(--gold)">${fmtMoney(e.cost)} + ${e.salaryPerSec}€/s</div><button class="btn btn-primary" data-emp="${e.id}">Einstellen</button>`}
  </div>`).join("");
  $("employee-grid").querySelectorAll("[data-emp]").forEach((b) => (b.onclick = () => hireEmployee(b.dataset.emp)));

  const c = runningCosts();
  $("running-costs").innerHTML = `
    <div><span>🏠 Miete</span><span>${fmtMoney(c.rent)}/s</span></div>
    <div><span>⚡ Strom</span><span>${fmtMoney(c.power)}/s</span></div>
    <div><span>👥 Gehälter</span><span>${fmtMoney(c.salaries)}/s</span></div>
    <div><strong>Gesamt</strong><strong>${fmtMoney(c.total)}/s</strong></div>`;
}

function renderInboxBadge() {
  const unread = S.inbox.filter((m) => !m.read).length;
  $("inbox-badge").hidden = unread === 0;
  $("inbox-badge").textContent = unread;
}
function renderInbox() {
  const list = $("inbox-list");
  list.innerHTML = S.inbox.map((m) => `<div class="inbox-row ${!m.read ? "unread" : ""}" data-msg="${m.id}"><div class="from">${m.from}</div><div>${m.subject}</div></div>`).join("") || '<p class="hint">Keine Nachrichten.</p>';
  list.querySelectorAll("[data-msg]").forEach((row) => (row.onclick = () => openInboxDetail(row.dataset.msg)));
  renderInboxBadge();

  const infList = $("informant-list");
  infList.innerHTML = INFORMANT_OFFERS.map((o, i) => `<div class="informant-card"><p>${o.text}</p><div style="color:var(--gold)">Kosten: ${fmtMoney(o.cost)} | SEC-Risiko: +${o.secRisk}</div><button class="btn btn-primary" data-inf="${i}">Info kaufen</button></div>`).join("");
  infList.querySelectorAll("[data-inf]").forEach((b) => (b.onclick = () => useInformant(parseInt(b.dataset.inf))));
}
function openInboxDetail(id) {
  const m = S.inbox.find((x) => x.id === id);
  if (!m) return;
  m.read = true;
  renderInboxBadge();
  const detail = $("inbox-detail");
  detail.innerHTML = `<h3>${m.from}</h3><p><strong>${m.subject}</strong></p><p>${m.text}</p>` +
    (m.answered
      ? '<p class="hint">✅ Beantwortet.</p>'
      : `<div class="options">${m.options.map((o, i) => `<button class="btn btn-secondary" data-opt="${i}">${o.label}</button>`).join("")}</div>`);
  if (!m.answered) detail.querySelectorAll("[data-opt]").forEach((b) => (b.onclick = () => { answerInbox(m.id, parseInt(b.dataset.opt)); openInboxDetail(id); renderInbox(); }));
  document.querySelectorAll(".inbox-row").forEach((r) => r.style.background = r.dataset.msg === id ? "var(--card-hover)" : "");
}
function switchInboxTab(tab) {
  document.querySelectorAll(".inboxtab-btn").forEach((b) => b.classList.toggle("active", b.dataset.inboxtab === tab));
  $("inbox-chats").hidden = tab !== "chats";
  $("inbox-informanten").hidden = tab !== "informanten";
}

function renderIpo() {
  const unlocked = ipoUnlocked();
  $("ipo-locked").hidden = unlocked || S.ipo.founded;
  $("ipo-setup").hidden = !unlocked || S.ipo.founded;
  $("ipo-dashboard").hidden = !S.ipo.founded;
  if (!unlocked && !S.ipo.founded) $("ipo-progress").style.width = clamp((netWorth() / 10000000) * 100, 0, 100) + "%";
  if (S.ipo.founded) {
    $("ipo-logo").textContent = S.ipo.logo;
    $("ipo-companyname").textContent = S.ipo.name;
    $("ipo-ticker").textContent = "$" + S.ipo.ticker;
    $("ipo-share-price").textContent = fmtMoney(S.ipo.price);
    $("ipo-marketcap").textContent = fmtMoney(S.ipo.marketCap);
    $("ipo-ownership").textContent = S.ipo.playerPct.toFixed(1);
    $("ownership-fill").style.width = S.ipo.playerPct + "%";
    $("hq-box").textContent = S.ipo.hqUnlocked ? "🏙️ Hauptquartier freigeschaltet — dein Wolkenkratzer mit eigenem Logo thront über der Stadt!" : "🏗️ Hauptquartier wird bei 100 Mio. € Marktkapitalisierung freigeschaltet.";
  }
}

function renderStats() {
  const nw = netWorth();
  const playtime = Math.round((now() - S.stats.startedAt) / 60000);
  const tiles = [
    ["💰 Vermögen", fmtMoney(nw)],
    ["🏆 Rekord-Vermögen", fmtMoney(S.stats.athNetWorth)],
    ["📈 Größter Gewinn", fmtMoney(S.stats.biggestWin)],
    ["📉 Größter Verlust", fmtMoney(S.stats.biggestLoss)],
    ["🔁 Trades gesamt", S.stats.totalTrades],
    ["👥 Follower", fmtNum(S.followers)],
    ["🎖️ Rang", rankFor(nw).name],
    ["🕵️ SEC-Risiko", Math.round(S.secHeat) + "%"],
    ["♻️ Ruhestände", PRESTIGE.count],
    ["⏱️ Spielzeit", playtime + " min"],
  ];
  $("stats-grid").innerHTML = tiles.map(([l, v]) => `<div class="stat-tile"><div class="val">${v}</div><div class="lbl">${l}</div></div>`).join("");
  $("prestige-desc").textContent = canPrestige()
    ? "Du kannst jetzt in den Ruhestand gehen und permanente Boni für den nächsten Durchlauf erhalten!"
    : `Erreiche 50 Mio. € Vermögen (aktuell ${fmtMoney(nw)}), um in den Ruhestand zu gehen.`;
  $("btn-prestige").disabled = !canPrestige();
}

function renderAutomation() {
  const all = [].concat(...Object.values(UPGRADES), EMPLOYEES).filter((u) => u.automation);
  const owned = all.filter((u) => S.upgrades[u.id] || S.employees[u.id]).length;
  const p = all.length ? Math.round((owned / all.length) * 100) : 0;
  $("automation-fill").style.width = p + "%";
  $("automation-pct").textContent = p + "%";
}

function renderThemes() {
  $("theme-grid").innerHTML = THEMES.map((t) => {
    const unlocked = netWorth() >= t.requiresNetWorth;
    return `<div class="theme-card ${S.theme === t.id ? "active" : ""} ${unlocked ? "" : "locked"}" data-theme-pick="${t.id}">
      <div>${t.name}</div><div class="hint" style="font-size:0.68rem">${unlocked ? "Freigeschaltet" : "Ab " + fmtMoney(t.requiresNetWorth)}</div>
    </div>`;
  }).join("");
  $("theme-grid").querySelectorAll("[data-theme-pick]").forEach((el) => (el.onclick = () => {
    const id = el.dataset.themePick;
    const t = THEMES.find((x) => x.id === id);
    if (netWorth() < t.requiresNetWorth) { SND.denied(); return; }
    S.theme = id;
    applyTheme();
    renderThemes();
    SND.toggle();
  }));
}
function applyTheme() {
  if (S.theme === "default") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", S.theme);
}

function renderAll() {
  renderHud(); renderSecBar(); renderStockGrid(); renderPortfolio();
  renderSocial(); renderMining(); renderUpgrades(); renderImmobilien();
  renderInbox(); renderIpo(); renderStats(); renderAutomation();
  renderAccountUi();
}

function renderAccountUi() {
  const btn = $("btn-account"), box = $("account-box");
  if (!btn || !box) return;
  if (!FIREBASE_CONFIGURED) {
    btn.textContent = "👤 Cloud inaktiv";
    btn.className = "btn-account offline-only";
    box.innerHTML = `<p class="account-pitch">Mit Account speicherst du deinen Fortschritt geräteübergreifend. Diese Funktion ist auf dieser Seite noch nicht eingerichtet (kein Cloud-Projekt hinterlegt) — dein Spielstand bleibt trotzdem ganz normal in diesem Browser gespeichert.</p>`;
    return;
  }
  if (!cloudUser) {
    btn.textContent = "👤 Anmelden";
    btn.className = "btn-account";
    box.innerHTML = `<p class="account-pitch">Melde dich mit E-Mail an, um deinen Fortschritt geräteübergreifend zu speichern — dein bisheriger Browser-Spielstand geht dabei nicht verloren.</p>
      <div class="account-actions"><button class="btn btn-primary" id="account-login-btn">Anmelden / Registrieren</button></div>`;
    $("account-login-btn").onclick = () => openAuthModal("login");
    return;
  }
  const shortEmail = cloudUser.email.length > 16 ? cloudUser.email.slice(0, 14) + "…" : cloudUser.email;
  btn.textContent = "👤 " + shortEmail;
  btn.className = "btn-account " + (cloudSyncing ? "syncing" : "synced");
  const initial = cloudUser.email[0].toUpperCase();
  const lastSync = cloudLastSyncedAt ? new Date(cloudLastSyncedAt).toLocaleTimeString("de-DE") : "noch nicht";
  box.innerHTML = `
    <div class="account-row">
      <div class="account-avatar">${initial}</div>
      <div class="account-info">
        <div class="account-email">${cloudUser.email}</div>
        <div class="account-meta ${cloudUser.emailVerified ? "verified" : "unverified"}">${cloudUser.emailVerified ? "✅ E-Mail bestätigt" : "⚠️ E-Mail noch nicht bestätigt"}</div>
        <div class="account-meta">${cloudSyncing ? "☁️ Synchronisiere…" : "☁️ Zuletzt synchronisiert: " + lastSync}</div>
      </div>
    </div>
    <div class="account-actions">
      ${!cloudUser.emailVerified ? '<button class="btn btn-secondary" id="account-resend-btn">Bestätigungsmail erneut senden</button>' : ""}
      <button class="btn btn-secondary" id="account-sync-btn">Jetzt synchronisieren</button>
      <button class="btn btn-danger" id="account-logout-btn">Abmelden</button>
    </div>`;
  if (!cloudUser.emailVerified) $("account-resend-btn").onclick = authResendVerification;
  $("account-sync-btn").onclick = () => cloudSaveNow(false);
  $("account-logout-btn").onclick = () => authLogout();
}

function openAuthModal(initialTab) {
  if (!FIREBASE_CONFIGURED) {
    openModal(`<h2>☁️ Cloud-Speicher</h2><p>Diese Funktion ist auf dieser Seite noch nicht eingerichtet. Dein Fortschritt wird trotzdem ganz normal lokal in diesem Browser gespeichert.</p><div class="modal-actions"><button class="btn btn-primary" id="auth-ok">Verstanden</button></div>`);
    $("auth-ok").onclick = closeModal;
    return;
  }
  let tab = initialTab || "login";
  function render() {
    const isForgot = tab === "forgot", isRegister = tab === "register";
    openModal(`
      <h2>☁️ ${isForgot ? "Passwort zurücksetzen" : "Account"}</h2>
      ${!isForgot ? `<div class="auth-tabs">
        <button class="auth-tab-btn ${tab === "login" ? "active" : ""}" data-authtab="login">Anmelden</button>
        <button class="auth-tab-btn ${tab === "register" ? "active" : ""}" data-authtab="register">Registrieren</button>
      </div>` : ""}
      <div class="auth-form">
        <label>E-Mail<input type="email" id="auth-email" autocomplete="email"></label>
        ${!isForgot ? `<label>Passwort<input type="password" id="auth-password" autocomplete="${isRegister ? "new-password" : "current-password"}"></label>` : ""}
        <div class="auth-msg" id="auth-msg"></div>
        <button class="btn btn-primary" id="auth-submit">${isForgot ? "Link senden" : isRegister ? "Registrieren" : "Anmelden"}</button>
        ${!isForgot ? '<button class="auth-forgot" id="auth-forgot-btn">Passwort vergessen?</button>' : '<button class="auth-forgot" id="auth-back-btn">← Zurück</button>'}
      </div>`);
    if (!isForgot) {
      $("modal-box").querySelectorAll("[data-authtab]").forEach((b) => (b.onclick = () => { tab = b.dataset.authtab; render(); }));
      $("auth-forgot-btn").onclick = () => { tab = "forgot"; render(); };
    } else {
      $("auth-back-btn").onclick = () => { tab = "login"; render(); };
    }
    $("auth-submit").onclick = async () => {
      const email = $("auth-email").value.trim();
      const pw = !isForgot ? $("auth-password").value : "";
      const msg = $("auth-msg");
      msg.className = "auth-msg"; msg.textContent = "";
      if (!email) { msg.className = "auth-msg error"; msg.textContent = "Bitte E-Mail-Adresse eingeben."; return; }
      if (!isForgot && pw.length < 6) { msg.className = "auth-msg error"; msg.textContent = "Passwort muss mindestens 6 Zeichen haben."; return; }
      $("auth-submit").disabled = true;
      let res;
      if (isForgot) res = await authResetPassword(email);
      else if (isRegister) res = await authRegister(email, pw);
      else res = await authLogin(email, pw);
      if ($("auth-submit")) $("auth-submit").disabled = false;
      if (res.error) { msg.className = "auth-msg error"; msg.textContent = res.error; return; }
      if (isForgot) { msg.className = "auth-msg success"; msg.textContent = "E-Mail zum Zurücksetzen wurde gesendet."; return; }
      if (isRegister) { msg.className = "auth-msg success"; msg.textContent = "Konto erstellt! Bestätigungsmail wurde gesendet."; setTimeout(closeModal, 1400); return; }
      closeModal();
    };
  }
  render();
}

// ============================================================
// TABS
// ============================================================
function switchTab(tab) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === "panel-" + tab));
  SND.tab();
}

// ============================================================
// TUTORIAL
// ============================================================
const TUTORIAL_STEPS = [
  { title: "👋 Willkommen bei BörsenTycoon!", text: "Du startest mit 1.000 € Kapital. Kaufe und verkaufe Aktien im Börse-Tab, poste im Social-Tab und baue dein Krypto-Mining-Imperium auf. Viel Erfolg!" },
  { title: "📈 Dein erster Trade", text: "Wähle im Börse-Tab eine Aktie, gib eine Menge ein und klicke 'Kaufen'. Beobachte den Kurs — grün heißt Gewinn, rot heißt Verlust!" },
  { title: "💬 Dein erster Post", text: "Im Social-Tab kannst du Vorhersagen posten. Liegst du richtig, gewinnst du Follower. Liegst du falsch, verlierst du welche — aber nur bei eindeutig falschen Tipps!" },
  { title: "⛏️ Dein erstes Mining-Rig", text: "Im Mining-Tab kannst du GPUs kaufen. Verkabele sie manuell für einen Ertrags-Bonus, bevor du später alles automatisierst!" },
];
function showTutorial() {
  if (S.tutorialDone) return;
  const step = TUTORIAL_STEPS[S.tutorialStep];
  if (!step) { S.tutorialDone = true; $("tutorial-overlay").hidden = true; saveGame(); return; }
  $("tutorial-box").innerHTML = `<h2>${step.title}</h2><p>${step.text}</p><button class="btn btn-primary" id="tut-next">${S.tutorialStep < TUTORIAL_STEPS.length - 1 ? "Weiter" : "Los geht's!"}</button>`;
  $("tutorial-overlay").hidden = false;
  $("tut-next").onclick = () => { S.tutorialStep++; showTutorial(); };
}

// ============================================================
// MAIN LOOP / INIT
// ============================================================
function marketAnalyse() {
  if (now() < S.analyseCdUntil) return;
  S.analyseCdUntil = now() + 6000;
  if (Math.random() < 0.7) {
    const amt = Math.max(10, netWorth() * 0.0006);
    S.cash += amt;
    floatMoney($("btn-analyse"), amt);
    SND.gain();
  } else {
    S.viralBoost = clamp(S.viralBoost + 0.1, 0, 0.5);
    pushNotify("🔎 Analyse abgeschlossen", "Dein nächster Post wird stärker wirken!");
  }
  renderAll();
}
function analyseCdTick() {
  const remain = Math.max(0, S.analyseCdUntil - now());
  $("analyse-cd").textContent = remain > 0 ? "(" + Math.ceil(remain / 1000) + "s)" : "";
  $("btn-analyse").disabled = remain > 0;
}

function overclock() {
  if (now() < S.overclockCdUntil) return;
  S.overclockUntil = now() + 10000;
  S.overclockCdUntil = now() + 25000;
  $("btn-overclock").classList.add("active");
  pushNotify("⚡ OVERCLOCKING!", "3x Geschwindigkeit für 10 Sekunden!");
  setTimeout(() => $("btn-overclock").classList.remove("active"), 10000);
}

function secondTick() {
  costsTick();
  secTick();
  miningTick();
  investorDealTick();
  ipoTick();
  autopilotTick();
  analyseCdTick();
  checkSponsor();
  renderHud();
  renderAutomation();
  // Sponsor-Einnahmen
  if (S.sponsorActive) S.cash += 1.5 + S.followers / 9000;
  // Level-Up Talentpunkte
  const lvl = level();
  if (!S._lastLevel) S._lastLevel = 1;
  if (lvl > S._lastLevel) {
    S.skillPoints += lvl - S._lastLevel;
    pushNotify("⭐ Level Up!", `Level ${lvl} erreicht! +${lvl - S._lastLevel} Talentpunkt(e)`, "levelUp");
    spawnConfetti(50);
    S._lastLevel = lvl;
  }
}

function initEventListeners() {
  document.querySelectorAll(".tab-btn").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
  document.querySelectorAll(".uptab-btn").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".uptab-btn").forEach((x) => x.classList.remove("active"));
    b.classList.add("active"); currentUpgradeTab = b.dataset.uptab; renderUpgrades(); SND.click();
  }));
  document.querySelectorAll(".inboxtab-btn").forEach((b) => b.addEventListener("click", () => { switchInboxTab(b.dataset.inboxtab); SND.click(); }));

  $("btn-analyse").addEventListener("click", marketAnalyse);
  $("btn-overclock").addEventListener("click", overclock);
  $("chk-autopilot").addEventListener("change", (e) => { SND.toggle(); S.autopilot = e.target.checked; });
  $("chk-autopilot").checked = true;

  $("btn-post").addEventListener("click", () => {
    const text = $("post-text").value;
    const stockId = $("post-stock").value;
    const dir = $("post-direction").value;
    postMessage(text, stockId, dir);
    $("post-text").value = "";
  });
  $("btn-fakenews").addEventListener("click", fakeNewsCampaign);
  $("btn-meme").addEventListener("click", () => generateMeme(choice(S.trending.length ? S.trending : ["#MarketCrash"])));

  $("btn-sell-coins").addEventListener("click", () => sellCoins(false));
  $("btn-fuse").addEventListener("click", fixFuse);

  $("btn-start-roadshow").addEventListener("click", () => {
    const name = $("ipo-name").value || "Tycoon Holding AG";
    const logo = document.querySelector(".logo-picker span.selected");
    const price = parseFloat($("ipo-price").value) || 50;
    foundIpo(name, logo ? logo.textContent : "🏢", price);
  });
  $("btn-buyback").addEventListener("click", buybackShares);
  $("ipo-dividend-slider").addEventListener("input", (e) => { S.ipo.dividendRate = parseFloat(e.target.value); $("ipo-dividend-value").textContent = e.target.value + "%"; });

  $("chk-sound").addEventListener("change", (e) => {
    if (e.target.checked) { S.soundOn = true; SND.toggle(); } else { SND.toggle(); S.soundOn = false; }
  });
  $("btn-reset").addEventListener("click", () => {
    if (confirm("Wirklich den kompletten Spielstand löschen?")) {
      localStorage.removeItem(SAVE_KEY);
      location.reload();
    }
  });
  $("btn-prestige").addEventListener("click", doPrestige);
  $("btn-account").addEventListener("click", () => { cloudUser ? switchTab("settings") : openAuthModal("login"); });

  // Logo Picker
  const logos = ["🏢", "🚀", "🦅", "🐉", "💎", "🌐", "⚡", "🏆"];
  $("logo-picker").innerHTML = logos.map((l, i) => `<span class="${i === 0 ? "selected" : ""}">${l}</span>`).join("");
  $("logo-picker").querySelectorAll("span").forEach((s) => s.addEventListener("click", () => {
    $("logo-picker").querySelectorAll("span").forEach((x) => x.classList.remove("selected"));
    s.classList.add("selected");
  }));

  document.body.addEventListener("click", ensureAudio, { once: true });
}

function init() {
  loadGame();
  // Verhindert, dass ein bereits laufendes Markt-Ereignis (z.B. ein Flash-
  // Crash, der schon vor dem Laden der Seite begann) fälschlich als "gerade
  // gestartet" gemeldet wird.
  const seedTick = marketTickIndex(now());
  const seedCrash = sharedFlashCrash(seedTick);
  const seedCrisis = sharedCrisis(seedTick);
  const seedNews = sharedNews(seedTick);
  const seedRival = sharedRivalPost(seedTick);
  marketEventEdge = {
    flashCrash: !!(seedCrash && seedCrash.active),
    crisisWindow: seedCrisis && seedCrisis.active ? seedCrisis.windowIdx : -1,
    newsWindow: seedNews && seedNews.active ? seedNews.windowIdx : -1,
    rivalWindow: seedRival && seedRival.active ? seedRival.windowIdx : -1,
  };
  initEventListeners();
  applyTheme();
  cloudInit();
  initCasino();
  $("chk-sound").checked = S.soundOn;
  $("chk-autopilot").checked = S.autopilot;
  renderAll();
  refreshTrending();
  switchInboxTab("chats");

  setInterval(priceTick, 1500);
  setInterval(secondTick, 1000);
  setInterval(payDividends, 30000);
  setInterval(saveGame, 10000);
  setInterval(cloudSyncTick, 60000);
  setInterval(refreshTrending, 45000);
  inboxLoop();
  qteLoop();
  vipEventLoop();
  battleChallengeLoop();

  showTutorial();
  window.addEventListener("beforeunload", saveGame);

  // Haelt den Spielstand ueber ein Republish hinweg fuer bereits offene
  // Tabs am Leben (localStorage traegt ihn ohnehin schon URL-uebergreifend,
  // das hier faengt zusaetzlich noch die letzten <10s vor dem Autosave ab).
  window.claude?.hot?.snapshot?.(() => S);
}

function boot() {
  if (window.claude?.hot?.ready) window.claude.hot.ready(init);
  else init();
}
document.addEventListener("DOMContentLoaded", boot);
