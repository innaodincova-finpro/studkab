import {sameSecret} from '../_shared/secret-equal.mjs';
// C-054 (аудит, замечание 10): служебный ключ проверяется до чтения настроек,
// которые при первом обращении создают ключи подписи уведомлений.
export async function cronAllowed(key, readCronToken) {
  if (typeof key !== 'string' || !key) return false;
  const token = await readCronToken();
  return sameSecret(key, token);
}
// C-054 (аудит, замечание 5): уведомления подключаются только допущенным студентам.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function memberAllowed(userId, isMember) {
  if (typeof userId !== 'string' || !uuid.test(userId) || typeof isMember !== 'function') return false;
  return (await isMember(userId)) === true;
}
