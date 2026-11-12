// File chạy ngầm (Cron Job): Tự động sao lưu dữ liệu (Backup) từ MySQL và gửi qua Email định kỳ
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');
const mailService = require('../core/notifications/email.service');
const s3Service = require('../core/services/s3.service');

// Only require mysqldump if it's actually installed, otherwise create a mock
let mysqldump;
try {
  mysqldump = require('mysqldump');
} catch (e) {
  console.warn('[DB Backup] mysqldump module not found, backup feature will be disabled.');
  mysqldump = async () => { throw new Error('mysqldump module is not installed'); };
}

// QUAN TRỌNG: app.js serve /uploads công khai qua express.static (chỉ chặn
// riêng /uploads/payslips). Backup phải nằm trong một thư mục con RIÊNG,
// bị chặn tường minh (xem app.js) trước khi tới static middleware — tuyệt
// đối không được ghi thẳng vào gốc uploads/, nếu không ai đoán được tên file
// (tosouapp_backup_<timestamp>.sql) cũng tải được nguyên database.
//
// Thư mục này CHỈ là nơi tạm để mysqldump ghi ra và để đính kèm email — nó
// KHÔNG phải nơi lưu trữ lâu dài đáng tin cậy: service này chạy trên Render
// mà không có ổ đĩa persistent thật (đã kiểm tra: `mount`/`df -h` không thấy
// volume nào, thư mục uploads/ thậm chí chưa tồn tại trước khi tạo lần đầu).
// Mỗi lần deploy lại là một filesystem mới — file ở đây có thể biến mất bất
// cứ lúc nào. Bản lưu trữ THẬT là R2 (uploadToR2 bên dưới), giống cách
// payslip/expense/notice đã dùng từ trước.
const BACKUP_DIR = path.join(__dirname, '../uploads/db-backups-internal');
const R2_BACKUP_PREFIX = 'db-backups';
// Gmail/most SMTP relays reject attachments above ~25MB; stay well under that.
const MAX_EMAIL_ATTACHMENT_BYTES = 15 * 1024 * 1024;
// Chỉ áp dụng khi R2 KHÔNG được cấu hình (fallback yếu hơn nhiều, vì đĩa có
// thể không sống sót qua lần deploy tiếp theo).
const RETAIN_BACKUPS = 4;
const ALERT_EMAIL = 'iizuka_token@tosouapp.com';

async function sendAlertEmail(subject, html) {
    try {
        await mailService.sendMail({ to: ALERT_EMAIL, subject, html });
    } catch (alertError) {
        console.error('[Cron Job] Không gửi được email cảnh báo backup:', alertError);
    }
}

function pruneOldBackups() {
    try {
        const files = fs.readdirSync(BACKUP_DIR)
            .filter((f) => f.startsWith('tosouapp_backup_') && f.endsWith('.sql'))
            .sort() // timestamp trong tên file nên sort theo chuỗi = sort theo thời gian
            .reverse();
        for (const oldFile of files.slice(RETAIN_BACKUPS)) {
            fs.unlinkSync(path.join(BACKUP_DIR, oldFile));
            console.log(`[Cron Job] Đã dọn bản backup cũ: ${oldFile}`);
        }
    } catch (pruneError) {
        console.error('[Cron Job] Lỗi khi dọn backup cũ:', pruneError);
    }
}

// 毎日の実行と手動実行が重ならないように
let backupRunning = false;

// options.emailCopy: true なら添付メールも送る（2つ目の保管先）。毎日の実行では日曜だけ true。
async function runAutoBackup(options = {}) {
    if (backupRunning) {
        console.warn('[Cron Job] Backup đang chạy, bỏ qua lần gọi trùng.');
        return;
    }
    backupRunning = true;
    try {
        await runAutoBackupOnce(options);
    } finally {
        backupRunning = false;
    }
}

