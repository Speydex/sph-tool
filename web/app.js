const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const REVERSE_GEOCODING_URL = "https://api.bigdatacloud.net/data/reverse-geocode-client";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

const WEATHER_CODES = {
  0: ["Klarer Himmel", "☀️"],
  1: ["Ueberwiegend klar", "🌤️"],
  2: ["Teilweise bewoelkt", "⛅"],
  3: ["Bedeckt", "☁️"],
  45: ["Nebel", "🌫️"],
  48: ["Reifnebel", "🌫️"],
  51: ["Leichter Nieselregen", "🌦️"],
  53: ["Nieselregen", "🌦️"],
  55: ["Starker Nieselregen", "🌧️"],
  56: ["Leichter gefrierender Nieselregen", "🌧️"],
  57: ["Starker gefrierender Nieselregen", "🌧️"],
  61: ["Leichter Regen", "🌦️"],
  63: ["Regen", "🌧️"],
  65: ["Starker Regen", "🌧️"],
  66: ["Leichter gefrierender Regen", "🌧️"],
  67: ["Starker gefrierender Regen", "🌧️"],
  71: ["Leichter Schneefall", "🌨️"],
  73: ["Schneefall", "🌨️"],
  75: ["Starker Schneefall", "❄️"],
  77: ["Schneegriesel", "❄️"],
  80: ["Leichte Regenschauer", "🌦️"],
  81: ["Regenschauer", "🌧️"],
  82: ["Heftige Regenschauer", "⛈️"],
  85: ["Leichte Schneeschauer", "🌨️"],
  86: ["Starke Schneeschauer", "❄️"],
  95: ["Gewitter", "⛈️"],
  96: ["Gewitter mit leichtem Hagel", "⛈️"],
  99: ["Gewitter mit starkem Hagel", "⛈️"],
};

const WOCHENTAGE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function beschreibung(code) {
  return WEATHER_CODES[code] || ["Unbekannt", "❓"];
}

async function suche_ort(query) {
  const url = new URL(GEOCODING_URL);
  url.searchParams.set("name", query);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "de");
  url.searchParams.set("format", "json");

  const resp = await fetch(url);
  if (!resp.ok) throw new Error("Geocoding fehlgeschlagen");
  const data = await resp.json();
  if (!data.results || data.results.length === 0) {
    throw new Error(`Kein Ort gefunden für "${query}".`);
  }
  const o = data.results[0];
  return { name: o.name, land: o.country || "", lat: o.latitude, lon: o.longitude };
}

async function ort_von_koordinaten(lat, lon) {
  const url = new URL(REVERSE_GEOCODING_URL);
  url.searchParams.set("latitude", lat);
  url.searchParams.set("longitude", lon);
  url.searchParams.set("localityLanguage", "de");

  const resp = await fetch(url);
  if (!resp.ok) throw new Error("Standort konnte nicht aufgelöst werden");
  const data = await resp.json();
  const name = data.city || data.locality || data.principalSubdivision || "Mein Standort";
  return { name, land: data.countryName || "", lat, lon };
}

async function hole_wetter(ort) {
  const url = new URL(FORECAST_URL);
  url.searchParams.set("latitude", ort.lat);
  url.searchParams.set("longitude", ort.lon);
  url.searchParams.set(
    "current",
    "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m"
  );
  url.searchParams.set(
    "daily",
    "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"
  );
  url.searchParams.set(
    "hourly",
    "temperature_2m,weather_code,precipitation_probability"
  );
  url.searchParams.set("forecast_days", "5");
  url.searchParams.set("timezone", "auto");

  const resp = await fetch(url);
  if (!resp.ok) throw new Error("Wetterdaten konnten nicht geladen werden");
  return resp.json();
}

