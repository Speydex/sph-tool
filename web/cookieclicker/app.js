"use strict";

/* ======================================================================
   KeksKlicker — ein eigenständiger Cookie-Clicker.
   Alles läuft lokal im Browser, Spielstand landet in localStorage.
   ====================================================================== */

const SAVE_KEY = "sph_cookieclicker_save_v1";

/* ============ Gebäude ============ */
const BUILDINGS = [
  { id: "cursor", name: "Cursor", icon: "🖱️", baseCost: 15, baseCps: 0.1, desc: "Klickt automatisch für dich mit." },
  { id: "grandma", name: "Oma", icon: "👵", baseCost: 100, baseCps: 1, desc: "Backt mit uralten Familienrezepten." },
  { id: "farm", name: "Keksfarm", icon: "🌾", baseCost: 1100, baseCps: 8, desc: "Baut Keksteig auf riesigen Feldern an." },
  { id: "mine", name: "Mine", icon: "⛏️", baseCost: 12000, baseCps: 47, desc: "Fördert Schokostückchen tief unter der Erde." },
  { id: "factory", name: "Fabrik", icon: "🏭", baseCost: 130000, baseCps: 260, desc: "Produziert Kekse am Fließband." },
  { id: "bank", name: "Bank", icon: "🏦", baseCost: 1400000, baseCps: 1400, desc: "Verwandelt Zinsen in Kekskapital." },
  { id: "temple", name: "Tempel", icon: "🛕", baseCost: 20000000, baseCps: 7800, desc: "Uralte Keksgötter segnen deine Produktion." },
  { id: "wizard", name: "Zauberturm", icon: "🧙", baseCost: 330000000, baseCps: 44000, desc: "Verzaubert Mehl und Zucker zu Keksen." },
  { id: "shipment", name: "Raumschiff", icon: "🚀", baseCost: 5100000000, baseCps: 260000, desc: "Importiert Kekse von fernen Planeten." },
  { id: "alchemy", name: "Alchemielabor", icon: "⚗️", baseCost: 75000000000, baseCps: 1600000, desc: "Transmutiert Blei in Schokolade." },
];

/* ============ Verbesserungen ============ */
const BUILDING_UPGRADE_TIERS = [
  { threshold: 1, factor: 10, roman: "I" },
  { threshold: 5, factor: 60, roman: "II" },
  { threshold: 25, factor: 300, roman: "III" },
  { threshold: 50, factor: 1000, roman: "IV" },
];

function buildBuildingUpgrades() {
  const list = [];
  for (const b of BUILDINGS) {
    BUILDING_UPGRADE_TIERS.forEach((tier, i) => {
      list.push({
        id: `bld_${b.id}_${i}`,
        name: `${b.name}-Veredelung ${tier.roman}`,
        icon: b.icon,
        desc: `Verdoppelt die Produktion all deiner ${b.name}n.`,
        cost: Math.round(b.baseCost * tier.factor),
        requirement: (s) => s.buildings[b.id] >= tier.threshold,
        effect: (s) => { s.buildingMultiplier[b.id] *= 2; },
      });
    });
  }
  return list;
}

const CLICK_UPGRADES = [
  { id: "click_glove", name: "Wollhandschuh", icon: "🧤", desc: "+1 Keks pro Klick.", cost: 50,
    requirement: () => true, effect: (s) => { s.clickFlat += 1; } },
  { id: "click_steel", name: "Fingerhut aus Stahl", icon: "🛡️", desc: "Klickstärke verdoppelt sich.", cost: 1000,
    requirement: (s) => s.totalBaked >= 500, effect: (s) => { s.clickMultiplier *= 2; } },
  { id: "click_titan", name: "Titan-Fingerhut", icon: "⚙️", desc: "Klickstärke verdoppelt sich erneut.", cost: 50000,
    requirement: (s) => s.totalBaked >= 20000, effect: (s) => { s.clickMultiplier *= 2; } },
  { id: "click_carpal", name: "Karpaltunnel-Handschuh", icon: "🦾", desc: "Klicks bringen zusätzlich 1% deiner Kekse pro Sekunde.", cost: 500000,
    requirement: (s) => computeCps(s) >= 100, effect: (s) => { s.clickCpsShare += 0.01; } },
  { id: "click_quantum", name: "Quantenfingerspitze", icon: "✨", desc: "Klickstärke verdreifacht sich, +4% CPS-Bonus pro Klick.", cost: 20000000,
    requirement: (s) => computeCps(s) >= 10000, effect: (s) => { s.clickMultiplier *= 3; s.clickCpsShare += 0.04; } },
];

