// js/shared-kp.js
// Общая логика КП-документа: открытие/закрытие модального окна, инжект HTML.
// Каждый модуль (купе, ALU, МДФ) генерирует свой HTML через собственный buildXxxKPHTML(),
// затем вызывает displayKPDocument(html) для показа в общем модальном окне #kpDocument.
//
// Public: closeKP, displayKPDocument
// Depends on: utils.js ($), store.js (AppState, EventBus)

/**
 * Закрыть модальное окно КП (используется кнопкой «Закрыть» в шапке модалки).
 * Глобальная функция, доступна из всех модулей.
 */
function closeKP() {
  const modal = document.getElementById('kpDocument');
  if (modal) modal.classList.remove('kp-open');
  document.body.style.overflow = '';
  if (typeof AppState !== 'undefined') AppState.ui.kpOpen = false;
  if (typeof EventBus !== 'undefined') EventBus.emit('kp:close');
}

/**
 * Показать готовый HTML-документ КП в модальном окне.
 * @param {string} html  — HTML, готовый для вставки в .kp-page (без обёрток)
 * @param {string} [moduleId] — id модуля-источника (для AppState/EventBus)
 */
function displayKPDocument(html, moduleId) {
  const el = document.getElementById('kpPageContent');
  if (!el) {
    console.error('displayKPDocument: #kpPageContent not found');
    return;
  }
  el.innerHTML = html;
  const modal = document.getElementById('kpDocument');
  if (modal) {
    modal.classList.add('kp-open');
    document.body.style.overflow = 'hidden';
  }
  if (typeof AppState !== 'undefined') AppState.ui.kpOpen = true;
  if (typeof EventBus !== 'undefined') EventBus.emit('kp:open', { module: moduleId || null });
}
