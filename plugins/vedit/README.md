# VEdit plugin 0.1.0

Bản cá nhân kết nối ChatGPT/Codex với VEdit đang mở trên cùng máy. Video vẫn ở thiết bị; plugin chỉ nhận thông tin dự án và gửi lệnh chỉnh sửa. Xuất MP4 bằng trình duyệt, tải file tại VEdit.

## Chạy trên máy này

1. Chạy VEdit ở chế độ local (`VEDIT_MULTIUSER=0`) và mở http://127.0.0.1:8765/.
2. Chạy `setup-plugin.ps1` tại thư mục gốc VEdit một lần. Script cài MCP SDK trong môi trường riêng và tạo `mcp.json` với đường dẫn của máy.
3. Bấm **ChatGPT** trong VEdit để bật kết nối, lấy mã ghép nối. Bấm lại để ngắt kết nối và hủy mã.
4. Chạy `start-plugin.bat`: MCP HTTP ở http://127.0.0.1:8766/mcp. Giữ tiến trình và tab VEdit mở.

`server.py` cũng hỗ trợ stdio khi chạy không có `--http`. Cấu hình `mcp.json` do setup tạo dùng stdio cho các host plugin local.

## Kết nối ChatGPT

Theo [hướng dẫn kết nối plugin của OpenAI](https://developers.openai.com/plugins/deploy/connect-chatgpt), dùng **Plugins → Add custom MCP server → Tunnel → Create as a plugin**, rồi chọn VEdit trong chat. Tài khoản/workspace phải cho phép custom MCP.

Tạo Secure MCP Tunnel trong Platform, liên kết đúng workspace và chạy tunnel-client trên máy VEdit. Tunnel cần runtime API key và quyền tương ứng. Lấy tunnel-client và cách cấu hình từ [tài liệu chính thức](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels); cấu hình HTTP đích là `http://127.0.0.1:8766/mcp`. Không mở cổng 8765/8766 ra Internet.

Trong chat, yêu cầu plugin gọi `connect_editor` bằng mã từ VEdit. Mã hết hiệu lực khi ngắt kết nối, ghép nối lại hoặc restart server. Không đăng mã lên Git, không gửi cho người khác.

Kết nối riêng qua tunnel chưa phải xuất bản lên Plugin Directory công khai. Bản này chưa có OAuth đa người dùng và không dành cho public hosting. Muốn phát hành cho mọi user cần backend OAuth, phân quyền theo tài khoản, giao diện chọn video, chính sách dữ liệu và quy trình review của OpenAI.

## Gói plugin local

Repo có `.agents/plugins/marketplace.json`, manifest `plugin.json`, workflow `skills/edit-video/SKILL.md` và MCP server. Các desktop host hỗ trợ marketplace local có thể thấy nguồn **VEdit Local** sau khi thêm repo/restart. Chạy setup trước; đường dẫn trong MCP config phải trỏ đúng máy. [Quy cách đóng gói](https://developers.openai.com/plugins/build/plugins).

File ZIP là bản sao thư mục plugin, không phải trình cài tự động cho ChatGPT web. ChatGPT web kết nối qua MCP/tunnel như trên. Khi chuyển máy, giải nén và chạy `install.ps1` trong thư mục plugin để tạo môi trường MCP và đường dẫn mới. Máy đích vẫn cần VEdit đã cập nhật, chạy local tại cổng 8765. Có thể đổi URL bằng biến `VEDIT_EDITOR_URL`.

## Các công cụ

| Công cụ | Chức năng |
|---|---|
| connect_editor | Ghép nối với tab bằng mã riêng |
| get_project | Đọc media/clip IDs, timeline, danh sách sound effect |
| edit_timeline | Cắt, sắp xếp, thêm clip/chữ/âm thanh, tỉ lệ, tốc độ, âm lượng |
| undo_edit | Hoàn tác giao dịch gần nhất |
| export_video | Xuất MP4 trên thiết bị, hiện nút Download ở VEdit |
| get_command_result | Theo dõi lệnh đang chờ/chạy |

Ví dụ: “Dùng VEdit cắt clip đầu từ giây 10 đến 30, chuyển 9:16, thêm chữ 안녕하세요 trong 3 giây đầu và pop ở giây 2.”

Lệnh edit có 1–50 thao tác, áp dụng một lần hoặc không áp dụng nếu có lỗi. Trim dùng giây của file gốc; start dùng giây trên timeline. Các thay đổi có một bước undo. Plugin không đọc trực tiếp nội dung video, chọn highlight, nhận dạng giọng nói hay tạo phụ đề tự động.

Giới hạn: một tab/một người dùng, tab phải mở và kết nối còn hoạt động; các mã clip phải lấy từ get_project. Export thiết bị giữ nguyên các giới hạn codec/hiệu ứng/bộ nhớ của VEdit. Plugin báo lỗi nếu cần chuyển server; không tự tải nguồn video lên.

## Kiểm tra đã chạy

- 10 unit tests về mailbox, vòng đời mã, ngăn tab khác, TTL file và tenant isolation.
- MCP streamable HTTP: initialize, discovery 6 tools, ghép nối, batch edits, thêm sound, từ chối batch lỗi, undo và xuất MP4 thiết bị.
- Chưa đăng ký/cài vào tài khoản ChatGPT thực tế; cần tunnel của tài khoản để hoàn thành kiểm tra trong ChatGPT.
