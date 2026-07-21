// js/kupe.js
// Модуль «Двери-купе» (Аристо-системы): расчёт стоимости, визуализация, КП.
//
// Public globals (для inline onclick=""): много — calculate, recalculate, updateDisplay,
//   resetCalc, openKP, и т.д. (нужно постепенно мигрировать в KupeModule namespace).
//
// Depends on: utils.js, store.js, router.js, shared-kp.js,
//             data/fillings.js, data/profiles.js
//
// TODO (post-refactor):
//   - обернуть все функции в KupeModule = {...}
//   - заменить window._lastCalcData на AppState.kupe.lastCalcData
//   - заменить onclick="calculate()" на addEventListener в init()
/* KUPE MODULE — global scope */

/* ============================================================
   CONFIG — DATA
   ============================================================ */

// FILLINGS вынесен в data/fillings.js

// PROFILE_SYSTEMS, SECTION_OPTS, FILM_*, SOFT_CLOSE_PRICE и т.д. вынесены в data/profiles.js

// FASAD_PROFILES, FASAD_HINGES, FASAD_LIFT и т.д. вынесены в data/fasad-alu-data.js

/**
 * getAutoFilm(fill) — определяет тип плёнки по материалу наполнения.
 * Оракал-плёнки: плёнка не нужна (null).
 * Зеркало / лакобель / ЛДСП / непрозрачные: армировочная.
 * Стекло прозрачное / тонированное / сатин / узорчатые: противоосколочная SF.
 */
function getAutoFilm(fill) {
  if (!fill) return null;
  const g = fill.g || '';
  const n = fill.n || '';
  const mat = fill.mat || '';
  // Оракал и плёнки — исключение, своя плёнка не нужна
  if (g === 'Плёнки') return null;
  // Зеркала — армировочная
  if (mat.includes('mirror') || g === 'Зеркала') return FILM_ARMOR;
  // Лакобель и ЛДСП — армировочная
  if (g === 'Лакобель' || g === 'ЛДСП') return FILM_ARMOR;
  // Стекло прозрачное, тонированное, сатин, узорчатые — противоосколочная
  if (g === 'Стекло' || g === 'Узорчатые (склад)' || g === 'Узорчатые (заказные)') return FILM_SAFETY;
  // По умолчанию — армировочная
  return FILM_ARMOR;
}

/* ============================================================
   STATE
   ============================================================ */
let sectH   = 0;
let sectV   = 0;
let sectOpt = SECTION_OPTS[0];   // глобальный пресет (по умолчанию для всех дверей)
let doorFills    = [];            // doorFills[doorIdx][sectIdx] = FILLINGS[n]
let activeSection = null;         // { doorIdx, sectIdx } | null — выделенная секция
let rowMm        = [];            // высоты секций в мм (sum === H)
let colMm        = [];            // ширины колонок в мм (sum === dw)
let _dragDiv     = null;          // состояние drag-разделителя: { doorIdx, divIdx, startY, startRowMm }
let doorRowMm    = [];            // doorRowMm[doorIdx][] — высоты секций для каждой двери
let doorTexRot   = [];            // doorTexRot[doorIdx] = true если текстура ЛДСП повёрнута на 90° (горизонтальная укладка)
let doorSectOpt  = [];            // v1.2: doorSectOpt[doorIdx] = {rowRatios, colRatios, h, v, label} или null/undefined → берём sectOpt

// Размеры листа ЛДСП Lamarty (мм): 2750 — длина по текстуре, 1830 — ширина поперёк текстуры.
// Из одного листа можно вырезать одну дверь не больше:
//   - вертикально (по умолчанию): W ≤ 1830, H ≤ 2750
//   - горизонтально (rotated):     W ≤ 2750, H ≤ 1830
const LDSP_SHEET_LONG  = 2750;  // длина по текстуре
const LDSP_SHEET_SHORT = 1830;  // поперёк текстуры
let activeDoorEdit = 0;           // какая дверь активна (чья линейка в viz, чьи значения в сайдбаре)

// ALU state вынесено в js/fasad-alu.js

// HELPERS ($, num, fmt, pluralDoors, debounce) вынесены в js/utils.js

/* ============================================================
   LIVE UPDATE — автопересчёт при изменении параметров
   ============================================================ */

// updateDisplay: если результаты уже показаны → пересчёт, иначе → только визуализация
function updateDisplay() {
  if (window._lastCalcData) recalculate();
  else rerenderVisualization();
}

// recalculate: полный пересчёт с сохранением полей КП
function recalculate() {
  if (!window._lastCalcData) return;
  // Сохранить поля КП — они пересоздаются при перерисовке результатов
  const kp = {
    client:   ($('kpClient')   || {}).value   || '',
    phone:    ($('kpPhone')    || {}).value    || '',
    manager:  ($('kpManager')  || {}).value    || '',
    delivery: ($('kpDelivery') || {}).value    || '0',
    install:  ($('kpInstall')  || {}).checked  || false,
  };
  // Live-пересчёт: пропускаем строгую валидацию ЛДСП (alert сбивал бы UX).
  // Полная валидация остаётся при явном нажатии «Рассчитать стоимость» (calculate без аргументов).
  calculate({ silent: true });
  // Восстановить поля КП
  if ($('kpClient'))   $('kpClient').value    = kp.client;
  if ($('kpPhone'))    $('kpPhone').value     = kp.phone;
  if ($('kpManager'))  $('kpManager').value   = kp.manager;
  if ($('kpDelivery')) { $('kpDelivery').value = kp.delivery; updateKPPreview(); }
  if ($('kpInstall'))  $('kpInstall').checked  = kp.install;
  // Анимация обновления цены
  const rhv = document.querySelector('.rh-value');
  if (rhv) { rhv.classList.remove('rh-value-live'); void rhv.offsetWidth; rhv.classList.add('rh-value-live'); }
}

/* ============================================================
   INIT
   ============================================================ */
(function init() {
  populateProfiles();
  buildSectionBtns();
  setSections(0);
  initTheme();
  // Phase 5 — 3-col редизайн
  if (typeof setupDoorCountChips === 'function') setupDoorCountChips();
  if (typeof initKupeVersion === 'function')     initKupeVersion();
  if (typeof updateChipsActive === 'function')   updateChipsActive(2);
  // v1.2 — bulk-операции
  if (typeof populateBulkSelectors === 'function') populateBulkSelectors();
  // Живой пересчёт — подписываемся на все изменения параметров
  const debouncedUpdate = debounce(updateDisplay, 350);
  $('width').addEventListener('input', debouncedUpdate);
  $('height').addEventListener('input', () => {
    rowMm = []; // сбросить mm при смене высоты чтобы пересчитались
    buildDividersBlock();
    debouncedUpdate();
  });
  $('softClose').addEventListener('change', updateDisplay);
  $('singlePartition').addEventListener('change', updateDisplay);
  $('filmToggle').addEventListener('change', updateDisplay);
})();

/* ============================================================
   SECTION EDITOR — новые функции управления наполнением
   ============================================================ */

function initDoorFills(N, sectCount) {
  doorFills = Array.from({length: N}, (_, di) => {
    const existing = doorFills[di] || [];
    // v1.2: если у двери индивидуальный sectOpt — её sectCount может отличаться от глобального параметра
    const dOpt = doorSectOpt[di];
    const targetCount = dOpt ? (dOpt.rowRatios.length * dOpt.colRatios.length) : sectCount;
    return Array.from({length: targetCount}, (_, si) =>
      existing[si] || existing[existing.length - 1] || FILLINGS[0]
    );
  });
}

/* ============================================================
   PER-DOOR SECTION OPT (v1.2) — helpers
   ============================================================
   sectOpt — глобальный пресет (применяется по умолчанию).
   doorSectOpt[doorIdx] — индивидуальный override (если задан).
   API:
     getDoorSectOpt(doorIdx)       → объект (override или общий)
     getDoorSectCount(doorIdx)     → число секций
     hasDoorOverride(doorIdx)      → true если включён override
     hasAnyDoorOverride()          → true если хоть одна дверь имеет override
     setDoorSectOpt(di, optObj)    → включает override и применяет пресет
     clearDoorSectOpt(di)          → выключает override (fallback к sectOpt)
     getAllDoorSectOpts(N)         → массив длины N с актуальными опциями per-door
*/
function getDoorSectOpt(doorIdx) {
  return doorSectOpt[doorIdx] || sectOpt;
}
function getDoorSectCount(doorIdx) {
  const o = getDoorSectOpt(doorIdx);
  return o.rowRatios.length * o.colRatios.length;
}
function hasDoorOverride(doorIdx) {
  return !!doorSectOpt[doorIdx];
}
function hasAnyDoorOverride() {
  return doorSectOpt.some(o => !!o);
}
function setDoorSectOpt(doorIdx, optObj) {
  doorSectOpt[doorIdx] = {
    rowRatios: optObj.rowRatios.slice(),
    colRatios: optObj.colRatios.slice(),
    h: optObj.h,
    v: optObj.v,
    label: optObj.label,
  };
  // Сбросить ручные высоты разделителей этой двери — пересчитаются от равномерного
  if (doorRowMm[doorIdx]) doorRowMm[doorIdx] = null;
  // Подогнать doorFills под новое количество секций для этой двери
  const newCount = optObj.rowRatios.length * optObj.colRatios.length;
  const cur = doorFills[doorIdx] || [];
  doorFills[doorIdx] = Array.from({length: newCount}, (_, si) => cur[si] || cur[cur.length - 1] || FILLINGS[0]);
}
function clearDoorSectOpt(doorIdx) {
  doorSectOpt[doorIdx] = null;
  if (doorRowMm[doorIdx]) doorRowMm[doorIdx] = null;
  // doorFills подгоняется под глобальный sectOpt при последующем initDoorFills()
  const globalCount = sectOpt.rowRatios.length * sectOpt.colRatios.length;
  const cur = doorFills[doorIdx] || [];
  doorFills[doorIdx] = Array.from({length: globalCount}, (_, si) => cur[si] || cur[cur.length - 1] || FILLINGS[0]);
}
function getAllDoorSectOpts(N) {
  const arr = [];
  for (let i = 0; i < N; i++) arr.push(getDoorSectOpt(i));
  return arr;
}

/**
 * commitDoorRatios(doorIdx, newRowMm, H) — после drag/edit разделителя записывает новые ratios.
 * Если дверь имеет override (doorSectOpt[doorIdx] установлен) — обновляет его.
 * Иначе обновляет глобальный sectOpt (старая логика, ratios шарятся между не-override дверями).
 */
function commitDoorRatios(doorIdx, newRowMm, H) {
  const ratios = newRowMm.map(v => v / H);
  if (doorSectOpt[doorIdx]) {
    doorSectOpt[doorIdx] = Object.assign({}, doorSectOpt[doorIdx], { rowRatios: ratios.slice() });
  } else {
    sectOpt = Object.assign({}, sectOpt, { rowRatios: ratios.slice() });
  }
}

function initRowMm(H, rows, ratios) {
  if (rowMm.length === rows) return;
  if (ratios && ratios.length === rows) {
    // Инициализировать из пропорций пресета
    rowMm = ratios.map(r => Math.round(r * H));
    const sum = rowMm.reduce((a, b) => a + b, 0);
    rowMm[rows - 1] += H - sum; // компенсация округления
  } else {
    const base = Math.floor(H / rows);
    rowMm = Array.from({length: rows}, (_, i) =>
      i < rows - 1 ? base : H - base * (rows - 1)
    );
  }
}

function getDoorRowMm(doorIdx, H_val) {
  const H = H_val || num('height', 2000);
  const dOpt = getDoorSectOpt(doorIdx);
  const rows = dOpt.rowRatios.length;
  if (doorRowMm[doorIdx] && doorRowMm[doorIdx].length === rows) return doorRowMm[doorIdx];
  // Инициализировать из пропорций пресета этой двери (равномерно или из ratios)
  const base = dOpt.rowRatios.map(r => Math.round(r * H));
  const sum = base.reduce((a, b) => a + b, 0);
  if (rows > 0) base[rows - 1] += H - sum;
  doorRowMm[doorIdx] = base;
  return doorRowMm[doorIdx];
}

function buildDividersBlock() {
  const block = $('dividersBlock');
  if (!block) return;
  block.innerHTML = '';
  const H = num('height', 2000);
  // v1.2: разделители строятся для активной двери — используем её per-door sectOpt
  const dOpt = getDoorSectOpt(activeDoorEdit);
  const rows = dOpt.rowRatios.length;
  if (rows <= 1) { block.style.display = 'none'; return; }
  block.style.display = 'flex';
  const activeRm = getDoorRowMm(activeDoorEdit, H);
  rowMm = activeRm.slice();
  let cumMm = 0;
  for (let i = 0; i < rows - 1; i++) {
    cumMm += activeRm[i];
    const field = document.createElement('div');
    field.className = 'field';
    field.innerHTML =
      '<label class="lbl">Разделитель ' + (i + 1) + ' · Дв.' + (activeDoorEdit + 1) +
      ' <span class="lbl-hint">мм от верха</span></label>' +
      '<input class="inp" id="divH_' + i + '" type="number" value="' + cumMm + '" min="100" max="' + (H - 100) + '" step="10">';
    field.querySelector('input').onchange = () => onDividerChange();
    block.appendChild(field);
  }
}

function onDividerChange() {
  const H = num('height', 2000);
  // v1.2: rows берём per-door (если у активной двери override — её rows, иначе общие)
  const rows = getDoorSectOpt(activeDoorEdit).rowRatios.length;
  const positions = [];
  for (let i = 0; i < rows - 1; i++) {
    positions.push(+(document.getElementById('divH_' + i).value) || 0);
  }
  const newRm = positions.map((pos, i) => pos - (positions[i - 1] || 0));
  newRm.push(H - positions[positions.length - 1]);
  rowMm = newRm;
  doorRowMm[activeDoorEdit] = newRm.slice();
  commitDoorRatios(activeDoorEdit, newRm, H);
  updateDisplay(); // разделитель меняет площадь секций → меняет цену
}

function updateDividerInputs() {
  let cumMm = 0;
  for (let i = 0; i < rowMm.length - 1; i++) {
    cumMm += rowMm[i];
    const inp = document.getElementById('divH_' + i);
    if (inp) inp.value = Math.round(cumMm);
  }
}

function startDividerDrag(e) {
  e.preventDefault();
  e.stopPropagation();
  const doorIdx = +e.currentTarget.dataset.doorIdx;
  const divIdx  = +e.currentTarget.dataset.divIdx;
  const H = num('height', 2000);
  activeDoorEdit = doorIdx;
  const startRM = getDoorRowMm(doorIdx, H).slice();
  _dragDiv = { doorIdx, divIdx, startY: e.clientY, startRowMm: startRM };
  // v1.4: Pointer Events — работает и мышью, и пальцем на телефоне
  document.addEventListener('pointermove', onDividerDragMove);
  document.addEventListener('pointerup',   onDividerDragEnd);
  document.addEventListener('pointercancel', onDividerDragEnd);
}

function onDividerDragMove(e) {
  if (!_dragDiv) return;
  const pxPerMm = window._vizPxPerMm || 0.15;
  const deltaMm = Math.round((e.clientY - _dragDiv.startY) / pxPerMm);
  const { doorIdx, divIdx, startRowMm } = _dragDiv;
  const minMm = 80;
  const totalAB = startRowMm[divIdx] + startRowMm[divIdx + 1];
  let newA = Math.max(minMm, startRowMm[divIdx] + deltaMm);
  let newB = Math.max(minMm, startRowMm[divIdx + 1] - deltaMm);
  if (newA + newB !== totalAB) newA = totalAB - newB;
  const newRm = startRowMm.slice();
  newRm[divIdx] = newA;
  newRm[divIdx + 1] = newB;
  doorRowMm[doorIdx] = newRm;
  rowMm = newRm;
  const H = num('height', 2000);
  commitDoorRatios(doorIdx, newRm, H); // v1.2: per-door
  updateDividerInputs();
  // Throttle через requestAnimationFrame — на слабых ПК renderRoom медленный.
  // Без throttle при drag вызывается на каждый mousemove (до 60+ раз/сек).
  if (!_dragRafPending) {
    _dragRafPending = true;
    requestAnimationFrame(() => {
      _dragRafPending = false;
      rerenderVisualization();
    });
  }
}
let _dragRafPending = false;

function onDividerDragEnd() {
  if (!_dragDiv) return;
  _dragDiv = null;
  document.removeEventListener('pointermove', onDividerDragMove);
  document.removeEventListener('pointerup',   onDividerDragEnd);
  document.removeEventListener('pointercancel', onDividerDragEnd);
  updateDisplay();
}

/* ============================================================
   v1.4: МОБИЛЬНАЯ НИЖНЯЯ ПАНЕЛЬ (Итого + Рассчитать)
   ============================================================ */
