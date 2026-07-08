// V0.3.11-hotfix-4：统一的 sk-* 形态字符串脱敏
// 匹配独立的 sk-* 形态内容，避免误伤 codex-task-prompt 这类普通内部标识。
// 递归处理对象 / 数组 / 字符串；保留非字符串原始值。

const SK_LIKE_RE = /(?<![A-Za-z0-9_])sk-[A-Za-z0-9_-]+/g;
const REDACTED = "[redacted]";

function redactSecretLikeText(value) {
  if (value == null) return value;
  if (typeof value === "string") {
    return value.replace(SK_LIKE_RE, REDACTED);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSecretLikeText(item));
  }
  if (typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value)) {
      out[key] = redactSecretLikeText(value[key]);
    }
    return out;
  }
  // 数字 / 布尔 / 其他类型直接返回
  return value;
}

module.exports = { redactSecretLikeText, SK_LIKE_RE, REDACTED };
