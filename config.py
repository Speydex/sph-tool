"""Zentrale Konfiguration fuer das Schulportal-Hessen-Tool.

Alle URLs und CSS-Selektoren liegen hier gesammelt, damit du sie an einer
Stelle anpassen kannst, falls das Schulportal sein HTML aendert.
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# .env laden (liegt im selben Ordner wie diese Datei)
PROJECT_DIR = Path(__file__).resolve().parent
load_dotenv(PROJECT_DIR / ".env")

# --- Zugangsdaten (aus .env) ---------------------------------------------
USERNAME = os.getenv("SPH_USERNAME", "")
PASSWORD = os.getenv("SPH_PASSWORD", "")
SCHOOL_ID = os.getenv("SPH_SCHOOL_ID", "6105")

# --- URLs ----------------------------------------------------------------
LOGIN_URL = f"https://login.schulportal.hessen.de/?i={SCHOOL_ID}"
START_URL = "https://start.schulportal.hessen.de/"
MEIN_UNTERRICHT_URL = "https://start.schulportal.hessen.de/meinunterricht.php"

# Wenn die URL nach Login eine dieser Domains enthaelt, gilt Login als OK.
LOGGED_IN_HOST = "start.schulportal.hessen.de"

# --- Login-Selektoren ----------------------------------------------------
# Das Schulportal hat im Laufe der Zeit verschiedene Feldnamen genutzt.
# Wir probieren mehrere Kandidaten der Reihe nach durch (erster Treffer zaehlt).
# Verifiziert gegen die echte Login-Seite (login.schulportal.hessen.de):
# sichtbares Benutzerfeld = #username2 (name=user2), Passwort = #inputPassword,
# Anmelden-Button = #tlogin.
USERNAME_SELECTORS = [
    "#username2",
    "input[name='user2']",
    "#username",
    "input[name='username']",
]
PASSWORD_SELECTORS = [
    "#inputPassword",
    "input[name='password']",
    "input[type='password']",
]
SUBMIT_SELECTORS = [
    "#tlogin",
    "button[type='submit']",
    "input[type='submit']",
    "button:has-text('Anmelden')",
]
# Checkbox "angemeldet bleiben" -> laengere Session, weniger Re-Logins.
STAY_CONNECTED_SELECTOR = "#stayconnected"

# Auf einer eingeloggten SPH-Seite gibt es einen Logout-Link. Das nutzen wir
# als zuverlaessigen "bin ich eingeloggt?"-Indikator.
LOGGED_IN_MARKER = "a[href*='logout']"

# --- Ordner --------------------------------------------------------------
OUTPUT_DIR = PROJECT_DIR / "output"
DEBUG_DIR = PROJECT_DIR / "debug"
DOWNLOAD_DIR = PROJECT_DIR / "downloads"
STATE_DIR = PROJECT_DIR / "state"        # merkt sich, was schon gemeldet wurde
STORAGE_STATE = PROJECT_DIR / "storage_state.json"
SIGNATURE_FILE = STATE_DIR / "last_signature.txt"

for _d in (OUTPUT_DIR, DEBUG_DIR, DOWNLOAD_DIR, STATE_DIR):
    _d.mkdir(exist_ok=True)


def check_credentials() -> None:
    """Bricht mit klarer Meldung ab, wenn .env nicht ausgefuellt ist."""
    missing = [k for k, v in {"SPH_USERNAME": USERNAME, "SPH_PASSWORD": PASSWORD}.items() if not v]
    if missing:
        raise SystemExit(
            "Fehlende Zugangsdaten: " + ", ".join(missing) + "\n"
            "-> Kopiere .env.example zu .env und trage deine Daten ein."
        )
