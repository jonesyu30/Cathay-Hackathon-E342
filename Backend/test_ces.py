import unittest
from unittest.mock import MagicMock, patch
from uuid import UUID

import google.auth
from fastapi import HTTPException
from pydantic import ValidationError

with patch.object(google.auth, "default", return_value=(MagicMock(valid=True, token="test"), None)):
    import main


def response(status: int, body: dict) -> MagicMock:
    result = MagicMock()
    result.ok = status < 400
    result.status_code = status
    result.text = str(body)
    result.json.return_value = body
    return result


ENDED = {
    "error": {
        "status": "FAILED_PRECONDITION",
        "details": [{"reason": "SESSION_ALREADY_ENDED"}],
    }
}
SUCCESS = {"outputs": [{"text": " Hello "}]}


class CesSessionTests(unittest.IsolatedAsyncioTestCase):
    async def test_new_conversations_are_distinct_and_return_session_ids(self):
        with patch.object(main.requests, "post", return_value=response(200, SUCCESS)) as post:
            first = await main.chat(main.ChatIn(message="Hi"))
            second = await main.chat(main.ChatIn(message="Hi"))

        self.assertNotEqual(first["session_id"], second["session_id"])
        UUID(first["session_id"])
        self.assertEqual(first["reply"], "Hello")
        for result, call in zip((first, second), post.call_args_list):
            session = call.kwargs["json"]["config"]["session"]
            self.assertTrue(session.endswith("/" + result["session_id"]))
            self.assertTrue(call.args[0].endswith(session + ":runSession"))

    async def test_existing_session_is_reused(self):
        with patch.object(main.requests, "post", return_value=response(200, SUCCESS)) as post:
            result = await main.chat(main.ChatIn(message="Hi", session_id="existing-session"))

        self.assertEqual(result["session_id"], "existing-session")
        self.assertIn("/sessions/existing-session:runSession", post.call_args.args[0])

    async def test_ended_session_retries_once_with_new_session(self):
        with patch.object(main.requests, "post", side_effect=[response(400, ENDED), response(200, SUCCESS)]) as post:
            result = await main.chat(main.ChatIn(message="Hi", session_id="ended-session"))

        self.assertEqual(post.call_count, 2)
        self.assertNotEqual(result["session_id"], "ended-session")
        self.assertTrue(post.call_args.args[0].endswith("/" + result["session_id"] + ":runSession"))
        self.assertEqual(post.call_args.kwargs["json"]["inputs"], [{"text": "Hi"}])

    async def test_other_errors_and_second_ended_error_are_not_retried(self):
        for responses in ([response(400, {"error": {"status": "INVALID_ARGUMENT"}})],
                          [response(400, ENDED), response(400, ENDED)]):
            with self.subTest(responses=len(responses)):
                with patch.object(main.requests, "post", side_effect=responses) as post:
                    with self.assertRaises(HTTPException) as raised:
                        await main.ask_ces("Hi", "existing-session")
                self.assertEqual(raised.exception.status_code, 400)
                self.assertEqual(post.call_count, len(responses))

    def test_invalid_session_id_is_rejected(self):
        with self.assertRaises(ValidationError):
            main.ChatIn(message="Hi", session_id="../other/session")


if __name__ == "__main__":
    unittest.main()
