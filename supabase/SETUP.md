# Настройка проекта Supabase

Выполнено 15 октября 2026 для проекта `zvezdnye-bally` (ref `rbgibuexyvegqbmuiiub`, регион Frankfurt, тариф Free). Шаги ниже нужны, если проект придётся создать заново.

1. **New project.** Название `zvezdnye-bally`, регион Central EU (Frankfurt), тариф Free. Галочку «Automatically expose new tables» снять.
2. **SQL Editor → New query.** Вставить файл `migrations/20261015000100_stage1_core.sql` целиком → **Run** → в окне предупреждения **Run query**. Ожидаемый ответ: «Success. No rows returned».
   Для этапа 2 так же выполнить `migrations/20261017000100_stage2_tasks.sql`, затем `migrations/20261019000100_family_access.sql`, затем `migrations/20261021000100_review_fixes.sql`. На рабочем проекте все четыре выполнены 20.10.2026.
   После этого назначить владельца приложения одной командой в SQL Editor (почту владельца вписать на месте, в код она не попадает):
   `insert into private.app_admins (user_id) select id from auth.users where email = '<почта владельца>';`
   Затем владелец сохраняет текст согласия в приложении: «Семья» → «Новые семьи» → «Текст согласия». Без него второй родитель не сможет присоединиться.
3. **Authentication → Sign In / Providers.**
   - Включить **Allow anonymous sign-ins** → **Save changes**. Так входят телефоны детей.
   - **Email**: «Confirm email» оставить включённым, **Email OTP Length** = 6, **Email OTP Expiration** = 3600 → **Save**.
4. **Authentication → Emails → SMTP Settings.** Включить **Enable custom SMTP**:
   - Sender email и Username: почта Gmail владельца. Sender name: `Звёздные баллы`.
   - Host `smtp.gmail.com`, порт 465, интервал 60 секунд.
   - Password: пароль приложения Google (myaccount.google.com/apppasswords, нужна двухэтапная аутентификация). Вводит владелец.
   Без своего SMTP шаблоны писем не редактируются и вместо кода приходит ссылка.
5. **Authentication → Emails → Templates.** В шаблонах **Confirm sign up** и **Magic link or OTP**:
   - Subject: `Код для входа в «Звёздные баллы»`
   - Body: содержимое `email-templates/confirmation.html` и `email-templates/magic_link.html`.
6. **Authentication → URL Configuration.** Site URL: `https://zhenya262l.github.io/zvezdnye-bally/`.
7. **Project Settings → API Keys.** Project URL и **publishable key** записаны в переменные репозитория GitHub `SUPABASE_URL` и `SUPABASE_PUBLISHABLE_KEY`. Секретный ключ никуда не копируется.
8. **Пуши.**
   - **SQL Editor:** выполнить `migrations/20261022000100_push.sql`.
   - **Edge Functions → Deploy a new function → Via Editor.** Имя `push`, код из `functions/push/index.ts` → **Deploy function**. В настройках функции выключить проверку JWT («Verify JWT» / «Enforce JWT verification»): вызов защищён секретом, который сделала база. Секреты функции добавлять не нужно: адрес базы Supabase даёт сам.
   - **SQL Editor:** выполнить `sql/push_live.sql`, вписав вместо `<project-ref>` ref проекта. Он включает pg_net и pg_cron, записывает адрес функции и ставит проверку раз в минуту, затем будит функцию: она создаёт ключи VAPID (закрытый ключ — в Vault).
   - Проверка: `select public.push_public_key();` возвращает длинную строку. В приложении «Настройки» → «Уведомления» → «Включить уведомления» → «Проверить уведомление».
