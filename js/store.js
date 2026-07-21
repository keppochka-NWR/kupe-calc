// js/store.js
// Глобальное состояние приложения и шина событий между модулями.
// Public: AppState, EventBus
// Depends on: ничего
//
// Использование:
//   AppState.kupe.lastCalcData = {...}
//   EventBus.on('tab:changed', ({to}) => console.log('switched to', to))
//   EventBus.emit('kp:open', {module:'kupe', data:{...}})

const AppState = {
  currentTab:    'kupe',
  currentOrder:  null,                              // {orderId, clientName, items: [...]}
  kupe:          { lastCalcData: null },
  fasadAlu:      { rows: [], lastTotals: null },
  fasadMdf:      { rows: [], lastTotals: null },
  ui:            { kpOpen: false, theme: 'light' }
};

const EventBus = {
  _listeners: {},
  on(event, handler) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(handler);
  },
  off(event, handler) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(h => h !== handler);
  },
  emit(event, payload) {
    if (!this._listeners[event]) return;
    this._listeners[event].forEach(h => {
      try { h(payload); } catch (e) { console.error('EventBus handler error for', event, e); }
    });
  }
};

// Соглашение по событиям проекта (см. ARCHITECTURE.md §4):
//   tab:changed       {from, to}      — router → модули
//   kp:open           {module, data}  — модули → shared-kp
//   kp:close          —               — shared-kp → модули
//   prices:updated    {file}          — dev-only → модули
//   theme:changed     {theme}         — UI → модули/CSS
//   kupe:calculated   {data}          — KupeModule → подписчики
//   fasad-alu:changed {totals}        — FasadAluModule → подписчики
