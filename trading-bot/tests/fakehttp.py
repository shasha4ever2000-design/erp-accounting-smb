"""A stand-in for requests.Session that replays scripted answers and records calls."""


class FakeResponse:
    def __init__(self, status=200, body=None, headers=None):
        self.status_code = status
        self._body = body if body is not None else {}
        self.headers = headers or {}
        self.text = str(self._body)

    def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


class FakeSession:
    def __init__(self):
        self.calls = []       # (method, path, headers, json, params)
        self.routes = {}      # (method, path) -> list of FakeResponse (used in order, last one repeats)

    def on(self, method, path, *responses):
        self.routes[(method, path)] = list(responses)
        return self

    def request(self, method, url, headers=None, json=None, params=None, timeout=None):
        path = "/" + url.split("/", 3)[3]
        self.calls.append((method, path, dict(headers or {}), json, params))
        self.last_url = url
        queue = self.routes.get((method, path))
        if not queue:
            return FakeResponse(404, {"errorCode": "error.not-found"})
        return queue.pop(0) if len(queue) > 1 else queue[0]

    def calls_to(self, method, path):
        return [c for c in self.calls if c[0] == method and c[1] == path]


LOGIN_OK = FakeResponse(
    200,
    {"accountType": "CFD", "currencyIsoCode": "USD", "currentAccountId": "111",
     "accountInfo": {"balance": 10250.0, "deposit": 10000.0, "profitLoss": 250.0, "available": 8000.0}},
    {"CST": "cst-token", "X-SECURITY-TOKEN": "sec-token"},
)
