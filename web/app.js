const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
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
  for (let i = 0; i < tage.time.length; i++) {
    const datum = new Date(tage.time[i] + "T00:00:00");
    const wt = WOCHENTAGE[datum.getDay()];
    const [dDesc, dIcon] = beschreibung(tage.weather_code[i]);
    const tmax = Math.round(tage.temperature_2m_max[i]);
    const tmin = Math.round(tage.temperature_2m_min[i]);
    const regen = Math.round(tage.precipitation_probability_max[i]);

    const zeile = document.createElement("div");
    zeile.className = "tag-zeile";
    zeile.innerHTML = `
      <span class="wochentag">${wt}</span>
      <span class="icon" title="${dDesc}">${dIcon}</span>
      <span class="temps">${tmin}° – ${tmax}°</span>
      <span class="regen">☔ ${regen}%</span>
    `;
    vorhersage.appendChild(zeile);
  }

  document.getElementById("ergebnis").hidden = false;
}

async function suche(query) {
  const status = document.getElementById("status");
  document.getElementById("ergebnis").hidden = true;
  status.textContent = "Lade …";
  try {
    const ort = await suche_ort(query);
    const daten = await hole_wetter(ort);
    zeige_wetter(ort, daten);
    status.textContent = "";
  } catch (err) {
    status.textContent = err.message;
  }
}

document.getElementById("suchform").addEventListener("submit", (e) => {
  e.preventDefault();
  const query = document.getElementById("ort-eingabe").value.trim();
  if (query) suche(query);
});

// Beim Laden direkt einen Standardort anzeigen.
suche("Berlin");
