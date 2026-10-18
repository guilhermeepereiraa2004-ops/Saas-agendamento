import {spawnSync} from 'node:child_process';
const tests=['test-schema-bootstrap','test-database','test-accounts','test-server-keys','test-pwa-manifest','test-push-device','test-push-api','test-subscription-billing','test-tenant-theme','test-master-reset','test-abort-compat'];
// Each child supplies its own fixtures. Never inherit production application keys.
const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^(SUPABASE_|ONESIGNAL_|VITE_|APP_ORIGIN$)/.test(name)));
for(const name of tests){
  const result=spawnSync(process.execPath,[`scripts/${name}.mjs`],{stdio:'inherit',env});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status||1);
}
