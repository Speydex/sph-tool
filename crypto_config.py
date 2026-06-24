"""Konfiguration fuer den Krypto-Test-Bot (reine Simulation, kein Konto).

Es wird kein Boersen-Account benoetigt: Der Bot holt sich echte, aktuelle
Kurse von der oeffentlichen CoinGecko-API (kein Login, kein API-Key) und
simuliert Kauf/Verkauf nur lokal mit virtuellem Guthaben - es fliesst nie
echtes Geld.
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

PROJECT_DIR = Path(__file__).resolve().parent
load_dotenv(PROJECT_DIR / ".env")

# --- Handelsparameter ------------------------------------------------------
COIN_ID = os.getenv("CRYPTO_COIN_ID", "bitcoin")        # CoinGecko-ID, z.B. "bitcoin", "ethereum"
VS_CURRENCY = os.getenv("CRYPTO_VS_CURRENCY", "usd")
SMA_SHORT = int(os.getenv("CRYPTO_SMA_SHORT", "9"))
SMA_LONG = int(os.getenv("CRYPTO_SMA_LONG", "21"))
START_BALANCE = float(os.getenv("CRYPTO_START_BALANCE", "1000"))  # virtuelles Start-Guthaben

# --- Ordner / Status -------------------------------------------------------
STATE_DIR = PROJECT_DIR / "state"
STATE_DIR.mkdir(exist_ok=True)
PRICES_FILE = STATE_DIR / "crypto_prices.json"
PORTFOLIO_FILE = STATE_DIR / "crypto_portfolio.json"
MAX_HISTORY = SMA_LONG * 3  # genug Werte fuer die SMA-Berechnung, Rest verwerfen
