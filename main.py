"""Einstiegspunkt: Login + 'Mein Unterricht' auslesen.

Aufruf:
    python main.py            # sichtbar (headed), gut zum ersten Testen
    python main.py --headless # ohne sichtbares Browserfenster
    python main.py --fresh    # gespeicherte Session ignorieren, neu einloggen

Dieses Tool LIEST nur Daten aus. Es bearbeitet/uebermittelt keine Aufgaben.
"""
from __future__ import annotations

import sys

from playwright.sync_api import sync_playwright

import config
from login import ensure_logged_in
from scraper import scrape_mein_unterricht, save_results


def main() -> int:
    headless = "--headless" in sys.argv
    fresh = "--fresh" in sys.argv

    config.check_credentials()

    if fresh and config.STORAGE_STATE.exists():
        config.STORAGE_STATE.unlink()
        print("-> Gespeicherte Session geloescht (--fresh).")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        # Bestehende Session laden, falls vorhanden.
        ctx_kwargs = {"accept_downloads": True}
        if config.STORAGE_STATE.exists():
            ctx_kwargs["storage_state"] = str(config.STORAGE_STATE)
        context = browser.new_context(**ctx_kwargs)
        page = context.new_page()

        try:
            if not ensure_logged_in(context, page):
                print("\nABBRUCH: Login nicht moeglich. Siehe debug/ fuer Details.")
                return 1

            aufgaben = scrape_mein_unterricht(page)
            save_results(aufgaben)

            print("\nFertig. Zusammenfassung:")
            for a in aufgaben[:12]:
                hw = ""
                if a.hausaufgabe:
                    status = "erledigt" if a.hausaufgabe_erledigt else "OFFEN"
                    hw = f"  | HA ({status}): {a.hausaufgabe[:50]}"
                print(f"  - [{a.kurs} | {a.thema} | {a.datum}]{hw}")
            if len(aufgaben) > 12:
                print(f"  ... und {len(aufgaben) - 12} weitere.")
        finally:
            context.close()
            browser.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
