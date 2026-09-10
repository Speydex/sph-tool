# Cloud-Login einrichten (E-Mail/Passwort, kostenlos)

BörsenTycoon kann Spielstände optional über einen Account (E-Mail +
Passwort) geräteübergreifend speichern. Technisch läuft das über
[Firebase](https://firebase.google.com) (Auth + Firestore) — komplett im
Browser, kein eigener Server nötig, kostenloses Kontingent reicht für dieses
Spiel locker aus.

**Ohne diese Einrichtung funktioniert das Spiel ganz normal weiter** —
einfach lokal im Browser gespeichert (wie bisher), der Login-Button zeigt
dann nur "Cloud inaktiv" an.

## Schritt für Schritt

1. **Projekt anlegen**: [console.firebase.google.com](https://console.firebase.google.com)
   → "Projekt hinzufügen" → Namen vergeben (z. B. `boersentycoon`) →
   Google Analytics kann man abwählen, wird nicht gebraucht.

2. **E-Mail/Passwort-Login aktivieren**: Im Projekt links auf
   **Authentication** → "Get started" → Tab **Sign-in method** →
   **E-Mail/Passwort** auswählen → aktivieren → Speichern.

3. **Datenbank anlegen**: Links auf **Firestore Database** → "Datenbank
   erstellen" → einen Standort wählen (z. B. `eur3 (europe-west)`) →
   "Production mode" ist fine, die Regeln aus Schritt 5 sperren die
   Datenbank ohnehin korrekt.

4. **Web-App registrieren & Config kopieren**: Zahnrad-Symbol oben links →
   **Projekteinstellungen** → runterscrollen zu "Meine Apps" → auf das
   `</>`-Symbol (Web) klicken → einen Namen vergeben → "Registrieren".
   Es erscheint ein Code-Block mit `apiKey`, `authDomain`, `projectId`,
   `storageBucket`, `messagingSenderId`, `appId` — **diese sechs Werte
   brauche ich**, um sie in [`firebase-config.js`](firebase-config.js)
   einzutragen. Sie sind **nicht geheim** (jede Firebase-Web-App hat sie
   öffentlich im Code), du kannst sie also einfach im Chat mit mir teilen
   oder direkt selbst in die Datei eintragen.

5. **Sicherheitsregeln setzen**: In der Firestore-Konsole auf den Tab
   **Regeln** → den kompletten Inhalt von [`firestore.rules`](firestore.rules)
   einfügen (ersetzt den vorhandenen Text) → **Veröffentlichen**. Das
   sorgt dafür, dass jede*r Nutzer*in ausschließlich den eigenen
   Spielstand lesen/schreiben kann — niemand sonst, auch nicht über Umwege.

6. Fertig — sobald echte Werte in `firebase-config.js` stehen, erkennt das
   Spiel das automatisch (`FIREBASE_CONFIGURED` wird `true`) und der
   "Anmelden"-Button funktioniert.

## Was macht das Spiel dann automatisch?

- Registrierung verschickt eine Bestätigungsmail (spielbar ist der Account
  aber sofort, die Bestätigung ist nur ein Hinweis, kein Zwang).
- Eingeloggt wird der Spielstand automatisch alle 60 Sekunden sowie beim
  Abmelden in die Cloud hochgeladen; "Jetzt synchronisieren" geht auch
  manuell jederzeit im Optionen-Tab.
- Meldet man sich auf einem neuen Gerät an und es gibt dort *und* in der
  Cloud bereits unterschiedliche Spielstände mit echtem Fortschritt, fragt
  das Spiel nach, welcher behalten werden soll — nichts wird automatisch
  überschrieben.
