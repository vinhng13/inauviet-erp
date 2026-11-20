#!/usr/bin/env bash
# Cập nhật ERP trên VPS: backup database -> git pull -> build & khởi động lại -> kiểm tra.
# Chạy bằng root:   bash /opt/erp/deploy/update-vps.sh
set -euo pipefail
cd "$(dirname "$0")/.."

DC=(docker compose -f docker-compose.prod.yml -f deploy/docker-compose.cloudpanel.yml --env-file .env.prod)
PORT="$(grep -E '^WEB_PORT=' .env.prod | cut -d= -f2 || true)"; PORT="${PORT:-8090}"
TS="$(date +%F-%H%M)"
BACKUP="backups/truoc-cap-nhat-$TS.dump"

echo "==> 1/4 Backup database"
mkdir -p backups
"${DC[@]}" exec -T db pg_dump -U erp -Fc erp > "$BACKUP"
test -s "$BACKUP" || { echo "LỖI: file backup rỗng, dừng lại."; exit 1; }
ls -lh "$BACKUP"

echo "==> 2/4 Lấy code mới từ GitHub"
BEFORE="$(git rev-parse --short HEAD)"
git pull --ff-only
AFTER="$(git rev-parse --short HEAD)"
echo "    $BEFORE -> $AFTER"
git log --oneline "$BEFORE..$AFTER" || true
grep -q '^CHANNEL_SECRET_KEY=' .env.prod || echo "CHANNEL_SECRET_KEY=$(openssl rand -hex 32)" >> .env.prod

echo "==> 3/4 Build và khởi động lại (vài phút)"
"${DC[@]}" up -d --build

echo "==> 4/4 Kiểm tra"
ok=""
for _ in $(seq 1 40); do
  if curl -fsS "localhost:$PORT/api/v1/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 3
done
"${DC[@]}" ps
echo "--- Log migration / lỗi của API (10 phút gần nhất):"
"${DC[@]}" logs --since 10m api 2>&1 | grep -iE "migration|applied|error" | tail -20 || true

# Xoá các bản backup trước-cập-nhật cũ hơn 30 ngày
find backups -name 'truoc-cap-nhat-*.dump' -mtime +30 -delete 2>/dev/null || true

if [ -n "$ok" ]; then
  echo "==> XONG: đang chạy $AFTER. Backup trước khi cập nhật: /opt/erp/$BACKUP"
else
  echo "LỖI: API chưa phản hồi. Xem log: docker compose -f docker-compose.prod.yml -f deploy/docker-compose.cloudpanel.yml --env-file .env.prod logs --tail 100 api"
  echo "Khôi phục database nếu cần: xem DEPLOY.md mục 4, dùng file /opt/erp/$BACKUP"
  exit 1
fi
