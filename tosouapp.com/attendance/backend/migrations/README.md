# Migration: Fix Confirmed Status

## Mục đích
Update status từ 未承認/遅刻 → 確認済み cho records cũ có đầy đủ checkIn + checkOut + memo

## Cách chạy trên Render

### Option 1: Shell access
```bash
cd /opt/render/project/src/tosouapp.com
mysql -h $DB_HOST -u $DB_USER -p$DB_PASSWORD $DB_NAME < attendance/backend/migrations/2026-10-14-fix-confirmed-status.sql
```

### Option 2: Node.js script
```bash
cd /opt/render/project/src/tosouapp.com
node attendance/backend/migrations/run-migration.js
```

## Kết quả mong đợi
- Records có checkIn + checkOut + memo đầy đủ → status = '確認済み'
- Console log: số dòng đã update
