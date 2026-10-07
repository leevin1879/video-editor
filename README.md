# VEdit — trình chỉnh sửa video kiểu CapCut

Ứng dụng chỉnh sửa video chạy trên trình duyệt, máy chủ nhỏ bằng Python (chỉ thư viện chuẩn) và **ffmpeg** để xuất video.

## Chạy

Yêu cầu: Python 3.10+ và [ffmpeg](https://ffmpeg.org/) có trong `PATH`.

```bash
VEDIT_MULTIUSER=0 python server.py
```

Mở <http://127.0.0.1:8765>. Trên Windows có thể bấm đúp `start.bat`.

## Xử lý trên thiết bị / server

- File mới nhập được đọc tại thiết bị và lưu trong IndexedDB của trình duyệt; không gọi API upload khi nhập. Mở lại trên cùng trình duyệt vẫn dùng được file. Nếu xóa dữ liệu trình duyệt hoặc mở dự án trên thiết bị khác, cần nhập lại file gốc có cùng tên.
- Trong bảng **Dự án → Nơi xử lý**, chọn Tự động / Xuất trên thiết bị / Xuất bằng server. Mặc định Tự động: máy tính dùng WebCodecs để tạo MP4 H.264 + AAC, điện thoại/iPad dùng server. Giữ tab mở khi xuất trên thiết bị.
- Bộ dựng trên trình duyệt dùng canvas hiện có cho văn bản, PiP, màu, bộ lọc, ẩn track và fade; âm thanh được trộn với volume, fade, trim và tốc độ. Giữ cao độ khi đổi tốc độ và slow motion nội suy/trộn khung dùng server. Codec không được hỗ trợ hoặc dự án vượt giới hạn bộ nhớ sẽ hiện nút xuất server, không tự gửi file trên máy tính.
- Xuất server chỉ tải các file local dùng trên timeline; không gửi toàn bộ thư viện. Bản sao upload, thumbnail, bản xuất và các kết quả MP3/MR mới được đánh dấu tạm, hết hạn sau 24 giờ. Server kiểm tra mỗi 10 phút và hoãn xóa khi có tác vụ đang chạy; file cũ không được đánh dấu sẽ giữ nguyên.
- Tách audio thành track từ video local hoạt động tại thiết bị. Tải MP3 và tách MR vẫn cần server; giao diện báo trước khi gửi file.
- Hiện giới hạn xuất trình duyệt là 10 phút, khoảng 256 MiB dữ liệu âm thanh giải mã và 256 MiB bản xuất ước tính; các dự án lớn hơn dùng server. Chưa xác nhận trên điện thoại thực tế.

Tạo lại bundle sau khi sửa `browser/media.js`:

```bash
npm ci
npm run build
```

Bundle đã có sẵn trong `static/device-media.js`; chạy Python không cần Node. Mediabunny 1.61.3 dùng giấy phép MPL-2.0, nguồn thư viện có tại <https://www.npmjs.com/package/mediabunny/v/1.61.3> và <https://github.com/Vanilagy/mediabunny>.

## Tính năng

- **Timeline nhiều track:** Văn bản · Lớp phủ (PiP, tự xếp nhiều hàng) · Video chính (nam châm) · Âm thanh; kéo, cắt mép, tách (S), nhân bản, hoàn tác/làm lại, hít vào điểm khác.
- **Nút 👁 / 🔊 theo track:** ẩn hình, tắt tiếng (áp cả khi xem trước lẫn khi xuất).
- **Clip video/ảnh:** vừa khung/lấp đầy, độ sáng/tương phản/bão hòa, mờ vào/ra.
- **Tốc độ 0.1x–10x** và **đường cong tốc độ** (Montage, Anh hùng, Viên đạn, Nhảy cắt, Lóe vào/ra, chỉnh điểm tự do); giữ cao độ giọng; slow motion mượt khi xuất (trộn khung / nội suy chuyển động).
- **Lớp phủ PiP:** kéo/đổi cỡ trên khung xem trước, xoay, độ trong suốt, thứ tự lớp.
- **Văn bản:** 6 kiểu có sẵn, phông, viền, nền, kéo trên khung xem trước (được vẽ thành PNG nên bản xuất giống hệt xem trước).
- **Bộ lọc màu toàn video:** 16 bộ lọc + cường độ (cùng một ma trận màu cho xem trước — SVG `feColorMatrix` — và xuất — `colorchannelmixer`).
- **Âm thanh:** tách tiếng khỏi video (tạo MP3 mới cạnh video), tải MP3.
- **Tách beat (MR) bằng AI** (Demucs): tạo bản nhạc nền bỏ giọng hát + file giọng hát riêng. Cần cài thêm một lần bằng `setup_mr.bat` (tạo môi trường riêng `sep-env`, ~2.5GB tải về; có GPU NVIDIA thì nhanh hơn nhiều).
- **Giao diện màn hình nhỏ / cảm ứng** (≤768px): bảng trượt từ dưới lên + thanh điều hướng dưới.
- Tỉ lệ 16:9 · 9:16 · 1:1 · 4:5 · 4:3, lưu/mở dự án, tự lưu tạm trong trình duyệt.

## Cấu trúc

| Tệp | Vai trò |
|---|---|
| `server.py` | Máy chủ HTTP: tải lên, ffprobe, phát media (Range), dựng `filter_complex` ffmpeg, hàng việc xuất / tách MR |
| `separate.py` | Tách giọng hát bằng Demucs (chạy trong `sep-env`) |
| `static/index.html`, `static/app.js`, `static/style.css` | Giao diện, timeline, xem trước bằng canvas |
| `workspace/` | Dữ liệu người dùng (media, bản xuất, dự án) — **không đưa lên git** |

## Giới hạn hiện tại

- Mặc định máy chủ yêu cầu danh tính ký HMAC từ Google auth proxy. Video, dự án, bản xuất, ảnh thu nhỏ, tệp tạm và tác vụ được tách theo tài khoản trong `workspace/users/<sha256-email>/`. Dữ liệu cũ chỉ dành cho tài khoản chủ cũ nếu cấu hình `legacy_owner_hash`; người khác không được truy cập. Proxy đọc `vedit-auth.json` ở thư mục cha (hoặc `VEDIT_AUTH_CFG`); server dùng cùng `session_secret`, không đưa file này lên GitHub.
- Dùng riêng trên máy: đặt `VEDIT_MULTIUSER=0` (PowerShell: `$env:VEDIT_MULTIUSER='0'`) trước khi chạy. Không được dùng chế độ này cho website công khai.
- Miễn phí, tối đa 500 MB mỗi file tải lên; kiểm tra dung lượng 2 GB mỗi tài khoản trước khi nhận file mới. Tối đa 2 tác vụ xuất/tách AI mỗi tài khoản, 4 toàn máy; máy bận sẽ yêu cầu thử lại. Bản xuất có thể làm tăng dung lượng sau bước kiểm tra tải lên.
- Google OAuth consent screen phải ở trạng thái External / Production để tài khoản ngoài danh sách test đăng nhập được. Proxy cần `allowed_emails: ["*"]`; không tắt xác minh Google.
- Xem trước không có slow motion mượt (chỉ có ở bản xuất).

## Giấy phép

[MIT](LICENSE) — tự do dùng, sửa, phân phối (kể cả thương mại), chỉ cần giữ thông báo bản quyền.
Tính năng tách beat dùng [Demucs](https://github.com/facebookresearch/demucs) (MIT); ffmpeg cài riêng theo giấy phép của ffmpeg.
Người dùng tự chịu trách nhiệm về bản quyền của nội dung (video, bài hát) mà mình chỉnh sửa.


### Automatic speech subtitles
Open Text → Auto subtitles, select the speech language, then Generate subtitles.
The current main clip (or selected main/overlay/audio clip) is transcribed locally on the VEdit host.
Install `pip install -r requirements-speech.txt` in the Python environment running server.py.
Default model: small, CPU int8; set VEDIT_WHISPER_MODEL to a supported model name/path to override.
The first run may download model weights. No speech recognition API key is required.
Only the selected audio range of device media is sent to the VEdit host using the existing 24-hour temporary-media policy; the original video stays on the device. Extracted recognition audio/results are removed after processing.
Generated text clips respect the source trim and speed curve at generation time. Regenerate after changing source timing.
Transcript edits update the actual subtitle clips; SRT uses project timeline times. TXT contains the current edited transcript.
Recognition is limited to one hour per request. No-speech clips return a clear message.

## Latest editor features

- Korean is the default interface language; Vietnamese and English are available from the header.
- Eight bundled sound effects can be previewed and added to the audio timeline.
- Drag text or video in the preview and resize using corner handles.
- Select all generated subtitles to adjust their position, size, font and style together.
- Korean fonts are hosted locally: Noto Sans KR, Jua, Dongle and Nanum Pen Script.
- Six text styles and text layer controls (up/down/front/back) are available in text properties. Overlapping text clips occupy separate timeline rows.
- Optional local ChatGPT MCP integration: see [plugin setup](plugins/vedit/README.md).

For an existing production installation, pull `main`, install `requirements-speech.txt` with the Python environment used by the server, and restart the VEdit server when no export job is running. The speech model downloads on first use unless already cached. Static browser assets are committed; Node.js is only required to rebuild them. Keep the existing production authentication and workspace configuration.
