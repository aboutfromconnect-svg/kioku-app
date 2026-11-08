const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(process.argv[2]||path.join(__dirname,'safari-update-once.js'),'utf8');
const configured=source.match(/const allowedOrigin = '([^']+)'/)[1];
const origin=configured.includes('SET-TEST-SITE')?'https://kioku-synthetic-test.netlify.app':configured;
function emitter(object){const listeners=new Map();return Object.assign(object,{addEventListener(n,fn){if(!listeners.has(n))listeners.set(n,new Set());listeners.get(n).add(fn)},removeEventListener(n,fn){listeners.get(n)?.delete(fn)},emit(n){for(const fn of listeners.get(n)||[])fn()},count(){return [...listeners.values()].reduce((n,s)=>n+s.size,0)}});}
async function run(options={}){
 const alerts=[],calls={get:0,update:0,confirm:0},active=emitter({state:'activated',scriptURL:origin+'/service-worker.js'});
 const reg=emitter({scope:options.scope||origin+'/',active,waiting:null,installing:null});let added;
 if(options.wrongScript)active.scriptURL=origin+'/other.js';
 if(options.pending)reg[options.pending]=emitter({state:'installed',scriptURL:active.scriptURL});
 reg.update=()=>{calls.update++;if(options.failure)return Promise.reject(new TypeError('network'));if(options.timeout)return new Promise(()=>{});if(options.install){added=reg.installing=emitter({state:'installing',scriptURL:active.scriptURL});reg.emit('updatefound');added.state=options.install==='fail'?'redundant':'activated';added.emit('statechange');reg.installing=null;if(options.install!=='fail')reg.active=added;}return Promise.resolve(reg)};
 const fail=()=>{throw Error('Forbidden API')};
 const sandbox={location:Object.freeze({origin:options.origin||origin,href:(options.origin||origin)+'/'}),window:{},navigator:{onLine:!options.offline,serviceWorker:{controller:active,getRegistration:async()=>{calls.get++;return options.noRegistration?null:reg},register:fail}},isSecureContext:true,alert:s=>alerts.push(s),confirm:()=>{calls.confirm++;return options.cancel!==calls.confirm},setTimeout:(fn,ms)=>setTimeout(fn,ms===30000?30:ms===5000?5:1),clearTimeout};
 for(const k of ['indexedDB','caches','localStorage','sessionStorage','fetch'])Object.defineProperty(sandbox,k,{get:fail});
 reg.unregister=fail;active.postMessage=fail;
 vm.createContext(sandbox);const code=source.replace(configured,origin).replace(/^void /,'');
 await vm.runInContext(code,sandbox);if(options.repeat)await vm.runInContext(code,sandbox);
 assert.equal(reg.count(),0);if(added)assert.equal(added.count(),0);
 return {alerts,calls};
}
(async()=>{
 for(const domain of ['https://example.github.io','https://other.netlify.app','http://'+new URL(origin).host,origin+'.evil.example']){const r=await run({origin:domain});assert.equal(r.calls.update,0);assert.equal(r.calls.get,0);assert.equal(r.calls.confirm,0)}console.log('PASS exact HTTPS origin restriction');
 for(const cancel of [1,2]){const r=await run({cancel});assert.equal(r.calls.update,0);assert.equal(r.calls.get,0)}console.log('PASS backup or authorization cancellation prevents all worker calls');
 for(const option of [{scope:origin+'/other/'},{wrongScript:true},{noRegistration:true}])assert.equal((await run(option)).calls.update,0);console.log('PASS absent registration, wrong scope and wrong worker refused');
 for(const pending of ['installing','waiting'])assert.equal((await run({pending})).calls.update,0);console.log('PASS existing pending work is not overlapped');
 assert.equal((await run({offline:true})).calls.update,0);console.log('PASS offline request refused');
 let r=await run({install:'success',repeat:true});assert.equal(r.calls.update,1);assert.match(r.alerts[0],/installing → activated/);assert.match(r.alerts[1],/既に/);console.log('PASS one update only; fast activation observed; second execution prevented');
 r=await run();assert.equal(r.calls.update,1);assert.match(r.alerts[0],/新版の画面表示はまだ確認していません/);console.log('PASS unchanged worker does not claim new release success');
 r=await run({install:'fail'});assert.match(r.alerts[0],/破棄/);console.log('PASS redundant worker reported');
 r=await run({failure:true});assert.match(r.alerts[0],/TypeError/);console.log('PASS update rejection reported without deletion or reload');
 r=await run({timeout:true,repeat:true});assert.match(r.alerts[0],/キャンセルしたわけではなく/);assert.equal(r.calls.update,1);console.log('PASS timeout reports continued processing possibility; no retry');
 console.log('PASS 10 groups; storage/network/deletion APIs blocked and listeners cleaned');
})().catch(e=>{console.error(e);process.exitCode=1});
