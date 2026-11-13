"""A few headlines from a free news feed. Never raises: no news is not an error."""

from __future__ import annotations

import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

FEED = "https://news.google.com/rss/search?q={query}&hl=en-US&gl=US&ceid=US:en"


def _fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "tradebot-news-reader"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read().decode("utf-8", errors="replace")


def headlines(query: str, limit: int = 2, fetch=_fetch, feed: str = FEED) -> list[str]:
    try:
        text = fetch(feed.format(query=urllib.parse.quote(query)))
        root = ET.fromstring(text)
        titles = [(item.findtext("title") or "").strip() for item in root.iter("item")]
        return [t for t in titles if t][:limit]
    except Exception:
        return []