const FLAVOR_UPGRADES = [
  { id: "flavor1", name: "Schokostückchen", icon: "🍫", desc: "+5% Keksproduktion, für immer.", cost: 2000,
    requirement: (s) => s.totalBaked >= 1000, effect: (s) => { s.globalMultiplier *= 1.05; } },
  { id: "flavor2", name: "Doppelte Schokolade", icon: "🍪", desc: "+7% Keksproduktion, für immer.", cost: 200000,
    requirement: (s) => s.totalBaked >= 100000, effect: (s) => { s.globalMultiplier *= 1.07; } },
  { id: "flavor3", name: "Weiße Schokolade", icon: "🤍", desc: "+7% Keksproduktion, für immer.", cost: 20000000,
    requirement: (s) => s.totalBaked >= 10000000, effect: (s) => { s.globalMultiplier *= 1.07; } },
  { id: "flavor4", name: "Karamell-Kern", icon: "🍮", desc: "+8% Keksproduktion, für immer.", cost: 2000000000,
    requirement: (s) => s.totalBaked >= 1000000000, effect: (s) => { s.globalMultiplier *= 1.08; } },
  { id: "flavor5", name: "Kosmischer Zimt", icon: "🌌", desc: "+10% Keksproduktion, für immer.", cost: 200000000000,
    requirement: (s) => s.totalBaked >= 100000000000, effect: (s) => { s.globalMultiplier *= 1.10; } },
];

const ALL_UPGRADES = [...CLICK_UPGRADES, ...buildBuildingUpgrades(), ...FLAVOR_UPGRADES];
const UPGRADES_BY_ID = Object.fromEntries(ALL_UPGRADES.map((u) => [u.id, u]));

/* ============ Erfolge ============ */
function totalBuildings(s) { return BUILDINGS.reduce((sum, b) => sum + s.buildings[b.id], 0); }

