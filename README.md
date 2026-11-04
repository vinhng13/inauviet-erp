# ERP In Âu Việt

Ứng dụng nội bộ theo dõi **đơn hàng → chuyến giao → thanh toán**: tạo đơn kèm kế hoạch giao (một hoặc nhiều chuyến),
xem mọi đơn trên bảng theo trạng thái, đánh dấu giao xong (kể cả giao thiếu), ghi nhận tiền cọc / tiền thu khi giao.

- `api/` — NestJS 11 + Prisma 7 + PostgreSQL 16 · đăng nhập bằng tên đăng nhập + mật khẩu, phân quyền theo nhóm
- `web/` — React 19 + Ant Design 6 (tiếng Việt)
- Tài liệu kỹ thuật: [`docs/spec.md`](docs/spec.md) · Triển khai: [`DEPLOY.md`](DEPLOY.md)

## Chạy trên máy local (Windows, Docker Desktop)

Yêu cầu: Docker Desktop đang chạy, **Node.js 22** (`node -v` hiện `v22.x`).
Mở PowerShell tại thư mục này (`D:\Source.Code\Inauviet\ERP`).

```powershell
# 1. Khởi động PostgreSQL (lần đầu tạo luôn database erp và erp_test)
docker compose up -d

# 2. Cấu hình API (Git Bash: cp api/.env.example api/.env)
Copy-Item api\.env.example api\.env

# 3. Cài thư viện (tự sinh Prisma client)
npm install

# 4. Tạo bảng và dữ liệu mẫu (tài khoản chủ + đơn mẫu DH-xxxx-0001)
npm run db:migrate
npm run db:seed

# 5. Chạy API + web
npm run dev
```

| Địa chỉ | Dùng để |
| --- | --- |
| http://localhost:5173 | Ứng dụng web |
| http://localhost:3000/api/v1/docs | Tài liệu API (Swagger) |
| http://localhost:8082 | Adminer: xem database (PostgreSQL · máy chủ `db` · `erp` / `erp`) |

Mọi cổng chỉ mở cho chính máy này (127.0.0.1). PostgreSQL ở cổng **5433** để không đụng bản cài sẵn.

Lệnh `npm` trong PowerShell báo *running scripts is disabled*: chạy một lần
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, hoặc gõ `npm.cmd` thay cho `npm`.

### Cập nhật từ bản trước

```powershell
npm run db:migrate   # thêm bảng sản phẩm, báo giá; cấp quyền báo giá cho nhóm đang tạo đơn
npm run db:seed      # thêm danh mục sản phẩm mẫu (nếu chưa có sản phẩm nào)
```

**Đổi tên CRM → ERP (30/10/2026), làm một lần:**

```powershell
cd D:\Source.Code\Inauviet
docker compose -p crm down          # tắt database cũ (dữ liệu thử của bản CRM sẽ không dùng nữa)
git mv CRM ERP
cd ERP
# api/.env: đổi DATABASE_URL thành postgresql://erp:erp@localhost:5433/erp, DATABASE_URL_TEST thành .../erp_test
npm install
npm run db:up
npm run db:migrate
npm run db:seed
npm run dev
```

### Đăng nhập

`npm run db:seed` in ra **tên đăng nhập và mật khẩu tạm** của tài khoản quản trị (mặc định `admin`;
nếu database đã có tài khoản chủ từ bản trước thì dùng tên đó, ví dụ `owner`). Lần đăng nhập đầu sẽ bắt đổi mật khẩu.
Quên mật khẩu quản trị: `npm run user:reset-admin -w api -- admin`.

## Tài khoản và phân quyền

- **Tài khoản** (menu *Quản trị → Tài khoản*): tạo tài khoản thủ công với tên đăng nhập, họ tên, nhóm quyền.
  Mật khẩu ban đầu tự nhập hoặc để hệ thống tạo mật khẩu tạm (chỉ hiện một lần). Người dùng phải đổi ở lần đăng nhập đầu.
  Có thể sửa, đổi nhóm, đặt lại mật khẩu, đăng xuất mọi thiết bị, khoá / mở khoá.
- **Nhóm quyền** (*Quản trị → Nhóm quyền*): mỗi nhóm có bảng quyền theo **module × thao tác**:

  | Module | Thao tác |
  | --- | --- |
  | Đơn hàng | Xem · Thêm · Sửa · Huỷ |
  | Giao hàng | Xem · Thêm · Sửa · Huỷ · Xác nhận giao · Mở lại |
  | Thanh toán | Xem · Thêm · Huỷ |
  | Giá & số tiền | Xem (không có quyền này thì mọi số tiền bị ẩn ngay từ API) |
  | Khách hàng | Xem · Thêm · Sửa |
  | Tài khoản | Xem · Thêm · Sửa · Đặt lại mật khẩu |
  | Nhóm quyền | Xem · Quản lý |

