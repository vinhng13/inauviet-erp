# Inauviet ERP — Technical Spec (v0.13)

**Backend:** Node.js 22 LTS · NestJS · Prisma 7 · PostgreSQL
**Frontend:** React 19 · TypeScript · Vite · Ant Design 6
**Repository:** `Inauviet/ERP/` with `api/` and `web/` (npm workspaces), next to `Inauviet/CMS/`
**Scope:** A simple order and delivery tracker. Staff create orders with a delivery plan, follow every order on a board, mark deliveries done, and optionally record payments.
**Status:** Codebase initialized 29 Oct 2026 (milestones M0–M3 built and tested, M4 deployment files in place). Open questions are in section 12.

**Changes in v0.13 (20 Nov 2026)**
- Removed stock counts (Kiểm kê vật tư), die counts (Kiểm kê khuôn) and month locks (Chốt tồn tháng): menu, pages, endpoints and the `warehouse.count` permission are gone. The tables `WhCount*`, `WhDieCount*`, `WhMonthLock` stay for history but nothing reads or writes them, and no slip is blocked by a month lock any more. Adjustment slips (DC-) can now be voided like other slips. Sections 15.x that describe counts and locks are historical.
- The paper stock import creates a PENDING adjustment slip whose lines are sheet − confirmed stock ("Tồn đầu" the first time, "Điều chỉnh theo bảng tồn giấy" after), so confirming it makes stock equal the sheet. Re-importing cancels the previous import slip if it is still pending.

**Changes in v0.12 (dies across warehouses, confirmed transfers, 20 Nov 2026)**
- Dies belong to a die warehouse (`WhDie.warehouseId`): Kho khuôn Âu Việt (KHUON) and Kho Xuân Đỉnh (XUANDINH, formerly a "workshop"). Shelves belong to a warehouse. Every move between places is a transfer (`WhDieBatch`, GN-…) with a required destination and storekeeper confirmation; see 15.6. New menu **Nhật ký khuôn**.

**Changes in v0.11 (multi-warehouse Kho, 19 Nov 2026)**
- Warehouses are data, not code: `WhWarehouse` (code, name, address, kind STOCK / DIE, storekeepers). Seeded: GIAY, BAT, OFFSET (stock), KHUON (dies). Existing materials, slips, counts and month locks moved to GIAY.
- One material catalog for all warehouses: material → quy cách (`WhSpec`, the former `WhStockItem`) → units (`WhUnit`, factor to the base unit, optionally per spec) and warehouse links (`WhWarehouseMaterial`). Stock is per warehouse × spec (`WhStock`).
- Slips belong to a warehouse, carry the unit used and its factor, and wait for the storekeeper: PENDING → CONFIRMED / REJECTED / CANCELLED. Stock changes only on confirmation. Transfers A → B are two linked slips. Daily end-of-day snapshots (`WhDailyStock`). See 15.5.

**Changes in v0.10.1 (18 Nov 2026)**
- Chart of accounts: migration `20261118090000_tt133_chart` loads the full Circular 133 chart (123 level-1 and level-2 accounts). Within each family only the level the books post to is active (111 on, 1111/1112 off; 1331 on, 133 off), so a figure is never split between a main account and its sub-accounts; inactive accounts cannot be posted to.
- `npm run kho:import` imports the warehouse die list from Excel without the web UI.

**Changes in v0.10 (Kho module, 17 Nov 2026)**
- New module **Kho** (menu: Tổng quan kho, Tồn kho & phiếu, Khuôn, Giao nhận khuôn, Kiểm kê, Danh mục kho), independent of CRM and accounting: own catalogs, no foreign keys to `Customer`, `Order`, `Material` or `Supplier`.
- Materials kept by size (khổ), receipts / issues / returns, stock card, stock count with adjustment, month lock. Dies with fixed codes, life cycle state machine, multi-die hand-over slips, size search, die counts, import of the existing Excel die list.
- New permissions `warehouse.view / slip / dies / count / manage`; group "Thủ kho" gets slip + dies + count. See section 15.

**Changes in v0.9 (Facebook fanpage chat, 11 Nov 2026)**
- CRM → **Hội thoại**: Messenger messages and fanpage comments, answered from the CRM (text, images, files; public reply or one private reply to a comment). Live updates over server-sent events, unread badge and chime.
- Quản trị → **Kết nối kênh**: connect fanpages with a system-user (or page) access token; tokens stored AES-256-GCM encrypted; health, last event, failed events with retry.
- New permissions `conversations.view / viewAll / reply / assign` and `channels.manage`; the "Kinh doanh" group gets view + reply. See section 14.

**Changes in v0.8 (separate modules and the accounting module, 05 Nov 2026)**
- After sign-in a module picker (`/`) shows only the modules the account may use: **CRM**, **Kế toán**, **Quản trị**. Each module has its own sidebar menu and a switcher at the top of the menu (also "Chọn module" in the user menu). CRM paths are unchanged; accounting lives under `/accounting/*` plus `/payments`.
- Accounting module (internal books, Thông tư 133, no e-invoice): periods by month with month-end steps and closing, cash/bank book with expense vouchers, receivables/payables, raw-material stock at the monthly weighted average, fixed assets and tools, VAT 8%, general journal and trial balance, P&L and general ledger. See section 13.
- Order lines can no longer change once the customer has signed acceptance (`ORDER_COMPLETED`), since revenue is booked from them.

**Changes in v0.7 (steps 2–6 of the 6-step process, as in the prototype)**
- Order statuses follow the steps: CONFIRMED (2 · Chốt đơn) → DESIGNING (3 · Thiết kế) → DESIGN_FINALIZING (4 · Hoàn thiện TK) → IN_PRODUCTION (5 · Sản xuất) → DELIVERING (6 · Giao hàng) → COMPLETED. "Bắt đầu sản xuất" is replaced by "Xác nhận đơn" (needs design, or customer files go straight to production).
- Design: designer, maket versions v1, v2… with the customer's answer, approval (version, channel, approver), "print files finished", lock → work order. "Khách đổi ý" sends an approved order back to step 3.
- Production: work order LSX-YYMM-NNNN with stages Nhận lệnh → In → Gia công → Kiểm tra → Xong, due date and priority, then "Chuyển giao hàng".
- Delivery no longer completes the order on its own: when everything is delivered, the signed acceptance report (biên bản nghiệm thu) completes it. Trips of an accepted order cannot be reopened.
- New pages: Thiết kế, Sản xuất, Thanh toán & công nợ (under Kế toán), acceptance tabs on Giao hàng, 6-column board with open quotes and KPIs.
- Documents are real PDF files generated on the server (pdfmake, Roboto font, temporary A4 layout): quote, order, design approval, work order, acceptance report, internal invoice. Download icons in every list (one file, or a menu with each file and "Tải cả bộ" as .zip), "In / tải tài liệu" on the order page, and on the customer page every quote/order with its files, filter by document type, and one zip of everything (a folder per order). Shop details printed in the header come from `COMPANY_*` in `.env`.
- New permissions design.view/assign/work, production.view/update, deliveries.accept; new starting groups "Thiết kế" and "Sản xuất" (no prices).
- Migration `20261031090000_design_production_acceptance`: existing orders count as confirmed; orders already in production get needsDesign = false; completed orders get acceptedAt = completedAt.

**Changes in v0.6 (ERP, phase 1 of the 6-step process)**
- Project renamed CRM → ERP (folder, packages, database `erp`, cookie `erp_session`). The CRM part follows the prototype first; the accounting module comes later.
- Step 1: product catalog (Sản phẩm) priced per m² (width × height) or per unit, and quotes BG-YYMM-NNNN with statuses Nháp / Đã gửi / Đã chốt / Khách không lấy.
- Step 2: closing a quote creates the order with the same lines. Products, sizes and quantities can be changed on the order without approval; each change is logged and the order shows what differs from the quote.
- Migration `20261030120000_products_quotes`; groups that create orders and see prices get the quote permissions.

**Changes in v0.5 (accounts and permissions)**
- Sign-in with username + password (scrypt hashes), server-side sessions in an HttpOnly cookie. Cloudflare Access is now only an optional outer layer.
- Accounts are created by hand (Tài khoản); permission groups (Nhóm quyền) hold permissions per module × action. Replaces the fixed OWNER/STAFF roles.
- Migration `20261029160000_accounts_permissions` moves existing OWNER accounts to "Quản trị viên" and STAFF to "Nhân viên".