const ACHIEVEMENTS = [
  { id: "a1", name: "Der erste Bissen", icon: "🍪", desc: "Klicke den Keks zum ersten Mal.", req: (s) => s.totalClicks >= 1 },
  { id: "a2", name: "Fleißige Finger", icon: "👆", desc: "Klicke 100 Mal.", req: (s) => s.totalClicks >= 100 },
  { id: "a3", name: "Klick-Marathon", icon: "🏃", desc: "Klicke 1.000 Mal.", req: (s) => s.totalClicks >= 1000 },
  { id: "a4", name: "Taschengeld", icon: "🪙", desc: "Sammle 100 Kekse.", req: (s) => s.totalBaked >= 100 },
  { id: "a5", name: "Kekshaufen", icon: "🍯", desc: "Sammle 10.000 Kekse.", req: (s) => s.totalBaked >= 10000 },
  { id: "a6", name: "Keksfabrikant", icon: "🏭", desc: "Sammle 1 Million Kekse.", req: (s) => s.totalBaked >= 1e6 },
  { id: "a7", name: "Keksmilliardärin", icon: "💰", desc: "Sammle 1 Milliarde Kekse.", req: (s) => s.totalBaked >= 1e9 },
  { id: "a8", name: "Keksbillionärin", icon: "👑", desc: "Sammle 1 Billion Kekse.", req: (s) => s.totalBaked >= 1e12 },
  { id: "a9", name: "Erste Hilfe", icon: "🧑‍🍳", desc: "Kaufe dein erstes Gebäude.", req: (s) => totalBuildings(s) >= 1 },
  { id: "a10", name: "Sammlerin", icon: "🗃️", desc: "Besitze mindestens 1 von jedem Gebäudetyp.", req: (s) => BUILDINGS.every((b) => s.buildings[b.id] >= 1) },
  { id: "a11", name: "Omas Armee", icon: "👵", desc: "Besitze 50 Omas.", req: (s) => s.buildings.grandma >= 50 },
  { id: "a12", name: "Fließbandmeisterin", icon: "⚙️", desc: "Besitze 25 Fabriken.", req: (s) => s.buildings.factory >= 25 },
  { id: "a13", name: "Notenbankchefin", icon: "🏦", desc: "Besitze 25 Banken.", req: (s) => s.buildings.bank >= 25 },
  { id: "a14", name: "Erzmagierin", icon: "🧙", desc: "Besitze 25 Zaubertürme.", req: (s) => s.buildings.wizard >= 25 },
  { id: "a15", name: "Interstellar", icon: "🚀", desc: "Besitze 10 Raumschiffe.", req: (s) => s.buildings.shipment >= 10 },
  { id: "a16", name: "Meistertransmutatorin", icon: "⚗️", desc: "Besitze 10 Alchemielabore.", req: (s) => s.buildings.alchemy >= 10 },
  { id: "a17", name: "Goldrausch", icon: "✨", desc: "Klicke einen goldenen Keks an.", req: (s) => s.goldenClicked >= 1 },
  { id: "a18", name: "Glückspilz", icon: "🍀", desc: "Klicke 10 goldene Kekse an.", req: (s) => s.goldenClicked >= 10 },
  { id: "a19", name: "Zuckerrausch", icon: "⚡", desc: "Löse 5 Fieber-Rausch-Boosts aus.", req: (s) => s.frenzyTriggered >= 5 },
  { id: "a20", name: "Produktionsmonster", icon: "📈", desc: "Erreiche 1.000 Kekse pro Sekunde.", req: (s) => computeCps(s) >= 1000 },
  { id: "a21", name: "Massenproduktion", icon: "🌍", desc: "Erreiche 1 Million Kekse pro Sekunde.", req: (s) => computeCps(s) >= 1e6 },
  { id: "a22", name: "Erste Verbesserung", icon: "⭐", desc: "Kaufe deine erste Verbesserung.", req: (s) => s.upgradesOwned.length >= 1 },
  { id: "a23", name: "Verbesserungssammlerin", icon: "🌟", desc: "Kaufe 25 Verbesserungen.", req: (s) => s.upgradesOwned.length >= 25 },
];

/* ============ Goldener Keks: Effekte ============ */
const GOLDEN_EFFECTS = [
  { id: "frenzy", name: "Fieber-Rausch!", icon: "⚡", desc: "7x Produktion für 60 Sekunden.", duration: 60,
    apply: (s) => { addBuff(s, { type: "cps", multiplier: 7, endsAt: now() + 60000, label: "Fieber-Rausch", icon: "⚡" }); s.frenzyTriggered += 1; } },
  { id: "clickFrenzy", name: "Klick-Rausch!", icon: "👊", desc: "7x Klickstärke für 30 Sekunden.", duration: 30,
    apply: (s) => { addBuff(s, { type: "click", multiplier: 7, endsAt: now() + 30000, label: "Klick-Rausch", icon: "👊" }); } },
  { id: "lucky", name: "Glückstreffer!", icon: "🍀", desc: "Sofortige Kekse.", duration: 0,
    apply: (s) => {
      const bonus = Math.max(13, Math.min(s.cookies * 0.1, computeCps(s) * 900));
      grantCookies(s, bonus);
      showToast("🍀", "Glückstreffer!", `+${formatNumber(bonus)} Kekse`);
    } },
  { id: "blessing", name: "Segen der Bäckerin!", icon: "🙏", desc: "Kekse für 5 Minuten Produktion.", duration: 0,
    apply: (s) => {
      const bonus = Math.max(50, computeCps(s) * 300);
      grantCookies(s, bonus);
      showToast("🙏", "Segen der Bäckerin!", `+${formatNumber(bonus)} Kekse`);
    } },
];

/* ============ Zustand ============ */
function freshState() {
  const buildings = {};
  const buildingMultiplier = {};
  for (const b of BUILDINGS) { buildings[b.id] = 0; buildingMultiplier[b.id] = 1; }
  return {
    cookies: 0,
    totalBaked: 0,
    totalClicks: 0,
    goldenClicked: 0,
    frenzyTriggered: 0,
    buildings,
    buildingMultiplier,
    upgradesOwned: [],
    achievementsUnlocked: [],
    clickFlat: 0,
    clickMultiplier: 1,
    clickCpsShare: 0,
    globalMultiplier: 1,
    buffs: [],
    buyAmount: 1,
    soundOn: true,
    startedAt: Date.now(),
  };
}

