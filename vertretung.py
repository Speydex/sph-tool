"""Liest den Vertretungsplan aus (read-only).

Struktur (verifiziert): pro Tag eine Tabelle mit id='vtable<TT_MM_JJJJ>',
Spalten ueber thead th[data-field]: Stunde, Klasse, Vertreter, Art, Fach,
Raum, Raum_alt, Hinweis, Hinweis2, Lerngruppe. Der Plan ist serverseitig
bereits auf die eigene Klasse gefiltert ('Mein Vertretungsplan').
"""
from __future__ import annotations

from dataclasses import dataclass

from playwright.sync_api import Page

VERTRETUNG_URL = "https://start.schulportal.hessen.de/vertretungsplan.php"


@dataclass
class Vertretung:
    datum: str
    stunde: str
    klasse: str
    vertretung: str
    art: str
    fach: str
    raum: str
    hinweis: str


def scrape_vertretung(page: Page) -> list[Vertretung]:
    page.goto(VERTRETUNG_URL, wait_until="domcontentloaded")
    page.wait_for_timeout(2500)  # AJAX-Inhalte laden lassen

    eintraege: list[Vertretung] = []
    tables = page.locator("table[id^='vtable']")
    for i in range(tables.count()):
        tbl = tables.nth(i)
        tid = tbl.get_attribute("id") or ""
        datum = tid.replace("vtable", "").replace("_", ".")  # -> 15.06.2026

        # Spaltennamen aus den Headern lesen (data-field).
        ths = tbl.locator("thead th")
        fields = [(ths.nth(j).get_attribute("data-field") or "") for j in range(ths.count())]

        rows = tbl.locator("tbody tr")
        for r in range(rows.count()):
            cells = rows.nth(r).locator("td")
            if cells.count() <= 1:
                continue  # "keine Eintraege"-Platzhalterzeile ueberspringen
            data = {}
            for c in range(min(cells.count(), len(fields))):
                data[fields[c]] = (cells.nth(c).inner_text() or "").strip()

            hinweis = " ".join(
                x for x in (data.get("Hinweis", ""), data.get("Hinweis2", "")) if x
            ).strip()

            eintraege.append(
                Vertretung(
                    datum=datum,
                    stunde=data.get("Stunde", ""),
                    klasse=data.get("Klasse", ""),
                    vertretung=data.get("Vertreter", ""),
                    art=data.get("Art", ""),
                    fach=data.get("Fach", ""),
                    raum=data.get("Raum", ""),
                    hinweis=hinweis,
                )
            )

    return eintraege
