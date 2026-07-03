# Unit tests for slugs — canonical slug generation used when a listing is
# published on approval (plan §4/§7). Covers slugify normalisation and the
# collision-suffix dedupe, using a fake cursor so no DB is needed.
import unittest

import slugs


class FakeCursor:
    """Minimal stand-in for a psycopg2 RealDictCursor: answers _slug_taken by
    checking the queried slug against a preset 'taken' set."""

    def __init__(self, taken):
        self.taken = set(taken)
        self._hit = False

    def execute(self, sql, params):
        # params[0] is always the candidate slug in generate_unique_slug's queries.
        self._hit = params[0] in self.taken

    def fetchone(self):
        return {"exists": 1} if self._hit else None


class SlugifyTests(unittest.TestCase):
    def test_basic(self):
        self.assertEqual(slugs.slugify("Whisky Night", "Tokyo"), "whisky-night-tokyo")

    def test_strips_accents_and_punctuation(self):
        self.assertEqual(slugs.slugify("Café Soirée!", "Zürich"), "cafe-soiree-zurich")

    def test_collapses_separators(self):
        self.assertEqual(slugs.slugify("A  --  B", ""), "a-b")

    def test_empty_falls_back(self):
        self.assertEqual(slugs.slugify("", ""), "event")
        self.assertEqual(slugs.slugify("!!!", "###"), "event")


class UniqueSlugTests(unittest.TestCase):
    def test_free_slug_used_as_is(self):
        cur = FakeCursor(taken=set())
        self.assertEqual(
            slugs.generate_unique_slug(cur, "Whisky Night", "Tokyo"),
            "whisky-night-tokyo",
        )

    def test_first_collision_gets_suffix_2(self):
        cur = FakeCursor(taken={"whisky-night-tokyo"})
        self.assertEqual(
            slugs.generate_unique_slug(cur, "Whisky Night", "Tokyo"),
            "whisky-night-tokyo-2",
        )

    def test_multiple_collisions_increment(self):
        cur = FakeCursor(taken={"whisky-night-tokyo", "whisky-night-tokyo-2"})
        self.assertEqual(
            slugs.generate_unique_slug(cur, "Whisky Night", "Tokyo"),
            "whisky-night-tokyo-3",
        )


if __name__ == "__main__":
    unittest.main()
