export function normalizeHeaderValue(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new Error(`${label} 不能为空`);
  }

  for (const character of normalized) {
    const codePoint = character.codePointAt(0);
    if (codePoint > 255 || character === "\r" || character === "\n") {
      throw new Error(`${label} 只能包含 ASCII 字符，请检查是否误粘贴了中文提示词或其他文本`);
    }
  }

  return normalized;
}
