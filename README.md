# Schulportal-Hessen Tool — „Mein Unterricht" auslesen

Loggt sich mit deinen Zugangsdaten ins [Schulportal Hessen](https://login.schulportal.hessen.de)
ein und liest den Bereich **„Mein Unterricht"** aus (Kurse, Aufgaben, Beschreibungen,
Anhänge). Speichert das Ergebnis als JSON.

> **Read-only.** Dieses Tool liest nur. Es bearbeitet keine Aufgaben und reicht
> nichts ein. Es ist als Übersichts-/Lern-Werkzeug gedacht, nicht zum Lösen
> gestellter Aufgaben.

## Setup (einmalig)

1. Zugangsdaten eintragen:
   ```powershell
   Copy-Item .env.example .env
   ```
   Dann `.env` öffnen und `SPH_USERNAME` / `SPH_PASSWORD` ausfüllen.
   `SPH_SCHOOL_ID=6105` ist bereits aus deiner Login-URL gesetzt.

2. (Bereits erledigt) Abhängigkeiten + Browser sind installiert.

## Benutzung

```powershell
# Im Projektordner:
.\.venv\Scripts\python.exe main.py            # sichtbar (zum ersten Testen)
.\.venv\Scripts\python.exe main.py --headless # ohne Browserfenster
.\.venv\Scripts\python.exe main.py --fresh    # Session verwerfen, neu einloggen
```

Ergebnisse landen in `output/mein_unterricht_<zeit>.json`.

## Wenn nichts/falsches ausgelesen wird

Ich habe das Tool **ohne Zugang zum echten Portal** gebaut — die Login-Felder
und die Tabellenstruktur können daher leicht abweichen. Deshalb:

- Bei jedem Lauf wird ein **HTML-Dump** in `debug/` gespeichert (`mein_unterricht_*.html`).
- Schlägt der Login fehl, liegt dort `login_failed_*.png` + `.html`.

Öffne den Dump, schau dir die echten `id`/`class`-Namen an und passe die
Selektoren an:
- Login-Felder: `USERNAME_SELECTORS` / `PASSWORD_SELECTORS` in [`config.py`](config.py)
- Aufgaben-Tabelle: die `#aktuellen tbody tr`-Selektoren in [`scraper.py`](scraper.py)

Schick mir den Dump, dann ziehe ich die Selektoren passend nach.

## Aufbau

| Datei | Zweck |
|-------|-------|
| `config.py`  | URLs, Selektoren, Zugangsdaten-Laden, Ordner |
| `login.py`   | Login + Session-Wiederverwendung + Debug-Dumps |
| `scraper.py` | „Mein Unterricht" auslesen → JSON |
| `main.py`    | Einstiegspunkt / Ablaufsteuerung |

## Sicherheit

- `.env` und `storage_state.json` (gespeicherte Session-Cookies) stehen in
  `.gitignore` und werden nie eingecheckt.
- Behandle beide wie Passwörter.
