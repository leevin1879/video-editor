'use strict';
// One rendered source, independent outcomes. Successful destinations are never retried.
let socialBusy=false, socialPreviewURL=null;
const ttApi=(path,body={})=>api('/api/tiktok/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Vedit-TikTok':'1'},body:JSON.stringify(body)});
async function showSocialPublish(){
  if(socialBusy||youtubeUploading)return;
  const statuses=await Promise.allSettled([api('/api/youtube/status'),api('/api/tiktok/status')]);
  const yt=statuses[0].status==='fulfilled'?statuses[0].value:{},tt=statuses[1].status==='fulfilled'?statuses[1].value:{};
  let creator=null,creatorError='';
  if(tt.connected){try{creator=await api('/api/tiktok/creator');}catch(e){creatorError=e.message;}}
  const source=window.YouTubePublish.getExport();
  if(socialPreviewURL){URL.revokeObjectURL(socialPreviewURL);socialPreviewURL=null;}
  const preview=source?(source.blob?(socialPreviewURL=URL.createObjectURL(source.blob)):source.url):null;
  const privacyLabels={PUBLIC_TO_EVERYONE:tr('Công khai'),SELF_ONLY:tr('Riêng tư'),MUTUAL_FOLLOW_FRIENDS:tr('Bạn bè'),FOLLOWER_OF_CREATOR:tr('Người theo dõi')};
  modal(tr('Đăng video'),`
    <p><a target="_blank" rel="noopener" href="/terms">${tr('Điều khoản')}</a> · <a target="_blank" rel="noopener" href="/privacy">${tr('Chính sách quyền riêng tư')}</a></p>
    <p>YouTube: ${esc(yt.connected?yt.channel.title:tr('Chưa kết nối'))} <button id="spYT">${tr(yt.connected?'Cài đặt':'Kết nối YouTube')}</button></p>
    <p>TikTok: ${esc(creator?.creator_nickname||tt.account?.name||tr('Chưa kết nối'))} <button id="spTT">${tr(tt.connected?'Ngắt kết nối':'Kết nối TikTok')}</button></p>
    ${tt.connected&&sessionStorage.getItem('vedit_tiktok_post')?`<button id="spLastStatus">${tr('Kiểm tra trạng thái TikTok')}</button><p id="spLastResult"></p>`:''}
    ${creatorError?`<p class="err">${esc(creatorError)}</p>`:''}
    ${!tt.configured?`<p class="dim">${tr('TikTok cần ứng dụng đã đăng ký, khóa API và callback HTTPS.')} <a target="_blank" rel="noopener" href="https://developers.tiktok.com/portal/apps">TikTok Developers ↗</a></p>`:''}
    ${preview?`<video controls playsinline preload="metadata" style="width:100%;max-height:220px" src="${esc(preview)}"></video><p>${esc(source.name)}</p>`:`<p>${tr('Xuất bản dựng hiện tại trước khi đăng. Nếu đã chỉnh sửa, hãy xuất lại.')}</p><button id="spExport" class="primary">${tr('Xuất video để đăng')}</button>`}
    <p><label><input type="checkbox" id="spUseYT" ${yt.connected?'':'disabled'}> YouTube</label> <label><input type="checkbox" id="spUseTT" ${creator?'':'disabled'}> TikTok</label></p>
    <section id="spYTFields" hidden>
      <label>${tr('Tiêu đề')} <input id="spTitle" maxlength="100" value="${esc(P.name||'VEdit video')}"></label>
      <label>${tr('Mô tả')} <textarea id="spDescription" rows="3"></textarea></label>
      <label>${tr('Quyền riêng tư')} <select id="spYTPrivacy"><option value="private">${tr('Riêng tư')}</option><option value="unlisted">${tr('Không công khai')}</option><option value="public">${tr('Công khai')}</option></select></label>
      <label>${tr('Video này có dành cho trẻ em không?')} <select id="spKids"><option value="">${tr('Chọn câu trả lời')}</option><option value="no">${tr('Không dành cho trẻ em')}</option><option value="yes">${tr('Dành cho trẻ em')}</option></select></label>
    </section>
    <section id="spTTFields" hidden>
      <label>${tr('Chú thích TikTok')} <textarea id="spCaption" maxlength="2200" rows="3">${esc(P.name||'')}</textarea></label>
      <label>${tr('Quyền riêng tư')} <select id="spTTPrivacy"><option value="">${tr('Chọn quyền riêng tư')}</option>${(creator?.privacy_level_options||[]).map(p=>`<option value="${esc(p)}">${esc(privacyLabels[p]||p)}</option>`).join('')}</select></label>
      ${['comment','duet','stitch'].map((f,i)=>`<label><input type="checkbox" id="sp_${f}" ${!creator||creator[f+'_disabled']?'disabled':''}>${tr(['Cho phép bình luận','Cho phép Duet','Cho phép Stitch'][i])}</label>`).join('')}
      <label><input type="checkbox" id="spCommercial">${tr('Nội dung thương mại')}</label>
      <div id="spBrands" hidden><label><input type="checkbox" id="spOwnBrand">${tr('Thương hiệu của bạn')}</label><label><input type="checkbox" id="spPaidBrand">${tr('Hợp tác với thương hiệu')}</label><p id="spBrandLabel"></p></div>
      <label><input type="checkbox" id="spAI">${tr('Nội dung do AI tạo')}</label>
      <label><input type="checkbox" id="spConsent">${tr('Khi đăng, bạn đồng ý với')} <a target="_blank" rel="noopener" href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en">TikTok Music Usage Confirmation</a><span id="spBrandedAgreement" hidden> ${tr('và')} <a target="_blank" rel="noopener" href="https://www.tiktok.com/legal/page/global/bc-policy/en">Branded Content Policy</a></span>.</label>
    </section>
    <p id="spError" class="err"></p><button id="spSend" class="primary" ${source?'':'disabled'}>${tr('Đăng lên nền tảng đã chọn')}</button>
    <div id="spResults"></div><button id="spCheck" hidden>${tr('Kiểm tra trạng thái TikTok')}</button>`);
  $('#spYT').onclick=showYouTube;
  const last=$('#spLastStatus');
  if(last)last.onclick=async()=>{
    try{const state=await ttApi('upload-status',{id:sessionStorage.getItem('vedit_tiktok_post')});$('#spLastResult').textContent=state.status+(state.fail_reason?' · '+state.fail_reason:'');}
    catch(e){$('#spLastResult').textContent=e.message;}
  };
  $('#spTT').onclick=async()=>{
    try{
      if(tt.connected){await ttApi('disconnect');return showSocialPublish();}
      if(!tt.configured)return toast(tr('TikTok cần ứng dụng đã đăng ký, khóa API và callback HTTPS.'),7000);
      if(new URL(tt.redirect_uri).origin!==location.origin)return toast(tr('Mở VEdit tại địa chỉ HTTPS đã cấu hình để kết nối TikTok.'),7000);
      location.assign((await ttApi('connect')).url);
    }catch(e){toast(e.message,7000);}
  };
  if(!source)$('#spExport').onclick=async()=>{closeModal();await exportVideo();if(window.YouTubePublish.getExport())await showSocialPublish();};
  const change=()=>{
    $('#spYTFields').hidden=!$('#spUseYT').checked;$('#spTTFields').hidden=!$('#spUseTT').checked;
    const commercial=$('#spCommercial').checked,paid=commercial&&$('#spPaidBrand').checked;
    $('#spBrands').hidden=!commercial;$('#spBrandedAgreement').hidden=!paid;
    const privateOption=$('#spTTPrivacy').querySelector('option[value="SELF_ONLY"]');
    if(privateOption)privateOption.disabled=paid;
    $('#spBrandLabel').textContent=paid?tr('Nhãn: Paid partnership'):commercial&&$('#spOwnBrand').checked?tr('Nhãn: Promotional content'):'';
    $('#spSend').disabled=!source||!($('#spUseYT').checked||$('#spUseTT').checked)||($('#spUseTT').checked&&(!$('#spTTPrivacy').value||!$('#spConsent').checked||(commercial&&!$('#spOwnBrand').checked&&!paid)||(paid&&$('#spTTPrivacy').value==='SELF_ONLY')));
  };
  for(const id of ['spUseYT','spUseTT','spCommercial','spOwnBrand','spPaidBrand','spTTPrivacy','spConsent'])$('#'+id).onchange=change;
  change();
  $('#spSend').onclick=async()=>{
    const useYT=$('#spUseYT').checked,useTT=$('#spUseTT').checked;
    if(!source||window.YouTubePublish.getExport()!==source)return $('#spError').textContent=tr('Dự án đã thay đổi. Hãy xuất lại video.');
    if(useYT&&(!$('#spTitle').value.trim()||!$('#spKids').value))return $('#spError').textContent=tr('Nhập tiêu đề và chọn đối tượng trẻ em.');
    if(!useYT&&!useTT)return;
    const ymeta={title:$('#spTitle').value.trim(),description:$('#spDescription').value,privacy:$('#spYTPrivacy').value,made_for_kids:$('#spKids').value==='yes',request_id:crypto.randomUUID()};
    const tmeta={title:$('#spCaption').value,privacy_level:$('#spTTPrivacy').value,consent:$('#spConsent').checked,
      commercial:$('#spCommercial').checked,brand_organic_toggle:$('#spCommercial').checked&&$('#spOwnBrand').checked,
      brand_content_toggle:$('#spCommercial').checked&&$('#spPaidBrand').checked,branded_consent:$('#spConsent').checked,
      is_aigc:$('#spAI').checked,duration:totalDuration(),request_id:crypto.randomUUID()};
    for(const f of ['comment','duet','stitch'])tmeta['allow_'+f]=$('#sp_'+f).checked;
    socialBusy=true;youtubeUploading=true;$('#spSend').disabled=true;$('#modalClose').disabled=true;$('#spError').textContent='';
    document.body.classList.add('export-busy');
    $('#modalBody').querySelectorAll('input,textarea,select,button').forEach(el=>el.disabled=true);
    $('#spResults').innerHTML=['YouTube','TikTok'].filter((_,i)=>i===0?useYT:useTT).map(n=>`<p id="spResult${n}">${n}: ${tr('Đang tải lên…')}</p>`).join('');
    const update=(name,text)=>{$('#spResult'+name).textContent=name+': '+text;};
    try{
      const size=await youtubeSourceSize(source);
      await Promise.allSettled([
        ...(useYT?[socialYouTube(source,{...ymeta,size},p=>update('YouTube',p)).catch(e=>update('YouTube',e.message))]:[]),
        ...(useTT?[socialTikTok(source,{...tmeta,size},p=>update('TikTok',p)).catch(e=>update('TikTok',e.message))]:[])
      ]);
    }catch(e){$('#spError').textContent=e.message;}
    finally{socialBusy=false;youtubeUploading=false;document.body.classList.remove('export-busy');$('#modalClose').disabled=false;}
    // Keep Send disabled after submission, including partial failures, to avoid duplicate posts.
  };
}
async function socialYouTube(source,meta,progress){
  const s=await ytApi('uploads',meta);let offset=0;
  while(offset<meta.size){
    let result;
    try{const chunk=await youtubeChunk(source,offset,Math.min(meta.size,offset+s.chunk_size));
      result=await api(`/api/youtube/chunk?id=${encodeURIComponent(s.id)}&offset=${offset}`,{method:'POST',headers:{'X-Vedit-YouTube':'1','Content-Type':'video/mp4'},body:chunk});
    }catch(e){result=await ytApi('upload-status',{id:s.id});if(result.status!=='done'&&result.offset<=offset)throw e;}
    if(result.status==='done'){progress(tr('Đã tải video lên YouTube')+' · '+result.url);return;}
    if(!Number.isInteger(result.offset)||result.offset<=offset||result.offset>meta.size)throw Error(tr('Không xác nhận được tiến trình tải lên.'));
    offset=result.offset;progress(Math.round(offset/meta.size*100)+'%');
  }
  throw Error(tr('Không xác nhận được video trên YouTube.'));
}
async function socialTikTok(source,meta,progress){
  const s=await ttApi('uploads',{...meta,...(source.blob?{}:{export_url:source.url})});
  // Remember only the opaque local session ID, never credentials or TikTok upload URLs.
  sessionStorage.setItem('vedit_tiktok_post',s.id);
  if(s.source==='FILE_UPLOAD'){
    for(let offset=0;offset<meta.size;){
      const end=meta.size-offset<2*s.chunk_size?meta.size:offset+s.chunk_size;
      const chunk=await youtubeChunk(source,offset,end);
      const r=await api(`/api/tiktok/chunk?id=${encodeURIComponent(s.id)}&offset=${offset}`,{method:'POST',headers:{'X-Vedit-TikTok':'1','Content-Type':'video/mp4'},body:chunk});
      if(r.offset!==end)throw Error(tr('Không xác nhận được tiến trình tải lên.'));
      offset=end;progress(Math.round(offset/meta.size*100)+'%');
    }
  }
  const check=async()=>{
    const state=await ttApi('upload-status',{id:s.id});
    if(state.status==='PUBLISH_COMPLETE'){progress(tr('Đã đăng TikTok')+(state.post_ids.length?' · '+state.post_ids.join(', '):''));sessionStorage.removeItem('vedit_tiktok_post');}
    else if(state.status==='FAILED'){progress(tr('TikTok không đăng được video')+': '+state.fail_reason);sessionStorage.removeItem('vedit_tiktok_post');}
    else progress(tr('TikTok đang xử lý video')+' · '+state.status);
    return ['PUBLISH_COMPLETE','FAILED'].includes(state.status);
  };
  $('#spCheck').hidden=false;$('#spCheck').disabled=false;$('#spCheck').onclick=()=>check().catch(e=>progress(e.message));
  for(let attempt=0;attempt<12;attempt++){if(await check()){$('#spCheck').hidden=true;return;}await new Promise(r=>setTimeout(r,5000));}
}
$('#btnPublish').onclick=()=>showSocialPublish().catch(e=>toast(e.message,6000));
window.addEventListener('beforeunload',event=>{if(socialBusy){event.preventDefault();event.returnValue='';}});
if(new URLSearchParams(location.search).get('tiktok')==='connected'){history.replaceState(null,'',location.pathname);showSocialPublish().catch(e=>toast(e.message,6000));}
