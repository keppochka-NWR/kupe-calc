// js/router.js
// Hash-маршрутизация между вкладками + lazy-инициализация модулей.
// Public: TABS, navigateTo, onHashChange
// Depends on: store.js (EventBus, AppState)
//
// Соглашение:
// - Все вкладки скрыты CSS (.module-page{display:none}); активная — .active.
// - Каждый модуль регистрирует свой init: ROUTER.registerInit('tab-id', () => Module.init())
// - При первом переходе на вкладку — её init вызывается один раз, далее не повторяется.

const TABS = {
  'kupe':        'page-kupe',
  'fasad-alu':   'page-fasad-alu',
  'fasad-paint': 'page-fasad-paint',
  'podves':      'page-podves',
  'furnitura':   'page-furnitura',
};

// Реестр init-функций модулей (заполняется модулями при загрузке)
const _moduleInits = {};
const _initedModules = new Set();

const ROUTER = {
  registerInit(tabId, fn) {
    _moduleInits[tabId] = fn;
  }
};

function navigateTo(tabId) {
  const fromTab = AppState.currentTab;
  // Hide all pages
  document.querySelectorAll('.module-page').forEach(p => p.classList.remove('active'));
  // Deactivate all tabs
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  // Activate target
  const pageId = TABS[tabId] || TABS['kupe'];
  const page = document.getElementById(pageId);
  if (page) page.classList.add('active');
  const tab = document.querySelector('[data-tab="' + tabId + '"]');
  if (tab) tab.classList.add('active');

  // Lazy-init модуля при первом открытии
  if (!_initedModules.has(tabId)) {
    const initFn = _moduleInits[tabId];
    if (typeof initFn === 'function') {
      try { initFn(); } catch (e) { console.error('Module init error for', tabId, e); }
      _initedModules.add(tabId);
    } else if (tabId === 'fasad-alu' && typeof initFasadModule === 'function') {
      // Обратная совместимость с не-зарегистрированными модулями
      initFasadModule();
      _initedModules.add(tabId);
    }
  }

  // Обновить состояние и сообщить подписчикам
  AppState.currentTab = tabId;
  if (typeof EventBus !== 'undefined') {
    EventBus.emit('tab:changed', { from: fromTab, to: tabId });
  }
}

function onHashChange() {
  const hash = (location.hash || '#kupe').replace('#', '');
  navigateTo(hash);
}

// Tab click
document.getElementById('navTabs').addEventListener('click', function(e) {
  const tab = e.target.closest('.nav-tab');
  if (!tab) return;
  e.preventDefault();
  const tabId = tab.dataset.tab;
  location.hash = '#' + tabId;
});

window.addEventListener('hashchange', onHashChange);
