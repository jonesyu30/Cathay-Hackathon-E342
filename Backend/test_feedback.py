import datetime
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import google.auth
from fastapi import HTTPException

with patch.object(google.auth, "default", return_value=(MagicMock(valid=True, token="test"), None)):
    import feedback


class FeedbackTests(unittest.IsolatedAsyncioTestCase):
    def test_clean_feedback_normalizes_whitespace_and_unknown_category(self):
        cleaned = feedback.clean_feedback(
            feedback.FeedbackIn(
                passenger_id=2,
                category="UnknownGroup",
                preferred_service="  Quiet   boarding   lounge ",
                details="  Would reduce sensory overload  ",
                source_page="PLAN",
            )
        )
        self.assertEqual(cleaned["passenger_id"], 2)
        self.assertEqual(cleaned["category"], "Other")
        self.assertEqual(cleaned["preferred_service"], "Quiet boarding lounge")
        self.assertEqual(cleaned["details"], "Would reduce sensory overload")
        self.assertEqual(cleaned["source_page"], "plan")

    def test_clean_feedback_rejects_blank_service(self):
        with self.assertRaises(HTTPException) as ctx:
            feedback.clean_feedback(
                feedback.FeedbackIn(passenger_id=1, preferred_service="   ")
            )
        self.assertEqual(ctx.exception.status_code, 400)

    def test_summarize_rows_aggregates_counts(self):
        summary = feedback.summarize_rows([
            {"passenger_id": 1, "category": "Sensory", "preferred_service": "Quiet lounge", "source_page": "chat"},
            {"passenger_id": 2, "category": "Sensory", "preferred_service": "Quiet lounge", "source_page": "plan"},
            {"passenger_id": 2, "category": "Hearing", "preferred_service": "Live captions", "source_page": "plan"},
        ])
        self.assertEqual(summary["total"], 3)
        self.assertEqual(summary["unique_services"], 2)
        self.assertEqual(summary["unique_passengers"], 2)
        self.assertEqual(summary["by_category"][0], {"label": "Sensory", "count": 2})
        self.assertEqual(summary["by_service"][0], {"label": "Quiet lounge", "count": 2})

    async def test_save_and_list_feedback_endpoints(self):
        now = datetime.datetime(2026, 11, 15, 10, 0, tzinfo=datetime.timezone.utc)
        mock_db = MagicMock()
        mock_db.fetchrow = AsyncMock(return_value={"feedback_id": 7, "created_at": now})
        mock_db.fetch = AsyncMock(return_value=[
            {
                "feedback_id": 7,
                "passenger_id": 1,
                "passenger_name": "Mei Chen",
                "category": "Hearing",
                "preferred_service": "Live captions at gate",
                "details": "Helpful during boarding",
                "source_page": "plan",
                "created_at": now,
            }
        ])

        with patch.object(feedback, "database", return_value=mock_db):
            saved = await feedback.save_feedback(
                feedback.FeedbackIn(
                    passenger_id=1,
                    category="Hearing",
                    preferred_service="Live captions at gate",
                    details="Helpful during boarding",
                    source_page="plan",
                )
            )
            listed = await feedback.list_feedback()

        self.assertEqual(saved["status"], "saved")
        self.assertEqual(saved["feedback_id"], 7)
        self.assertEqual(listed["summary"]["total"], 1)
        self.assertEqual(listed["items"][0]["passenger_name"], "Mei Chen")


if __name__ == "__main__":
    unittest.main()
