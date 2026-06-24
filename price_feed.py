"""Holt aktuelle Krypto-Kurse von der oeffentlichen CoinGecko-API.

Kein Account, kein API-Key, kein Login noetig - einfach ein oeffentlicher
Preis-Endpunkt.
"""
from __future__ import annotations

import json
import urllib.parse
import urllib.request

API_URL = "https://api.coingecko.com/api/v3/simple/price"


def get_price(coin_id: str, vs_currency: str = "usd") -> float:
    params = urllib.parse.urlencode({"ids": coin_id, "vs_currencies": vs_currency})
    url = f"{API_URL}?{params}"
    with urllib.request.urlopen(url, timeout=30) as resp:
        data = json.loads(resp.read().decode())
    return float(data[coin_id][vs_currency])
