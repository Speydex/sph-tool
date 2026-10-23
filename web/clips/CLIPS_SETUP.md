# Clips: einmalige Einrichtung

Clips ist eine private Video-App (wie TikTok) nur für dich und deine Freunde:
Videos hochladen, im Feed hochwischen, liken (auch per Doppeltipp),
kommentieren, Profile ansehen.

Clips nutzt dasselbe Firebase-Projekt wie BörsenTycoon und Schach
(`crypto-trading-ccd35`). Konten gibt es also schon. Es fehlt nur ein Schritt:

## 1. Regeln veröffentlichen

Am einfachsten automatisch: einmal den Schlüssel bei GitHub hinterlegen (siehe
[`firestore/README.md`](../../firestore/README.md)). Danach veröffentlicht GitHub
die Regeln nach jeder Änderung selbst.

Von Hand geht es so:

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

## Videos per Link (TikTok, YouTube)

Beim Posten kann man statt einer Datei einen **TikTok- oder YouTube-Link**
einfügen (auch YouTube Shorts und TikTok-Kurzlinks). Das Video wird nicht in
Clips gespeichert, sondern im Feed **eingebettet** und vom Player von TikTok
bzw. YouTube abgespielt. Es braucht deshalb keinen Speicherplatz. Likes,
Kommentare und Folgen funktionieren wie bei normalen Videos. Wird das Video bei
TikTok/YouTube gelöscht oder privat gestellt, läuft es auch in Clips nicht mehr.

## Moderation (nichts Nicht-Jugendfreies)

- **Bilderkennung:** Vor dem Hochladen prüft Clips Einzelbilder aus dem Video
  (bis zu 30, über die ganze Länge verteilt) mit einer Erkennung für Nacktheit
  und Pornografie (NSFWJS, läuft im Browser). Schlägt sie an, wird das Video
  nicht hochgeladen. Genauso werden Profilbilder und YouTube-Vorschaubilder
  geprüft. Beim ersten Mal lädt die Erkennung ca. 6 MB, das dauert kurz.
- **Wortfilter:** Beschreibungen, Kommentare, Namen und Titel von verlinkten
  Videos dürfen keine sexuellen Wörter, harten Beleidigungen oder Nazi-Parolen
  enthalten (auch nicht als „p0rn“ oder „p o r n“).
- **Melden:** Jedes Video hat einen **Melden**-Knopf (Fähnchen). Ein gemeldetes
  Video ist sofort für alle ausgeblendet. Der Admin sieht es oben im eigenen
  Profil unter **Gemeldete Videos** (roter Punkt am Profil-Tab) und kann es
  ansehen, **freigeben** oder **löschen**.

Die automatische Prüfung läuft im Browser der Person, die etwas postet. Sie
erkennt nicht alles und kann von jemandem mit Programmierkenntnissen umgangen
werden – deshalb gibt es zusätzlich das Melden.

## Aktivität, Kommentare, #hashtags

- **Aktivität** (Glocke unten): wer dein Video geliket oder kommentiert hat,
  wer dir antwortet, dich mit @Name erwähnt, deinen Kommentar liket oder dir
  neu folgt. Eine Zahl am Tab zeigt, wie viel neu ist.
- **Kommentare:** Auf Kommentare antworten (Antworten stehen eingerückt
  darunter) und Kommentare liken.
- **#hashtags und @Namen** in Beschreibungen und Kommentaren sind anklickbar:
  #hashtag öffnet die Suche, @Name das Profil.

## Als App installieren

Im Profil steht unter **Clips als App**, wie man Clips auf den Home-Bildschirm
legt (iPhone/iPad: Teilen → „Zum Home-Bildschirm“, Android: „Installieren“).
Dann startet Clips im Vollbild mit eigenem Symbol.

## Suchen und Folgen

- Unten auf **Suche**: Kanäle (Namen) und Videos (Beschreibung, #hashtags oder
  Name) finden. Ohne Suchbegriff siehst du alle Kanäle.
- **Folgen** geht in der Suche, im Profil oder über das kleine Plus unter dem
  Profilbild im Feed. Im Profil stehen Follower und wem jemand folgt.
- Oben im Feed: **Für dich** (alle) oder **Folge ich** (nur Leute, denen du
  folgst).

## Reihenfolge im Feed

Beim Öffnen sortiert Clips den Feed neu:

1. Zuerst Videos von anderen, die du noch nicht gesehen hast. Neue und
   beliebte (Likes, Kommentare) und von Leuten, denen du folgst, kommen weiter
   nach vorne, dazu etwas Zufall.
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
