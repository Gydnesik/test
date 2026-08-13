import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseAnonKey = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY')!
const geminiKey = Deno.env.get('GEMINI_API_KEY')!
const geminiModel = Deno.env.get('GEMINI_MODEL') || 'gemini-3.6-flash'

const DAY_ORDER = ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье']
const LATIN_TO_CYR = new Map([
  ['A','А'],['B','В'],['C','С'],['E','Е'],['H','Н'],['K','К'],['M','М'],['O','О'],['P','Р'],['T','Т'],['X','Х'],['Y','У'],
])

function normalizeClassName(value: unknown): string | null {
  let s = String(value ?? '').trim().toUpperCase()
  s = s.replace(/\bКЛАСС\b/giu, '').replace(/[\s._\-–—:№]+/g, '')
  for (const [latin, cyr] of LATIN_TO_CYR) s = s.replaceAll(latin, cyr)
  const match = s.match(/^(5|6|7|8|9|10|11)([АБВГ])$/u)
  return match ? `${match[1]}${match[2]}` : null
}

function normalizeDay(value: unknown): string {
  const raw = String(value ?? '').trim().toLowerCase().replace(/ё/g, 'е')
  const aliases: Record<string, string> = {
    'пн':'Понедельник','пон':'Понедельник','понедельник':'Понедельник',
    'вт':'Вторник','вторник':'Вторник',
    'ср':'Среда','среда':'Среда',
    'чт':'Четверг','четверг':'Четверг',
    'пт':'Пятница','пятница':'Пятница',
    'сб':'Суббота','суббота':'Суббота',
    'вс':'Воскресенье','воскресенье':'Воскресенье',
  }
  return aliases[raw] || String(value ?? '').trim() || 'Понедельник'
}

function normalizeLesson(raw: any, fallbackIndex: number): any | null {
  if (!raw || typeof raw !== 'object') return null
  const subject = String(raw.subject ?? raw.name ?? raw.title ?? '').trim()
  if (!subject) return null
  const lessonRaw = Number(raw.lesson ?? raw.number ?? fallbackIndex + 1)
  const lesson = Number.isFinite(lessonRaw) && lessonRaw > 0 ? Math.floor(lessonRaw) : fallbackIndex + 1
  return {
    day: normalizeDay(raw.day),
    lesson,
    subject,
    time: String(raw.time ?? '').trim(),
    room: String(raw.room ?? raw.cabinet ?? raw.classroom ?? '').trim(),
  }
}

