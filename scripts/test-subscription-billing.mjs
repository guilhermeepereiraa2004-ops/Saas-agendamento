import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=ts.transpileModule(await readFile(new URL('../src/lib/subscriptionBilling.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {subscriptionBilling,billingDay}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const today='2026-10-17';let passed=0;
function check(name,fn){fn();passed++;console.log('PASS',name);}
const billing=(status,date,day=today)=>subscriptionBilling({subscriptionStatus:status,nextPaymentAt:date},day);
for(const status of ['pending','overdue']) {
  check(`${status}: 28/10 ainda não venceu em 17/10`,()=>{const result=billing(status,'2026-10-28T00:00:00Z');assert.equal(result.status,'pending');assert.equal(result.timing,'future');assert.equal(result.label,'A vencer');});
  check(`${status}: vence hoje durante todo o dia 17/10`,()=>{const result=billing(status,'2026-10-17');assert.equal(result.status,'pending');assert.equal(result.label,'Vence hoje');});
  check(`${status}: data passada comprova atraso`,()=>{const result=billing(status,'2026-10-16');assert.equal(result.status,'overdue');assert.equal(result.timing,'past');});
}
check('sem data válida não inventa atraso',()=>{for(const date of [undefined,'','inválida','2026-02-30','2026-13-01']){const result=billing('overdue',date);assert.equal(result.status,'pending');assert.equal(result.dueDate,null);}});
check('pagamento ativo e teste não se tornam cobranças pelo calendário',()=>{for(const status of ['active','trial']){const result=billing(status,'2026-01-01');assert.equal(result.status,status);assert.equal(result.needsPayment,false);}});
check('virada de dia muda vence hoje para atrasado',()=>{assert.equal(billing('pending','2026-10-17','2026-10-17').status,'pending');assert.equal(billing('pending','2026-10-17','2026-10-18').status,'overdue');});
check('comparação funciona na virada de mês, ano e ano bissexto',()=>{assert.equal(billing('pending','2026-12-31','2027-01-01').status,'overdue');assert.equal(billing('pending','2028-02-29','2028-02-28').timing,'future');assert.equal(billing('pending','2027-02-29').dueDate,null);});
check('calendário local da Bahia não troca o dia por UTC',()=>{const original=process.env.TZ;try{process.env.TZ='America/Bahia';assert.equal(billingDay(new Date('2026-10-18T01:30:00Z')),'2026-10-17');assert.equal(billingDay(new Date('2026-10-18T03:00:00Z')),'2026-10-18');}finally{if(original===undefined)delete process.env.TZ;else process.env.TZ=original;}});
console.log(`${passed} testes de cobrança passaram.`);