**Changes in v0.4 (as built)**
- Login through Cloudflare Access; the app stores staff and roles only (no passwords, no sessions table). See section 7.
- Order gained `productionStartedAt` and `cancelledAt`; ActivityLog gained `orderId` so an order's history includes its trips and payments.
- Pinned to stable majors: NestJS 11, TypeScript 5.9, Jest 29, React Router 7, Vite 7, jose 5 (CommonJS-compatible).
- The schema in section 5 is now a summary; `api/prisma/schema.prisma` is the source of truth.

**Changes in v0.3 (simplified scope)**
- App reduced to 6 pages: order board, orders, order detail, deliveries, customers, users.
- Deliveries are planned when the order is created (one or more trips, each with dates and quantities per line).
- Short deliveries: undelivered quantity goes back to "not yet planned".
- Prices and payments are optional. A payment always belongs to an order and can optionally point to the delivery it was collected on.
- Order status is driven by deliveries only. Payment never blocks or closes an order. Deposit gate removed.
- Removed from v1: quotes, design/maket approval, work orders, file uploads, PDFs, live updates (Socket.IO), notifications, background jobs, workshop phone app. These are listed in section 11 as later phases.

---

## 1. Decisions so far

| # | Decision | Date |
|---|---|---|
| D1 | One repository for `api/` and `web/` | 29 Oct 2026 |
| D2 | NestJS + Prisma + PostgreSQL backend; React + Ant Design frontend | 29 Oct 2026 |
| D3 | Simplified app: board + order/delivery status handling only | 29 Oct 2026 |
| D4 | No realtime: pages refresh on open, on returning to the tab, and with a refresh button | 29 Oct 2026 |
| D5 | Delivery plan entered at order creation | 29 Oct 2026 |
| D6 | Payments optional; linked to the order, optionally to a delivery | 29 Oct 2026 |
| D7 | Short delivery returns the missing quantity to "not yet planned" | 29 Oct 2026 |
| D8 | ~~Login with Cloudflare Access~~ replaced by D10 | 29 Oct 2026 |
| D9 | Project name `ERP` (renamed from `CRM` on 30 Oct 2026), in `D:\Source.Code\Inauviet\ERP` | 30 Oct 2026 |
| D10 | Username + password accounts created by hand; permissions through groups (module × action) | 29 Oct 2026 |

---

## 2. Worked example

Công ty ABC orders on 27/10. Order **DH-2610-0042**:

| Line | Quantity | Unit price (optional) |
|---|---|---|
| Banner hiflex 2×1 m | 10 | 500.000 đ |
| Decal PP 30×40 cm | 200 | 35.000 đ |

Total 12.000.000 đ. Delivery plan entered with the order:

| Delivery | Planned date | Banner | Decal |
|---|---|---|---|
| GH-2610-0011 | 02/11 | 10 | 100 |
| GH-2610-0012 | 04/11 | — | 100 |

What happens next:

| Date | Action | Order status | Payment |
|---|---|---|---|
| 27/10 | Order created, 2 trips scheduled | Confirmed | Deposit 3.000.000 đ (order only) |
| 28/10 | Staff clicks "Start production" | In production | |
| 02/11 | GH-2610-0011 marked delivered (10 banners, 100 decals) | Delivering | 5.500.000 đ collected, linked to GH-2610-0011 |
| 04/11 | GH-2610-0012 marked delivered (100 decals) | Completed | 3.500.000 đ collected, linked to GH-2610-0012 |

Balance at the end: 12.000.000 − 12.000.000 = 0 đ.

**Short delivery variant:** on 04/11 only 80 decals go out. GH-2610-0012 is saved with planned 100, delivered 80. The order stays **Delivering** and shows "20 decals not yet planned". Staff adds them to a new trip (GH-2611-0003); when that is delivered, the order becomes **Completed**.

---

## 3. Tech choices

### Backend

| Concern | Choice | License |
|---|---|---|
| Runtime | Node.js 22 LTS | MIT |
| Framework | NestJS 11 | MIT |
| ORM / migrations | Prisma 7 (pin 7.10.x) + `@prisma/adapter-pg`. Prisma 8 is still a release candidate | Apache 2.0 |
| Database | PostgreSQL 16+ with `pg_trgm` for search | PostgreSQL |
| Validation | class-validator + class-transformer | MIT |
| API docs | @nestjs/swagger → `openapi.json` + Swagger UI at `/api/docs` | MIT |
| Auth | Username + password; Node `crypto.scrypt` hashes; server-side sessions (random token in HttpOnly cookie, SHA-256 in DB) | built-in |
| Logging | nestjs-pino | MIT |
| Config | @nestjs/config + zod | MIT |
| Tests | Jest + Supertest | MIT |

### Frontend

| Concern | Choice | License |
|---|---|---|
| UI | React 19 + TypeScript | MIT |
| Build | Vite 7 | MIT |
| Components | Ant Design 6 (`vi_VN` locale) + @ant-design/icons | MIT |
| Routing | React Router 7 | MIT |
| Server state | TanStack Query 5 (refetch on window focus, no polling) | MIT |
| API client | openapi-typescript + openapi-fetch, generated from the API | MIT |
| Dates | dayjs (`vi` locale) | MIT |
| Language | Vietnamese only; API error codes mapped in `web/src/lib/errors.ts` | — |
| Tests | Vitest + Testing Library; Playwright end-to-end | MIT / Apache 2.0 |

Not needed in v1: Socket.IO, pg-boss, S3/MinIO, PDF library.

---

## 4. Project structure

See the structure section of `README.md`. Key files:

| File | What it holds |
|---|---|
| `api/prisma/schema.prisma` | Data model (source of truth) |
| `api/src/orders/order-calc.ts` | Every quantity, total and status rule, as one pure function with unit tests |
| `api/src/orders/order-recalc.service.ts` | Runs that function at the end of every write, in the same transaction |
| `api/src/access/permissions.ts` | The permission catalog (module × action), implied permissions, default groups |
| `api/src/auth/auth.guard.ts` | Session check, forced password change, `@RequirePermission` enforcement (fail-closed) |
| `api/src/auth/money.interceptor.ts` | Removes every `*Vnd` field for accounts without `money.view` |
| `api/openapi.json` | API contract, generated from code |
| `web/src/api/schema.d.ts` | Frontend types, generated from `openapi.json` |

## 5. Data model

```mermaid
erDiagram
  CUSTOMER ||--o{ QUOTE : "asks for"
  QUOTE ||--|{ QUOTE_LINE : contains
  PRODUCT |o--o{ QUOTE_LINE : "priced from"
  QUOTE |o--o| ORDER : "closed into"
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ ORDER_LINE : contains
  ORDER ||--o{ DELIVERY : "planned as"
  DELIVERY ||--|{ DELIVERY_LINE : carries
  ORDER_LINE ||--o{ DELIVERY_LINE : "split into"
  ORDER ||--o{ PAYMENT : "paid by"
  DELIVERY |o--o{ PAYMENT : "collected at"
```

Source of truth: `api/prisma/schema.prisma`; first migration: `api/prisma/migrations/20261029140000_init`.

| Table | Notes |
|---|---|
| User | username (unique, lowercase), passwordHash (scrypt), mustChangePassword, fullName, optional email/phone, roleId, isActive, lastSeenAt |
| Role | Permission group: name, description, permissions `text[]` of keys like `orders.create`, isSystem (built-in admin, all permissions) |
| Session | tokenHash (SHA-256 of the cookie token), expiresAt (sliding), lastUsedAt, revokedAt, ip, userAgent |
| Customer | code KH-0001, phone unique (normalized 0xxxxxxxxx), `searchText` without diacritics, GIN trigram index |
| Product | name (unique), category, pricingMode AREA (per m²) / UNIT, unit, unitPriceVnd (list price), isActive |
| Quote | code BG-YYMM-NNNN, customerId, title, status DRAFT/SENT/WON/LOST, quoteDate, validDays, note, totalVnd, sentAt, lostAt + lostReason, wonAt |
| QuoteLine | productId?, description, spec, unit, widthM/heightM (AREA), areaPriceVnd (per m²), quantity, unitPriceVnd (one piece = round(w × h × price per m²)), lineTotalVnd |
| Order | code DH-YYMM-NNNN, quoteId (unique, optional), status, orderDate, dueDate, cached totalVnd / paidVnd, productionStartedAt, completedAt, cancelledAt |
| OrderLine | quantity, cached plannedQty / deliveredQty, optional unitPriceVnd, lineTotalVnd; productId, quoteLineId, unit, widthM/heightM, areaPriceVnd for lines from the catalog |
| Delivery | code GH-YYMM-NNNN, status SCHEDULED/DELIVERED/CANCELLED, plannedDate, deliveredAt, address, receiverName |
| DeliveryLine | plannedQty, deliveredQty (set when delivered) |
| Payment | orderId required, deliveryId optional, amountVnd > 0, voidedAt / voidReason instead of delete |
| DocumentSequence | atomic counters for document codes |
| ActivityLog | orderId, entityType, entityId, action, from/to, data, userId |