function kupeMobileScrollResults() {
  const rp = $('resultPanel');
  if (rp) rp.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function kupeMobileCalc() {
  const before = window._lastCalcData;
  calculate();
  // Прокручиваем к деталям только если calculate() прошёл валидацию
  if (window._lastCalcData && window._lastCalcData !== before) kupeMobileScrollResults();
}

/* ============================================================
   v1.5: «ЗАКАЗАТЬ ДВЕРЬ» — отправка расчёта клиентом в мессенджер
   ============================================================ */
const ORDER_PHONE_DISPLAY = '+7 910 140-42-91';
const ORDER_PHONE_TEL = '+79101404291';
const ORDER_SITE_URL = 'https://keppochka-nwr.github.io/kupe-calc/client/';
// Автоприём заявок (таблица/почта) — подключается позже, см. docs/client-project/ORDERS.md.
// Пусто = заявки идут через мессенджеры (контур А, работает всегда).
const ORDER_GAS_URL = '';
// Прямые ссылки на чаты. Max НЕ поддерживает ссылки по номеру телефона —
// нужна персональная ссылка профиля (Max: аватар → QR-код → Поделиться → Скопировать ссылку).
// Пустая строка = кнопка мессенджера скрыта.
const ORDER_MAX_URL = 'https://max.ru/u/f9LHodD0cOKgO6v0DjX0Vn7z30jisNqQU0PMLLr7KIOsieTNhK9Kmkwadm4';
const ORDER_TG_URL  = 'https://t.me/Keppochka';

// UTM-источник: запоминаем при первом заходе, подставляем в заявку
function _captureUtm() {
  try {
    const p = new URLSearchParams(location.search);
    const src = p.get('utm_source');
    if (src) {
      localStorage.setItem('yo_utm',
        [src, p.get('utm_medium'), p.get('utm_campaign')].filter(Boolean).join('/'));
    }
  } catch (e) {}
}
function _getUtm() { try { return localStorage.getItem('yo_utm') || ''; } catch (e) { return ''; } }
_captureUtm();

function buildOrderText(client) {
  const d = window._lastCalcData;
  if (!d) return '';
  const sel = id => {
    const el = $(id);
    return el && el.selectedOptions && el.selectedOptions[0] ? el.selectedOptions[0].textContent.trim() : '';
  };
  const lines = [];
  lines.push('Заявка — Ё Мебель, двери-купе');
  if (window._kupeProjectNum) lines.push('Проект № ' + window._kupeProjectNum);
  if (client) {
    if (client.name)  lines.push('Клиент: ' + client.name);
    if (client.phone) lines.push('Телефон: ' + client.phone);
    if (client.city)  lines.push('Город: ' + client.city);
    if (client.addr)  lines.push('Адрес: ' + client.addr);
    lines.push('Бесплатный замер: ' + (client.measure ? 'нужен' : 'не нужен'));
    lines.push('Установка: ' + (client.install ? 'нужна' : 'нет'));
    if (client.comment) lines.push('Комментарий: ' + client.comment);
    lines.push('— Расчёт —');
  }
  lines.push('Проём: ' + d.W + ' × ' + d.H + ' мм, ' + d.N + ' ' + pluralDoors(d.N));
  const prof = [sel('profileFamily'), sel('profileSystem')].filter(Boolean).join(' ');
  const col = sel('profileColor');
  lines.push('Профиль: ' + prof + (col ? ', ' + col : ''));
  const mats = [];
  d.fills.forEach(f => { if (f && f.n && mats.indexOf(f.n) === -1) mats.push(f.n); });
  lines.push('Наполнение: ' + mats.join('; '));
  if (d.softCloseCost > 0) lines.push('Доводчик: да');
  if (d.filmCost > 0) lines.push('Защитная плёнка: да');
  lines.push('Цена дверей: ' + fmt(d.total) + ' ₽');
  if (client && client.install) {
    const inst = Math.max(5000, Math.round(d.total * 0.13));
    lines.push('Установка: ' + fmt(inst) + ' ₽');
    lines.push('ИТОГО с установкой: ' + fmt(d.total + inst) + ' ₽');
  }
  const utm = _getUtm();
  if (utm) lines.push('Источник: ' + utm);
  lines.push(ORDER_SITE_URL);
  return lines.join('\n');
}

function _orderEsc(e) { if (e.key === 'Escape') closeOrderModal(); }

function openOrderModal() {
  const m = $('orderModal'); if (!m) return;
  const t = $('orderText'); if (t) t.textContent = buildOrderText();
  const ph = $('orderPhoneLink');
  if (ph) { ph.textContent = ORDER_PHONE_DISPLAY; ph.href = 'tel:' + ORDER_PHONE_TEL; }
  // Сброс состояния: показываем форму, прячем экран «отправлено»
  const fb = $('orderFormBox'); if (fb) fb.style.display = '';
  const db = $('orderDoneBox'); if (db) db.style.display = 'none';
  const sb = $('ordSubmitBtn'); if (sb) { sb.disabled = false; sb.textContent = 'Отправить заявку'; }
  ['ordName', 'ordPhone'].forEach(id => { const el = $(id); if (el) el.style.borderColor = ''; });
  const cr = $('ordConsentRow'); if (cr) cr.style.color = '';
  // Кнопки мессенджеров видны только если ссылка задана
  const mb = $('orderMaxBtn'); if (mb) mb.style.display = ORDER_MAX_URL ? '' : 'none';
  const tb = $('orderTgBtn');  if (tb) tb.style.display = ORDER_TG_URL  ? '' : 'none';
  m.style.display = 'flex';
  document.addEventListener('keydown', _orderEsc);
}

/* --- Клиентская форма заявки --- */
function _collectOrderForm() {
  const v = id => { const el = $(id); return el ? el.value.trim() : ''; };
  return {
    name: v('ordName'), phone: v('ordPhone'), city: v('ordCity'), addr: v('ordAddr'),
    comment: v('ordComment'),
    measure: !!($('ordMeasure') && $('ordMeasure').checked),
    install: !!($('ordInstall') && $('ordInstall').checked),
    consent: !!($('ordConsent') && $('ordConsent').checked),
  };
}

function submitOrder() {
  const f = _collectOrderForm();
  const bad = [];
  if (!f.name) bad.push('ordName');
  if (!f.phone || f.phone.replace(/\D/g, '').length < 10) bad.push('ordPhone');
  if (bad.length) {
    bad.forEach(id => { const el = $(id); if (el) el.style.borderColor = '#c84444'; });
    const first = $(bad[0]); if (first) first.focus();
    return;
  }
  if (!f.consent) {
    const cr = $('ordConsentRow'); if (cr) cr.style.color = '#c84444';
    return;
  }
  const text = buildOrderText(f);
  const btn = $('ordSubmitBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Отправляем…'; }

  const finish = mode => {
    const fb = $('orderFormBox'); if (fb) fb.style.display = 'none';
    const db = $('orderDoneBox'); if (db) db.style.display = 'flex';
    const dt = $('orderDoneText');
    if (dt) dt.textContent = mode === 'sent'
      ? 'Заявка отправлена! Менеджер свяжется с вами в рабочее время — обычно в течение часа. Хотите быстрее — продублируйте заявку в мессенджер одной кнопкой ниже (текст уже скопирован).'
      : 'Остался один шаг: нажмите кнопку мессенджера ниже — текст заявки уже скопирован, просто вставьте его в чат и отправьте. Или позвоните нам напрямую.';
    _orderClipboard(text);
    if (btn) { btn.disabled = false; btn.textContent = 'Отправить заявку'; }
  };

  if (ORDER_GAS_URL) {
    const body = new URLSearchParams();
    body.append('payload', JSON.stringify(Object.assign({}, f, {
      text: text,
      total: window._lastCalcData ? window._lastCalcData.total : 0,
      project: window._kupeProjectNum || '',
      utm: _getUtm(),
      page: location.href,
    })));
    fetch(ORDER_GAS_URL, { method: 'POST', mode: 'no-cors', body: body })
      .then(() => finish('sent'))
      .catch(() => finish('manual'));
  } else {
    finish('manual');
  }
}

// Открыть чат в мессенджере: расчёт заранее кладём в буфер обмена,
// клиенту остаётся вставить его в открывшийся чат (прямой prefill Max/TG не поддерживают)
function orderOpenMessenger(kind) {
  const url = kind === 'max' ? ORDER_MAX_URL : ORDER_TG_URL;
  if (!url) return;
  orderCopy();
  window.open(url, '_blank', 'noopener');
}

function closeOrderModal() {
  const m = $('orderModal'); if (m) m.style.display = 'none';
  document.removeEventListener('keydown', _orderEsc);
}

function orderShare() {
  const text = buildOrderText();
  if (navigator.share) {
    // Телефон: системная шторка «Поделиться» — клиент выбирает Max/WhatsApp/что угодно
    navigator.share({ text: text }).catch(function () { /* клиент закрыл шторку — не ошибка */ });
  } else {
    orderCopy(); // десктоп без Web Share API — просто копируем текст
  }
}

function orderCopy() {
  const text = buildOrderText(_collectOrderForm());
  const done = () => { const b = $('orderCopyBtn'); if (b) b.textContent = 'Скопировано ✓'; };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => _orderFallbackCopy(text, done));
  } else {
    _orderFallbackCopy(text, done);
  }
}

// Тихое копирование (без смены надписей) — используется при отправке формы
function _orderClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => _orderFallbackCopy(text, function () {}));
  } else {
    _orderFallbackCopy(text, function () {});
  }
}

function _orderFallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch (e) {}
  document.body.removeChild(ta);
}

function startRulerEdit(labelDiv) {
  if (labelDiv.querySelector('input')) return; // уже редактируется
  const H     = num('height', 2000);
  const dIdx  = +labelDiv.dataset.doorIdx;
  const sIdx  = +labelDiv.dataset.sectIdx;
  const curMm = +labelDiv.dataset.mm;
  // v1.2: rows берём из per-door опций (важно при override)
  const rows  = getDoorSectOpt(dIdx).rowRatios.length;

  const inp = document.createElement('input');
  inp.type = 'number'; inp.value = curMm; inp.min = 80; inp.step = 10;
  inp.style.cssText =
    'width:50px;font-size:10px;font-weight:600;border:none;outline:none;' +
    'background:transparent;color:rgba(1,105,111,1);font-family:inherit;text-align:center;';
  labelDiv.textContent = '';
  labelDiv.appendChild(inp);
  labelDiv.style.background = 'rgba(255,255,255,.98)';
  labelDiv.style.borderColor = 'rgba(1,105,111,.6)';
  inp.focus(); inp.select();

  let committed = false;
  function commit() {
    if (committed) return;
    committed = true;
    const newMm = Math.max(80, +inp.value || curMm);
    const rm = getDoorRowMm(dIdx, H).slice();
    if (newMm === rm[sIdx]) { rerenderVisualization(); return; }
    const delta = newMm - rm[sIdx];
    // Взять из соседней секции (сначала снизу, потом сверху)
    const adj = sIdx < rows - 1 ? sIdx + 1 : sIdx - 1;
    if (rm[adj] - delta < 80) {
      const maxD = rm[adj] - 80;
      rm[sIdx] += maxD; rm[adj] = 80;
    } else {
      rm[sIdx] = newMm; rm[adj] -= delta;
    }
    doorRowMm[dIdx] = rm;
    activeDoorEdit  = dIdx;
    rowMm = rm.slice();
    commitDoorRatios(dIdx, rm, H); // v1.2: per-door
    buildDividersBlock();
    updateDisplay();
  }
  inp.addEventListener('keydown', ev => {
    if (ev.key === 'Enter')  inp.blur();
    if (ev.key === 'Escape') { committed = true; rerenderVisualization(); }
  });
  inp.addEventListener('blur', commit);
}

function openSectionEditor(doorIdx, sectIdx) {
  activeDoorEdit = doorIdx;
  activeSection = { doorIdx, sectIdx };
  $('panelForm').classList.add('section-edit-mode');
  // v1.2: cols/rows для title — per-door
  const dOpt = getDoorSectOpt(doorIdx);
  const cols = dOpt.colRatios.length;
  const rows = dOpt.rowRatios.length;
  let title = 'Дверь ' + (doorIdx + 1);
  if (rows > 1 || cols > 1) title += ' · Секция ' + (sectIdx + 1);
  $('sectionEditorTitle').textContent = title;
  // Сбрасываем поиск при каждом открытии редактора
  const search = $('matSearch');
  if (search) search.value = '';
  buildSectionMaterialList(doorIdx, sectIdx);
  buildDividersBlock();
  buildDoorEditTabs();
  updateDoorSectOptCard();
  updateFilmRow();
  updateTexRotRow();
  rerenderVisualization();
  // v1.4: на телефоне редактор секции находится выше превью — прокрутить к нему
  if (window.matchMedia('(max-width:768px)').matches) {
    const pf = $('panelForm');
    if (pf) pf.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// Фильтр по названию материала. Если query пустой — показать всё (групповые collapse возвращаются к default).
// Если в группе есть совпадение — авто-развернуть.
// ВАЖНО: .mat-btn-tex в CSS имеет `display:inline-block !important` — поэтому используем setProperty с приоритетом 'important',
// чтобы корректно скрывать/показывать textured кнопки Lamarty (иначе фильтр не работает).
function filterMaterials(query) {
  const list = $('sectionMaterialList');
  if (!list) return;
  const q = (query || '').trim().toLowerCase();
  const groups = list.querySelectorAll('.mat-group-collapsible');
  groups.forEach(grpLabel => {
    const body = grpLabel.nextElementSibling;
    if (!body) return;
    const btns = body.querySelectorAll('.mat-btn');
    let visibleCount = 0;
    btns.forEach(btn => {
      const txt = btn.textContent.toLowerCase();
      const matches = !q || txt.includes(q);
      // setProperty с 'important' перебивает CSS-правило `.mat-btn-tex { display:inline-block !important }`.
      if (matches) btn.style.removeProperty('display');
      else        btn.style.setProperty('display', 'none', 'important');
      if (matches) visibleCount++;
    });
    // Подгруппы (например «— Однотонные»): прячем если пустые
    body.querySelectorAll('.mat-subgroup-lbl').forEach(sub => {
      // Подгруппа = label + последующие btn до следующей подгруппы
      let next = sub.nextElementSibling;
      let subVisible = 0;
      while (next && !next.classList.contains('mat-subgroup-lbl')) {
        if (next.classList.contains('mat-btn') && next.style.display !== 'none') subVisible++;
        next = next.nextElementSibling;
      }
      sub.style.display = subVisible > 0 ? '' : 'none';
    });
    // Авто-развернуть группу если есть совпадения, свернуть если нет (при активном поиске)
    if (q && visibleCount > 0) {
      body.style.display = 'block';
      grpLabel.style.display = '';
      // Обновить индикатор ▾/▸
      const label = grpLabel.textContent.replace(/^[▸▾]\s*/, '');
      grpLabel.innerHTML = '▾ ' + label;
    } else if (q && visibleCount === 0) {
      grpLabel.style.display = 'none';
    } else {
      // Очистка поиска — показать заголовок снова
      grpLabel.style.display = '';
    }
  });
}

// === Поворот текстуры ЛДСП (per-door) ===
// Показывает карточку только когда в текущей двери есть материал с tex (ЛДСП Lamarty).
function updateTexRotRow() {
  const card = $('texRotCard'); if (!card) return;
  const di = activeSection ? activeSection.doorIdx : 0;
  const dSects = doorFills[di] || [];
  const hasLdsp = dSects.some(s => s && s.tex);
  card.style.display = hasLdsp ? 'block' : 'none';
  if (hasLdsp) {
    $('texRotToggle').checked = !!doorTexRot[di];
    const rotated = !!doorTexRot[di];
    $('texRotDesc').textContent = rotated
      ? 'Длина листа (2750 мм) — по горизонтали. Лимит двери: 2750×1830 мм'
      : 'Лист 2750×1830 мм · поворот текстуры на 90°';
  }
}

function onTexRotToggle() {
  if (!activeSection) return;
  const di = activeSection.doorIdx;
  doorTexRot[di] = $('texRotToggle').checked;
  updateTexRotRow();
  rerenderVisualization(); // мгновенно показываем новый поворот текстуры
  updateDisplay();         // перепроверить лимит листа (может вывести alert)
}

function closeSectionEditor() {
  activeSection = null;
  $('panelForm').classList.remove('section-edit-mode');
  rerenderVisualization();
  // v1.4: на телефоне вернуть пользователя к превью дверей
  if (window.matchMedia('(max-width:768px)').matches) {
    const vs = $('kupeVizStage');
    if (vs) vs.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// Группы со множеством текстур (>20) → свёрнуты по умолчанию, чтобы не грузить 121 jpg разом.
// v1.3.1: ВСЕ группы свёрнуты по умолчанию (раскрывается только та где находится текущий материал)
const LARGE_GROUPS_COLLAPSED = null; // null = collapse all

function buildSectionMaterialList(doorIdx, sectIdx) {
  const container = $('sectionMaterialList');
  if (!container) return;
  container.innerHTML = '';
  const current = (doorFills[doorIdx] || [])[sectIdx] || FILLINGS[0];

  // Сгруппируем FILLINGS по g для управления collapse
  const byGroup = {};
  const groupOrder = [];
  FILLINGS.forEach((f, fi) => {
    if (!byGroup[f.g]) { byGroup[f.g] = []; groupOrder.push(f.g); }
    byGroup[f.g].push({ f, fi });
  });

  groupOrder.forEach(groupName => {
    const items = byGroup[groupName];
    // v1.3.1: по умолчанию ВСЕ группы свёрнуты (если LARGE_GROUPS_COLLAPSED===null) или только перечисленные
    const isLargeCollapsed = LARGE_GROUPS_COLLAPSED === null ? true : LARGE_GROUPS_COLLAPSED.has(groupName);
    // Если в группе есть текущий выбранный — раскрыть её (UX: пользователь видит где он сейчас)
    const hasActive = items.some(it => it.f === current);
    const isCollapsed = isLargeCollapsed && !hasActive;

    const grp = document.createElement('div');
    grp.className = 'mat-group-lbl mat-group-collapsible';
    grp.innerHTML = (isCollapsed ? '▸ ' : '▾ ') + groupName +
                    ' <span style="color:#999;font-weight:400;font-size:9.5px">(' + items.length + ')</span>';
    grp.style.cursor = 'pointer';
    container.appendChild(grp);

    const groupBody = document.createElement('div');
    groupBody.className = 'mat-group-body';
    groupBody.style.display = isCollapsed ? 'none' : 'block';
    container.appendChild(groupBody);

    grp.onclick = () => {
      const collapsed = groupBody.style.display === 'none';
      groupBody.style.display = collapsed ? 'block' : 'none';
      grp.innerHTML = (collapsed ? '▾ ' : '▸ ') + groupName +
                      ' <span style="color:#999;font-weight:400;font-size:9.5px">(' + items.length + ')</span>';
    };

    let currentSubCat = '';
    items.forEach(({ f, fi }) => {
      if (f.cat && f.cat !== currentSubCat) {
        const sub = document.createElement('div');
        sub.className = 'mat-subgroup-lbl';
        sub.textContent = '— ' + f.cat + (f.tier ? ' · ' + f.tier : '');
        groupBody.appendChild(sub);
        currentSubCat = f.cat;
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mat-btn' + (f === current ? ' active' : '') + (f.tex ? ' mat-btn-tex' : '');
      btn.onclick = () => setSectionFill(doorIdx, sectIdx, fi);
      if (f.tex) {
        // data-src вместо src — реальная загрузка через IntersectionObserver когда thumb попадает в viewport.
        // Это снижает первичную нагрузку с 121 параллельных запросов до ~10-15 видимых.
        btn.innerHTML = '<img data-src="' + escapeAttr(f.tex) + '" alt="" class="mat-btn-thumb">' +
                        '<span class="mat-btn-label">' + escapeHtml(f.n) + '</span>';
      } else {
        btn.textContent = f.n + ' — ' + fmt(f.p) + ' ₽/м²';
      }
      groupBody.appendChild(btn);
    });
  });
  // Активируем IntersectionObserver для всех <img data-src> в списке
  setupLazyImages(container);
}

// Один IntersectionObserver на весь Section Editor — устанавливает src когда thumb виден.
let _lazyObserver = null;
function setupLazyImages(container) {
  if (!('IntersectionObserver' in window)) {
    // Fallback: грузим всё разом
    container.querySelectorAll('img[data-src]').forEach(img => {
      img.src = img.dataset.src; img.removeAttribute('data-src');
    });
    return;
  }
  if (!_lazyObserver) {
    _lazyObserver = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          const img = e.target;
          if (img.dataset.src) {
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
          }
          _lazyObserver.unobserve(img);
        }
      });
    }, { root: null, rootMargin: '200px 0px', threshold: 0.01 });
  } else {
    // Сбросить наблюдение предыдущих img
    _lazyObserver.disconnect();
  }
  container.querySelectorAll('img[data-src]').forEach(img => _lazyObserver.observe(img));
}

function setSectionFill(doorIdx, sectIdx, fillIdx) {
  if (!doorFills[doorIdx]) return;
  doorFills[doorIdx][sectIdx] = FILLINGS[fillIdx];
  buildSectionMaterialList(doorIdx, sectIdx);
  updateFilmRow();
  updateTexRotRow();
  // Обновляем превью НЕМЕДЛЕННО, даже если последующий calculate упадёт на валидации листа ЛДСП.
  // Это даёт менеджеру визуальную обратную связь: «вот материал, но дверь слишком большая — поверни или раздели».
  rerenderVisualization();
  updateDisplay(); // пересчитать цену если результаты уже показаны (может выйти на alert о листе)
}

