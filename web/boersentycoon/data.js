// ============================================================
// BörsenTycoon — Statische Spieldaten
// ============================================================

const STOCKS = [
  { id: "ainovate",   name: "AInovate",     ticker: "AINV", cat: "tech",    base: 120, vol: 0.035, drift: 0.0018, desc: "Hochriskante KI-Firma mit explosivem Wachstum." },
  { id: "macrosoft",  name: "MacroSoft",    ticker: "MSFT2", cat: "tech",   base: 340, vol: 0.007, drift: 0.0006, desc: "Kerngeschäft stabil wie ein Fels." },
  { id: "bytedrive",  name: "ByteDrive",    ticker: "BYTD", cat: "tech",    base: 85,  vol: 0.018, drift: 0.0009, desc: "Solides Mittelklasse-Tech-Unternehmen." },
  { id: "solarpulse", name: "SolarPulse",   ticker: "SOLP", cat: "energie", base: 45,  vol: 0.026, drift: 0.0005, desc: "Erneuerbare Energie, stark wetterabhängig." },
  { id: "spacexplore",name: "SpaceXplore",  ticker: "SPXP", cat: "energie", base: 210, vol: 0.03,  drift: 0.002,  desc: "Mega-Hype-Raumfahrt-Konzern." },
  { id: "cryptomoon", name: "CryptoMoon",   ticker: "CMOON", cat: "energie", base: 60,  vol: 0.06,  drift: 0.0,    desc: "Extrem volatile Krypto-Aktie." },
  { id: "memecoin",   name: "MemeCoin",     ticker: "MEME", cat: "energie", base: 12,  vol: 0.08,  drift: -0.0005, desc: "Chaotisch, unberechenbar, irrational." },
  { id: "burgerking", name: "BurgerKingpin",ticker: "BURG", cat: "konsum",  base: 55,  vol: 0.004, drift: 0.0006, desc: "Krisensicherer Fast-Food-Gigant." },
  { id: "biogen",     name: "BioGen",       ticker: "BGEN", cat: "konsum",  base: 95,  vol: 0.02,  drift: 0.001,  desc: "Pharma-Durchbrüche können den Kurs explodieren lassen." },
  { id: "globaloil",  name: "GlobalOil",    ticker: "GOIL", cat: "konsum",  base: 130, vol: 0.01,  drift: 0.0003, desc: "Konstanter Rohstoff-Konzern." },
];

const CATEGORIES = {
  tech:    { label: "Tech & KI", color: "#00d1ff" },
  energie: { label: "Energie & Hype", color: "#2ee6a6" },
  konsum:  { label: "Konsum & Pharma", color: "#ffd166" },
};

// Breaking-News Templates. {company} wird ersetzt. pct = [min,max] prozentualer Effekt.
const NEWS_TEMPLATES = [
  { text: "Tech-Boom: {company} Kurse steigen rasant!", pct: [0.05, 0.15], cat: "tech" },
  { text: "Skandal erschüttert {company}: Kurs bricht ein!", pct: [-0.20, -0.08] },
  { text: "{company} gewinnt Patentstreit! Kurs explodiert!", pct: [0.20, 0.5], companies: ["biogen"] },
  { text: "Hackerangriff auf {company}! Kurs stürzt ab!", pct: [-0.3, -0.15], companies: ["bytedrive", "cryptomoon"] },
  { text: "FDA lässt neues Medikament von {company} zu!", pct: [0.25, 0.45], companies: ["biogen"] },
  { text: "{company} verpasst Quartalszahlen deutlich!", pct: [-0.12, -0.04] },
  { text: "Analysten stufen {company} auf 'Kaufen' hoch!", pct: [0.06, 0.14] },
  { text: "Wetterkatastrophe trifft {company}!", pct: [-0.25, -0.1], companies: ["solarpulse"] },
  { text: "Rekord-Sonnenertrag beflügelt {company}!", pct: [0.1, 0.3], companies: ["solarpulse"] },
  { text: "Elonartiger CEO twittert über {company} — Kurs tanzt!", pct: [-0.3, 0.4], companies: ["memecoin", "cryptomoon"] },
  { text: "{company} kündigt Raketenstart an — Investoren jubeln!", pct: [0.15, 0.35], companies: ["spacexplore"] },
  { text: "Ölpreis-Schock trifft {company}!", pct: [-0.15, 0.15], companies: ["globaloil"] },
  { text: "Insider-Verkäufe bei {company} sorgen für Panik!", pct: [-0.15, -0.05] },
  { text: "{company} übertrifft Erwartungen deutlich!", pct: [0.08, 0.2] },
  { text: "Regulierungsbehörde ermittelt gegen {company}!", pct: [-0.18, -0.06] },
  { text: "Burger-Aktie {company} bleibt in der Krise stabil.", pct: [-0.02, 0.03], companies: ["burgerking"] },
  { text: "Massives Käuferinteresse treibt {company} an!", pct: [0.1, 0.22] },
];