Conventions: UUID ids; money as whole đồng in `BIGINT`, sent as JSON numbers; calendar dates in `DATE` columns, sent as `YYYY-MM-DD`; nothing business-related is hard-deleted.

## 6. Business rules

### 6.1 Order status

| From | To | How | Who |
|---|---|---|---|
Status is derived (order-calc.ts) from the step data; the furthest step reached wins.

| From | To | How | Who |
|---|---|---|---|
| — | CONFIRMED | Order created (closing a quote or directly) | quotes.close / orders.create |
| CONFIRMED | DESIGNING | "Xác nhận đơn", needs design | orders.update |
| CONFIRMED | IN_PRODUCTION | "Xác nhận đơn", customer has print-ready files: work order created | orders.update |
| DESIGNING | DESIGN_FINALIZING | Customer approves the latest maket version | design.work |
| DESIGN_FINALIZING | DESIGNING | "Khách đổi ý" (reason required) | design.work |
| DESIGN_FINALIZING | IN_PRODUCTION | Lock design (print files marked finished): work order created | design.work |
| IN_PRODUCTION | DELIVERING | Workshop hands over (stage Xong), or **automatic** when a trip is delivered | production.update / system |
| DELIVERING | COMPLETED | Acceptance report signed; needs every line fully delivered | deliveries.accept |
| any open | CANCELLED | `cancelReason` required; scheduled deliveries are cancelled too | orders.cancel |

Payments never change order status. After acceptance, trips can no longer be reopened (`ORDER_ACCEPTED`).

### 6.2 Order lines and editing

1. An order needs at least one line with `quantity ≥ 1`.
2. A line's quantity can be changed later but never below its `plannedQty`. To reduce it further, first reduce or cancel the planned trips.
3. A line can be removed only if it has no delivery lines.
4. Prices are optional per line. `lineTotalVnd = quantity × unitPriceVnd`. `Order.totalVnd` is the sum of priced lines, or `null` if no line has a price.

### 6.3 Deliveries

1. **Plan at creation.** `POST /orders` accepts a `deliveries` array. Each trip has `plannedDate`, optional `address`, and `lines[]` of `{ orderLineIndex, plannedQty }`. Trips can also be added, edited or cancelled later.
2. **No over-planning.** For each order line, the sum of `plannedQty` on SCHEDULED trips plus `deliveredQty` on DELIVERED trips must be ≤ `quantity`.
3. **Not yet planned.** `quantity − OrderLine.plannedQty`. Shown on the order and on the board card when > 0. Not an error: an order can be created with no plan at all.
4. **Mark delivered.** Each line's `deliveredQty` defaults to `plannedQty` and can be lowered, never raised above it. Sets `deliveredAt`, optional `receiverName`.
5. **Short delivery.** If `deliveredQty < plannedQty`, the difference becomes "not yet planned" again. Nothing else changes automatically; staff add it to another trip.
6. **Reopen.** Accounts with `deliveries.reopen` can reopen a DELIVERED trip back to SCHEDULED (with a reason) to fix a mistake. Cached quantities and order status are recalculated.
7. **Cancel.** Only SCHEDULED trips can be cancelled (reason required). Their planned quantity returns to "not yet planned".
8. **Editing.** SCHEDULED trips can be edited freely within rule 2. DELIVERED trips are read-only except via reopen.
9. All cached fields (`OrderLine.plannedQty`, `OrderLine.deliveredQty`, `Order.status`) are recalculated in the same database transaction as the change.

### 6.4 Payments

1. Optional. An order with no prices can still have payments, and an order with prices can have none.
2. `orderId` is required. `deliveryId` is optional and must belong to the same order.
3. `amountVnd > 0`. Refunds are not in v1 (open question).
4. Payments are voided with a reason, never deleted. `Order.paidVnd` is recalculated in the same transaction.
5. Balance = `totalVnd − paidVnd`, shown only when `totalVnd` is set.
6. Delivery value (for display) = Σ `deliveredQty × unitPriceVnd` over its lines, ignoring unpriced lines.
7. Payment badge on orders: **Unpaid** (paid = 0), **Partly paid** (0 < paid < total), **Paid** (paid ≥ total), nothing when total is null.

### 6.5 Document codes

`PREFIX-YYMM-NNNN`, restarting each month: `DH-2610-0042` (order), `GH-2610-0011` (delivery). Customers: `KH-0001`. Generated inside the transaction with `UPDATE … RETURNING` on `DocumentSequence`, so concurrent saves never collide.

### 6.6 Activity log

One row for every order status change, delivery planned / delivered / reopened / cancelled, and payment recorded / voided. Shown as a timeline on the order detail page.

---

## 7. Accounts, sign-in and permissions

**Sign-in.** Username + password. Passwords are hashed with scrypt (N=16384, r=8, p=1, 16-byte salt). A successful login creates a
`Session` row and sets the cookie `crm_session` (HttpOnly, SameSite=Lax, Secure in production) holding a random 32-byte token;
only its SHA-256 is stored. Sessions last `SESSION_DAYS` (30) and extend on use. Logout, locking an account and password resets
revoke sessions immediately.

**Protection.** 5 wrong passwords for one username (or 30 failures from one IP) within 15 minutes → `429 LOGIN_LOCKED` for 15 minutes.
A missing username takes as long as a wrong password and returns the same error. Passwords: ≥ 8 characters, not containing the username.

**Accounts (Tài khoản).** Created by hand with username, full name, group and either a typed password or a generated temporary one
(shown once). New and reset accounts must change the password at next sign-in (`403 PASSWORD_CHANGE_REQUIRED` until then).
Rules: at least one active administrator with a password must remain; nobody can lock themselves or change their own group;
only administrators can grant the administrator group or touch administrator accounts.

**Permission groups (Nhóm quyền).** Each group holds permission keys `module.action`:

| Module | Actions |
|---|---|
| orders | view, create, update, cancel |
| deliveries | view, create, update, deliver, cancel, reopen |
| payments | view, create, void |
| money | view (without it, every `*Vnd` field and `paymentStatus` is removed from API responses) |
| customers | view, create, update |
| accounts | view, create, update, resetPassword |
| roles | view, manage |

Saving a group adds implied permissions (e.g. `payments.create` → `payments.view` → `orders.view`, `money.view`). The built-in group
"Quản trị viên" (`isSystem`) always has every permission and cannot be edited or deleted. A non-admin with `roles.manage` cannot edit
their own group. Groups in use cannot be deleted. Seed creates sample groups *Kinh doanh*, *Kế toán*, *Giao hàng*.

**Enforcement.** Every route declares `@RequirePermission(...)` or `@SignedIn()`; a route with neither is refused (fail-closed).
Rules inside actions: a deposit on a new order or money collected at delivery also needs `payments.create`; entering prices needs
`money.view`; editing lines without `money.view` keeps stored prices; order detail lists payments only with `payments.view`.

**Emergency access.** `npm run user:reset-admin -- <username>` (on the server) makes the account an active administrator with a new
temporary password.

## 8. API endpoints

Base path `/api/v1`. Lists accept `?page`, `?pageSize`, `?q`. Full contract: `api/openapi.json`, Swagger UI at `/api/v1/docs` in development.

### Sign-in, accounts, permission groups
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | /health | public | for Docker and uptime monitors |
| POST | /auth/login | public | sets the session cookie; returns account + permission keys |
| POST | /auth/logout | signed in | |
| GET | /auth/me | signed in | account, group, permission keys, mustChangePassword |
| POST | /auth/change-password | signed in | signs out other sessions |
| GET | /permissions | signed in | catalog of modules and actions with Vietnamese labels |
| GET | /accounts | accounts.view | |
| POST | /accounts | accounts.create | returns `temporaryPassword` once when generated |
| PATCH | /accounts/:id | accounts.update | details, group, `isActive` (lock/unlock) |
| POST | /accounts/:id/reset-password | accounts.resetPassword | new or generated password, signs the account out |
| POST | /accounts/:id/sign-out | accounts.update | end every session |
| GET | /roles | roles.view | groups with permissions and account count |
| POST / PATCH / DELETE | /roles[/:id] | roles.manage | |

### Customers
| Method | Path | Notes |
|---|---|---|
| GET | /customers | diacritic-insensitive `?q` |
| GET | /customers/lookup/:phone | exact match, 404 when none |
| POST | /customers | `409 PHONE_EXISTS` with the existing customer |
| GET / PATCH | /customers/:id | |
| GET | /orders?customerId= | order history (customer profile also returns counts and balance) |

