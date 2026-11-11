"""GitHub Actions trigger candidate. It never accepts recipients or sends mail.

The server checks its own due time, claims and provider outcomes. This client
must stop on transport uncertainty; no response body or secret is logged.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

URL = "https://ofasbfpeapbdcotnptvz.supabase.co/functions/v1/youtube-manual-scheduler"
AUDIENCE = "sanji-youtube-scheduler-v1"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class IdentityInputInvalid(ValueError):
    REASONS = frozenset({"url_type", "url_too_long", "token_type", "token_length", "token_whitespace", "url_parse", "url_scheme", "url_credentials", "url_port", "url_fragment", "url_host_vstoken", "url_host_regional_pipelines", "url_host_run_actions", "url_host_actions_subdomain", "url_host_other"})

    def __init__(self, reason):
        self.reason = reason if reason in self.REASONS else "other"
        super().__init__("GitHub identity input invalid")


def github_token(request_url, request_token, opener=None):
    if not isinstance(request_url, str):
        raise IdentityInputInvalid("url_type")
    if len(request_url) > 8192:
        raise IdentityInputInvalid("url_too_long")
    if not isinstance(request_token, str):
        raise IdentityInputInvalid("token_type")
    if not 1 <= len(request_token) <= 8192:
        raise IdentityInputInvalid("token_length")
    if any(c.isspace() for c in request_token):
        raise IdentityInputInvalid("token_whitespace")
    try:
        url = urllib.parse.urlsplit(request_url)
        host, port = url.hostname, url.port
    except ValueError:
        raise IdentityInputInvalid("url_parse") from None
    if url.scheme != "https":
        raise IdentityInputInvalid("url_scheme")
    if url.username or url.password:
        raise IdentityInputInvalid("url_credentials")
    if port not in (None, 443):
        raise IdentityInputInvalid("url_port")
    if url.fragment:
        raise IdentityInputInvalid("url_fragment")
    if host not in ("pipelines.actions.githubusercontent.com", "token.actions.githubusercontent.com"):
        if host == "vstoken.actions.githubusercontent.com":
            raise IdentityInputInvalid("url_host_vstoken")
        if host and re.fullmatch(r"pipelines[a-z0-9-]{1,48}\.actions\.githubusercontent\.com", host):
            raise IdentityInputInvalid("url_host_regional_pipelines")
        if host and re.fullmatch(r"run-actions-[a-z0-9-]{1,48}\.actions\.githubusercontent\.com", host):
            raise IdentityInputInvalid("url_host_run_actions")
        raise IdentityInputInvalid("url_host_actions_subdomain" if host and host.endswith(".actions.githubusercontent.com") else "url_host_other")
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


def health_diagnostic(environ, get_token=github_token, check_health=health):
    """Only fixed stage labels and HTTP status are returned; no exception text."""
    def failed(stage, kind, exc=None):
        result = {"stage": stage, "result": kind}
        if isinstance(exc, urllib.error.HTTPError) and type(exc.code) is int and 100 <= exc.code <= 599:
            result["http_status"] = exc.code
        return False, result

    request_url = environ.get("ACTIONS_ID_TOKEN_REQUEST_URL", "")
    request_token = environ.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN", "")
    if not request_url or not request_token:
        return failed("identity_input", "missing")
    try:
        token = get_token(request_url, request_token)
    except IdentityInputInvalid as exc:
        return failed("identity_input", exc.reason)
    except urllib.error.HTTPError as exc:
        return failed("identity_request", "http_error", exc)
    except (urllib.error.URLError, TimeoutError):
        return failed("identity_request", "transport_error")
    except Exception:
        return failed("identity_request", "invalid_or_unavailable")

    try:
        check_health(token)
    except urllib.error.HTTPError as exc:
        return failed("scheduler_health", "http_error", exc)
    except (urllib.error.URLError, TimeoutError):
        return failed("scheduler_health", "transport_error")
    except Exception:
        return failed("scheduler_health", "invalid_or_unavailable")
    return True, {"stage": "scheduler_health", "result": "authenticated"}


if __name__ == "__main__":
    try:
        if sys.argv[1:] not in ([], ["--health"]):
            raise ValueError("invalid mode")
        if sys.argv[1:] == ["--health"]:
            ok, result = health_diagnostic(os.environ)
            print(json.dumps(result, separators=(",", ":")), file=sys.stdout if ok else sys.stderr)
            sys.exit(0 if ok else 1)
        token = github_token(os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL", ""), os.environ.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN", ""))
        trigger(token)
    except Exception:
        print("Scheduler did not complete; review status before further action.", file=sys.stderr)
        sys.exit(1)
    print("Scheduler checked due work.")
