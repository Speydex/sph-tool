"""Einfache SMA-Crossover-Strategie fuer den Krypto-Test-Bot.

Kurzer gleitender Durchschnitt kreuzt den langen nach oben  -> Kaufsignal
(Aufwaertstrend beginnt). Kreuzt er nach unten -> Verkaufssignal. Sonst:
abwarten. Das ist eine klassische, gut nachvollziehbare Trend-Strategie.
"""
from __future__ import annotations

from enum import Enum


class Signal(str, Enum):
    BUY = "BUY"
    SELL = "SELL"
    HOLD = "HOLD"


def sma(values: list[float], length: int) -> float:
    window = values[-length:]
    return sum(window) / len(window)


def compute_signal(closes: list[float], short_len: int, long_len: int) -> Signal:
    """Erwartet abgeschlossene Schlusskurse, aeltester -> neuester Wert zuletzt."""
    if len(closes) < long_len + 1:
        return Signal.HOLD

    short_now = sma(closes, short_len)
    long_now = sma(closes, long_len)
    short_prev = sma(closes[:-1], short_len)
    long_prev = sma(closes[:-1], long_len)

    crossed_up = short_prev <= long_prev and short_now > long_now
    crossed_down = short_prev >= long_prev and short_now < long_now

    if crossed_up:
        return Signal.BUY
    if crossed_down:
        return Signal.SELL
    return Signal.HOLD
