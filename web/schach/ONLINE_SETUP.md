# Schach online: einmalige Einrichtung

Der Online-Modus nutzt dasselbe Firebase-Projekt wie BörsenTycoon
(`crypto-trading-ccd35`). Konten gibt es also schon, und wer in BörsenTycoon
angemeldet ist, ist es auch in Schach.

Damit die Datenbank die neuen Schach-Daten (Profile, Freunde, Partien)
annimmt, müssen **einmal die aktualisierten Regeln veröffentlicht** werden:

1. [console.firebase.google.com](https://console.firebase.google.com) öffnen → Projekt `crypto-trading-ccd35`
2. Links **Firestore Database** → Tab **Regeln**
3. Den kompletten Inhalt von [`../boersentycoon/firestore.rules`](../boersentycoon/firestore.rules)
   einfügen (ersetzt den alten Text) → **Veröffentlichen**

Die Datei enthält die bisherigen BörsenTycoon-Regeln unverändert plus die
neuen Schach-Regeln. Solange sie nicht veröffentlicht sind, zeigt Schach
beim Online-Spielen „Keine Berechtigung …“ an. Offline gegen den Computer
oder zu zweit funktioniert trotzdem.

## So spielt man online

1. Rechts unter **Online mit Freunden** anmelden oder registrieren und einen Spielernamen wählen.
2. Jeder bekommt einen **Freundescode** (6 Zeichen). Den schickst du deinem Freund.
3. Dein Freund gibt deinen Code bei **Hinzufügen** ein. Du nimmst die Anfrage an.
4. Bei **Freunde** auf **Herausfordern** tippen. Dein Freund nimmt die Einladung an und die Partie startet.
5. Die Züge erscheinen sofort beim anderen. Man kann die Seite schließen und später weiterspielen.
   Remis anbieten, Aufgeben und Revanche gibt es auch.

Die Datenbank-Regeln sorgen dafür, dass nur die beiden Spieler eine Partie
sehen, man nur ziehen kann, wenn man dran ist, und beendete Partien nicht
mehr geändert werden können.
