import {spawnSync} from 'node:child_process';
for(const args of [
  ['node_modules/eslint/bin/eslint.js','.'],
  ['scripts/test-all.mjs'],
  ['node_modules/typescript/bin/tsc','-b'],
  ['node_modules/vite/bin/vite.js','build'],
]){
  const result=spawnSync(process.execPath,args,{stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status||1);
}
