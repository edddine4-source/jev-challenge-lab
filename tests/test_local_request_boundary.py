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

from backend.app import LocalRequestBoundary, app  # noqa: E402 - configure isolated state before import


class LocalRequestBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.reached_backend = 0

        async def backend(scope, receive, send):
            self.reached_backend += 1
            await JSONResponse({"ok": True})(scope, receive, send)

        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=LocalRequestBoundary(backend)),
            base_url="http://127.0.0.1:8766",
        )

    async def asyncTearDown(self):
        await self.client.aclose()

    async def test_local_browser_and_widget_requests_work(self):
        browser = await self.client.get("/api/health", headers={"Origin": "http://127.0.0.1:8766"})
        widget = await self.client.get(
            "/api/health", headers={"Origin": "null", "X-Jev-Widget": "1"}
        )
        localhost = await self.client.get(
            "/api/health", headers={"Host": "localhost:8766", "Origin": "http://localhost:8766"}
        )
        self.assertEqual(browser.status_code, 200)
        self.assertEqual(widget.status_code, 200)
        self.assertEqual(localhost.status_code, 200)
        self.assertEqual(self.reached_backend, 3)

    def test_guard_is_installed_on_real_app(self):
        self.assertTrue(any(middleware.cls is LocalRequestBoundary for middleware in app.user_middleware))

    async def test_real_local_api_remains_usable(self):
        # This environment cannot start AnyIO worker threads; run synchronous
        # FastAPI handlers inline while exercising the real ASGI app and SQLite.
        async def inline_handler(function, *args, **kwargs):
            return function(*args, **kwargs)

        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1:8766"
        ) as client:
            with patch("fastapi.routing.run_in_threadpool", side_effect=inline_handler):
                health = await client.get("/api/health")
                created = await client.post(
                    "/api/drafts", headers={"Origin": "http://127.0.0.1:8766"},
                    json={"draft": {"state": "local test"}},
                )
                blocked = await client.get("/api/drafts", headers={"Host": "attacker.example:8766"})
                drafts = await client.get("/api/drafts")
        self.assertEqual(health.status_code, 200)
        self.assertEqual(created.status_code, 200)
        self.assertEqual(blocked.status_code, 403)
        self.assertEqual(drafts.json()["total"], 1)

    async def test_dns_rebinding_host_cannot_read_local_data(self):
        for path in ("/api/settings/api-keys", "/api/history", "/api/drafts"):
            with self.subTest(path=path):
                response = await self.client.get(path, headers={"Host": "attacker.example:8766"})
                self.assertEqual(response.status_code, 403)
        self.assertEqual(self.reached_backend, 0)

    async def test_malformed_or_duplicate_hosts_are_rejected(self):
        for headers in (
            {"Host": "127.0.0.1.attacker.example:8766"},
            {"Host": "attacker.example@127.0.0.1:8766"},
            [("Host", "127.0.0.1:8766"), ("Host", "attacker.example:8766")],
        ):
            with self.subTest(headers=headers):
                response = await self.client.get("/api/health", headers=headers)
                self.assertEqual(response.status_code, 403)
        self.assertEqual(self.reached_backend, 0)

    async def test_dns_rebinding_host_cannot_write_or_spend(self):
        draft = await self.client.post(
            "/api/drafts", headers={"Host": "attacker.example:8766"},
            json={"draft": {"state": "malicious"}},
        )
        paid = await self.client.post(
            "/api/jev/challenge", headers={"Host": "attacker.example:8766"},
            json={"state": "malicious", "questions": {}},
        )
        self.assertEqual(draft.status_code, 403)
        self.assertEqual(paid.status_code, 403)
        self.assertEqual(self.reached_backend, 0)

    async def test_cross_origin_and_cross_site_requests_are_rejected(self):
        for headers in (
            {"Origin": "http://attacker.example"},
            {"Origin": "null"},
            {"Referer": "http://attacker.example/page"},
            {"Sec-Fetch-Site": "cross-site"},
        ):
            with self.subTest(headers=headers):
                response = await self.client.post("/api/drafts", headers=headers, json={"draft": {}})
                self.assertEqual(response.status_code, 403)
        self.assertEqual(self.reached_backend, 0)


if __name__ == "__main__":
    unittest.main()
