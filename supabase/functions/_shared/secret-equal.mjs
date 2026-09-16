// C-054 (аудит, замечание 9): сравнение служебных ключей без раннего выхода.
// Время сравнения не зависит от того, в каком знаке ключи расходятся.
const encoder = new TextEncoder();
export function sameSecret(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string' || !expected) return false;
  const a = encoder.encode(given), b = encoder.encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
  return diff === 0;
}