// Ökonomische Krisen-/Boom-Events (sektorweit)
const CRISIS_EVENTS = [
  { name: "Ölkrise", text: "🌍 WIRTSCHAFTSKRISE: Ölkrise erschüttert die Weltmärkte!", boomCat: null, crashCat: "konsum", crashPct: -0.35 },
  { name: "Pandemie", text: "🌍 WIRTSCHAFTSKRISE: Pandemie legt Konsum-Sektor lahm!", crashCat: "konsum", crashPct: -0.45, boomCat: "tech", boomPct: 0.25 },
  { name: "KI-Durchbruch", text: "🚀 TECHNOLOGIE-DURCHBRUCH: KI-Aktien explodieren!", boomCat: "tech", boomPct: 1.0, crashCat: null },
  { name: "Energiewende", text: "🌍 WIRTSCHAFTSKRISE: Energiewende-Schock trifft Öl & Gas!", crashCat: "konsum", crashPct: -0.2, boomCat: "energie", boomPct: 0.3 },
];

// ============================================================
// Upgrades
// ============================================================
// scaling: Kostenmultiplikator pro Kauf (für level-basierte Upgrades)
const UPGRADES = {
  trading: [
    { id: "insider_tips", name: "Insider-Tipps", desc: "Warnt vor kommenden Kurseinbrüchen (Push-Meldung).", baseCost: 5000, max: 1 },
    { id: "auto_trader", name: "Auto-Trader", desc: "Kauft automatisch Aktien bei Tiefstpreisen.", baseCost: 15000, max: 1, automation: true },
    { id: "trading_software", name: "Trading-Software", desc: "Senkt Gebühren beim Kauf/Verkauf um 25% (je Stufe).", baseCost: 8000, scaling: 2.2, max: 3 },
    { id: "leverage_unlock", name: "Hebel-Trading freischalten", desc: "Schaltet Short/Long-Positionen (bis 5x Hebel) frei.", baseCost: 25000, max: 1 },
    { id: "dividend_boost", name: "Dividenden-Anteile", desc: "Erhöht Dividenden-Ausschüttung alle 30s um 20% (je Stufe).", baseCost: 12000, scaling: 2.5, max: 5 },
    { id: "stop_loss_bot", name: "Auto-Stop-Loss & Take-Profit Bot", desc: "Verkauft automatisch bei eingestelltem Gewinn/Verlust.", baseCost: 60000, max: 1, automation: true },
    { id: "quant_bot_v2", name: "Quant-Algorithmus V2", desc: "Führt Trades bei positiven Signalen autonom aus.", baseCost: 250000, max: 1, automation: true, requiresLevel: 6 },
    { id: "ai_portfolio_mgr", name: "AI-Portfolio-Manager", desc: "Reinvestiert Gewinne automatisch in Dividendentitel.", baseCost: 500000, max: 1, automation: true, requiresLevel: 8 },
  ],
  mining: [
    { id: "auto_cooling", name: "Auto-Kühlungs-Upgrade", desc: "Rigs überhitzen nicht mehr — kein manuelles Kühlen nötig.", baseCost: 20000, max: 1, automation: true },
    { id: "smart_grid", name: "Smart-Grid Controller", desc: "Verhindert Stromausfälle/Sicherungs-Trips zu 100%.", baseCost: 80000, max: 1, automation: true },
    { id: "solar_auto_mgr", name: "Solar-Anlage & Auto-Manager", desc: "Automatisiert Mining komplett, Stromkosten = 0 €.", baseCost: 400000, max: 1, automation: true, requiresLevel: 7 },
    { id: "robo_arm", name: "Roboter-Wartungs-Arm", desc: "Repariert defekte Rigs sofort, kein QTE nötig.", baseCost: 150000, max: 1, automation: true },
    { id: "crypto_auto_trader", name: "Krypto-Auto-Trader", desc: "Verkauft geminte Coins automatisch zum guten Kurs.", baseCost: 100000, max: 1, automation: true },
  ],
  social: [
    { id: "ghostwriter", name: "Ghostwriter KI", desc: "Postet automatisch Vorhersagen zu starken Trends.", baseCost: 300000, max: 1, automation: true, requiresLevel: 6 },
    { id: "social_botnet", name: "Social Botnet", desc: "Führt Influencer-Battles automatisch aus (Gewinnchance nach Followern).", baseCost: 200000, max: 1, automation: true },
    { id: "pr_agentur", name: "PR-Agentur", desc: "Übernimmt Battles automatisch und gewinnt sie zuverlässig.", baseCost: 120000, max: 1, automation: true },
    { id: "autonome_pr_kanzlei", name: "Autonome PR-Kanzlei", desc: "Beantwortet Nachrichten & Angebote automatisch optimal.", baseCost: 350000, max: 1, automation: true, requiresLevel: 7 },
    { id: "blue_checkmark", name: "Blauer Haken ✔️", desc: "Verdoppelt die Wirkung deiner Posts auf Kurse (ab 100.000 Follower).", baseCost: 0, max: 1, requiresFollowers: 100000 },
  ],
  legal: [
    { id: "junior_anwalt", name: "Junior-Anwalt", desc: "Verringert SEC-Strafzahlungen um 20%.", baseCost: 40000, max: 1 },
    { id: "top_kanzlei", name: "Top-Star-Kanzlei", desc: "Lässt das SEC-Risiko-Barometer 50% schneller sinken.", baseCost: 180000, max: 1 },
    { id: "offshore_briefkasten", name: "Offshore-Briefkastenfirma", desc: "30% deiner Trades bleiben für die Aufsicht unsichtbar.", baseCost: 300000, max: 1 },
    { id: "lobbyarbeit", name: "Lobbyarbeit", desc: "Erhöht das Limit, ab dem die Aufsicht aufmerksam wird.", baseCost: 100000, max: 1 },
    { id: "auto_lobbyist", name: "Auto-Lobbyist", desc: "Baut SEC-Risiko dauerhaft im Hintergrund schneller ab.", baseCost: 220000, max: 1, automation: true },
    { id: "anwalts_automatik", name: "Anwalts-Automatik", desc: "Löst Razzien vollautomatisch mit maximalem Straferlass.", baseCost: 450000, max: 1, automation: true, requiresLevel: 8 },
  ],
};

