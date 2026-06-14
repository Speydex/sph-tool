"""Liest den Bereich 'Mein Unterricht' aus (read-only).

Wichtig: Dieses Modul LIEST nur. Es traegt nichts ein und reicht nichts ein.

Struktur der Tabelle 'Aktuelle Eintraege' (verifiziert gegen das echte Portal):
jede Zeile = <tr data-book="..."> mit drei Spalten:
  1. Kurs:   span.name (Kursname) + span.teacher button[title] (Lehrer)
             + Link a[href*='sus_view'] zur gesamten Kursmappe
  2. Eintrag: b.thema (Thema) + span.datum (Datum)
             + optional div.homework (Hausaufgabe) mit:
                 span.label  -> "Hausaufgabe"
                 span.done   -> "erledigt" (nur wenn erledigt)
                 div.realHomework -> der eigentliche Aufgabentext (versteckt)
  3. Aktion: Button "alle Eintraege" (ignorieren)
"""
from __future__ import annotations

import json
from dataclasses import dataclass, asdict
from datetime import datetime
from urllib.parse import urljoin

from playwright.sync_api import Page, Locator

import config


@dataclass
class Aufgabe:
    """Ein Eintrag aus 'Mein Unterricht' (letzter Eintrag je Kurs)."""
    kurs: str
    lehrer: str
    thema: str
    datum: str
    hausaufgabe: str          # eigentlicher Aufgabentext, "" wenn keine
    hausaufgabe_erledigt: bool
    kursmappe_url: str        # Link zur gesamten Kursmappe (fuer spaeter)
    anhaenge: list[str]


def _txt(loc: Locator) -> str:
    """inner_text des ersten Treffers, sonst ''."""
    if loc.count() == 0:
        return ""
    return (loc.first.inner_text() or "").strip()


def _save_html_dump(page: Page, name: str) -> None:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = config.DEBUG_DIR / f"{name}_{stamp}.html"
    path.write_text(page.content(), encoding="utf-8")
    print(f"  [debug] HTML-Dump: {path.name}")


def scrape_mein_unterricht(page: Page) -> list[Aufgabe]:
    """Oeffnet 'Mein Unterricht' und extrahiert die aktuellen Eintraege."""
    print(f"-> Oeffne 'Mein Unterricht': {config.MEIN_UNTERRICHT_URL}")
    page.goto(config.MEIN_UNTERRICHT_URL, wait_until="domcontentloaded")
    page.wait_for_timeout(1500)  # kurz fuer ggf. nachladende Inhalte

    _save_html_dump(page, "mein_unterricht")

    aufgaben: list[Aufgabe] = []
    rows = page.locator("tr[data-book]")
    n = rows.count()
    print(f"-> {n} Kurs-Zeilen gefunden, werte aus ...")

    for i in range(n):
        row = rows.nth(i)

        # Lehrer: voller Name + Kuerzel steckt im title-Attribut des Buttons.
        lehrer_btn = row.locator(".teacher button[title]")
        lehrer = (lehrer_btn.first.get_attribute("title") or "").strip() if lehrer_btn.count() else ""

        # Hausaufgabentext steht versteckt in .realHomework -> text_content nutzen.
        hw_loc = row.locator(".realHomework")
        hausaufgabe = ""
        if hw_loc.count():
            hausaufgabe = (hw_loc.first.text_content() or "").strip()

        erledigt = row.locator(".homework .done").count() > 0

        # Link zur Kursmappe (absolut machen).
        href_loc = row.locator("a[href*='sus_view']")
        href = href_loc.first.get_attribute("href") if href_loc.count() else ""
        kursmappe_url = urljoin(config.START_URL, href) if href else ""

        # Anhaenge in der Zeile (Datei-/Download-Links).
        anhaenge: list[str] = []
        links = row.locator("a[href]")
        for k in range(links.count()):
            h = links.nth(k).get_attribute("href") or ""
            if any(x in h.lower() for x in ("download", ".pdf", ".doc", "datei", "file=")):
                anhaenge.append(urljoin(config.START_URL, h))

        aufgaben.append(
            Aufgabe(
                kurs=_txt(row.locator(".name")),
                lehrer=lehrer,
                thema=_txt(row.locator(".thema")),
                datum=_txt(row.locator(".datum")),
                hausaufgabe=hausaufgabe,
                hausaufgabe_erledigt=erledigt,
                kursmappe_url=kursmappe_url,
                anhaenge=anhaenge,
            )
        )

    if not aufgaben:
        print(
            "  [warn] Keine Eintraege erkannt. Schau in den HTML-Dump in debug/ \n"
            "         und pruefe den Selektor tr[data-book] in scraper.py."
        )

    return aufgaben


def save_results(aufgaben: list[Aufgabe]) -> str:
    """Schreibt die Ergebnisse als JSON nach output/. Gibt den Pfad zurueck."""
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = config.OUTPUT_DIR / f"mein_unterricht_{stamp}.json"
    data = [asdict(a) for a in aufgaben]
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"-> {len(aufgaben)} Eintraege gespeichert: {path}")
    return str(path)
