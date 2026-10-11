"""Exercise the pinned SDK and CLI retry service without contacting a provider.

Run with the Python environment containing requirements.txt.
Only httpx's network transport is replaced; client retry defaults and mutation
idempotency classification remain real so an SDK regression fails this test.
"""

import asyncio
import logging
import unittest
from importlib.metadata import version
from unittest.mock import patch

import httpx
from notebooklm import NotebookLMClient
from notebooklm.auth import AuthTokens
from notebooklm.cli.services.artifact_generation import generate_with_retry
from notebooklm.rpc.types import VideoFormat


class NotebookTransportTest(unittest.IsolatedAsyncioTestCase):
    async def test_video_submission_is_never_replayed_after_transport_failure(self):
        self.assertEqual(version("notebooklm-py"), "0.7.3")
        for failure in (429, 500, "network", 401):
            with self.subTest(failure=failure):
                requests = []
                original_client = httpx.AsyncClient

                def handle(request):
                    requests.append(request)
                    if failure == "network":
                        raise httpx.ReadError("Response lost after accepting write", request=request)
                    return httpx.Response(failure, request=request, headers={"Retry-After": "0"})

                def client_factory(*args, **kwargs):
                    return original_client(*args, **kwargs, transport=httpx.MockTransport(handle))

                auth = AuthTokens(cookies={}, csrf_token="synthetic-csrf", session_id="synthetic-session")
                with patch("httpx.AsyncClient", side_effect=client_factory):
                    # Deliberately preserve the client's default three transport
                    # retries. Mutation classification must override those values.
                    async with NotebookLMClient(auth, cookie_saver=lambda *a, **kw: None) as client:
                        async def generate():
                            return await client.artifacts.generate_video(
                                "11111111-1111-4111-8111-111111111111",
                                source_ids=["22222222-2222-4222-8222-222222222222"],
                                video_format=VideoFormat.CINEMATIC,
                                instructions="Synthetic transport retry test",
                            )

                        try:
                            # This is the service called by the actual CLI with
                            # --retry 0; test both layers together, with a bound.
                            await asyncio.wait_for(
                                generate_with_retry(generate, max_retries=0, artifact_type="video"),
                                timeout=3,
                            )
                        except TimeoutError:
                            self.fail("Generation entered a retry/wait after transport failure")
                        except Exception:
                            pass  # Provider errors must propagate; never replay.
                        else:
                            self.fail("Transport failure unexpectedly succeeded")

                self.assertEqual(len(requests), 1, f"Hidden mutation replay after {failure}")
                self.assertEqual(requests[0].method, "POST")
                self.assertEqual(requests[0].url.params.get("rpcids"), "R7cb6c")


if __name__ == "__main__":
    logging.disable(logging.CRITICAL)
    unittest.main()