let state = freshState();

function now() { return Date.now(); }

/* ============ Speichern / Laden ============ */
function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch (e) { /* localStorage evtl. nicht verfügbar — Spiel läuft trotzdem weiter */ }
}

function load() {
  let raw;
  try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { raw = null; }
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    const fresh = freshState();
    state = { ...fresh, ...data };
    // Fehlende Gebäude/Multiplikatoren (z.B. nach Update) auffüllen.
    for (const b of BUILDINGS) {
      if (!(b.id in state.buildings)) state.buildings[b.id] = 0;
      if (!(b.id in state.buildingMultiplier)) state.buildingMultiplier[b.id] = 1;
    }
    state.buffs = Array.isArray(state.buffs) ? state.buffs.filter((b) => b.endsAt > now()) : [];
  } catch (e) { /* korrupter Spielstand — mit frischem Zustand weitermachen */ }
}

function resetGame() {
  if (!confirm("Wirklich den kompletten Spielstand löschen? Das kann nicht rückgängig gemacht werden.")) return;
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  state = freshState();
  renderAll();
}

/* ============ Berechnungen ============ */
function computeBaseCps(s) {
  let sum = 0;
  for (const b of BUILDINGS) {
    sum += s.buildings[b.id] * b.baseCps * s.buildingMultiplier[b.id];
  }
  return sum;
}

function activeMultiplier(s, type) {
  let mult = 1;
  for (const buff of s.buffs) {
    if (buff.type === type && buff.endsAt > now()) mult *= buff.multiplier;
  }
  return mult;
}

function computeCps(s) {
  return computeBaseCps(s) * s.globalMultiplier * activeMultiplier(s, "cps");
}

function computeClickValue(s) {
  const base = (1 + s.clickFlat) * s.clickMultiplier * activeMultiplier(s, "click");
  const cpsShare = computeCps(s) * s.clickCpsShare;
  return base + cpsShare;
}

function buildingCost(b, owned, amount) {
  // geometrische Reihe: cost(n) = baseCost * 1.15^n
  const r = 1.15;
  const first = b.baseCost * Math.pow(r, owned);
  if (amount === 1) return first;
  return first * (Math.pow(r, amount) - 1) / (r - 1);
}

function grantCookies(s, amount) {
  s.cookies += amount;
  s.totalBaked += amount;
}

function addBuff(s, buff) {
  s.buffs = s.buffs.filter((b) => b.type !== buff.type || b.endsAt <= now());
  s.buffs.push(buff);
}

/* ============ Kaufen ============ */
function buyBuilding(id, amount) {
  const b = BUILDINGS.find((x) => x.id === id);
  if (!b) return;
  const owned = state.buildings[id];
  const cost = buildingCost(b, owned, amount);
  if (state.cookies < cost) return;
  state.cookies -= cost;
  state.buildings[id] += amount;
  checkAchievements();
  renderShop();
  renderUpgrades();
  renderStats();
  updateHeader();
  save();
}

function buyUpgrade(id) {
  const u = UPGRADES_BY_ID[id];
  if (!u) return;
  if (state.upgradesOwned.includes(id)) return;
  if (state.cookies < u.cost) return;
  state.cookies -= u.cost;
  state.upgradesOwned.push(id);
  u.effect(state);
  showToast(u.icon, "Verbesserung gekauft", u.name);
  checkAchievements();
  renderUpgrades();
  renderShop();
  updateHeader();
  save();
}

/* ============ Klick ============ */
function clickCookie(evt) {
  const value = computeClickValue(state);
  grantCookies(state, value);
  state.totalClicks += 1;
  playClickSound();
  spawnFloatNumber(evt.clientX, evt.clientY, `+${formatNumber(value)}`);
  const btn = document.getElementById("big-cookie");
  btn.classList.remove("clicked");
  void btn.offsetWidth;
  btn.classList.add("clicked");
  checkAchievements();
  updateHeader();
}

