'use strict';
let speechBusy=false;
function wrapSubtitle(text){
  const lines=[];let line='';
  for(const word of text.split(/\s+/)){
    if(line&&(line+' '+word).length>22){lines.push(line);line='';}
    line+=(line?' ':'')+word;
  }
  if(line)lines.push(line);return lines.join('\n');
}
function speechPosition(c) {
  let start=0;
  for(const clip of P.tracks.main){if(clip.id===c.id)return start;start+=mainDur(clip);}
  return c.start||0;
}
function speechTime(c,source) {
  const segs=speedSegs(c),g=segs.find(s=>source<=s.b)||segs[segs.length-1];
  return g.t0+clamp(source-g.a,0,g.b-g.a)/g.s;
}
function speechSignature(c){return JSON.stringify([c.mediaId,c.in,c.out,c.speed,c.curve,speechPosition(c)]);}
async function generateSubtitles(clip,language='auto') {
  if(speechBusy||ui.exporting)throw Error(tr('Editor is busy'));
  const media=mediaById(clip.mediaId),snapshot=speechSignature(clip),project=P;
  if(!media?.hasAudio)throw Error(tr('Video không có âm thanh'));
  speechBusy=true;
  try{
    let source=media,cin=clip.in,cout=clip.out;
    modal(tr('Phụ đề tự động'),`<p>${tr('Đang nhận diện lời nói…')}</p>`);
    // Send only the selected audio range; keep the original video on the device.
    if(media.localId){source=await DeviceMedia.speechAudio(media,clip.in,clip.out);cin=0;cout=source.duration;}
    const {job_id}=await api('/api/transcribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({file:source.file,in:cin,out:cout,language})});
    let job;
    do{
      await new Promise(resolve=>setTimeout(resolve,1000));
      job=await api('/api/transcribe/'+job_id);
    }while(job.status==='running');
    if(job.status!=='done')throw Error(job.error||'Transcription failed');
    const current=findClip('main',clip.id)||findClip('overlay',clip.id)||findClip('audio',clip.id);
    if(P!==project||!current||speechSignature(current)!==snapshot)throw Error(tr('Timeline đã thay đổi. Tạo lại phụ đề cho clip hiện tại.'));
    const offset=speechPosition(current),end=offset+clipLen(current);
    const cues=job.result.segments.map(s=>{
      const start=offset+speechTime(current,current.in+s.start),stop=Math.min(end,offset+speechTime(current,current.in+s.end));
      return {...makeTextClip(TEXT_PRESETS[1]),id:uid(),start,duration:stop-start,text:wrapSubtitle(s.text),font:'Malgun Gothic',fontSize:Math.round(P.width*0.045),y:.85,subtitleSource:clip.id};
    }).filter(c=>c.duration>0.03&&c.text.trim());
    if(!cues.length)throw Error(tr('Không tìm thấy lời nói.'));
    commit();P.tracks.text=P.tracks.text.filter(c=>c.subtitleSource!==clip.id);P.tracks.text.push(...cues);
    changed();showTranscript();toast(tr('Phụ đề đã tạo')+': '+cues.length);
    return {language:job.result.language,count:cues.length,text:job.result.text};
  }finally{speechBusy=false;}
}
$('#btnAutoSubtitles').onclick=()=>{
  const clip=ui.sel&&['main','overlay','audio'].includes(ui.sel.track)?findClip(ui.sel.track,ui.sel.id):activeMain(ui.playhead)?.c;
  if(!clip)return toast(tr('Chọn video trên timeline trước.'));
  modal(tr('Phụ đề tự động'),`<p>${esc(mediaById(clip.mediaId)?.name||'')}</p><label>${tr('Ngôn ngữ lời nói')} <select id="speechLanguage"><option value="auto">${tr('Tự nhận diện')}</option><option value="ko">한국어</option><option value="vi">Tiếng Việt</option><option value="en">English</option></select></label><p><button id="speechGenerate" class="primary">${tr('Tạo phụ đề')}</button></p>`);
  $('#speechGenerate').onclick=()=>generateSubtitles(clip,$('#speechLanguage').value).catch(e=>{closeModal();toast(e.message,8000);});
};
function srtTime(time){const ms=Math.round(Math.max(0,time)*1000);return `${pad2(Math.floor(ms/3600000))}:${pad2(Math.floor(ms/60000)%60)}:${pad2(Math.floor(ms/1000)%60)},${String(ms%1000).padStart(3,'0')}`;}
function showTranscript(){
  const cues=P.tracks.text.filter(c=>c.subtitleSource).sort((a,b)=>a.start-b.start);
  if(!cues.length)return toast(tr('Chưa có phụ đề tự động.'));
  closeModal();
  modal(tr('Bản chép lời'),`<div style="max-height:55vh;overflow:auto">${cues.map(c=>`<div class="subtitle-row" data-cue="${c.id}"><div><input aria-label="${tr('Bắt đầu (giây)')}" type="number" min="0" step="0.01" value="${c.start.toFixed(2)}" data-time="start"> – <input aria-label="${tr('Kết thúc (giây)')}" type="number" min="0" step="0.01" value="${(c.start+c.duration).toFixed(2)}" data-time="end"></div><textarea aria-label="${tr('Nội dung')}">${esc(c.text)}</textarea></div>`).join('')}</div><p><button id="transcriptSave" class="primary">${tr('Lưu thay đổi')}</button></p><a id="transcriptTxt">${tr('Tải bản chép lời')}</a> · <a id="transcriptSrt">SRT</a>`);
  const links=[];
  function downloads(){
    links.splice(0).forEach(URL.revokeObjectURL);
    for(const [id,content,ext] of [['transcriptTxt',cues.map(c=>c.text).join('\n'),'txt'],['transcriptSrt',cues.map((c,i)=>`${i+1}\n${srtTime(c.start)} --> ${srtTime(c.start+c.duration)}\n${c.text}\n`).join('\n'),'srt']]){
      const a=$('#'+id),url=URL.createObjectURL(new Blob([content],{type:'text/plain;charset=utf-8'}));links.push(url);a.href=url;a.download=(P.name||'transcript')+'.'+ext;
    }
  }
  downloads();modal.onClose=()=>links.forEach(URL.revokeObjectURL);
  $('#transcriptSave').onclick=()=>{
    const edits=[...document.querySelectorAll('[data-cue]')].map(row=>({c:findClip('text',row.dataset.cue),start:+row.querySelector('[data-time=start]').value,end:+row.querySelector('[data-time=end]').value,text:row.querySelector('textarea').value}));
    if(edits.some(e=>!e.c||!Number.isFinite(e.start)||!Number.isFinite(e.end)||e.start<0||e.end<=e.start||e.end>totalDuration()+.1||e.text.length>2000))return toast(tr('Thời gian phụ đề không hợp lệ.'));
    commit();edits.forEach(e=>Object.assign(e.c,{start:e.start,duration:e.end-e.start,text:e.text}));changed();showTranscript();
  };
}
$('#btnTranscript').onclick=showTranscript;

function showBulkSubtitleStyle(){
  const cues=P.tracks.text.filter(c=>c.subtitleSource);
  if(!cues.length)return toast(tr('Chưa có phụ đề tự động.'));
  const ids=cues.map(c=>c.id),first=cues[0];
  const row=(key,label,control)=>`<div class="subtitle-style-row"><label><input type="checkbox" data-style-check="${key}"> ${tr(label)}</label>${control}</div>`;
  const numeric=(key,value,min,max,step=1)=>`<input data-style-value="${key}" aria-label="${tr({fontSize:'Cỡ chữ',x:'Ngang',y:'Dọc',strokeWidth:'Viền'}[key])}" type="number" min="${min}" max="${max}" step="${step}" value="${value}">`;
  closeModal();
  modal(tr('Chọn tất cả phụ đề'),`<p>${tr('Phụ đề đã chọn')}: ${ids.length}</p>
    ${row('font','Phông',`<select data-style-value="font">${FONTS.map(f=>`<option ${f===first.font?'selected':''}>${esc(f)}</option>`).join('')}</select>`)}
    ${row('fontSize','Cỡ chữ',numeric('fontSize',first.fontSize||60,16,300))}
    ${row('color','Màu',`<input type="color" data-style-value="color" value="${esc(first.color||'#ffffff')}">`)}
    ${row('bold','Đậm',`<input type="checkbox" data-style-value="bold" ${first.bold?'checked':''}>`)}
    ${row('strokeWidth','Viền',numeric('strokeWidth',first.strokeWidth||0,0,20))}
    ${row('strokeColor','Màu viền',`<input type="color" data-style-value="strokeColor" value="${esc(first.strokeColor||'#000000')}">`)}
    ${row('x','Ngang',numeric('x',Math.round((first.x??.5)*100),0,100))}
    ${row('y','Dọc',numeric('y',Math.round((first.y??.85)*100),0,100))}
    <p><button id="subtitleStyleApply" class="primary" disabled>${tr('Áp dụng cho tất cả')}</button></p>`);
  const body=$('#modalBody');
  modal.onClose=()=>{body.oninput=null;};
  body.oninput=e=>{
    const key=e.target.dataset.styleValue;
    if(key)body.querySelector(`[data-style-check="${key}"]`).checked=true;
    $('#subtitleStyleApply').disabled=!body.querySelector('[data-style-check]:checked');
  };
  $('#subtitleStyleApply').onclick=()=>{
    const patch={};
    for(const check of body.querySelectorAll('[data-style-check]:checked')){
      const key=check.dataset.styleCheck,el=body.querySelector(`[data-style-value="${key}"]`);
      if(el.type==='number'){
        if(!el.value||!el.checkValidity())return el.reportValidity();
        patch[key]=+el.value/(key==='x'||key==='y'?100:1);
      }else patch[key]=el.type==='checkbox'?el.checked:el.value;
    }
    const selected=ids.map(id=>findClip('text',id)).filter(Boolean);
    if(!selected.length)return closeModal();
    commit();selected.forEach(c=>Object.assign(c,patch));changed();closeModal();
    toast(tr('Đã cập nhật phụ đề')+': '+selected.length);
  };
}

$('#btnSubtitleStyle').onclick=()=>{
  const cues=P.tracks.text.filter(c=>c.subtitleSource);
  if(!cues.length)return toast(tr('Chưa có phụ đề tự động.'));
  setPlaying(false);closeModal();ui.subtitleGroup=true;
  const cue=cues.find(c=>ui.playhead>=c.start&&ui.playhead<c.start+c.duration)||cues[0];
  if(ui.playhead<cue.start||ui.playhead>=cue.start+cue.duration)seek(cue.start+.01);
  ui.sel={track:'text',id:cue.id};changed();
  $('#subtitleGroupStatus').classList.remove('hidden');
  $('#subtitleGroupCount').textContent=cues.length;
};
$('#btnSubtitleGroupEnd').onclick=()=>{ui.subtitleGroup=false;$('#subtitleGroupStatus').classList.add('hidden');changed();};
$('#btnSubtitleStyleDialog').onclick=showBulkSubtitleStyle;
