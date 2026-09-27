"""Regression checks for the browser-facing localhost API boundary."""

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from starlette.responses import JSONResponse

_state_dir = tempfile.TemporaryDirectory()
os.environ["JEV_SETTINGS_FILE"] = str(Path(_state_dir.name) / "settings.json")
os.environ["JEV_HISTORY_DB"] = str(Path(_state_dir.name) / "history.db")
os.environ["JEV_SERVICE_TOKEN"] = "unit-test-service-token-value"

from backend.app import (  # noqa: E402 - configure isolated state before import
    LocalRequestBoundary,
    SERVICE_TOKEN,
    SERVICE_TOKEN_COOKIE,
    app,
    write_private_text,
)

AUTH = {"Authorization": f"Bearer {SERVICE_TOKEN}"}


class LocalRequestBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.reached_backend = 0

        async def backend(scope, receive, send):
            self.reached_backend += 1
            await JSONResponse({"ok": True})(scope, receive, send)

        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=LocalRequestBoundary(backend, service_token=SERVICE_TOKEN)),
            base_url="http://127.0.0.1:8766",
        )

    async def asyncTearDown(self):
        await self.client.aclose()

    async def test_local_browser_and_widget_requests_work(self):
        browser = await self.client.get(
            "/api/health", headers={**AUTH, "Origin": "http://127.0.0.1:8766"}
        )
        widget = await self.client.get(
            "/api/health", headers={**AUTH, "Origin": "null", "X-Jev-Widget": "1"}
        )
        localhost = await self.client.get(
            "/api/health",
            headers={**AUTH, "Host": "localhost:8766", "Origin": "http://localhost:8766"},
        )
        self.assertEqual(browser.status_code, 200)
        self.assertEqual(widget.status_code, 200)
        self.assertEqual(localhost.status_code, 200)
        self.assertEqual(self.reached_backend, 3)

    def test_guard_is_installed_on_real_app(self):
        self.assertTrue(any(middleware.cls is LocalRequestBoundary for middleware in app.user_middleware))

    async def test_real_local_api_remains_usable(self):
        async def inline_handler(function, *args, **kwargs):
            return function(*args, **kwargs)

        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1:8766"
        ) as client:
            with patch("fastapi.routing.run_in_threadpool", side_effect=inline_handler):
                health = await client.get("/api/health", headers=AUTH)
                created = await client.post(
                    "/api/drafts",
                    headers={**AUTH, "Origin": "http://127.0.0.1:8766"},
                    json={"draft": {"state": "local test"}},
                )
                blocked = await client.get(
                    "/api/drafts", headers={**AUTH, "Host": "attacker.example:8766"}
                )
                drafts = await client.get("/api/drafts", headers=AUTH)
        self.assertEqual(health.status_code, 200)
        self.assertEqual(created.status_code, 200)
        self.assertEqual(blocked.status_code, 403)
        self.assertEqual(drafts.json()["total"], 1)

    async def test_dns_rebinding_host_cannot_read_local_data(self):
        for path in ("/api/settings/api-keys", "/api/history", "/api/drafts"):
            with self.subTest(path=path):
                response = await self.client.get(path, headers={**AUTH, "Host": "attacker.example:8766"})
                self.assertEqual(response.status_code, 403)
        self.assertEqual(self.reached_backend, 0)

    async def test_malformed_or_duplicate_hosts_are_rejected(self):
        for headers in (
            {**AUTH, "Host": "127.0.0.1.attacker.example:8766"},
            {**AUTH, "Host": "attacker.example@127.0.0.1:8766"},
            [("Authorization", AUTH["Authorization"]), ("Host", "127.0.0.1:8766"), ("Host", "attacker.example:8766")],
        ):
            with self.subTest(headers=headers):
                response = await self.client.get("/api/health", headers=headers)
                self.assertEqual(response.status_code, 403)
        self.assertEqual(self.reached_backend, 0)

    async def test_dns_rebinding_host_cannot_write_or_spend(self):
        draft = await self.client.post(
            "/api/drafts",
            headers={**AUTH, "Host": "attacker.example:8766"},
            json={"draft": {"state": "malicious"}},
        )
        paid = await self.client.post(
            "/api/jev/challenge",
            headers={**AUTH, "Host": "attacker.example:8766"},
            json={"state": "malicious", "questions": {}},
        )
        self.assertEqual(draft.status_code, 403)
        self.assertEqual(paid.status_code, 403)
        self.assertEqual(self.reached_backend, 0)

    async def test_cross_origin_and_cross_site_requests_are_rejected(self):
        for headers in (
            {**AUTH, "Origin": "http://attacker.example"},
            {**AUTH, "Origin": "null"},
            {**AUTH, "Referer": "http://attacker.example/page"},
            {**AUTH, "Sec-Fetch-Site": "cross-site"},
        ):
            with self.subTest(headers=headers):
                response = await self.client.post("/api/drafts", headers=headers, json={"draft": {}})
                self.assertEqual(response.status_code, 403)
        self.assertEqual(self.reached_backend, 0)

    async def test_widget_cross_site_fetch_with_token_is_accepted(self):
        # Quickshell may send Sec-Fetch-Site: cross-site; X-Jev-Widget:1 opts out of that alone.
        response = await self.client.get(
            "/api/health",
            headers={
                **AUTH,
                "X-Jev-Widget": "1",
                "Sec-Fetch-Site": "cross-site",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.reached_backend, 1)

    async def test_widget_cross_site_without_token_is_rejected(self):
        response = await self.client.get(
            "/api/health",
            headers={
                "X-Jev-Widget": "1",
                "Sec-Fetch-Site": "cross-site",
            },
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.reached_backend, 0)

    async def test_missing_token_is_rejected(self):
        for path in ("/api/health", "/api/history", "/api/drafts", "/api/settings/api-keys"):
            with self.subTest(path=path):
                response = await self.client.get(path)
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.json()["detail"], "Authentication required.")
        self.assertEqual(self.reached_backend, 0)

    async def test_wrong_token_is_rejected(self):
        response = await self.client.get(
            "/api/history", headers={"Authorization": "Bearer wrong-token-value"}
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.reached_backend, 0)

    async def test_cookie_token_is_accepted(self):
        response = await self.client.get(
            "/api/health",
            headers={"Cookie": f"{SERVICE_TOKEN_COOKIE}={SERVICE_TOKEN}"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.reached_backend, 1)

    async def test_valid_bearer_can_read_history(self):
        async def inline_handler(function, *args, **kwargs):
            return function(*args, **kwargs)

        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1:8766"
        ) as client:
            with patch("fastapi.routing.run_in_threadpool", side_effect=inline_handler):
                denied = await client.get("/api/history")
                allowed = await client.get("/api/history", headers=AUTH)
        self.assertEqual(denied.status_code, 401)
        self.assertEqual(allowed.status_code, 200)
        self.assertIn("items", allowed.json())

    async def test_fastapi_docs_are_disabled(self):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1:8766"
        ) as client:
            docs = await client.get("/docs")
            openapi = await client.get("/openapi.json")
            redoc = await client.get("/redoc")
        self.assertEqual(docs.status_code, 200)  # SPA catch-all serves index.html
        self.assertEqual(openapi.status_code, 200)
        self.assertEqual(redoc.status_code, 200)
        # OpenAPI schema endpoint must not expose JSON schema even if HTML is served.
        self.assertIsNone(app.openapi_url)
        self.assertIsNone(app.docs_url)
        self.assertIsNone(app.redoc_url)

    async def test_oversized_draft_is_rejected(self):
        async def inline_handler(function, *args, **kwargs):
            return function(*args, **kwargs)

        huge = {"state": "x" * 600_000}
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1:8766"
        ) as client:
            with patch("fastapi.routing.run_in_threadpool", side_effect=inline_handler):
                response = await client.post(
                    "/api/drafts",
                    headers={**AUTH, "Origin": "http://127.0.0.1:8766"},
                    json={"draft": huge},
                )
        self.assertEqual(response.status_code, 413)

    async def test_session_cookie_exchange_and_claim(self):
        async def inline_handler(function, *args, **kwargs):
            return function(*args, **kwargs)

        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1:8766"
        ) as client:
            with patch("fastapi.routing.run_in_threadpool", side_effect=inline_handler):
                denied = await client.post("/api/session/cookie")
                issued = await client.post("/api/session/cookie", headers=AUTH)
                claim_cold = await client.post("/session/claim")
                prepared = await client.post("/api/session/prepare-browser", headers=AUTH)
                claimed = await client.post("/session/claim")
                claim_again = await client.post("/session/claim")
        self.assertEqual(denied.status_code, 401)
        self.assertEqual(issued.status_code, 200)
        self.assertIn(SERVICE_TOKEN_COOKIE, issued.headers.get("set-cookie", ""))
        self.assertEqual(claim_cold.status_code, 401)
        self.assertEqual(prepared.status_code, 200)
        self.assertEqual(claimed.status_code, 200)
        self.assertIn(SERVICE_TOKEN_COOKIE, claimed.headers.get("set-cookie", ""))
        self.assertEqual(claim_again.status_code, 401)

    def test_private_write_creates_0600_and_700_parent(self):
        target = Path(_state_dir.name) / "nested" / "secret.json"
        write_private_text(target, '{"ok": true}')
        self.assertEqual(stat_mode(target.parent), 0o700)
        self.assertEqual(stat_mode(target), 0o600)

    def test_symlink_destination_is_refused(self):
        real = Path(_state_dir.name) / "real-settings.json"
        link = Path(_state_dir.name) / "link-settings.json"
        real.write_text("{}", encoding="utf-8")
        if link.exists() or link.is_symlink():
            link.unlink()
        link.symlink_to(real)
        with self.assertRaises(OSError):
            write_private_text(link, '{"nope": true}')

        broken = Path(_state_dir.name) / "broken-link.json"
        if broken.is_symlink():
            broken.unlink()
        broken.symlink_to(Path(_state_dir.name) / "nonexistent-target.json")
        with self.assertRaises(OSError):
            write_private_text(broken, '{"nope": true}')


    async def test_widget_file_origin_with_token_is_accepted(self):
        response = await self.client.get(
            "/api/health",
            headers={**AUTH, "X-Jev-Widget": "1", "Origin": "file://"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.reached_backend, 1)

    async def test_widget_file_referer_with_token_is_accepted(self):
        response = await self.client.post(
            "/api/health",
            headers={
                **AUTH,
                "X-Jev-Widget": "1",
                "Origin": "file://",
                "Referer": "file:///home/user/.config/omarchy/plugins/jev/LabPanel.qml",
            },
        )
        # LocalRequestBoundary wraps a stub that accepts any method as 200
        self.assertEqual(response.status_code, 200)

    async def test_file_origin_without_widget_is_rejected(self):
        response = await self.client.get(
            "/api/health",
            headers={**AUTH, "Origin": "file://"},
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.reached_backend, 0)

    async def test_security_headers_are_present(self):
        response = await self.client.get(
            "/api/health",
            headers=AUTH,
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("x-content-type-options"), "nosniff")
        self.assertEqual(response.headers.get("x-frame-options"), "DENY")


def stat_mode(path: Path) -> int:
    return path.stat().st_mode & 0o777


if __name__ == "__main__":
    unittest.main()

