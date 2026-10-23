'use strict';
// Tokens and Google resumable URLs stay on the server; only video chunks pass through it.
let youtubeSource=null, youtubeUploading=false, youtubePopup=null;
const ytApi=(path,body={})=>api('/api/youtube/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Vedit-YouTube':'1'},body:JSON.stringify(body)});
const ytVersion=()=>JSON.stringify(P);
const ytSourceValid=()=>youtubeSource&&youtubeSource.version===ytVersion();
window.YouTubePublish={setExport:source=>{youtubeSource=source;},getExport:()=>ytSourceValid()?youtubeSource:null};
async function youtubeSourceSize(source){
  if(source.blob)return source.blob.size;
  if(source.size)return source.size;
  const r=await fetch(source.url,{headers:{Range:'bytes=0-0'}});
  if(!r.ok)throw Error(tr('Không đọc được video đã xuất.'));
  const range=r.headers.get('Content-Range'), match=range?.match(/\/(\d+)$/);
  if(r.status===206&&match){await r.arrayBuffer();source.size=Number(match[1]);}
  else {source.blob=await r.blob();source.size=source.blob.size;}
  return source.size;
}
async function youtubeChunk(source,start,end){
  if(source.blob)return source.blob.slice(start,end);
  const r=await fetch(source.url,{headers:{Range:`bytes=${start}-${end-1}`}});
  if(r.status!==206)throw Error(tr('Không đọc được video đã xuất.'));
  const chunk=await r.blob();
  if(chunk.size!==end-start)throw Error(tr('Không đọc được video đã xuất.'));
  return chunk;
}
async function showYouTube(){
  if(youtubeUploading)return;
  let status;
  try{status=await api('/api/youtube/status');}catch(e){return toast(e.message,6000);}
  if(!status.configured){
    modal('YouTube',`<p>${tr('Cần thiết lập kết nối YouTube một lần trên máy chủ.')}</p>
      <p>${tr('Bật YouTube Data API v3, tạo OAuth client cho ứng dụng Web và thêm địa chỉ chuyển hướng:')}</p>
      <input readonly style="width:100%" value="${esc(status.redirect_uri)}">
      ${status.setup_error?`<p class="err">${esc(status.setup_error)}</p>`:''}
      <p><a target="_blank" rel="noopener" href="https://console.cloud.google.com/apis/credentials">Google Cloud Console ↗</a></p>
      ${status.local_setup?`<label class="import-btn">${tr('Nhập tệp OAuth client JSON')}<input id="ytConfigFile" type="file" accept=".json,application/json" hidden></label>`:`<p>${tr('Quản trị viên cấu hình VEDIT_YOUTUBE_CONFIG theo hướng dẫn trong README.')}</p>`}`);
    const input=$('#ytConfigFile');
    if(input)input.onchange=async()=>{
      const file=input.files[0];if(!file)return;
      if(file.size>32768)return toast(tr('Tệp cấu hình không hợp lệ.'),5000);
      try{await ytApi('configure',{client:JSON.parse(await file.text())});await showYouTube();}
      catch(e){toast(e.message,6000);}
    };
    return;
  }
  if(!status.connected){
    modal('YouTube',`<p>${tr('Kết nối kênh YouTube để đăng video từ VEdit.')}</p>
      <p><a target="_blank" rel="noopener" href="/terms">${tr('Điều khoản')}</a> · <a target="_blank" rel="noopener" href="/privacy">${tr('Chính sách quyền riêng tư')}</a></p>
      <p>${tr('VEdit yêu cầu quyền tải video và đọc thông tin kênh. Bạn chọn kênh trên màn hình Google.')}</p>
      <button id="ytConnect" class="primary">${tr('Kết nối YouTube')}</button>`);
    $('#ytConnect').onclick=async()=>{
      $('#ytConnect').disabled=true;
      try{const r=await ytApi('connect');location.assign(r.url);}
      catch(e){$('#ytConnect').disabled=false;toast(e.message,6000);}
    };
    return;
  }
  const channel=status.channel;
  if(!ytSourceValid()){
    modal('YouTube',`<p>${tr('Kênh nhận video')}: <b>${esc(channel.title)}</b></p>
      <p>${tr('Xuất bản dựng hiện tại trước khi đăng. Nếu đã chỉnh sửa, hãy xuất lại.')}</p>
      <button id="ytPrepare" class="primary">${tr('Xuất video để đăng')}</button>
      <button id="ytDisconnect">${tr('Ngắt kết nối')}</button>`);
    $('#ytPrepare').onclick=async()=>{
      closeModal();
      await exportVideo();
      if(ytSourceValid())await showYouTube();
    };
    $('#ytDisconnect').onclick=async()=>{await ytApi('disconnect');youtubeSource=null;await showYouTube();};
    return;
  }
  const source=youtubeSource;
  modal(tr('Đăng lên YouTube'),`<p>${tr('Kênh nhận video')}: <b>${esc(channel.title)}</b></p>
    <p class="dim">${esc(source.name)}</p>
    <div class="field"><label>${tr('Tiêu đề')}</label><input id="ytTitle" maxlength="100" value="${esc(P.name||'VEdit video')}"></div>
    <div class="field"><label>${tr('Mô tả')}</label><textarea id="ytDescription" rows="4" maxlength="5000"></textarea></div>
    <div class="field"><label>${tr('Quyền riêng tư')}</label><select id="ytPrivacy"><option value="private">${tr('Riêng tư')}</option><option value="unlisted">${tr('Không công khai')}</option><option value="public">${tr('Công khai')}</option></select></div>
    <div class="field"><label>${tr('Video này có dành cho trẻ em không?')}</label><select id="ytKids"><option value="">${tr('Chọn câu trả lời')}</option><option value="no">${tr('Không dành cho trẻ em')}</option><option value="yes">${tr('Dành cho trẻ em')}</option></select></div>
    <p>${tr('Bấm Đăng để gửi bản video này lên kênh đã chọn.')}</p>
    <div id="ytError" class="err"></div>
    <button id="ytPublish" class="primary">${tr('Đăng lên YouTube')}</button>
    <button id="ytDisconnect">${tr('Ngắt kết nối')}</button>`);
  $('#ytDisconnect').onclick=async()=>{await ytApi('disconnect');youtubeSource=null;await showYouTube();};
  $('#ytPublish').onclick=async()=>{
    if(!ytSourceValid())return toast(tr('Dự án đã thay đổi. Hãy xuất lại video.'),5000);
    const title=$('#ytTitle').value.trim(),description=$('#ytDescription').value,privacy=$('#ytPrivacy').value,kids=$('#ytKids').value;
    if(!title||!kids)return $('#ytError').textContent=tr('Nhập tiêu đề và chọn đối tượng trẻ em.');
    $('#ytPublish').disabled=true;
    const metadata={title,description,privacy,made_for_kids:kids==='yes',request_id:crypto.randomUUID()};
    await uploadYouTube(source,metadata,channel);
  };
}
async function uploadYouTube(source,metadata,channel){
  youtubeUploading=true;
  let id,cancelled=false,started=false;
  modal(tr('Đăng lên YouTube'),`<p>${esc(channel.title)} · ${esc(metadata.title)}</p><div class="progress"><div id="ytBar"></div></div><p id="ytProgress">0%</p><p>${tr('Giữ tab mở trong khi tải lên.')}</p><button id="ytCancel">${tr('Hủy')}</button>`);
  $('#modalClose').disabled=true;
  $('#ytCancel').onclick=()=>{cancelled=true;$('#ytCancel').disabled=true;};
  try{
    const size=await youtubeSourceSize(source);
    const session=await ytApi('uploads',{...metadata,size});id=session.id;started=true;
    let offset=0,result;
    while(offset<size){
      if(cancelled){result=await ytApi('cancel',{id});if(result.status==='done')break;throw Error(tr('Đã hủy.'));}
      const end=Math.min(size,offset+session.chunk_size),chunk=await youtubeChunk(source,offset,end);
      for(let retry=0;;retry++){
        try{
          result=await api(`/api/youtube/chunk?id=${encodeURIComponent(id)}&offset=${offset}`,{method:'POST',headers:{'X-Vedit-YouTube':'1','Content-Type':'video/mp4'},body:chunk});
          break;
        }catch(e){
          if(retry>=3||cancelled)throw e;
          await new Promise(r=>setTimeout(r,1000*2**retry));
          result=await ytApi('upload-status',{id});
          if(result.status==='done'||result.offset!==offset)break;
        }
      }
      if(result.status==='done')break;
      if(!Number.isInteger(result.offset)||result.offset<=offset||result.offset>size)throw Error(tr('Không xác nhận được tiến trình tải lên.'));
      offset=result.offset;$('#ytBar').style.width=(offset/size*100)+'%';$('#ytProgress').textContent=Math.round(offset/size*100)+'%';
    }
    if(result?.status!=='done')throw Error(tr('Không xác nhận được video trên YouTube.'));
    const privacyLabel={private:tr('Riêng tư'),unlisted:tr('Không công khai'),public:tr('Công khai')}[result.privacy]||result.privacy;
    modal(tr('Đăng lên YouTube'),`<p>✅ ${tr('Đã tải video lên YouTube')}</p><p>${esc(channel.title)} · ${esc(privacyLabel)}</p><a target="_blank" rel="noopener" href="${esc(result.url)}">${tr('Mở video trên YouTube')} ↗</a><p>${tr('YouTube có thể cần thêm thời gian để xử lý video.')}</p>`);
  }catch(e){
    if(id&&started){try{const state=await ytApi('upload-status',{id});if(state.status==='done'){
      modal('YouTube',`<p>✅ ${tr('Đã tải video lên YouTube')}</p><a target="_blank" rel="noopener" href="${esc(state.url)}">${tr('Mở video trên YouTube')} ↗</a>`);return;
    }}catch{}}
    modal('YouTube',`<p class="err">${esc(e.message)}</p><p>${tr('Kiểm tra YouTube Studio trước khi thử lại nếu lần tải lên bị gián đoạn.')}</p><button id="ytBack">${tr('Quay lại')}</button>`);
    if(id)await ytApi('cancel',{id}).catch(()=>{});
    $('#ytBack').onclick=showYouTube;
  }finally{youtubeUploading=false;$('#modalClose').disabled=false;}
}
window.addEventListener('message',event=>{
  if(event.origin===location.origin&&event.source===youtubePopup&&event.data==='vedit-youtube-connected')showYouTube();
});
window.addEventListener('beforeunload',event=>{if(youtubeUploading){event.preventDefault();event.returnValue='';}});
$('#btnYouTube').onclick=showYouTube;

if(new URLSearchParams(location.search).get('youtube')==='connected'){history.replaceState(null,'',location.pathname);showYouTube();}
