"""Inventory reporting at compact-observation scope transitions; no HTTP needed."""
import copy
import unittest
from types import SimpleNamespace

from tools.agent.__main__ import action_summary
from tools.agent.client import GraymarchClient
from tools.agent.views import decision_view, query_view


def frame(*, inventory=None, battle=False, revision=1):
    player = {'hp': 18, 'hunger': 80}
    if inventory is not None:
        player['inventory'] = inventory
    return {'revision': revision, 'phase': 'battle.planning' if battle else 'world.ready',
            'worldTurn': revision, 'player': player, 'world': {'position': {'x': 0, 'y': 0}},
            'battle': {'battleId': 'b', 'batchId': 'batch', 'turn': 1,
                       'enemy': {'id': 'wolf', 'hp': 7}, 'intents': [], 'actions': []} if battle else None,
            'pendingDecision': None}


class AgentSummaryTests(unittest.TestCase):
    def test_game_over_is_visible_in_summaries_and_queries(self):
        before = frame(inventory={'berries': 1})
        after = frame(inventory={'berries': 1}, revision=2)
        after.update(phase='game.over', allowed=[], runResult={'cause': 'starvation', 'worldTurn': 2, 'wins': 0})
        after['player']['hp'] = 0
        result = self.summary(before, after)
        self.assertEqual(result['changes']['runResult'], after['runResult'])
        self.assertEqual(decision_view(after)['runResult'], after['runResult'])
        info = {'revision': 2, 'player': after['player'], 'runResult': after['runResult']}
        self.assertEqual(query_view(info, 'information', {})['runResult'], after['runResult'])

    def test_multiple_moves_stop_as_soon_as_the_run_ends(self):
        client = object.__new__(GraymarchClient)
        before = frame(inventory={'berries': 1})
        before['world']['neighbors'] = [{'direction': 'east', 'legal': True}]
        client.current = before
        calls = []

        def execute(kind, payload):
            calls.append((kind, payload))
            self.assertEqual(len(calls), 1, 'no second move may follow death')
            client.current = {**before, 'phase': 'game.over', 'world': {'position': {'x': 1, 'y': 0}}}
            return {'status': 'completed', 'observation': client.current}

        client.execute = execute
        result = client.move('east', 5)
        self.assertEqual(result['movement'], {'requested': 5, 'moved': 1, 'stop': 'game.over'})

    def summary(self, before, after, inventory=None):
        definitions = {'berries': {'id': 'berries', 'name': '黑莓束', 'effect': '+11 饥饿', 'version': '1'},
                       'mushroom': {'id': 'mushroom', 'name': '灰帽菇', 'effect': '+22 饥饿', 'version': '1'}}
        client = SimpleNamespace(before_command=before, definitions=definitions, last_command=None)
        result = {'status': 'completed', 'observation': after}
        if inventory is not None:
            result['inventoryChanges'] = inventory
        original = copy.deepcopy((before, result))
        summary = action_summary(result, client)
        self.assertEqual((before, result), original, 'rendering must not mutate a receipt or baseline')
        return summary

    def test_harvest_ambush_and_double_loot_use_final_counts(self):
        for final in (2, 3):
            with self.subTest(final=final):
                summary = self.summary(frame(inventory={'berries': 1}), frame(battle=True, revision=2), {'berries': final})
                self.assertEqual(summary['changes']['player']['inventory'], {'berries': final})
                self.assertNotIn('definitions', summary['changes'], 'an already owned food needs no repeated definition')

    def test_first_food_definition_is_kept_when_inventory_is_omitted(self):
        summary = self.summary(frame(inventory={'berries': 1, 'mushroom': 0}),
                               frame(battle=True, revision=2), {'mushroom': 1})
        self.assertEqual(summary['changes']['player']['inventory'], {'mushroom': 1})
        self.assertEqual([d['id'] for d in summary['changes']['definitions']], ['mushroom'])

    def test_failed_harvest_and_ordinary_battle_do_not_clear_inventory(self):
        for before in (frame(inventory={'berries': 1}), frame(battle=True)):
            with self.subTest(before=before['phase']):
                summary = self.summary(before, frame(battle=True, revision=2))
                self.assertNotIn('inventory', summary['changes'].get('player', {}))

    def test_return_to_world_does_not_report_unchanged_inventory_as_new_loot(self):
        summary = self.summary(frame(battle=True), frame(inventory={'berries': 2}, revision=2))
        self.assertNotIn('inventory', summary['changes'].get('player', {}))

    def test_zero_and_normal_world_changes_are_reported_once(self):
        for old, new in ((1, 0), (1, 2)):
            with self.subTest(new=new):
                summary = self.summary(frame(inventory={'berries': old}), frame(inventory={'berries': new}, revision=2), {'berries': new})
                self.assertEqual(summary['changes']['player']['inventory'], {'berries': new})


if __name__ == '__main__':
    unittest.main()
