"""Login-Logik fuer das Schulportal Hessen mit Playwright.

Strategie:
- Wenn eine gespeicherte Session (storage_state.json) existiert, wird sie
  geladen und geprueft. Spart wiederholtes Einloggen.
- Sonst regulaerer Login ueber das Formular.
- Bei Fehlern wird ein Screenshot + HTML-Dump in debug/ abgelegt, damit du
  (als Entwickler) den echten DOM inspizieren und Selektoren anpassen kannst.
"""
from __future__ import annotations

from datetime import datetime

from playwright.sync_api import Page, BrowserContext, TimeoutError as PWTimeout

import config


def _dump_debug(page: Page, name: str) -> None:
    """Screenshot + HTML der aktuellen Seite fuer die Fehlersuche speichern."""
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    png = config.DEBUG_DIR / f"{name}_{stamp}.png"
    html = config.DEBUG_DIR / f"{name}_{stamp}.html"
    try:
        page.screenshot(path=str(png), full_page=True)
        html.write_text(page.content(), encoding="utf-8")
        print(f"  [debug] gespeichert: {png.name} / {html.name}")
    except Exception as exc:  # noqa: BLE001 - Debug darf nie den Lauf killen
        print(f"  [debug] konnte nicht speichern: {exc}")


def _fill_first(page: Page, selectors: list[str], value: str, what: str) -> bool:
    """Fuellt das erste vorhandene Feld aus der Selektor-Liste."""
    for sel in selectors:
        loc = page.locator(sel)
        if loc.count() > 0:
            loc.first.fill(value)
            return True
    print(f"  [warn] Kein Feld fuer '{what}' gefunden (probiert: {selectors})")
    return False


def _click_first(page: Page, selectors: list[str], what: str) -> bool:
    for sel in selectors:
        loc = page.locator(sel)
        if loc.count() > 0:
            loc.first.click()
            return True
    print(f"  [warn] Kein Button fuer '{what}' gefunden (probiert: {selectors})")
    return False


def is_logged_in(page: Page) -> bool:
    """True nur bei echtem Login.

    Reine Domain-Pruefung reicht NICHT: start.schulportal.hessen.de liefert
    auch ohne Login eine Seite (Fehler 'Datenbankauswahl nicht moeglich').
    Verlaesslich ist der Logout-Link, den nur eingeloggte Seiten haben.
    """
    url = page.url.lower()
    if "login.schulportal.hessen.de" in url:
        return False
    if config.LOGGED_IN_HOST not in url:
        return False
    return page.locator(config.LOGGED_IN_MARKER).count() > 0


def perform_login(page: Page) -> bool:
    """Fuehrt den Formular-Login durch. Gibt True bei Erfolg zurueck."""
    print(f"-> Oeffne Login-Seite: {config.LOGIN_URL}")
    page.goto(config.LOGIN_URL, wait_until="domcontentloaded")
    # Die Login-Seite laedt teils per JS nach / leitet kurz um -> kurz warten,
    # damit der Ausfuehrungskontext stabil ist.
    try:
        page.wait_for_load_state("networkidle", timeout=8000)
    except PWTimeout:
        pass

    # Falls die Session noch gueltig ist, leitet die Login-Seite direkt zur
    # Startseite um -> dann sind wir schon eingeloggt, kein Formular noetig.
    if is_logged_in(page):
        print("-> Bereits eingeloggt (gueltige Session).")
        return True

    # Cookie-/Consent-Banner wegklicken, falls vorhanden (best effort).
    # Komplett in try/except, weil eine Navigation den Kontext zerstoeren kann.
    for txt in ("Alle akzeptieren", "Akzeptieren", "Einverstanden", "OK"):
        try:
            btn = page.get_by_role("button", name=txt)
            if btn.count() > 0:
                btn.first.click(timeout=2000)
                break
        except Exception:  # noqa: BLE001 - Banner ist optional, nie kritisch
            pass

    ok_user = _fill_first(page, config.USERNAME_SELECTORS, config.USERNAME, "Benutzername")
    ok_pass = _fill_first(page, config.PASSWORD_SELECTORS, config.PASSWORD, "Passwort")
    if not (ok_user and ok_pass):
        _dump_debug(page, "login_form_not_found")
        return False

    # "angemeldet bleiben" anhaken (laengere Session) - best effort.
    stay = page.locator(config.STAY_CONNECTED_SELECTOR)
    if stay.count() > 0:
        try:
            stay.first.check(timeout=2000)
        except Exception:  # noqa: BLE001
            pass

    _click_first(page, config.SUBMIT_SELECTORS, "Anmelden")

    # Nach dem Absenden leitet SPH ueber connect.* zur Start-Domain um.
    try:
        page.wait_for_url(f"**{config.LOGGED_IN_HOST}**", timeout=20000)
    except PWTimeout:
        pass
    try:
        page.wait_for_load_state("domcontentloaded", timeout=10000)
    except PWTimeout:
        pass

    if is_logged_in(page):
        print("-> Login erfolgreich.")
        return True

    print("-> Login fehlgeschlagen (evtl. falsche Daten oder geaenderter DOM).")
    _dump_debug(page, "login_failed")
    return False


def ensure_logged_in(context: BrowserContext, page: Page) -> bool:
    """Stellt sicher, dass wir eingeloggt sind; nutzt ggf. gespeicherte Session."""
    # Versuch ueber gespeicherte Session: direkt eine geschuetzte Seite testen.
    page.goto(config.MEIN_UNTERRICHT_URL, wait_until="domcontentloaded")
    try:
        page.wait_for_load_state("networkidle", timeout=8000)
    except PWTimeout:
        pass
    if is_logged_in(page):
        print("-> Bestehende Session gueltig, kein erneuter Login noetig.")
        return True

    if perform_login(page):
        # Session fuer naechstes Mal speichern.
        context.storage_state(path=str(config.STORAGE_STATE))
        print(f"-> Session gespeichert: {config.STORAGE_STATE.name}")
        return True
    return False
