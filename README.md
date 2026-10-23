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

### Text animation
Select a text clip to choose Slide up, Slide down or Blur to clear and set entrance duration, fade in and fade out. Bulk subtitle selection applies the same settings to all generated subtitles. Motion and fades are limited to half the clip duration. Preview, device export and server export support these effects. In ChatGPT use `set_text_animation` or animation fields on `add_text`; refresh VEdit tools after upgrading the MCP server.

### Poster titles and text behind people

Text styles include glowing gold/white poster titles. Select text and enable **Behind person** to mask text where the prominent person is detected. Uses a locally hosted MediaPipe Selfie Segmenter model; video frames remain in the browser. Preview segmentation is limited to 15 updates/second while playing, and device export segments every frame. Hair, fast motion and groups of people can produce imperfect masks; this is not manual rotoscoping.

Projects with this effect export on the device, including when the project was set to server export. Server export rejects the effect rather than dropping it. Other text styles/animations retain server export support. Model/runtime assets are bundled under `static/vision`; licensing notices are in `static/licenses`. Run `npm run build` after editing the browser modules. Plugin `set_text_style` supports both style selection and `behind_person`; refresh plugin tools after upgrading.

## Upload directly to YouTube

The YouTube button connects a channel and uploads the current exported MP4. After device/server export, click YouTube in the completion dialog, or use the header button. Set title, description, visibility and whether the video is made for kids, review the destination channel, then click Upload. Private is the default. This does not automatically publish a video when exporting or connecting. Editing the project invalidates its previous export for uploading.

### One-time OAuth setup

1. Install `pip install -r requirements-youtube.txt` with the Python environment running VEdit.
2. Enable **YouTube Data API v3** in your Google Cloud project and create a **Web application** OAuth client. Using a dedicated YouTube OAuth client separates this grant from VEdit login.
3. Add the exact callback shown in the YouTube setup dialog. Default local callback: `http://127.0.0.1:8765/api/youtube/callback`. Production: `https://vedit.1879.co.kr/api/youtube/callback`. Register every environment you use; HTTPS, hostname, port and path must match exactly.
4. Local mode: download the Web OAuth client JSON and import it in VEdit's YouTube dialog. The file must already list the callback. The secret is saved outside the repository in `../vedit-youtube.json`; existing configuration is never overwritten through the UI.
5. Production: copy `deploy/vedit-youtube.example.json` **outside the repository**, fill in real credentials, and point `VEDIT_YOUTUBE_CONFIG` at that file. Alternatively use `VEDIT_YOUTUBE_CLIENT_ID`, `VEDIT_YOUTUBE_CLIENT_SECRET` and `VEDIT_YOUTUBE_REDIRECT_URI`. Keep the existing Google login configuration; it is not changed by this feature.
6. Configure the OAuth consent screen for YouTube upload + channel read access. In Google's Testing mode, add intended accounts as test users; external production access can require Google's verification. Click Connect YouTube in VEdit, select the intended Google/Brand account and grant the permissions yourself.

Do not commit client JSON, secrets or connection storage. Tokens are encrypted with Fernet under the server-only `workspace/youtube-private` directory, isolated by tenant. Protect that directory with the server account's filesystem permissions and preserve its encryption key when migrating. No access/refresh tokens or Google resumable session URLs are returned to the browser. Disconnect removes VEdit's saved connection; Google account consent can also be revoked at https://myaccount.google.com/permissions.

Uploads use YouTube's resumable protocol with bounded 8 MiB chunks (maximum video size 500 MiB). Device exports pass through VEdit in memory; no additional video file is saved. Server exports are read by the browser using HTTP Range requests. Keep the tab open. Temporary interruptions are retried and progress reconciled with YouTube; recovery after closing the tab/server restart is not supported. After an interrupted final upload, check YouTube Studio before starting another upload to avoid duplicates. Cancelling stops further chunks; a video whose final chunk was already accepted may already exist.

Success displays YouTube's returned video ID/link and actual visibility. Processing can continue on YouTube afterward. Channel availability, API quotas, consent settings and YouTube policies still apply. No real upload has been tested without the owner's channel authorization.

Validation: `python -m unittest test_youtube_publish test_plugin_bridge test_temporary_storage` and `node scripts/test_youtube_ui.cjs`. These use mocked Google responses and do not publish videos.

## YouTube + TikTok publishing

