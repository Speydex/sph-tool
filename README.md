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

## Krypto-Test-Trading-Bot (Bybit Demo-Trading)

Zusätzliches, unabhängiges Tool: beobachtet einen Kurs (Standard: BTCUSDT)
per SMA-Crossover-Strategie und kauft/verkauft automatisch auf einem
**Bybit-Demo-Trading-Konto** — virtuelles Geld, aber echte Marktpreise. Läuft
per GitHub Actions alle 15 Minuten (`.github/workflows/crypto-bot.yml`).

> **Nur Demo-Konto, keine Anlageberatung.** Der Bot handelt ausschließlich
> mit virtuellem Test-Guthaben. Es gibt keine Garantie, dass die Strategie
> Gewinn macht — reale Märkte verhalten sich nicht immer wie erwartet.

Setup:

1. Im Bybit-Dashboard oben rechts auf **„Demo Trading"** umschalten und dort
   einen eigenen API-Key erzeugen (funktioniert nur fürs Demo-Konto).
2. Lokal: Key/Secret in `.env` eintragen (siehe `.env.example`).
3. Für GitHub Actions: `BYBIT_API_KEY` / `BYBIT_API_SECRET` als Repository-Secrets
   anlegen (optional `CALLMEBOT_PHONE` / `CALLMEBOT_APIKEY` für eine
   WhatsApp-Meldung bei jedem Kauf/Verkauf).
4. Manuell testen: `python crypto_bot.py`

| Datei | Zweck |
|-------|-------|
| `crypto_config.py` | Zugangsdaten, Symbol, SMA-Längen, Einsatz pro Kauf |
| `bybit_client.py`  | Schlanker signierter REST-Client für die Bybit-V5-API |
| `strategy.py`      | SMA-Crossover-Signal (BUY/SELL/HOLD) |
| `crypto_bot.py`    | Holt Kerzen, bildet Signal, handelt, merkt sich Position |

Die aktuelle Position (im Markt oder nicht, Einstiegspreis) steht in
`state/crypto_position.json` und wird zwischen den Workflow-Läufen über
einen Cache wiederhergestellt — genauso wie beim Hausaufgaben-Check oben.
