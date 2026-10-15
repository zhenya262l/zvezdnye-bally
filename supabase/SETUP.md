# Настройка проекта Supabase

Выполняется один раз. Все пункты делаются в панели supabase.com.

1. **New project.** Название `zvezdnye-bally`, регион Central EU (Frankfurt), тариф Free.
2. **SQL Editor → New query.** Вставить файл `migrations/20261015000100_stage1_core.sql` целиком → **Run**. Ожидаемый ответ: «Success. No rows returned».
3. **Authentication → Sign In / Providers.**
   - Включить **Allow anonymous sign-ins** → **Save**. Так входят телефоны детей.
   - В разделе **Email**: «Confirm email» оставить включённым, **Email OTP Length** = 6, **Email OTP Expiration** = 3600 → **Save**.
4. **Authentication → Emails → Templates.** В шаблонах **Confirm signup** и **Magic Link**:
   - Subject: `Код для входа в «Звёздные баллы»`
   - Body: содержимое `email-templates/confirmation.html` и `email-templates/magic_link.html`.
5. **Authentication → URL Configuration.** Site URL: `https://<имя>.github.io/zvezdnye-bally/`.
6. **Project Settings → API Keys.** Скопировать Project URL и **publishable key** в переменные репозитория GitHub `SUPABASE_URL` и `SUPABASE_PUBLISHABLE_KEY`. Секретный ключ (secret / service_role) никуда не копировать.

## Ограничения бесплатной почты

Встроенная почта Supabase отправляет письма только адресам из команды проекта (Organization → Team) и не больше 2 писем в час. Родитель должен входить той почтой, на которую зарегистрирован Supabase. Для второго родителя понадобится свой почтовый сервер (SMTP) — это этап 2.