function applyToAllDoors() {
  if (!activeSection) return;
  const fill = (doorFills[activeSection.doorIdx] || [])[activeSection.sectIdx] || FILLINGS[0];
  // Защита от случайного клика — потеря материалов на других дверях необратима.
  // v1.2: label — per-door (sect count может различаться)
  const activeCount = getDoorSectCount(activeSection.doorIdx);
  const sectLabel = activeCount > 1
    ? 'секции ' + (activeSection.sectIdx + 1)
    : 'двери';
  if (!confirm('Применить материал «' + fill.n + '» к ' + sectLabel + ' всех дверей?\nТекущие материалы будут заменены.\nЕсли у других дверей меньше секций — материал применится только к существующим.')) return;
  doorFills.forEach(df => { if (df && activeSection.sectIdx < df.length) df[activeSection.sectIdx] = fill; });
  updateDisplay();
}

function applyToAllSections() {
  if (!activeSection) return;
  const fill = (doorFills[activeSection.doorIdx] || [])[activeSection.sectIdx] || FILLINGS[0];
  if (doorFills[activeSection.doorIdx]) {
    doorFills[activeSection.doorIdx] = doorFills[activeSection.doorIdx].map(() => fill);
  }
  buildSectionMaterialList(activeSection.doorIdx, activeSection.sectIdx);
  updateDisplay();
}

/* ============================================================
   BULK OPERATIONS (v1.2) — массовое редактирование всех дверей
   ============================================================
   Все bulk-функции работают НЕ требуя открытого Section Editor.
   Селекторы заполняются populateBulkSelectors() при init и при смене N.
*/

function populateBulkSelectors() {
  const fillSel = $('bulkFillSel');
  if (fillSel) {
    fillSel.innerHTML = '';
    FILLINGS.forEach((f, i) => {
      const op = document.createElement('option');
      op.value = i;
      op.textContent = f.n + (f.p ? '  · ' + fmt(f.p) + ' ₽/м²' : '');
      fillSel.appendChild(op);
    });
  }
  const fromSel = $('bulkCopyFrom');
  const toSel = $('bulkCopyTo');
  if (!fromSel || !toSel) return;
  const N = num('doorCount', 2);
  const opts = [];
  for (let i = 0; i < N; i++) opts.push('<option value="' + i + '">Дверь ' + (i + 1) + '</option>');
  fromSel.innerHTML = opts.join('');
  toSel.innerHTML = opts.join('');
  if (N >= 2) { fromSel.value = '0'; toSel.value = '1'; }
}

function bulkClearAllFills() {
  if (!confirm('Сбросить ВСЕ полотна на материал по умолчанию (' + FILLINGS[0].n + ')?\nВся ручная настройка будет потеряна.')) return;
  const N = num('doorCount', 2);
  const sectCount = sectOpt.rowRatios.length * sectOpt.colRatios.length;
  doorFills = Array.from({length: N}, () => Array.from({length: sectCount}, () => FILLINGS[0]));
  if (activeSection) buildSectionMaterialList(activeSection.doorIdx, activeSection.sectIdx);
  updateDisplay();
}

function bulkApplyFillToAll() {
  const fi = parseInt(($('bulkFillSel') || {}).value, 10);
  if (!Number.isFinite(fi) || !FILLINGS[fi]) { alert('Выберите материал в селекторе'); return; }
  const fill = FILLINGS[fi];
  const N = num('doorCount', 2);
  if (!confirm('Применить материал «' + fill.n + '» ко ВСЕМ секциям ВСЕХ ' + N + ' дверей?\nТекущие материалы будут заменены.')) return;
  // v1.2: per-door sectCount — у override-дверей может быть больше секций чем у общей сетки
  initDoorFills(N, sectOpt.rowRatios.length * sectOpt.colRatios.length);
  for (let di = 0; di < N; di++) {
    const doorCount = getDoorSectCount(di);
    if (!doorFills[di] || doorFills[di].length !== doorCount) {
      doorFills[di] = Array.from({length: doorCount}, () => fill);
    } else {
      for (let si = 0; si < doorCount; si++) doorFills[di][si] = fill;
    }
  }
  if (activeSection) buildSectionMaterialList(activeSection.doorIdx, activeSection.sectIdx);
  updateDisplay();
}

function bulkCopyDoor() {
  const from = parseInt(($('bulkCopyFrom') || {}).value, 10);
  const to   = parseInt(($('bulkCopyTo')   || {}).value, 10);
  const N = num('doorCount', 2);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to < 0 || from >= N || to >= N) {
    alert('Некорректный выбор дверей'); return;
  }
  if (from === to) { alert('Выберите разные двери: откуда копировать и куда'); return; }
  // Копируем материалы (включая ссылки на FILLINGS — это OK, объекты не мутируются)
  if (doorFills[from]) {
    doorFills[to] = doorFills[from].slice();
  }
  // Копируем высоты разделителей
  if (doorRowMm[from] && doorRowMm[from].length) {
    doorRowMm[to] = doorRowMm[from].slice();
  }
  // Поворот текстуры ЛДСП
  doorTexRot[to] = !!doorTexRot[from];
  // Per-door sectOpt (если уже поддерживается — Часть 3)
  if (typeof doorSectOpt !== 'undefined' && doorSectOpt[from]) {
    doorSectOpt[to] = doorSectOpt[from];
  }
  if (activeSection && activeSection.doorIdx === to) {
    buildSectionMaterialList(to, activeSection.sectIdx);
    buildDividersBlock();
    updateTexRotRow();
  }
  updateDisplay();
}

function bulkResetDividers() {
  if (!confirm('Распределить разделители всех дверей равномерно по высоте? Ручная настройка перетягивания будет сброшена.')) return;
  doorRowMm = [];
  rowMm = [];
  if (activeSection) buildDividersBlock();
  updateDisplay();
}

/* ============================================================
   PROFILE SECTION PREVIEW (v1.2) — модал сечения профиля
   ============================================================ */

function showProfileSection() {
  const sysIdx = num('profileSystem', 0);
  const sys = PROFILE_SYSTEMS[sysIdx];
  if (!sys) return;
  const info = (typeof getSectionForSystem === 'function') ? getSectionForSystem(sys) : null;
  const modal = $('profileSectionModal');
  const titleEl = $('psecModalTitle');
  const imgEl   = $('psecModalImg');
  const phEl    = $('psecModalPlaceholder');
  const metaEl  = $('psecModalMeta');
  const descEl  = $('psecModalDesc');
  if (!modal) return;
  // Заголовок: предпочитаем title из каталога, иначе human-readable system+цвет
  const fallbackTitle = (sys.system || sys.profile || 'Профиль');
  titleEl.textContent = (info && info.title) ? info.title : fallbackTitle;
  // Мета: ширина рамки + габариты системы (frameSide/Top/Bot) — всегда полезно
  const dms = sys.dims || {};
  const metaParts = [];
  if (info && Number.isFinite(info.width)) metaParts.push('Рамка ' + info.width + ' мм');
  else if (Number.isFinite(dms.frameSide)) metaParts.push('Рамка ' + dms.frameSide + ' мм');
  if (Number.isFinite(dms.divider)) metaParts.push('Разделитель ' + dms.divider + ' мм');
  if (Number.isFinite(dms.trackTop) || Number.isFinite(dms.trackBot)) {
    metaParts.push('Трек ' + (dms.trackTop || '?') + ' / ' + (dms.trackBot || '?') + ' мм');
  }
  if (sys.limits) {
    metaParts.push('H ' + sys.limits.Hmin + '–' + sys.limits.Hmax + ' мм');
    metaParts.push('Дверь ' + sys.limits.doorL_min + '–' + sys.limits.doorL_max + ' мм');
  }
  metaEl.innerHTML = metaParts.map(p => '<strong>' + escapeHtml(p) + '</strong>').join(' · ');
  // Картинка vs placeholder
  if (info && info.img) {
    imgEl.style.display = '';
    phEl.style.display = 'none';
    imgEl.src = info.img;
    imgEl.alt = info.title || fallbackTitle;
    imgEl.onerror = () => {
      // если PNG не загрузился — показать placeholder
      imgEl.style.display = 'none';
      phEl.style.display = '';
    };
  } else {
    imgEl.style.display = 'none';
    phEl.style.display = '';
    imgEl.removeAttribute('src');
  }
  // Описание
  descEl.textContent = (info && info.description) ? info.description : 'Описание для этой системы пока не заполнено.';
  modal.style.display = 'flex';
  // Esc закрывает
  document.addEventListener('keydown', _psecEscHandler);
}

function closeProfileSection() {
  const modal = $('profileSectionModal');
  if (modal) modal.style.display = 'none';
  document.removeEventListener('keydown', _psecEscHandler);
}

function _psecEscHandler(e) {
  if (e.key === 'Escape') closeProfileSection();
}

/* ============================================================
   PER-DOOR SECTION UI (v1.2) — door-tabs + dso-card
   ============================================================
   buildDoorEditTabs()   — рисует чипсы 1..N для выбора активной двери
   updateDoorSectOptCard()— обновляет блок «своя сетка» под текущую дверь
   onToggleDoorSectIndiv()— тоггл «своя» для активной двери
   setDoorSectGridPreset(idx)— назначает пресет из SECTION_OPTS активной двери
   applySectOptToAllDoors()— bulk: сетка активной двери → все двери
*/

function buildDoorEditTabs() {
  const cont = $('doorEditTabs');
  if (!cont) return;
  const N = num('doorCount', 2);
  if (N <= 1) { cont.style.display = 'none'; return; }
  cont.style.display = 'flex';
  cont.innerHTML = '';
  for (let i = 0; i < N; i++) {
    const isActive = (i === activeDoorEdit);
    const overrideMark = hasDoorOverride(i) ? '<span class="det-badge">★</span>' : '';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'door-edit-tab' + (isActive ? ' active' : '');
    btn.innerHTML = 'Дв.' + (i + 1) + overrideMark;
    btn.title = hasDoorOverride(i)
      ? 'Дверь ' + (i + 1) + ' — своя сетка секций'
      : 'Дверь ' + (i + 1) + ' — общая сетка';
    btn.onclick = () => switchActiveDoor(i);
    cont.appendChild(btn);
  }
}

function switchActiveDoor(doorIdx) {
  const N = num('doorCount', 2);
  if (doorIdx < 0 || doorIdx >= N) return;
  activeDoorEdit = doorIdx;
  // Активная секция переключается на 0 новой двери (сектор может быть невалидным при разных sectCount)
  const cnt = getDoorSectCount(doorIdx);
  const sectIdx = (activeSection && activeSection.sectIdx < cnt) ? activeSection.sectIdx : 0;
  activeSection = { doorIdx, sectIdx };
  // Перестраиваем UI
  const dOpt = getDoorSectOpt(doorIdx);
  let title = 'Дверь ' + (doorIdx + 1);
  if (dOpt.rowRatios.length > 1 || dOpt.colRatios.length > 1) title += ' · Секция ' + (sectIdx + 1);
  $('sectionEditorTitle').textContent = title;
  buildDoorEditTabs();
  buildSectionMaterialList(doorIdx, sectIdx);
  buildDividersBlock();
  updateDoorSectOptCard();
  updateFilmRow();
  updateTexRotRow();
  rerenderVisualization();
}

function updateDoorSectOptCard() {
  const card = $('doorSectOptCard');
  if (!card) return;
  const N = num('doorCount', 2);
  if (N <= 1) { card.style.display = 'none'; return; }
  card.style.display = 'block';
  $('dsoDoorNum').textContent = 'Дверь ' + (activeDoorEdit + 1);
  const isOverride = hasDoorOverride(activeDoorEdit);
  $('doorSectIndiv').checked = isOverride;
  const curOpt = getDoorSectOpt(activeDoorEdit);
  $('dsoCurrentLabel').innerHTML = isOverride
    ? 'Своя сетка: <strong>' + escapeHtml(curOpt.label) + '</strong> (' + (curOpt.rowRatios.length * curOpt.colRatios.length) + ' секц.)'
    : 'Общая сетка: <strong>' + escapeHtml(sectOpt.label) + '</strong>';
  const grid = $('doorSectGrid');
  const applyBtn = $('dsoApplyAll');
  if (isOverride) {
    grid.style.display = 'grid';
    applyBtn.style.display = 'block';
    grid.innerHTML = '';
    SECTION_OPTS.forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      const sameRows = JSON.stringify(opt.rowRatios) === JSON.stringify(curOpt.rowRatios);
      const sameCols = JSON.stringify(opt.colRatios) === JSON.stringify(curOpt.colRatios);
      const isActive = sameRows && sameCols;
      btn.className = 'sect-btn' + (isActive ? ' active' : '');
      btn.innerHTML =
        '<svg width="22" height="15" viewBox="0 0 22 15" fill="none" stroke="currentColor" stroke-width="1.6">' +
        getSectSvg(opt.rowRatios, opt.colRatios) + '</svg>' +
        '<span>' + opt.label + '</span>';
      btn.onclick = () => setDoorSectGridPreset(idx);
      grid.appendChild(btn);
    });
  } else {
    grid.style.display = 'none';
    applyBtn.style.display = 'none';
    grid.innerHTML = '';
  }
}

function onToggleDoorSectIndiv() {
  const enabled = $('doorSectIndiv').checked;
  if (enabled) {
    // Включаем override — копируем текущий глобальный sectOpt как стартовую точку
    setDoorSectOpt(activeDoorEdit, sectOpt);
  } else {
    clearDoorSectOpt(activeDoorEdit);
  }
  // Перестроить редактор и визуализацию (sectCount мог измениться)
  if (activeSection) {
    const cnt = getDoorSectCount(activeDoorEdit);
    if (activeSection.sectIdx >= cnt) activeSection.sectIdx = 0;
    buildSectionMaterialList(activeDoorEdit, activeSection.sectIdx);
  }
  buildDividersBlock();
  updateDoorSectOptCard();
  buildDoorEditTabs();
  updateComplexRow();
  updateDisplay();
}

function setDoorSectGridPreset(optIdx) {
  const preset = SECTION_OPTS[optIdx];
  if (!preset) return;
  setDoorSectOpt(activeDoorEdit, preset);
  if (activeSection) {
    const cnt = getDoorSectCount(activeDoorEdit);
    if (activeSection.sectIdx >= cnt) activeSection.sectIdx = 0;
    buildSectionMaterialList(activeDoorEdit, activeSection.sectIdx);
  }
  buildDividersBlock();
  updateDoorSectOptCard();
  buildDoorEditTabs();
  updateComplexRow();
  updateDisplay();
}

function applySectOptToAllDoors() {
  const N = num('doorCount', 2);
  if (N <= 1) return;
  const dOpt = getDoorSectOpt(activeDoorEdit);
  if (!confirm('Применить сетку «' + dOpt.label + '» ко всем ' + N + ' дверям?\nИндивидуальные настройки сетки на других дверях будут заменены.')) return;
  for (let i = 0; i < N; i++) setDoorSectOpt(i, dOpt);
  buildDoorEditTabs();
  if (activeSection) buildSectionMaterialList(activeSection.doorIdx, activeSection.sectIdx);
  buildDividersBlock();
  updateDoorSectOptCard();
  updateComplexRow();
  updateDisplay();
}

/**
 * updateComplexRow() — пересчитывает видимость и текст «Сложная сборка»
 * по МАКСИМАЛЬНОМУ количеству секций среди всех дверей.
 * v1.2: раньше счёт был по глобальному sectOpt; теперь учитываем per-door override.
 */
function updateComplexRow() {
  const cr = $('complexRow');
  if (!cr) return;
  const N = num('doorCount', 2);
  let maxCnt = 0;
  for (let i = 0; i < N; i++) {
    const c = getDoorSectCount(i);
    if (c > maxCnt) maxCnt = c;
  }
  if (maxCnt >= COMPLEX_SECTIONS_THRESHOLD) {
    cr.style.display = 'flex';
    $('complexWork').checked = true;
    $('complexDesc').textContent =
      '+' + fmt(COMPLEX_WORK_PRICE) + ' ₽ за дверь (макс. ' + maxCnt + ' вставок, ≥ ' + COMPLEX_SECTIONS_THRESHOLD + ')';
  } else {
    cr.style.display = 'none';
  }
}

function updateFilmRow() {
  const allFills = [].concat(...doorFills);
  const films = allFills.map(f => f && getAutoFilm(f)).filter(Boolean);
  const filmCard = $('filmCard');
  const filmDesc = $('filmDesc');
  const filmToggle = $('filmToggle');
  if (films.length === 0) {
    if (filmCard) filmCard.style.display = 'none';
    if (filmToggle) filmToggle.checked = false;
    return;
  }
  if (filmCard) filmCard.style.display = '';
  const allSame = films.every(f => f.name === films[0].name);
  if (filmDesc) filmDesc.textContent = allSame
    ? films[0].name + ' · ' + fmt(films[0].p) + ' ₽/м²'
    : 'Зависит от материала (армировочная / противоосколочная)';
}

function rerenderVisualization() {
  const ld = window._lastCalcData;
  if (!ld || !$('vizRoom')) return;
  // v1.2: формируем актуальный массив per-door sect-опций (юзер мог сменить override без полного calculate)
  const N = num('doorCount', ld.N || 2);
  renderRoom('vizRoom', ld.W, ld.H, N, ld.bd, ld.isSinglePartition,
    doorFills, ld.frameGrad, ld.dims, getAllDoorSectOpts(N));
}

// === Двух-уровневый dropdown профилей: Семейство → Профиль → Цвет ===
// PROFILE_SYSTEMS[i].family — категория ('Стандарт', 'Эконом', 'SLIM LINE', 'NOVA', 'GRACE', 'Свои')
// PROFILE_SYSTEMS[i].profile — короткий лейбл для отображения в селекте профиля
// Реальный индекс sysIdx (в PROFILE_SYSTEMS) хранится в #profileSystem.value — это сохраняет совместимость с drafts.

function populateProfiles() {
  const FAMILIES = ['Стандарт', 'Эконом', 'SLIM LINE', 'NOVA', 'GRACE', 'Свои'];
  // 1. Семейства
  const selF = $('profileFamily');
  selF.innerHTML = '';
  FAMILIES.forEach(fam => {
    const op = document.createElement('option');
    op.value = fam;
    op.textContent = fam;
    selF.appendChild(op);
  });
  // 2. Профили первого семейства + первый цвет
  populateProfileSystemsForFamily(FAMILIES[0]);
}

function populateProfileSystemsForFamily(family) {
  const sel = $('profileSystem');
  sel.innerHTML = '';
  PROFILE_SYSTEMS.forEach((s, i) => {
    if (s.family !== family) return;
    const op = document.createElement('option');
    op.value = i;
    op.textContent = s.profile || s.system;
    sel.appendChild(op);
  });
  // Подцветить первый профиль семейства
  if (sel.options.length > 0) {
    populateProfileColors(parseInt(sel.options[0].value));
  }
}

