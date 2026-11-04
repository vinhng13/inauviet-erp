# Triển khai ERP cho nội bộ

Mô hình khuyến nghị: **một máy chủ nhỏ** (VPS hoặc máy tại văn phòng) chạy Docker, mở ra Internet qua
**Cloudflare Tunnel** (HTTPS, không mở cổng nào trên máy chủ). Nhân viên đăng nhập bằng **tên đăng nhập + mật khẩu**
do quản trị viên tạo trong ứng dụng.

```
Nhân viên (máy tính / điện thoại)
        │ HTTPS
        ▼
(tuỳ chọn) Cloudflare Access ── lớp chặn thêm theo email
        │
Cloudflare Tunnel ─────────────► máy chủ: tunnel → web (Caddy) → api → db
                                               │        └ đăng nhập, phân quyền
                                               └─ backup mỗi đêm 02:00
```

## 1. Chuẩn bị trên Cloudflare (một lần)

Cần một tên miền đang dùng DNS của Cloudflare, ví dụ `inauviet.vn`. Gói **Zero Trust Free** đủ cho dưới 50 người.

1. **Zero Trust → Settings → Custom pages / Team domain**: đặt team name, ví dụ `inauviet` → team domain là `inauviet.cloudflareaccess.com`.
2. **Networks → Tunnels → Create a tunnel** (Cloudflared) → đặt tên `erp` → chọn *Docker* → **chép token** (chuỗi dài sau `--token`).
   Thêm **Public hostname**: `erp.inauviet.vn` → Service `HTTP` → `web:80`.
3. *(Tuỳ chọn, nên có)* **Access → Applications → Add an application → Self-hosted** cho `erp.inauviet.vn`,
   Policy *Allow* với **Emails ending in** `@inauviet.vn` (hoặc từng email), Login method *One-time PIN*.
   Khi đó người ngoài không thấy cả trang đăng nhập; nhân viên xác nhận email một lần mỗi 24 giờ rồi đăng nhập ứng dụng như thường.
   Bỏ qua bước này nếu nhân viên không có email riêng: ứng dụng vẫn tự bảo vệ bằng mật khẩu, khoá tạm khi nhập sai 5 lần.

## 2. Máy chủ

Ubuntu 24.04, 2 vCPU, 4 GB RAM, 40 GB ổ đĩa là đủ. Cài Docker:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # đăng xuất rồi đăng nhập lại
```

Lấy mã nguồn và cấu hình:

```bash
git clone <địa chỉ repo> inauviet && cd inauviet/ERP
cp deploy/prod.env.example .env.prod
nano .env.prod      # DB_PASSWORD, TUNNEL_TOKEN, ADMIN_USERNAME
chmod 600 .env.prod
```

Tạo mật khẩu database ngẫu nhiên: `openssl rand -hex 24`.

Khởi động (lần đầu mất vài phút để build):

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.prod exec api npm run db:seed
# → in ra tên đăng nhập + mật khẩu tạm của quản trị viên. Ghi lại; lần đăng nhập đầu sẽ bắt đổi.
```

API tự chạy migration mỗi lần khởi động. Kiểm tra:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
curl -s localhost:8090/api/v1/health        # {"status":"ok"}
```

Mở `https://erp.inauviet.vn`, đăng nhập bằng tài khoản quản trị vừa in ra, đổi mật khẩu, rồi:
1. **Nhóm quyền**: xem lại các nhóm mẫu (Kinh doanh, Kế toán, Giao hàng), chỉnh hoặc thêm nhóm.
2. **Tài khoản**: tạo tài khoản cho từng người, chọn nhóm, gửi tên đăng nhập + mật khẩu tạm qua Zalo.
3. Tạo thêm **một quản trị viên dự phòng** (người thứ hai) để không bao giờ bị khoá ngoài.
Trên điện thoại: mở trang → *Thêm vào Màn hình chính* để dùng như ứng dụng.

### Máy tại văn phòng thay cho VPS

Làm y hệt trên một máy luôn bật (mini PC, Windows với Docker Desktop hoặc Ubuntu). Tunnel đi ra ngoài nên **không cần mở cổng router**.
Lưu ý: mất điện hoặc mất mạng văn phòng thì tài xế ngoài đường không vào được; bản sao lưu phải được chép ra nơi khác (mục 4).

## 3. Cập nhật phiên bản

```bash
cd inauviet && git pull
cd ERP && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

## 4. Sao lưu và khôi phục

Container `backup` ghi `ERP/backups/erp-YYYY-MM-DD.dump` lúc 02:00 mỗi đêm, giữ 30 ngày.
**Chép thư mục `backups/` ra ngoài máy chủ** (Google Drive, ổ ngoài…) ít nhất mỗi tuần. File có số điện thoại và địa chỉ khách: giữ ở nơi riêng tư.

Khôi phục (thử ít nhất một lần trước khi dùng thật):

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod stop api
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T db \
  pg_restore --clean --if-exists -U erp -d erp < backups/erp-2026-11-02.dump
docker compose -f docker-compose.prod.yml --env-file .env.prod start api
```

## 5. Quản lý tài khoản

| Việc | Làm ở đâu |
| --- | --- |
| Nhân viên mới | **Tài khoản → Tạo tài khoản**, chọn nhóm quyền, gửi mật khẩu tạm |
| Quên mật khẩu | **Tài khoản → ⋮ → Đặt lại mật khẩu** (người đó bị đăng xuất mọi nơi, phải đổi mật khẩu khi vào lại) |
| Nhân viên nghỉ | **⋮ → Khoá tài khoản** ngay trong ngày: bị đăng xuất tức thì, không đăng nhập được nữa |
| Mất điện thoại | **⋮ → Đăng xuất mọi thiết bị** |
| Đổi việc / đổi quyền | Sửa tài khoản, chọn nhóm khác; hoặc sửa bảng quyền của nhóm (áp dụng ngay cho cả nhóm) |
| Hằng tháng | So danh sách đang hoạt động với nhân sự thực tế; xem cột *Lần cuối dùng* |

Luôn giữ ít nhất **hai** quản trị viên. Ứng dụng không cho khoá hay hạ quyền quản trị viên cuối cùng.
Nếu vẫn không ai vào được tài khoản quản trị, chạy trên máy chủ (in ra mật khẩu tạm mới):

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec api npm run user:reset-admin -- admin
```

## 6. Theo dõi

- `docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f api` — log API (JSON, không ghi mật khẩu hay cookie).
  Nhiều phản hồi `401` ở `/auth/login` liên tục nghĩa là có người dò mật khẩu: bật Cloudflare Access (mục 1.3).
- `GET /api/v1/health` cho công cụ theo dõi (Uptime Kuma, Better Stack…).
- Ai đã làm gì: tab *Lịch sử* của từng đơn; thay đổi tài khoản và nhóm quyền cũng được ghi lại trong database (bảng `ActivityLog`).
