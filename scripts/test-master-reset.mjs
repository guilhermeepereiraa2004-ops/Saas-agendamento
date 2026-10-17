import assert from 'node:assert/strict';
import {resetMasterPassword} from './reset-master-password.mjs';
const target={projectRef:'abcdefghijklmnopqrst',userId:'11111111-1111-4111-8111-111111111111',email:'qa@example.invalid'};
const token=claims=>`eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.fixture`;
const key=token({role:'service_role',ref:target.projectRef});
const password='Fixture-only-password';
let calls=[],inputs=[],notices=[],email=target.email,status=200;
const request=async(url,options)=>{calls.push({url,options});return Response.json({id:target.userId,email},{status});};
const run=()=>resetMasterPassword({target,request,readSecret:async()=>inputs.shift(),notice:message=>notices.push(message)});
let count=0;
async function test(name,callback){calls=[];inputs=[key,password,password];notices=[];email=target.email;status=200;await callback();count++;console.log(`PASS ${name}`);}
await test('Rejects anon key without contacting the server',async()=>{inputs[0]=token({role:'anon',ref:target.projectRef});await assert.rejects(run,/service_role/);assert.equal(calls.length,0);});
await test('Rejects key from another project',async()=>{inputs[0]=token({role:'service_role',ref:'other'});await assert.rejects(run,/service_role/);assert.equal(calls.length,0);});
await test('Rejects a different account',async()=>{email='other@example.invalid';await assert.rejects(run,/não corresponde/);assert.equal(calls.length,1);});
await test('Rejects short or mismatched passwords before changing anything',async()=>{
  inputs=[key,'short','short'];await assert.rejects(run,/12 e 128/);assert.equal(calls.length,1);
  calls=[];inputs=[key,password,'different'];await assert.rejects(run,/não coincidem/);assert.equal(calls.length,1);
});
await test('Updates only the verified account password without logging secrets',async()=>{
  const result=await run();assert.equal(result.updated,true);assert.equal(calls.length,2);
  assert.equal(calls[1].options.method,'PUT');assert.deepEqual(JSON.parse(calls[1].options.body),{password});
  assert.equal(calls[0].url,calls[1].url);assert.ok(!notices.join('').includes(key));assert.ok(!notices.join('').includes(password));
});
await test('Provider rejection does not report success',async()=>{status=401;await assert.rejects(run,/validar a conta/);assert.equal(calls.length,1);});
await test('Modern secret uses only apikey and validates the same master before updating',async()=>{
  const modernKey='sb_secret_'+ 'fixture_only_'.repeat(3); inputs[0]=modernKey;
  assert.equal((await run()).updated,true);assert.equal(calls.length,2);
  for(const call of calls){assert.equal(call.options.headers.apikey,modernKey);assert.ok(!('Authorization' in call.options.headers));assert.ok(call.url.startsWith(`https://${target.projectRef}.supabase.co/`));}
});
await test('Publishable key cannot update a password',async()=>{inputs[0]='sb_publishable_'+'fixture_only_'.repeat(3);await assert.rejects(run,/chave secreta/);assert.equal(calls.length,0);});
await test('Modern key provider rejection prevents any password update',async()=>{inputs[0]='sb_secret_'+'fixture_only_'.repeat(3);status=401;await assert.rejects(run,/validar a conta/);assert.equal(calls.length,1);});
console.log(`Master reset: ${count} tests passed.`);