function populateProfileColors(sysIdx) {
  const sel = $('profileColor');
  sel.innerHTML = '';
  PROFILE_SYSTEMS[sysIdx].colors.forEach((c, i) => {
    const op = document.createElement('option');
    op.value = i;
    op.textContent = c.name;
    sel.appendChild(op);
  });
}

function onProfileFamilyChange() {
  const fam = $('profileFamily').value;
  populateProfileSystemsForFamily(fam);
  updateDisplay(); // новое семейство → новый sysIdx по умолчанию → новые цены
}

function onProfileSystemChange() {
  const sysIdx = num('profileSystem', 0);
  populateProfileColors(sysIdx);
  updateDisplay(); // смена системы профиля → новые цены
}

function onProfileColorChange() {
  updateDisplay(); // смена цвета профиля → новые frameGrad + цены
}

function getCurrentProfile() {
  const sysIdx = num('profileSystem', 0);
  const colIdx = num('profileColor', 0);
  return PROFILE_SYSTEMS[sysIdx].colors[colIdx];
}

// v1.3.3: Тёмная тема убрана. Принудительно ставим light независимо от системных настроек.
// (Раньше initTheme падал на null btn → ломал ВЕСЬ init() — chips количества дверей и материалы не работали.)
function initTheme() {
  document.documentElement.setAttribute('data-theme', 'light');
  // Кнопка [data-theme-toggle] удалена из HTML — addEventListener больше не нужен.
}

function setThemeIcon(btn, theme) {
  // No-op (тёмная тема убрана; функция оставлена для совместимости со старыми вызовами).
  if (!btn) return;
}

/* ============================================================
   UI HELPERS
   ============================================================ */





function buildSectionBtns() {
  const grid = $('sectionsGrid');
  grid.innerHTML = '';
  SECTION_OPTS.forEach((opt, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sect-btn';
    btn.dataset.idx = idx;
    btn.innerHTML =
      '<svg width="22" height="15" viewBox="0 0 22 15" fill="none" stroke="currentColor" stroke-width="1.6">' +
      getSectSvg(opt.rowRatios, opt.colRatios) + '</svg>' +
      '<span>' + opt.label + '</span>';
    btn.onclick = () => setSections(idx);
    grid.appendChild(btn);
  });
}

/* SVG иконка секций — позиции линий по пропорциям ratios */
function getSectSvg(rowRatios, colRatios) {
  let s = '<rect x="0.8" y="0.8" width="20.4" height="13.4" rx="1.5"/>';
  let cumY = 0;
  for (let i = 0; i < rowRatios.length - 1; i++) {
    cumY += rowRatios[i];
    const y = (0.8 + cumY * 13.4).toFixed(1);
    s += '<line x1="0.8" y1="' + y + '" x2="21.2" y2="' + y + '"/>';
  }
  let cumX = 0;
  for (let i = 0; i < colRatios.length - 1; i++) {
    cumX += colRatios[i];
    const x = (0.8 + cumX * 20.4).toFixed(1);
    s += '<line x1="' + x + '" y1="0.8" x2="' + x + '" y2="14.2"/>';
  }
  return s;
}

function setSections(optIdx) {
  sectOpt = SECTION_OPTS[optIdx];
  sectH = sectOpt.h;
  sectV = sectOpt.v;
  document.querySelectorAll('#sectionsGrid .sect-btn').forEach(b =>
    b.classList.toggle('active', +b.dataset.idx === optIdx)
  );
  // v1.2: переинициализируем doorFills для дверей БЕЗ override (с override — оставляем).
  const newCount = sectOpt.rowRatios.length * sectOpt.colRatios.length;
  const N = num('doorCount', 2);
  for (let i = 0; i < N; i++) {
    if (hasDoorOverride(i)) continue; // override → не трогаем
    const cur = doorFills[i] || [];
    doorFills[i] = Array.from({length: newCount}, (_, si) => cur[si] || cur[cur.length - 1] || FILLINGS[0]);
  }
  // Сбросить rowMm — пересчитается при следующем рендере (per-door)
  rowMm = [];
  doorRowMm = [];
  // Активная дверь не меняется (если уже редактируется конкретная — пусть остаётся)
  if (activeDoorEdit >= N) activeDoorEdit = 0;
  buildDividersBlock();
  updateComplexRow();
  updateDoorSectOptCard();
  buildDoorEditTabs();
  updateDisplay();
}

function onDoorCountChange() {
  const n = num('doorCount', 2);
  const row = $('singlePartRow');
  row.style.display = n === 2 ? '' : 'none';
  if (n !== 2) $('singlePartition').checked = false;
  // Reinit doorFills для нового количества дверей
  const sectCount = sectOpt.rowRatios.length * sectOpt.colRatios.length;
  initDoorFills(n, sectCount);
  // Закрыть Section Editor если он смотрит на удалённую дверь (doorIdx >= n)
  if (activeSection && activeSection.doorIdx >= n) {
    closeSectionEditor();
  }
  // Очистить per-door массивы за пределами нового количества дверей
  if (doorTexRot.length > n) doorTexRot.length = n;
  if (doorSectOpt.length > n) doorSectOpt.length = n;
  if (doorRowMm.length > n) doorRowMm.length = n;
  // v1.2 — обновить bulk-селекторы под новое количество дверей
  if (typeof populateBulkSelectors === 'function') populateBulkSelectors();
  // Если editor открыт — обновить door-tabs (могло измениться кол-во чипсов)
  if (activeSection) {
    buildDoorEditTabs();
    updateDoorSectOptCard();
  }
  updateComplexRow();
  updateDisplay();
}



/* ============================================================
   PROFILE PRICE GRID
   ============================================================ */

/* ============================================================
   BUSINESS LOGIC — getAdjustedPrices()
   Возвращает цены профиля ×3 (фиксированная наценка)
   ============================================================ */
function getAdjustedPrices() {
  const PROF_MULT = 3;
  const p = getCurrentProfile();
  return {
    ruchka:      p.ruchka      * PROF_MULT,
    verh:        p.verh        * PROF_MULT,
    niz:         p.niz         * PROF_MULT,
    razd:        p.razd        * PROF_MULT,
    napravl_top: p.napravl_top * PROF_MULT,
    napravl_bot: p.napravl_bot * PROF_MULT,
  };
}

/* ============================================================
   BUSINESS LOGIC — calculate()
   Формула строго по ТЗ, расширена под napravl_top / napravl_bot
   ============================================================ */
function calculate(opts) {
  const silent = !!(opts && opts.silent); // true = пропустить строгие алерты (для live-пересчёта)
  const W = num('width');
  const H = num('height');
  const N = num('doorCount', 2);
  // v1.3.2: при live-пересчёте (silent) — НЕ показывать alert на частичный ввод (типа W=10 в процессе ввода 1050).
  // Просто молча выйти из расчёта; полная валидация только при явном «Рассчитать стоимость».
  if (!W || !H || !N) {
    if (!silent) alert('Укажите размеры проёма и количество дверей');
    return;
  }
  if (W < 400 || W > 4000) {
    if (!silent) alert('Ширина проёма должна быть от 400 до 4000 мм. Сейчас: ' + W + ' мм');
    return;
  }
  if (H < 600 || H > 3000) {
    if (!silent) alert('Высота проёма должна быть от 600 до 3000 мм. Сейчас: ' + H + ' мм');
    return;
  }
  if (N < 1 || N > 7) {
    if (!silent) alert('Количество дверей должно быть от 1 до 7. Сейчас: ' + N);
    return;
  }
  if (!Number.isFinite(W) || !Number.isFinite(H) || !Number.isFinite(N)) {
    if (!silent) alert('Некорректные числовые значения. Проверьте поля ширины/высоты/количества дверей.');
    return;
  }

  // Партиция: если тоггл включён при N=2 → оплачивается 1 дверь, иначе N
  const isSinglePartition = N === 2 && $('singlePartition').checked;
  const bd = isSinglePartition ? 1 : N;

  // Жёсткая валидация по вставкам ЛДСП (формат листа Lamarty 2750×1830):
  // КАЖДАЯ вставка с текстурой должна вмещаться в лист в выбранной ориентации (per-door).
  // Расчёт ведётся по реальным внутренним размерам секций (минус рамка и разделители).
  // В silent-режиме (живой пересчёт) — пропускаем алерт, валидация работает только при явном «Рассчитать стоимость».
  // v1.2: каждая дверь может иметь свою сетку секций (doorSectOpt[di]) — валидируем per-door по её ratios.
  if (!silent) {
    const doorL = W / N;
    const ldspViolations = [];
    // Геометрия профиля выбранной системы (frameSide, frameTop/Bot, divider) в мм
    const sysCheck = PROFILE_SYSTEMS[num('profileSystem', 0)] || PROFILE_SYSTEMS[0];
    const dms = sysCheck.dims || { frameSide:30, frameTop:40, frameBot:40, divider:20 };
    const innerW = doorL - 2 * dms.frameSide;
    const innerH = H - dms.frameTop - dms.frameBot;

    for (let di = 0; di < bd; di++) {
      const dOpt = getDoorSectOpt(di);
      const dRowRatios = dOpt.rowRatios;
      const dColRatios = dOpt.colRatios;
      const sumRows = dRowRatios.reduce((s, x) => s + x, 0);
      const sumCols = dColRatios.reduce((s, x) => s + x, 0);
      const contentW = innerW - (dColRatios.length - 1) * dms.divider;
      const contentH = innerH - (dRowRatios.length - 1) * dms.divider;
      const dSects = doorFills[di] || [];
      const rotated = !!doorTexRot[di];
      const maxW = rotated ? LDSP_SHEET_LONG : LDSP_SHEET_SHORT;   // вертик: 1830, горизонт: 2750
      const maxH = rotated ? LDSP_SHEET_SHORT : LDSP_SHEET_LONG;   // вертик: 2750, горизонт: 1830
      for (let r = 0; r < dRowRatios.length; r++) {
        for (let c = 0; c < dColRatios.length; c++) {
          const si = r * dColRatios.length + c;
          const f = dSects[si];
          if (!f || !f.tex) continue;
          const sW = Math.round((dColRatios[c] / sumCols) * contentW);
          const sH = Math.round((dRowRatios[r] / sumRows) * contentH);
          if (sW > maxW || sH > maxH) {
            const sectLabel = dRowRatios.length * dColRatios.length > 1
              ? ', секция ' + (si + 1)
              : '';
            ldspViolations.push(
              'Дверь ' + (di + 1) + sectLabel + ': вставка ' + sW + '×' + sH + ' мм — превышает лист ЛДСП ' +
              maxW + '×' + maxH + ' мм (' + (rotated ? 'горизонтальная' : 'вертикальная') + ' укладка)'
            );
          }
        }
      }
    }
    if (ldspViolations.length > 0) {
      alert(
        '❌ ЛДСП Lamarty: вставка превышает формат листа 2750×1830 мм.\n\n• ' +
        ldspViolations.join('\n• ') +
        '\n\nЧто можно сделать:\n' +
        '  — Включить «↻ Горизонтальная укладка» в редакторе секции (поменяет ориентацию)\n' +
        '  — Разбить дверь на несколько секций (сетка «2 равные», «3 гориз.» и т.д.)\n' +
        '  — Уменьшить размер двери'
      );
      return;
    }
  }

  // Per-system валидация (limits из каталога Аристо)
  const sysIdxValid = num('profileSystem', 0);
  const sys = PROFILE_SYSTEMS[sysIdxValid];
  if (sys && sys.limits) {
    const L = sys.limits;
    const doorL = Math.round(W / N);
    const violations = [];
    if (H < L.Hmin || H > L.Hmax) {
      violations.push('Высота двери: ' + H + ' мм (допустимо ' + L.Hmin + '–' + L.Hmax + ' мм для системы «' + sys.system + '»)');
    }
    if (doorL < L.doorL_min || doorL > L.doorL_max) {
      violations.push('Ширина одной двери: ' + doorL + ' мм (W/N = ' + W + '/' + N + '; допустимо ' + L.doorL_min + '–' + L.doorL_max + ' мм для системы «' + sys.system + '»)');
    }
    if (violations.length > 0) {
      const proceed = confirm(
        '⚠️ Размеры вне каталоговых пределов Аристо:\n\n• ' + violations.join('\n• ') +
        '\n\nРассчитать всё равно?\n(OK — продолжить, Cancel — изменить параметры)'
      );
      if (!proceed) return;
    }
  }

  const softClose = $('softClose').checked;
  // Сложная сборка: только если complexRow видим (секций на дверь ≥ 4)
  const complexRow = $('complexRow');
  const complexWork = complexRow.style.display !== 'none' && $('complexWork').checked;
  const fillMarkupMult = 1 + (num('fillMarkup') / 100);
  const p = getAdjustedPrices();

  const dw = W / N;

  // 1. Площадь и стоимость наполнения — per door × per section
  // v1.2: каждая дверь использует СВОЙ sectOpt (общий или override через doorSectOpt[di]).
  // sectCount может различаться от двери к двери.
  const totalAreaPerDoor = (dw / 1000) * (H / 1000);
  const areaM2 = totalAreaPerDoor * bd;
  // Инициализация: doorFills под глобальный sectOpt; per-door override уже подогнан в setDoorSectOpt().
  initDoorFills(N, sectOpt.rowRatios.length * sectOpt.colRatios.length);
  let filCost = 0;
  // 2D breakdown: sectionBreakdown2D[doorIdx][sectIdx]
  const sectionBreakdown2D = [];
  // Для агрегации в плоский breakdown будем суммировать по уникальным {row, col, isOverride}
  // Если у всех дверей одинаковая сетка (нет ни одного override) — плоский breakdown совпадает по
  // структуре с исторической версией (по индексу секции).
  const anyOverride = hasAnyDoorOverride();
  for (let di = 0; di < bd; di++) {
    const dOpt = getDoorSectOpt(di);
    const dRowRatios = dOpt.rowRatios;
    const dColRatios = dOpt.colRatios;
    const dFills = doorFills[di] || [FILLINGS[0]];
    sectionBreakdown2D[di] = [];
    for (let r = 0; r < dRowRatios.length; r++) {
      for (let c = 0; c < dColRatios.length; c++) {
        const si = r * dColRatios.length + c;
        const f = dFills[si] || dFills[0] || FILLINGS[0];
        const sArea = totalAreaPerDoor * dRowRatios[r] * dColRatios[c];
        // NaN guard: если f.p отсутствует или невалиден — считаем 0, иначе цена пойдёт NaN→NaN в КП.
        const basePrice = Number.isFinite(f.p) ? f.p : 0;
        const sPrice = basePrice * fillMarkupMult;
        sectionBreakdown2D[di].push({ fill: f, sArea, fillPriceAdj: sPrice, cost: sArea * sPrice });
        filCost += sArea * sPrice;
      }
    }
  }
  // Плоский breakdown для отображения справа.
  // Если все двери одинаковы по сетке — агрегируем по индексу секции (как в v1.1).
  // Если есть override — показываем агрегацию по дверям: «Дверь 1 · 3 секции · ...».
  const sectionBreakdown = [];
  if (!anyOverride) {
    const sectCount = sectOpt.rowRatios.length * sectOpt.colRatios.length;
    for (let si = 0; si < sectCount; si++) {
      const ref = (sectionBreakdown2D[0] && sectionBreakdown2D[0][si]) || { fill: FILLINGS[0], fillPriceAdj: FILLINGS[0].p * fillMarkupMult };
      const sArea = sectionBreakdown2D.reduce((s, dBd) => s + (dBd[si] ? dBd[si].sArea : 0), 0);
      const cost  = sectionBreakdown2D.reduce((s, dBd) => s + (dBd[si] ? dBd[si].cost  : 0), 0);
      sectionBreakdown.push({ fill: ref.fill, sArea, fillPriceAdj: ref.fillPriceAdj, cost });
    }
  } else {
    // Per-door агрегация: каждая дверь — отдельная строка
    sectionBreakdown2D.forEach((dBd, di) => {
      const dArea = dBd.reduce((s, x) => s + x.sArea, 0);
      const dCost = dBd.reduce((s, x) => s + x.cost, 0);
      const refFill = (dBd[0] || {}).fill || FILLINGS[0];
      const refPrice = (dBd[0] || {}).fillPriceAdj || (refFill.p * fillMarkupMult);
      sectionBreakdown.push({
        fill: refFill, sArea: dArea, fillPriceAdj: refPrice, cost: dCost,
        doorIdx: di, sectCount: dBd.length,
      });
    });
  }
  const fill = (doorFills[0] && doorFills[0][0]) || FILLINGS[0];
  const fillPriceAdj = (sectionBreakdown[0] || { fillPriceAdj: fill.p * fillMarkupMult }).fillPriceAdj;
  // Уникальные материалы для заголовка
  const allFillsFlat = [].concat(...doorFills.slice(0, bd));
  const uniqueFills = allFillsFlat.filter((f, i, arr) => arr.indexOf(f) === i);

  // 2. Профиль — детализация
  const profRows = [];

  // Ручка = вертикальный профиль, 2 шт на дверь, длина = H
  const lenRuchka = H * 2 * bd;
  profRows.push({
    n: 'Ручка (вертикаль)',
    note: '2 × ' + bd.toFixed(2) + ' дв.',
    l: lenRuchka,
    pr: p.ruchka,
    c: (lenRuchka / 1000) * p.ruchka,
  });

  // Верх двери
  const lenVerh = dw * bd;
  profRows.push({
    n: 'Верх двери',
    note: bd.toFixed(2) + ' дв.',
    l: lenVerh,
    pr: p.verh,
    c: (lenVerh / 1000) * p.verh,
  });

  // Низ двери
  const lenNiz = dw * bd;
  profRows.push({
    n: 'Низ двери',
    note: bd.toFixed(2) + ' дв.',
    l: lenNiz,
    pr: p.niz,
    c: (lenNiz / 1000) * p.niz,
  });

  // Горизонтальные и вертикальные разделители — v1.2: суммируем по дверям
  // (у каждой двери может быть свой sectOpt.h/v через override).
  let sumHorizDivLen = 0; // мм
  let sumVertDivLen  = 0; // мм
  let sumHorizDivPcs = 0;
  let sumVertDivPcs  = 0;
  let maxH_perDoor = 0, maxV_perDoor = 0;
  for (let di = 0; di < bd; di++) {
    const dOpt = getDoorSectOpt(di);
    const dH = dOpt.h || 0; // горизонт. разделителей на дверь
    const dV = dOpt.v || 0; // вертик. разделителей на дверь
    sumHorizDivLen += dw * dH;
    sumVertDivLen  += H * dV;
    sumHorizDivPcs += dH;
    sumVertDivPcs  += dV;
    if (dH > maxH_perDoor) maxH_perDoor = dH;
    if (dV > maxV_perDoor) maxV_perDoor = dV;
  }
  if (sumHorizDivLen > 0) {
    const sameAcrossDoors = (sumHorizDivPcs === bd * maxH_perDoor);
    profRows.push({
      n: 'Разд. горизонт.' + (sameAcrossDoors ? ' (' + maxH_perDoor + ' шт/дв.)' : ' (разные по дверям)'),
      note: sumHorizDivPcs.toFixed(2) + ' шт',
      l: sumHorizDivLen,
      pr: p.razd,
      c: (sumHorizDivLen / 1000) * p.razd,
    });
  }
  if (sumVertDivLen > 0) {
    const sameAcrossDoors = (sumVertDivPcs === bd * maxV_perDoor);
    profRows.push({
      n: 'Разд. вертикал.' + (sameAcrossDoors ? ' (' + maxV_perDoor + ' шт/дв.)' : ' (разные по дверям)'),
      note: sumVertDivPcs.toFixed(2) + ' шт',
      l: sumVertDivLen,
      pr: p.razd,
      c: (sumVertDivLen / 1000) * p.razd,
    });
  }

  // Направляющие — по ширине ВСЕГО проёма (не зависят от bd)
  // v1.2: для подвесных систем (systemKind='hang') нижний трек отсутствует
  // (docs/aristo-reference.md:20: «GRACE — Подвесная, без нижнего трека»)
  const sysForKind = PROFILE_SYSTEMS[num('profileSystem', 0)] || PROFILE_SYSTEMS[0];
  const sysKind = sysForKind.systemKind || 'slide';
  profRows.push({
    n: sysKind === 'hang' ? 'Направляющая верхняя (подвесная)' : 'Направляющая верхняя',
    note: 'по проёму',
    l: W,
    pr: p.napravl_top,
    c: (W / 1000) * p.napravl_top,
  });
  if (sysKind !== 'hang') {
    // Раздвижная — нижний трек считается
    profRows.push({
      n: 'Направляющая нижняя',
      note: 'по проёму',
      l: W,
      pr: p.napravl_bot,
      c: (W / 1000) * p.napravl_bot,
    });
  }

  // v1.2: hardwarePerDoor — комплект штучной фурнитуры (ролики, подвесы, стопоры, декор)
  // для систем где это применимо (GRACE и т.д.). Учитывается per door (× bd).
  if (sysForKind.hardwarePerDoor && Number.isFinite(sysForKind.hardwarePerDoor)) {
    profRows.push({
      n: sysForKind.hardwareLabel || 'Комплект фурнитуры',
      note: bd.toFixed(2) + ' дв.',
      l: 0,
      pr: sysForKind.hardwarePerDoor,
      c: sysForKind.hardwarePerDoor * bd,
    });
  }

  const profTotal = profRows.reduce((s, r) => s + r.c, 0);

  // 3. Фурнитура и работа
  const softCloseCost = softClose ? SOFT_CLOSE_PRICE * bd : 0;
  const complexCost   = complexWork ? COMPLEX_WORK_PRICE * bd : 0;

  // Плёнка — рассчитывается по каждой двери × секции
  const filmOn = $('filmToggle') && $('filmToggle').checked;
  let filmCost = 0;
  if (filmOn) {
    sectionBreakdown2D.forEach(dBd => {
      dBd.forEach(s => {
        const f = getAutoFilm(s.fill);
        if (f) filmCost += s.sArea * f.p;
      });
    });
  }
  const film = getAutoFilm(fill); // для отображения (первая секция)

  const total = filCost + profTotal + softCloseCost + complexCost + filmCost;

  const sysIdx = num('profileSystem', 0);
  const colIdx = num('profileColor', 0);
  const profileColor = PROFILE_SYSTEMS[sysIdx].colors[colIdx];
  const profileName = PROFILE_SYSTEMS[sysIdx].system + ' · ' + profileColor.name;
  const frameGrad = profileColor.frameGrad || '#c0c0c0,#e0e0e0,#a0a0a0';
  const dims = PROFILE_SYSTEMS[sysIdx].dims;

  renderResults({
    W, H, N, bd, isSinglePartition,
    fills: uniqueFills, fill, sectionBreakdown, sectionBreakdown2D, fillPriceAdj, areaM2, filCost,
    doorFills: doorFills.map(a => a.slice()),
    profRows, profTotal,
    softClose, softCloseCost,
    complexWork, complexCost,
    film, filmOn, filmCost,
    total, profileName, frameGrad, dims, sectOpt,
    // v1.2: передаём массив per-door sect-опций для визуализации
    doorSectOptArr: getAllDoorSectOpts(N),
    hasOverride: hasAnyDoorOverride(),
  });
}

