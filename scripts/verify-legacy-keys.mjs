import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const env=await readFile(new URL('../.env',import.meta.url),'utf8');
const value=name=>env.match(new RegExp(`^${name}\\s*=\\s*(.*)$`,'m'))?.[1].trim().replace(/^['"]|['"]$/g,'');
const url=value('VITE_SUPABASE_URL');
const currentKey=value('VITE_SUPABASE_ANON_KEY');
const legacyKey=process.argv[process.argv.indexOf('--legacy-public-key')+1];
let claims;
try{claims=JSON.parse(Buffer.from(legacyKey.split('.')[1],'base64url').toString());}catch{throw new Error('Informe somente a chave PUBLICA anon antiga.');}
assert.equal(claims.role,'anon','Este teste recusa chaves administrativas.');
assert.equal(claims.ref,new URL(url).hostname.split('.')[0]);
assert.ok(currentKey.startsWith('sb_publishable_'));
const endpoint=`${url}/rest/v1/rpc/get_public_tenant`;
const check=headers=>fetch(endpoint,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({p_slug:'qa-nao-existe-'+crypto.randomUUID()}),signal:AbortSignal.timeout(15000)});
const [oldApi,oldBearer,current]=await Promise.all([
  check({apikey:legacyKey}),
  check({apikey:currentKey,Authorization:`Bearer ${legacyKey}`}),
  check({apikey:currentKey}),
]);
const result={checkedAt:new Date().toISOString(),legacyApiKeyHttp:oldApi.status,legacyBearerHttp:oldBearer.status,currentPublicHttp:current.status};
await writeFile(new URL('../scratch/admin-audit/legacy-key-status.json',import.meta.url),JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
assert.equal(current.status,200,'A chave publica atual deve continuar funcionando.');
if(process.argv.includes('--expect-legacy-bearer')) assert.equal(oldBearer.status,200,'A prova inicial exige que o JWT publico antigo ainda seja valido.');
if(process.argv.includes('--require-revoked')) {
  assert.equal(oldApi.status,401,'A chave publica antiga deve ser rejeitada como apikey.');
  assert.equal(oldBearer.status,401,'A assinatura antiga ainda e aceita como JWT.');
}
