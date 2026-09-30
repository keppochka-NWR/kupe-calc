// js/utils.js
// Общие утилиты, используемые всеми модулями.
// Public: $, num, fmt, pluralDoors, debounce, escapeHtml, escapeAttr
// Depends on: ничего (только DOM API)

const $ = id => document.getElementById(id);

// Only numbers and sums are accepted; never execute dimension input as code.
function parseDimensionSum(raw) {
  const text = String(raw).trim();
  if (!/^\d+(?:[.,]\d+)?(?:\s*\+\s*\d+(?:[.,]\d+)?)*$/.test(text)) return NaN;
  const value = text.split('+').reduce((sum, term) => sum + Number(term.trim().replace(',', '.')), 0);
  return Number.isFinite(value) ? Number(value.toFixed(6)) : NaN;
}

const num = (id, fallback = 0) => {
  const input = $(id);
  const value = input.hasAttribute('data-dimension-sum') ? parseDimensionSum(input.value) : +input.value;
  return value || fallback;
};

const fmt = n => {
  // Защита от NaN/Infinity — в КП и UI не должны попадать «NaN ₽» или «∞ ₽».
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('ru-RU', {maximumFractionDigits:0}).format(Math.round(n));
};

const pluralDoors = n => n === 1 ? 'дверь' : n < 5 ? 'двери' : 'дверей';

// Debounce — задержка для инпутов (ширина/высота и т.п.)
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// XSS-защита: экранирование HTML-спецсимволов перед вставкой в innerHTML.
// Использовать для ЛЮБЫХ значений из пользовательского ввода (КП-поля, имя клиента, projectNumber и т.д.)
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// XSS-защита для HTML-атрибутов (когда нужно вставить значение в data-* или title=)
function escapeAttr(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