/* ============================================================
   RENDER — renderResults()
   ============================================================ */
function renderResults(d) {
  // Hide left empty, show viz center
  $('emptyState').style.display = 'none';
  if ($('kupeVizArea')) $('kupeVizArea').style.display = 'flex';

  // Hide right empty, show results
  if ($('kupeResultEmpty')) $('kupeResultEmpty').style.display = 'none';
  const rc = $('resultContent');
  rc.style.display = 'flex';

  const isPartition = d.isSinglePartition;
  const bdDisplay = String(d.bd);

  // Project number — generate once per session
  if (!window._kupeProjectNum) window._kupeProjectNum = generateProjectNum();
  if ($('kupeProjNum'))  $('kupeProjNum').textContent  = window._kupeProjectNum;
  if ($('kupeProjMeta')) $('kupeProjMeta').textContent =
    d.W + ' × ' + d.H + ' мм · ' + d.N + ' ' + pluralDoors(d.N).toUpperCase();

  // Build spec items: profile rows + fillings + extras
  const specItems = [];
  // Profile pieces
  d.profRows.forEach(r => {
    specItems.push({ name:r.n, qty:fmt(r.l) + ' мм', sum:r.c });
  });
  // Fillings
  if (d.sectionBreakdown.length === 1) {
    specItems.push({ name: d.fills[0].n, qty: d.areaM2.toFixed(2)+' м²', sum: d.filCost });
  } else {
    d.sectionBreakdown.forEach((s, i) => {
      specItems.push({ name:'Секц. '+(i+1)+' · '+s.fill.n, qty:s.sArea.toFixed(2)+' м²', sum:s.cost });
    });
  }
  // Extras
  if (d.filmCost > 0)      specItems.push({ name:'Защитная плёнка', qty:d.areaM2.toFixed(2)+' м²', sum:d.filmCost });
  if (d.softCloseCost > 0) specItems.push({ name:'Доводчик',         qty:bdDisplay+' дв.',         sum:d.softCloseCost });
  if (d.complexCost > 0)   specItems.push({ name:'Сложная сборка',   qty:bdDisplay+' дв.',         sum:d.complexCost });

  const specHTML = specItems.map(it =>
    '<div class="kupe-spec-row">'+
      '<span class="kupe-spec-name">'+it.name+'</span>'+
      '<span class="kupe-spec-qty">'+it.qty+'</span>'+
      '<span class="kupe-spec-price">'+fmt(it.sum)+' ₽</span>'+
    '</div>'
  ).join('');

  // CLIENT: состав заказа человеческим языком, без цен компонентов
  const included = [];
  included.push('Профиль ' + d.profileName);
  d.fills.forEach(f => { if (f && f.n) included.push(f.n); });
  if (d.softCloseCost > 0)  included.push('Доводчики плавного закрывания');
  if (d.filmCost > 0)       included.push('Защитная плёнка на зеркала');
  if (d.complexCost > 0)    included.push('Сборка со вставками');
  included.push('Направляющие, ролики и фурнитура');
  const includedHTML = included.map(x => '<div class="client-inc-row">' + x + '</div>').join('');

  rc.innerHTML =
    // — Hero (ИТОГО + цена + meta)
    '<div>' +
      '<div class="kupe-hero-lbl">ИТОГО</div>' +
      '<div class="kupe-hero-price rh-value">' + fmt(d.total) + ' ₽</div>' +
      '<div class="kupe-hero-meta">' +
        d.N + ' ' + pluralDoors(d.N) + ' · ' + d.W + '×' + d.H + ' мм · ' +
        (d.fills.length === 1 ? d.fills[0].n : d.fills.length + ' материалов') +
        (isPartition ? ' · одиночная перегородка' : '') +
      '</div>' +
    '</div>' +

    // CLIENT: CTA — оформить заявку (форма + мессенджеры)
    '<button type="button" class="kupe-btn-order" onclick="openOrderModal()">Оформить заявку — бесплатный замер</button>' +

    // CLIENT: что входит в цену (без внутренней разбивки по компонентам)
    '<div>' +
      '<div class="kupe-sec-lbl" style="margin-bottom:6px">Что входит в цену</div>' +
      '<div class="client-included">' + includedHTML + '</div>' +
    '</div>' +

    // CLIENT: условия
    '<div class="client-terms">' +
      '<div class="client-term">Бесплатный замер по Нижнему Новгороду</div>' +
      '<div class="client-term">Изготовление — до 25 рабочих дней</div>' +
      '<div class="client-term">Установка — от 5 000 ₽ (по желанию)</div>' +
      '<div class="client-term">Договор и гарантия</div>' +
    '</div>';

  // v1.2: передаём per-door sect-опции (массив длины N) вместо одной
  renderRoom('vizRoom', d.W, d.H, d.N, d.bd, d.isSinglePartition, d.doorFills || [d.fills], d.frameGrad, d.dims, d.doorSectOptArr || d.sectOpt);

  // Сохраняем данные расчёта для КП
  window._lastCalcData = d;
  // v1.4: обновить «Итого» в мобильной нижней панели
  const mbarTotal = document.getElementById('kupeMobileTotal');
  if (mbarTotal) mbarTotal.textContent = fmt(d.total) + ' ₽';
  // v1.3: после расчёта — снять disabled с «Экспорт КП» (критика #1)
  const exportBtn = document.getElementById('kupeExportKPBtn');
  if (exportBtn) { exportBtn.removeAttribute('disabled'); exportBtn.removeAttribute('title'); }
  updateKPPreview();

  // Phase 5: обновить список заполнений в левой колонне
  if (typeof renderKupeFillsList === 'function') renderKupeFillsList();

  // CLIENT: блока КП нет — слушатель вешаем только если поле существует
  const kd = $('kpDelivery');
  if (kd) kd.addEventListener('input', updateKPPreview);
}

/* ============================================================
   RENDER — renderRoom()
   Визуализация: комната → направляющие → полотна → тень
   isSinglePartition: bool — вторая дверь не оплачивается (ghost)
   ============================================================ */
