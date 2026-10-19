"""Exercise real JS core through Python HTTP/WebSocket routes, without a browser."""
import json
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'src'))
from fastapi.testclient import TestClient
from graymarch_bridge.app import create_app
from graymarch_bridge.security import Security


class CrossLanguage(unittest.TestCase):
    def test_gameplay_and_files(self):
        with tempfile.TemporaryDirectory() as folder:
            sec = Security(8765)
            app = create_app(Path(folder), port=8765, security=sec, min_turn_interval=2)
            proc = subprocess.Popen(['node', str(ROOT/'tests/e2e/kernel-rpc.mjs')], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            def cleanup():
                if proc.poll() is None:
                    proc.terminate()
                proc.wait(timeout=5)
                for stream in (proc.stdin, proc.stdout, proc.stderr):
                    stream.close()
            self.addCleanup(cleanup)
            ready = threading.Event()
            errors = []
            with TestClient(app, base_url='http://127.0.0.1:8765') as client:
                response = client.post('/bootstrap', json={'nonce': sec.nonce}, headers={'Origin':sec.origin})
                self.assertEqual(response.status_code, 200)
                cookie=client.cookies.get('graymarch_owner')
                def peer():
                    try:
                        with client.websocket_connect('ws://127.0.0.1:8765/bridge',headers={'Origin':sec.origin,'Cookie':'graymarch_owner='+cookie}) as ws:
                            first=json.loads(proc.stdout.readline()); ws.send_json(first); ready.set()
                            while True:
                                request=ws.receive_json();proc.stdin.write(json.dumps(request)+'\n');proc.stdin.flush()
                                packet=json.loads(proc.stdout.readline());ws.send_json(packet['state']);ws.send_json(packet['reply'])
                    except Exception as exc:
                        errors.append(type(exc).__name__)
                        ready.set()
                t=threading.Thread(target=peer,daemon=True);t.start();self.assertTrue(ready.wait(10))
                auth={'Authorization':'Bearer '+sec.token}
                owner={'Origin':sec.origin}
                def get(path):
                    r=client.get('/api/v1/'+path,headers=auth);self.assertEqual(r.status_code,200,r.text);return r.json()
                def control(mode):
                    r=client.post('/api/owner/control',json={'mode':mode},headers=owner);self.assertEqual(r.status_code,200,r.text)
                frame=get('observation')
                def action(kind,payload):
                    nonlocal frame
                    cmd={k:frame[k] for k in ['sessionId','runId','epoch']};cmd.update(commandId='cmd-'+str(frame['revision']),expectedRevision=frame['revision'],type=kind,payload=payload,contextId='integration')
                    r=client.post('/api/v1/actions',json=cmd,headers=auth);self.assertEqual(r.status_code,200,r.text)
                    body=r.json();self.assertEqual(body['status'],'completed',body);frame=body['observation'];return cmd,body
                self.assertEqual(frame['phase'],'world.ready')
                # Default Agent control permits gameplay as soon as the page is ready.
                self.assertEqual(get('status')['controlMode'], 'agent')
                n=next(n for n in frame['world']['neighbors'] if n['legal'])
                cmd,body=action('world.move',{'direction':n['direction']})
                again=client.post('/api/v1/actions',json=cmd,headers=auth);self.assertEqual(again.json(),body)
                first=get('information');self.assertIn('current',first)
                limited=client.get('/api/v1/information',headers=auth);self.assertEqual(limited.status_code,429,limited.text)
                # Fixed training encounter permits battle API/preview verification.
                self.assertEqual(frame['phase'],'world.ready')
                if frame['phase']=='world.ready':
                    action('training.start',{})
                    self.assertEqual(frame['phase'],'battle.planning')
                    b=frame['battle'];plan=['basic_attack',None,'basic_guard']
                    preview=client.post('/api/v1/preview',headers=auth,json={'expectedRevision':frame['revision'],'battleId':b['battleId'],'batchId':b['batchId'],'plan':plan})
                    self.assertEqual(preview.status_code,200,preview.text)
                    action('battle.commit',{'battleId':b['battleId'],'batchId':b['batchId'],'plan':plan})
                    if frame['phase']=='battle.planning':action('training.exit',{})
                control('human')
                saved=client.post('/api/v1/saves/manual',headers=owner);self.assertEqual(saved.status_code,200,saved.text)
                self.assertTrue((Path(folder)/'saves/manual.json').exists())
                loaded=client.post('/api/v1/saves/manual/load',headers=owner);self.assertEqual(loaded.status_code,200,loaded.text)
                self.assertEqual(loaded.json()['controlMode'], 'agent')
                self.assertGreater(loaded.json()['epoch'],frame['epoch'])
                self.assertEqual(client.get('/api/v1/status').status_code,401)
                # Close the peer via portal before tearing down TestClient.
                client.portal.call(app.state.session.socket.close)
                t.join(5)
            proc.terminate();proc.wait(timeout=5)
            self.assertEqual(proc.stderr.read(),'')


if __name__=='__main__':unittest.main()
