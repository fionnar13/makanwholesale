# راهنمای راه‌اندازی cron بیرونی برای بکاپ قابل‌اتکا

اسکجولر داخلی برنامه (هر ۶۰ ثانیه) روی هاست‌هایی که می‌خوابند (مثل پلن رایگان Render یا PaaSهای ارزان) متوقف می‌شود. راهکار: یک سرویس cron بیرونی هر ۵ تا ۱۵ دقیقه مسیر زیر را صدا بزند تا هم سرویس بیدار بماند و هم بکاپ/همگام‌سازی سر ساعت اجرا شود:

```
POST https://<دامنه-سایت>/api/integrations/scheduler/tick
Header: x-cron-secret: <مقدار INTEGRATION_SECRET_KEY>
```

- رمز cron همان متغیر محیطی `INTEGRATION_SECRET_KEY` است (تولید: `openssl rand -base64 32`). اگر این کلید را تغییر دهید، مقادیر حساس پنل باید دوباره ذخیره شوند.
- اگر نمی‌خواهید اسکجولر داخلی هم فعال باشد (مثلاً روی VPS با cron سیستم‌عامل)، متغیر `INTEGRATIONS_SCHEDULER_DISABLED=1` را تنظیم کنید.

نمونه تست دستی:

```bash
curl -X POST "https://your-app.onrender.com/api/integrations/scheduler/tick" \
  -H "x-cron-secret: YOUR_SECRET_VALUE"
# پاسخ موفق: {"ok":true,"running":false,"lastTick":"..."}
```

---

## ۱) cron-job.org (ساده‌ترین — رایگان)

1. در [cron-job.org](https://cron-job.org) حساب بسازید → **Cronjobs → Create cronjob**.
2. URL: `https://your-app.onrender.com/api/integrations/scheduler/tick`
3. Schedule: **Every 5 minutes** (یا هر ۱۰/۱۵ دقیقه).
4. Advanced → **Headers** → اضافه کنید: `x-cron-secret` با مقدار رمز.
5. Save و از بخش **History** موفقیت پاسخ (200) را چک کنید.

## ۲) UptimeRobot (رایگان — هم پایش هم تیک)

UptimeRobot فقط GET می‌فرستد و نمی‌تواند هدر ست کند؛ برای همین مسیر تیک به‌تنهایی کار نمی‌کند. دو راه دارید:
- مسیر GET اضافه نکنید — از cron-job.org (بخش ۱) استفاده کنید؛ یا
- اگر اپ خودتان روی VPS است، یک مسیر GET معادل با همان منطق هدر در Nginx بسازید (توصیه نمی‌شود؛ نگهداری دو مسیر).

## ۳) GitHub Actions (scheduled workflow — رایگان برای مخزن عمومی/خصوصی)

`.github/workflows/cron-tick.yml`:

```yaml
name: Scheduler tick
on:
  schedule:
    - cron: '*/10 * * * *'   # هر ۱۰ دقیقه
  workflow_dispatch:
jobs:
  tick:
    runs-on: ubuntu-latest
    steps:
      - name: Call scheduler tick
        run: |
          curl -sS -X POST "$APP_URL/api/integrations/scheduler/tick" \
            -H "x-cron-secret: $CRON_SECRET"
        env:
          APP_URL: ${{ secrets.APP_URL }}
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
```

- `CRON_SECRET` و `APP_URL` را در Settings → Secrets and variables → Actions ذخیره کنید.
- توجه: زمان‌بندی GitHub Actions دقیق نیست (گاهی چند دقیقه تأخیر دارد)؛ برای بکاپ روزانه کافی است.

## ۴) VPS با crontab (لینوکس)

```bash
crontab -e
```

```cron
# هر ۱۰ دقیقه — لاگ در /var/log/makan-tick.log
*/10 * * * * curl -sS -X POST "https://your-app.example.com/api/integrations/scheduler/tick" -H "x-cron-secret: YOUR_SECRET_VALUE" >> /var/log/makan-tick.log 2>&1
```

- رمز را داخل فایل crontab می‌نویسید؛ دسترسی فایل محدود است اما اگر می‌خواهید امن‌تر باشد، رمز را در فایل جدا با دسترسی 600 بگذارید و با `bash -c 'source /etc/makan-cron.env && curl ... -H "x-cron-secret: $CRON_SECRET"'` بخوانید.

## ۵) Render Cron Job (پلن paid)

در همان پروژه Render یک **Cron Job** بسازید:

- Command:
  ```bash
  curl -sS -X POST "https://your-app.onrender.com/api/integrations/scheduler/tick" -H "x-cron-secret: $CRON_SECRET"
  ```
  (در Render، متغیر `CRON_SECRET` را در Environment همان Cron Job ست کنید.)
- Schedule: `*/10 * * * *`

---

## چک‌لیست نهایی پس از راه‌اندازی

- [ ] پاسخ `{"ok":true}` از curl تست دستی.
- [ ] در پنل → تب لاگ‌ها: رویداد `BACKUP_DUE` یا اجرای بکاپ دیده می‌شود.
- [ ] «وضعیت آخرین بکاپ» در تب بکاپ سبز است.
- [ ] پیام تست تلگرام ارسال می‌شود و رویداد «هشدار توقف بکاپ» فعال است.
- [ ] یک بار به‌صورت آزمایشی سرویس را چند ساعت خاموش/خواب کنید و ببینید بکاپ بعدی سر ساعت انجام و در صورت شکست، هشدار تلگرامی می‌آید.
