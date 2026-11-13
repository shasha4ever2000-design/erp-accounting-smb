from tests.fakehttp import FakeResponse
from tradebot.notify import ConsoleNotifier, TelegramNotifier, split_message


class Http:
    def __init__(self, response=None, error=None):
        self.posts, self.response, self.error = [], response or FakeResponse(200, {"ok": True}), error

    def post(self, url, json=None, timeout=None):
        self.posts.append((url, json))
        if self.error:
            raise self.error
        return self.response


def test_telegram_sends_to_the_chat():
    http = Http()
    assert TelegramNotifier("TOKEN", "42", http=http).send("hello") is True
    url, body = http.posts[0]
    assert url == "https://api.telegram.org/botTOKEN/sendMessage"
    assert body["chat_id"] == "42" and body["text"] == "hello"


def test_long_message_is_split_on_line_breaks():
    text = "\n".join(f"line {i} " + "x" * 90 for i in range(100))  # about 10,000 characters
    parts = split_message(text, 4000)
    assert len(parts) == 3
    assert all(len(p) <= 4000 for p in parts)
    assert "\n".join(parts) == text
    http = Http()
    TelegramNotifier("T", "1", http=http).send(text)
    assert len(http.posts) == 3


def test_a_single_very_long_line_is_still_split():
    assert [len(p) for p in split_message("y" * 9000, 4000)] == [4000, 4000, 1000]


def test_failure_returns_false_and_never_raises_or_leaks_the_token(capsys):
    for http in (Http(FakeResponse(401, {"ok": False})), Http(error=RuntimeError("boom botSECRET-TOKEN"))):
        assert TelegramNotifier("SECRET-TOKEN", "1", http=http).send("hi") is False
    assert "SECRET-TOKEN" not in capsys.readouterr().out


def test_console_notifier_prints(capsys):
    assert ConsoleNotifier().send("hello") is True
    assert "hello" in capsys.readouterr().out