The **YouTube + TikTok** header button uses one current export for the destinations explicitly selected by the user. It displays the connected channel/account, a preview, editable metadata and separate visibility settings. YouTube defaults to private and requires an audience answer. TikTok has no default visibility or enabled interactions; its creator info is queried when the dialog opens and again before submission. Commercial content, branded-content consent and AI disclosure are supported. Submission sends both jobs concurrently. Each result is independent; TikTok is only reported published after `PUBLISH_COMPLETE`, not after the upload finishes. Send remains disabled after a submission to prevent accidental duplicates. A pending TikTok session can be checked again in the same browser tab.

### TikTok setup and current registration

An app named **VEdit**, owned by the **VEdit** organization, was created on 2026-10-23:

- App: `7699694429230024722`, [developer draft](https://developers.tiktok.com/app/7699694429230024722/pending).
- Sandbox: `VEdit Development`, `7699696923690747912`.
- The app's Production registration is still **Draft / not approved**. The Sandbox configuration was saved with its icon, Photo & Video category, Web platform, Login Kit and Direct Post. Its `vedit.1879.co.kr` domain is verified, and the target TikTok account `1879aischool` is connected to the HTTPS VEdit installation. YouTube is also connected there. Public `/about`, `/terms` and `/privacy` pages are deployed. Sandbox credentials remain outside the repository. A real posting demo and TikTok review/audit are still required for general public posting; do not treat the Sandbox grant as Production approval.

Required setup:

1. Deploy this version, including `deploy/vedit-authproxy.py`, to the HTTPS installation. Verify `/about`, `/terms`, `/privacy` load publicly without Google login. These pages identify the operator supplied by the owner. Review their text before using them for the production service.
2. Complete the app icon, Photo & Video category, description and official URLs. Add Login Kit and Content Posting API, enable Direct Post, and request `user.info.basic` and `video.publish`. Register the exact Web callback `https://vedit.1879.co.kr/api/tiktok/callback`. TikTok Web does not accept the local HTTP callback used by YouTube.
3. Add and verify the website/domain in URL properties. For server exports also verify the URL prefix `https://vedit.1879.co.kr/api/tiktok/media/` or its domain. The backend provides only opaque, unguessable one-hour URLs for a single approved export; original media and workspace listing stay private. The proxy only forwards exact capability GETs without login. Do not disable authentication on `/media`, `/exports`, other `/api` routes, or the editor.
4. Add the intended TikTok target account in the Sandbox, complete the sandbox configuration, and obtain the Sandbox credentials. Keep Sandbox and Production credentials separate.
5. Copy `deploy/vedit-tiktok.example.json` **outside the repository** to the default `../vedit-tiktok.json`, or set `VEDIT_TIKTOK_CONFIG` to its path. Set the actual client key/secret and callback. Environment overrides: `VEDIT_TIKTOK_CLIENT_KEY`, `VEDIT_TIKTOK_CLIENT_SECRET`, `VEDIT_TIKTOK_REDIRECT_URI`. Leave `pull_enabled` false until domain/prefix verification and the authenticated proxy have been deployed and checked. Never commit credentials.
6. Use VEdit at the configured HTTPS origin, click Connect TikTok and grant the requested permissions. The proxy forwards only the matching OAuth anti-CSRF cookie; Google login/session cookies never reach the publisher backend. Tokens are encrypted separately under `workspace/tiktok-private`, isolated by tenant. Disconnect revokes TikTok access and removes its local connection and active capabilities.
7. Record a real sandbox end-to-end demo, then complete app review and the Direct Post audit. Unaudited clients are limited to private accounts/`SELF_ONLY`; public posting depends on TikTok approval. Do not submit a demo claiming untested functionality or use unrelated existing videos as an integration demo.

Device exports use `FILE_UPLOAD` with sequential 10,000,000-byte chunks and trailing bytes merged into the last chunk. Server exports use `PULL_FROM_URL` on the verified domain. VEdit limits videos to 500 MiB. Keep the browser open during transfer. A manual status check remains available after the initial polling window; processing and moderation can take longer. Connections persist across restarts, but active publishing jobs/capability URLs are currently held in memory and are lost on a server restart. Check the platform before retrying interrupted jobs; successful posts are not rolled back when another destination fails. The app never automatically changes account privacy, retries a completed destination, or adds a VEdit watermark.

Validation: `python -m unittest test_publish_proxy test_tiktok_publish test_youtube_publish test_plugin_bridge test_temporary_storage`, `python -m unittest test_tenant_isolation`, `node scripts/test_social_publish_ui.cjs`, `node scripts/test_youtube_ui.cjs`. These tests use isolated data and mock publishing services. Live OAuth callbacks and creator/channel queries were verified for both platforms on 2026-10-23; unauthenticated requests to account/media/export routes remain denied. No real TikTok or simultaneous posting test has been performed, and no new video was posted during connection setup.
