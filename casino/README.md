# Nile Royale

Ein 5×3-Video-Slot mit neun festen Gewinnlinien in einer einzigen, eigenständigen
HTML-Datei. Kein Build, keine Abhängigkeiten, keine externen Assets — `nile-royale.html`
im Browser öffnen und spielen.

## Aufbau

| Datei | Zweck |
| --- | --- |
| `nile-royale.html` | Das vollständige Spiel. Einzige Quelle. |
| `build-artifact.mjs` | Erzeugt daraus das Fragment für Claude Artifacts (ohne `<html>`/`<head>`/`<body>`). |

```
node casino/build-artifact.mjs            # → casino/nile-royale.artifact.html
```

## Mathematik

Die Auszahlungsquote ist nicht geschätzt, sondern geschlossen berechnet und wird beim
Start im Browser aus den Walzenbändern reproduziert (Info → Mathematik):

| Größe | Wert |
| --- | --- |
| Auszahlungsquote (RTP) | **95,95 %** |
| davon Linienspiel | 78,70 % |
| davon Scatter | 2,12 % |
| davon Freispiele | 15,13 % |
| Bonus-Auslösung | 1 : 117 Spins |
| Trefferquote | 32,0 % (1 : 3,1) |
| Volatilität (σ) | 2,51 × Einsatz |
| Höchster Liniengewinn | 800 × Linieneinsatz (1.600 × in Freispielen) |

Verfahren:

* **Linienanteil** — vollständige Aufzählung aller 10⁵ Symbolkombinationen mit den
  Randverteilungen der fünf Bänder. Pro Linie trägt jede Walze genau eine Zelle bei,
  die Walzen sind damit exakt unabhängig.
* **Scatteranteil** — Faltung der Fensterverteilungen der echten Bänder. In jedem Band
  liegen mindestens drei Positionen zwischen zwei Scattern, pro Walzenfenster also
  höchstens einer; das macht die Verteilung geschlossen berechenbar.
* **Freispiele** — geometrische Reihe der Wiederauslösungen:
  `E[Freispiele] = 10q / (1 − 10q)`, Gesamt-RTP `= W · (1 + 2 · E[Freispiele])`.

Gegengeprüft mit 3 Mio. simulierten Spins durch denselben `evaluate()`, den das Spiel
verwendet (Abweichung 0,07 pp, innerhalb des Stichprobenfehlers).

## Technik

* Reines Vanilla-JavaScript, HTML5 Canvas, 60-FPS-Schleife über `requestAnimationFrame`.
* **Alle** Symbole sind Vektorgrafik, zur Laufzeit auf Canvas gezeichnet und als Sprites
  zwischengespeichert — keine Bilddateien, keine Emoji.
* **Echte Bewegungsunschärfe**: pro Sprite werden Kopien entlang der Bewegungsstrecke
  additiv belichtet (`globalCompositeOperation = 'lighter'`), die Abtastdichte folgt der
  Geschwindigkeit. Das ist die diskrete Form einer Belichtungszeit, kein Weichzeichner.
* Walzenstopp mit Überschwingen und Rückfederung, gestaffelt von links nach rechts,
  mit Spannungsverzögerung sobald zwei Scatter liegen.
* **Audio** vollständig über die Web Audio API synthetisiert: prozedural erzeugte
  Impulsantwort als Hallraum, FM-Glocken für die Gewinnarpeggien, gefiltertes Rauschen
  für Laufgeräusch und Klacken. Keine Mediendateien.
* Guthaben, Einsatz und Toneinstellung werden in `localStorage` gehalten (mit Fallback,
  falls der Browser den Zugriff verweigert).

Nur Spielgeld. Startguthaben 2.500 Credits, Einsatz 10 bis 500.
