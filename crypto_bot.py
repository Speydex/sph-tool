"""Krypto-Test-Bot: reine Simulation, kein echtes Konto, kein echtes Geld.

Holt den aktuellen Kurs von der oeffentlichen CoinGecko-API (kein Login),
baut sich daraus selbst eine Kurs-Historie auf (state/crypto_prices.json)
und entscheidet per SMA-Crossover-Strategie (strategy.py), ob virtuell
gekauft oder verkauft wird. Das virtuelle Depot steht in
state/crypto_portfolio.json - es fliesst nirgends echtes Geld.
"""
from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

import crypto_config as cfg
from price_feed import get_price
from strategy import Signal, compute_signal


def load_json(path: Path, default: Any) -> Any:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default


def save_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


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
    price = get_price(cfg.COIN_ID, cfg.VS_CURRENCY)

    history = load_json(cfg.PRICES_FILE, [])
    history.append(price)
    history = history[-cfg.MAX_HISTORY :]
    save_json(cfg.PRICES_FILE, history)

    portfolio = load_json(
        cfg.PORTFOLIO_FILE,
        {"usdt_balance": cfg.START_BALANCE, "coin_qty": 0.0, "in_position": False, "entry_price": 0.0},
    )

    signal = compute_signal(history, cfg.SMA_SHORT, cfg.SMA_LONG)
    print(
        f"{cfg.COIN_ID}: Kurs={price:.2f} {cfg.VS_CURRENCY}  Signal={signal.value}  "
        f"In Position={portfolio['in_position']}  Verlauf={len(history)} Werte"
    )

    if signal == Signal.BUY and not portfolio["in_position"]:
        coin_qty = portfolio["usdt_balance"] / price
        portfolio = {"usdt_balance": 0.0, "coin_qty": coin_qty, "in_position": True, "entry_price": price}
        msg = f"\U0001F7E2 (Simulation) Kauf {cfg.COIN_ID}: {coin_qty:.6f} bei ~{price:.2f} {cfg.VS_CURRENCY}"
        print(msg)
        notify(msg)

    elif signal == Signal.SELL and portfolio["in_position"]:
        usdt_balance = portfolio["coin_qty"] * price
        pnl_pct = (price / portfolio["entry_price"] - 1) * 100 if portfolio["entry_price"] else 0.0
        msg = (
            f"\U0001F534 (Simulation) Verkauf {cfg.COIN_ID}: {portfolio['coin_qty']:.6f} bei ~{price:.2f} "
            f"{cfg.VS_CURRENCY} ({pnl_pct:+.2f}% seit Kauf)"
        )
        portfolio = {"usdt_balance": usdt_balance, "coin_qty": 0.0, "in_position": False, "entry_price": 0.0}
        print(msg)
        notify(msg)

    else:
        print("  Keine Aktion.")

    total_value = portfolio["usdt_balance"] + portfolio["coin_qty"] * price
    print(f"  Virtuelles Depot: {total_value:.2f} {cfg.VS_CURRENCY} (Start: {cfg.START_BALANCE:.2f})")
    save_json(cfg.PORTFOLIO_FILE, portfolio)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
