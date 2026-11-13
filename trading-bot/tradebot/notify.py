"""Sends messages to the owner. Telegram in real use, the screen when trying things out."""

from __future__ import annotations

import requests

TELEGRAM_LIMIT = 4000


def split_message(text: str, limit: int = TELEGRAM_LIMIT) -> list[str]:
    parts: list[str] = []
    current = ""
    for line in text.split("\n"):
        while len(line) > limit:                      # one enormous line
            if current:
                parts.append(current)
                current = ""
            parts.append(line[:limit])
            line = line[limit:]
        candidate = line if not current else current + "\n" + line
        if len(candidate) > limit:
            parts.append(current)
            current = line
        else:
            current = candidate
    if current or not parts:
        parts.append(current)
    return parts


class ConsoleNotifier:
    def send(self, text: str) -> bool:
        print(text)
        print("-" * 40)
        return True


class TelegramNotifier:
    def __init__(self, token: str, chat_id: str, http=requests):
        self._token = token
        self._chat_id = chat_id
        self._http = http

    def send(self, text: str) -> bool:
        ok = True
        for part in split_message(text):
            try:
                resp = self._http.post(
                    f"https://api.telegram.org/bot{self._token}/sendMessage",
                    json={"chat_id": self._chat_id, "text": part, "disable_web_page_preview": True},
                    timeout=30,
                )
                if resp.status_code != 200:
                    print(f"Telegram refused the message (HTTP {resp.status_code})")
                    ok = False
            except Exception as exc:  # a failed ping must never stop the bot
                print(f"Could not reach Telegram ({type(exc).__name__})")
                ok = False
        return ok
