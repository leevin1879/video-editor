'use strict';
// A paired, opt-in editor executes commands; IndexedDB media never leaves via metadata.
const pluginClient = crypto.randomUUID();
let pluginEnabled = false, pluginPolling = false;
const pluginPost = (action, body={}) => api('/api/plugin/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Vedit-Editor':'1'},body:JSON.stringify({client:pluginClient,...body})});
function pluginSummary() {
  return {name:P.name,ratio:P.ratio,width:P.width,height:P.height,fps:P.fps,duration:totalDuration(),
    media:P.media.map(m=>({id:m.id,name:m.name,type:m.type,duration:m.duration,hasAudio:m.hasAudio,missing:!!m.missingLocal})),
    tracks:structuredClone(P.tracks),sound_effects:SOUND_EFFECTS.map(([id,name])=>({id,name:tr(name)}))};
}
function pluginNumber(v,min,max,label) {
  if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max) throw new Error('Invalid '+label);
  return v;
}
async function pluginEdit(operations) {
  if(!Array.isArray(operations)||!operations.length||operations.length>50) throw new Error('Use 1–50 operations');
  const before=JSON.stringify(P),next=structuredClone(P);
  const clip=(o)=>{
    if(!['main','overlay','audio','text'].includes(o.track))throw new Error('Invalid track');
    const c=next.tracks[o.track].find(c=>c.id===o.clip_id);if(!c)throw new Error('Unknown clip');return c;
  };
  for(const o of operations) {
    switch(o.type) {
      case 'set_ratio':
        if(!RATIOS[o.ratio])throw new Error('Invalid ratio');
        next.ratio=o.ratio;[next.width,next.height]=RATIOS[o.ratio];break;
      case 'trim': {
        if(o.track==='text')throw new Error('Trim requires media clip');
        const c=clip(o),m=next.media.find(m=>m.id===c.mediaId);
        c.in=pluginNumber(o.in,0,m.duration-MIN_CLIP,'in');c.out=pluginNumber(o.out,c.in+MIN_CLIP,m.duration,'out');
        if(c.curve)throw new Error('Disable speed curve before trimming through plugin');break;
      }
      case 'set_volume': {
        if(o.track==='text')throw new Error('Text has no volume');
        clip(o).volume=pluginNumber(o.volume,0,2,'volume');break;
      }
      case 'set_speed': {
        if(o.track==='text')throw new Error('Text has no speed');
        const c=clip(o);c.speed=pluginNumber(o.speed,.1,10,'speed');delete c.curve;delete c.segs;break;
      }
      case 'move': {
        if(o.track==='main')throw new Error('Use reorder for main track');
        clip(o).start=pluginNumber(o.start,0,86400,'start');break;
      }
      case 'reorder': {
        if(o.track!=='main')throw new Error('Reorder supports main track only');
        const c=clip(o),a=next.tracks.main;a.splice(a.indexOf(c),1);a.splice(pluginNumber(o.index,0,a.length,'index'),0,c);break;
      }
      case 'remove': {const c=clip(o);next.tracks[o.track]=next.tracks[o.track].filter(x=>x!==c);break;}
      case 'add_media': {
        const m=next.media.find(m=>m.id===o.media_id);if(!m||m.missingLocal)throw new Error('Unknown or missing media');
        if(!['main','overlay','audio'].includes(o.track))throw new Error('Invalid track');
        if(o.track==='audio'&&!m.hasAudio)throw new Error('Media has no audio');
        if(o.track!=='audio'&&m.type==='audio')throw new Error('Audio requires audio track');
        const c=o.track==='main'?makeMainClip(m):o.track==='audio'?makeAudioClip(m,0):makeOverlayClip(m,0);
        if(o.track!=='main')c.start=pluginNumber(o.start??0,0,86400,'start');
        next.tracks[o.track].push(c);break;
      }
      case 'add_text': {
        if(typeof o.text!=='string'||!o.text.trim()||o.text.length>2000)throw new Error('Invalid text');
        const c=makeTextClip({text:o.text});c.text=o.text;
        c.start=pluginNumber(o.start,0,86400,'start');c.duration=pluginNumber(o.duration,.1,3600,'duration');
        c.x=pluginNumber(o.x??.5,0,1,'x');c.y=pluginNumber(o.y??.86,0,1,'y');
        c.fontSize=pluginNumber(o.font_size??64,12,300,'font_size');
        if(o.color&&!/^#[0-9a-f]{6}$/i.test(o.color))throw new Error('Invalid color');
        c.color=o.color??'#ffffff';c.bold=true;c.strokeWidth=4;next.tracks.text.push(c);break;
      }
      case 'add_sound_effect': {
        const s=SOUND_EFFECTS.find(([id])=>id===o.effect_id);if(!s)throw new Error('Unknown sound effect');
        const start=pluginNumber(o.start,0,86400,'start'),volume=pluginNumber(o.volume??1,0,2,'volume');
        let m=next.media.find(m=>m.soundEffect===s[0]&&!m.missingLocal);
        if(!m) {const r=await fetch(`/static/sounds/${s[0]}.wav`);if(!r.ok)throw new Error('Sound unavailable');
          m=await DeviceMedia.importFile(new File([await r.blob()],s[0]+'.wav',{type:'audio/wav'}));m.soundEffect=s[0];next.media.push(m);}
        const c=makeAudioClip(m,start);c.volume=volume;next.tracks.audio.push(c);break;
      }
      default:throw new Error('Unsupported operation');
    }
  }
  if(!pluginEnabled)throw new Error('Connection disabled');
  if(JSON.stringify(P)!==before)throw new Error('Project changed during command; read project and retry');
  commit();P=next;ui.sel=null;loadProjectUI();return pluginSummary();
}
async function pluginExecute(c) {
  if(ui.exporting||uploading.size||ui.editing)throw new Error('Editor is busy');
  switch(c.action) {
    case 'get_project':return pluginSummary();
    case 'edit_timeline':setPlaying(false);return pluginEdit(c.arguments.operations);
    case 'undo':undo();return pluginSummary();
    case 'export_video': {
      // Device export only: never silently upload user media from an AI command.
      if(!totalDuration())throw new Error('Timeline is empty');
      const old=exportMode;exportMode='device';
      try {await exportVideo();}finally {exportMode=old;}
      if(!$('#deviceDownload'))throw new Error('Export did not complete; check the editor dialog');
      return {status:'ready',download_location:'Click Download in the open VEdit tab',name:P.name+'.mp4'};
    }
    default:throw new Error('Unsupported action');
  }
}
async function pluginPoll() {
  if(!pluginEnabled||pluginPolling)return;
  pluginPolling=true;
  try {
    const {commands}=await pluginPost('poll');
    for(const c of commands) {
      let result,error=false;
      try {result=await pluginExecute(c);}catch(e){result={error:e.message};error=true;}
      await pluginPost('complete',{id:c.id,result,error});
    }
  }catch(e){if(pluginEnabled){pluginEnabled=false;$('#btnChatGPT').classList.remove('on');toast(e.message,5000);}}
  finally {pluginPolling=false;}
}
$('#btnChatGPT').onclick=async()=>{
  if(pluginPolling)return toast(tr('Đang xử lý lệnh ChatGPT'));
  try {
    if(pluginEnabled) {await pluginPost('disconnect');pluginEnabled=false;$('#btnChatGPT').classList.remove('on');return;}
    const {token}=await pluginPost('connect');pluginEnabled=true;$('#btnChatGPT').classList.add('on');
    modal('ChatGPT',`<p>${tr('Kết nối plugin VEdit bằng mã ghép nối dưới đây. Giữ tab này mở.')}</p><input id="pluginPairingKey" readonly style="width:100%" value="${esc(token)}"><p>${tr('Chạy start-plugin.bat rồi kết nối MCP qua Secure MCP Tunnel. Không chia sẻ mã này.')}</p>`);
    $('#pluginPairingKey').onclick=e=>e.target.select();await pluginPoll();
  }catch(e){toast(e.message,6000);}
};
setInterval(pluginPoll,1000);