function renderRoom(containerId, W, H, N, bd, isSinglePartition, fills, frameGrad, dims, sectOptOrArr) {
  const room = $(containerId);
  if (!room) return;
  // Default dims if not provided
  const DM = dims || { frameSide:30, frameTop:40, frameBot:40, divider:20, trackTop:40, trackBot:12 };
  // v1.2: sectOptOrArr может быть массивом (per-door) или одним объектом (common)
  const _isOptArr = Array.isArray(sectOptOrArr);
  const _commonOpt = (_isOptArr ? null : sectOptOrArr) || SECTION_OPTS[0];
  function sOptForDoor(i) {
    if (_isOptArr) return sectOptOrArr[i] || sectOptOrArr[sectOptOrArr.length - 1] || _commonOpt;
    return _commonOpt;
  }

  const FLOOR_H = 64;
  const CORNICE_H = 14;

  // Адаптивное масштабирование: 230px = 2000мм (фиксированный масштаб)
  const BASELINE_DH = 230;
  const BASELINE_H_MM = 2000;
  const dw_mm = W / N;
  const availW = (room.clientWidth || 580) * 0.9;

  // dH пропорционально реальной высоте двери
  let dH = Math.round(BASELINE_DH * H / BASELINE_H_MM);
  dH = Math.min(dH, 320); // предел для очень высоких конструкций

  // dW из пропорций двери
  let dW = Math.round(dH * dw_mm / H);

  // Подогнать под ширину контейнера
  if (dW * N > availW) {
    dW = availW / N;
    dH = Math.round(dW * H / dw_mm);
  }
  dW = Math.round(dW);
  dH = Math.round(dH);
  const totalW = dW * N;
  const doorLeft = Math.round(((room.clientWidth || 580) - totalW) / 2);

  // pxPerMm — единый масштаб
  const pxPerMm = dH / H;
  if (containerId === 'vizRoom') window._vizPxPerMm = pxPerMm;

  // Направляющие — реальная толщина в пикселях
  const TRACK_TOP_H = Math.max(3, Math.round(DM.trackTop * pxPerMm));
  const TRACK_BOT_H = Math.max(2, Math.round(DM.trackBot * pxPerMm));

  // Адаптивная высота комнаты: ~500мм потолочного зазора над инсталляцией
  const aboveTrackPx = Math.max(CORNICE_H + 20, Math.round(500 * pxPerMm));
  const ROOM_H = FLOOR_H + TRACK_BOT_H + dH + TRACK_TOP_H + aboveTrackPx;
  const WALL_H = ROOM_H - FLOOR_H;

  room.style.cssText = 'width:100%;height:' + ROOM_H + 'px;position:relative;overflow:hidden;background:#e8e4da;';
  room.innerHTML = '';

  // — Стена (фон)
  room.appendChild(mkEl('div',
    'position:absolute;top:0;left:0;right:0;height:' + WALL_H + 'px;' +
    'background:linear-gradient(180deg,#f0ece3 0%,#e6e2d8 60%,#ddd8ce 100%);'
  ));

  // — Фактура стены (слабая текстура штукатурки)
  room.appendChild(mkEl('div',
    'position:absolute;top:0;left:0;right:0;height:' + WALL_H + 'px;' +
    'background-image:repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,.008) 3px,rgba(0,0,0,.008) 4px);' +
    'pointer-events:none;'
  ));

  // — Потолочный карниз
  room.appendChild(mkEl('div',
    'position:absolute;top:0;left:0;right:0;height:' + CORNICE_H + 'px;' +
    'background:linear-gradient(180deg,#f8f6f0 0%,#e2ded6 60%,#cac7be 100%);' +
    'box-shadow:0 3px 8px rgba(0,0,0,.12);z-index:2;'
  ));

  // — Боковые откосы проёма (слева и справа от двери)
  const REVEAL_W = 18;
  // левый откос
  const revealLeft = mkEl('div',
    'position:absolute;bottom:' + FLOOR_H + 'px;' +
    'left:' + (doorLeft - REVEAL_W) + 'px;' +
    'width:' + REVEAL_W + 'px;height:' + (dH + TRACK_TOP_H + TRACK_BOT_H + 4) + 'px;' +
    'background:linear-gradient(90deg,#cac7be 0%,#e8e4da 100%);' +
    'z-index:3;box-shadow:inset -2px 0 6px rgba(0,0,0,.1);'
  );
  room.appendChild(revealLeft);
  // правый откос
  const revealRight = mkEl('div',
    'position:absolute;bottom:' + FLOOR_H + 'px;' +
    'left:' + (doorLeft + totalW) + 'px;' +
    'width:' + REVEAL_W + 'px;height:' + (dH + TRACK_TOP_H + TRACK_BOT_H + 4) + 'px;' +
    'background:linear-gradient(90deg,#e8e4da 0%,#cac7be 100%);' +
    'z-index:3;box-shadow:inset 2px 0 6px rgba(0,0,0,.1);'
  );
  room.appendChild(revealRight);

  // — Плинтус
  room.appendChild(mkEl('div',
    'position:absolute;bottom:' + FLOOR_H + 'px;left:0;right:0;height:10px;' +
    'background:linear-gradient(180deg,#d4d0c6 0%,#b8b4aa 100%);z-index:1;'
  ));

  // — Пол с паркетными планками
  const floor = mkEl('div',
    'position:absolute;bottom:0;left:0;right:0;height:' + FLOOR_H + 'px;' +
    'background:linear-gradient(180deg,#c4a06a 0%,#b09055 40%,#c8a872 80%,#b89460 100%);overflow:hidden;'
  );
  // SVG паркетных полос
  let floorSvg = '<svg width="100%" height="' + FLOOR_H + '" style="position:absolute;top:0;left:0;opacity:.18" xmlns="http://www.w3.org/2000/svg">';
  for (let y = 10; y < FLOOR_H; y += 12) {
    floorSvg += '<line x1="0" y1="' + y + '" x2="100%" y2="' + y + '" stroke="#5a3a10" stroke-width="' + (y % 24 === 10 ? 1.2 : 0.5) + '"/>';
  }
  floorSvg += '</svg>';
  floor.innerHTML = floorSvg;
  // Перспективный градиент пола
  floor.appendChild(mkEl('div',
    'position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.08) 0%,transparent 60%);pointer-events:none;'
  ));
  room.appendChild(floor);

  // — Тень под дверями (мягкая, широкая)
  room.appendChild(mkEl('div',
    'position:absolute;bottom:' + (FLOOR_H - 2) + 'px;' +
    'left:' + (doorLeft - 20) + 'px;' +
    'width:' + (totalW + 40) + 'px;height:24px;' +
    'background:radial-gradient(ellipse 80% 100% at 50% 100%,rgba(0,0,0,.32) 0%,transparent 100%);' +
    'z-index:2;pointer-events:none;'
  ));

  // — Верхняя направляющая
  room.appendChild(mkEl('div',
    'position:absolute;' +
    'bottom:' + (FLOOR_H + TRACK_BOT_H + dH) + 'px;' +
    'left:' + doorLeft + 'px;' +
    'width:' + totalW + 'px;height:' + TRACK_TOP_H + 'px;' +
    'background:linear-gradient(180deg,#a8a8a8 0%,#d8d8d8 40%,#f0f0f0 70%,#c0c0c0 100%);' +
    'border-radius:2px 2px 0 0;' +
    'box-shadow:0 -2px 5px rgba(0,0,0,.18),inset 0 1px 2px rgba(255,255,255,.5);' +
    'z-index:5;'
  ));

  // — Нижняя направляющая
  room.appendChild(mkEl('div',
    'position:absolute;' +
    'bottom:' + FLOOR_H + 'px;' +
    'left:' + doorLeft + 'px;' +
    'width:' + totalW + 'px;height:' + TRACK_BOT_H + 'px;' +
    'background:linear-gradient(180deg,#787878 0%,#b0b0b0 50%,#d8d8d8 100%);' +
    'border-radius:0 0 2px 2px;' +
    'box-shadow:0 3px 6px rgba(0,0,0,.24);' +
    'z-index:5;'
  ));

  // — Контейнер дверей
  const dc = mkEl('div',
    'position:absolute;' +
    'bottom:' + (FLOOR_H + TRACK_BOT_H) + 'px;' +
    'left:' + doorLeft + 'px;' +
    'display:flex;align-items:flex-end;z-index:4;'
  );

  const isDraggable = containerId === 'vizRoom';
  // v1.3.5: в КП (страница 2) подписываем каждую секцию названием материала поверх полотна.
  const showLabels = containerId === 'kpVizRoom';
  for (let i = 0; i < N; i++) {
    const isGhost = isSinglePartition && i === 1;
    const doorOpacity = isGhost ? 0.22 : 1;
    // fills может быть 2D (doorFills) или 1D (legacy/KP)
    const dFills = Array.isArray(fills[0])
      ? (fills[i] || fills[fills.length - 1] || [FILLINGS[0]])
      : fills;
    // v1.2: для каждой двери берём её sectOpt (массив per-door или общий fallback)
    const _baseOpt = sOptForDoor(i);
    const _rows = _baseOpt.rowRatios.length;
    const _dRM  = (doorRowMm[i] && doorRowMm[i].length === _rows) ? doorRowMm[i] : null;
    const doorSO = _dRM
      ? Object.assign({}, _baseOpt, { rowRatios: _dRM.map(v => v / H) })
      : _baseOpt;
    const door = makeDoor(dW, dH, i, dFills, doorSO, doorOpacity, frameGrad, pxPerMm, DM, isDraggable, showLabels);
    if (i > 0) door.style.marginLeft = '-2px';
    dc.appendChild(door);
  }
  room.appendChild(dc);

  // — Линейка секций (справа от активной двери)
  // v1.2: используем sectOpt активной двери (может отличаться от соседних)
  const _activeOpt = sOptForDoor(Math.min(activeDoorEdit, N - 1));
  const _sectRows = _activeOpt.rowRatios.length;
  if (_sectRows > 1 && containerId === 'vizRoom') {
    const rIdx = Math.min(activeDoorEdit, N - 1);
    const rRm = (doorRowMm[rIdx] && doorRowMm[rIdx].length === _sectRows)
      ? doorRowMm[rIdx]
      : (rowMm.length === _sectRows ? rowMm : null);
    if (rRm) {
      const fTop_r = Math.max(2, Math.round(DM.frameTop * pxPerMm));
      const fBot_r = Math.max(2, Math.round(DM.frameBot * pxPerMm));
      const divW_r = Math.max(1, Math.round(DM.divider  * pxPerMm));
      const rulerX = doorLeft + rIdx * dW + dW + 8;

      // SVG-скобка: вертикальная линия + засечки
      const bSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      bSvg.setAttribute('width', '10');
      bSvg.setAttribute('height', dH);
      bSvg.setAttribute('viewBox', '0 0 10 ' + dH);
      bSvg.style.cssText =
        'position:absolute;left:' + rulerX + 'px;bottom:' + (FLOOR_H + TRACK_BOT_H) + 'px;' +
        'z-index:7;pointer-events:none;';
      let svgBody =
        '<line x1="8" y1="0" x2="8" y2="' + dH + '" stroke="rgba(80,70,60,.28)" stroke-width="1"/>' +
        '<line x1="4" y1="' + fTop_r + '" x2="8" y2="' + fTop_r + '" stroke="rgba(80,70,60,.28)" stroke-width="1"/>';
      let bCum = fTop_r;
      for (let r = 0; r < _sectRows; r++) {
        bCum += Math.round(rRm[r] * pxPerMm);
        if (r < _sectRows - 1) {
          svgBody += '<line x1="4" y1="' + bCum + '" x2="8" y2="' + bCum + '" stroke="rgba(80,70,60,.28)" stroke-width="1"/>';
          bCum += divW_r;
        }
      }
      svgBody += '<line x1="4" y1="' + (dH - fBot_r) + '" x2="8" y2="' + (dH - fBot_r) + '" stroke="rgba(80,70,60,.28)" stroke-width="1"/>';
      bSvg.innerHTML = svgBody;
      room.appendChild(bSvg);

      // Кликабельные mm-подписи для каждой секции
      let cumFromDoorTop = fTop_r;
      for (let r = 0; r < _sectRows; r++) {
        const sH     = Math.round(rRm[r] * pxPerMm);
        const midFromTop = cumFromDoorTop + Math.round(sH / 2);
        const midCssBot  = FLOOR_H + TRACK_BOT_H + dH - midFromTop;
        const mmVal  = rRm[r];
        const lbl = mkEl('div',
          'position:absolute;left:' + (rulerX + 12) + 'px;bottom:' + (midCssBot - 10) + 'px;' +
          'font-size:10px;font-weight:600;color:rgba(80,70,60,.85);' +
          'font-family:var(--font);white-space:nowrap;cursor:pointer;z-index:8;' +
          'background:rgba(240,236,227,.92);border-radius:3px;padding:2px 5px;' +
          'border:1px solid rgba(80,70,60,.18);transition:all .15s;'
        );
        lbl.textContent = mmVal + ' мм';
        lbl.dataset.doorIdx = rIdx;
        lbl.dataset.sectIdx = r;
        lbl.dataset.mm = mmVal;
        lbl.title = 'Нажмите для редактирования';
        lbl.addEventListener('mouseenter', () => {
          lbl.style.background = 'rgba(255,255,255,.98)';
          lbl.style.borderColor = 'rgba(1,105,111,.5)';
          lbl.style.color = 'rgba(1,105,111,1)';
        });
        lbl.addEventListener('mouseleave', () => {
          if (!lbl.querySelector('input')) {
            lbl.style.background = 'rgba(240,236,227,.92)';
            lbl.style.borderColor = 'rgba(80,70,60,.18)';
            lbl.style.color = 'rgba(80,70,60,.85)';
          }
        });
        lbl.addEventListener('click', e => { e.stopPropagation(); startRulerEdit(lbl); });
        room.appendChild(lbl);
        cumFromDoorTop += sH + divW_r;
      }
    }
  }

  // — Боковой световой блик на стекле (ambient occlusion снизу проёма)
  room.appendChild(mkEl('div',
    'position:absolute;bottom:' + FLOOR_H + 'px;left:0;right:0;height:' + (dH + TRACK_TOP_H + TRACK_BOT_H) + 'px;' +
    'background:linear-gradient(90deg,rgba(0,0,0,.06) 0%,transparent 8%,transparent 92%,rgba(0,0,0,.06) 100%);' +
    'pointer-events:none;z-index:6;'
  ));

  // ── ЧЕЛОВЕК (слева от дверей) ──────────────────────────────
  const personH_mm = 1800;
  const personH_px = Math.round(personH_mm * pxPerMm);
  // Реальные пропорции силуэта: 58×142 px, соотношение ~0.408
  const personAspect = 58 / 142;
  const personW_px = Math.round(personH_px * personAspect);
  const personX = doorLeft - personW_px - 28;

  if (personX > 4) {

    // SVG — реальный силуэт из фото (base64 PNG)
    // viewBox точно совпадает с пропорциями width/height — без полей сверху или снизу
    const personSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    personSvg.setAttribute('width', personW_px);
    personSvg.setAttribute('height', personH_px);
    personSvg.setAttribute('viewBox', '0 0 58 142');
    // 'none' — растягивает ровно по width×height (но т.к. они уже в правильной пропорции, искажений нет)
    personSvg.setAttribute('preserveAspectRatio', 'none');
    personSvg.style.cssText =
      'position:absolute;bottom:' + FLOOR_H + 'px;left:' + personX + 'px;' +
      'z-index:3;opacity:.6;';
    personSvg.innerHTML =
      '<image href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADoAAACOCAYAAABg4BtLAAAB0UlEQVR42u2dMW7DMAxFLcFH6JIl9z9Xly69Q7sWQdCYDCXxU+9vQZBaz5+kScVOjwMhhBBCXrXVC7jfPn7+vv78+m6lQB8BR8P2bJBX3pcAvQoRDduPTZQaNNLVrrpwQjcD6KhrJI4CCiigMgVpiaMrYFOHbuQJ6TtApgbdanqRbeo9AFGwTc0lb+421ZyzQjc1OC9wU4WzwjZ1wKuwNPVqbr7SWR3wbUeVIMnRzAO0N8pwFNDdQKm6lVpANTfJ0WpumkFVIQndahW3DOiVvrvvAGkGzTaxWNZzRh0w09bmM4U6NAPWC9qVILm8VAT1Rs42+7qELqCiEw2OVqu8fYewJXQBBbQwKF9JAApoXtAM+WldA47+pwzbntY1SN6V4jl2m50rswHDctRz8FmfSVGMZoc+VRdQQAEFtDToVg/Krjg5hK7aNJPKUX5ZY8LJIUcBBRRQQOVAvRtkM6+rOBrt5uo2EUcBBXRMfkd95YGjjGliAzehC+jAioijgAIK6HDQLLv4OFqtY0o/vRC6gIqCMngDCui43Ml0bwMNQ5ZFLt8c2+KRLcVfqmqjAC0h9+rvRoTvWdVBc+gqPp6VtmGYUcFT3aw4+x87IoQQQm/qFzVTzNgIDgrAAAAAAElFTkSuQmCC"' +
      ' x="0" y="0" width="58" height="142" preserveAspectRatio="none"/>';
    room.appendChild(personSvg);

    // Размерная стрелка человека
    const arrowX = personX - 14;
    const arrowSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arrowSvg.setAttribute('width', '20');
    arrowSvg.setAttribute('height', personH_px + 2);
    arrowSvg.setAttribute('viewBox', '0 0 20 ' + (personH_px + 2));
    arrowSvg.style.cssText =
      'position:absolute;bottom:' + FLOOR_H + 'px;left:' + arrowX + 'px;z-index:7;';
    arrowSvg.innerHTML =
      '<line x1="10" y1="1" x2="10" y2="' + personH_px + '" stroke="rgba(80,70,60,.5)" stroke-width="1" stroke-dasharray="3,2"/>' +
      '<polygon points="10,0 7,7 13,7" fill="rgba(80,70,60,.5)"/>' +
      '<polygon points="10,' + (personH_px+1) + ' 7,' + (personH_px-6) + ' 13,' + (personH_px-6) + '" fill="rgba(80,70,60,.5)"/>';
    room.appendChild(arrowSvg);

    // Подпись
    const personLabel = mkEl('div',
      'position:absolute;font-size:9px;font-weight:600;color:rgba(80,70,60,.65);' +
      'font-family:var(--font);white-space:nowrap;' +
      'left:' + (arrowX - 22) + 'px;' +
      'bottom:' + (FLOOR_H + Math.round(personH_px / 2) - 6) + 'px;' +
      'writing-mode:vertical-rl;transform:rotate(180deg);letter-spacing:.04em;'
    );
    personLabel.textContent = '1 800 мм';
    room.appendChild(personLabel);
  }

  // ── КОМОД (справа от дверей) ───────────────────────────────
  const dresserH_mm = 1000;
  const dresserW_mm = 900;
  const dresserH_px = Math.round(dresserH_mm * pxPerMm);
  const dresserW_px = Math.round(dresserW_mm * pxPerMm);
  const _rulerExtra = (_sectRows > 1 && containerId === 'vizRoom') ? 70 : 0;
  const dresserX = doorLeft + totalW + 28 + _rulerExtra;
  const dresserBottom = FLOOR_H;
  const availRight = (room.clientWidth || 600) - dresserX - 8;

  if (availRight >= dresserW_px * 0.5) {
    const dW2 = Math.min(dresserW_px, availRight - 4);
    const scale = dW2 / dresserW_px;
    const dH2 = Math.round(dresserH_px * scale);

    const dresserSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    dresserSvg.setAttribute('width', dW2);
    dresserSvg.setAttribute('height', dH2);
    dresserSvg.setAttribute('viewBox', '0 0 100 112');
    dresserSvg.setAttribute('preserveAspectRatio', 'none');
    dresserSvg.style.cssText =
      'position:absolute;bottom:' + dresserBottom + 'px;left:' + dresserX + 'px;' +
      'z-index:3;opacity:.75;';

    // Корпус комода
    dresserSvg.innerHTML =
      // Тень комода
      '<ellipse cx="50" cy="112" rx="46" ry="4" fill="rgba(0,0,0,.12)"/>' +
      // Основной корпус
      '<rect x="2" y="4" width="96" height="104" rx="2" fill="#d4c9b4" stroke="#b8ad98" stroke-width="1.5"/>' +
      // Боковая тень (объём)
      '<rect x="88" y="4" width="10" height="104" rx="1" fill="rgba(0,0,0,.08)"/>' +
      // Столешница
      '<rect x="0" y="2" width="100" height="6" rx="2" fill="#e2d8c4" stroke="#b8ad98" stroke-width="1"/>' +
      // Выдвижной ящик 1
      '<rect x="6" y="14" width="88" height="26" rx="2" fill="#c8bcaa" stroke="#a89c8c" stroke-width="1"/>' +
      '<rect x="6" y="14" width="88" height="4" rx="1" fill="rgba(255,255,255,.25)"/>' +
      '<rect x="38" y="23" width="24" height="7" rx="3.5" fill="#b0a490" stroke="#9a8e80" stroke-width="1"/>' +
      // Выдвижной ящик 2
      '<rect x="6" y="44" width="88" height="26" rx="2" fill="#c8bcaa" stroke="#a89c8c" stroke-width="1"/>' +
      '<rect x="6" y="44" width="88" height="4" rx="1" fill="rgba(255,255,255,.25)"/>' +
      '<rect x="38" y="53" width="24" height="7" rx="3.5" fill="#b0a490" stroke="#9a8e80" stroke-width="1"/>' +
      // Выдвижной ящик 3
      '<rect x="6" y="74" width="88" height="26" rx="2" fill="#c8bcaa" stroke="#a89c8c" stroke-width="1"/>' +
      '<rect x="6" y="74" width="88" height="4" rx="1" fill="rgba(255,255,255,.25)"/>' +
      '<rect x="38" y="83" width="24" height="7" rx="3.5" fill="#b0a490" stroke="#9a8e80" stroke-width="1"/>' +
      // Ножки
      '<rect x="8" y="103" width="10" height="7" rx="1" fill="#a09080"/>' +
      '<rect x="82" y="103" width="10" height="7" rx="1" fill="#a09080"/>';

    room.appendChild(dresserSvg);

    // Размерные стрелки комода — высота (справа)
    const dimX = dresserX + dW2 + 6;
    if (dimX < (room.clientWidth || 600) - 30) {
      const hSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      hSvg.setAttribute('width', '20');
      hSvg.setAttribute('height', dH2 + 2);
      hSvg.setAttribute('viewBox', '0 0 20 ' + (dH2 + 2));
      hSvg.style.cssText =
        'position:absolute;bottom:' + dresserBottom + 'px;left:' + dimX + 'px;z-index:7;';
      hSvg.innerHTML =
        '<line x1="10" y1="1" x2="10" y2="' + dH2 + '" stroke="rgba(80,70,60,.45)" stroke-width="1" stroke-dasharray="3,2"/>' +
        '<polygon points="10,0 7,7 13,7" fill="rgba(80,70,60,.45)"/>' +
        '<polygon points="10,' + (dH2+1) + ' 7,' + (dH2-6) + ' 13,' + (dH2-6) + '" fill="rgba(80,70,60,.45)"/>';
      room.appendChild(hSvg);

      const hLabel = mkEl('div',
        'position:absolute;font-size:9px;font-weight:600;color:rgba(80,70,60,.6);' +
        'font-family:var(--font);white-space:nowrap;' +
        'left:' + (dimX + 14) + 'px;' +
        'bottom:' + (dresserBottom + Math.round(dH2 / 2) - 6) + 'px;' +
        'writing-mode:vertical-rl;transform:rotate(180deg);letter-spacing:.04em;'
      );
      hLabel.textContent = '1 000 мм';
      room.appendChild(hLabel);
    }

    // Размерная стрелка — ширина (снизу)
    const wArrowBottom = dresserBottom - 20;
    const wSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    wSvg.setAttribute('width', dW2 + 2);
    wSvg.setAttribute('height', '16');
    wSvg.setAttribute('viewBox', '0 0 ' + (dW2 + 2) + ' 16');
    wSvg.style.cssText =
      'position:absolute;bottom:' + wArrowBottom + 'px;left:' + dresserX + 'px;z-index:7;';
    wSvg.innerHTML =
      '<line x1="1" y1="8" x2="' + (dW2+1) + '" y2="8" stroke="rgba(80,70,60,.45)" stroke-width="1" stroke-dasharray="3,2"/>' +
      '<polygon points="0,8 7,5 7,11" fill="rgba(80,70,60,.45)"/>' +
      '<polygon points="' + (dW2+2) + ',8 ' + (dW2-5) + ',5 ' + (dW2-5) + ',11" fill="rgba(80,70,60,.45)"/>';
    room.appendChild(wSvg);

    const wLabel = mkEl('div',
      'position:absolute;font-size:9px;font-weight:600;color:rgba(80,70,60,.6);' +
      'font-family:var(--font);white-space:nowrap;text-align:center;' +
      'left:' + dresserX + 'px;width:' + dW2 + 'px;' +
      'bottom:' + (wArrowBottom - 12) + 'px;'
    );
    wLabel.textContent = '900 мм';
    room.appendChild(wLabel);
  }

  // — Размерная подпись двери
  const dim = mkEl('div',
    'position:absolute;bottom:8px;right:12px;' +
    'font-size:10px;color:rgba(0,0,0,.28);font-variant-numeric:tabular-nums;' +
    'font-family:var(--font);letter-spacing:.02em;'
  );
  dim.textContent = W + ' × ' + H + ' мм · ' + N + ' ' + (N === 1 ? 'дверь' : N < 5 ? 'двери' : 'дверей');
  room.appendChild(dim);
}