### Orders
| Method | Path | Notes |
|---|---|---|
| GET | /orders | `?status`, `?customerId`, `?dueBefore`, `?hasUnplanned=true` |
| POST | /orders | customer, lines, optional `deliveries[]` plan |
| GET | /orders/:id | lines with planned / delivered / not-yet-planned qty, deliveries, payments, balance |
| GET | /orders/by-code/:code | find by DH- code |
| PATCH | /orders/:id | dates, note |
| PUT | /orders/:id/lines | replace lines (rules 6.2) |
| POST | /orders/:id/confirm | `needsDesign` (step 2) |
| POST | /orders/:id/cancel | `cancelReason` |
| GET | /orders/:id/activity | timeline |
| GET | /board | open quotes (quotes.view) + orders grouped by status with card fields; completed limited to last 14 days |

### Design, production, acceptance
| Method | Path | Notes |
|---|---|---|
| GET | /design-queue | `?mine=true`; state TODO / WAITING / CHANGES / FINAL |
| GET | /designers | active accounts with design.work |
| PATCH | /orders/:id/design | `designerId` (design.assign) |
| POST | /orders/:id/design/versions | `note?` — next version; refused while the last one waits for feedback |
| POST | /orders/:id/design/versions/:vid/feedback | `approved`, `note?`, `channel?`, `approvedByName?` |
| PATCH | /orders/:id/design/approval | `channel?`, `approvedByName?`, `finalized?` |
| POST | /orders/:id/design/unapprove | `reason` |
| POST | /orders/:id/design/lock | needs `finalized`; creates the work order |
| GET | /production | work orders in the workshop (no prices) |
| PATCH | /orders/:id/production | `dueDate?`, `priority?` (NORMAL / URGENT), `note?` |
| POST | /orders/:id/production/advance | `stage?` — next stage by default |
| POST | /orders/:id/production/handover | stage must be DONE |
| POST | /orders/:id/accept | `signedBy`, `note?` — every line fully delivered (deliveries.accept) |

### Documents (PDF)
| Method | Path | Notes |
|---|---|---|
| GET | /documents/:kind/:id | kind = quote (quote id) · order · design · lsx · acceptance · invoice (order id). Inline; `?download=true` saves the file. `DOCUMENT_NOT_AVAILABLE` before the step exists; priced kinds need money.view |
| GET | /orders/:id/documents/zip | `?kinds=order,invoice…` (default all available), includes the quote |
| GET | /customers/:id/documents | quotes and orders of the customer with their files |
| GET | /customers/:id/documents/zip | `?kinds=…`, one folder per order / quote |

### Deliveries
| Method | Path | Notes |
|---|---|---|
| GET | /deliveries | `?status`, `?from`, `?to`, `?overdue=true` (scheduled before today), `?q` |
| GET | /deliveries/:id | |
| POST | /orders/:id/deliveries | add a trip to an existing order |
| PATCH | /deliveries/:id | SCHEDULED only: date, address, line quantities |
| POST | /deliveries/:id/deliver | body: `lines[{ orderLineId, deliveredQty }]`, `deliveredAt`, `receiverName?`, optional `payment { amountVnd, method }` recorded in the same transaction |
| POST | /deliveries/:id/reopen | deliveries.reopen, `reason` |
| POST | /deliveries/:id/cancel | `cancelReason` |

### Payments
| Method | Path | Notes |
|---|---|---|
| GET | /payments | receipts across orders: `?from`, `?to`, `?method`, `?q`, `?includeVoided`; returns `sumVnd` |
| GET | /receivables | orders still owing money, delivered first; delivered / upcoming balance, deposits held |
| GET | /orders/:id/payments | |
| POST | /orders/:id/payments | `amountVnd`, `method`, `paidOn`, `isDeposit?`, `deliveryId?` |
| POST | /payments/:id/void | payments.void, `reason` |

### Errors

```json
{
  "statusCode": 409,
  "code": "PLANNED_QTY_EXCEEDS_ORDER",
  "message": "Decal PP 30×40 cm: planned 220, ordered 200.",
  "details": { "orderLineId": "…", "planned": 220, "ordered": 200 }
}
```

Stable `code` values, translated to Vietnamese in the web app.

---

## 9. Web app

### 9.1 Pages

| Route | Page | What it does |
|---|---|---|
| `/login` | Login | |
| `/board` (home) | Bảng điều phối | KPIs, then one column per step: 1 Báo giá (open quotes), 2 Chốt đơn, 3 Thiết kế, 4 Hoàn thiện TK, 5 Sản xuất, 6 Giao hàng (with orders completed in the last 14 days). Money filter (chưa cọc / đã cọc / còn nợ / đã thanh toán) for accounts that see prices. |
| `/design` | Việc thiết kế | Orders in steps 3–4 by state (chưa gửi, chờ khách, cần sửa, hoàn thiện), "only mine" |
| `/production` | Sản xuất | Kanban of work orders by stage, next-stage button, print work order |
| `/payments` | Thanh toán & công nợ | KPIs; Công nợ (orders owing, delivered first, record payment, print invoice); Khoản thu (receipts by date range and method) |
| `/orders` | Orders | Table with filters; "New order" opens the order form |
| `/orders/new` · `/orders/:id` | Order detail | 6-step stepper with the panel of each step (confirm, design versions and approval, work order, acceptance), print menu, then tabs: **Order** (customer, lines, prices), **Deliveries** (plan, planned vs delivered per line, add trip, mark delivered), **Payments** (record, list, balance), **History** (activity timeline). Status action buttons in the header. |
| `/deliveries` | Delivery schedule | Tabs: Today, Upcoming, Overdue, Delivered. "Mark delivered" opens the delivery modal. |
| `/customers` · `/customers/:id` | Customers | List and profile with order history and balance |
| `/login` | Sign-in (shown whenever nobody is signed in; forced password change after a temporary password) |
| `/accounts` | Tài khoản: create by hand, edit, group, reset password, lock, sign out everywhere |
| `/roles` | Nhóm quyền: module × action matrix |
| `/` | Chọn module: cards for CRM, Kế toán, Quản trị (only those the account can use) |
| `/accounting` | Tổng quan & khoá sổ: balances (111, 112, 131, 331, 152, profit), the 5 month-end steps with run buttons, close; orders in production with no material issued |
| `/accounting/periods` | Kỳ kế toán: months, results, reopen (with reason), opening balances and opening stock of the first month, closing log |
| `/accounting/cash` | Thu – chi: cash and bank book, expense voucher (by category or paying a supplier), expense categories and their split |
| `/accounting/debts` | Phải thu – phải trả: 131 by customer (oldest unpaid, > 30 days), 331 by supplier |
| `/accounting/stock` | Kho NVL: stock by material, receipts PN, issues PX, materials, suppliers |
| `/accounting/assets` | TSCĐ & CCDC: register, monthly charge, charged so far |
| `/accounting/tax` | Thuế GTGT: output, input, carried in, payable or carried forward |
| `/accounting/journal` | Sổ & bút toán: general journal (filter auto / manual / month-end), trial balance, manual entry PKT, edit an automatic entry with a reason |
| `/accounting/reports` | Báo cáo: P&L for 6 months + year to date, general ledger per account |

Every accounting screen keeps the month in the address (`?ky=2026-10`); it defaults to the earliest open month.

### 9.2 Board card

```
DH-2610-0042                    Due 05/11
Công ty ABC
Decal + banner · 2 trips
Delivered 1/2 trips · next 04/11
[Partly paid]   [20 not yet planned]
```

Clicking a card opens the order detail.

### 9.3 Order form with delivery plan

1. Pick or create the customer (`CustomerSelect` searches by name or phone).
2. Add lines: description, spec, quantity, unit price (optional).
3. **Delivery plan** (`DeliveryPlanEditor`): "Add trip" → date, address, quantity per line. Under the editor, a row per line shows *ordered / planned / not yet planned*, turning orange when something is unplanned and red if over-planned.
4. Optional deposit: amount and method.
5. Save → one `POST /orders` call.

### 9.4 Mark delivered modal

- One row per line in the trip: planned qty (read-only), delivered qty (defaults to planned).
- Receiver name, delivered date and time.
- **Amount collected** (optional) and method, prefilled with the trip's value when prices exist. Saved as a payment linked to this trip.
- If delivered < planned, a notice: "20 decals will return to not yet planned."

### 9.5 Refreshing data

- TanStack Query refetches when a page opens and when the browser tab regains focus.
- Every action (deliver, cancel, record payment) invalidates the affected order, board and delivery queries, so the screen you are on is always current.
- No sockets, no polling.