/* ============ Formatierung ============ */
const SCALE = [
  [1e33, "Dez."], [1e30, "Non."], [1e27, "Okt."], [1e24, "Sept."], [1e21, "Sext."],
  [1e18, "Quint."], [1e15, "Bril."], [1e12, "Bio."], [1e9, "Mrd."], [1e6, "Mio."], [1e3, "Tsd."],
];

function formatNumber(n) {
  if (n == null || Number.isNaN(n)) return "0";
  const abs = Math.abs(n);
  if (abs < 1000) return abs < 100 ? n.toFixed(1).replace(/\.0$/, "") : Math.floor(n).toString();
  for (const [value, suffix] of SCALE) {
    if (abs >= value) {
      return (n / value).toFixed(2) + " " + suffix;
    }
  }
  return Math.floor(n).toString();
}

function formatInt(n) { return Math.floor(n).toLocaleString("de-DE"); }

/* ============ Rendering ============ */
let activeTab = "shop";

function updateHeader() {
  const cookiesEl = document.getElementById("hud-cookies");
  const cpsEl = document.getElementById("hud-cps");
  const clickEl = document.getElementById("hud-click");
  cookiesEl.textContent = formatNumber(state.cookies);
  cpsEl.textContent = formatNumber(computeCps(state));
  clickEl.textContent = formatNumber(computeClickValue(state));
  document.title = `${formatNumber(state.cookies)} Kekse — KeksKlicker`;
}

function pulse(el) {
  el.classList.remove("pulse");
  void el.offsetWidth;
  el.classList.add("pulse");
}

function renderShop() {
  const list = document.getElementById("shop-list");
  list.innerHTML = "";
  for (const b of BUILDINGS) {
    const owned = state.buildings[b.id];
    const cost = buildingCost(b, owned, state.buyAmount);
    const affordable = state.cookies >= cost;
    const cps = b.baseCps * state.buildingMultiplier[b.id];
    const item = document.createElement("button");
    item.type = "button";
    item.className = "shop-item" + (affordable ? "" : " disabled");
    item.innerHTML = `
      <span class="shop-icon">${b.icon}</span>
      <span class="shop-info">
        <span class="shop-name">${b.name}${owned > 0 ? `<span class="shop-owned">${owned}x</span>` : ""}</span>
        <span class="shop-desc">${b.desc}</span>
        <span class="shop-cps">${formatNumber(cps)} Kekse/s pro Stück</span>
      </span>
      <span class="shop-cost">${formatNumber(cost)}<small>Kekse${state.buyAmount > 1 ? ` (${state.buyAmount}x)` : ""}</small></span>
    `;
    item.addEventListener("click", () => {
      const liveCost = buildingCost(b, state.buildings[b.id], state.buyAmount);
      if (state.cookies < liveCost) return;
      item.classList.add("bought-flash");
      buyBuilding(b.id, state.buyAmount);
    });
    list.appendChild(item);
  }
}

function renderUpgrades() {
  const list = document.getElementById("upgrade-list");
  const hint = document.getElementById("upgrade-hidden-hint");
  const badge = document.getElementById("upgrade-badge");
  list.innerHTML = "";
  const available = ALL_UPGRADES.filter((u) => !state.upgradesOwned.includes(u.id) && u.requirement(state));
  available.sort((a, b) => a.cost - b.cost);
  const lockedCount = ALL_UPGRADES.length - state.upgradesOwned.length - available.length;

  for (const u of available) {
    const affordable = state.cookies >= u.cost;
    const card = document.createElement("button");
    card.type = "button";
    card.className = "upgrade-card" + (affordable ? "" : " disabled");
    card.innerHTML = `
      <div class="upgrade-head"><span class="upgrade-icon">${u.icon}</span><span class="upgrade-name">${u.name}</span></div>
      <div class="upgrade-desc">${u.desc}</div>
      <div class="upgrade-cost">${formatNumber(u.cost)} Kekse</div>
    `;
    card.addEventListener("click", () => { if (state.cookies >= u.cost) buyUpgrade(u.id); });
    list.appendChild(card);
  }

  if (available.length === 0 && lockedCount > 0) {
    hint.textContent = `Noch ${lockedCount} weitere Verbesserungen warten darauf, freigeschaltet zu werden.`;
  } else if (lockedCount > 0) {
    hint.textContent = `${lockedCount} weitere Verbesserungen sind noch versteckt.`;
  } else {
    hint.textContent = available.length === 0 ? "Du hast alle Verbesserungen freigeschaltet! 🎉" : "";
  }

  if (available.length > 0) { badge.hidden = false; badge.textContent = String(available.length); }
  else { badge.hidden = true; }
}

