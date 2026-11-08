// Run after changing either module. Only updates matching SRI values, never a DB.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..');
let html=fs.readFileSync(path.join(root,'index.html'),'utf8'),sw=fs.readFileSync(path.join(root,'service-worker.js'),'utf8');
for(const [file,constant] of [['data-safety.js','INTEGRITY'],['environment.js','ENVIRONMENT_INTEGRITY'],['updates.js','UPDATES_INTEGRITY']]){
  const p=path.join(root,file),text=fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');fs.writeFileSync(p,text);
  const integrity='sha256-'+createHash('sha256').update(text).digest('base64');
  html=html.replace(new RegExp(`(src="\\./${file}[^\"]*" integrity=")[^\"]+"`),'$1'+integrity+'"');
  sw=sw.replace(new RegExp(`const ${constant} = '[^']+'`),`const ${constant} = '${integrity}'`);
}
fs.writeFileSync(path.join(root,'index.html'),html);fs.writeFileSync(path.join(root,'service-worker.js'),sw.replaceAll('\r\n','\n'));