function zeige_wetter(ort, daten) {
  const aktuell = daten.current;
  const [desc, icon] = beschreibung(aktuell.weather_code);

  document.getElementById("ort-name").textContent = `${ort.name}, ${ort.land}`;
  document.getElementById("aktuell-icon").textContent = icon;
  document.getElementById("aktuell-temp").textContent = `${Math.round(aktuell.temperature_2m)}°C`;
  document.getElementById("aktuell-desc").textContent = desc;
  document.getElementById("aktuell-gefuehlt").textContent =
    `Gefühlt: ${Math.round(aktuell.apparent_temperature)}°C`;
  document.getElementById("aktuell-feuchte").textContent =
    `Feuchte: ${Math.round(aktuell.relative_humidity_2m)}%`;
  document.getElementById("aktuell-wind").textContent =
    `Wind: ${Math.round(aktuell.wind_speed_10m)} km/h`;

  const vorhersage = document.getElementById("vorhersage");
  vorhersage.innerHTML = "";
  const tage = daten.daily;
  const stunden = daten.hourly;

  for (let i = 0; i < tage.time.length; i++) {
    const datum = new Date(tage.time[i] + "T00:00:00");
    const wt = WOCHENTAGE[datum.getDay()];
    const [dDesc, dIcon] = beschreibung(tage.weather_code[i]);
    const tmax = Math.round(tage.temperature_2m_max[i]);
    const tmin = Math.round(tage.temperature_2m_min[i]);
    const regen = Math.round(tage.precipitation_probability_max[i]);

    const zeile = document.createElement("button");
    zeile.type = "button";
    zeile.className = "tag-zeile";
    zeile.setAttribute("aria-expanded", "false");
    zeile.innerHTML = `
      <span class="wochentag">${wt}</span>
      <span class="icon" title="${dDesc}">${dIcon}</span>
      <span class="temps">${tmin}° – ${tmax}°</span>
      <span class="regen">☔ ${regen}%</span>
      <span class="pfeil">▾</span>
    `;

    const stundenPanel = document.createElement("div");
    stundenPanel.className = "stunden-panel";
    stundenPanel.hidden = true;
    stundenPanel.appendChild(baue_stunden_panel(stunden, i));

    zeile.addEventListener("click", () => {
      const offen = zeile.getAttribute("aria-expanded") === "true";
      zeile.setAttribute("aria-expanded", String(!offen));
      stundenPanel.hidden = offen;
    });

    vorhersage.appendChild(zeile);
    vorhersage.appendChild(stundenPanel);
  }

  document.getElementById("ergebnis").hidden = false;
}

function baue_stunden_panel(stunden, tagIndex) {
  const start = tagIndex * 24;
  const container = document.createElement("div");
  container.className = "stunden-liste";

  for (let h = start; h < start + 24; h++) {
    if (!stunden.time[h]) continue;
    const uhrzeit = stunden.time[h].slice(11, 16);
    const [desc, icon] = beschreibung(stunden.weather_code[h]);
    const temp = Math.round(stunden.temperature_2m[h]);
    const regen = Math.round(stunden.precipitation_probability[h]);

    const zeile = document.createElement("div");
    zeile.className = "stunde-zeile";
    zeile.innerHTML = `
      <span class="uhrzeit">${uhrzeit}</span>
      <span class="icon" title="${desc}">${icon}</span>
      <span class="stunde-temp">${temp}°C</span>
      <span class="regen">☔ ${regen}%</span>
    `;
    container.appendChild(zeile);
  }
  return container;
}

const ORTE_SCHLUESSEL = "myweather-orte";
const AKTIV_SCHLUESSEL = "myweather-aktiver-index";

let orte = orte_laden();
let aktiverIndex = Number(localStorage.getItem(AKTIV_SCHLUESSEL)) || 0;

function orte_laden() {
  try {
    return JSON.parse(localStorage.getItem(ORTE_SCHLUESSEL)) || [];
  } catch {
    return [];
  }
}

function orte_speichern() {
  localStorage.setItem(ORTE_SCHLUESSEL, JSON.stringify(orte));
  localStorage.setItem(AKTIV_SCHLUESSEL, String(aktiverIndex));
}

