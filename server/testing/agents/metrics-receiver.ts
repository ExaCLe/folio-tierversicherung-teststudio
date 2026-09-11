import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

const MAX_BODY_BYTES=256_000;

function scalar(value:unknown):unknown{
  if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
  const row=value as Record<string,unknown>;
  return row.stringValue??row.intValue??row.boolValue??row.doubleValue;
}

/** Count only Codex's documented API-request log event; discard every payload. */
export function countCodexApiRequestRecords(payload:unknown):number{
  if(!payload||typeof payload!=='object'||Array.isArray(payload))return 0;
  const root=payload as any,records=(root.resourceLogs??[]).flatMap((resource:any)=>(resource.scopeLogs??[]).flatMap((scope:any)=>scope.logRecords??[]));
  return records.filter((record:any)=>{
    if(scalar(record?.body)==='codex.api_request')return true;
    const attributes=new Map((record?.attributes??[]).map((attribute:any)=>[attribute.key,scalar(attribute.value)]));
    return ['event.name','name','event_name'].some(key=>attributes.get(key)==='codex.api_request');
  }).length;
}

export interface CodexMetricsReceiver { endpoint:string; count:()=>number|undefined; close:()=>Promise<number|undefined> }

export async function startCodexMetricsReceiver():Promise<CodexMetricsReceiver>{
  const token=randomBytes(24).toString('hex'),route=`/v1/logs/${token}`;let apiRequests=0,received=false;const seen=new Set<string>();
  const server=createServer((request,response)=>{
    if(request.method!=='POST'||request.url!==route){response.writeHead(404).end();return;}
    let size=0,body='';request.setEncoding('utf8');
    request.on('data',(chunk:string)=>{size+=Buffer.byteLength(chunk);if(size<=MAX_BODY_BYTES)body+=chunk;else request.destroy();});
    request.on('end',()=>{if(size>MAX_BODY_BYTES)return;try{const payload=JSON.parse(body),root=payload as any,records=(root.resourceLogs??[]).flatMap((resource:any)=>(resource.scopeLogs??[]).flatMap((scope:any)=>scope.logRecords??[]));received=true;for(const record of records){if(countCodexApiRequestRecords({resourceLogs:[{scopeLogs:[{logRecords:[record]}]}]})!==1)continue;const signature=createHash('sha256').update(JSON.stringify(record)).digest('hex');if(!seen.has(signature)){seen.add(signature);apiRequests+=1;}}response.writeHead(200).end();}catch{response.writeHead(400).end();}});
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
  const address=server.address();if(!address||typeof address==='string')throw new Error('Lokaler Metrikempfänger konnte nicht gestartet werden.');
  const result=()=>received?apiRequests:undefined;
  return {endpoint:`http://127.0.0.1:${address.port}${route}`,count:result,close:()=>new Promise(resolve=>{let settled=false;const finish=()=>{if(settled)return;settled=true;resolve(result());};const force=setTimeout(()=>{server.closeAllConnections();server.close(finish);finish();},700);force.unref();const grace=setTimeout(()=>server.close(()=>{clearTimeout(force);finish();}),150);grace.unref();})};
}
