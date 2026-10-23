// Isolated UI contract test. No platform calls or real video uploads.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const elements=new Map(),stored=new Map(),calls=[];
const el=id=>{if(!elements.has(id))elements.set(id,{value:'',checked:false,hidden:false,disabled:false,style:{},querySelector:()=>null,querySelectorAll:()=>[]});return elements.get(id);};
const project={name:'Original video'},blob=new Blob(['test-video']);
let failTikTok=false;
const sandbox={Blob,URL,URLSearchParams,TextEncoder,console,setTimeout,crypto:{randomUUID:()=> 'test-request-'+Math.random().toString(16).slice(2)},
  location:{origin:'https://example.com'},P:project,totalDuration:()=>15,
  tr:s=>s,esc:s=>String(s),$:el,toast:()=>{},modal:()=>{},closeModal:()=>{},exportVideo:async()=>{},
  document:{body:{classList:{add:()=>{},remove:()=>{}}}},
  sessionStorage:{getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},
  window:{addEventListener:()=>{}},api:async(url,opts)=>{
    calls.push({url,opts});
    if(url==='/api/youtube/status')return {connected:true,configured:true,channel:{title:'YT Creator'}};
    if(url==='/api/tiktok/status')return {connected:true,configured:true,account:{name:'TT Creator'}};
    if(url==='/api/tiktok/creator')return {creator_nickname:'TT Creator',privacy_level_options:['SELF_ONLY'],max_video_post_duration_sec:60};
    if(url==='/api/youtube/uploads')return {id:'yt-session',chunk_size:100};
    if(url.startsWith('/api/youtube/chunk'))return {status:'done',url:'https://youtube.com/watch?v=1234567'};
    if(url==='/api/tiktok/uploads'){if(failTikTok)throw Error('TikTok unavailable');return {id:'tt-session',chunk_size:100,source:'FILE_UPLOAD'};}
    if(url.startsWith('/api/tiktok/chunk'))return {offset:blob.size};
    if(url==='/api/tiktok/upload-status')return {status:'PUBLISH_COMPLETE',post_ids:[]};
    throw Error('Unexpected API call '+url);
  }};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('static/youtube.js','utf8'),sandbox);
vm.runInContext(fs.readFileSync('static/social-publish.js','utf8'),sandbox);
(async()=>{
  sandbox.window.YouTubePublish.setExport({blob,name:'test.mp4',version:JSON.stringify(project)});
  await sandbox.showSocialPublish();
  assert.equal(el('#spUseYT').checked,false,'No destination preselected');
  assert.equal(el('#spUseTT').checked,false);
  assert.equal(el('#spSend').disabled,true);
  el('#spUseYT').checked=true;el('#spUseTT').checked=true;el('#spTitle').value='Test';el('#spKids').value='no';el('#spYTPrivacy').value='private';
  el('#spUseTT').onchange();assert.equal(el('#spSend').disabled,true,'TikTok privacy and consent are required');
  el('#spTTPrivacy').value='SELF_ONLY';el('#spConsent').checked=true;el('#spConsent').onchange();
  assert.equal(el('#spSend').disabled,false);
  await el('#spSend').onclick();
  assert.equal(calls.filter(c=>c.url==='/api/youtube/uploads').length,1);
  assert.equal(calls.filter(c=>c.url==='/api/tiktok/uploads').length,1);
  assert.equal(JSON.parse(calls.find(c=>c.url==='/api/tiktok/uploads').opts.body).consent,true);
  assert.match(el('#spResultYouTube').textContent,/Đã tải video/);
  assert.match(el('#spResultTikTok').textContent,/Đã đăng TikTok/);
  assert.equal(el('#spSend').disabled,true,'No accidental second submission after success');
  project.name='Changed';await sandbox.showSocialPublish();
  assert.equal(el('#spSend').disabled,true,'Changed edit requires fresh export');
  failTikTok=true;calls.length=0;
  sandbox.window.YouTubePublish.setExport({blob,name:'test.mp4',version:JSON.stringify(project)});
  await sandbox.showSocialPublish();
  await el('#spSend').onclick();
  assert.match(el('#spResultYouTube').textContent,/Đã tải video/,'YouTube success survives TikTok failure');
  assert.match(el('#spResultTikTok').textContent,/TikTok unavailable/);
  assert.equal(calls.filter(c=>c.url==='/api/youtube/uploads').length,1,'Successful destination never retried');
  assert.equal(el('#spSend').disabled,true);
  console.log('Cross-post UI: explicit destinations, TikTok privacy/consent, both results and duplicate guard passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
