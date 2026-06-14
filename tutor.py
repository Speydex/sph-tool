"""KI-Tutor mit Google Gemini (kostenlose API): erklaert offene Hausaufgaben
- loest sie NICHT.

Liest output/offen_status.json, schickt jede offene Aufgabe an Gemini mit der
klaren Anweisung, nur zu ERKLAEREN (Loesungsweg, Konzepte, Tipps) und KEINE
fertige Loesung zu liefern, und sendet die Erklaerung per WhatsApp.

Braucht einen kostenlosen Gemini-Schluessel in der Umgebung:
    GEMINI_API_KEY=...          (von https://aistudio.google.com)
    GEMINI_MODEL=gemini-2.5-flash   (optional, Standardmodell)

Anti-Spam: bereits erklaerte Aufgaben werden in state/explained_homework.txt
gemerkt und nicht erneut erklaert.
"""
from __future__ import annotations

import hashlib
import json
import os
import urllib.error
import urllib.request

import config
from notify import send_whatsapp

STATUS_FILE = config.OUTPUT_DIR / "offen_status.json"

DEFAULT_MODEL = "gemini-2.5-flash"
SYSTEM_PROMPT = (
    "Du bist ein geduldiger Tutor fuer einen Schueler der 8. Klasse. "
    "Erklaere die gestellte Hausaufgabe so, dass der Schueler sie SELBST loesen kann: "
    "(1) was die Aufgabe verlangt, in einfachen Worten, "
    "(2) welche Konzepte/Methoden man braucht, "
    "(3) einen LoesungsWEG in nachvollziehbaren Schritten, "
    "(4) optional einen kurzen Tipp. "
    "ABSOLUT WICHTIG: Gib NIEMALS die fertige Loesung oder das Endergebnis an. "
    "Keine fertigen Rechenergebnisse, keine fertigen Texte zum Abschreiben, "
    "keine ausgefuellten Antworten. Der Schueler soll es selbst machen - du hilfst nur. "
    "Antworte auf Deutsch, freundlich und kurz (WhatsApp-tauglich, hoechstens ~12 Zeilen)."
)


def _sig(kurs: str, hausaufgabe: str) -> str:
    return hashlib.sha256(f"{kurs}|{hausaufgabe}".encode("utf-8")).hexdigest()


def _load_explained() -> set[str]:
    if config.EXPLAINED_FILE.exists():
        return set(config.EXPLAINED_FILE.read_text(encoding="utf-8").split())
    return set()


def _save_explained(sigs: set[str]) -> None:
    config.EXPLAINED_FILE.write_text("\n".join(sorted(sigs)), encoding="utf-8")


def erklaere(api_key: str, model: str, kurs: str, thema: str, hausaufgabe: str) -> str:
    """Ruft die Gemini-REST-API auf und gibt die Erklaerung zurueck."""
    frage = (
        f"Fach: {kurs}\n"
        f"Thema: {thema}\n"
        f"Aufgabenstellung: {hausaufgabe}\n\n"
        "Erklaere mir, was ich machen muss und wie ich rangehe."
    )
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    )
    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [{"role": "user", "parts": [{"text": frage}]}],
        "generationConfig": {"temperature": 0.7, "maxOutputTokens": 1200},
    }
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        out = json.loads(resp.read().decode("utf-8"))

    candidates = out.get("candidates", [])
    if not candidates:
        raise RuntimeError(f"Keine Antwort von Gemini (evtl. blockiert): {out}")
    parts = candidates[0].get("content", {}).get("parts", [])
    text = "".join(p.get("text", "") for p in parts).strip()
    if not text:
        raise RuntimeError(f"Leere Antwort von Gemini: {out}")
    return text


def main() -> int:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        print("Kein GEMINI_API_KEY gesetzt - Tutor wird uebersprungen.")
        return 0

    model = os.getenv("GEMINI_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL
    phone = os.getenv("CALLMEBOT_PHONE", "").strip()
    apikey_wa = os.getenv("CALLMEBOT_APIKEY", "").strip()

    if not STATUS_FILE.exists():
        print(f"Keine Status-Datei gefunden: {STATUS_FILE}")
        return 1

    status = json.loads(STATUS_FILE.read_text(encoding="utf-8"))
    offen = [a for a in status.get("offen", []) if (a.get("hausaufgabe") or "").strip()]
    if not offen:
        print("Keine offenen Hausaufgaben - nichts zu erklaeren.")
        return 0

    explained = _load_explained()

    for a in offen:
        kurs = a.get("kurs", "")
        thema = a.get("thema", "")
        ha = (a.get("hausaufgabe") or "").strip()
        sig = _sig(kurs, ha)
        if sig in explained:
            print(f"Schon erklaert: {kurs} - uebersprungen.")
            continue

        print(f"Erklaere Aufgabe ({model}): {kurs} ...")
        try:
            erklaerung = erklaere(api_key, model, kurs, thema, ha)
        except urllib.error.HTTPError as exc:
            print(f"  HTTP-FEHLER {exc.code}: {exc.read().decode('utf-8', 'replace')[:300]}")
            continue
        except Exception as exc:  # noqa: BLE001
            print(f"  FEHLER bei der Erklaerung: {exc}")
            continue

        nachricht = f"\U0001F393 {kurs} – Hilfe zur Aufgabe\n{thema}\n\n{erklaerung}"
        print("--- Erklaerung ---")
        print(erklaerung)

        if phone and apikey_wa:
            try:
                send_whatsapp(phone, apikey_wa, nachricht)
                print("  -> per WhatsApp gesendet.")
            except Exception as exc:  # noqa: BLE001
                print(f"  WhatsApp-Fehler: {exc}")
        else:
            print("  (keine CallMeBot-Daten - nur angezeigt, nicht gesendet)")

        explained.add(sig)

    _save_explained(explained)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