### 9.6 Conventions

- Types generated from the API (`npm run api:types`); no hand-written DTO types.
- Money shown as `2.500.000 đ` via `Intl.NumberFormat("vi-VN")`; inputs use integer `InputNumber` with thousand separators.
- One status map in `lib/status.ts` for labels and `Tag` colors.
- `ConfigProvider locale={vi_VN}`, dayjs `vi`, Be Vietnam Pro font.

---

## 10. Local development and deployment

- Local setup and commands: `README.md`
- Production on one server with Cloudflare Tunnel + Access, backups, updates, user management: `DEPLOY.md`

## 11. Build plan

| Milestone | Backend | Web | Done when | Status |
|---|---|---|---|---|
| **M0 — Foundation** | Scaffold, config, Prisma, Cloudflare Access auth, users, roles, error format, Swagger, numbering, activity log | Vite + Ant Design scaffold, `vi_VN`, generated client, login, layout, users page | Owner logs in and creates a staff account | Done |
| **M1 — Orders** | Customers, orders with lines and delivery plan, quantity rules, start production, cancel | Customers pages, order form with `DeliveryPlanEditor`, order detail (Order + Deliveries tabs) | The DH-2610-0042 example can be entered in the browser | Done |
| **M2 — Deliveries & payments** | Mark delivered (with optional payment), short delivery, reopen, cancel trip, payments, void, balances, auto status | Delivery schedule page, mark delivered modal, Payments tab, History tab | Example and short-delivery variant both reach Completed in a Playwright test | Done |
| **M3 — Board** | Board query | Board page, cards, filters, refresh | Every order is visible on the board in the right column | Done |
| **M4 — Ship it** | Health check, Dockerfiles, Caddy, Cloudflare Tunnel, nightly backups | Empty/loading/error states, Vietnamese error messages | Runs on a fresh VPS from the README | Deployment files done; first real deploy pending |

**ERP phases (6-step process, agreed with the prototype on 30 Oct 2026):**

| Phase | Scope | Status |
|---|---|---|
| **P1 — Quote → order** | Product catalog, quotes (per m² / per unit), send, lost / reopen, close into an order, swap products on the order with change log and diff against the quote | Built 30 Oct 2026 |
| **P2 — Design** | "Cần thiết kế / khách có file sẵn", designer, maket versions v1, v2… with customer feedback, approval (who, when, channel), lock | Built 31 Oct 2026 |
| **P3 — Production** | Work order LSX per order, workshop stages Nhận → In → Gia công → Kiểm tra → Xong, production screen | Built 31 Oct 2026 |
| **P4 — Delivery & acceptance** | Existing trips + acceptance with a signed handover report, 6-column board, payments & receivables page | Built 31 Oct 2026 |
| **P5 — Documents** | Server-side PDF for quote, order, design approval, work order, acceptance report, internal invoice (temporary layout); download icons in lists, zip per order and per customer | Temporary layout built; company templates pending |
| **P6 — Modules & accounting** | Module picker and module-scoped menus; accounting module (section 13) | Built 05 Nov 2026 |
| **Later** | File uploads, notifications, e-invoice integration if needed | |

Section 6 rules for quotes:
- Lines from the catalog are priced on the server. AREA products need width and height (0–100 m); one piece = round(width × height × price per m²) and the line total = pieces × piece price. UNIT products use their unit price. A list price can be overridden on the line.
- Quotes can be edited while DRAFT or SENT. LOST quotes must be reopened first; WON quotes are read-only (changes are made on the order).
- Closing creates the order (DH code, same lines, each order line remembers its quote line). Editing order lines logs every change (`LINES_CHANGED` with the list of changes) and `GET /orders/:id` returns `quote.changes`: CHANGED (product/size, quantity, price), ADDED, REMOVED.
- Changing a catalog price never changes existing quotes or orders.

---

## 12. Open questions

1. **Driver collection.** Does the driver usually collect money at delivery? If yes, "Amount collected" is shown prominently in the mark delivered modal; if not, it stays a small optional field. (Spec currently: visible, optional.)
2. **VAT.** Are line prices entered with VAT included, or should the order add VAT on top?
3. **Phone as unique key.** Can two customers share a phone number (e.g. two companies, one contact person)?
4. ~~**Roles.**~~ Decided 29 Oct 2026 (D10): permission groups per module × action; drivers get a "Giao hàng" group.
5. **Refunds.** Needed in v1, or handled outside the app?
6. **Completed orders on the board.** Keep the last 14 days visible, or a different window?
7. **Language.** Vietnamese only, or a Vietnamese/English toggle?

---

## 13. Accounting module

Internal books following Thông tư 133. Revenue is recognised when the customer signs acceptance; no e-invoice; VAT 8% by default (0/5/8/10 on purchases and expenses). Profit is worked out at month end.

### 13.1 Model
- Chart of accounts `LedgerAccount` (111, 112, 131, 1331, 152, 154, 211, 214, 242, 331, 33311, 411, 421, 511, 632, 6421, 6422, 911 …). Balances are debit-positive.
- `AccountingPeriod` per month "YYYY-MM": OPEN / CLOSED, the time each month-end step ran, who closed it and the saved results (revenue, COGS, selling, admin, other).
- `PeriodOpening` (account balances at the start of a month) and `MaterialOpening` (qty and unit cost per material). The first month's are typed in; later months are carried by closing.
- `JournalEntry` / `JournalLine` (double entry). `(sourceType, sourceId)` is unique, so a document posts once. An automatic entry changed by hand keeps its original lines, reason and editor.
- Vouchers: `StockReceipt` PN, `StockIssue` PX, `CashPayment` PC, `FixedAsset` TS-/CC-, manual entries PKT. `Supplier` NCC-0001, `Material`, `ExpenseCategory` with its split over 154 / 6421 / 6422.

### 13.2 Postings
| Source | Entry |
|---|---|
| CRM payment | PT: Dr 111 (cash) / 112 (bank transfer), Cr 131 |
| Payment voided | PT removed while its month is open; otherwise reversal `PT-…-H` in the current open month |
| Order accepted (with prices) | DT-YYMM-NNNN: Dr 131 total + 8%, Cr 511, Cr 33311 |
| Stock receipt | Dr 152 (+ Dr 1331), Cr 111 / 112 / 331 |
| Stock issue | Dr 154 / Cr 152 at the provisional average; re-valued at month end. Issue for an order = work in progress of that order; issue without an order = production overhead |
| Expense voucher | Dr 154 / 6421 / 6422 by the category split (+ Dr 1331), Cr 111 / 112 |
| Paying a supplier | Dr 331, Cr 111 / 112 |
| Asset bought | Dr 211 (asset) or 242 (tool) (+ 1331), Cr 111 / 112 / 331. Assets owned before the books started post nothing (they are in the openings) |
| Manual entry | PKT, any balanced lines |

CRM documents are brought into the books automatically before every accounting read and write (idempotent, one database lock). A CRM document dated in a closed month goes to the first open month, with a note. Documents dated before the first month are part of the opening balances and are not posted. Accounting vouchers must be dated in an open month (`PERIOD_CLOSED`).

### 13.3 Month end
Run in order (each needs the earlier months closed and the openings balanced):
1. **Price** — monthly weighted average per material `(opening value + received value) / (opening qty + received qty)`; re-values this month's issues; posts cost of goods GV (Dr 632 / Cr 154) for orders accepted this month (everything ever issued to them) and for material issued this month to orders accepted earlier.
2. **Depreciation** KH-YYMM — straight line, Dr 154 / 6421 / 6422, Cr 214 (the last month takes the rounding difference).
3. **Allocation** PB-YYMM — tools, Dr cost account, Cr 242.
4. **VAT offset** KT-YYMM — Dr 33311 / Cr 1331 for min(output, input incl. carried in).
5. **Transfer** — KC-01 production overhead (154 other than issues for orders) → 632; KC-02 revenue → 911; KC-03 expenses → 911; KC-04 profit / loss → 421.

Any posting that changes the month's figures (everything except customer receipts and supplier payments) deletes the month-end entries and resets the steps. **Close** needs all 5 steps, saves the results and carries closing balances and stock (qty, average cost) into the next month. **Reopen** (permission accounting.reopen, reason required) is allowed for the latest closed month only.

### 13.4 Permissions
`accounting.view` (implies money.view), `accounting.post` (vouchers, catalogs), `accounting.close` (start the books, openings, expense categories, month-end steps, close, edit automatic entries), `accounting.reopen`. The default "Kế toán" group has view, post and close.

