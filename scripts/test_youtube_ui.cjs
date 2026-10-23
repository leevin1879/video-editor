// UI logic tests use an isolated VM and fake API; no Google request or upload occurs.
const fs=require('fs'), vm=require('vm'), assert=require('assert/strict');
const elements=new Map();
function element(id){if(!elements.has(id))elements.set(id,{value:'',style:{},disabled:false});return elements.get(id);}
let html='',calls=[],sourceVideo=new Blob(['test-video']);
const project={name:'Test title',tracks:{text:[]}};
const sandbox={Blob,URL,URLSearchParams,console,TextEncoder,location:{origin:'http://127.0.0.1:8765'},
  P:project,crypto:{randomUUID:()=> 'test-unique-request-12345'},setTimeout,
  tr:s=>s,esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
  $:s=>element(s),toast:s=>{sandbox.lastToast=s;},closeModal:()=>{},
  modal:(title,body)=>{html=body;},exportVideo:async()=>{},
  api:async(url,options)=>{
    calls.push({url,options});
    if(url==='/api/youtube/status')return {configured:true,connected:true,channel:{id:'channel-a',title:'Channel A'}};
    if(url==='/api/youtube/uploads')return {id:'session-1',chunk_size:8*1024*1024};
    if(url.startsWith('/api/youtube/chunk'))return {status:'done',url:'https://www.youtube.com/watch?v=test1234567',privacy:'private'};
    throw Error('Unexpected API request: '+url);
  },
  window:{addEventListener:()=>{}}};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('static/youtube.js','utf8'),sandbox);
(async()=>{
  sandbox.window.YouTubePublish.setExport({blob:sourceVideo,name:'Test.mp4',version:JSON.stringify(project)});
  await sandbox.showYouTube();
  assert.match(html,/<option value="private">/);
  assert.ok(html.indexOf('value="private"')<html.indexOf('value="public"'));
  element('#ytTitle').value='Test title';element('#ytPrivacy').value='private';element('#ytDescription').value='Description';
  await element('#ytPublish').onclick();
  assert.equal(calls.filter(c=>c.url==='/api/youtube/uploads').length,0,'No upload without audience selection');
  element('#ytKids').value='no';
  await element('#ytPublish').onclick();
  const upload=calls.find(c=>c.url==='/api/youtube/uploads');
  assert.equal(JSON.parse(upload.options.body).privacy,'private');
  assert.equal(JSON.parse(upload.options.body).made_for_kids,false);
  assert.equal(JSON.parse(upload.options.body).size,sourceVideo.size);
  assert.match(html,/test1234567/);
  project.name='Edited after export';
  await sandbox.showYouTube();
  assert.match(html,/ytPrepare/,'Stale export requires a new render');
  assert.doesNotMatch(html,/id="ytPublish"/);
  console.log('YouTube UI: private default, explicit audience, upload completion and stale export checks passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
