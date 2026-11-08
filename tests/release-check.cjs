// Read-only release checks. Does not open any database or access a remote service.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const assets=['index.html','data-safety.js','service-worker.js','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png'];
for(const file of assets){
  assert(fs.statSync(path.join(root,file)).isFile());
  if(!file.endsWith('.png'))assert(!/kioku-test-|netlify-test|実機テスト専用/.test(read(file)),`Test content in ${file}`);
}
const html=read('index.html'),data=read('data-safety.js'),sw=read('service-worker.js');
assert(data.includes("DB_NAME = 'kioku-personal-v1', DB_VERSION = 1"));
assert(html.includes('function openDB(){return KiokuData.openDatabase()}'));
assert(!/deleteDatabase\s*\(|deleteObjectStore\s*\(/.test(data+html+sw));
const integrity='sha256-'+createHash('sha256').update(fs.readFileSync(path.join(root,'data-safety.js'))).digest('base64');
assert(html.includes(`integrity="${integrity}"`));assert(sw.includes(`INTEGRITY = '${integrity}'`));
assert(!sw.includes('self.skipWaiting('));assert(read('.gitattributes').includes('*.js text eol=lf'));
for(const item of ['tests','netlify-test-package','README.md','RELEASE.md'])assert(read('_config.yml').includes('  - '+item));
assert(!fs.existsSync(path.join(root,'.nojekyll')),'Jekyll exclusions would be bypassed');
const ignored=execFileSync('git',['check-ignore','netlify-test-package/v0.1.1/data-safety.js'],{cwd:root,encoding:'utf8'});
assert(ignored.includes('netlify-test-package'));
const tracked=execFileSync('git',['ls-files'],{cwd:root,encoding:'utf8'});
assert(!tracked.split('\n').some(f=>f.startsWith('netlify-test-package/')));
const m=JSON.parse(read('manifest.webmanifest'));assert.equal(m.id,'./');assert.equal(m.scope,'./');assert.equal(m.start_url,'./');
console.log('PASS Release checks: production DB/version, no test assets, no DB deletion/migration, SRI, worker activation, Git ignore and Pages exclusions');
console.log('NOTE: Actual GitHub Pages settings/build must be checked before publishing. This is not a Jekyll build.');
