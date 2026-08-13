# Школьный Помощник — mobile PWA + Supabase + Gemini

Готовая мобильная PWA для Android/iOS. Внутри:
- Supabase Auth: ник + пароль;
- роли `user` / `admin`;
- расписание по классам;
- импорт фото расписания через Supabase Edge Function + Gemini;
- админка с загрузкой фото, редактированием и удалением расписаний;
- оценки, средний балл и четвертная оценка;
- календарь с локальными заметками;
- светлая/тёмная/авто-тема;
- адаптация под телефоны и safe-area.

## Что исправлено в этой версии

- Импорт расписания теперь использует структурированный JSON Gemini.
- Варианты класса `8а`, `8А`, `8 а`, `8 А`, `8-а`, `8A` нормализуются в один ключ `8А`.
- Латинская `B` в OCR для `8B` нормализуется в кириллическую `В` → `8В`.
- Если один класс встречается в таблице несколько раз, его уроки объединяются и дубликаты удаляются.
- Дни недели и номера уроков сортируются стабильно.
- Старые записи в Supabase с разным написанием класса тоже подхватываются приложением.
- Админка показывает каноническое имя класса и умеет удалить все его старые варианты.
- Убран неработающий пункт сброса пароля, который раньше только показывал сообщение.
- Добавлены проверки типа и размера изображения перед отправкой.
- Ошибки Edge Function/Gemini теперь показываются в админке без падения интерфейса.
- Добавлен тест нормализации расписания: `node scripts/test-schedule-normalization.mjs`.

## 1. Supabase

1. Открой свой проект Supabase.
2. В SQL Editor выполни целиком `schema.sql`.
3. В Authentication → Providers → Email отключи **Confirm email**, если хочешь оставить вход только по нику + паролю без настоящей почты.
4. Зарегистрируй первый аккаунт.
5. Сделай его админом:

```sql
update public.profiles set role = 'admin' where username = 'ТВОЙ_НИК';
```

## 2. Gemini

В Supabase → Edge Functions → Secrets добавь:

- `GEMINI_API_KEY` — ключ Gemini;
- `GEMINI_MODEL` — `gemini-3.6-flash`.

Ключ Gemini не попадает в браузер: запрос идёт через `process-schedule`.

## 3. GitHub Actions

В GitHub → Settings → Secrets and variables → Actions создай:

- `SUPABASE_ACCESS_TOKEN` — Personal Access Token Supabase;
- `SUPABASE_PROJECT_REF` — `igbkjkjagkhxpxezjwtj`.

`SUPABASE_PROJECT_REF` также указан в `supabase/config.toml`, поэтому это не пароль и его можно использовать как обычный project ref.

После push в `main`:

- `.github/workflows/deploy-supabase.yml` задеплоит `process-schedule`;
- `.github/workflows/deploy-pages.yml` опубликует PWA через GitHub Pages.

Для GitHub Pages: Settings → Pages → Source = **GitHub Actions**.

## 4. Где взять `SUPABASE_ACCESS_TOKEN`

В Supabase открой Account → Access Tokens и создай Personal Access Token. Сам токен никому не отправляй и не добавляй в репозиторий.

Для локальной работы можно выполнить:

```bash
export SUPABASE_ACCESS_TOKEN='ТВОЙ_PERSONAL_ACCESS_TOKEN'
supabase link --project-ref igbkjkjagkhxpxezjwtj
```

Для GitHub Actions достаточно сохранить токен как secret с именем `SUPABASE_ACCESS_TOKEN`.

## 5. Где взять `SUPABASE_PROJECT_REF`

Project ref — это идентификатор проекта. В этой версии он уже стоит в:

```text
supabase/config.toml
```

Значение:

```text
igbkjkjagkhxpxezjwtj
```

Если когда-нибудь проект поменяется, замени это значение и GitHub Actions secret `SUPABASE_PROJECT_REF`.

## 6. Проверка перед публикацией

```bash
node scripts/test-schedule-normalization.mjs
node --check index.html
node --experimental-strip-types --check supabase/functions/process-schedule/index.ts
```

`node --check index.html` напрямую не является валидной командой для HTML, поэтому для проверки JS из `index.html` можно использовать небольшой extraction-скрипт или открыть приложение в браузере. В архиве JS уже дополнительно проверен через `node --check` после извлечения script-блока.

## Оценки

Четвертная оценка округляется по школьному правилу: `3.50 → 4`, `3.49 → 3`, `4.50 → 5`.

## Календарь

☰ → Календарь. Нажатие на число открывает заметку. Дни с заметкой получают точку, выходные выделяются зелёным. Данные календаря сохраняются локально на устройстве.
