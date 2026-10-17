import assert from 'node:assert/strict';
let source='';
for await (const chunk of process.stdin) source+=chunk;
assert.ok(source.length>10000,'Bundle vazio ou resposta inesperada');
let privilegedKeys=0;
for(const token of source.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)||[]){
  try{if(JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString()).role==='service_role') privilegedKeys++;}catch{}
}
assert.equal(privilegedKeys,0,'Chave administrativa encontrada no bundle');
assert.ok(!/sb_secret_[A-Za-z0-9_-]{20,}/.test(source),'Chave secreta encontrada no bundle');
assert.ok(source.includes('get_public_tenant')&&source.includes('complete_service'),'Bundle não contém as correções esperadas');
console.log(JSON.stringify({bundleBytes:Buffer.byteLength(source),privilegedKeyDetected:false,secureTenantRpcPresent:true,transactionalCompletionPresent:true}));