function render_tabs() {
  const leiste = document.getElementById("tab-leiste");
  leiste.innerHTML = "";

  orte.forEach((ort, i) => {
    const wrapper = document.createElement("div");
    wrapper.className = "tab-wrapper" + (i === aktiverIndex ? " tab-aktiv" : "");

    const auswahl = document.createElement("button");
    auswahl.type = "button";
    auswahl.className = "tab-select";
    auswahl.textContent = ort.name;
    auswahl.addEventListener("click", () => tab_anzeigen(i));

    const schliessen = document.createElement("button");
    schliessen.type = "button";
    schliessen.className = "tab-close";
    schliessen.textContent = "×";
    schliessen.title = "Tab schließen";
    schliessen.addEventListener("click", (e) => {
      e.stopPropagation();
      tab_schliessen(i);
    });

    wrapper.appendChild(auswahl);
    wrapper.appendChild(schliessen);
    leiste.appendChild(wrapper);
  });

  const neuerTab = document.createElement("button");
  neuerTab.type = "button";
  neuerTab.className = "tab tab-neu";
  neuerTab.textContent = "+";
  neuerTab.title = "Weiteren Ort hinzufügen";
  neuerTab.addEventListener("click", () => {
    const eingabe = document.getElementById("ort-eingabe");
    eingabe.value = "";
    eingabe.focus();
  });
  leiste.appendChild(neuerTab);
}

async function tab_anzeigen(index) {
  aktiverIndex = index;
  orte_speichern();
  render_tabs();

  const status = document.getElementById("status");
  document.getElementById("ergebnis").hidden = true;
  status.textContent = "Lade …";
  try {
    const daten = await hole_wetter(orte[index]);
    zeige_wetter(orte[index], daten);
    status.textContent = "";
  } catch (err) {
    status.textContent = err.message;
  }
}

function tab_schliessen(i) {
  orte.splice(i, 1);

  if (orte.length === 0) {
    aktiverIndex = 0;
    orte_speichern();
    render_tabs();
    document.getElementById("ergebnis").hidden = true;
    document.getElementById("status").textContent =
      'Noch keine Orte – klicke auf "+", um einen hinzuzufügen.';
    return;
  }

  if (i < aktiverIndex) {
    aktiverIndex--;
  } else if (aktiverIndex >= orte.length) {
    aktiverIndex = orte.length - 1;
  }
  tab_anzeigen(aktiverIndex);
}

// Ladet Wetterdaten fuer `ort`, legt dafuer einen Tab an (oder aktiviert den
// bestehenden) und zeigt das Ergebnis an. Gemeinsame Logik fuer Textsuche
// und Standort-Erkennung.
async function ort_anzeigen_und_speichern(ort) {
  const daten = await hole_wetter(ort);

  const vorhandenerIndex = orte.findIndex(
    (o) => o.name === ort.name && o.land === ort.land
  );
  if (vorhandenerIndex === -1) {
    orte.push(ort);
    aktiverIndex = orte.length - 1;
  } else {
    aktiverIndex = vorhandenerIndex;
  }
  orte_speichern();
  render_tabs();

  zeige_wetter(ort, daten);
}

async function suche(query) {
  const status = document.getElementById("status");
  document.getElementById("ergebnis").hidden = true;
  status.textContent = "Lade …";
  try {
    const ort = await suche_ort(query);
    await ort_anzeigen_und_speichern(ort);
    status.textContent = "";
  } catch (err) {
    status.textContent = err.message;
  }
}

function standort_verwenden() {
  const status = document.getElementById("status");

  if (!navigator.geolocation) {
    status.textContent = "Geolocation wird von diesem Browser nicht unterstützt.";
    return;
  }

  document.getElementById("ergebnis").hidden = true;
  status.textContent = "Standort wird ermittelt …";

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      try {
        status.textContent = "Lade …";
        const ort = await ort_von_koordinaten(
          position.coords.latitude,
          position.coords.longitude
        );
        await ort_anzeigen_und_speichern(ort);
        status.textContent = "";
      } catch (err) {
        status.textContent = err.message;
      }
    },
    () => {
      status.textContent =
        "Standort konnte nicht ermittelt werden. Bitte Berechtigung erteilen.";
    },
    { timeout: 10000 }
  );
}

document.getElementById("suchform").addEventListener("submit", (e) => {
  e.preventDefault();
  const query = document.getElementById("ort-eingabe").value.trim();
  if (query) suche(query);
});

document.getElementById("standort-btn").addEventListener("click", standort_verwenden);

// Gespeicherte Orte wiederherstellen, sonst Berlin als Standard anlegen.
if (orte.length > 0) {
  if (aktiverIndex >= orte.length) aktiverIndex = 0;
  render_tabs();
  tab_anzeigen(aktiverIndex);
} else {
  suche("Berlin");
}
