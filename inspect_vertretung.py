r"""Einmaliges Hilfsskript: speichert den Vertretungsplan als HTML-Dump und
zeigt grob die Struktur (Tabellen, Zeilen, sichtbarer Text).

Aufruf: .\.venv\Scripts\python inspect_vertretung.py
"""
from __future__ import annotations

from datetime import datetime

from playwright.sync_api import sync_playwright

import config
from login import ensure_logged_in

VERTRETUNG_URL = "https://start.schulportal.hessen.de/vertretungsplan.php"


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx_kwargs = {}
        if config.STORAGE_STATE.exists():
            ctx_kwargs["storage_state"] = str(config.STORAGE_STATE)
        context = browser.new_context(**ctx_kwargs)
        page = context.new_page()
        if not ensure_logged_in(context, page):
            print("Login fehlgeschlagen.")
            return

        page.goto(VERTRETUNG_URL, wait_until="domcontentloaded")
        page.wait_for_timeout(2500)  # AJAX-Inhalte laden lassen
        print("URL:", page.url)
        print("Titel:", page.title())

        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        dump = config.DEBUG_DIR / f"vertretung_{stamp}.html"
        dump.write_text(page.content(), encoding="utf-8")
        print("HTML-Dump:", dump.name)

        print("\n--- Tabellen ---")
        tables = page.locator("table")
        for i in range(tables.count()):
            t = tables.nth(i)
            print(f"  Tabelle #{i}: id=", t.get_attribute("id"), "class=", t.get_attribute("class"),
                  "Zeilen=", t.locator("tr").count())

        print("\n--- Erste sichtbare Textzeilen ---")
        body = page.locator("#content, body").first
        txt = (body.inner_text() or "").strip().splitlines()
        for line in [l for l in txt if l.strip()][:40]:
            print("  ", line)

        browser.close()


if __name__ == "__main__":
    main()