const SKILL_TREE = [
  { id: "crypto_guru", name: "Crypto-Guru", desc: "Mining läuft 50% schneller & überhitzt 50% seltener.", cost: 1 },
  { id: "wallstreet_wolf", name: "Wall-Street-Wolf", desc: "Keine Handelsgebühren + höhere Hebel (bis 10x).", cost: 1 },
  { id: "viral_king", name: "Viral-King", desc: "Posts bringen doppelt so viele Follower.", cost: 1 },
  { id: "iron_nerves", name: "Nerven aus Stahl", desc: "SEC-Risiko steigt 25% langsamer.", cost: 2 },
  { id: "master_trader", name: "Meister-Trader", desc: "+10% Gewinnmarge auf alle Trades.", cost: 2 },
];

const EMPLOYEES = [
  { id: "social_manager", name: "Social-Media-Manager", desc: "Schreibt automatisch Posts für dich.", cost: 80000, salaryPerSec: 0.8, automation: true },
  { id: "crypto_techniker", name: "Krypto-Techniker", desc: "Repariert & kühlt Rigs automatisch.", cost: 60000, salaryPerSec: 0.6, automation: true },
];

// Immobilien-Stufen (aufsteigend)
const ESTATES = [
  { id: "garage", name: "Garagen-Büro", icon: "🚪", cost: 0, rigSlots: 3, desc: "Der Anfang von allem." },
  { id: "penthouse", name: "Luxus-Penthouse", icon: "🏙️", cost: 250000, rigSlots: 8, postSpeedBonus: 0.10, desc: "+10% schnellere Wirkung deiner Posts, Platz für mehr Rigs." },
  { id: "villa", name: "Anwesen / Villa", icon: "🏡", cost: 2000000, rigSlots: 14, secReduction: 0.15, marginBonus: 0.05, desc: "-15% SEC-Risikozuwachs, +5% Gewinnmarge (Trading-Desk)." },
  { id: "island", name: "Privatinsel", icon: "🏝️", cost: 25000000, rigSlots: 30, taxHaven: 0.5, desc: "-50% Steuern/Gebühren, maximale Rig-Stellplätze." },
];

