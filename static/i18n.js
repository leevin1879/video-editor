'use strict';
// Vietnamese source keys keep translations separate from project/media content.
const TRANSLATIONS = [
  ["Lớp chữ","텍스트 레이어","Text layers"],
  ["Trên cùng","맨 앞으로","Bring to front"],
  ["Dưới cùng","맨 뒤로","Send to back"],

  ["Kiểu chữ","글자 스타일","Text style"],
  ["Rõ nét","깔끔한 자막","Clean"],
  ["Hồng dễ thương","귀여운 핑크","Cute pink"],
  ["Vàng nổi bật","강조 노랑","Bold yellow"],
  ["Bong bóng xanh","파란 말풍선","Blue bubble"],
  ["Chữ viết tay","손글씨","Handwriting"],

  ["Bỏ chọn","선택 해제","Deselect"],
  ["Kiểu phụ đề","자막 스타일","Subtitle style"],
  ["Kéo phụ đề trên video để di chuyển tất cả; kéo góc để đổi cỡ tất cả.","영상의 자막을 드래그하면 전체가 이동하고 모서리를 드래그하면 전체 크기가 바뀝니다.","Drag a subtitle on the video to move all; drag a corner to resize all."],

  ["Chọn tất cả phụ đề","자막 전체 선택","Select all subtitles"],
  ["Áp dụng cho tất cả","전체에 적용","Apply to all"],
  ["Phụ đề đã chọn","선택한 자막","Selected subtitles"],
  ["Đã cập nhật phụ đề","자막을 업데이트했습니다","Subtitles updated"],

  ["Phụ đề tự động", "자동 자막", "Auto subtitles"],
  ["Bản chép lời", "대본 편집", "Transcript"],
  ["Tạo phụ đề", "자막 생성", "Generate subtitles"],
  ["Ngôn ngữ lời nói", "음성 언어", "Speech language"],
  ["Tự nhận diện", "자동 감지", "Auto detect"],
  ["Đang nhận diện lời nói…", "음성 인식 중…", "Transcribing speech…"],
  ["Không tìm thấy lời nói.", "음성이 감지되지 않았습니다.", "No speech detected."],
  ["Chọn video trên timeline trước.", "타임라인에서 영상을 먼저 선택하세요.", "Select a timeline video first."],
  ["Lưu thay đổi", "변경 저장", "Save changes"],
  ["Tải bản chép lời", "대본 다운로드", "Download transcript"],
  ["Phụ đề đã tạo", "자막 생성 완료", "Subtitles created"],
  ["Chưa có phụ đề tự động.", "자동 자막이 아직 없습니다.", "No automatic subtitles yet."],
  ["Timeline đã thay đổi. Tạo lại phụ đề cho clip hiện tại.", "타임라인이 변경되었습니다. 현재 클립의 자막을 다시 생성하세요.", "Timeline changed. Generate subtitles again for the current clip."],
  ["Thời gian phụ đề không hợp lệ.", "자막 시간이 올바르지 않습니다.", "Invalid subtitle timing."],
  ["Video không có âm thanh", "영상에 오디오가 없습니다", "Video has no audio"],

  ['File đã chọn trống (0 byte). Hãy chọn lại file video gốc.','선택한 파일이 비어 있습니다(0바이트). 원본 영상을 다시 선택하세요.','The selected file is empty (0 bytes). Select the original video again.'],
  ['Không thể truy cập file. Hãy kiểm tra quyền truy cập và chọn lại file.','파일에 접근할 수 없습니다. 접근 권한을 확인하고 다시 선택하세요.','Cannot access the file. Check permissions and select it again.'],
  ['Bộ nhớ trình duyệt đã đầy. Hãy giải phóng dung lượng rồi thử lại.','브라우저 저장 공간이 부족합니다. 공간을 확보하고 다시 시도하세요.','Browser storage is full. Free up space and try again.'],
  ['Đang xử lý lệnh ChatGPT','ChatGPT 명령 처리 중','Processing ChatGPT command'],
  ['Kết nối plugin VEdit bằng mã ghép nối dưới đây. Giữ tab này mở.','아래 연결 코드로 VEdit 플러그인을 연결하세요. 이 탭을 열어 두세요.','Pair the VEdit plugin using the key below. Keep this tab open.'],
  ['Chạy start-plugin.bat rồi kết nối MCP qua Secure MCP Tunnel. Không chia sẻ mã này.','start-plugin.bat 실행 후 Secure MCP Tunnel로 연결하세요. 이 코드를 공유하지 마세요.','Run start-plugin.bat and connect MCP through Secure MCP Tunnel. Keep this key private.'],
  ['Thêm âm thanh','추가','Add'],
  ['Hiệu ứng âm thanh','효과음','Sound effects'], ['Nghe thử','미리 듣기','Preview'], ['Dừng','정지','Stop'], ['Thêm','추가','Add'], ['Nghe thử rồi thêm hiệu ứng tại vị trí đang chọn trên timeline.','미리 듣고 현재 재생 위치에 효과음을 추가하세요.','Preview, then add an effect at the current playhead.'],
  ['Lướt chuyển cảnh','전환 휙','Whoosh'], ['Bật pop','팝','Pop'], ['Ting thông báo','알림음','Notification'], ['Thành công','성공','Success'], ['Nhấn mạnh','강조 타격','Impact'], ['Nhấp chuột','클릭','Click'], ['Lấp lánh','반짝임','Sparkle'], ['Lỗi / sai','오류','Error'], ['Không tải được hiệu ứng âm thanh.','효과음을 불러올 수 없습니다.','Could not load sound effect.'],
  ['Xuất trên thiết bị','기기에서 내보내기','Export on device'], ['Xuất bằng server','서버에서 내보내기','Export on server'], ['Tự động','자동','Automatic'], ['Nơi xử lý','처리 위치','Processing location'],
  ['Video nhập được giữ trên thiết bị. Máy tính xuất tại đây; điện thoại gửi video khi xuất. File tạm trên server tự xóa sau 24 giờ.','가져온 영상은 기기에 보관됩니다. 컴퓨터는 기기에서, 휴대폰은 내보낼 때 서버에서 처리합니다. 서버 임시 파일은 24시간 후 자동 삭제됩니다.','Imported media stays on your device. Computers export here; phones send media when exporting. Temporary server files are deleted after 24 hours.'],
  ['Đang đọc file trên thiết bị…','기기 파일 읽는 중…','Reading files on device…'], ['Thiếu file trên thiết bị. Hãy nhập lại file gốc.','기기에 파일이 없습니다. 원본 파일을 다시 가져오세요.','Device file is missing. Import the original again.'],
  ['Trình duyệt không hỗ trợ xuất video này.','브라우저가 이 영상 내보내기를 지원하지 않습니다.','This browser cannot export this video.'], ['Hiệu ứng này cần xuất bằng server để giữ đúng kết quả.','이 효과는 정확한 결과를 위해 서버 내보내기가 필요합니다.','These effects require server export to preserve the result.'], ['Dự án quá lớn để xuất an toàn trên trình duyệt này.','이 프로젝트는 브라우저에서 내보내기에 너무 큽니다.','This project is too large to export safely in this browser.'],
  ['Xuất bằng server sẽ tải các file cần dùng lên và lưu tạm trong 24 giờ.','서버 내보내기는 필요한 파일을 업로드하여 24시간 임시 보관합니다.','Server export uploads required files and stores them temporarily for 24 hours.'],
  ['Đang tải file để xuất…','내보내기용 파일 업로드 중…','Uploading files for export…'], ['Đang xuất trên thiết bị…','기기에서 내보내는 중…','Exporting on device…'], ['Không đọc được file trong trình duyệt. Thử đổi sang MP4 H.264/AAC.','브라우저에서 파일을 읽을 수 없습니다. MP4 H.264/AAC로 변환해 보세요.','Cannot read this file in the browser. Try MP4 H.264/AAC.'],
  ['Tác vụ này cần gửi video lên server, lưu tạm 24 giờ. Tiếp tục?','이 작업은 영상을 서버에 업로드하여 24시간 임시 보관합니다. 계속할까요?','This operation uploads media to the server for 24 hours. Continue?'], ['Giữ tab mở trong khi xuất.','내보내는 동안 탭을 열어 두세요.','Keep this tab open while exporting.'], ['File không còn trên server. Nhập lại bản gốc để tiếp tục.','서버 파일이 만료되었습니다. 원본을 다시 가져오세요.','The server file has expired. Import the original to continue.'],
  ['Bản tải về:','다운로드 파일:','Download file:'], ['Tải MP3','MP3 다운로드','Download MP3'], [' · gốc ',' · 원본 ',' · original '],
  ['Mới','새로 만들기','New'], ['Mở','열기','Open'], ['Lưu','저장','Save'],
  ['Dự án mới','새 프로젝트','New project'], ['Tên dự án','프로젝트 이름','Project name'],
  ['Mở dự án','프로젝트 열기','Open project'], ['Lưu (Ctrl+S)','저장 (Ctrl+S)','Save (Ctrl+S)'],
  ['Đăng xuất','로그아웃','Sign out'], ['Đăng xuất tài khoản Google','Google 계정 로그아웃','Sign out of Google'],
  ['Miễn phí cho mọi tài khoản Google · Dữ liệu riêng tư','모든 Google 계정 무료 · 비공개 데이터','Free for every Google account · Private data'],
  ['Miễn phí · Thư viện riêng cho tài khoản của bạn · Tối đa 500 MB/file, kiểm tra giới hạn lưu trữ 2 GB khi tải lên.','무료 · 계정 전용 라이브러리 · 파일당 최대 500 MB, 업로드 시 2 GB 저장 한도 확인.','Free · Private account library · Up to 500 MB per file, with a 2 GB storage limit checked on upload.'],
  ['Thêm','더 보기','More'], ['Hoàn tác (Ctrl+Z)','실행 취소 (Ctrl+Z)','Undo (Ctrl+Z)'], ['Làm lại (Ctrl+Y)','다시 실행 (Ctrl+Y)','Redo (Ctrl+Y)'],
  ['Xuất video','동영상 내보내기','Export video'], ['Media','미디어','Media'], ['Văn bản','텍스트','Text'], ['Bộ lọc','필터','Filters'], ['Đóng','닫기','Close'],
  ['Nhập file','파일 가져오기','Import files'], ['Kéo thả file vào đây hoặc vào cửa sổ. Kéo media xuống timeline.','파일을 여기에 또는 창에 놓으세요. 미디어를 타임라인으로 드래그하세요.','Drop files here or in the window. Drag media onto the timeline.'],
  ['Bộ lọc áp cho toàn bộ video (video chính + lớp phủ). Bấm để chọn, xem trước ngay trên khung hình.','필터는 전체 동영상(메인 영상 + 오버레이)에 적용됩니다. 선택하면 즉시 미리 볼 수 있습니다.','Filters apply to the whole video (main video + overlays). Click to preview.'],
  ['Cường độ','강도','Intensity'], ['Về đầu (Home)','처음으로 (Home)','Go to start (Home)'], ['Phát/Dừng (Space)','재생/일시 정지 (Space)','Play/Pause (Space)'], ['Về cuối (End)','끝으로 (End)','Go to end (End)'],
  ['Dự án','프로젝트','Project'], ['Cắt tại đầu phát (S)','재생 헤드에서 분할 (S)','Split at playhead (S)'], ['Tách','분할','Split'], ['Nhân bản (Ctrl+D)','복제 (Ctrl+D)','Duplicate (Ctrl+D)'], ['Nhân bản','복제','Duplicate'], ['Xóa (Delete)','삭제 (Delete)','Delete (Delete)'], ['Xóa','삭제','Delete'], ['Zoom','확대/축소','Zoom'],
  ['Lớp phủ','오버레이','Overlay'], ['Video chính','메인 영상','Main video'], ['Âm thanh','오디오','Audio'], ['Chỉnh sửa','편집','Edit'], ['Thả file để nhập','파일을 놓아 가져오기','Drop files to import'],
  ['Chưa có media.','미디어가 없습니다.','No media yet.'], ['Ảnh','이미지','Image'], ['Video','동영상','Video'],
  ['Thêm vào timeline','타임라인에 추가','Add to timeline'], ['Thêm làm lớp phủ (video trong video - PiP)','오버레이로 추가 (화면 속 화면 - PiP)','Add as overlay (picture in picture - PiP)'],
  ['Chỉ lấy tiếng (không lấy hình) đưa vào track Âm thanh','오디오만 오디오 트랙에 추가','Add audio only to the audio track'], ['Tách tiếng ra file MP3 để tải về','오디오를 MP3로 추출하여 다운로드','Extract audio as MP3 to download'], ['Tách giọng hát bằng AI để tạo beat (MR)','AI로 보컬을 분리하여 반주(MR) 생성','Separate vocals with AI to create instrumental (MR)'], ['Xóa khỏi thư viện','라이브러리에서 삭제','Remove from library'],
  ['giọng hát','보컬','vocals'], ['tách từ video','동영상에서 추출','extracted from video'], ['MR - beat','MR - 반주','MR - instrumental'],
  ['Media này đang dùng trên timeline. Xóa luôn các clip liên quan?','이 미디어는 타임라인에서 사용 중입니다. 관련 클립도 삭제할까요?','This media is used on the timeline. Delete the related clips too?'], ['Media này không có âm thanh','이 미디어에 오디오가 없습니다','This media has no audio'],
  ['Văn bản thường','일반 텍스트','Plain text'], ['Nhập văn bản','텍스트 입력','Enter text'], ['Phụ đề','자막','Subtitle'], ['Phụ đề ở đây','여기에 자막 입력','Subtitle here'], ['Tiêu đề lớn','큰 제목','Large title'], ['TIÊU ĐỀ','제목','TITLE'], ['Nền đen','검정 배경','Black background'], ['Ghi chú','메모','Note'], ['Nền vàng','노랑 배경','Yellow background'], ['Viền đỏ','빨강 테두리','Red outline'],
  ['Anh hùng','히어로','Hero'], ['Viên đạn','불릿','Bullet'], ['Nhảy cắt','점프 컷','Jump cut'], ['Lóe vào','플래시 인','Flash in'], ['Lóe ra','플래시 아웃','Flash out'], ['Montage','몽타주','Montage'], ['Tùy chỉnh','사용자 지정','Custom'],
  ['Gốc','원본','Original'], ['Trong trẻo','선명함','Clear'], ['Rực rỡ','생생함','Vivid'], ['Ấm áp','따뜻함','Warm'], ['Mát lạnh','차가움','Cool'], ['Điện ảnh','시네마','Cinema'], ['Hoàng hôn','노을','Sunset'], ['Cổ điển','빈티지','Vintage'], ['Retro','레트로','Retro'], ['Nâu hoài niệm','세피아','Sepia'], ['Đen trắng','흑백','Black and white'], ['Phai màu','빛바램','Faded'], ['Trầm buồn','무드','Moody'], ['Hồng mộng','핑크 드림','Pink dream'], ['Rừng xanh','숲','Forest'], ['Đêm xanh','푸른 밤','Blue night'],
  ['Đã bỏ bộ lọc','필터 제거됨','Filter removed'], ['Bộ lọc:','필터:','Filter:'],
  ['Đang ẩn — bấm để hiện','숨김 상태 — 클릭하여 표시','Hidden — click to show'], ['Ẩn hình của track này','이 트랙 숨기기','Hide this track'], ['Đang tắt tiếng — bấm để bật','음소거 상태 — 클릭하여 해제','Muted — click to unmute'], ['Tắt tiếng track này','이 트랙 음소거','Mute this track'],
  ['đã ẩn hình','숨김','hidden'], ['đã hiện hình','표시됨','shown'], ['đã tắt tiếng','음소거됨','muted'], ['đã bật tiếng','음소거 해제됨','unmuted'],
  ['Đặt đầu phát vào giữa một clip để tách','분할하려면 재생 헤드를 클립 안에 놓으세요','Place the playhead inside a clip to split'], ['Clip này không có âm thanh','이 클립에 오디오가 없습니다','This clip has no audio'], ['Clip này đã được tách âm thanh rồi','이 클립의 오디오는 이미 분리되었습니다','Audio already detached from this clip'], ['Đang tách âm thanh, chờ chút…','오디오 분리 중, 잠시 기다려 주세요…','Detaching audio, please wait…'], ['Đang tách âm thanh ra MP3…','오디오를 MP3로 추출 중…','Extracting audio to MP3…'], ['Lỗi tách âm thanh: ','오디오 분리 오류: ','Audio extraction error: '], ['Clip đã bị xóa trong lúc tách','분리 중 클립이 삭제되었습니다','Clip was deleted during extraction'],
  ['Đã tạo file MP3 cạnh video trong thư viện','라이브러리에 MP3 파일을 생성했습니다','MP3 created next to the video in the library'], ['File MP3 này đã có sẵn trong thư viện','이 MP3 파일은 라이브러리에 이미 있습니다','This MP3 is already in the library'], ['Lỗi tách MP3: ','MP3 추출 오류: ','MP3 extraction error: '], ['File này không có âm thanh','이 파일에 오디오가 없습니다','This file has no audio'], ['Bài này đang được tách, chờ chút…','이 곡은 분리 중입니다. 잠시 기다려 주세요…','This song is being separated, please wait…'],
  ['Tách âm thanh (MP3)','오디오 추출 (MP3)','Extract audio (MP3)'], ['Tách beat (MR) bằng AI','AI 반주(MR) 분리','Separate instrumental (MR) with AI'], ['Tách beat (MR)','반주(MR) 분리','Separate instrumental (MR)'], ['Chưa cài bộ tách giọng hát bằng AI.','AI 보컬 분리 도구가 설치되지 않았습니다.','AI vocal separator is not installed.'],
  ['Chạy file','파일 실행:','Run file'], ['trong thư mục cài app (cùng chỗ với','앱 설치 폴더에서 (다음 파일과 같은 위치:','in the app installation folder (next to'], ['(tải khoảng 2,5GB, chỉ làm một lần), rồi thử lại.','(약 2.5 GB 다운로드, 최초 한 번만 설치), 이후 다시 시도하세요.','(about 2.5 GB download, one-time setup), then try again.'],
  ['Tách giọng hát khỏi','보컬 분리:','Separate vocals from'], ['→ tạo','→ 생성:','→ create'], ['beat (MR)','반주(MR)','instrumental (MR)'], ['và file','및 파일','and file'], ['riêng.','별도 저장.','separately.'],
  ['Chất lượng','품질','Quality'], ['Nhanh','빠르게','Fast'], ['Chất lượng cao (chậm hơn ~4 lần)','고품질 (약 4배 느림)','High quality (about 4× slower)'], ['Bắt đầu tách','분리 시작','Start separation'], ['Đang chuẩn bị…','준비 중…','Preparing…'], ['Có thể đóng cửa sổ này, việc tách vẫn chạy và sẽ báo khi xong.','이 창을 닫아도 분리는 계속됩니다. 완료되면 알려 드립니다.','You can close this window. Separation continues and you will be notified when done.'], ['Hủy','취소','Cancel'], ['Đã hủy','취소됨','Cancelled'], ['Lỗi không rõ','알 수 없는 오류','Unknown error'], ['Tách beat lỗi: ','반주 분리 오류: ','Instrumental separation error: '], ['Đã tách xong beat (MR) và giọng hát','반주(MR)와 보컬 분리 완료','Instrumental (MR) and vocals separated'],
  ['Đã tạo','생성됨','Created'], ['Đã có sẵn','이미 존재함','Already available'], ['2 file nằm cạnh bài gốc trong thư viện Media:','미디어 라이브러리의 원본 옆에 파일 2개가 있습니다:','2 files next to the original in the media library:'], ['Thêm MR vào timeline','타임라인에 MR 추가','Add MR to timeline'], ['Tải MR','MR 다운로드','Download MR'], ['Tải giọng hát','보컬 다운로드','Download vocals'], ['Đã lưu:','저장 위치:','Saved to:'], ['Clip đã chuyển sang beat (MR)','클립을 반주(MR)로 변경했습니다','Clip switched to instrumental (MR)'], ['Đã thay tiếng video bằng beat (MR) ở track Âm thanh','오디오 트랙에서 동영상 소리를 반주(MR)로 교체했습니다','Video audio replaced with instrumental (MR) on the audio track'],
  ['Tốc độ','속도','Speed'], ['Không','없음','None'], ['không','없음','none'], ['Bình thường','일반','Normal'], ['Đường cong','곡선','Curve'], ['Thời lượng:','길이:','Duration:'], ['Điểm:','포인트:','Point:'], ['gốc','원본','original'],
  ['Kéo điểm để đổi tốc độ · nhấp đúp vào đường để thêm điểm · nhấp đúp vào điểm để xóa','포인트를 드래그하여 속도 변경 · 곡선을 두 번 클릭하여 추가 · 포인트를 두 번 클릭하여 삭제','Drag points to change speed · Double-click the curve to add a point · Double-click a point to delete'], ['Chọn một kiểu đường cong để tăng/giảm tốc độ trong clip (speed ramp).','클립 속도를 변경할 곡선을 선택하세요 (스피드 램프).','Choose a curve to vary speed within the clip (speed ramp).'],
  ['Giữ giọng nói không bị méo khi tua nhanh/chậm','속도를 변경해도 목소리 피치 유지','Keep voice pitch when changing speed'], ['Giữ cao độ giọng','목소리 피치 유지','Keep voice pitch'], ['Slow motion mượt (khi xuất)','부드러운 슬로 모션 (내보내기 시)','Smooth slow motion (on export)'], ['Tắt','끄기','Off'], ['Trộn khung','프레임 혼합','Frame blending'], ['Nội suy','보간','Interpolation'], ['Trộn các khung hình liền kề — nhanh','인접 프레임 혼합 — 빠름','Blend adjacent frames — fast'], ['Nội suy chuyển động tạo khung hình mới — mượt nhất, xuất chậm','움직임 보간으로 새 프레임 생성 — 가장 부드럽지만 내보내기가 느림','Interpolate motion to create frames — smoothest, slower export'], ['Áp dụng cho đoạn chạy chậm hơn 1x. "Nội suy" mượt nhất nhưng xuất video lâu hơn nhiều.','1배속보다 느린 구간에 적용됩니다. 보간은 가장 부드럽지만 내보내기 시간이 더 오래 걸립니다.','Applies below 1× speed. Interpolation is smoothest but takes much longer to export.'], ['Chỉ có tác dụng khi clip chạy chậm hơn 1x.','1배속보다 느린 클립에만 적용됩니다.','Only applies when the clip is slower than 1×.'],
  ['Tỉ lệ khung hình','화면 비율','Aspect ratio'], ['Kích thước xuất:','출력 크기:','Output size:'], ['Phím tắt','단축키','Keyboard shortcuts'], ['Space phát/dừng · S tách · Delete xóa · Ctrl+D nhân bản · Ctrl+Z/Y hoàn tác · ←/→ lùi/tiến 1 frame (Shift: 1 giây) · Ctrl+cuộn: zoom timeline · Kéo chữ / lớp phủ trực tiếp trên khung preview (kéo ô góc để đổi cỡ PiP)','Space 재생/일시 정지 · S 분할 · Delete 삭제 · Ctrl+D 복제 · Ctrl+Z/Y 실행 취소/다시 실행 · ←/→ 1프레임 이동 (Shift: 1초) · Ctrl+스크롤: 타임라인 확대/축소 · 미리 보기에서 텍스트/오버레이 드래그 (모서리로 PiP 크기 변경)','Space play/pause · S split · Delete remove · Ctrl+D duplicate · Ctrl+Z/Y undo/redo · ←/→ move 1 frame (Shift: 1 second) · Ctrl+scroll: zoom timeline · Drag text/overlays in the preview (corner handles resize PiP)'],
  ['Thời lượng','길이','Duration'], ['Thời lượng (giây)','길이 (초)','Duration (seconds)'], ['Bắt đầu (giây)','시작 (초)','Start (seconds)'], ['Kết thúc (giây)','끝 (초)','End (seconds)'], ['Âm lượng','볼륨','Volume'], ['Khung hình','프레임','Frame'], ['Vừa khung','맞춤','Fit'], ['Lấp đầy','채우기','Fill'], ['Điều chỉnh màu','색상 조정','Color adjustment'], ['Độ sáng','밝기','Brightness'], ['Tương phản','대비','Contrast'], ['Bão hòa','채도','Saturation'], ['Hiệu ứng','효과','Effects'], ['Mờ vào (s)','페이드 인 (초)','Fade in (s)'], ['Mờ ra (s)','페이드 아웃 (초)','Fade out (s)'], ['Đặt lại màu & hiệu ứng','색상 및 효과 초기화','Reset colors and effects'], ['Tách âm thanh','오디오 분리','Detach audio'], ['Tiếng sẽ chuyển xuống track Âm thanh để chỉnh riêng; clip video bị tắt tiếng.','오디오를 별도 편집할 수 있도록 오디오 트랙으로 이동하고 동영상 클립을 음소거합니다.','Audio moves to the audio track for separate editing; the video clip is muted.'], ['Tải riêng tiếng (MP3)','오디오만 다운로드 (MP3)','Download audio only (MP3)'], ['Tách beat (MR) – bỏ giọng hát','반주(MR) 분리 – 보컬 제거','Separate instrumental (MR) – remove vocals'],
  ['Lớp phủ (PiP)','오버레이 (PiP)','Overlay (PiP)'], ['Kéo trên khung xem trước để di chuyển, kéo ô vuông ở góc để đổi cỡ.','미리 보기에서 드래그하여 이동하고 모서리를 드래그하여 크기를 변경하세요.','Drag in the preview to move; drag corner handles to resize.'], ['Vị trí & kích thước','위치 및 크기','Position and size'], ['Kích thước','크기','Size'], ['Ngang','가로','Horizontal'], ['Dọc','세로','Vertical'], ['Xoay','회전','Rotation'], ['Độ trong suốt','불투명도','Opacity'], ['Toàn khung','전체 화면','Full frame'], ['Góc phải trên','오른쪽 위','Top right'], ['Lớp trên','앞으로','Bring forward'], ['Lớp dưới','뒤로','Send backward'], ['Thời gian','시간','Time'], ['Bắt đầu trên timeline (s)','타임라인 시작 (초)','Timeline start (s)'], ['Cắt đầu (s)','시작 트림 (초)','Trim start (s)'], ['Cắt cuối (s)','끝 트림 (초)','Trim end (s)'],
  ['Nội dung','내용','Content'], ['Phông','글꼴','Font'], ['Màu','색상','Color'], ['Cỡ chữ','글자 크기','Font size'], ['Đậm','굵게','Bold'], ['Nền','배경','Background'], ['Viền','테두리','Outline'], ['Màu viền','테두리 색상','Outline color'], ['Màu nền','배경 색상','Background color'], ['Vị trí & thời gian','위치 및 시간','Position and time'], ['Bắt đầu (s)','시작 (초)','Start (s)'], ['Thời lượng (s)','길이 (초)','Duration (s)'], ['Vị trí (s)','위치 (초)','Position (s)'], ['(chỉ lấy tiếng từ video)','(동영상의 오디오만 사용)','(audio only from video)'], ['Âm lượng trên 100% chỉ có tác dụng khi xuất video.','100%를 초과하는 볼륨은 내보내기 시에만 적용됩니다.','Volume above 100% applies only on export.'], ['AI tách giọng hát ra; clip này sẽ chuyển sang bản beat (MR). File giọng hát riêng cũng được lưu trong thư viện.','AI가 보컬을 분리하고 이 클립을 반주(MR)로 변경합니다. 보컬 파일도 라이브러리에 저장됩니다.','AI separates vocals and switches this clip to instrumental (MR). The vocals file is also saved in the library.'],
  ['Chưa có dự án nào được lưu.','저장된 프로젝트가 없습니다.','No saved projects yet.'], ['Đã mở dự án','프로젝트를 열었습니다','Project opened'], ['Timeline đang trống','타임라인이 비어 있습니다','Timeline is empty'], ['Đang xuất','내보내는 중','Exporting'], ['Đang xuất…','내보내는 중…','Exporting…'], ['Xong!','완료!','Done!'], ['Tải xuống','다운로드','Download'], ['Đã hủy.','취소되었습니다.','Cancelled.'], ['Tạo dự án mới? (Dự án hiện tại nên được Lưu trước)','새 프로젝트를 만들까요? (현재 프로젝트를 먼저 저장하세요)','Create a new project? (Save the current project first)'],
  ['Đăng nhập Google để sử dụng Vedit miễn phí.','Google에 로그인하여 VEdit을 무료로 이용하세요.','Sign in with Google to use VEdit for free.'],
  ['Bỏ qua: ','건너뜀: ','Skipped: '], ['(không hỗ trợ)','(지원되지 않음)','(unsupported)'], ['Đã nhập: ','가져옴: ','Imported: '], ['Lỗi nhập ','가져오기 오류 ','Import error '], ['Lỗi mạng khi nhập ','가져오기 중 네트워크 오류 ','Network error importing '], ['Đã lưu "','저장됨 "','Saved "'], ['Lỗi lưu: ','저장 오류: ','Save error: '], ['Lỗi: ','오류: ','Error: '], ['Đã bỏ ','제거됨 ','Removed '], [' media không còn file gốc','개의 원본 파일이 없는 미디어',' media with missing source files'], ['Đã tách âm thanh → tạo file "','오디오 추출 완료 → 파일 생성 "','Audio extracted → created file "'], ['" trong thư viện','" 라이브러리에 저장','" in the library'], ['đã nằm cạnh video trong thư viện Media.','미디어 라이브러리의 동영상 옆에 있습니다.','is next to the video in the media library.'],
  ['Không tìm thấy dự án','프로젝트를 찾을 수 없습니다','Project not found'], ['Không có job','작업을 찾을 수 없습니다','Job not found'], ['Lỗi mạng','네트워크 오류','Network error'],
];
const translationMap = new Map(TRANSLATIONS.map(([vi, ko, en]) => [vi, {vi, ko, en}]));
let language = 'ko';
try { const saved = localStorage.getItem('vedit.language'); if (['ko', 'vi', 'en'].includes(saved)) language = saved; } catch {}
function tr(source) { return translationMap.get(source)?.[language] ?? source; }
function setLanguage(next) {
  if (!['ko', 'vi', 'en'].includes(next)) return;
  language = next;
  document.documentElement.lang = next;
  try { localStorage.setItem('vedit.language', next); } catch {}
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = tr(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = tr(el.dataset.i18nTitle); });
  document.querySelectorAll('[data-language]').forEach(el => {
    const active = el.dataset.language === next;
    el.classList.toggle('on', active); el.setAttribute('aria-pressed', String(active));
  });
  document.getElementById('languagePicker').setAttribute('aria-label', {ko:'언어 선택',vi:'Chọn ngôn ngữ',en:'Choose language'}[next]);
  if (typeof renderProps === 'function') {
    renderTextPresets(); renderMedia(); renderTimeline(); renderProps(); renderSounds();
    if (!document.getElementById('tab-filter').classList.contains('hidden')) renderFilterPanel();
  }
  // Open dialogs retain their controls, progress and event handlers.
  translateStatic(document.getElementById('modal'));
}
const originalText = new WeakMap();
function translateStatic(root) {
  root.querySelectorAll('[title]').forEach(el => {
    const source = el.dataset.i18nTitle || el.title;
    if (translationMap.has(source)) { el.dataset.i18nTitle = source; el.title = tr(source); }
  });
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node; (node = walker.nextNode());) {
    if (node.parentElement.closest('script,style,textarea,[data-user-content],.mname,.clabel,.proj-item')) continue;
    const old = originalText.get(node);
    const source = old && node.nodeValue === old.output ? old.source : node.nodeValue;
    // Match complete text nodes, with optional icons and surrounding whitespace.
    let key, matched;
    for (const [vi, ko, en] of TRANSLATIONS) {
      for (const candidate of [vi, ko, en]) {
        const at = source.indexOf(candidate);
        if (at >= 0 && /^[\s＋✂⧉🗑♪🎤🎵⬆⬇✓▇T▤▣·✅▶]*$/u.test(source.slice(0,at)) && !source.slice(at+candidate.length).trim()) {
          key = vi; matched = candidate; break;
        }
      }
      if (key) break;
    }
    if (!key) continue;
    const output = source.replace(matched, tr(key));
    originalText.set(node, {source, output});
    if (node.nodeValue !== output) node.nodeValue = output;
  }
}
