"""GitHub Actions trigger candidate. It never accepts recipients or sends mail.

The server checks its own due time, claims and provider outcomes. This client
must stop on transport uncertainty; no response body or secret is logged.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

URL = "https://ofasbfpeapbdcotnptvz.supabase.co/functions/v1/youtube-manual-scheduler"
AUDIENCE = "sanji-youtube-scheduler-v1"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def github_token(request_url, request_token, opener=None):
    if not isinstance(request_url, str) or len(request_url) > 8192 or not isinstance(request_token, str) or not 1 <= len(request_token) <= 8192 or any(c.isspace() for c in request_token):
        raise ValueError("GitHub identity unavailable")
    url = urllib.parse.urlsplit(request_url)
    if url.scheme != "https" or url.hostname not in ("pipelines.actions.githubusercontent.com", "token.actions.githubusercontent.com") or url.username or url.password or url.port not in (None, 443) or url.fragment:
        raise ValueError("GitHub identity endpoint invalid")
    client = opener or urllib.request.build_opener(NoRedirect())
    target = request_url + ("&" if url.query else "?") + urllib.parse.urlencode({"audience": AUDIENCE})
    req = urllib.request.Request(target, headers={"Authorization": "Bearer " + request_token})
    with client.open(req, timeout=15) as response:
        if response.status != 200:
            raise RuntimeError("GitHub identity unavailable")
        raw = response.read(16385)
    if len(raw) > 16384:
        raise RuntimeError("GitHub identity invalid")
    payload = json.loads(raw)
    token = payload.get("value") if isinstance(payload, dict) else None
    if not isinstance(token, str) or not 1 <= len(token) <= 8192 or any(c.isspace() for c in token):
        raise RuntimeError("GitHub identity invalid")
    return token


def trigger(token, opener=None, maximum=30):
    if not isinstance(token, str) or not 1 <= len(token) <= 8192 or any(c.isspace() for c in token):
        raise ValueError("scheduler identity unavailable")
    if not isinstance(maximum, int) or not 1 <= maximum <= 30:
        raise ValueError("invalid invocation limit")
    client = opener or urllib.request.build_opener(NoRedirect())
    for _ in range(maximum):
        req = urllib.request.Request(URL, data=b"", method="POST", headers={"Authorization": "Bearer " + token})
        with client.open(req, timeout=60) as response:
            if response.status != 200:
                raise RuntimeError("scheduler response unavailable")
            raw = response.read(4097)
        if len(raw) > 4096:
            raise RuntimeError("scheduler response invalid")
        try:
            payload = json.loads(raw)
        except (ValueError, UnicodeError) as exc:
            raise RuntimeError("scheduler response invalid") from exc
        if not isinstance(payload, dict) or set(payload) != {"status"}:
            raise RuntimeError("scheduler response invalid")
        state = payload["status"]
        if state == "idle":
            return "idle"
        if state not in ("scheduled", "complete"):
            raise RuntimeError("scheduler stopped or requires review")
    raise RuntimeError("scheduler invocation limit reached")


def health(token, opener=None):
    if not isinstance(token, str) or not 1 <= len(token) <= 8192 or any(c.isspace() for c in token):
        raise ValueError("scheduler identity unavailable")
    client = opener or urllib.request.build_opener(NoRedirect())
    request = urllib.request.Request(URL + "/auth-health", data=b"", method="POST", headers={"Authorization": "Bearer " + token})
    with client.open(request, timeout=20) as response:
        raw = response.read(4097)
        if response.status != 200 or len(raw) > 4096:
            raise RuntimeError("scheduler health unavailable")
    if json.loads(raw) != {"status": "authenticated"}:
        raise RuntimeError("scheduler health invalid")


if __name__ == "__main__":
    try:
        if sys.argv[1:] not in ([], ["--health"]):
            raise ValueError("invalid mode")
        token = github_token(os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL", ""), os.environ.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN", ""))
        if sys.argv[1:] == ["--health"]:
            health(token)
        else:
            trigger(token)
    except Exception:
        print("Scheduler did not complete; review status before further action.", file=sys.stderr)
        sys.exit(1)
    print("Scheduler checked due work.")
