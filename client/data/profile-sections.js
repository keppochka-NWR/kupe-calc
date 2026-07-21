// data/profile-sections.js
// Сечения профилей Аристо — превью + описание для UI-модала.
//
// Public: PROFILE_SECTIONS, PROFILE_SECTIONS_VERSION, getSectionForSystem(sysObj)
//
// Структура: { slug → { title, img, width, description } }
//   slug         — производный из system+profile (см. systemToSlug в kupe.js); должен быть стабильным
//   title        — что показать в шапке модала
//   img          — путь к PNG (относительно index.html); пустая строка = заглушка-«пока не добавлено»
//   width        — ширина рамки в мм (информативно, для текстового описания)
//   description  — 1-2 предложения о конструкции; помогает менеджеру объяснить клиенту разницу
//
// PNG-сечения извлекаются из data-sources/catalogs/SDA_UN_Tekh-katalog_2024.pdf постранично.
// На старте — 6 ходовых систем с готовыми PNG, остальные показывают placeholder.
// Добавление новой картинки: положить файл в kupe/assets/sections/, проставить img: 'assets/sections/X.png'.

const PROFILE_SECTIONS_VERSION = '2026.06.06';

const PROFILE_SECTIONS = {
  // ────── Семейство Стандарт ──────
  'standart-c': {
    title: 'Стандарт C (классика)',
    img: 'assets/sections/standart-c.jpg',
    width: 30,
    description: 'Классический широкий профиль 30 мм с C-образной формой ручки. Самая ходовая система для жилых интерьеров. Раздвижная.',
  },
  'standart-i': {
    title: 'Стандарт I (узкий)',
    img: 'assets/sections/standart-i.jpg',
    width: 30,
    description: 'Узкая I-образная ручка, визуально облегчает фасад. Те же 30 мм рамки что у Стандарт C. Раздвижная.',
  },
  'standart-flat': {
    title: 'Стандарт FLAT (декор, ПВХ)',
    img: 'assets/sections/standart-flat.jpg',
    width: 40,
    description: 'Плоский декоративный профиль с окуткой ПВХ, имитация дерева/декоров. Рамка 40 мм. Раздвижная.',
  },
  'standart-fusion': {
    title: 'Стандарт FUSION',
    img: 'assets/sections/standart-fusion.jpg',
    width: 30,
    description: 'Универсальная система: поддерживает подвесной и складной режимы (hang+fold). Рамка 30 мм.',
  },
  'standart-smart': {
    title: 'Стандарт SMART',
    img: 'assets/sections/standart-smart.jpg',
    width: 30,
    description: 'Новинка серии Стандарт. Усиленная конструкция для тяжёлых наполнений.',
  },
  'standart-avers': {
    title: 'Стандарт AVERS',
    img: 'assets/sections/standart-avers.jpg',
    width: 20,
    description: 'Двусторонний симметричный профиль 20 мм (узкая часть — 7 мм). Допускает использование разных листовых материалов с двух сторон. Раздвижная, до 100 кг.',
  },
  'standart-twelve': {
    title: 'Стандарт TWELVE',
    img: 'assets/sections/standart-twelve.jpg',
    width: 30,
    description: 'Серия с фокусом на минималистичный профиль 12 мм. Раздвижная.',
  },

  // ────── Семейство Эконом ──────
  'ekonom-c': {
    title: 'Эконом C',
    img: 'assets/sections/ekonom-c.jpg',
    width: 30,
    description: 'Бюджетная C-форма. Та же геометрия что у Стандарт C, но из более простого алюминия. Раздвижная.',
  },
  'ekonom-h': {
    title: 'Эконом H',
    img: 'assets/sections/ekonom-h.jpg',
    width: 30,
    description: 'Бюджетная H-форма ручки. Раздвижная.',
  },
  'ekonom-flat': {
    title: 'Эконом FLAT',
    img: 'assets/sections/standart-flat.jpg',
    width: 40,
    description: 'Бюджетная FLAT с окуткой ПВХ. Раздвижная. (Сечение взято из системы Стандарт FLAT — геометрия идентична.)',
  },
  'ekonom-o': {
    title: 'Эконом O',
    img: 'assets/sections/ekonom-o.jpg',
    width: 30,
    description: 'Бюджетная O-образная ручка. Раздвижная.',
  },

  // ────── Семейство SLIM LINE ──────
  'slim': {
    title: 'SLIM Line',
    img: 'assets/sections/slim.jpg',
    width: 9.5,
    description: 'Тонкий профиль SLIM Line: видимая часть 9.5 мм, выступ ручки 5 мм. Минимум алюминия — максимум стекла/зеркала. Раздвижная, дверь до 60 кг.',
  },
  'slim-fine': {
    title: 'SLIM Fine',
    img: 'assets/sections/slim.jpg',
    width: 9.5,
    description: 'Усовершенствованная SLIM с более тонким видимым швом. (Сечение конструктивно идентично базовой SLIM Line.) Раздвижная.',
  },
  'slim-max': {
    title: 'SLIM MAX',
    img: 'assets/sections/slim-max.jpg',
    width: 15.5,
    description: 'Усиленный SLIM для высоких дверей: видимая часть 14 мм, толщина 15.5 мм, высота профиля 34 мм. До 3200 мм высоты двери. Раздвижная.',
  },
  'slim-dekor': {
    title: 'SLIM Декор',
    img: 'assets/sections/slim-dekor.jpg',
    width: 9.5,
    description: 'SLIM с декоративными вставками. (Базовая геометрия как у SLIM Line.) Раздвижная.',
  },

  // ────── Семейство NOVA ──────
  'nova': {
    title: 'NOVA',
    img: 'assets/sections/nova.jpg',
    width: 25,
    description: 'Современный профиль 25 мм. ЛДСП 16 мм (вместо стандартных 8 мм) для прочности. Раздвижная.',
  },

  // ────── Семейство GRACE ──────
  'grace': {
    title: 'GRACE (подвесная)',
    img: 'assets/sections/grace.jpg',
    width: 12,
    description: 'Подвесная система БЕЗ нижнего трека. Верхний профиль интегрирован с рельсой. Для межкомнатных перегородок, ход в любую сторону. Макс. вес двери 60 кг.',
  },

  // ────── Семейство Свои ──────
  'svoi': {
    title: 'Свои цены (ручная настройка)',
    img: '',
    width: 30,
    description: 'Шаблон для самостоятельной настройки цен. Сечение не указано — зависит от того, какой реальный профиль закладываете.',
  },
};

