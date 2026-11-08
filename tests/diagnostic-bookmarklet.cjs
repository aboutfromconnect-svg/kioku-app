const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(process.argv[2]||require('node:path').join(__dirname,'safari-diagnostic.js'),'utf8');
const configuredOrigin=source.match(/const allowedOrigin = '([^']+)'/)[1];
const target=configuredOrigin.includes('SET-TEST-SITE')?'https://kioku-synthetic-test.netlify.app':configuredOrigin;
async function run({origin=target,registration,controller=null,reject=false,configured=true}={}){
 const alerts=[],calls=[];
 const forbidden=()=>{throw new Error('Forbidden mutation or storage access')};
 const sw=new Proxy({controller,getRegistration:async url=>{calls.push(url);if(reject)throw Error('denied');return registration;}},{get:(o,k)=>k in o?o[k]:forbidden()});
 const sandbox={location:Object.freeze({origin,href:origin+'/'}),navigator:{serviceWorker:sw},isSecureContext:true,document:{querySelector:()=>({content:'0.1.1-safety2'})},alert:s=>alerts.push(s),setTimeout,clearTimeout};
 for(const k of ['indexedDB','caches','localStorage','sessionStorage','fetch'])Object.defineProperty(sandbox,k,{get:forbidden});
 vm.createContext(sandbox);
 // Execute the async expression directly to await its completion; delivered code keeps void.
 await vm.runInContext((configured?source.replace(configuredOrigin,target):source.replace(configuredOrigin,'https://SET-TEST-SITE.netlify.app')).replace(/^void /,''),sandbox);
 return {alerts,calls};
}
(async()=>{
 const active={state:'activated',scriptURL:target+'/service-worker.js'};
 for(const origin of ['https://example.github.io','https://other.netlify.app','http://kioku-synthetic-test.netlify.app','https://kioku-synthetic-test.netlify.app.evil.example']){const r=await run({origin});assert.equal(r.calls.length,0);assert.match(r.alerts[0],/停止/);}
 assert.equal((await run({configured:false})).calls.length,0);
 console.log('PASS exact test origin only; production, other domains and unset target refused');
 let r=await run({registration:{scope:target+'/',active,waiting:{...active,state:'installed'},installing:{...active,state:'installing'}},controller:active});
 for(const text of ['画面の版：0.1.1','ページの制御：あり','active（有効）：activated','waiting（待機）：installed','installing（準備中）：installing',target+'/'])assert(r.alerts[0].includes(text));assert.equal(r.calls.length,1);
 console.log('PASS worker states, scope, URL, controller and page release displayed');
 r=await run();assert.match(r.alerts[0],/該当登録なし/);assert.match(r.alerts[0],/ページの制御：なし/);
 console.log('PASS missing registration and controller handled');
 assert.match((await run({reject:true})).alerts[0],/取得できません/);
 console.log('PASS read failure handled; storage, network and mutation APIs forbidden throughout');
})().catch(e=>{console.error(e);process.exitCode=1});
