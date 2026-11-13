from tradebot.news import headlines

RSS = """<?xml version="1.0"?><rss version="2.0"><channel><title>feed</title>
<item><title>Apple unveils new chip - Reuters</title><link>http://x/1</link></item>
<item><title>Apple &amp; partners expand in India</title></item>
<item><title>Third story</title></item>
</channel></rss>"""


def test_headlines_reads_item_titles_up_to_the_limit():
    seen = []
    out = headlines("Apple stock", limit=2, fetch=lambda url: seen.append(url) or RSS)
    assert out == ["Apple unveils new chip - Reuters", "Apple & partners expand in India"]
    assert "Apple%20stock" in seen[0] or "Apple+stock" in seen[0]


def test_headlines_returns_empty_on_any_failure():
    def boom(url):
        raise OSError("network down")

    assert headlines("Apple stock", fetch=boom) == []
    assert headlines("Apple stock", fetch=lambda url: "<html>not a feed") == []
    assert headlines("Apple stock", fetch=lambda url: "") == []
