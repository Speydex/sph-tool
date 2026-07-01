"""Eigenstaendige Wetter-App (CLI).

Zeigt aktuelles Wetter + 3-Tage-Vorhersage fuer einen Ort an. Nutzt die
kostenlose Open-Meteo-API (https://open-meteo.com) - kein API-Key noetig.

Aufruf:
    python wetter.py Berlin
    python wetter.py "Frankfurt am Main"
    python wetter.py --tage 5 Muenchen
"""
from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass

import requests

GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

# WMO-Wettercode -> (Beschreibung, Icon)
# Quelle: https://open-meteo.com/en/docs (WMO Weather interpretation codes)
WEATHER_CODES: dict[int, tuple[str, str]] = {
    0: ("Klarer Himmel", "☀️"),
    1: ("Ueberwiegend klar", "🌤️"),
    2: ("Teilweise bewoelkt", "⛅"),
    3: ("Bedeckt", "☁️"),
    45: ("Nebel", "🌫️"),
    48: ("Reifnebel", "🌫️"),
    51: ("Leichter Nieselregen", "🌦️"),
    53: ("Nieselregen", "🌦️"),
    55: ("Starker Nieselregen", "🌧️"),
    56: ("Leichter gefrierender Nieselregen", "🌧️"),
    57: ("Starker gefrierender Nieselregen", "🌧️"),
    61: ("Leichter Regen", "🌦️"),
    63: ("Regen", "🌧️"),
    65: ("Starker Regen", "🌧️"),
    66: ("Leichter gefrierender Regen", "🌧️"),
    67: ("Starker gefrierender Regen", "🌧️"),
    71: ("Leichter Schneefall", "🌨️"),
    73: ("Schneefall", "🌨️"),
    75: ("Starker Schneefall", "❄️"),
    77: ("Schneegriesel", "❄️"),
    80: ("Leichte Regenschauer", "🌦️"),
    81: ("Regenschauer", "🌧️"),
    82: ("Heftige Regenschauer", "⛈️"),
    85: ("Leichte Schneeschauer", "🌨️"),
    86: ("Starke Schneeschauer", "❄️"),
    95: ("Gewitter", "⛈️"),
    96: ("Gewitter mit leichtem Hagel", "⛈️"),
    99: ("Gewitter mit starkem Hagel", "⛈️"),
}

WOCHENTAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]


@dataclass
class Ort:
    name: str
    land: str
    breitengrad: float
    laengengrad: float


def beschreibung(code: int) -> tuple[str, str]:
    return WEATHER_CODES.get(code, ("Unbekannt", "❓"))


def suche_ort(query: str) -> Ort:
    resp = requests.get(
        GEOCODING_URL,
        params={"name": query, "count": 1, "language": "de", "format": "json"},
        timeout=10,
    )
    resp.raise_for_status()
    treffer = resp.json().get("results")
    if not treffer:
        raise SystemExit(f"Kein Ort gefunden fuer '{query}'.")
    o = treffer[0]
    land = o.get("country", "")
    return Ort(name=o["name"], land=land, breitengrad=o["latitude"], laengengrad=o["longitude"])


def hole_wetter(ort: Ort, tage: int) -> dict:
    resp = requests.get(
        FORECAST_URL,
        params={
            "latitude": ort.breitengrad,
            "longitude": ort.laengengrad,
            "current": "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m",
            "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
            "forecast_days": max(1, min(tage, 16)),
            "timezone": "auto",
        },
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()


def formatiere_wochentag(datum: str) -> str:
    jahr, monat, tag = (int(x) for x in datum.split("-"))
    import datetime

    return WOCHENTAGE[datetime.date(jahr, monat, tag).weekday()]


def zeige_wetter(ort: Ort, daten: dict, tage: int) -> None:
    aktuell = daten["current"]
    desc, icon = beschreibung(aktuell["weather_code"])

    print(f"\n{icon}  Wetter in {ort.name}, {ort.land}\n" + "-" * 40)
    print(f"Aktuell:      {aktuell['temperature_2m']:.0f}°C ({desc})")
    print(f"Gefuehlt:     {aktuell['apparent_temperature']:.0f}°C")
    print(f"Luftfeuchte:  {aktuell['relative_humidity_2m']:.0f}%")
    print(f"Wind:         {aktuell['wind_speed_10m']:.0f} km/h")

    print(f"\nVorhersage ({tage} Tage):\n" + "-" * 40)
    tagesdaten = daten["daily"]
    for i in range(min(tage, len(tagesdaten["time"]))):
        datum = tagesdaten["time"][i]
        wt = formatiere_wochentag(datum)
        d_desc, d_icon = beschreibung(tagesdaten["weather_code"][i])
        tmax = tagesdaten["temperature_2m_max"][i]
        tmin = tagesdaten["temperature_2m_min"][i]
        regen = tagesdaten["precipitation_probability_max"][i]
        print(f"{wt} {datum}  {d_icon} {d_desc:<22} {tmin:.0f}°C - {tmax:.0f}°C  Regen: {regen:.0f}%")
    print()


def main() -> int:
    parser = argparse.ArgumentParser(description="Zeigt aktuelles Wetter + Vorhersage fuer einen Ort.")
    parser.add_argument("ort", nargs="+", help="Ortsname, z.B. Berlin oder 'Frankfurt am Main'")
    parser.add_argument("--tage", type=int, default=3, help="Anzahl Vorhersagetage (Standard: 3, max. 16)")
    args = parser.parse_args()

    query = " ".join(args.ort)

    try:
        ort = suche_ort(query)
        daten = hole_wetter(ort, args.tage)
    except requests.RequestException as exc:
        print(f"Fehler beim Abrufen der Wetterdaten: {exc}", file=sys.stderr)
        return 1

    zeige_wetter(ort, daten, args.tage)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
