export function fmt(value, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  if (!Number.isFinite(value)) return String(value);
  return Number(value.toFixed(digits)).toLocaleString(undefined, {
    maximumFractionDigits: digits,
  });
}

export function parseNumber(value) {
  if (value === null || value === undefined || value === "") return NaN;
  const number = Number(String(value).trim());
  return Number.isFinite(number) ? number : NaN;
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