### 13.5 API (`/api/v1/accounting`)
| Method | Path | Notes |
|---|---|---|
| GET | /accounts | chart of accounts |
| GET | /periods | periods (newest first) and the closing log |
| POST | /periods/start | `{ month }`, once |
| GET | /periods/:id/overview · journal · cash?account= · debts · stock · tax · assets · ledger?account= | read models of one month |
| POST | /periods/:id/steps/:step | step = price, depreciation, allocation, vat, transfer |
| POST | /periods/:id/close · /periods/:id/reopen | reopen takes `{ reason }` |
| GET | /reports/pnl | last 6 months + year to date |
| GET / PUT | /openings · PUT /openings/stock | first month only, while it is open |
| GET / POST / PUT | /suppliers · /materials · POST/PUT /categories | catalogs |
| POST | /receipts · /issues · /cash-payments · /assets · /entries | vouchers |
| PUT | /entries/:id | manual entry, or automatic entry with `reason` |
| DELETE | /entries/:id · /receipts/:id · /issues/:id · /assets/:id | voucher and its entry; CRM and month-end entries can't be deleted |

## 14. Facebook fanpage chat

Phase 3 of the channel design (Messenger + comments). Lead ads, Zalo OA, lead records and source reports come later on the same tables.

### 14.1 Flow
1. Meta calls `POST /api/v1/webhooks/facebook`. The API checks `X-Hub-Signature-256` (HMAC-SHA256 of the raw body with `FB_APP_SECRET`), stores each `entry` as a `WebhookEvent` and answers 200 at once. `GET` on the same path answers Meta's verify-token handshake (`FB_VERIFY_TOKEN`).
2. An in-process worker claims due events (`FOR UPDATE SKIP LOCKED`, sorted by arrival so messages keep their order), every 5 s and right after each webhook call. Failures wait 30 s, 2 min, 10 min, 30 min; the 5th failure marks the event failed and writes the error on the channel. "Chạy lại" puts failed events back.
3. Each Messenger message or comment becomes a `Message` (deduplicated by its Facebook id) in a `Conversation` of a `ChannelContact` (one person on one page; name and picture from the Graph API). Echoes of messages the CRM sent carry `metadata = inauviet-erp` and are skipped; messages typed in Meta Business Suite are stored as `outsideCrm`. Images and files are downloaded to `CHAT_FILES_DIR` (Facebook links expire).
4. Staff answer from the CRM: Messenger Send API with `messaging_type RESPONSE` within 24 h of the customer's last message, `MESSAGE_TAG / HUMAN_AGENT` until day 7, refused after that (`REPLY_WINDOW_CLOSED`). Comments: public reply under the customer's latest comment, or one private reply (`recipient.comment_id`) within 7 days. A refusal from Facebook is stored as a FAILED message with a Vietnamese reason; error 190 also marks the channel ERROR.

### 14.2 Model
| Table | Holds |
|---|---|
| `ChannelAccount` | platform, page id, name, picture, page token (encrypted), status ACTIVE / ERROR / DISCONNECTED, last event, last error, who connected |
| `WebhookEvent` | raw entry, attempts, next attempt, lock, processed / failed time, last error |
| `ChannelContact` | page, PSID or user id (unique per page), name, avatar, first phone number written, linked `Customer` |
| `Conversation` | kind MESSAGE / COMMENT, thread key (`m`, or `c:<postId>` per commenter and post), post link, assignee, OPEN / DONE, last message preview / time / direction, last inbound time, unread count, private reply used |
| `Message` | direction IN / OUT, Facebook id (unique), type, text, attachments JSON, sender (staff), outsideCrm, privateReply, status RECEIVED / SENDING / SENT / FAILED, error |

### 14.3 Rules
- Visibility: with `conversations.viewAll` everything; otherwise conversations assigned to me plus unassigned ones (so new chats can be picked up before round-robin assignment exists).
- Replying to an unassigned conversation assigns it to the sender. Taking an unassigned one needs `reply`; any other change of assignee needs `assign`. A returning contact goes to the person who handled them last.
- A new inbound message reopens a DONE conversation and increments its unread count; opening the conversation marks it read.
- The first Vietnamese phone number in an inbound message is kept on the contact; "Tạo khách mới" pre-fills it. "Lập báo giá" opens `/quotes/new?customerId=`.

### 14.4 Endpoints
`GET/POST /webhooks/facebook` (public, signed) · `GET /channels` · `POST /channels/facebook/pages` (preview, token not stored) · `POST /channels/facebook/connect` · `POST /channels/:id/check` · `DELETE /channels/:id` · `POST /channels/events/retry` · `GET /conversations` (filter all / mine / unassigned / waiting, status, kind, channel, q, before) · `GET /conversations/unread` · `GET /conversations/assignees` · `GET /conversations/stream` (SSE) · `GET /conversations/:id` · `GET /conversations/:id/messages?before=` · `POST /conversations/:id/messages` · `POST /conversations/:id/files` (multipart, 25 MB) · `POST /conversations/:id/read` · `PATCH /conversations/:id` · `PUT /conversations/:id/customer` · `GET /conversations/:id/messages/:messageId/files/:index`.

### 14.5 Configuration
`CHANNEL_SECRET_KEY` (64 hex), `FB_APP_SECRET`, `FB_VERIFY_TOKEN`, `FB_GRAPH_VERSION` (default v24.0), `FB_GRAPH_URL` (tests point it at a fake), `CHAT_FILES_DIR`, `CHANNEL_WORKER` (off in tests). The reverse proxy must not compress or buffer `/api/v1/conversations/stream`.

## 15. Kho (warehouse) module

Separate module for the storekeeper. Customer names and order numbers are typed as text; nothing joins to CRM or accounting tables, so the accounting "Kho NVL" screen and this module do not affect each other.

### 15.1 Model
| Table | Holds |
|---|---|
| `WhPartner` | die makers, die-cutting shops, paper suppliers (kind DIE_MAKER / DIE_SHOP / SUPPLIER / OTHER) |
| `WhLocation` | shelf codes (e.g. `T4-K02-O03`) |
| `WhMaterial` · `WhStockItem` | material (group, name, unit, by size or not) and one stock item per size (width × length cm, unique per material); `qty` is the cached on-hand quantity (Decimal), `minQty` the alert level. A material without sizes has one 0 × 0 item |
| `WhSlip` · `WhSlipLine` | NK receipt, XK issue, NL return, DC adjustment (monthly numbering); partner, receiver, purpose, typed reference, optional unit price; voided slips keep their lines |
| `WhCount` · `WhCountLine` | stock count (KKV-): system qty frozen at creation, counted qty, DRAFT / APPROVED / CANCELLED |
| `WhMonthLock` | months locked for slips |
| `WhDieSymbol` | symbol (TUI, HOP, KEF…) and last number used |
| `WhDie` | code `SYMBOL-NNN` (assigned once, never reused), kind, product, customer text, length / width / height cm or size text, orientation, pieces, ups, maker, owner, cost, photo, **status** and **place** kept apart: `holderId` = partner holding it (null = Âu Việt), `locationId` = shelf at home; expected back date, needs-review flag and note |
| `WhDieMove` | every step: action, date, from / to status, place text, partner, shelf, reference, expected back, note, batch, user |
| `WhDieBatch` | hand-over slip GN- (OUT to a shop / IN back to the store) |
| `WhDieCount` · `WhDieCountLine` | die count of one shelf, the whole store or one shop: found / extra |

### 15.2 Rules
- Stock never goes negative: an issue decrements with `UPDATE … WHERE qty >= n` and fails with `WH_STOCK_SHORT` (item, on hand, requested). Voiding a receipt that was already used fails with `WH_VOID_NEGATIVE`. Adjustment slips from counts cannot be voided.
- Slips dated in a locked month cannot be created or voided (`WH_MONTH_LOCKED`). Approving a count needs `warehouse.manage` and writes one DC slip for the differences against the current quantity (uncounted lines unchanged).
- A size that already has slips cannot change its numbers (`WH_SIZE_IN_USE`); add a new size and switch the old one off.
- Die life cycle (`api/src/warehouse/die-rules.ts`):

