"""Schickt eine WhatsApp (CallMeBot) mit offenen Hausaufgaben + Vertretungsplan.

Liest output/offen_status.json (von offene_aufgaben.py) und die CallMeBot-Daten
aus den Umgebungsvariablen:

    CALLMEBOT_PHONE   z.B. 4915112345678   (Landesvorwahl, ohne + und ohne 0)
    CALLMEBOT_APIKEY  Schluessel von CallMeBot

Anti-Spam: Da 3x taeglich geprueft wird, merkt sich das Skript in
state/last_signature.txt, was zuletzt gemeldet wurde, und schickt nur bei
AENDERUNG erneut eine Nachricht. Ist nichts (Neues) da, passiert nichts.

Read-only: meldet nur, loest/aendert nichts.
"""
from __future__ import annotations

import hashlib
import json
import os
import urllib.parse
import urllib.request

import config

STATUS_FILE = config.OUTPUT_DIR / "offen_status.json"


def send_whatsapp(phone: str, apikey: str, text: str) -> None:
    params = urllib.parse.urlencode({"phone": phone, "text": text, "apikey": apikey})
    url = f"https://api.callmebot.com/whatsapp.php?{params}"
    with urllib.request.urlopen(url, timeout=30) as resp:
        body = resp.read().decode("utf-8", errors="replace")
        print(f"  CallMeBot-Antwort: {body[:160]}")


def build_items(status: dict) -> tuple[list[str], list[str]]:
    """Gibt (nachricht_zeilen, signatur_teile) zurueck."""
    zeilen: list[str] = []
    sig: list[str] = []

    offen = status.get("offen", [])
    if offen:
        zeilen.append(f"\U0001F4DA Offene Hausaufgaben ({len(offen)}):")
        for a in offen:
            ha = (a.get("hausaufgabe") or "").strip()
            if len(ha) > 120:
                ha = ha[:117] + "..."
            zeilen.append(f"- {a.get('kurs','')}: {ha}")
            sig.append(f"HA|{a.get('kurs','')}|{ha}")

    vert = status.get("vertretungen", [])
    if vert:
        if zeilen:
            zeilen.append("")
        zeilen.append(f"\U0001F504 Vertretungsplan ({len(vert)}):")
        # nach Datum gruppieren (Reihenfolge wie geliefert)
        letzte_datum = None
        for v in vert:
            if v.get("datum") != letzte_datum:
                letzte_datum = v.get("datum")
                zeilen.append(f"\U0001F4C5 {letzte_datum}")
            teile = [f"Std {v.get('stunde','')}"]
            for key in ("fach", "art", "vertretung"):
                if v.get(key):
                    teile.append(v[key])
            if v.get("raum"):
                teile.append(f"Raum {v['raum']}")
            if v.get("hinweis"):
                teile.append(v["hinweis"])
            zeilen.append("- " + ", ".join(teile))
            sig.append("VP|" + "|".join(str(v.get(k, "")) for k in
                       ("datum", "stunde", "fach", "art", "vertretung", "raum", "hinweis")))

    return zeilen, sig


def signature(sig_parts: list[str]) -> str:
    raw = "\n".join(sorted(sig_parts))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def main() -> int:
    phone = os.getenv("CALLMEBOT_PHONE", "").strip()
    apikey = os.getenv("CALLMEBOT_APIKEY", "").strip()
    if not phone or not apikey:
        print("Keine CallMeBot-Daten gesetzt - WhatsApp wird uebersprungen.")
        return 0

    if not STATUS_FILE.exists():
        print(f"Keine Status-Datei gefunden: {STATUS_FILE}")
        return 1

    status = json.loads(STATUS_FILE.read_text(encoding="utf-8"))
    zeilen, sig_parts = build_items(status)

    # Vorherige Signatur laden.
    prev = ""
    if config.SIGNATURE_FILE.exists():
        prev = config.SIGNATURE_FILE.read_text(encoding="utf-8").strip()

    if not zeilen:
        # Nichts (mehr) da -> Signatur leeren, nicht benachrichtigen.
        config.SIGNATURE_FILE.write_text(signature([]), encoding="utf-8")
        print("Nichts Meldenswertes - keine WhatsApp.")
        return 0

    now_sig = signature(sig_parts)
    if now_sig == prev:
        print("Keine Aenderung seit der letzten Meldung - keine WhatsApp.")
        return 0

    msg = "\U0001F514 Schulportal-Update\n\n" + "\n".join(zeilen)
    print("Sende WhatsApp ...")
    try:
        send_whatsapp(phone, apikey, msg)
        config.SIGNATURE_FILE.write_text(now_sig, encoding="utf-8")
        print("Gesendet.")
    except Exception as exc:  # noqa: BLE001
        print(f"FEHLER beim Senden: {exc}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