function renderAchievements() {
  const grid = document.getElementById("achievements-grid");
  const countEl = document.getElementById("ach-count");
  grid.innerHTML = "";
  let unlocked = 0;
  for (const a of ACHIEVEMENTS) {
    const done = state.achievementsUnlocked.includes(a.id);
    if (done) unlocked += 1;
    const card = document.createElement("div");
    card.className = "ach-card " + (done ? "done" : "locked");
    card.innerHTML = `
      <div class="ach-icon">${done ? a.icon : "❔"}</div>
      <div class="ach-name">${done ? a.name : "???"}</div>
      <div class="ach-desc">${done ? a.desc : "Noch nicht freigeschaltet."}</div>
    `;
    grid.appendChild(card);
  }
  countEl.textContent = `${unlocked}/${ACHIEVEMENTS.length}`;
}

function renderStats() {
  const grid = document.getElementById("stats-grid");
  const cps = computeCps(state);
  const playedMs = now() - state.startedAt;
  const tiles = [
    { lbl: "Kekse (aktuell)", val: formatNumber(state.cookies) },
    { lbl: "Kekse insgesamt gebacken", val: formatNumber(state.totalBaked) },
    { lbl: "Kekse pro Sekunde", val: formatNumber(cps) },
    { lbl: "Kekse pro Klick", val: formatNumber(computeClickValue(state)) },
    { lbl: "Klicks insgesamt", val: formatInt(state.totalClicks) },
    { lbl: "Gebäude insgesamt", val: formatInt(totalBuildings(state)) },
    { lbl: "Verbesserungen gekauft", val: `${state.upgradesOwned.length}/${ALL_UPGRADES.length}` },
    { lbl: "Erfolge freigeschaltet", val: `${state.achievementsUnlocked.length}/${ACHIEVEMENTS.length}` },
    { lbl: "Goldene Kekse geklickt", val: formatInt(state.goldenClicked) },
    { lbl: "Spielzeit", val: formatDuration(playedMs) },
  ];
  grid.innerHTML = tiles.map((t) => `
    <div class="stat-tile"><div class="val">${t.val}</div><div class="lbl">${t.lbl}</div></div>
  `).join("");
}

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function renderBuffs() {
  const row = document.getElementById("buff-row");
  const active = state.buffs.filter((b) => b.endsAt > now());
  row.innerHTML = active.map((b) => {
    const secLeft = Math.ceil((b.endsAt - now()) / 1000);
    return `<span class="buff-chip">${b.icon} ${b.label} <span class="buff-timer">${secLeft}s</span></span>`;
  }).join("");
}

function renderAll() {
  updateHeader();
  renderShop();
  renderUpgrades();
  renderAchievements();
  renderStats();
  renderBuffs();
}

/* ============ Erfolge prüfen ============ */
function checkAchievements() {
  for (const a of ACHIEVEMENTS) {
    if (!state.achievementsUnlocked.includes(a.id) && a.req(state)) {
      state.achievementsUnlocked.push(a.id);
      showToast(a.icon, "Erfolg freigeschaltet!", a.name);
      renderAchievements();
    }
  }
}

