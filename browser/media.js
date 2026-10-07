import {Input, ALL_FORMATS, BlobSource, UrlSource, CanvasSink, AudioBufferSink,
  Output, Mp4OutputFormat, BufferTarget, CanvasSource, AudioBufferSource, canEncodeVideo, canEncodeAudio} from 'mediabunny';

const cache = new Map();
const urls = new Map();
let database;
async function db() {
  if (!database) database = new Promise((resolve, reject) => {
    const r = indexedDB.open('vedit-device-media', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
  return database;
}
async function store(id, file) {
  const d = await db();
  await new Promise((resolve, reject) => {
    const tx = d.transaction('files', 'readwrite'); tx.objectStore('files').put(file, id);
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
  cache.set(id, file);
}
async function get(id) {
  if (cache.has(id)) return cache.get(id);
  const d = await db();
  const file = await new Promise((resolve, reject) => {
    const r = d.transaction('files').objectStore('files').get(id);
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
  if (file) cache.set(id, file);
  return file;
}
function url(id, blob) {
  if (!urls.has(id)) urls.set(id, URL.createObjectURL(blob));
  return urls.get(id);
}
const inputFor = async m => new Input({formats: ALL_FORMATS, source: m.localId
  ? new BlobSource(await get(m.localId) || (() => {throw Error('missingLocal');})()) : new UrlSource(m.url)});
async function importFile(file) {
  if (!file.size) throw Error('emptyFile');
  const id = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
  const media = {id, localId: id, name:file.name, size:file.size, file:null, type:'image', duration:0, width:0, height:0, hasAudio:false};
  let thumb;
  if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp)$/i.test(file.name)) {
    const im = await createImageBitmap(file); media.width=im.width; media.height=im.height;
    const cv=document.createElement('canvas'); cv.width=240; cv.height=Math.max(1,Math.round(im.height*240/im.width));
    cv.getContext('2d').drawImage(im,0,0,cv.width,cv.height); thumb=cv.toDataURL('image/jpeg'); im.close();
  } else {
    const input=new Input({formats:ALL_FORMATS,source:new BlobSource(file)});
    try {
      const video=await input.getPrimaryVideoTrack(), audio=await input.getPrimaryAudioTrack();
      if (!video && !audio) throw Error('unsupportedMedia');
      media.type=video?'video':'audio'; media.duration=await input.computeDuration(); media.hasAudio=!!audio;
      if (!Number.isFinite(media.duration) || media.duration <= 0) throw Error('unsupportedMedia');
      if (video) {
        media.width=video.displayWidth; media.height=video.displayHeight;
        if (await video.canDecode()) {
          const frame=await new CanvasSink(video,{width:240}).getCanvas(Math.min(1,media.duration/2));
          thumb=frame?.canvas.toDataURL('image/jpeg');
        }
      }
    } finally {input.dispose();}
  }
  await store(id,file);
  return {...media,url:url(id,file),thumb};
}
async function restore(media) {
  const missing=[];
  for (const m of media) if (m.localId) {
    const file=await get(m.localId);
    if (file) {m.url=url(m.localId,file); m.missingLocal=false;}
    else {m.missingLocal=true; missing.push(m.name);}
  }
  return missing;
}
async function upload(m, signal, progress) {
  if (!m.localId) return m;
  const file=await get(m.localId); if (!file) throw Error('missingLocal');
  return new Promise((resolve,reject) => {
    const xhr=new XMLHttpRequest(); xhr.open('POST','/api/upload');
    xhr.setRequestHeader('X-Filename',encodeURIComponent(m.name)); xhr.setRequestHeader('X-Vedit-Temporary','1');
    xhr.upload.onprogress=e=>progress?.(e.lengthComputable?e.loaded/e.total:0);
    xhr.onload=()=>{try {const r=JSON.parse(xhr.responseText); if(xhr.status!==200) throw Error(r.error||`HTTP ${xhr.status}`); resolve(r);} catch(e){reject(e);}};
    xhr.onerror=()=>reject(Error('networkError')); xhr.onabort=()=>reject(new DOMException('Cancelled','AbortError'));
    const abort=()=>xhr.abort(); signal?.addEventListener('abort',abort,{once:true});
    xhr.onloadend=()=>signal?.removeEventListener('abort',abort);
    if(signal?.aborted) return reject(new DOMException('Cancelled','AbortError'));
    xhr.send(file);
  });
}
function download(blob, name) {
  const u=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=u; a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(u),60000);
}

// The editor supplies clip timing and its existing compositor. No media leaves the device here.
async function exportVideo({project,total,clips,sourceTime,fade,renderFrame,canvas,signal,progress}) {
  if (!await canEncodeVideo('avc',{width:project.width,height:project.height,frameRate:project.fps})) throw Error('browserUnsupported');
  const active=clips.filter(x=>!x.muted && x.media.hasAudio && (x.clip.volume??1)>0);
  if (clips.some(x=>x.clip.smooth && x.clip.smooth!=='none')) throw Error('advancedExport');
  if (active.some(x=>x.clip.keepPitch!==false && (x.clip.curve || (x.clip.speed||1)!==1))) throw Error('advancedExport');
  const bitrate=Math.max(2000000,project.width*project.height*project.fps*0.12);
  if (total>600 || total*(bitrate+192000)/8>256*1024*1024) throw Error('largeExport');
  if (active.length && !await canEncodeAudio('aac',{numberOfChannels:2,sampleRate:48000})) throw Error('browserUnsupported');
  const inputs=new Map(), frames=new Map(), readers=[], audioData=new Map();
  let output;
  const abort=()=>{if(signal?.aborted) throw new DOMException('Cancelled','AbortError');};
  try {
    for (const c of clips) {
      abort();
      if (c.media.missingLocal) throw Error('missingLocal');
      if (c.media.type==='image') {
        if(!frames.has(c.media.id)) {
          const blob=c.media.localId?await get(c.media.localId):await fetch(c.media.url).then(r=>r.blob());
          frames.set(c.media.id,await createImageBitmap(blob));
        }
        continue;
      }
      if(!inputs.has(c.media.id)) inputs.set(c.media.id,await inputFor(c.media));
      const input=inputs.get(c.media.id);
      if(c.visual) {
        const track=await input.getPrimaryVideoTrack();
        if(!track || !await track.canDecode()) throw Error('browserUnsupported');
        const sink=new CanvasSink(track,{poolSize:2});
        const first=Math.max(0,Math.ceil(c.start*project.fps-1e-7)), end=Math.ceil((c.start+c.duration)*project.fps-1e-7);
        function* timestamps() {for(let f=first;f<end;f++) yield sourceTime(c.clip,f/project.fps-c.start);}
        readers.push({...c,first,end,iterator:sink.canvasesAtTimestamps(timestamps())});
      }
    }
    let audioBytes=0;
    for(const c of active) {
      if(audioData.has(c.media.id)) continue;
      abort(); const track=await inputs.get(c.media.id).getPrimaryAudioTrack();
      if(!track || !await track.canDecode()) throw Error('browserUnsupported');
      const duration=await track.computeDuration(), rate=48000;
      audioBytes+=Math.ceil(duration*rate)*2*4;
      if(audioBytes>256*1024*1024) throw Error('largeExport');
      const channels=[new Float32Array(Math.ceil(duration*rate)),new Float32Array(Math.ceil(duration*rate))];
      for await(const chunk of new AudioBufferSink(track).buffers()) {
        abort(); const b=chunk.buffer;
        for(let ch=0;ch<2;ch++) {
          const src=b.getChannelData(Math.min(ch,b.numberOfChannels-1));
          const offset=Math.round(chunk.timestamp*rate), count=Math.ceil(b.duration*rate);
          for(let j=0;j<count;j++) {const pos=offset+j; if(pos>=0&&pos<channels[ch].length) channels[ch][pos]=src[Math.min(src.length-1,Math.floor(j*b.sampleRate/rate))];}
        }
      }
      audioData.set(c.media.id,channels);
    }
    const target=new BufferTarget(); output=new Output({format:new Mp4OutputFormat(),target});
    const video=new CanvasSource(canvas,{codec:'avc',bitrate,hardwareAcceleration:'prefer-hardware'});
    output.addVideoTrack(video,{frameRate:project.fps});
    const audio=active.length?new AudioBufferSource({codec:'aac',bitrate:192000}):null;
    if(audio) output.addAudioTrack(audio);
    await output.start();
    const frameCount=Math.ceil(total*project.fps); let audioPosition=0;
    for(let f=0;f<frameCount;f++) {
      abort(); const t=f/project.fps, duration=Math.min(1/project.fps,total-t);
      const sources=new Map(frames);
      for(const r of readers) if(f>=r.first&&f<r.end) {
        const sample=(await r.iterator.next()).value;
        if(!sample) throw Error('frameMissing');
        sources.set(r.key,sample.canvas);
      }
      renderFrame(t,sources); await video.add(t,duration);
      const next=Math.min(Math.round(total*48000),Math.round((t+duration)*48000));
      if(audio && next>audioPosition) {
        const b=new AudioBuffer({numberOfChannels:2,length:next-audioPosition,sampleRate:48000});
        for(const c of active) {
          const src=audioData.get(c.media.id);
          for(let j=0;j<b.length;j++) {
            const local=(audioPosition+j)/48000-c.start; if(local<0||local>=c.duration) continue;
            const pos=sourceTime(c.clip,local)*48000, i=Math.floor(pos), k=pos-i;
            const gain=(c.clip.volume??1)*fade(local,c.duration,c.clip.fadeIn,c.clip.fadeOut);
            for(let ch=0;ch<2;ch++) b.getChannelData(ch)[j]+=((src[ch][i]||0)*(1-k)+(src[ch][i+1]||0)*k)*gain;
          }
        }
        await audio.add(b); audioPosition=next;
      }
      progress((f+1)/frameCount);
      if(f%10===0) await new Promise(r=>setTimeout(r,0));
    }
    video.close(); audio?.close(); await output.finalize();
    return new Blob([target.buffer],{type:'video/mp4'});
  } catch(e) {if(output) await output.cancel().catch(()=>{}); throw e;}
  finally {await Promise.allSettled(readers.map(r=>r.iterator.return())); for(const i of inputs.values()) i.dispose(); for(const frame of frames.values()) frame.close();}
}
async function speechAudio(media,start,end) {
  if(end<=start||end-start>3600)throw Error('Invalid transcription range (maximum 1 hour)');
  const input=await inputFor(media),rate=16000,length=Math.ceil((end-start)*rate);
  try {
    const track=await input.getPrimaryAudioTrack();
    if(!track||!await track.canDecode())throw Error('browserUnsupported');
    const samples=new Float32Array(length);
    for await(const item of new AudioBufferSink(track).buffers(start,end)) {
      const b=item.buffer,first=Math.max(0,Math.ceil((item.timestamp-start)*rate)),last=Math.min(length,Math.ceil((item.timestamp+b.duration-start)*rate));
      for(let i=first;i<last;i++){
        const src=Math.min(b.length-1,Math.max(0,Math.floor((start+i/rate-item.timestamp)*b.sampleRate)));
        let value=0;for(let ch=0;ch<b.numberOfChannels;ch++)value+=b.getChannelData(ch)[src];samples[i]=value/b.numberOfChannels;
      }
    }
    const data=new ArrayBuffer(44+length*2),view=new DataView(data),str=(offset,text)=>{for(let i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i));};
    str(0,'RIFF');view.setUint32(4,36+length*2,true);str(8,'WAVE');str(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);str(36,'data');view.setUint32(40,length*2,true);
    for(let i=0;i<length;i++)view.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,samples[i]))*32767),true);
    const response=await fetch('/api/upload',{method:'POST',headers:{'X-Filename':'speech.wav','X-Vedit-Temporary':'1'},body:new Blob([data],{type:'audio/wav'})});
    const result=await response.json();if(!response.ok)throw Error(result.error);return result;
  }finally{input.dispose();}
}
window.DeviceMedia={importFile,restore,upload,exportVideo,download,get,speechAudio};
