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
   Konto ist der Admin und braucht keinen Einladungscode.
2. Namen wählen → **Beitreten**.
3. Unten auf **Profil** → **Neuen Einladungslink erstellen**. Der Link wird
   kopiert. Schick ihn deinen Freunden.
4. Freunde öffnen den Link, registrieren sich (oder melden sich mit ihrem
   BörsenTycoon-/Schach-Konto an) und sind drin.

Wenn alle drin sind, kannst du den Einladungscode löschen. Dann kommt niemand
Neues mehr rein. Wer schon drin ist, bleibt drin. Im Profil unter **Gruppe**
kannst du Leute auch wieder entfernen (dann auch den Code löschen, sonst können
sie wieder beitreten).

## Wer darf was? (durch die Datenbank-Regeln abgesichert)

- Nur Mitglieder sehen Videos, Likes, Kommentare und die Mitgliederliste.
  Ohne Einladung sieht man nichts, auch nicht über Umwege.
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

- Videos dürfen höchstens **5 Minuten** lang sein.
- Große Videos (z. B. vom Handy) werden vor dem Hochladen **im Browser
  verkleinert** (max. 960 px, etwa 1,3 MBit/s, lange Videos etwas weniger). Das dauert so lange wie das
  Video. Die Seite muss dabei offen bleiben. Kleine mp4/webm-Dateien
  (bis 8 MB) werden direkt hochgeladen.
- Das kostenlose Kontingent: 1 GB Speicher insgesamt, etwa 10 GB Download pro
  Monat. Ein Video hat nach dem Verkleinern meist 3–10 MB (5 Minuten: bis 30 MB). Für eine
  Freundesgruppe reicht das, für hunderte Videos nicht. Wenn es knapp wird:
  alte Videos löschen.
