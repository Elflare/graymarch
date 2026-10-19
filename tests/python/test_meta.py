import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from graymarch_bridge.app import create_app
from graymarch_bridge.persistence import SaveStore, META_DEFAULT


class MetaTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = SaveStore(self.tmp.name)
        self.app = create_app(self.tmp.name)
        self.client = TestClient(self.app, base_url='http://127.0.0.1:8765')
        self.addCleanup(self.client.close)
        self.owner = {'origin': self.app.state.security.origin}

    def pair(self):
        response = self.client.post('/bootstrap', headers=self.owner,
                                    json={'nonce': self.app.state.security.nonce})
        self.assertEqual(response.status_code, 200)

    def test_owner_only_restore_merge_and_no_manual_overwrite(self):
        self.assertEqual(self.client.post('/api/owner/progress/load', headers=self.owner).status_code, 401)
        self.pair()
        self.assertEqual(self.client.post('/api/owner/progress/load', headers=self.owner).json()['meta'], META_DEFAULT)
        self.assertEqual(self.client.post('/api/owner/progress/load').status_code, 403)
        meta = dict(bossWins=2, bestGrade='S', harvests=10, unlocks=['class_sentinel'])
        response = self.client.post('/api/owner/progress', headers=self.owner, json={'meta': meta})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()['saved'])
        self.assertFalse((Path(self.tmp.name) / 'saves/manual.json').exists())
        older = dict(bossWins=1, bestGrade='C', harvests=0, unlocks=['class_arcanist'])
        self.client.post('/api/owner/progress', headers=self.owner, json={'meta': older})
        restored = SaveStore(self.tmp.name).read_meta()
        self.assertEqual(restored['bossWins'], 2)
        self.assertEqual(restored['bestGrade'], 'S')
        self.assertEqual(restored['harvests'], 10)
        self.assertEqual(restored['unlocks'], ['class_arcanist', 'class_sentinel'])
        self.store.write_meta(older)
        self.assertEqual(self.store.read_meta(), restored)

    def test_migration_extracts_only_meta_and_keeps_manual_file(self):
        meta = dict(bossWins=1, bestGrade='A', harvests=8, unlocks=['class_arcanist'])
        state = dict(sessionId='s', runId='r', epoch=1, revision=0, decisionTurn=0,
                     sequence=0, rng=1, worldTurn=0, x=0, y=0, level=1, xp=0,
                     sigils=0, hunger=80, maxHunger=100, pendingRewards=0,
                     inventory={}, meta=meta, buffs=[], inBattle=False,
                     battle=None, pendingDecision=None)
        state['player'] = dict(hp=18, maxHp=18, attack=4, energy=2, maxEnergy=3,
                               block=0, skills={}, passives={}, equipment={})
        for key in ('visited', 'discovered', 'spent', 'harvested', 'eventsSeen', 'cleared'):
            state[key] = []
        self.store.write({'format': 'graymarch-save', 'schemaVersion': 1, 'state': state})
        before = self.store.slot().read_bytes()
        self.pair()
        response = self.client.post('/api/owner/progress/load', headers=self.owner)
        self.assertEqual(response.json(), {'meta': meta})
        self.assertEqual(self.store.slot().read_bytes(), before)
        saved = json.loads(self.store.slot('meta').read_bytes())
        self.assertEqual(set(saved), {'format', 'schemaVersion', 'meta'})
        self.assertEqual(saved['meta'], meta)

    def test_invalid_input_and_failed_replace_preserve_existing_progress(self):
        meta = dict(bossWins=1, bestGrade='S', harvests=10, unlocks=['class_hunter'])
        self.store.write_meta(meta)
        before = self.store.slot('meta').read_bytes()
        self.pair()
        response = self.client.post('/api/owner/progress', headers=self.owner,
                                    json={'meta': {**meta, 'harvests': -1}})
        self.assertEqual(response.status_code, 422)
        with patch('graymarch_bridge.persistence.os.replace', side_effect=OSError('disk failure')):
            response = self.client.post('/api/owner/progress', headers=self.owner,
                                        json={'meta': {**meta, 'bossWins': 2}})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.store.slot('meta').read_bytes(), before)
        self.assertEqual(list(self.store.slot('meta').parent.glob('.meta-*')), [])
        self.store.slot('meta').write_text('{broken')
        self.assertEqual(self.client.post('/api/owner/progress/load', headers=self.owner).status_code, 422)
        self.assertEqual(self.client.post('/api/owner/progress', headers=self.owner, json={'meta': meta}).status_code, 422)
        self.assertEqual(self.store.slot('meta').read_text(), '{broken')


if __name__ == '__main__':
    unittest.main()