const LUXURY_ITEMS = [
  { id: "sportwagen", name: "Sportwagen", icon: "🏎️", cost: 50000, desc: "Schaltet VIP-Events mit Insider-Tipps frei.", vip: true },
  { id: "privatjet", name: "Privatjet", icon: "✈️", cost: 500000, desc: "Mehr VIP-Events, hebt dein Ansehen enorm.", vip: true },
  { id: "designeranzug", name: "Designer-Anzug", icon: "🕴️", cost: 20000, desc: "+15% Follower-Zuwachs pro Post.", followerBonus: 0.15 },
  { id: "luxusuhr", name: "Luxus-Uhr", icon: "⌚", cost: 40000, desc: "+10% Follower-Zuwachs pro Post.", followerBonus: 0.10 },
  { id: "yacht", name: "Yacht", icon: "🛥️", cost: 3000000, desc: "Networking-Hub — zieht Investoren mit Kapitalspritzen an.", networking: true },
];

// Mining Rigs
const RIG_TYPES = [
  { id: "gpu_basic", name: "Einsteiger-GPU", icon: "🎮", cost: 500, coinsPerSec: 0.02, powerKw: 0.3, scaling: 1.15 },
  { id: "gpu_pro", name: "Profi-GPU-Rig", icon: "🖥️", cost: 5000, coinsPerSec: 0.15, powerKw: 1.2, scaling: 1.16 },
  { id: "server_rack", name: "Server-Rack", icon: "🗄️", cost: 40000, coinsPerSec: 1.0, powerKw: 6, scaling: 1.17 },
  { id: "datacenter", name: "Mini-Rechenzentrum", icon: "🏭", cost: 300000, coinsPerSec: 6.0, powerKw: 30, scaling: 1.18 },
];
const COIN_PRICE_BASE = 40; // € pro Coin, schwankt leicht

// Level / Rang System (nach Vermögen)
const RANKS = [
  { min: 0, name: "Groschen-Trader" },
  { min: 10000, name: "Feierabend-Investor" },
  { min: 50000, name: "Börsen-Neuling" },
  { min: 200000, name: "Aktien-Profi" },
  { min: 1000000, name: "Hedgefonds-Manager" },
  { min: 5000000, name: "Wall-Street-Hai" },
  { min: 20000000, name: "Milliardärs-Konzern" },
  { min: 100000000, name: "Wall-Street-Tycoon" },
];
function rankFor(netWorth) {
  let r = RANKS[0];
  for (const rk of RANKS) if (netWorth >= rk.min) r = rk;
  return r;
}
function levelFor(netWorth) {
  // Level 1-10+ grob anhand Vermögens-Schwellen (für requiresLevel-Gates)
  const thresholds = [0, 5000, 20000, 75000, 250000, 750000, 2000000, 6000000, 15000000, 40000000, 100000000];
  let lvl = 1;
  for (let i = 0; i < thresholds.length; i++) if (netWorth >= thresholds[i]) lvl = i + 1;
  return lvl;
}

// Inbox / Chat-Nachrichten-Vorlagen (Multiple-Choice)
const INBOX_TEMPLATES = [
  {
    from: "🧔 Mentor Klaus", subject: "Willkommen an der Börse!",
    text: "Hey, ich bin dein Mentor. Ein Tipp zum Start: Kaufe nie alles auf eine Karte. Diversifiziere dein Portfolio!",
    options: [
      { label: "Danke für den Tipp!", effect: { trust: 5 } },
      { label: "Ich weiß, was ich tue.", effect: { trust: -2 } },
    ],
  },
  {
    from: "💰 Gieriger Investor", subject: "Schnelles Geld gefällig?",
    text: "Ich habe eine 'todsichere' Aktie für dich. Investier 50% deines Vermögens sofort!",
    options: [
      { label: "Klingt seriös, ich mach's.", effect: { cash: -0.15, message: "Es war ein Betrug... 😱" } },
      { label: "Klingt nach Betrug. Nein danke.", effect: { trust: 3 } },
    ],
  },
  {
    from: "👾 Krypto-Dev", subject: "Neuer Coin-Launch",
    text: "Wir launchen bald einen neuen Coin. Willst du früh dabei sein?",
    options: [
      { label: "Ja, zeig mir mehr!", effect: { hype: 10 } },
      { label: "Nein, zu riskant.", effect: {} },
    ],
  },
  {
    from: "😏 Neidischer Konkurrent", subject: "Du wirst scheitern.",
    text: "Glaub bloß nicht, dass du lange an der Spitze bleibst. Ich mach dich fertig!",
    options: [
      { label: "Bring es auf 🔥", effect: { rivalHeat: 10 } },
      { label: "Ignorieren.", effect: {} },
    ],
  },
  {
    from: "🕵️ Informant 'Schatten'", subject: "Geheime Infos gefällig?",
    text: "Ich habe Insider-Wissen zu {company}. Interessiert?",
    options: [
      { label: "Zu den Informanten wechseln", effect: { openInformants: true } },
      { label: "Kein Interesse.", effect: {} },
    ],
  },
  {
    from: "🏢 Sponsor-Team", subject: "Werbe-Deal-Angebot!",
    text: "Du hast genug Reichweite! Wir bieten dir einen Werbedeal mit laufenden Einnahmen.",
    options: [
      { label: "Deal annehmen", effect: { sponsor: true } },
      { label: "Ablehnen", effect: {} },
    ],
    requiresFollowers: 10000,
  },
  {
    from: "🦈 Großinvestor", subject: "VIP-Kapitalangebot",
    text: "Wir geben dir 500.000 € Kapital. Dafür: bring den Kurs einer Aktie deiner Wahl in 3 Minuten um 20% nach oben.",
    options: [
      { label: "Deal annehmen", effect: { vipDeal: true } },
      { label: "Zu riskant, ablehnen.", effect: {} },
    ],
    requiresNetWorth: 300000,
  },
  {
    from: "⚖️ Finanzaufsicht", subject: "Warnung",
    text: "Uns ist aufgefallen, dass du auffällig oft dieselben Aktien pushst. Sei vorsichtig.",
    options: [
      { label: "Verstanden.", effect: {} },
    ],
  },
  {
    from: "🏢 " + "{company}" , subject: "Übernahmeangebot",
    text: "Sie besitzen einen großen Anteil an unserer Firma. Wollen Sie verkaufen oder weiter aufstocken?",
    options: [
      { label: "Ich bleibe investiert.", effect: {} },
      { label: "Anteile mit Prämie verkaufen.", effect: { sellStakeBonus: true } },
    ],
  },
];

