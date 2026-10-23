# Clips: einmalige Einrichtung

Clips ist eine private Video-App (wie TikTok) nur für dich und deine Freunde:
Videos hochladen, im Feed hochwischen, liken (auch per Doppeltipp),
kommentieren, Profile ansehen.

Clips nutzt dasselbe Firebase-Projekt wie BörsenTycoon und Schach
(`crypto-trading-ccd35`). Konten gibt es also schon. Es fehlt nur ein Schritt:

## 1. Regeln veröffentlichen (einmal)

1. [console.firebase.google.com](https://console.firebase.google.com) öffnen → Projekt `crypto-trading-ccd35`
2. Links **Firestore Database** → Tab **Regeln**
3. Den kompletten Inhalt von [`../boersentycoon/firestore.rules`](../boersentycoon/firestore.rules)
   einfügen (ersetzt den alten Text) → **Veröffentlichen**

Die Datei enthält die bisherigen Regeln für BörsenTycoon und Schach unverändert
plus die neuen Clips-Regeln. Solange sie nicht veröffentlicht sind, zeigt Clips
„Keine Berechtigung …“ an.

## 2. Gruppe starten

1. `…/clips/` öffnen und mit **stark.liam2011@gmail.com** anmelden. Dieses
   Konto ist der Admin.
2. Namen wählen → **Beitreten**.
3. Unten auf **Profil** → **Link kopieren** und den Link deinen Freunden schicken.
4. Freunde öffnen den Link, registrieren sich (oder melden sich mit ihrem
   BörsenTycoon-/Schach-Konto an), wählen einen Namen und sind drin.

Einen Einladungscode gibt es nicht: Wer den Link kennt und sich ein Konto macht,
kann beitreten. Wenn jemand drin ist, der nicht reingehört: im Profil unter
**Gruppe** auf **Entfernen** tippen. Die Person wird dann gesperrt und kann nicht
wieder beitreten. Unter **Gesperrt** kannst du die Sperre wieder aufheben.

## Reihenfolge im Feed

Beim Öffnen sortiert Clips den Feed neu:

1. Zuerst Videos von anderen, die du noch nicht gesehen hast. Neue und
   beliebte (Likes, Kommentare) kommen weiter nach vorne, dazu etwas Zufall.
2. Danach deine eigenen und schon gesehene Videos, die am längsten nicht mehr
   gesehenen zuerst.
3. Dieselbe Person kommt möglichst nicht zweimal hintereinander.

Ein Video gilt als gesehen, wenn es 2 Sekunden lief. Das wird in deinem Konto
gespeichert und gilt deshalb auf allen Geräten.

## Wer darf was? (durch die Datenbank-Regeln abgesichert)

- Nur Mitglieder sehen Videos, Likes, Kommentare und die Mitgliederliste.
  Ohne Konto und Namen sieht man nichts, auch nicht über Umwege.
- Jeder Name kommt nur einmal vor (Groß-/Kleinschreibung egal: „Max“ und
  „max“ gelten als gleich). Wer schon Mitglied war, bekommt seinen Namen beim
  nächsten Öffnen automatisch reserviert.
- Profilbilder kann nur jede Person für sich selbst ändern.
- Videos löschen kann nur, wer sie gepostet hat (und du als Admin).
- Likes können nicht gefälscht werden: Jede Person kann ein Video nur einmal
  liken, und der Zähler ändert sich nur zusammen mit dem eigenen Like.
- Kommentare löschen kann, wer sie geschrieben hat, wem das Video gehört und
  der Admin.

## Grenzen (kostenloses Firebase-Kontingent)

Die Videos liegen direkt in der Firestore-Datenbank, aufgeteilt in Stücke
unter 1 MB. Dafür braucht man keinen kostenpflichtigen Firebase-Tarif.

- Es gibt **keine feste Längengrenze**. Technisch passen bis etwa 260 MB in
  die Datenbank, das sind nach dem Verkleinern gut 60 Minuten. Lange Videos
  brauchen beim Abspielen länger, bis sie starten, weil erst alles geladen wird.
- Große Videos (z. B. vom Handy) werden vor dem Hochladen **im Browser
  verkleinert** (max. 960 px, etwa 1,3 MBit/s, lange Videos etwas weniger). Das dauert so lange wie das
  Video. Die Seite muss dabei offen bleiben. Kleine mp4/webm-Dateien
  (bis 8 MB) werden direkt hochgeladen.
- Das kostenlose Kontingent: 1 GB Speicher insgesamt, etwa 10 GB Download pro
  Monat. Ein Video hat nach dem Verkleinern meist 3–10 MB (lange Videos: etwa 4 MB pro Minute). Für eine
  Freundesgruppe reicht das, für hunderte Videos nicht. Wenn es knapp wird:
  alte Videos löschen.