/**
 * systemToSlug(sysObj) — превращает объект из PROFILE_SYSTEMS в slug для PROFILE_SECTIONS.
 *
 * Логика: family + profile → kebab-case. Примеры:
 *   {family:'Стандарт', profile:'C (классика)'}    → 'standart-c'
 *   {family:'Стандарт', profile:'FUSION'}           → 'standart-fusion'
 *   {family:'SLIM LINE', profile:'SLIM'}            → 'slim'
 *   {family:'GRACE', profile:'GRACE (подвесная)'}   → 'grace'
 *   {family:'NOVA', profile:'NOVA'}                  → 'nova'
 *   {family:'Эконом', profile:'C'}                  → 'ekonom-c'
 *   {family:'Свои', profile:'Ручная настройка'}     → 'svoi'
 */
function systemToSlug(sys) {
  if (!sys || !sys.family) return '';
  // Транслитерация base
  const FAM_MAP = {
    'Стандарт': 'standart',
    'Эконом': 'ekonom',
    'SLIM LINE': 'slim-line',  // спец-обработка ниже
    'NOVA': 'nova',
    'GRACE': 'grace',
    'Свои': 'svoi',
  };
  const fam = FAM_MAP[sys.family] || sys.family.toLowerCase();
  const prof = (sys.profile || '').toLowerCase();

  // Спец-кейс: NOVA, GRACE, Свои — slug по семейству
  if (sys.family === 'NOVA') return 'nova';
  if (sys.family === 'GRACE') return 'grace';
  if (sys.family === 'Свои') return 'svoi';

  // SLIM LINE: profile уже содержит SLIM[ Fine|MAX|Декор]
  if (sys.family === 'SLIM LINE') {
    if (prof.includes('fine')) return 'slim-fine';
    if (prof.includes('max')) return 'slim-max';
    if (prof.includes('декор') || prof.includes('dekor')) return 'slim-dekor';
    return 'slim';
  }

  // Стандарт/Эконом: family-suffix
  // profile может быть: 'C (классика)', 'I (узкий)', 'FLAT (декор / ПВХ)', 'FUSION', 'SMART', 'AVERS', 'TWELVE', 'H', 'O'
  let suffix = '';
  const first = prof.match(/^([a-zа-я]+)/i);
  if (first) {
    suffix = first[1].toLowerCase()
      .replace('ц', 'c').replace('и', 'i').replace('х', 'h').replace('о', 'o');
  }
  return suffix ? `${fam}-${suffix}` : fam;
}

/**
 * getSectionForSystem(sysObj) — возвращает запись PROFILE_SECTIONS для системы.
 * Если нет точного матча — возвращает null (UI покажет placeholder).
 */
function getSectionForSystem(sys) {
  const slug = systemToSlug(sys);
  return PROFILE_SECTIONS[slug] || null;
}
