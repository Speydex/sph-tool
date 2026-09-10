// ============================================================
// Firebase-Konfiguration für den BörsenTycoon Cloud-Speicherstand
// ============================================================
// Diese Werte sind NICHT geheim — sie duerfen oeffentlich im Frontend-Code
// stehen (so macht das jede Firebase-Web-App). Deine Daten sind stattdessen
// durch die Login-Pflicht + die Firestore-Security-Rules geschuetzt (siehe
// firestore.rules in diesem Ordner), nicht durch Geheimhaltung dieser IDs.
//
// So findest du deine Werte:
//  1. https://console.firebase.google.com -> Projekt anlegen (kostenlos)
//  2. Authentication -> "Get started" -> Sign-in-Methode "E-Mail/Passwort" aktivieren
//  3. Firestore Database -> Datenbank erstellen (production mode reicht,
//     die Regeln unten sperren sie ohnehin auf den jeweils eigenen Nutzer)
//  4. Projekteinstellungen (Zahnrad) -> "Meine Apps" -> Web-App (</>) hinzufügen
//  5. Die dort angezeigten Werte unten eintragen
//  6. In der Firestore-Konsole unter "Regeln" den Inhalt von firestore.rules
//     einfügen und veröffentlichen
//
// Solange hier noch die Platzhalter ("DEIN_...") stehen, erkennt das Spiel
// das automatisch und läuft ganz normal im Lokal-Modus weiter (Login-Button
// bleibt inaktiv, Speicherstand nur im Browser via localStorage) — nichts
// bricht, bis hier echte Werte eingetragen sind.
const FIREBASE_CONFIG = {
  apiKey: "DEIN_API_KEY",
  authDomain: "DEIN_PROJEKT.firebaseapp.com",
  projectId: "DEIN_PROJEKT",
  storageBucket: "DEIN_PROJEKT.appspot.com",
  messagingSenderId: "DEINE_SENDER_ID",
  appId: "DEINE_APP_ID",
};

const FIREBASE_CONFIGURED = FIREBASE_CONFIG.apiKey !== "DEIN_API_KEY" && !!FIREBASE_CONFIG.apiKey;
