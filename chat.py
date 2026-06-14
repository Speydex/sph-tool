r"""Einfacher KI-Chat im Terminal (nutzt den kostenlosen Groq-Schluessel).

Starten:
    .\.venv\Scripts\python chat.py

Tippe deine Frage und druecke Enter. Zum Beenden 'exit', 'ende' oder leere
Zeile eingeben. Das Programm merkt sich den Gespraechsverlauf, du kannst also
nachfragen ("und warum?", "erklaer das einfacher", ...).
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

import config  # laedt die .env (GROQ_API_KEY)

# Windows-Konsole auf UTF-8 stellen, damit Umlaute/Emojis nicht abstuerzen.
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stdin.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

API_URL = "https://api.groq.com/openai/v1/chat/completions"
DEFAULT_MODEL = "llama-3.3-70b-versatile"
SYSTEM_PROMPT = (
    "Du bist ein hilfsbereiter, freundlicher Assistent fuer einen Schueler. "
    "Antworte klar, verstaendlich und auf Deutsch (ausser der Nutzer schreibt "
    "in einer anderen Sprache). Bei Schulaufgaben hilf beim VERSTEHEN und zeige "
    "den Loesungsweg, statt einfach nur das Ergebnis zu nennen."
)


def ask(api_key: str, model: str, messages: list[dict]) -> str:
    body = {"model": model, "messages": messages, "temperature": 0.7, "max_tokens": 1500}
    req = urllib.request.Request(
        API_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) sph-tool/1.0",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        out = json.loads(resp.read().decode("utf-8"))
    return (out["choices"][0]["message"]["content"] or "").strip()


def main() -> int:
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key:
        print("Kein GROQ_API_KEY in der .env gefunden. Bitte erst eintragen.")
        return 1
    model = os.getenv("GROQ_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL

    print("=" * 56)
    print(f"  KI-Chat (Modell: {model})")
    print("  Frage eingeben + Enter. Beenden mit 'exit' oder leerer Zeile.")
    print("=" * 56)

    messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
    while True:
        try:
            user = input("\nDu: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nTschuess!")
            break
        if user.lower() in ("exit", "quit", "ende", ""):
            print("Tschuess!")
            break

        messages.append({"role": "user", "content": user})
        try:
            antwort = ask(api_key, model, messages)
        except urllib.error.HTTPError as exc:
            print(f"  [Fehler {exc.code}] {exc.read().decode('utf-8', 'replace')[:200]}")
            messages.pop()  # fehlgeschlagene Frage wieder entfernen
            continue
        except Exception as exc:  # noqa: BLE001
            print(f"  [Fehler] {exc}")
            messages.pop()
            continue

        print(f"\nKI: {antwort}")
        messages.append({"role": "assistant", "content": antwort})

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