- Nhóm **Quản trị viên** có sẵn, luôn toàn quyền, không sửa/xoá được. Seed tạo thêm nhóm mẫu *Kinh doanh*, *Kế toán*, *Giao hàng*.
- Quy tắc an toàn: luôn còn ít nhất một quản trị viên; không tự khoá, tự đổi nhóm của mình; chỉ quản trị viên mới gán nhóm
  Quản trị viên hoặc sửa tài khoản quản trị; người có quyền *Quản lý nhóm quyền* không sửa được nhóm của chính mình.
- Sai mật khẩu 5 lần trong 15 phút thì tên đăng nhập đó bị khoá tạm 15 phút.
- Danh sách quyền nằm ở `api/src/access/permissions.ts`; mỗi API khai báo quyền cần có bằng `@RequirePermission(...)`.
  API nào quên khai báo sẽ bị từ chối (không bao giờ mở nhầm).

## Kiểm thử

```powershell
npm test            # unit test API (quy tắc số lượng, trạng thái, tiền) + web
npm run test:e2e    # gọi API thật trên database erp_test (bị xoá sạch mỗi lần chạy)
npm run lint        # kiểm tra kiểu TypeScript cả hai phần
```

`test:e2e` chạy lại đúng ví dụ trong tài liệu: đơn 10 banner + 200 decal, 2 chuyến, cọc, thu tiền khi giao, giao thiếu 20 decal rồi thêm chuyến.

## Thay đổi cơ sở dữ liệu

1. Sửa `api/prisma/schema.prisma`
2. `npm run db:migrate -- --name ten_thay_doi` → tạo file migration mới trong `api/prisma/migrations/`
3. `npm run api:types` → cập nhật `api/openapi.json` và kiểu dữ liệu của web (`web/src/api/schema.d.ts`)
4. Commit cả schema, migration, `openapi.json` và `schema.d.ts`

## Cấu trúc

```
ERP/
├── api/
│   ├── prisma/            schema.prisma, migrations/, seed.ts
│   ├── src/
│   │   ├── auth/          đăng nhập, phiên (cookie HttpOnly), mật khẩu scrypt, kiểm tra quyền
│   │   ├── access/        danh sách quyền theo module/thao tác, nhóm quyền
│   │   ├── accounts/      tài khoản: tạo thủ công, khoá, đặt lại mật khẩu
│   │   ├── customers/     khách hàng, tìm không dấu, chống trùng SĐT
│   │   ├── orders/        đơn hàng, bảng đơn, order-calc.ts (mọi quy tắc số lượng/trạng thái)
│   │   ├── deliveries/    chuyến giao: lên kế hoạch, giao xong, giao thiếu, mở lại, huỷ
│   │   ├── payments/      thanh toán (không bắt buộc), huỷ khoản thu
│   │   ├── activity/      lịch sử thay đổi
│   │   └── numbering/     mã KH-0001, DH-2610-0042, GH-2610-0011
│   ├── test/              e2e
│   └── openapi.json       hợp đồng API, sinh từ code
├── web/src/
│   ├── api/               client + hooks (TanStack Query), schema.d.ts sinh từ openapi.json
│   ├── pages/             Đăng nhập, Bảng đơn, Đơn hàng, Chi tiết đơn, Đơn mới, Lịch giao, Khách hàng, Tài khoản, Nhóm quyền
│   └── components/        modal giao hàng, thêm chuyến, thanh toán…
├── deploy/                Caddyfile, backup.sh
├── docker-compose.yml       local: PostgreSQL + Adminer
└── docker-compose.prod.yml  máy chủ: PostgreSQL + API + web (Caddy) + Cloudflare Tunnel + backup
```

## Quy tắc chính

- Mã chứng từ: khách `KH-0001`, đơn `DH-YYMM-NNNN`, chuyến giao `GH-YYMM-NNNN` (đánh số lại mỗi tháng).
- Tổng số lượng lên chuyến của một mặt hàng không bao giờ vượt số lượng đặt.
- Giao thiếu: phần thiếu quay về **chưa lên chuyến**, thêm vào chuyến sau.
- Trạng thái đơn tự chạy theo chuyến giao: Đã chốt → Đang sản xuất (bấm tay) → Đang giao → Hoàn thành.
- Thanh toán không bao giờ đổi trạng thái đơn. Giá và thanh toán đều không bắt buộc.
- Không xoá cứng: chuyến giao được huỷ, khoản thu được huỷ kèm lý do, mọi thay đổi có trong Lịch sử.