function makeDoor(dW, dH, doorIdx, fills, sOpt, opacity, frameGrad, pxPerMm, dims, draggable, showLabels) {
  const DM = dims || { frameSide:30, frameTop:40, frameBot:40, divider:20 };
  const fg = (frameGrad || '#c0c0c0,#e0e0e0,#a0a0a0').split(',');
  const [fMid, fLight, fDark] = fg;

  // Реальные толщины профиля в пикселях
  const fSide = Math.max(2, Math.round(DM.frameSide * pxPerMm));
  const fTop  = Math.max(2, Math.round(DM.frameTop  * pxPerMm));
  const fBot  = Math.max(2, Math.round(DM.frameBot  * pxPerMm));
  const divW  = Math.max(1, Math.round(DM.divider   * pxPerMm));

  const d = mkEl('div',
    'width:' + dW + 'px;height:' + dH + 'px;position:relative;overflow:hidden;' +
    'box-shadow:4px 6px 22px rgba(0,0,0,.28),inset 0 0 0 1px rgba(255,255,255,.14);' +
    'cursor:default;transition:opacity .3s ease;' +
    'opacity:' + opacity + ';'
  );

  // Профиль рамки — верх
  d.appendChild(mkEl('div', 'position:absolute;left:0;right:0;height:' + fTop + 'px;top:0;z-index:3;' +
    'background:linear-gradient(180deg,' + fLight + ' 0%,' + fMid + ' 50%,' + fDark + ' 100%);'));
  // Профиль рамки — низ
  d.appendChild(mkEl('div', 'position:absolute;left:0;right:0;height:' + fBot + 'px;bottom:0;z-index:3;' +
    'background:linear-gradient(180deg,' + fDark + ' 0%,' + fMid + ' 50%,' + fLight + ' 100%);'));
  // Профиль рамки — лево
  d.appendChild(mkEl('div', 'position:absolute;top:0;bottom:0;width:' + fSide + 'px;left:0;z-index:3;' +
    'background:linear-gradient(90deg,' + fDark + ' 0%,' + fMid + ' 45%,' + fLight + ' 100%);'));
  // Профиль рамки — право
  d.appendChild(mkEl('div', 'position:absolute;top:0;bottom:0;width:' + fSide + 'px;right:0;z-index:3;' +
    'background:linear-gradient(90deg,' + fLight + ' 0%,' + fMid + ' 55%,' + fDark + ' 100%);'));

  const { rowRatios, colRatios } = sOpt || { rowRatios:[1], colRatios:[1] };

  // Внутренняя сетка секций — gap = толщина разделителя, пропорции из ratios
  const inner = mkEl('div',
    'position:absolute;top:' + fTop + 'px;left:' + fSide + 'px;right:' + fSide + 'px;bottom:' + fBot + 'px;' +
    'z-index:1;display:grid;gap:' + divW + 'px;' +
    'grid-template-rows:' + rowRatios.map(r => (r * 100).toFixed(2) + 'fr').join(' ') + ';' +
    'grid-template-columns:' + colRatios.map(c => (c * 100).toFixed(2) + 'fr').join(' ') + ';'
  );

  // Фон разделителей — цвет профиля в зоне gap
  inner.style.background = fMid;

  // Вычисляем pixel-размер каждой ячейки (понадобится для текстуры с поворотом).
  const colSum = colRatios.reduce((s, x) => s + x, 0);
  const rowSum = rowRatios.reduce((s, x) => s + x, 0);
  const innerW = dW - 2 * fSide;
  const innerH = dH - fTop - fBot;
  const contentW = innerW - (colRatios.length - 1) * divW;
  const contentH = innerH - (rowRatios.length - 1) * divW;

  // ЛДСП-параметры: 1 thumbnail jpg = 600×1200мм реального материала (без поворота).
  const TEX_MM_W = 600, TEX_MM_H = 1200;
  const bgW = Math.max(20, Math.round(TEX_MM_W * pxPerMm));
  const bgH = Math.max(40, Math.round(TEX_MM_H * pxPerMm));
  const isRotated = !!doorTexRot[doorIdx];

  for (let r = 0; r < rowRatios.length; r++) {
    for (let c = 0; c < colRatios.length; c++) {
      const si = r * colRatios.length + c;
      const sectionFill = fills[si] || fills[0];
      const isActive = activeSection && activeSection.doorIdx === doorIdx && activeSection.sectIdx === si;
      const cell = mkEl('div',
        'position:relative;overflow:hidden;border-radius:0;cursor:pointer;' +
        (isActive ? 'outline:2.5px solid var(--color-primary);outline-offset:-2px;z-index:10;' : '')
      );
      cell.className = sectionFill.mat || 'mat-default';
      // Пиксельный размер ячейки (нужен и для текстуры, и для подписи в КП)
      const cellWpx = Math.round((colRatios[c] / colSum) * contentW);
      const cellHpx = Math.round((rowRatios[r] / rowSum) * contentH);
      // Текстура: фиксированный масштаб (1 thumbnail = 600×1200мм). Не растягивается под размер секции.
      // При isRotated — texLayer повёрнут на 90° через CSS transform.
      if (sectionFill.tex) {
        const layerW = isRotated ? cellHpx : cellWpx;
        const layerH = isRotated ? cellWpx : cellHpx;
        const texLayer = document.createElement('div');
        texLayer.style.cssText =
          'position:absolute;left:0;top:0;pointer-events:none;' +
          'width:' + layerW + 'px;height:' + layerH + 'px;' +
          'background-size:' + bgW + 'px ' + bgH + 'px;' +
          'background-repeat:repeat;background-position:0 0;' +
          'transform-origin:top left;' +
          (isRotated ? 'transform:translateX(' + cellWpx + 'px) rotate(90deg);' : '');
        texLayer.style.backgroundImage = 'url("' + encodeURI(sectionFill.tex) + '")';
        cell.appendChild(texLayer);
      }
      cell.onclick = (e) => { e.stopPropagation(); openSectionEditor(doorIdx, si); };
      // Лёгкий блик
      cell.appendChild(mkEl('div', 'position:absolute;inset:0;background:linear-gradient(140deg,rgba(255,255,255,.12) 0%,transparent 40%);pointer-events:none;z-index:2;'));
      // v1.3.5: подпись материала поверх полотна (только в КП). Плашка-подпись по центру
      // секции на всю ширину: тёмный полупрозрачный фон + белый текст с тенью —
      // читается над зеркалом, тёмным стеклом, текстурой ЛДСП. Перенос по словам, не по буквам.
      if (showLabels && sectionFill && sectionFill.n) {
        const fontPx = Math.max(8, Math.min(12, Math.round(Math.min(cellWpx, cellHpx) / 8)));
        const band = document.createElement('div');
        band.style.cssText =
          'position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);' +
          'z-index:6;pointer-events:none;text-align:center;' +
          'background:rgba(22,20,15,.60);color:#fff;' +
          'padding:4px 4px;' +
          'font-family:var(--font,sans-serif);font-weight:600;line-height:1.25;' +
          'font-size:' + fontPx + 'px;' +
          'text-shadow:0 1px 2px rgba(0,0,0,.55);' +
          'overflow-wrap:normal;word-break:normal;hyphens:none;';
        band.textContent = sectionFill.n; // textContent — без XSS
        cell.appendChild(band);
      }
      inner.appendChild(cell);
    }
  }
  d.appendChild(inner);

  // Drag-handles для перетаскивания горизонтальных разделителей
  if (draggable && rowRatios.length > 1) {
    const innerH  = dH - fTop - fBot;
    const contentH = innerH - (rowRatios.length - 1) * divW;
    let cumRatio = 0;
    for (let r = 0; r < rowRatios.length - 1; r++) {
      cumRatio += rowRatios[r];
      const gapTop   = fTop + Math.round(cumRatio * contentH) + r * divW;
      const handleH  = Math.max(divW + 4, 10);
      const handle   = document.createElement('div');
      handle.className = 'div-handle';
      handle.style.cssText =
        'position:absolute;left:' + (fSide + 1) + 'px;right:' + (fSide + 1) + 'px;' +
        'height:' + handleH + 'px;' +
        'top:' + (gapTop - Math.round((handleH - divW) / 2)) + 'px;' +
        'z-index:20;cursor:row-resize;touch-action:none;';
      handle.dataset.doorIdx = doorIdx;
      handle.dataset.divIdx  = r;
      handle.addEventListener('pointerdown', startDividerDrag);
      d.appendChild(handle);
    }
  }

  // Шиммер — если хотя бы одна секция зеркало/стекло/сатин
  const hasShimmer = fills.some(f => f && (f.mat || '').match(/mirror|glass|satin/));
  if (hasShimmer) {
    d.appendChild(mkEl('div', 'position:absolute;inset:0;background:linear-gradient(52deg,transparent 20%,rgba(255,255,255,.16) 44%,transparent 62%);pointer-events:none;z-index:5;'));
  }

  // Подсветка и активация двери для редактирования разделителей
  if (draggable) {
    if (doorIdx === activeDoorEdit) {
      d.style.outline = '2px solid rgba(1,105,111,.45)';
      d.style.outlineOffset = '2px';
    }
    d.addEventListener('click', function(e) {
      if (!e.target.closest('.mat-cell')) {
        activeDoorEdit = doorIdx;
        const H = num('height', 2000);
        rowMm = getDoorRowMm(doorIdx, H).slice();
        sectOpt = Object.assign({}, sectOpt, { rowRatios: rowMm.map(v => v / H) });
        buildDividersBlock();
        rerenderVisualization();
      }
    });
  }

  return d;
}

function mkEl(tag, css) {
  const e = document.createElement(tag);
  e.style.cssText = css;
  return e;
}

/* ============================================================
   КП — ФУНКЦИИ
   ============================================================ */

function getKPTotals() {
  const d = window._lastCalcData;
  if (!d) return null;
  const delivery = +($('kpDelivery') && $('kpDelivery').value) || 0;
  const installOn = $('kpInstall') && $('kpInstall').checked;
  // v1.3.4: установка = 13% от изделия, но не менее 5 000 ₽ (минимальный выезд монтажника).
  const INSTALL_MIN = 5000;
  const installCost = installOn ? Math.max(INSTALL_MIN, Math.round(d.total * 0.13)) : 0;
  const grand = d.total + delivery + installCost;
  return { d, delivery, installOn, installCost, grand };
}

function updateKPPreview() {
  const t = getKPTotals();
  const el = $('kpTotalsPreview');
  if (!t || !el) return;

  const row = (label, val, bold) =>
    '<div style="display:flex;justify-content:space-between;' + (bold ? 'font-weight:700;color:var(--color-primary);font-size:var(--tx-sm);' : '') + '">' +
      '<span style="color:' + (bold ? 'var(--color-primary)' : 'var(--color-text-muted)') + '">' + label + '</span>' +
      '<span>' + fmt(val) + ' ₽</span>' +
    '</div>';

  el.innerHTML =
    row('Изделие (наполнение + профиль + фурнитура)', t.d.total) +
    row('Доставка', t.delivery) +
    (t.installOn ? row(t.installCost > Math.round(t.d.total * 0.13) ? 'Установка (мин. 5 000 ₽)' : 'Установка (13%)', t.installCost) : '') +
    '<div style="border-top:1px solid var(--color-border);margin:6px 0"></div>' +
    row('ИТОГО по КП', t.grand, true);
}

function openKP() {
  const t = getKPTotals();
  if (!t) return;
  // v1.3.1: обязательное заполнение клиента/телефона/менеджера перед формированием КП
  const clientRaw  = ($('kpClient')  && $('kpClient').value.trim())  || '';
  const phoneRaw   = ($('kpPhone')   && $('kpPhone').value.trim())   || '';
  const managerRaw = ($('kpManager') && $('kpManager').value.trim()) || '';
  const missing = [];
  if (!clientRaw)  missing.push('Клиент / организация');
  if (!phoneRaw)   missing.push('Телефон заказчика');
  if (!managerRaw) missing.push('Менеджер');
  if (missing.length > 0) {
    alert('Перед формированием КП заполните обязательные поля:\n\n• ' + missing.join('\n• ') + '\n\n(поля находятся в правой колонке под кнопкой «Сформировать КП»)');
    // Подсвечиваем красным незаполненные поля
    ['kpClient','kpPhone','kpManager'].forEach(id => {
      const el = $(id); if (!el) return;
      if (!el.value.trim()) {
        el.style.borderColor = '#c84444';
        el.style.boxShadow = '0 0 0 3px rgba(200,68,68,.15)';
        el.addEventListener('input', function clr(){ el.style.borderColor=''; el.style.boxShadow=''; el.removeEventListener('input', clr); }, {once:true});
      }
    });
    // Скролл к первому пустому полю
    const firstEmpty = ['kpClient','kpPhone','kpManager'].map(id=>$(id)).find(el => el && !el.value.trim());
    if (firstEmpty) { firstEmpty.scrollIntoView({behavior:'smooth', block:'center'}); setTimeout(()=>firstEmpty.focus(), 350); }
    return;
  }
  const client  = clientRaw;
  const phone   = phoneRaw;
  const manager = managerRaw;
  $('kpPageContent').innerHTML = buildKPHTML(t, client, phone, manager);
  $('kpDocument').classList.add('kp-open');
  document.body.style.overflow = 'hidden';
  // Рендерим визуализацию на второй странице КП
  const ld = window._lastCalcData;
  if (ld) {
    const vizFills = ld.doorFills || [ld.fills || [ld.fill]];
    const vizSect = ld.sectOpt || SECTION_OPTS[0];
    // 200мс вместо 50: DOM КП-страницы успевает построиться даже на слабом ноуте.
    // Race guard: если КП успели закрыть до того как сработал setTimeout — #kpVizRoom уже нет в DOM.
    setTimeout(() => {
      if (!document.getElementById('kpVizRoom')) return;
      renderRoom('kpVizRoom', ld.W, ld.H, ld.N, ld.bd, ld.isSinglePartition, vizFills, ld.frameGrad, ld.dims, vizSect);
    }, 200);
  }
}

// closeKP() вынесен в js/shared-kp.js

function buildKPHTML(t, client, phone, manager) {
  const d = t.d;
  const now = new Date();
  const dateStr = now.toLocaleDateString('ru-RU', {day:'2-digit', month:'long', year:'numeric'});
  const kpNum = 'КП-' + now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + String(now.getDate()).padStart(2,'0') + '-' + String(now.getHours()).padStart(2,'0') + String(now.getMinutes()).padStart(2,'0');
  const bdDisplay = String(d.bd);

  // XSS-защита: ВСЕ user-input поля проходят через escapeHtml перед попаданием в innerHTML.
  // client/phone/manager берутся из <input> формы — могут содержать <script>, <img onerror>, кавычки и т.п.
  const eClient  = escapeHtml(client);
  const ePhone   = escapeHtml(phone);
  const eManager = escapeHtml(manager);

  // Строки профиля — r.n приходит из PROFILE_SYSTEMS (контролируется кодом), но защита не повредит.
  const profRowsHTML = d.profRows.map(r =>
    '<tr>' +
      '<td>' + escapeHtml(r.n) + '</td>' +
      '<td class="r">' + fmt(r.l) + ' мм</td>' +
      '<td class="r">' + fmt(r.pr) + '</td>' +
      '<td class="r">' + fmt(r.c) + '</td>' +
    '</tr>'
  ).join('');

  // Финальные строки КП — наполнение
  const fillingRows = [];
  const bd2D = d.sectionBreakdown2D;
  // Проверить: все двери × секции одного материала?
  const allFillsSameKP = bd2D
    ? bd2D.every(dBd => dBd.every((s, si) => s.fill === bd2D[0][si].fill))
    : d.fills.length === 1;
  // Проверить: разные материалы по дверям (не только по секциям)?
  const diffAcrossDoors = bd2D && bd2D.length > 1 &&
    !bd2D.every(dBd => dBd.every((s, si) => s.fill === bd2D[0][si].fill));

  if (allFillsSameKP && d.sectionBreakdown.length === 1) {
    // Всё одно — одна строка
    fillingRows.push({label:'Наполнение (' + escapeHtml(d.fills[0].n) + ')', detail: d.areaM2.toFixed(2) + ' м² × ' + fmt(d.sectionBreakdown[0].fillPriceAdj) + ' ₽/м²', val: d.filCost});
  } else if (diffAcrossDoors && bd2D) {
    // Разные по дверям — показываем по дверям
    bd2D.forEach((dBd, di) => {
      dBd.forEach((s, si) => {
        fillingRows.push({
          label: 'Дверь ' + (di+1) + (dBd.length > 1 ? ' · Секция ' + (si+1) : '') + ' — ' + escapeHtml(s.fill.n),
          detail: s.sArea.toFixed(2) + ' м² × ' + fmt(s.fillPriceAdj) + ' ₽/м²',
          val: s.cost,
        });
      });
    });
  } else {
    // Одна дверь или разные секции (одинаковые по дверям) — по секциям
    d.sectionBreakdown.forEach((s, i) => {
      fillingRows.push({label:'Секция ' + (i+1) + ' — ' + escapeHtml(s.fill.n), detail: s.sArea.toFixed(2) + ' м² × ' + fmt(s.fillPriceAdj) + ' ₽/м²', val: s.cost});
    });
  }
  const itemRows = [
    ...fillingRows,
    {label:'Профиль и направляющие (' + escapeHtml(d.profileName) + ')', detail: d.profRows.length + ' позиций', val: d.profTotal},
  ];
  if (d.filmCost > 0)
    itemRows.push({label: 'Защитная плёнка', detail: d.areaM2.toFixed(2) + ' м²' + (d.sectionBreakdown.length === 1 && d.film ? ' × ' + fmt(d.film.p) + ' ₽/м²' : ' (по секциям)'), val: d.filmCost});
  if (d.softCloseCost > 0)
    itemRows.push({label:'Фурнитура — доводчик', detail: bdDisplay + ' дв. × ' + fmt(SOFT_CLOSE_PRICE) + ' ₽', val: d.softCloseCost});
  if (d.complexCost > 0)
    itemRows.push({label:'Сложная сборка', detail: bdDisplay + ' дв. × ' + fmt(COMPLEX_WORK_PRICE) + ' ₽', val: d.complexCost});

  // r.label и r.detail уже содержат escapeHtml для user-controlled частей (s.fill.n, d.profileName).
  const itemRowsHTML = itemRows.map((r, i) =>
    '<tr>' +
      '<td>' + (i+1) + '</td>' +
      '<td>' + r.label + '<br><span style="color:#999;font-size:8.5pt">' + r.detail + '</span></td>' +
      '<td class="r">' + fmt(r.val) + '</td>' +
    '</tr>'
  ).join('');

  const grandRowsHTML =
    '<tr class="kp-total-row">' +
      '<td colspan="2">Итого изделие</td>' +
      '<td class="r">' + fmt(d.total) + ' ₽</td>' +
    '</tr>' +
    (t.delivery > 0
      ? '<tr><td colspan="2">Доставка</td><td class="r">' + fmt(t.delivery) + ' ₽</td></tr>'
      : '') +
    (t.installOn
      ? '<tr><td colspan="2">Монтаж и установка' + (t.installCost > Math.round(t.d.total * 0.13) ? ' (мин. 5 000 ₽)' : ' (13%)') + '</td><td class="r">' + fmt(t.installCost) + ' ₽</td></tr>'
      : '') +
    '<tr class="kp-grand-row">' +
      '<td colspan="2">ИТОГО К ОПЛАТЕ</td>' +
      '<td class="r">' + fmt(t.grand) + ' ₽</td>' +
    '</tr>';

  // Характеристики — все user-controlled значения экранируем.
  const specsHTML =
    '<table class="kp-table">' +
      '<thead><tr><th>Параметр</th><th>Значение</th></tr></thead>' +
      '<tbody>' +
        '<tr><td>Ширина проёма</td><td>' + d.W + ' мм</td></tr>' +
        '<tr><td>Высота проёма</td><td>' + d.H + ' мм</td></tr>' +
        '<tr><td>Количество полотен</td><td>' + d.N + ' шт</td></tr>' +
        '<tr><td>Оплачивается полотен</td><td>' + bdDisplay + ' шт' + (d.isSinglePartition ? ' (одиночная перегородка)' : '') + '</td></tr>' +
        '<tr><td>Наполнение</td><td>' + (d.fills.length === 1 ? escapeHtml(d.fills[0].n) : 'Смешанное (' + d.fills.length + ' материала)') + '</td></tr>' +
        '<tr><td>Профильная система</td><td>' + escapeHtml(d.profileName) + '</td></tr>' +
        '<tr><td>Площадь наполнения</td><td>' + d.areaM2.toFixed(2) + ' м²</td></tr>' +
        (d.softCloseCost > 0 ? '<tr><td>Доводчик</td><td>Да</td></tr>' : '') +
        (d.filmCost > 0 ? '<tr><td>Плёнка</td><td>' + escapeHtml(d.film.name) + '</td></tr>' : '') +
      '</tbody>' +
    '</table>';

  return `
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10mm;padding-bottom:6mm;border-bottom:2px solid #01696f">
  <div>
    <div style="font-size:15pt;font-weight:700;color:#01696f;margin-bottom:2px">Двери-купе Аристо</div>
    <div style="font-size:8.5pt;color:#999">Коммерческое предложение</div>
  </div>
  <div style="text-align:right">
    <div style="font-size:18pt;font-weight:700;letter-spacing:-.02em">КП</div>
    <div style="font-size:8.5pt;color:#999">№ ${escapeHtml(kpNum)}</div>
    <div style="font-size:8.5pt;color:#999">Дата: ${escapeHtml(dateStr)}</div>
  </div>
</div>

<table style="width:100%;border-collapse:collapse;margin-bottom:8mm;font-size:9.5pt">
  <tr><td style="padding:3px 0;color:#666;width:130px">Клиент:</td><td style="font-weight:600">${eClient}</td></tr>
  <tr><td style="padding:3px 0;color:#666">Телефон:</td><td>${ePhone}</td></tr>
  <tr><td style="padding:3px 0;color:#666">Менеджер:</td><td>${eManager}</td></tr>
</table>

<div style="font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#01696f;margin-bottom:3mm;padding-bottom:2mm;border-bottom:1px solid #e0e0e0">Характеристики изделия</div>
${specsHTML}

<div style="font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#01696f;margin-bottom:3mm;padding-bottom:2mm;border-bottom:1px solid #e0e0e0;margin-top:6mm">Состав и стоимость</div>
<table class="kp-table">
  <thead><tr><th style="width:28px">№</th><th>Наименование</th><th class="r" style="width:100px">Сумма, ₽</th></tr></thead>
  <tbody>${itemRowsHTML}${grandRowsHTML}</tbody>
</table>

<div style="background:#f8faf9;border:1.5px solid #cedcd8;border-radius:6px;padding:5mm 6mm;display:flex;justify-content:space-between;align-items:center;margin-top:6mm">
  <div style="font-size:11pt;font-weight:700">ИТОГО К ОПЛАТЕ:</div>
  <div style="font-size:18pt;font-weight:700;color:#01696f">${fmt(t.grand)} ₽</div>
</div>

<div style="font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#01696f;margin-top:8mm;margin-bottom:3mm;padding-bottom:2mm;border-bottom:1px solid #e0e0e0">Детализация профиля</div>
<table class="kp-table">
  <thead><tr><th>Позиция</th><th class="r">Длина</th><th class="r">₽/п.м.</th><th class="r">Сумма, ₽</th></tr></thead>
  <tbody>${profRowsHTML}
    <tr class="kp-total-row"><td>Итого профиль</td><td></td><td></td><td class="r">${fmt(d.profTotal)} ₽</td></tr>
  </tbody>
</table>

<div style="margin-top:10mm;font-size:8.5pt;color:#aaa;border-top:1px solid #eee;padding-top:4mm;line-height:1.6">
  Данное коммерческое предложение действительно в течение 14 дней с даты выставления.<br>
  Срок изготовления уточняется при заказе.<br>
  Настоящее КП не является публичной офертой.
</div>

<div style="display:flex;justify-content:space-between;margin-top:12mm">
  <div style="border-top:1px solid #ccc;padding-top:3px;width:160px;font-size:8pt;color:#999;text-align:center">Подпись менеджера</div>
  <div style="border-top:1px solid #ccc;padding-top:3px;width:160px;font-size:8pt;color:#999;text-align:center">Подпись клиента</div>
  <div style="border-top:1px solid #ccc;padding-top:3px;width:120px;font-size:8pt;color:#999;text-align:center">МП</div>
</div>

</div>
<!-- Страница 2 — Визуализация -->
<div class="kp-page" style="margin-top:0;page-break-before:always;">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8mm;padding-bottom:4mm;border-bottom:1.5px solid #01696f">
    <div style="font-size:13pt;font-weight:700;color:#01696f">Визуализация изделия</div>
    <div style="font-size:8.5pt;color:#999">${escapeHtml(kpNum)} · ${eClient}</div>
  </div>
  <div style="font-size:9.5pt;margin-bottom:5mm;color:#555">
    Проём: <strong>${t.d.W} × ${t.d.H} мм</strong> · Полотен: <strong>${t.d.N} шт</strong> · Наполнение: <strong>${t.d.fills.length === 1 ? t.d.fills[0].n : t.d.fills.length + ' материалов'}</strong> · Профиль: <strong>${t.d.profileName}</strong>
  </div>
  <!-- Контейнер для SVG-визуализации (заполняется JS после рендера) -->
  <div id="kpVizRoom" style="width:100%;border-radius:8px;overflow:hidden;border:1px solid #e0e0e0;background:#e8e4da;"></div>
  <div style="margin-top:6mm;font-size:8pt;color:#bbb;text-align:center">Визуализация является схематичной и не учитывает декоративные элементы отделки</div>
</div>`;
}

