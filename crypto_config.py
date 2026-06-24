"""Konfiguration fuer den Krypto-Test-Trading-Bot (Bybit Demo-Trading).

Ein Demo-Trading-Konto gibt es kostenlos im Bybit-Dashboard (Umschalter oben
rechts "Demo Trading"). Dort einen eigenen API-Key erzeugen - dieser
funktioniert NUR fuer das Demo-Konto (virtuelles Geld), nicht fuer echtes Geld.
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

PROJECT_DIR = Path(__file__).resolve().parent
load_dotenv(PROJECT_DIR / ".env")

# --- Zugangsdaten (aus .env / GitHub Secrets) -----------------------------
BYBIT_API_KEY = os.getenv("BYBIT_API_KEY", "")
BYBIT_API_SECRET = os.getenv("BYBIT_API_SECRET", "")
BYBIT_BASE_URL = os.getenv("BYBIT_BASE_URL", "https://api-demo.bybit.com")

# --- Handelsparameter ------------------------------------------------------
SYMBOL = os.getenv("CRYPTO_SYMBOL", "BTCUSDT")
CATEGORY = "spot"
INTERVAL = os.getenv("CRYPTO_INTERVAL", "15")            # Kerzengroesse in Minuten
SMA_SHORT = int(os.getenv("CRYPTO_SMA_SHORT", "9"))
SMA_LONG = int(os.getenv("CRYPTO_SMA_LONG", "21"))
TRADE_USDT_AMOUNT = os.getenv("CRYPTO_TRADE_USDT", "20")  # Einsatz (USDT) pro Kauf

# --- Ordner / Status -------------------------------------------------------
STATE_DIR = PROJECT_DIR / "state"
STATE_DIR.mkdir(exist_ok=True)
POSITION_FILE = STATE_DIR / "crypto_position.json"


def check_credentials() -> None:
    missing = [k for k, v in {"BYBIT_API_KEY": BYBIT_API_KEY, "BYBIT_API_SECRET": BYBIT_API_SECRET}.items() if not v]
    if missing:
        raise SystemExit(
            "Fehlende Bybit-Zugangsdaten: " + ", ".join(missing) + "\n"
            "-> Demo-Trading-API-Key im Bybit-Dashboard erzeugen und in .env eintragen."
        )