function normalizeLessons(raw: unknown): any[] {
  if (!Array.isArray(raw)) return []
  const result: any[] = []
  raw.forEach((item, i) => {
    const lesson = normalizeLesson(item, i)
    if (lesson) result.push(lesson)
  })
  result.sort((a,b) => {
    const d = DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day)
    return d || a.lesson - b.lesson || a.subject.localeCompare(b.subject, 'ru')
  })
  const seen = new Set<string>()
  return result.filter(x => {
    const key = `${x.day}|${x.lesson}|${x.subject}|${x.time}|${x.room}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function normalizeSchedules(input: any) {
  const out: Record<string, any[]> = {}
  const ignoredClasses: string[] = []
  const source = Array.isArray(input?.schedules)
    ? input.schedules
    : input?.schedules && typeof input.schedules === 'object'
      ? Object.entries(input.schedules).map(([class_name, lessons]) => ({ class_name, lessons }))
      : Array.isArray(input)
        ? input
        : []

  for (const item of source) {
    const rawClass = item?.class_name ?? item?.className ?? item?.class ?? item?.name
    const className = normalizeClassName(rawClass)
    if (!className) {
      if (String(rawClass ?? '').trim()) ignoredClasses.push(String(rawClass).trim())
      continue
    }
    const lessons = normalizeLessons(item?.lessons)
    if (!out[className]) out[className] = []
    out[className].push(...lessons)
  }

  for (const className of Object.keys(out)) out[className] = normalizeLessons(out[className])
  return { schedules: out, ignoredClasses: [...new Set(ignoredClasses)] }
}

const responseSchema = {
  type: 'object',
  properties: {
    schedules: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          class_name: { type: 'string' },
          lessons: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                day: { type: 'string' },
                lesson: { type: 'integer' },
                subject: { type: 'string' },
                time: { type: 'string' },
                room: { type: 'string' },
              },
              required: ['day','lesson','subject','time','room'],
            },
          },
        },
        required: ['class_name','lessons'],
      },
    },
  },
  required: ['schedules'],
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    if (!geminiKey) return json({ error: 'На сервере не задан GEMINI_API_KEY.' }, 500)

    const auth = req.headers.get('Authorization') || ''
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: auth } },
    })
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return json({ error: 'Необходим вход в аккаунт.' }, 401)

    const { data: profile, error: profileError } = await supabase
      .from('profiles').select('role').eq('id', user.id).single()
    if (profileError || profile?.role !== 'admin') return json({ error: 'Доступ только для администратора.' }, 403)

    const body = await req.json()
    const image = String(body.image || '')
    const mimeType = String(body.mimeType || 'image/jpeg').split(';')[0]
    if (!image) return json({ error: 'Фото не передано.' }, 400)
    if (!mimeType.startsWith('image/')) return json({ error: 'Поддерживаются только изображения.' }, 400)
    if (image.length > 15_000_000) return json({ error: 'Фото слишком большое. Выбери изображение поменьше.' }, 413)

    const prompt = `Ты — OCR-парсер школьного расписания на русском языке. На изображении может быть одна большая таблица: классы могут быть заголовками столбцов, а дни и номера уроков — строками. Нужно распознать ВСЕ видимые классы и ВСЕ непустые уроки.

Верни только JSON по заданной схеме.

КРИТИЧНО ДЛЯ КЛАССОВ:
- Нормализуй пробелы и визуальные варианты: "8а", "8А", "8 а", "8 А", "8-а" — это один класс "8А".
- Используй кириллицу для букв классов: А, Б, В, Г.
- Если OCR распознал латинскую A в "8A", это должно стать "8А". Латинскую B в "8B" трактуй как кириллическую В.
- Не придумывай букву класса, если её нет на изображении.
- Не смешивай 8Б и 8В.

КРИТИЧНО ДЛЯ УРОКОВ:
- Каждый урок должен иметь day, lesson, subject, time, room. Если время/кабинет не видны — ставь пустую строку.
- Пустые клетки не добавляй.
- Если день повторяется блоком над несколькими строками, используй этот день для всех строк блока.
- lesson — номер урока, а не номер строки.
- Не придумывай предметы, время, кабинеты и классы.
- Сохрани все уроки каждого класса, даже если один класс встречается в нескольких местах таблицы.
- Если один и тот же класс распознан несколько раз, объединяй его уроки в один class_name.

Пример формата одного элемента:
{"class_name":"8А","lessons":[{"day":"Понедельник","lesson":1,"subject":"Математика","time":"08:30","room":"12"}]}`

    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data: image } },
        ] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema,
        },
      }),
    })

    const data = await r.json()
    if (!r.ok) return json({ error: data?.error?.message || `Gemini HTTP ${r.status}` }, 502)

    let raw = ''
    for (const p of data?.candidates?.[0]?.content?.parts || []) if (p.text) raw += p.text
    raw = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()
    if (!raw) return json({ error: 'Gemini не вернул JSON.' }, 502)

    let parsed: any
    try { parsed = JSON.parse(raw) } catch { return json({ error: 'Gemini вернул невалидный JSON.' }, 502) }
    const normalized = normalizeSchedules(parsed)
    const entries = Object.entries(normalized.schedules)
    if (!entries.length) return json({ error: 'Не удалось распознать ни одного поддерживаемого класса (5А–11Г).', ignoredClasses: normalized.ignoredClasses }, 422)

    return json({ schedules: normalized.schedules, ignoredClasses: normalized.ignoredClasses, model: geminiModel })
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