/* ============================================================
   RESET
   ============================================================ */
function resetForm() {
  $('width').value = 1200;
  $('height').value = 2000;
  $('doorCount').value = 2;
  $('softClose').checked = false;
  doorFills = [];
  doorTexRot = [];
  activeSection = null;
  rowMm = [];
  colMm = [];
  $('fillMarkup').value = 0;
  $('singlePartition').checked = false;
  // Закрыть редактор секции если открыт
  const pf = $('panelForm');
  if (pf) pf.classList.remove('section-edit-mode');
  onDoorCountChange();
  setSections(0);
  window._lastCalcData = null;
  window._kupeProjectNum = null;
  // v1.3: при reset — снова disabled на «Экспорт КП»
  const exportBtn = document.getElementById('kupeExportKPBtn');
  if (exportBtn) { exportBtn.setAttribute('disabled', ''); exportBtn.title = 'Сначала рассчитайте стоимость'; }
  // Центральная колонка
  if ($('emptyState'))   $('emptyState').style.display = '';
  if ($('kupeVizArea'))  $('kupeVizArea').style.display = 'none';
  // Правая колонна
  if ($('kupeResultEmpty')) $('kupeResultEmpty').style.display = '';
  const rc = $('resultContent');
  if (rc) { rc.style.display = 'none'; rc.innerHTML = ''; }
  // Чипы
  if (typeof updateChipsActive === 'function') updateChipsActive(2);
  // Список заполнений
  const fillsList = $('kupeFillsList');
  if (fillsList) fillsList.innerHTML = '<div class="kupe-hint">Нажмите на секцию в превью чтобы выбрать материал</div>';
}

/* ============================================================
   3-COL UI: Chips, fills list, version, project, save/load
   ============================================================ */

/**
 * Wire door-count chips → set hidden #doorCount + dispatch change.
 */
function setupDoorCountChips() {
  const wrap = $('doorCountChips');
  if (!wrap) return;
  Array.from(wrap.querySelectorAll('.kupe-chip')).forEach(chip => {
    chip.addEventListener('click', function(){
      const val = chip.dataset.val;
      const sel = $('doorCount');
      sel.value = val;
      sel.dispatchEvent(new Event('change', {bubbles:true}));
      updateChipsActive(val);
    });
  });
}

function updateChipsActive(val) {
  document.querySelectorAll('#doorCountChips .kupe-chip').forEach(c => {
    c.classList.toggle('kupe-chip-active', c.dataset.val === String(val));
  });
}

/**
 * Update version display in topbar (reads from data files).
 */
function initKupeVersion() {
  const el = $('kupeVersion');
  if (!el) return;
  const fv = (typeof FILLINGS_VERSION !== 'undefined') ? FILLINGS_VERSION : '—';
  const pv = (typeof PROFILES_VERSION !== 'undefined') ? PROFILES_VERSION : '—';
  // Show most recent of versions
  el.textContent = 'v 2.9 — прайс ' + (fv > pv ? fv : pv);
}

/**
 * Generate next project number (4-digit, persisted in localStorage).
 */
function generateProjectNum() {
  const next = (parseInt(localStorage.getItem('kupeNextProjNum') || '450') + 1);
  localStorage.setItem('kupeNextProjNum', String(next));
  return String(next).padStart(4, '0');
}

/**
 * Render the per-door fills list in left column.
 * Shows mini swatches + first fill name per door + clickable to open editor.
 */
function renderKupeFillsList() {
  const list = $('kupeFillsList');
  if (!list) return;
  const ld = window._lastCalcData;
  if (!ld || !ld.doorFills || !ld.doorFills.length) {
    list.innerHTML = '<div class="kupe-hint">Нажмите на секцию в превью чтобы выбрать материал</div>';
    return;
  }
  let html = '';
  ld.doorFills.forEach((doorSects, di) => {
    const f0 = doorSects[0] || { n:'—', mat:'mat-default' };
    const sectCount = doorSects.length;
    const sub = sectCount > 1
      ? '<small style="color:#a8a08f;font-size:.66rem;margin-left:6px">+ '+(sectCount-1)+' секц.</small>'
      : '';
    const swStyle = f0.tex
      ? 'background-image:url(&quot;'+encodeURI(f0.tex)+'&quot;);background-size:cover;background-position:center;'
      : '';
    html += '<div class="kupe-fill-row" onclick="openSectionEditor('+di+',0)">'+
      '<div class="kupe-fill-swatch '+(f0.mat||'')+'" style="position:relative;'+swStyle+'"></div>'+
      '<div class="kupe-fill-name">'+(f0.n||'—')+sub+'</div>'+
      '<div class="kupe-fill-num">№'+(di+1)+'</div>'+
    '</div>';
  });
  list.innerHTML = html;
}

/* --- localStorage save / load --- */

const KUPE_DRAFTS_KEY = 'kupeDrafts_v1';

// Проверяем доступность localStorage один раз при загрузке.
// В приватном режиме Chrome localStorage существует, но setItem бросает QuotaExceededError.
let _lsAvailable = false;
try {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('__ls_test', '1');
    localStorage.removeItem('__ls_test');
    _lsAvailable = true;
  }
} catch (e) {
  _lsAvailable = false;
  console.warn('localStorage недоступен (приватный режим?):', e.message);
}

function collectKupeState() {
  return {
    W: num('width', 1200),
    H: num('height', 2000),
    N: num('doorCount', 2),
    profileSystemIdx: parseInt($('profileSystem').value) || 0,
    profileColorIdx:  parseInt($('profileColor').value) || 0,
    softClose:        $('softClose').checked,
    isSinglePartition:$('singlePartition').checked,
    filmToggle:       ($('filmToggle') || {}).checked || false,
    rowMm:            (typeof rowMm !== 'undefined' && rowMm) ? rowMm.slice() : [],
    doorRowMm:        (typeof doorRowMm !== 'undefined' && doorRowMm) ? doorRowMm.slice() : [],
    doorTexRot:       (typeof doorTexRot !== 'undefined' && doorTexRot) ? doorTexRot.slice() : [],
    sectOpt:          window._lastCalcData ? window._lastCalcData.sectOpt : null,
    // v1.2: per-door section overrides
    doorSectOpt:      (typeof doorSectOpt !== 'undefined' && doorSectOpt)
                      ? doorSectOpt.map(o => o ? {rowRatios:o.rowRatios.slice(), colRatios:o.colRatios.slice(), h:o.h, v:o.v, label:o.label} : null)
                      : [],
    doorFills:        window._lastCalcData ? window._lastCalcData.doorFills : null,
  };
}

function kupeSaveDraft() {
  if (!_lsAvailable) {
    alert('Сохранение недоступно — браузер не разрешает localStorage (возможно, приватный режим). Откройте обычное окно Chrome.');
    return;
  }
  if (!window._lastCalcData) {
    alert('Сначала рассчитайте параметры (нажмите "Рассчитать стоимость")');
    return;
  }
  if (!window._kupeProjectNum) window._kupeProjectNum = generateProjectNum();

  const draft = {
    schemaVersion: '1.0',
    projectNumber: window._kupeProjectNum,
    savedAt: new Date().toISOString(),
    pricesVersion: (typeof FILLINGS_VERSION !== 'undefined') ? FILLINGS_VERSION : '',
    client: {
      name:    ($('kpClient')   || {}).value || '',
      phone:   ($('kpPhone')    || {}).value || '',
      manager: ($('kpManager')  || {}).value || '',
    },
    modules: {
      kupe:     collectKupeState(),
      fasadAlu: (typeof AppState !== 'undefined') ? JSON.parse(JSON.stringify(AppState.fasadAlu || {})) : null,
      fasadMdf: (typeof AppState !== 'undefined') ? JSON.parse(JSON.stringify(AppState.fasadMdf || {})) : null,
    },
  };

  let list = [];
  try { list = JSON.parse(localStorage.getItem(KUPE_DRAFTS_KEY) || '[]'); } catch(e){ list = []; }
  // Заменяем существующий с тем же projectNumber или добавляем
  const filtered = list.filter(d => d.projectNumber !== draft.projectNumber);
  filtered.unshift(draft);
  // Храним последние 30
  const trimmed = filtered.slice(0, 30);
  try {
    localStorage.setItem(KUPE_DRAFTS_KEY, JSON.stringify(trimmed));
    alert('Сохранено: ПРОЕКТ № ' + draft.projectNumber);
  } catch(e) {
    alert('Ошибка сохранения: ' + e.message);
  }
}

function kupeOpenDraftsList() {
  // Удалить существующий поповер если есть
  document.querySelectorAll('.kupe-drafts-pop').forEach(p => p.remove());

  if (!_lsAvailable) {
    alert('Сохранённые проекты недоступны — браузер не разрешает localStorage. Откройте обычное окно Chrome.');
    return;
  }

  let list = [];
  try { list = JSON.parse(localStorage.getItem(KUPE_DRAFTS_KEY) || '[]'); } catch(e){ console.warn('drafts parse error:', e.message); }

  const pop = document.createElement('div');
  pop.className = 'kupe-drafts-pop';
  // Position rel to top-right
  pop.style.right = '24px';
  pop.style.top = '60px';

  if (!list.length) {
    pop.innerHTML = '<div class="kupe-drafts-empty">Нет сохранённых проектов</div>';
  } else {
    // XSS-защита: НЕ вставляем projectNumber или client.name в inline onclick="" —
    // используем data-pn атрибут + addEventListener после рендера.
    pop.innerHTML = list.map(d => {
      const k = (d.modules && d.modules.kupe) || {};
      const date = new Date(d.savedAt).toLocaleString('ru-RU', {day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});
      const cli = (d.client && d.client.name) ? ' · ' + escapeHtml(d.client.name) : '';
      return '<div class="kupe-drafts-row" data-pn="' + escapeAttr(d.projectNumber) + '">' +
        '<div class="kupe-drafts-row-num">ПРОЕКТ № ' + escapeHtml(d.projectNumber) + '</div>' +
        '<div class="kupe-drafts-row-meta">' + escapeHtml(date) + ' · ' + (k.W || '—') + '×' + (k.H || '—') + ' · ' + (k.N || '—') + ' дв.' + cli + '</div>' +
      '</div>';
    }).join('');
    // Подключаем безопасный обработчик после рендера
    pop.querySelectorAll('.kupe-drafts-row').forEach(row => {
      row.addEventListener('click', () => {
        const pn = row.dataset.pn;
        if (pn) kupeLoadDraft(pn);
      });
    });
  }
  document.body.appendChild(pop);
  // Закрываем по клику вне
  setTimeout(() => {
    document.addEventListener('click', function close(e){
      if (!pop.contains(e.target)) {
        pop.remove();
        document.removeEventListener('click', close);
      }
    });
  }, 100);
}

function kupeLoadDraft(projectNumber) {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(KUPE_DRAFTS_KEY) || '[]'); } catch(e){}
  const draft = list.find(d => d.projectNumber === projectNumber);
  if (!draft) { alert('Проект не найден'); return; }

  const k = (draft.modules && draft.modules.kupe) || {};
  // Восстанавливаем форму
  if (k.W != null) $('width').value  = k.W;
  if (k.H != null) $('height').value = k.H;
  if (k.N != null) {
    $('doorCount').value = k.N;
    updateChipsActive(k.N);
  }
  // Двух-уровневое восстановление: family → systemIdx → colorIdx
  if (k.profileSystemIdx != null) {
    const sysIdx = parseInt(k.profileSystemIdx);
    const sys = PROFILE_SYSTEMS[sysIdx];
    if (sys && sys.family) {
      $('profileFamily').value = sys.family;
      populateProfileSystemsForFamily(sys.family);
    }
    $('profileSystem').value = sysIdx;
    populateProfileColors(sysIdx);
  }
  if (k.profileColorIdx != null)  $('profileColor').value  = k.profileColorIdx;
  $('softClose').checked        = !!k.softClose;
  $('singlePartition').checked  = !!k.isSinglePartition;
  if ($('filmToggle')) $('filmToggle').checked = !!k.filmToggle;
  if (k.rowMm)      rowMm      = k.rowMm.slice();
  if (k.doorRowMm)  doorRowMm  = k.doorRowMm.slice();
  // doorTexRot — поворот текстуры ЛДСП per-door (если в draft есть, восстанавливаем; иначе пустой)
  doorTexRot = (k.doorTexRot && Array.isArray(k.doorTexRot)) ? k.doorTexRot.slice() : [];

  // Восстановление индекса пресета сетки секций (sectOpt)
  if (k.sectOpt && k.sectOpt.rowRatios && k.sectOpt.colRatios) {
    const idx = SECTION_OPTS.findIndex(o =>
      JSON.stringify(o.rowRatios) === JSON.stringify(k.sectOpt.rowRatios) &&
      JSON.stringify(o.colRatios) === JSON.stringify(k.sectOpt.colRatios)
    );
    if (idx >= 0) setSections(idx);
  }

  // v1.2: восстановление per-door overrides (старые drafts не содержат → пустой массив)
  doorSectOpt = (k.doorSectOpt && Array.isArray(k.doorSectOpt))
    ? k.doorSectOpt.map(o => o ? {
        rowRatios: o.rowRatios.slice(),
        colRatios: o.colRatios.slice(),
        h: o.h, v: o.v, label: o.label,
      } : null)
    : [];

  // Клиент
  window._kupeDraftClient = draft.client || null;

  // ALU/МДФ модули
  if (typeof AppState !== 'undefined') {
    if (draft.modules && draft.modules.fasadAlu) Object.assign(AppState.fasadAlu, draft.modules.fasadAlu);
    if (draft.modules && draft.modules.fasadMdf) Object.assign(AppState.fasadMdf, draft.modules.fasadMdf);
  }
  if (typeof fasadRows !== 'undefined' && draft.modules && draft.modules.fasadAlu && draft.modules.fasadAlu.rows) {
    fasadRows = draft.modules.fasadAlu.rows.slice();
  }
  if (typeof mdfRows !== 'undefined' && draft.modules && draft.modules.fasadMdf && draft.modules.fasadMdf.rows) {
    mdfRows = draft.modules.fasadMdf.rows.slice();
  }

  // Запоминаем номер проекта
  window._kupeProjectNum = draft.projectNumber;

  // Пересчитываем
  onDoorCountChange();
  calculate();

  // Восстанавливаем поля КП после калькуляции
  if (draft.client) {
    if ($('kpClient'))  $('kpClient').value  = draft.client.name || '';
    if ($('kpPhone'))   $('kpPhone').value   = draft.client.phone || '';
    if ($('kpManager')) $('kpManager').value = draft.client.manager || '';
  }

  // Закрываем поповер
  document.querySelectorAll('.kupe-drafts-pop').forEach(p => p.remove());
}


// Init router after module loads
onHashChange();


// ALU module вынесен в js/fasad-alu.js