// Informanten-Angebote (Insider-Deals)
const INFORMANT_OFFERS = [
  { text: "'{company} bringt in Kürze ein großes Update. Zahl 50.000 € für die Info.'", cost: 50000, secRisk: 12, fakeChance: 0.25, pct: [0.2, 0.45] },
  { text: "'{company} steht vor einem Skandal. Info für 30.000 €?'", cost: 30000, secRisk: 10, fakeChance: 0.3, pct: [-0.4, -0.15] },
  { text: "'Exklusiver Krypto-Tipp zu CryptoMoon — 20.000 € oder 400 Coins.'", cost: 20000, secRisk: 8, fakeChance: 0.35, pct: [0.15, 0.6], companies: ["cryptomoon"] },
];

// Rivalisierende KI-Trader
const RIVALS = [
  { id: "krypto_koenig", name: "Der Krypto-König", emoji: "👑", focus: "energie" },
  { id: "hedgefonds", name: "WallStreet-Hedgefonds", emoji: "🏦", focus: "tech" },
  { id: "meme_queen", name: "Meme-Queen", emoji: "👸", focus: "konsum" },
];

// PR-Interview Fragen
const INTERVIEW_QUESTIONS = [
  {
    q: "Wie sehen Sie die Zukunft des Marktes?",
    options: [
      { text: "Extrem optimistisch — alles wird explodieren! 🚀", hype: 8, trust: -2 },
      { text: "Vorsichtig optimistisch mit klarer Strategie.", hype: 4, trust: 5 },
      { text: "Ich bin ehrlich unsicher.", hype: 1, trust: 2 },
    ],
  },
  {
    q: "Ein Kritiker nennt Sie einen 'Marktmanipulator'. Ihre Antwort?",
    options: [
      { text: "Kein Kommentar.", hype: 2, trust: 1 },
      { text: "Absurd, ich handle immer fair und transparent.", hype: 5, trust: 4 },
      { text: "Neidische Konkurrenz eben. 😏", hype: 6, trust: -3 },
    ],
  },
  {
    q: "Was würden Sie neuen Investoren raten?",
    options: [
      { text: "Folgt mir und werdet reich!", hype: 9, trust: -4 },
      { text: "Diversifiziert und bleibt informiert.", hype: 3, trust: 6 },
      { text: "Nur investieren, was man verlieren kann.", hype: 2, trust: 7 },
    ],
  },
];

// Themes (Freischaltung nach Vermögen)
const THEMES = [
  { id: "default", name: "Dark Standard", requiresNetWorth: 0 },
  { id: "matrix", name: "Matrix-Green", requiresNetWorth: 500000 },
  { id: "cyberpunk", name: "Neon-Cyberpunk", requiresNetWorth: 3000000 },
  { id: "gold", name: "Gilded-Gold", requiresNetWorth: 20000000 },
];

const STARTING_CASH = 1000;
