r"""Liest 'Mein Unterricht' frisch aus und zeigt nur die OFFENEN Hausaufgaben.

Read-only. Zeigt dir, WAS zu tun ist - loest nichts und reicht nichts ein.

Aufruf:
    .\.venv\Scripts\python offene_aufgaben.py
    .\.venv\Scripts\python offene_aufgaben.py --headless
"""
from __future__ import annotations

import json
import sys
from dataclasses import asdict
from datetime import datetime

from playwright.sync_api import sync_playwright

import config
from login import ensure_logged_in
from scraper import scrape_mein_unterricht
from vertretung import scrape_vertretung

STATUS_FILE = config.OUTPUT_DIR / "offen_status.json"


def main() -> int:
    headless = "--headless" in sys.argv
    config.check_credentials()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        ctx_kwargs = {"accept_downloads": True}
        if config.STORAGE_STATE.exists():
            ctx_kwargs["storage_state"] = str(config.STORAGE_STATE)
        context = browser.new_context(**ctx_kwargs)
        page = context.new_page()
        try:
            if not ensure_logged_in(context, page):
                print("ABBRUCH: Login nicht moeglich.")
                return 1
            aufgaben = scrape_mein_unterricht(page)
            vertretungen = scrape_vertretung(page)
        finally:
            context.close()
            browser.close()

    # Offen = hat eine Hausaufgabe UND ist nicht als erledigt markiert.
    offen = [a for a in aufgaben if a.hausaufgabe and not a.hausaufgabe_erledigt]

    # Maschinenlesbaren Status fuer den Benachrichtigungs-Wrapper schreiben.
    status = {
        "zeitpunkt": datetime.now().isoformat(timespec="seconds"),
        "anzahl_offen": len(offen),
        "anzahl_hausaufgaben_gesamt": len([a for a in aufgaben if a.hausaufgabe]),
        "offen": [asdict(a) for a in offen],
        "anzahl_vertretungen": len(vertretungen),
        "vertretungen": [asdict(v) for v in vertretungen],
    }
    STATUS_FILE.write_text(json.dumps(status, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n" + "=" * 60)
    if not offen:
        mit_ha = [a for a in aufgaben if a.hausaufgabe]
        print("Aktuell KEINE offenen Hausaufgaben in 'Mein Unterricht'.")
        print(f"({len(mit_ha)} Hausaufgaben insgesamt - alle als erledigt markiert.)")
    else:
        print(f"OFFENE HAUSAUFGABEN: {len(offen)}")
        print("=" * 60)
        for a in offen:
            print(f"\n  Fach:    {a.kurs}  (Lehrer: {a.lehrer})")
            print(f"  Thema:   {a.thema}   | Datum: {a.datum}")
            print(f"  Aufgabe: {a.hausaufgabe}")
            if a.anhaenge:
                print(f"  Anhaenge: {', '.join(a.anhaenge)}")
            print(f"  Kursmappe: {a.kursmappe_url}")
    print("=" * 60)

    print(f"VERTRETUNGSPLAN: {len(vertretungen)} Eintrag/Eintraege")
    for v in vertretungen:
        print(f"  [{v.datum}] Std {v.stunde} | {v.fach} | {v.art} | {v.vertretung} | Raum {v.raum}"
              + (f" | {v.hinweis}" if v.hinweis else ""))
    print("=" * 60)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
