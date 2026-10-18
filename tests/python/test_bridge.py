import asyncio
import tempfile
import unittest
from pathlib import Path
from fastapi.testclient import TestClient
from graymarch_bridge.app import create_app
from graymarch_bridge.security import Security
from graymarch_bridge.sessions import Session, BridgeError
from graymarch_bridge.persistence import SaveStore


class SecurityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app = create_app(self.tmp.name)
        self.client = TestClient(self.app, base_url="http://127.0.0.1:8765")
        self.sec = self.app.state.security

    def tearDown(self):
        self.tmp.cleanup()

    def test_public_health_and_protected_api(self):
        self.assertEqual(self.client.get('/health').status_code, 200)
        self.assertEqual(self.client.get('/api/v1/status').status_code, 401)
        self.assertEqual(self.client.get('/health', headers={'host':'evil.test'}).status_code, 403)
        self.assertEqual(self.client.get('/health', headers={'origin':'http://evil.test'}).status_code, 403)
        auth = {'authorization': 'Bearer ' + self.sec.token}
        self.assertEqual(self.client.get('/api/v1/status', headers=auth).json()['ready'], False)
        self.assertEqual(self.client.post('/api/v1/saves/manual', headers=auth).status_code, 401)

    def test_bootstrap_single_use_and_origin(self):
        nonce = self.sec.nonce
        self.assertEqual(self.client.post('/bootstrap', json={'nonce':nonce}).status_code, 403)
        headers = {'origin':self.sec.origin}
        self.assertEqual(self.client.post('/bootstrap', json={'nonce':nonce}, headers=headers).status_code, 200)
        self.assertEqual(self.client.post('/bootstrap', json={'nonce':nonce}, headers=headers).status_code, 403)
        self.assertIn('graymarch_owner', self.client.cookies)

    def test_second_page_rejected_and_disconnect(self):
        self.client.post('/bootstrap', json={'nonce':self.sec.nonce}, headers={'origin':self.sec.origin})
        with self.client.websocket_connect('ws://127.0.0.1:8765/bridge', headers={'origin':self.sec.origin}) as ws:
            ws.send_json({'type':'ready','sessionId':'s','runId':'r','epoch':1,'revision':0,'decisionTurn':0})
            with self.client.websocket_connect('ws://127.0.0.1:8765/bridge', headers={'origin':self.sec.origin}) as second:
                self.assertEqual(second.receive()['code'], 1008)
        self.assertFalse(self.app.state.session.ready)


class FakeSocket:
    def __init__(self, session):
        self.session = session
        self.calls = []
        self.reply = True

    async def send_json(self, data):
        self.calls.append(data)
        if self.reply:
            self.session.receive({'id':data['id'],'result':{'status':'completed','revision':1}})


class SessionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.s = Session(timeout=0.01)
        self.socket = FakeSocket(self.s)
        await self.s.bind(self.socket)
        self.s.receive({'type':'ready','sessionId':'s','runId':'r','epoch':1,'revision':0,'decisionTurn':0})
        self.s.mode='agent'
        self.action = dict(sessionId='s',runId='r',epoch=1,expectedRevision=0,commandId='c',type='world.move',payload={'direction':'north'})

    async def test_dedupe_and_conflict(self):
        result = await self.s.action(self.action)
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(await self.s.action(self.action), result)
        self.assertEqual(len(self.socket.calls), 1)
        with self.assertRaises(BridgeError) as raised:
            await self.s.action({**self.action,'payload':{}})
        self.assertEqual(raised.exception.code, 'IDEMPOTENCY_CONFLICT')

    async def test_timeout_remains_pending_and_single_writer(self):
        self.socket.reply=False
        self.assertEqual((await self.s.action(self.action))['status'], 'pending')
        with self.assertRaises(BridgeError) as raised:
            await self.s.action({**self.action,'commandId':'other'})
        self.assertEqual(raised.exception.code, 'BUSY_COMMAND')
        self.s.receive({'id':self.socket.calls[0]['id'],'result':{'status':'completed','revision':1}})
        await asyncio.sleep(0)
        self.assertEqual(self.s.receipts['c']['receipt']['status'], 'completed')

    async def test_disconnect_unknown_and_epoch(self):
        with self.assertRaises(BridgeError) as raised:
            await self.s.action({**self.action,'epoch':2})
        self.assertEqual(raised.exception.code,'SESSION_EXPIRED')
        self.socket.reply=False
        await self.s.action(self.action)
        self.s.disconnected(self.socket)
        await asyncio.sleep(0)
        self.assertEqual(self.s.receipts['c']['receipt']['status'],'unknown')


class SaveTests(unittest.TestCase):
    def test_save_atomic_and_no_old_format_or_symlink(self):
        with tempfile.TemporaryDirectory() as folder:
            store = SaveStore(folder)
            state = dict(sessionId='s',runId='r',epoch=1,revision=0,decisionTurn=0,sequence=0,rng=1,worldTurn=0,x=0,y=0,level=1,xp=0,sigils=0,hunger=80,maxHunger=100,pendingRewards=0,inventory={},meta={},buffs=[],inBattle=False,training=False,battle=None,pendingDecision=None)
            state['player']=dict(hp=18,maxHp=18,attack=4,energy=2,maxEnergy=3,block=0,skills={},passives={},equipment={})
            for key in ('visited','discovered','spent','harvested','eventsSeen','cleared'):
                state[key]=[]
            save = {'format':'graymarch-save','schemaVersion':1,'state':state}
            store.write(save)
            self.assertEqual(store.read(),save)
            with self.assertRaises(ValueError):
                store.write({'version':31})
            self.assertEqual(store.read(),save)
            slot=store.slot()
            slot.unlink()
            slot.symlink_to(Path(folder)/'elsewhere.json')
            with self.assertRaises(ValueError):
                store.write(save)


class RateTests(unittest.TestCase):
    def test_shared_turn_interval_and_zero(self):
        for interval in (0, 2):
            app=create_app(tempfile.gettempdir(),min_turn_interval=interval)
            s=app.state.session
            s.identity={'sessionId':'s','runId':'r','epoch':1,'revision':0,'decisionTurn':0}
            async def query(method, params=None):
                return {'snapshotId':'snap','revision':s.identity['revision'],'player':{'hp':5}}
            s.query=query
            client=TestClient(app,base_url='http://127.0.0.1:8765')
            headers={'authorization':'Bearer '+app.state.security.token}
            self.assertEqual(client.get('/api/v1/information',headers=headers).status_code,200)
            self.assertEqual(client.get('/api/v1/information?contextId=new&scope=player',headers=headers).status_code,429 if interval else 200)
            self.assertEqual(client.get('/api/v1/observation',headers=headers).status_code,200)
            s.identity['decisionTurn']=2
            self.assertEqual(client.get('/api/v1/information',headers=headers).status_code,200)


if __name__=='__main__':
    unittest.main()
