"""Keep frontend checks in the existing unittest-based CI entrypoint."""

import unittest

from scripts.check import check_frontend


class FrontendTests(unittest.TestCase):
    def test_javascript_syntax_and_suites(self):
        check_frontend()
