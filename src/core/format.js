/** 数字与时间的展示格式化。 */

const CN_UNITS = [
  { value: 1e16, suffix: '京' },
  { value: 1e12, suffix: '兆' },
  { value: 1e8, suffix: '亿' },
  { value: 1e4, suffix: '万' },
];

/**
 * 把数字格式化为中文习惯的短字符串。
 * @param {number} n
 * @param {number} [digits] 小于一万时保留的小数位
 */
function fmt(n, digits = 0) {
  if (!Number.isFinite(n)) return '0';
  const neg = n < 0;
  let v = Math.abs(n);

  if (v >= 1e4) {
    for (const u of CN_UNITS) {
      if (v >= u.value) {
        const scaled = v / u.value;
        const text = scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(2);
        return (neg ? '-' : '') + trimZeros(text) + u.suffix;
      }
    }
  }

  const text = digits > 0 ? v.toFixed(digits) : String(Math.floor(v));
  return (neg ? '-' : '') + trimZeros(text);
}

/** 去掉小数末尾多余的 0。 */
function trimZeros(text) {
  if (!text.includes('.')) return text;
  return text.replace(/\.?0+$/, '');
}

/** 每秒速率，带符号显示。 */
function fmtRate(n, digits = 2) {
  if (!Number.isFinite(n)) return '0';
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return sign + trimZeros(Math.abs(n).toFixed(digits));
}

/** 比例转百分比文本。 */
function fmtPercent(ratio, digits = 1) {
  if (!Number.isFinite(ratio)) return '0%';
  return trimZeros((ratio * 100).toFixed(digits)) + '%';
}

/**
 * 灵石。兑率以 0.1 为单位，所以要保留一位小数，
 * 不能像银两那样直接取整——否则 0.3 枚会被显示成 0。
 */
function fmtStones(n) {
  if (!Number.isFinite(n)) return '0';
  const v = Math.max(0, n);
  if (v >= 10000) return fmt(v, 1);
  return trimZeros(v.toFixed(1));
}

/** 秒数转「x时x分x秒」。 */
function fmtDuration(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分${String(s % 60).padStart(2, '0')}秒`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}时${String(m % 60).padStart(2, '0')}分`;
  const d = Math.floor(h / 24);
  return `${d}天${h % 24}时`;
}

/** 毫秒时间戳转 HH:MM:SS。 */
function fmtClock(ms) {
  const d = new Date(ms);
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
