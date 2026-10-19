"""Exercise control and inventory receipts over real ASGI routes without sockets."""
import asyncio
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import httpx

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'src'))
from graymarch_bridge.app import create_app
from tools.agent.__main__ import action_summary


class ASGIIntegration(unittest.IsolatedAsyncioTestCase):
    async def test_default_agent_reload_failures_and_reconnect(self):
        with tempfile.TemporaryDirectory() as folder:
            app = create_app(folder)
            sec, session = app.state.security, app.state.session
            proc = await asyncio.create_subprocess_exec(
                'node', str(ROOT / 'tests/e2e/kernel-rpc.mjs'),
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE)
            last_state = json.loads(await asyncio.wait_for(proc.stdout.readline(), 5))
            tasks = []
            incoming = outgoing = None

            async def connect(cookie):
                nonlocal incoming, outgoing
                incoming, outgoing = asyncio.Queue(), asyncio.Queue()
                scope = dict(type='websocket', asgi={'version': '3.0'}, scheme='ws',
                             path='/bridge', raw_path=b'/bridge', query_string=b'',
                             root_path='', http_version='1.1', subprotocols=[], state={},
                             client=('127.0.0.1', 12345), server=('127.0.0.1', 8765),
                             headers=[(b'host', sec.host.encode()), (b'origin', sec.origin.encode()),
                                      (b'cookie', ('graymarch_owner=' + cookie).encode())])
                task = asyncio.create_task(app(scope, incoming.get, outgoing.put))
                tasks.append(task)
                await incoming.put({'type': 'websocket.connect'})
                self.assertEqual((await asyncio.wait_for(outgoing.get(), 5))['type'], 'websocket.accept')
                await incoming.put({'type': 'websocket.receive', 'text': json.dumps({**last_state, 'type': 'ready'})})

                async def peer():
                    nonlocal last_state
                    while True:
                        message = await outgoing.get()
                        self.assertEqual(message['type'], 'websocket.send')
                        proc.stdin.write((message['text'] + '\n').encode())
                        await proc.stdin.drain()
                        packet = json.loads(await asyncio.wait_for(proc.stdout.readline(), 5))
                        last_state = packet['state']
                        for data in [packet['state'], packet['reply']]:
                            await incoming.put({'type': 'websocket.receive', 'text': json.dumps(data)})
                worker = asyncio.create_task(peer())
                tasks.append(worker)
                while not session.ready:
                    await asyncio.sleep(0)

            async def disconnect():
                worker, server = tasks.pop(), tasks.pop()
                worker.cancel()
                await asyncio.gather(worker, return_exceptions=True)
                await incoming.put({'type': 'websocket.disconnect', 'code': 1000})
                await asyncio.wait_for(server, 5)

            try:
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=sec.origin) as client:
                    owner = {'Origin': sec.origin}
                    auth = {'Authorization': 'Bearer ' + sec.token}
                    paired = await client.post('/bootstrap', json={'nonce': sec.nonce}, headers=owner)
                    self.assertEqual(paired.status_code, 200)
                    await connect(client.cookies['graymarch_owner'])

                    async def get(path):
                        response = await client.get('/api/v1/' + path, headers=auth)
                        self.assertEqual(response.status_code, 200, response.text)
                        return response.json()

                    async def action(kind, payload=None):
                        frame = await get('observation')
                        cmd = {k: frame[k] for k in ['sessionId', 'runId', 'epoch']}
                        cmd.update(commandId='cmd-' + str(frame['revision']),
                                   expectedRevision=frame['revision'], type=kind, payload=payload or {})
                        response = await client.post('/api/v1/actions', json=cmd, headers=auth)
                        self.assertEqual(response.status_code, 200, response.text)
                        self.assertEqual(response.json()['status'], 'completed')
                        return cmd

                    self.assertEqual((await get('status'))['controlMode'], 'agent')
                    cmd = await action('world.move', {'direction': 'east'})
                    await action('world.move', {'direction': 'west'})
                    saved = await client.post('/api/v1/saves/manual', headers=owner)
                    self.assertEqual(saved.status_code, 200, saved.text)
                    slot = Path(folder) / 'saves/manual.json'
                    original = slot.read_bytes()
                    before = await get('observation')
                    loaded = await client.post('/api/v1/saves/manual/load', headers=owner)
                    self.assertEqual(loaded.status_code, 200, loaded.text)
                    self.assertEqual(loaded.json()['controlMode'], 'agent')
                    self.assertGreater(loaded.json()['epoch'], before['epoch'])
                    self.assertEqual((await get('status'))['controlMode'], 'agent')
                    self.assertEqual((await get('commands/' + cmd['commandId']))['status'], 'unknown')
                    stale = {**cmd, 'commandId': 'old-epoch'}
                    rejected = await client.post('/api/v1/actions', json=stale, headers=auth)
                    self.assertEqual(rejected.json()['error']['code'], 'SESSION_EXPIRED')
                    await action('world.move', {'direction': 'east'})
                    await action('world.move', {'direction': 'west'})

                    harvest_save = json.loads(original)
                    harvest_save['state'].update(x=66, y=-99)
                    for key in ['visited', 'discovered']:
                        harvest_save['state'][key].append('66,-99')
                    slot.write_text(json.dumps(harvest_save))
                    loaded = await client.post('/api/v1/saves/manual/load', headers=owner)
                    self.assertEqual(loaded.status_code, 200, loaded.text)
                    before_harvest = await get('observation')
                    self.assertEqual(before_harvest['player']['inventory']['berries'], 1)
                    harvest_cmd = await action('world.harvest')
                    receipt = await get('commands/' + harvest_cmd['commandId'])
                    self.assertEqual(receipt['inventoryChanges'], {'berries': 2})
                    self.assertEqual(receipt['observation']['phase'], 'battle.planning')
                    self.assertNotIn('inventory', receipt['observation']['player'])
                    summary_client = SimpleNamespace(
                        before_command=before_harvest, last_command=harvest_cmd,
                        definitions={d['id']: d for d in receipt['observation']['definitions']})
                    brief = action_summary(receipt, summary_client)
                    self.assertEqual(brief['changes']['player']['inventory'], {'berries': 2})
                    duplicate = await client.post('/api/v1/actions', json=harvest_cmd, headers=auth)
                    self.assertEqual(duplicate.status_code, 200, duplicate.text)
                    self.assertEqual(duplicate.json(), receipt)
                    self.assertEqual((await get('information?scope=player'))['player']['inventory']['berries'], 2)

                    before = await get('observation')
                    self.assertNotIn('battle.retreat', before['allowed'])
                    retreat = {k: before[k] for k in ['sessionId', 'runId', 'epoch']}
                    retreat.update(commandId='disabled-retreat', expectedRevision=before['revision'],
                                   type='battle.retreat', payload={})
                    rejected = await client.post('/api/v1/actions', json=retreat, headers=auth)
                    self.assertEqual(rejected.status_code, 409, rejected.text)
                    self.assertEqual(rejected.json()['error']['code'], 'INVALID_PHASE')
                    self.assertEqual(await get('observation'), before)
                    bad_save = json.loads(original)
                    bad_save['state']['inventory'] = {}
                    for content, code in [(b'{broken', 'SAVE_INVALID'), (json.dumps(bad_save).encode(), 'INVALID_SAVE')]:
                        slot.write_bytes(content)
                        failed = await client.post('/api/v1/saves/manual/load', headers=owner)
                        self.assertEqual(failed.json()['error']['code'], code, failed.text)
                        self.assertEqual((await get('status'))['controlMode'], 'human')
                        after = await get('observation')
                        for field in ['player', 'world', 'revision', 'epoch']:
                            self.assertEqual(after[field], before[field])
                    slot.write_bytes(original)
                    await disconnect()
                    await connect(client.cookies['graymarch_owner'])
                    self.assertEqual((await get('status'))['controlMode'], 'human')
                    self.assertEqual((await client.get('/api/v1/status')).status_code, 401)

                    starved = json.loads(original)
                    starved['state']['player']['hp'] = 1
                    starved['state']['hunger'] = 0
                    slot.write_text(json.dumps(starved))
                    loaded = await client.post('/api/v1/saves/manual/load', headers=owner)
                    self.assertEqual(loaded.status_code, 200, loaded.text)
                    before_death = await get('observation')
                    death_cmd = await action('world.move', {'direction': 'east'})
                    death = await get('commands/' + death_cmd['commandId'])
                    terminal = death['observation']
                    self.assertEqual(terminal['phase'], 'game.over')
                    self.assertEqual(terminal['player']['hp'], 0)
                    self.assertEqual(terminal['allowed'], [])
                    self.assertEqual(terminal['runResult']['cause'], 'starvation')
                    summary_client.before_command = before_death
                    summary_client.last_command = death_cmd
                    self.assertEqual(action_summary(death, summary_client)['changes']['runResult'], terminal['runResult'])
                    retry = await client.post('/api/v1/actions', json=death_cmd, headers=auth)
                    self.assertEqual(retry.json(), death)
                    for kind in ['world.move', 'training.start', 'training.exit']:
                        command = {k: terminal[k] for k in ['sessionId', 'runId', 'epoch']}
                        command.update(commandId='ended-' + kind, expectedRevision=terminal['revision'], type=kind, payload={})
                        rejected = await client.post('/api/v1/actions', json=command, headers=auth)
                        self.assertEqual(rejected.json()['error']['code'], 'INVALID_PHASE')
                    self.assertEqual((await get('observation'))['runResult'], terminal['runResult'])
                    saved = await client.post('/api/v1/saves/manual', headers=owner)
                    self.assertEqual(saved.status_code, 200, saved.text)
                    self.assertNotIn('training', json.loads(slot.read_text())['state'])
                    loaded = await client.post('/api/v1/saves/manual/load', headers=owner)
                    self.assertEqual(loaded.status_code, 200, loaded.text)
                    self.assertEqual((await get('observation'))['runResult'], terminal['runResult'])
                    self.assertEqual((await get('status'))['phase'], 'game.over')
                    slot.write_bytes(original)
                    loaded = await client.post('/api/v1/saves/manual/load', headers=owner)
                    self.assertEqual(loaded.status_code, 200, loaded.text)
                    self.assertEqual((await get('observation'))['phase'], 'world.ready')
            finally:
                if tasks:
                    await disconnect()
                if proc.returncode is None:
                    proc.terminate()
                await asyncio.wait_for(proc.wait(), 5)
                self.assertEqual((await proc.stderr.read()).decode(), '')


if __name__ == '__main__':
    unittest.main()
