import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';

function windowPrompt(mode, account){
  return new Promise((resolvePrompt,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./master-reset-window.ps1',import.meta.url)),'-Mode',mode,'-Account',account],{windowsHide:true,stdio:['ignore','pipe','ignore']});
    let output='';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',chunk=>{output+=chunk;});
    child.on('error',()=>reject(new Error('Não foi possível abrir a janela de troca de senha.')));
    child.on('close',code=>{
      if(code!==0){output='';reject(new Error('A janela não pôde ser concluída.'));return;}
      resolvePrompt(output);
      output='';
    });
  });
}

function hiddenInput(label){
  if(!process.stdin.isTTY||!process.stdout.isTTY) throw new Error('Execute este comando em um terminal interativo.');
  return new Promise((resolveInput,reject)=>{
    let value='';
    const previousRaw=process.stdin.isRaw;
    const finish=(error)=>{
      process.stdin.removeListener('data',onData);
      process.stdin.setRawMode(Boolean(previousRaw));
      process.stdin.pause();
      process.stdout.write('\n');
      if(error) reject(error); else resolveInput(value);
    };
    const onData=chunk=>{
      for(const character of chunk){
        if(character==='\u0003'){finish(new Error('Operação cancelada.'));return;}
        if(character==='\r'||character==='\n'){finish();return;}
        if(character==='\u007f'||character==='\b'){value=Array.from(value).slice(0,-1).join('');continue;}
        if(character>=' '&&value.length<4096) value+=character;
      }
    };
    process.stdout.write(label);
    process.stdin.setEncoding('utf8');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data',onData);
  });
}

export async function resetMasterPassword({target,readSecret,request=fetch,notice=()=>{}}){
  if(!/^[a-z]{20}$/.test(target.projectRef)||!/^[0-9a-f-]{36}$/i.test(target.userId)||typeof target.email!=='string') throw new Error('Identificação da conta inválida.');
  let key=(process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||await readSecret('Cole a chave secreta do Supabase (entrada oculta): ')).trim();
  try{
    const modern=/^sb_secret_[A-Za-z0-9_-]{20,}$/.test(key);
    if(!modern){
      let claims;
      try{claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString());}catch{throw new Error('Use uma chave secreta do Supabase (sb_secret_) ou service_role.');}
      if(claims.role!=='service_role'||claims.ref!==target.projectRef) throw new Error('A chave não é service_role deste projeto. Nenhuma alteração foi feita.');
    }
    const endpoint=`https://${target.projectRef}.supabase.co/auth/v1/admin/users/${target.userId}`;
    const headers={apikey:key,'Content-Type':'application/json',...(!modern?{Authorization:`Bearer ${key}`}:{})};
    const response=await request(endpoint,{headers,signal:AbortSignal.timeout(15000)});
    if(!response.ok) throw new Error(`Não foi possível validar a conta (${response.status}). Nenhuma alteração foi feita.`);
    const data=await response.json(); const user=data.user||data;
    if(user.id!==target.userId||user.email?.toLowerCase()!==target.email.toLowerCase()) throw new Error('A conta retornada não corresponde ao master esperado. Nenhuma alteração foi feita.');
    notice(`Conta confirmada: ${target.email}`);
    let password=await readSecret('Digite a nova senha (mínimo de 12 caracteres, entrada oculta): ');
    if(password.length<12||password.length>128) throw new Error('A senha precisa ter entre 12 e 128 caracteres. Nenhuma alteração foi feita.');
    let confirmation=await readSecret('Repita a nova senha (entrada oculta): ');
    if(password!==confirmation) throw new Error('As senhas não coincidem. Nenhuma alteração foi feita.');
    confirmation='';
    const updated=await request(endpoint,{method:'PUT',headers,body:JSON.stringify({password}),signal:AbortSignal.timeout(15000)});
    password='';
    if(!updated.ok) throw new Error(`O Supabase não confirmou a troca (${updated.status}).`);
    return {updated:true,userId:target.userId};
  }finally{key='';}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const useWindow=process.argv.includes('--window');
  try{
    const target=JSON.parse(await readFile(new URL('../.master-reset.local',import.meta.url),'utf8'));
    console.log('Troca de senha da mesma conta master. Chave e senha não serão exibidas nem salvas em arquivo.');
    if(useWindow){
      let raw=await windowPrompt('input',target.email);
      if(!raw){console.log('Operação cancelada.');process.exit(0);}
      let values;
      try{values=JSON.parse(raw);}catch{throw new Error('Não foi possível ler os campos da janela.');}finally{raw='';}
      try{
        await resetMasterPassword({target,readSecret:async label=>label.startsWith('Cole')?values.serviceRoleKey:label.startsWith('Repita')?values.confirmation:values.password});
      }finally{values.serviceRoleKey='';values.password='';values.confirmation='';}
      await windowPrompt('success',target.email);
    }else{
      await resetMasterPassword({target,readSecret:hiddenInput,notice:message=>console.log(message)});
    }
    console.log('Senha atualizada. Entre em https://saas-agendamento-swart.vercel.app/admin com a senha nova.');
  }catch(error){console.error(error.message);process.exitCode=1;if(useWindow)await windowPrompt('failure','administrador').catch(()=>{});}
}
