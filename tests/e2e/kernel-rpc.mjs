// Headless bridge peer for cross-language integration tests. No browser/UI claim.
import readline from 'node:readline';
import {createGame} from '../../web/src/core/engine.js';
const game=createGame({seed:12345});
function identity(){let f=game.observe();return {...Object.fromEntries(['sessionId','runId','epoch','revision','decisionTurn','phase'].map(k=>[k,f[k]])),controlMode:game.getControl()};}
console.log(JSON.stringify({type:'ready',...identity()}));
for await (const line of readline.createInterface({input:process.stdin})){
 const req=JSON.parse(line);let reply;
 try {let fn={observe:()=>game.observe(req.params),act:()=>game.act(req.params),preview:()=>game.preview(req.params),information:()=>game.information(req.params),catalog:()=>game.catalog(req.params),map:()=>game.map(req.params),control:()=>game.control(req.params),export_save:()=>game.exportSave(),import_save:()=>game.importSave(req.params)}[req.method];if(!fn)throw Error('Unknown method');reply={id:req.id,result:await fn()};}
 catch(e){reply={id:req.id,error:{code:e.code||'ERROR',message:e.message,details:e.details}};}
 console.log(JSON.stringify({reply,state:{type:'state',...identity()}}));
}