| Action | From | To | Place |
|---|---|---|---|
| ISSUE xuất khuôn | READY | IN_USE | partner (or stays home for Âu Việt's own machine) |
| KEEP xưởng giữ lại | IN_USE | READY | stays at partner |
| RETURN nhập lại kho | IN_USE, READY | CHECKING | home |
| PASS kiểm đạt | CHECKING | READY | home, shelf required |
| DEFECT lỗi / hỏng | CHECKING, READY, IN_USE | DEFECT or BROKEN | unchanged |
| SEND_REPAIR | DEFECT, CHECKING | REPAIRING | partner required |
| BACK_REPAIR | REPAIRING | CHECKING | home |
| DISPOSE | READY, DEFECT, BROKEN, CHECKING | DISPOSED | unchanged |
| MOVE đổi vị trí | READY | READY | other shelf, or kept at a partner |

  Anything else is refused with `WH_DIE_ACTION_NOT_ALLOWED`. "Overdue" = IN_USE / REPAIRING with an expected back date before today.
- New die: code from the symbol counter inside the transaction. If a die with the same symbol is within 0.5 cm on each measured side, creation is refused with `WH_DIE_SIMILAR_EXISTS` (details list the similar dies) unless `force`. A new die goes to CHECKING at home, or READY when a shelf or a partner is chosen.
- A batch applies ISSUE (OUT) or RETURN (IN) to every die in one transaction: all or nothing.
- Finishing a die count marks every die not found as needs-review; a die found on the counted shelf that the books placed elsewhere is moved there (MOVE).

### 15.3 Excel import
`POST /warehouse/dies/import?dryRun=true|false` (multipart `file`, `warehouse.manage`). Reads sheet `DANH_SACH_KHUON` (header row "Mã khuôn") with a dependency-free xlsx reader; `NHAP_LIEU` rows other than "TẠO KHUÔN" become history moves. Mapping: TRONG KHO → READY at home (shelf from "Vị trí kệ"); ĐANG SẢN XUẤT at a shop → IN_USE there, expected back from the sheet; other states, "Khác", same size as another die (same symbol, all sides equal), no TẠO KHUÔN row, or out more than 45 days → needs-review with the reason. "Nơi ra khuôn" names used on 3+ rows become partners, others stay in the note. Existing codes are skipped, so running it again adds nothing; symbol counters move past the highest number imported. On the current file: 440 dies (371 READY, 69 IN_USE), 4 partners, 1 shelf, 126 points to review. The same import runs from the command line: `npm run kho:import -- [file.xlsx] [--write]` (default file `api/data/khuon.xlsx`, preview unless `--write`).

### 15.4 Endpoints (`/api/v1/warehouse`)
`GET overview` · `GET/POST/PUT partners` · `GET/POST/PUT locations` · `GET/PUT symbols` · `GET/POST/PUT materials` · `GET/POST/DELETE month-locks` · `GET stock?all=` · `GET stock/:id/card` · `GET/POST slips` · `GET slips/:id` · `POST slips/:id/void` · `GET/POST counts` · `GET/PUT counts/:id` · `POST counts/:id/approve|cancel` · `GET dies` (q, status, symbol, place = home | partner id, flag = overdue | review | out, l / w / h / tol) · `GET/PUT dies/:id` · `POST dies` · `POST dies/:id/actions` · `POST/GET dies/:id/photo` · `POST dies/import` · `GET/POST batches` · `GET batches/:id` · `GET/POST die-counts` · `GET die-counts/:id` · `POST die-counts/:id/marks|finish`.

Photos are stored next to chat files (`<CHAT_FILES_DIR>/../warehouse`). The user guide is a static page in `web/public/huong-dan/` (served at `/huong-dan/index.html`, opened from the "Hướng dẫn" button in the header, which jumps to the chapter of the current module). Paper stock has no file to import yet: the first stock count enters opening quantities.

### 15.5 Multi-warehouse model (v0.11, migration `20261119090000_warehouses`)

| Table | Holds |
|---|---|
| `WhWarehouse` | code (in slip numbers), name, address, kind STOCK / DIE, active, sort order |
| `WhWarehouseMember` | storekeepers of a warehouse |
| `WhMaterial` | shared catalog: optional code, group, name, **base unit**, has sizes |
| `WhSpec` | quy cách of a material (width × length cm; length 0 = roll width only; 0 × 0 = no sizes) |
| `WhUnit` | other units: 1 unit = `factor` base units; `specId` set = factor for that spec only (spec-specific wins over material-wide of the same name) |
| `WhWarehouseMaterial` | which warehouses hold a material |
| `WhStock` | on-hand qty (base unit) and min qty per warehouse × spec; created for every linked warehouse × spec |
| `WhSlip` / `WhSlipLine` | + `warehouseId`, `status`, `confirmedAt/By`, `rejectReason`, `transferId`; lines keep base `qty` plus `unitName`, `unitQty`, `factor` at the time of the slip |
| `WhCount` | + `warehouseId`; lines per spec |
| `WhMonthLock` | per warehouse (PK warehouseId + month) |
| `WhDailyStock` | end-of-day snapshot: date × warehouse × spec → qty |

Rules:
- **Confirmation.** A slip is created PENDING (no stock change). The storekeepers of its warehouse confirm or reject it; admins always can; a warehouse without storekeepers lets anyone with `warehouse.slip` confirm. `confirm: true` on create confirms straight away when the creator may. Confirming claims the slip with `UPDATE … WHERE status = 'PENDING'` before moving stock, so a double click cannot apply it twice. Short stock is refused at confirmation (`WH_STOCK_SHORT`). The creator (or a storekeeper) can cancel a pending slip; only a storekeeper can void a confirmed one.
- **Transfers** (`POST /warehouse/transfers`): TRANSFER_OUT in A and TRANSFER_IN in B with one `transferId`, numbered `CK-<A>-…` and `CK-<B>-…`. The destination is linked to the material automatically. B can confirm only after A confirmed (`WH_TRANSFER_NOT_SENT`). Before A confirms, rejecting / cancelling either side closes both; afterwards only voiding (by A's storekeeper) reverses both sides.
- **Units.** Each line is converted to the base unit (`qty × factor`, 3 decimals) at creation; the factor is stored so later catalog changes do not alter history. Receipt prices are per the unit used; the average price per base unit is `Σ(qty × price / factor) / Σ qty`.
- **Counts** are per warehouse (one open count each); approval by `warehouse.manage` or that warehouse's storekeeper creates a CONFIRMED adjustment slip.
- **Reports.** Ledger = confirmed, non-void slip lines by slip date; signed −qty for ISSUE / TRANSFER_OUT. `GET reports/stock?warehouseId&from&to` → opening, in, out, closing per spec. `GET reports/as-of?warehouseId&date` → snapshot qty when one exists for that day (else the ledger), plus `liveQty` from the ledger.
- **Snapshots.** `WhSnapshotService` runs hourly (off in tests; `WH_SNAPSHOT_TIMER` overrides) and writes every finished day not yet stored, per warehouse, back to the first slip (max 370 days); `POST snapshots/run` does it on demand. Snapshots are never rewritten.

Endpoints added: `GET/POST/PUT warehouses`, `GET people`, `PUT stock/:id` (min qty), `POST transfers`, `POST slips/:id/confirm|reject|cancel`, `GET reports/stock`, `GET reports/as-of`, `POST snapshots/run`; `stock`, `slips`, `counts`, `month-locks` take `warehouseId`; `DELETE month-locks/:warehouseId/:month`.

### 15.6 Dies across warehouses (v0.12, migration `20261120090000_die_transfers`)

| Change | |
|---|---|
| `WhWarehouse` | seeded XUANDINH (kind DIE); KHUON renamed "Kho khuôn Âu Việt". Dies held by the old partner "Xuân Đỉnh" moved into it (IN_USE → READY), partner deactivated. Missing workshops seeded (A.Kiên Trương Định, Em Hòa, Khoa Nhật Minh, Mê Linh). |
| `WhLocation` | + `warehouseId`; code unique per warehouse |
| `WhDie` | + `warehouseId` (managing warehouse; the die is there when `holderId` is null), `pendingBatchId`; statuses + `TRANSIT`, `INCOMING` |
| `WhDieBatch` | from / to (`fromWarehouseId` / `fromPartnerId`, `toWarehouseId` / `toPartnerId`), `toLocationId`, `controlWarehouseId`, `status` OPEN / DONE / REJECTED / CANCELLED, `outState` / `inState` PENDING / OK / NONE, `outBy/At`, `inBy/At`, `isNew`, `expectedBackOn`, `rejectReason`; old `kind` / `partnerId` kept nullable for history |
| `WhDieBatchItem` | dies on a transfer (back-filled from old batch moves) |
| `WhDieMove` | + `fromPlace`; actions + REQUEST, SEND, RECEIVE, REJECT, REUSE, COUNT |
| `WhDieCount` | + `warehouseId` |

Rules:
- **Moves need a transfer.** Kho → workshop: the sending warehouse's storekeeper confirms (`send`); the die arrives at once (IN_USE with a reference, REPAIRING if it was DEFECT, else READY = kept). Workshop → kho: no send step; the receiving storekeeper confirms (`receive`), the die becomes CHECKING. Kho → kho: send (die TRANSIT, no reject any more), then receive (status before sending is kept). Workshop → workshop: the storekeeper of the die's managing warehouse confirms as the send step. A warehouse without storekeepers lets anyone with `warehouse.dies` confirm; admins always can. Claims use `UPDATE … WHERE state = 'PENDING'`.
- A die is on at most one open transfer (`WH_DIE_PENDING`) and must be at the "from" place (`WH_DIE_NOT_HERE`). Before the dies leave, a storekeeper on the transfer can reject (reason required) and the creator can cancel; the dies stay put.
- **New dies** require a destination (`WH_DIE_DEST_REQUIRED`): created INCOMING with an `isNew` transfer from the maker; rejecting it deletes the die. Uncoded dies can be added to a transfer from a warehouse (`newDies`): coded on the spot, `needsReview`.
- **In-place actions** (no transfer): REUSE (new order at the workshop holding the die, reference required), KEEP, DEFECT anywhere; PASS, MOVE (shelf in the same warehouse), DISPOSE in a warehouse by its storekeeper.
- **Search:** `q` like `24x24x12.5` matches dies whose dimensions each fall within ±0.5 cm in any order (`sizeQuery` / `sizeMatches`). `place` = `k:<warehouse>` / `x:<partner>` / `transit`.
- **Journal:** `GET die-journal?from&to&action&place&userId` lists moves by date with from → to, reference, user and transfer.

Endpoints: `GET batches?tab=mine|open|all`, `GET batches/:id`, `POST batches`, `POST batches/:id/send|receive|reject|cancel`, `GET die-journal`; `POST dies` takes `toWarehouseId` / `toPartnerId`, `toLocationId`, `reference`, `confirm`; `POST dies/:id/actions` accepts only the in-place actions; `POST die-counts` takes `warehouseId`; `POST/PUT locations` require `warehouseId`.

**Paper stock import** (`POST materials/import-paper?dryRun`, CLI `npm run kho:giay -- file.xlsx --write`): reads the sheet whose header row has "Loại giấy" (columns Mã VT, Khổ giấy, TỒN, Ghi chú; "TỒN" may sit in the row above). Creates materials in Kho giấy (unit tờ, material code = Mã VT exactly as written, e.g. DC, GN, Op, C150, Ivory — shared by many materials, so WhMaterial.code is not unique; group from Mã VT: DC → Đề can, GN → Giấy ngoại, C<gsm> → Couche, else as written; names matched case-insensitively; materials made by earlier versions are reused and get the code), sizes, stock rows, then one PENDING adjustment slip (DC-GIAY-…) whose lines are sheet − confirmed stock. Rows without a quantity create the size only. Re-running creates nothing new; a previous import slip still pending is cancelled and replaced.


### Catalog pickers accept new names (v0.14)

Warehouse forms let the user pick an existing catalog entry or type a new one. The client sends the typed text in a `…Name` / `…Code` field next to the id; the server finds the entry case- and space-insensitively (reactivating it if inactive) or creates it, inside the same request, so the person filing the slip needs no catalog permission:

- receipt slip `partnerName` → partner kind SUPPLIER (shown as "Nơi lấy hàng nhập kho");
- new die `makerName` → DIE_MAKER, `toPartnerName` → DIE_SHOP, `toLocationCode` → shelf in the receiving die warehouse;
- transfer `toPartnerName` → DIE_SHOP, `toLocationCode`; receive and in-place actions `locationCode` → shelf in that warehouse.

An id always wins over a typed name. Warehouse slips no longer show unit prices (quantity and unit only); the API field stays optional for old data.


### Die process v2: direct moves (v0.15)

Replaces the keeper-confirmed die transfers.

- A die moves along its real route; going through a kho is never required. Every change of place is one **Chuyển khuôn** (a WhDieBatch created already DONE, one TRANSFER move per die). It takes effect immediately; anyone with `warehouse.dies` can do it. No keeper roles for dies.
- New die: the maker is required (picked or typed). The die is created at the maker with status MAKING. If a destination is given at creation, the die is moved there at once (maker → workshop or kho).
- Status after a move depends on the destination: workshop → IN_USE ("Ở xưởng"); kho from a workshop/maker → CHECKING (a new die with a shelf → READY); kho → kho keeps the status; maker → REPAIRING (MAKING stays MAKING).
- In-place actions: PASS, MOVE (shelf), DEFECT, DISPOSE. KEEP and REUSE are gone (a die at a workshop is just "Ở xưởng").
- No return dates or overdue tracking; the production order is an optional reference on a move.
- Old batches still OPEN can be confirmed or rejected by anyone with `warehouse.dies` ("Phiếu cũ còn chờ").
- Migration `20261122090000_die_direct_moves`: adds MAKING / TRANSFER, merges READY-at-workshop into IN_USE, clears expectedBackOn.


### Die process v3: make → inspect → cut (v0.16)

- Process: **tạo khuôn mới** (MAKING "Đang làm khuôn", at the maker) → **kiểm tra** in place: PASS → READY "Đạt, sẵn sàng", DEFECT → "Không đạt" (re-inspect after rework) → **bế khuôn**: move to a workshop, IN_USE "Đang bế". Separately **chuyển kho**: move to a kho (kho A → kho B, or back from a workshop / maker).
- New dies are always created at the maker; the create form has no destination.
- Moving to a workshop (DIE_SHOP) requires READY or IN_USE (`WH_DIE_NOT_PASSED` otherwise). Moving to a maker (gửi sửa) → REPAIRING. Moving to a kho: IN_USE → READY, others unchanged.
- PASS/DEFECT allowed anywhere (maker, kho, workshop); PASS at a kho may set a shelf. Transfers show in history as "Bế khuôn", "Chuyển kho" or "Gửi sửa" by destination.
- Batch input `toPartnerKind` (DIE_SHOP | DIE_MAKER) sets the kind of a partner typed by name.


### Independent catalogs (v0.17)

The kho catalogs no longer constrain each other.

- **Warehouses**: one kind for all. Any active warehouse holds both materials and dies; `WhWarehouse.kind` stays in the database but nothing reads it (UI no longer asks). Slips, transfers, die moves, snapshots, the stock list and the die place picker use every active warehouse.
- **Materials**: one shared catalog, not tied to a warehouse. `WhMaterialInputDto.warehouseIds` is optional and ignored. A slip line on a size the warehouse never had creates its `WhWarehouseMaterial` link and `WhStock` row on the spot (`WH_ITEM_INACTIVE` when the material or size is turned off). Receipt / return pick from the whole catalog; issue / transfer pick from what the warehouse holds.
- **Shelves**: must belong to a warehouse (any warehouse); `WH_LOCATION_WAREHOUSE_REQUIRED`.
- **Partners**: the kind is a memo only (`kind` optional, default OTHER). Every partner picker lists every partner. Die status after a move to a partner follows the action, not the partner kind: batch input `purpose` CUT (bế khuôn → IN_USE, die must be READY / IN_USE) or REPAIR (gửi sửa → REPAIRING, MAKING stays MAKING). `toPartnerKind` is gone. New dies default their managing warehouse to the first active warehouse holding dies, else the first active warehouse.
- **Catalog UI**: tabs Kho (warehouses + shelves) · Vật tư · Khuôn (die symbols) · Đối tác · Nhập tồn vật tư Excel · Nhập bảng khuôn Excel. No stock column in materials, no kind / counts in warehouses.
- **Stock import** (`POST materials/import-paper?warehouseId=`): any warehouse (default GIAY). Reads "Tên vật tư" or "Loại giấy", TỒN (required), and optional Mã VT, Nhóm, Khổ / Quy cách (blank = no size, a single number = roll width), ĐVT (blank = tờ, used only for new materials). Materials are matched by name (same group first, else the only one with that name). Report adds `warehouseId`, `warehouseName`.
- **Die import** (`POST dies/import?warehouseId=`): default warehouse chosen by the user (else first holding dies, else first active). The place column matches any warehouse by name. Shelves are created in the warehouse the die is in. New partners get kind OTHER. Report adds `warehouseId`, `warehouseName`.
- No migration.

- **In-place cut / repair** (v0.17.1): a die held by a partner can be cut or repaired right there (made at Mê Linh, cut at Mê Linh). A batch with `fromPartnerId === toPartnerId` is accepted when `purpose` is CUT or REPAIR: the die stays put, status → IN_USE / REPAIRING, history shows "Bế khuôn" / "Gửi sửa" at that partner. Without a purpose (and for warehouses) the destination must still differ (`WH_BATCH_SAME_PLACE`). The UI lists the current partner first as "(bế tại chỗ)" and preselects it for dies not already cutting.