async function runAutoBackupOnce({ emailCopy = true } = {}) {
    console.log('[Cron Job] Bắt đầu tự động backup Database...');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `tosouapp_backup_${timestamp}.sql`;
    const backupFilePath = path.join(BACKUP_DIR, backupFileName);

    try {
        if (!fs.existsSync(BACKUP_DIR)) {
            fs.mkdirSync(BACKUP_DIR, { recursive: true });
        }

        // 1. Tạo file backup SQL — nếu bước này lỗi, không có file nào bị xóa nhầm.
        await mysqldump({
            connection: {
                host: process.env.DB_HOST,
                port: process.env.DB_PORT || 3306,
                user: process.env.DB_USER,
                password: process.env.DB_PASS || process.env.DB_PASSWORD,
                database: process.env.DB_NAME,
            },
            dumpToFile: backupFilePath,
        });

        console.log(`[Cron Job] Backup tạo thành công tại: ${backupFilePath}`);

        // 2. Đẩy lên R2 ngay — đây là lớp lưu trữ THẬT, sống sót qua mọi lần
        // deploy (không như ổ đĩa local của service). Làm trước bước email để
        // dù email có thất bại, bản backup vẫn đã an toàn ở nơi khác.
        // PERF: dùng stream thay vì readFileSync để tránh load toàn bộ file vào RAM.
        let uploadedToR2 = false;
        if (s3Service.isR2Configured()) {
            try {
                // 保存期間は R2 のライフサイクルルールで決める（コードでは消さない）:
                //   daily/   → 35日で自動削除、monthly/ → 400日（約13か月）で自動削除
                uploadedToR2 = await s3Service.uploadFileToR2(`${R2_BACKUP_PREFIX}/daily/${backupFileName}`, backupFilePath, 'application/sql');
                if (uploadedToR2) {
                    console.log(`[Cron Job] Đã lưu backup lên R2: ${R2_BACKUP_PREFIX}/daily/${backupFileName}`);
                    // 毎月1日（JST）の分は monthly/ にも残す（長めに保管する月次の控え）
                    const dayJST = new Date(Date.now() + 9 * 3600 * 1000).getUTCDate();
                    if (dayJST === 1) {
                        try {
                            const okMonthly = await s3Service.uploadFileToR2(`${R2_BACKUP_PREFIX}/monthly/${backupFileName}`, backupFilePath, 'application/sql');
                            if (okMonthly) console.log(`[Cron Job] Đã lưu bản tháng lên R2: ${R2_BACKUP_PREFIX}/monthly/${backupFileName}`);
                            else {
                                console.error('[Cron Job] Không lưu được bản tháng (monthly/) lên R2.');
                                await sendAlertEmail('[Cảnh báo] Không lưu được backup tháng (monthly/) lên R2', '<p>Bản hằng ngày đã lưu ở daily/, nhưng bản tháng (giữ 13 tháng) không lưu được. Cần kiểm tra R2.</p>');
                            }
                        } catch (mErr) {
                            console.error('[Cron Job] Lỗi khi lưu bản tháng (monthly/) lên R2:', mErr);
                        }
                    }
                } else {
                    console.error('[Cron Job] uploadFileToR2 trả về false — backup CHƯA được lưu bền.');
                }
            } catch (r2Error) {
                console.error('[Cron Job] Lỗi khi đẩy backup lên R2:', r2Error);
            }
        } else {
            console.warn('[Cron Job] R2 chưa được cấu hình (thiếu R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY) — backup CHỈ nằm trên ổ đĩa tạm của service, có thể mất khi deploy lại.');
        }
        if (!uploadedToR2) {
            await sendAlertEmail(
                `[Cảnh báo] Backup TosouApp chưa được lưu bền - ${new Date().toLocaleDateString('vi-VN')}`,
                `<p>Backup hôm nay tạo thành công nhưng KHÔNG lưu được lên R2 (${s3Service.isR2Configured() ? 'upload lỗi' : 'R2 chưa cấu hình'}).</p>
                 <p>File tạm hiện nằm tại <code>${backupFilePath}</code> trên ổ đĩa service — có thể biến mất ở lần deploy tiếp theo. Cần kiểm tra cấu hình R2 sớm.</p>`
            );
        }

        // 3. File đã được tạo thành công trên ổ đĩa — dùng cho bước email đính
        // kèm bên dưới, sau đó sẽ được dọn (xem pruneOldBackups).
        const sizeBytes = fs.statSync(backupFilePath).size;
        if (!emailCopy && uploadedToR2) {
            // 毎日の実行: R2 に保存できたので添付メールは送らない（個人情報入りのメールを毎日増やさない）。
            console.log(`[Cron Job] Backup hằng ngày OK (${(sizeBytes / 1024 / 1024).toFixed(1)}MB, R2). Không gửi email đính kèm hôm nay.`);
        } else if (sizeBytes > MAX_EMAIL_ATTACHMENT_BYTES) {
            console.warn(`[Cron Job] Backup ${(sizeBytes / 1024 / 1024).toFixed(1)}MB vượt ngưỡng gửi email, bỏ qua bước email.`);
            await sendAlertEmail(
                `[Cảnh báo] Backup TosouApp quá lớn để gửi email - ${new Date().toLocaleDateString('vi-VN')}`,
                `<p>Backup ngày hôm nay (${(sizeBytes / 1024 / 1024).toFixed(1)}MB) vượt quá giới hạn đính kèm email an toàn.</p>
                 <p>File vẫn được giữ trên server tại <code>${backupFilePath}</code> (giữ lại ${RETAIN_BACKUPS} bản gần nhất). Cần thiết lập nơi lưu trữ ngoài (S3/Drive...) trước khi dữ liệu lớn hơn nữa.</p>`
            );
        } else {
            // 4. Gửi Email đính kèm file
            const subject = `[Tự động] Bản sao lưu Dữ liệu Nhân sự TosouApp - ${new Date().toLocaleDateString('vi-VN')}`;
            const html = `
                <h3>Kính gửi Quản lý,</h3>
                <p>Đây là bản sao lưu (backup) tự động dữ liệu của hệ thống chấm công TosouApp.</p>
                <p>Bao gồm toàn bộ dữ liệu tài khoản, chấm công, thông tin lương của nhân viên tính đến thời điểm hiện tại.</p>
                <p>Xin vui lòng tải file đính kèm và cất giữ cẩn thận. Trong trường hợp hệ thống gặp sự cố (như lỗi máy chủ, sập database), bạn có thể cung cấp file này cho bộ phận kỹ thuật để khôi phục lại 100% dữ liệu.</p>
                <p>Trân trọng,<br/>Hệ thống tự động TosouApp.</p>
            `;

            try {
                await mailService.sendMail({
                    to: ALERT_EMAIL,
                    subject,
                    html,
                    attachments: [{ filename: backupFileName, path: backupFilePath }]
                });
                console.log(`[Cron Job] Đã gửi file backup thành công vào email: ${ALERT_EMAIL}`);
            } catch (mailError) {
                // Gửi email thất bại KHÔNG được xóa file — đây là bản backup duy nhất.
                console.error('[Cron Job] Gửi email backup thất bại (file vẫn được giữ lại):', mailError);
                await sendAlertEmail(
                    `[Cảnh báo] Gửi email backup TosouApp thất bại - ${new Date().toLocaleDateString('vi-VN')}`,
                    `<p>Backup đã tạo thành công nhưng gửi email thất bại: ${String(mailError.message || mailError)}</p>
                     <p>File vẫn còn trên server tại <code>${backupFilePath}</code>.</p>`
                );
            }
        }

        // 5. Dọn các bản backup cũ hơn RETAIN_BACKUPS bản gần nhất (không đụng bản vừa tạo).
        // Chỉ còn là dọn dẹp đĩa tạm — bản lưu trữ thật đã ở R2 từ bước 2.
        pruneOldBackups();

    } catch (error) {
        console.error('[Cron Job] Lỗi khi tự động backup Database:', error);
        await sendAlertEmail(
            `[Cảnh báo] Backup TosouApp THẤT BẠI - ${new Date().toLocaleDateString('vi-VN')}`,
            `<p>Tự động backup database thất bại, KHÔNG có bản backup nào được tạo hôm nay.</p>
             <p>Lỗi: ${String(error.message || error)}</p>`
        );
    }
}

// Khởi tạo Cron Job
function initBackupCronJob() {
    // 毎日 03:00 JST（利用の少ない時間）に R2 へバックアップ。
    // 日曜だけは従来どおり添付メールも送る（R2 とは別の2つ目の保管先）。
    // R2 に保存できなかった日は、曜日に関係なく添付メール＋警告メールを送る。
    cron.schedule('0 3 * * *', () => {
        const dowJST = new Date(Date.now() + 9 * 3600 * 1000).getUTCDay();
        runAutoBackup({ emailCopy: dowJST === 0 });
    }, {
        scheduled: true,
        timezone: "Asia/Tokyo"
    });

    console.log('[Cron Job] Đã lên lịch backup hằng ngày 03:00 JST (R2); email đính kèm vào Chủ Nhật.');
}

module.exports = {
    initBackupCronJob,
    runAutoBackup // Export ra để có thể gọi test thủ công
};