/* ============ Floating Numbers ============ */
function spawnFloatNumber(x, y, text) {
  const layer = document.getElementById("float-layer");
  const el = document.createElement("span");
  el.className = "float-num";
  el.textContent = text;
  const jitterX = (Math.random() - 0.5) * 40;
  el.style.left = `${x + jitterX}px`;
  el.style.top = `${y}px`;
  layer.appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

/* ============ Toasts ============ */
function showToast(icon, title, body) {
  const stack = document.getElementById("toast-stack");
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<span class="ti">${icon}</span><span><span class="tt">${title}</span><br>${body}</span>`;
  stack.appendChild(el);
  setTimeout(() => {
    el.classList.add("fading");
    setTimeout(() => el.remove(), 400);
  }, 4200);
}

/* ============ Sound (synthetisiert, keine externen Dateien) ============ */
let audioCtx = null;
function playClickSound() {
  if (!state.soundOn) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = 520 + Math.random() * 60;
    gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.12);
  } catch (e) { /* Audio evtl. blockiert — kein Problem fürs Spiel */ }
}

/* ============ Goldener Keks ============ */
function scheduleGoldenCookie() {
  const delay = 25000 + Math.random() * 35000;
  setTimeout(spawnGoldenCookie, delay);
}

function spawnGoldenCookie() {
  const stage = document.getElementById("cookie-stage");
  const rect = stage.getBoundingClientRect();
  const size = 74;
  const maxX = Math.max(10, rect.width - size);
  const maxY = Math.max(10, rect.height - size);
  const x = Math.random() * maxX;
  const y = Math.random() * maxY;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "golden-cookie";
  btn.style.left = `${x}px`;
  btn.style.top = `${y}px`;
  btn.setAttribute("aria-label", "Goldener Keks");

  let claimed = false;
  const vanish = setTimeout(() => { if (!claimed) btn.remove(); }, 13000);

  btn.addEventListener("click", (evt) => {
    if (claimed) return;
    claimed = true;
    clearTimeout(vanish);
    btn.remove();
    state.goldenClicked += 1;
    const effect = GOLDEN_EFFECTS[Math.floor(Math.random() * GOLDEN_EFFECTS.length)];
    effect.apply(state);
    if (effect.id !== "lucky" && effect.id !== "blessing") {
      showToast(effect.icon, effect.name, effect.desc);
    }
    spawnFloatNumber(evt.clientX, evt.clientY, effect.icon);
    checkAchievements();
    renderBuffs();
    updateHeader();
    save();
  });

  stage.appendChild(btn);
  scheduleGoldenCookie();
}

/* ============ Tabs ============ */
function setupTabs() {
  const tabs = document.getElementById("tabs");
  tabs.addEventListener("click", (evt) => {
    const btn = evt.target.closest(".tab-btn");
    if (!btn) return;
    activeTab = btn.dataset.tab;
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `panel-${activeTab}`));
  });
}

function setupBuyAmount() {
  document.querySelectorAll(".buy-amount-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.buyAmount = parseInt(btn.dataset.amount, 10);
      document.querySelectorAll(".buy-amount-btn").forEach((b) => b.classList.toggle("active", b === btn));
      renderShop();
    });
  });
}

/* ============ Game Loop ============ */
let lastTick = now();
function gameLoop() {
  const t = now();
  const deltaSec = (t - lastTick) / 1000;
  lastTick = t;
  if (deltaSec > 0 && deltaSec < 5) {
    grantCookies(state, computeCps(state) * deltaSec);
  }
  updateHeader();
  renderBuffs();
  requestAnimationFrame(gameLoop);
}

/* ============ Init ============ */
function init() {
  load();
  document.getElementById("big-cookie").addEventListener("click", clickCookie);
  document.getElementById("btn-reset").addEventListener("click", resetGame);
  document.getElementById("btn-sound").addEventListener("click", () => {
    state.soundOn = !state.soundOn;
    const btn = document.getElementById("btn-sound");
    btn.textContent = state.soundOn ? "🔊" : "🔇";
    btn.classList.toggle("muted", !state.soundOn);
    save();
  });
  document.getElementById("btn-sound").textContent = state.soundOn ? "🔊" : "🔇";
  document.getElementById("btn-sound").classList.toggle("muted", !state.soundOn);

  setupTabs();
  setupBuyAmount();
  document.querySelector(`.buy-amount-btn[data-amount="${state.buyAmount}"]`)?.classList.add("active");

  renderAll();
  checkAchievements();
  scheduleGoldenCookie();
  requestAnimationFrame(gameLoop);

  setInterval(() => {
    renderShop();
    renderUpgrades();
    renderStats();
  }, 400);
  setInterval(save, 15000);
  window.addEventListener("beforeunload", save);
  document.addEventListener("visibilitychange", () => { if (document.hidden) save(); });
}

document.addEventListener("DOMContentLoaded", init);
