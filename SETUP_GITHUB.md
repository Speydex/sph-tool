# Einrichtung: Cloud-Überwachung per GitHub Actions + WhatsApp

Damit der Check läuft, **ohne dass dein PC an ist**. Drei Teile — geht in ~15 Min.

---

## Teil 1 — WhatsApp aktivieren (CallMeBot)

Damit dir das Skript WhatsApp schreiben darf, einmalig freischalten:

1. Speichere die Nummer **+34 621 34 34 03** als Kontakt (Name egal, z.B. „CallMeBot").
   (Falls keine Antwort kommt: CallMeBot ändert die Nummer manchmal — aktuelle
    Nummer dann auf https://www.callmebot.com/blog/free-api-whatsapp-messages/ prüfen.)
2. Schick dieser Nummer per WhatsApp genau diese Nachricht:
   ```
   I allow callmebot to send me messages
   ```
3. Du bekommst eine Antwort mit deinem **API-Key**, z.B.:
   `API Activated for your phone number. Your APIKEY is 123456`
4. Notiere dir:
   - **Deine Handynummer international, ohne + und ohne führende 0**
     Beispiel: aus `0151 1234567` wird `491511234567`
   - Den **APIKEY** aus der Antwort

> Hinweis: CallMeBot ist ein kostenloser Drittanbieter. Es geht nur die kurze
> Meldung (z.B. „2 offene Hausaufgaben: Mathe, Englisch") über deren Server —
> niemals dein Schulportal-Passwort.

---

## Teil 2 — Code zu GitHub hochladen

Das lokale Repo ist schon fertig vorbereitet (committet, ohne Passwörter).

1. **GitHub-Account**: falls noch keiner → auf https://github.com/signup anlegen.
2. **Bei der CLI anmelden** (in PowerShell, im Projektordner):
   ```powershell
   gh auth login
   ```
   → „GitHub.com" → „HTTPS" → „Login with a web browser" → Code eingeben.
3. **Privates Repo erstellen + hochladen** (ein Befehl):
   ```powershell
   gh repo create sph-tool --private --source . --push
   ```

> **Wichtig: privat** lassen. Deine `.env` und die Session werden durch
> `.gitignore` ohnehin NICHT hochgeladen — sicherheitshalber aber privat.

---

## Teil 3 — Zugangsdaten als „Secrets" hinterlegen

Die Cloud braucht deine Daten verschlüsselt. Im Projektordner ausführen
(jeder Befehl fragt den Wert ab — Eingabe wird verborgen):

```powershell
gh secret set SPH_USERNAME
gh secret set SPH_PASSWORD
gh secret set SPH_SCHOOL_ID        # -> 6105
gh secret set CALLMEBOT_PHONE      # deine Nummer, z.B. 491511234567
gh secret set CALLMEBOT_APIKEY     # der Key von CallMeBot
```

Alternativ im Browser: Repo → **Settings → Secrets and variables → Actions →
New repository secret**.

---

## Teil 4 — Testen

```powershell
gh workflow run "SPH Hausaufgaben-Check"
```

Dann auf GitHub unter **Actions** den Lauf ansehen (grün = ok). Bei offenen
Hausaufgaben kommt die WhatsApp. Danach läuft alles automatisch um
**13:00 / 15:00 / 18:00 Uhr** (Sommerzeit) — PC aus oder an, egal.

> Zum sofortigen Testen einer echten WhatsApp kannst du eine deiner erledigten
> Hausaufgaben im Portal kurz auf „nicht erledigt" stellen und den Workflow
> erneut starten.

---

## Was wo läuft

- **Lokal (nur wenn PC an):** Windows-Aufgabe „SPH Hausaufgaben-Check" → Toast
- **Cloud (immer):** GitHub Actions → WhatsApp

Du kannst beides parallel laufen lassen oder die lokale Aufgabe entfernen:
```powershell
Unregister-ScheduledTask -TaskName "SPH Hausaufgaben-Check" -Confirm:$false
```
