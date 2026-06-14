r"""Einmaliges Hilfsskript: zeigt die echten Formularfelder der Login-Seite.

Aufruf: .\.venv\Scripts\python inspect_login.py
"""
from __future__ import annotations

from playwright.sync_api import sync_playwright

import config


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_context().new_page()
        page.goto(config.LOGIN_URL, wait_until="networkidle")
        print("URL nach Laden:", page.url)
        print("Titel:", page.title())

        print("\n--- INPUT-Felder ---")
        inputs = page.locator("input")
        for i in range(inputs.count()):
            el = inputs.nth(i)
            print(
                f"  #{i}",
                "type=", el.get_attribute("type"),
                "name=", el.get_attribute("name"),
                "id=", el.get_attribute("id"),
                "placeholder=", el.get_attribute("placeholder"),
            )

        print("\n--- BUTTONS / SUBMIT ---")
        btns = page.locator("button, input[type='submit']")
        for i in range(btns.count()):
            el = btns.nth(i)
            print(
                f"  #{i}",
                "type=", el.get_attribute("type"),
                "id=", el.get_attribute("id"),
                "text=", (el.inner_text() or "").strip()[:40],
            )

        print("\n--- SELECT (z.B. Schulauswahl) ---")
        sels = page.locator("select")
        for i in range(sels.count()):
            el = sels.nth(i)
            print(f"  #{i}", "name=", el.get_attribute("name"), "id=", el.get_attribute("id"))

        browser.close()


if __name__ == "__main__":
    main()
