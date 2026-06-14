"""Schickt eine WhatsApp-Nachricht ueber CallMeBot, wenn offene Hausaufgaben
vorliegen.

Liest das Ergebnis aus output/offen_status.json (von offene_aufgaben.py erzeugt)
und die Zugangsdaten fuer CallMeBot aus Umgebungsvariablen:

    CALLMEBOT_PHONE   z.B. 4915112345678   (Landesvorwahl, ohne + und ohne 0)
    CALLMEBOT_APIKEY  der Schluessel, den du per WhatsApp von CallMeBot bekommst

Sendet NUR, wenn es offene Hausaufgaben gibt (kein Spam bei 0).
Read-only: meldet, was offen ist - loest nichts.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request

import config

STATUS_FILE = config.OUTPUT_DIR / "offen_status.json"


def send_whatsapp(phone: str, apikey: str, text: str) -> None:
    params = urllib.parse.urlencode({"phone": phone, "text": text, "apikey": apikey})
    url = f"https://api.callmebot.com/whatsapp.php?{params}"
    with urllib.request.urlopen(url, timeout=30) as resp:
        body = resp.read().decode("utf-8", errors="replace")
        print(f"  CallMeBot-Antwort: {body[:200]}")


def build_message(status: dict) -> str:
    n = status.get("anzahl_offen", 0)
    zeilen = [f"\U0001F4DA Offene Hausaufgaben: {n}"]
    for a in status.get("offen", []):
        ha = (a.get("hausaufgabe") or "").strip()
        if len(ha) > 120:
            ha = ha[:117] + "..."
        zeilen.append(f"- {a.get('kurs','')}: {ha}")
    zeilen.append(f"(Stand: {status.get('zeitpunkt','')})")
    return "\n".join(zeilen)


def main() -> int:
    phone = os.getenv("CALLMEBOT_PHONE", "").strip()
    apikey = os.getenv("CALLMEBOT_APIKEY", "").strip()
    if not phone or not apikey:
        print("Keine CallMeBot-Daten (CALLMEBOT_PHONE / CALLMEBOT_APIKEY) gesetzt.")
        return 1

    if not STATUS_FILE.exists():
        print(f"Keine Status-Datei gefunden: {STATUS_FILE}")
        return 1

    status = json.loads(STATUS_FILE.read_text(encoding="utf-8"))
    n = int(status.get("anzahl_offen", 0))

    if n <= 0:
        print("Keine offenen Hausaufgaben - keine WhatsApp noetig.")
        return 0

    msg = build_message(status)
    print("Sende WhatsApp ...")
    try:
        send_whatsapp(phone, apikey, msg)
        print("Gesendet.")
    except Exception as exc:  # noqa: BLE001
        print(f"FEHLER beim Senden: {exc}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
