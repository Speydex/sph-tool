"""Krypto-Test-Trading-Bot: beobachtet den Kurs und kauft/verkauft automatisch
auf einem Bybit-Demo-Trading-Konto (virtuelles Geld, echte Marktpreise).

Strategie: SMA-Crossover (siehe strategy.py). Der Bot merkt sich seine
Position in state/crypto_position.json, damit er zwischen den Laeufen weiss,
ob er aktuell "im Markt" ist.

WICHTIG: Demo-/Lern-Tool. Keine Anlageberatung und keine Gewinngarantie -
echte Maerkte koennen sich jederzeit anders verhalten als die Strategie
erwartet.
"""
from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request

import crypto_config as cfg
from bybit_client import BybitClient
from strategy import Signal, compute_signal


def load_position() -> dict:
    if cfg.POSITION_FILE.exists():
        return json.loads(cfg.POSITION_FILE.read_text(encoding="utf-8"))
    return {"in_position": False, "qty": "0", "entry_price": 0.0}


def save_position(position: dict) -> None:
    cfg.POSITION_FILE.write_text(json.dumps(position, indent=2), encoding="utf-8")


def notify(text: str) -> None:
    phone = os.getenv("CALLMEBOT_PHONE", "").strip()
    apikey = os.getenv("CALLMEBOT_APIKEY", "").strip()
    if not phone or not apikey:
        return
    try:
        params = urllib.parse.urlencode({"phone": phone, "text": text, "apikey": apikey})
        url = f"https://api.callmebot.com/whatsapp.php?{params}"
        with urllib.request.urlopen(url, timeout=30) as resp:
            resp.read()
    except Exception as exc:  # noqa: BLE001
        print(f"  WhatsApp-Benachrichtigung fehlgeschlagen: {exc}")


def main() -> int:
    cfg.check_credentials()
    client = BybitClient(cfg.BYBIT_API_KEY, cfg.BYBIT_API_SECRET, cfg.BYBIT_BASE_URL)

    klines = client.get_klines(cfg.CATEGORY, cfg.SYMBOL, cfg.INTERVAL, limit=max(cfg.SMA_LONG * 2, 50))
    closes = [float(k[4]) for k in klines]
    last_price = closes[-1]

    signal = compute_signal(closes, cfg.SMA_SHORT, cfg.SMA_LONG)
    position = load_position()
    print(f"{cfg.SYMBOL}: Kurs={last_price:.2f}  Signal={signal.value}  In Position={position['in_position']}")

    if signal == Signal.BUY and not position["in_position"]:
        order = client.place_market_order(
            cfg.CATEGORY, cfg.SYMBOL, "Buy", cfg.TRADE_USDT_AMOUNT, market_unit="quoteCoin",
        )
        filled = client.get_order(cfg.CATEGORY, order["orderId"])
        qty = filled.get("cumExecQty", "0")
        position = {"in_position": True, "qty": qty, "entry_price": last_price}
        save_position(position)
        msg = f"\U0001F7E2 Kauf {cfg.SYMBOL}: {qty} bei ~{last_price:.2f} (Demo-Konto)"
        print(msg)
        notify(msg)

    elif signal == Signal.SELL and position["in_position"]:
        qty = position["qty"]
        client.place_market_order(cfg.CATEGORY, cfg.SYMBOL, "Sell", qty, market_unit="baseCoin")
        pnl_pct = (last_price / position["entry_price"] - 1) * 100 if position["entry_price"] else 0.0
        msg = (
            f"\U0001F534 Verkauf {cfg.SYMBOL}: {qty} bei ~{last_price:.2f} "
            f"(Demo-Konto, {pnl_pct:+.2f}% seit Kauf)"
        )
        position = {"in_position": False, "qty": "0", "entry_price": 0.0}
        save_position(position)
        print(msg)
        notify(msg)

    else:
        print("  Keine Aktion (Signal passt nicht zur aktuellen Position).")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
