import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
class LegacySignal extends EventTarget {
  aborted=false;reason=undefined;
}
class LegacyController {
  signal=new LegacySignal();
  abort(reason){if(this.signal.aborted)return;this.signal.aborted=true;this.signal.reason=reason;this.signal.dispatchEvent(new Event('abort'));}
}
const timers=[];
const source=ts.transpileModule(await readFile('src/lib/abortSignalCompat.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
vm.runInNewContext(source,{AbortSignal:LegacySignal,AbortController:LegacyController,DOMException,setTimeout:fn=>timers.push(fn)});
const timeout=LegacySignal.timeout(10),original=new LegacyController(),merged=LegacySignal.any([original.signal,timeout]);
assert.equal(merged.aborted,false);timers[0]();assert.equal(merged.aborted,true);assert.equal(merged.reason.name,'TimeoutError');
const first=new LegacyController();first.abort('already-cancelled');assert.equal(LegacySignal.any([first.signal]).reason,'already-cancelled');
const second=new LegacyController(),combined=LegacySignal.any([second.signal]);second.abort('cancel');assert.equal(combined.reason,'cancel');
console.log('PASS iOS compatibility: requests time out and cancel correctly without native AbortSignal.any or timeout');
