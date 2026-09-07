import type { TestingAgentJob, TestingApproval, TestingCatalog, TestingRun, TestingScenario, TestingScenarioLifecycle } from '../../shared/testing';
import { compileTestingScenario, testingFingerprint } from './compiler';

/** Lifecycle is rebuilt from persisted facts, never from the selected UI tab or
 * an unrelated historical run. Legacy jobs simply have no explicit child links. */
export function deriveTestingLifecycle(scenario:TestingScenario,catalog:TestingCatalog,jobs:TestingAgentJob[],runs:TestingRun[],approval?:TestingApproval):TestingScenarioLifecycle {
  const fingerprint=testingFingerprint(scenario,catalog),base={scenarioId:scenario.id,scenarioRevision:scenario.revision,fingerprint,childJobIds:[] as string[]};
  const belongs=(job:TestingAgentJob)=>{
    if(job.scenarioId!==scenario.id)return false;
    const result=job.result as {scenario?:TestingScenario;applied?:boolean}|undefined;
    if(result?.applied&&result.scenario?.revision===scenario.revision&&testingFingerprint(result.scenario,catalog)===fingerprint)return true;
    return job.scenarioRevision===scenario.revision&&(!job.fingerprint||job.fingerprint===fingerprint);
  };
  const related=jobs.filter(belongs).sort((a,b)=>b.startedAt.localeCompare(a.startedAt));
  const active=related.find(job=>['queued','running'].includes(job.status));
  const current=active?(jobs.find(job=>job.id===active.parentJobId)??active):related.find(job=>!job.parentJobId&&!['duplicates','exploration'].includes(job.phase));
  const children=current?jobs.filter(job=>job.parentJobId===current.id||(current.childJobIds??[]).includes(job.id)):[];
  const context={...base,...(current?{currentJobId:current.id,stage:active?.stage??current.stage}:{}),childJobIds:children.map(job=>job.id)};
  const result=current?.result as {run?:TestingRun;runId?:string;needsBusinessReview?:boolean;plan?:{unsupported?:string[]};applied?:boolean;reviewStatus?:string;needsKnowledge?:boolean;reuseError?:string}|undefined;
  const linkedId=current?.runId??result?.run?.id??result?.runId;
  const linkedRun=linkedId?runs.find(run=>run.id===linkedId&&run.scenarioId===scenario.id&&run.scenarioRevision===scenario.revision&&run.compiled.fingerprint===fingerprint):undefined;
  const direct=runs.filter(run=>run.scenarioId===scenario.id&&run.scenarioRevision===scenario.revision&&run.compiled.fingerprint===fingerprint&&!jobs.some(job=>job.runId===run.id||(job.result as {run?:TestingRun;runId?:string}|undefined)?.run?.id===run.id||(job.result as {runId?:string}|undefined)?.runId===run.id)).sort((a,b)=>b.startedAt.localeCompare(a.startedAt))[0];
  const directState=(run:TestingRun):TestingScenarioLifecycle=>({...base,runId:run.id,runStatus:run.status,phase:'result',status:run.status==='passed'?'ready':run.status==='failed'?'failed':'running',nextAction:run.status==='passed'?'inspect-run':run.status==='failed'?'retry-technical':'wait',message:run.status==='passed'?'Der direkte Browserlauf dieser Fassung ist erfolgreich.':run.status==='failed'?'Der direkte Browserlauf ist fehlgeschlagen.':'Der direkte Browserlauf läuft.'});
  // A later explicit run supersedes an older finished job, without reviving an
  // old run while a newer agent request is still being prepared or reviewed.
  if(direct&&!active&&!children.some(job=>['queued','running'].includes(job.status))&&(!current||direct.startedAt>current.startedAt))return directState(direct);
  if(linkedRun)Object.assign(context,{runId:linkedRun.id,runStatus:linkedRun.status});
  if(linkedRun?.status==='passed'&&(active||children.some(job=>['queued','running'].includes(job.status))))return {...context,phase:'result',status:'ready',analysisRunning:true,nextAction:'inspect-run',message:'Der Browserlauf dieser Fassung ist erfolgreich. Die optionale Wiederverwendungsprüfung läuft noch.'};
  if(active||children.some(job=>['queued','running'].includes(job.status)))return {...context,phase:current?.phase==='business'||current?.phase==='exploration'?'exploration':linkedRun?'result':'technical',status:'running',nextAction:'wait',message:active?.stage==='knowledge'?'Das vorhandene Wissen wird geprüft.':active?.stage==='exploring'?'Die Anwendung wird in einer getrennten Testumgebung erkundet.':linkedRun?.status==='passed'?'Der Browserlauf ist erfolgreich. Die zugehörige Nachprüfung läuft noch.':'Der zugehörige Auftrag läuft. Noch ist keine abschließende Prüfung verfügbar.'};
  if(linkedRun?.status==='passed'&&(current?.phase==='reuse'||result?.reuseError||current?.stage==='reuse'))return {...context,phase:'result',status:'ready',analysisAttention:!!result?.reuseError||current?.status==='failed'||current?.status==='cancelled'||children.some(job=>['failed','cancelled'].includes(job.status)),nextAction:'inspect-run',message:result?.reuseError||['failed','cancelled'].includes(current?.status??'')||children.some(job=>['failed','cancelled'].includes(job.status))?'Der Browserlauf ist erfolgreich. Die optionale Wiederverwendungsanalyse wurde nicht abgeschlossen.':'Der Browserlauf und die optionale Wiederverwendungsanalyse sind abgeschlossen.'};
  if(current?.status==='failed'||current?.status==='cancelled')return {...context,phase:linkedRun?'result':current.phase==='business'?'exploration':'technical',status:current.status,nextAction:current.phase==='business'?'retry-business':'retry-technical',message:current.phase==='business'?'Die Anforderung bleibt gespeichert. Die Entwurfsplanung kann für diesen Testfall erneut gestartet werden.':'Die technische Prüfung ist nicht abgeschlossen. Der letzte gesicherte Fachstand bleibt erhalten.'};
  if(result?.needsKnowledge)return {...context,phase:'exploration',status:'attention',nextAction:'review',message:'Für den Entwurf fehlen fachliche Angaben. Ergänze die offenen Wissensfragen und starte die Planung erneut.'};
  if(result?.reuseError)return {...context,phase:'result',status:'attention',nextAction:'inspect-run',message:'Der Browserlauf ist abgeschlossen. Die anschließende Wiederverwendungsprüfung konnte nicht abgeschlossen werden.'};
  if(result?.needsBusinessReview)return {...context,phase:'review',status:'attention',nextAction:'review',message:'Die technische Planung benötigt eine fachliche Entscheidung zu anderen Bausteinen.'};
  if(result?.plan?.unsupported?.length)return {...context,phase:'technical',status:'attention',nextAction:'review',message:'Für die technische Umsetzung fehlen noch geklärte Fähigkeiten oder Angaben.'};
  if(linkedRun)return {...context,phase:'result',status:linkedRun.status==='passed'?'ready':linkedRun.status==='failed'?'failed':'running',nextAction:linkedRun.status==='failed'?'retry-technical':linkedRun.status==='passed'?'inspect-run':'wait',message:linkedRun.status==='passed'?'Der zugeordnete Browserlauf dieser Fassung ist erfolgreich.':linkedRun.status==='failed'?'Der Browserlauf ist fehlgeschlagen. Prüfe den betroffenen Schritt.':'Der Browserlauf läuft.'};
  if(!scenario.blocks.length)return {...context,phase:'request',status:'idle',nextAction:'plan',message:'Die Anforderung ist gespeichert und kann jetzt erkundet und geplant werden.'};
  if(current?.phase==='business'&&result?.applied===false&&result.reviewStatus==='pending')return {...context,phase:'review',status:'attention',nextAction:'review',message:'Ein Änderungsvorschlag wartet auf deine Prüfung.'};
  const compiled=compileTestingScenario(scenario,catalog,approval),approved=approval?.scenarioRevision===scenario.revision&&approval.fingerprint===fingerprint;
  if(!compiled.valid)return {...context,phase:'review',status:'attention',nextAction:'review',message:'Der fachliche Ablauf enthält noch offene Prüfhinweise. Korrigiere sie vor der Freigabe.'};
  if(!approved)return {...context,phase:'review',status:'attention',nextAction:'approve',message:'Prüfe die fachlichen Schritte und gib diese Fassung frei.'};
  return {...context,phase:'technical',status:'idle',nextAction:compiled.executable?'run':'technical',message:compiled.executable?'Die freigegebene Fassung kann mit vorhandener Technik ausgeführt werden.':'Die fachliche Fassung ist freigegeben. Jetzt folgt die technische Prüfung.'};
}
