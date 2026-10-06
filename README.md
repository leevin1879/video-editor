# VEdit — trình chỉnh sửa video kiểu CapCut

Ứng dụng chỉnh sửa video chạy trên trình duyệt, máy chủ nhỏ bằng Python (chỉ thư viện chuẩn) và **ffmpeg** để xuất video.

## Chạy

Yêu cầu: Python 3.10+ và [ffmpeg](https://ffmpeg.org/) có trong `PATH`.

```bash
VEDIT_MULTIUSER=0 python server.py
```

Mở <http://127.0.0.1:8765>. Trên Windows có thể bấm đúp `start.bat`.

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
