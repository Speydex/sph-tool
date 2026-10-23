# Firestore-Regeln: automatisch testen und veröffentlichen

Die Regeln stehen in [`web/boersentycoon/firestore.rules`](../web/boersentycoon/firestore.rules).
Sobald eine Änderung daran auf `main` landet, macht GitHub Folgendes von selbst
([Workflow](../.github/workflows/firestore-rules.yml)):

1. Die Tests aus [`rules.test.mjs`](rules.test.mjs) laufen im Firestore-Emulator.
2. Nur wenn alle Tests grün sind, werden die Regeln in Firebase veröffentlicht
   (Projekt `crypto-trading-ccd35`).

Kopieren in die Firebase-Konsole ist dann nicht mehr nötig.

## Einmalige Einrichtung (ca. 3 Minuten)

GitHub braucht dafür einen Schlüssel für dein Firebase-Projekt.

1. **Schlüssel erstellen:** [Firebase-Konsole](https://console.firebase.google.com/project/crypto-trading-ccd35/settings/serviceaccounts/adminsdk)
   → Projekteinstellungen → Tab **Dienstkonten** → **Neuen privaten Schlüssel generieren**
   → **Schlüssel generieren**. Es wird eine `.json`-Datei heruntergeladen.
2. **Bei GitHub hinterlegen:** [Repository → Settings → Secrets and variables → Actions](https://github.com/Speydex/sph-tool/settings/secrets/actions)
   → **New repository secret**
   - Name: `FIREBASE_SERVICE_ACCOUNT`
   - Secret: den **kompletten Inhalt** der `.json`-Datei einfügen
   - **Add secret**
3. **Datei löschen:** Die heruntergeladene `.json`-Datei danach vom Gerät löschen.
   Sie ist wie ein Passwort für die ganze Datenbank: niemandem schicken, nicht
   in den Chat kopieren, nicht ins Repository legen.
4. **Einmal testen:** [Actions → „Firestore-Regeln testen und veroeffentlichen“](https://github.com/Speydex/sph-tool/actions/workflows/firestore-rules.yml)
   → **Run workflow**. Nach 1–2 Minuten sollte alles grün sein.

Solange das Secret fehlt, laufen nur die Tests, und der Workflow zeigt eine
Warnung „Secret FIREBASE_SERVICE_ACCOUNT fehlt“.

### Falls das Veröffentlichen mit „permission denied“ scheitert

Dann fehlt dem Dienstkonto ein Recht: [Google Cloud → IAM](https://console.cloud.google.com/iam-admin/iam?project=crypto-trading-ccd35)
→ beim Konto `firebase-adminsdk-…@crypto-trading-ccd35.iam.gserviceaccount.com`
auf den Stift → **Weitere Rolle hinzufügen** → **Firebase Rules Admin** → Speichern.
Danach den Workflow nochmal starten.

## Lokal testen

```bash
cd firestore
npm ci
npm test      # braucht Java (für den Emulator)
```
