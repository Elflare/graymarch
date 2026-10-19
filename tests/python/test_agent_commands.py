"""Command availability checks without starting the bridge or reading credentials."""
import contextlib
import io
import unittest

from tools.agent.__main__ import parser


class AgentCommandTests(unittest.TestCase):
    def test_retreat_is_disabled_but_training_exit_is_available(self):
        commands = parser()
        self.assertNotIn('retreat', commands.format_help())
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
            commands.parse_args(['retreat'])
        self.assertEqual(error.exception.code, 2)
        args = commands.parse_args(['train', 'exit'])
        self.assertEqual((args.operation, args.training_operation), ('train', 'exit'))
