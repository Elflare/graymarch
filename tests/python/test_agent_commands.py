"""Command availability checks without starting the bridge or reading credentials."""
import contextlib
import io
import unittest

from tools.agent.__main__ import parser


class AgentCommandTests(unittest.TestCase):
    def test_retreat_and_training_are_unavailable(self):
        commands = parser()
        self.assertNotIn('retreat', commands.format_help())
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
            commands.parse_args(['retreat'])
        self.assertEqual(error.exception.code, 2)
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
            commands.parse_args(['train', 'exit'])
        self.assertEqual(error.exception.code, 2)
