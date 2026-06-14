"""KI-Tutor: erklaert offene Hausaufgaben - loest sie NICHT.

Liest output/offen_status.json, schickt jede offene Aufgabe an Claude mit der
klaren Anweisung, nur zu ERKLAEREN (L-oesungsweg, Konzepte, Tipps) und KEINE
fertige Loesung zu liefern, und sendet die Erklaerung per WhatsApp.

Braucht einen Anthropic API-Key in der Umgebung:
    ANTHROPIC_API_KEY=sk-ant-...

Anti-Spam: bereits erklaerte Aufgaben werden in state/explained_homework.txt
gemerkt und nicht erneut erklaert.
"""
from __future__ import annotations

import hashlib
import json
import os

import config
from notify import send_whatsapp

STATUS_FILE = config.OUTPUT_DIR / "offen_status.json"

# Modell + System-Prompt. WICHTIG: nur erklaeren, niemals loesen.
MODELL = "claude-opus-4-8"
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


def erklaere(client, kurs: str, thema: str, hausaufgabe: str) -> str:
    frage = (
        f"Fach: {kurs}\n"
        f"Thema: {thema}\n"
        f"Aufgabenstellung: {hausaufgabe}\n\n"
        "Erklaere mir, was ich machen muss und wie ich rangehe."
    )
    resp = client.messages.create(
        model=MODELL,
        max_tokens=4000,
        thinking={"type": "adaptive"},
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": frage}],
    )
    return "".join(b.text for b in resp.content if b.type == "text").strip()


def main() -> int:
    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        print("Kein ANTHROPIC_API_KEY gesetzt - Tutor wird uebersprungen.")
        return 0

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

    # SDK erst hier importieren, damit das Skript ohne Paket nicht hart abbricht.
    import anthropic

    client = anthropic.Anthropic(api_key=api_key)
    explained = _load_explained()

    for a in offen:
        kurs = a.get("kurs", "")
        thema = a.get("thema", "")
        ha = (a.get("hausaufgabe") or "").strip()
        sig = _sig(kurs, ha)
        if sig in explained:
            print(f"Schon erklaert: {kurs} - uebersprungen.")
            continue

        print(f"Erklaere Aufgabe: {kurs} ...")
        try:
            erklaerung = erklaere(client, kurs, thema, ha)
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
