/** STATE-01/02: pure projection, not authorization or a durable queue.
 * Adapters accept responses from r3-state.work (r3-work.mjs), claude-state.claude
 * (claude-exec.mjs), generation status (generation-api/handler.mjs), and optional
 * result-review-state (results.mjs). Raw DB rows must be adapted by the caller.
 * Only server observations belong here: selectedProvider is a preference only.
 * Legacy generation 'running' includes a claim before dispatch; a sent attempt's
 * startedAt confirms dispatch, never provider acknowledgement/completion.
 * Legacy generation 'complete' confirms sections, not a returned Word file.
 * The caller enforces account ownership and snapshot freshness. This module cannot
 * invent missing revision bindings in legacy Claude/R3 data or authorize delivery.
 */
const PROVIDERS = new Set(['claude', 'chatgpt', 'deepseek']);
const HASH = /^[a-f0-9]{64}$/;
const STATES = {
 unknown: ['Состояние не подтверждено', 'check_status'], received: ['Задание получено', null],
 manual_work: ['Заявка в работе', 'prepare_work'], unavailable: ['Помощник недоступен', 'check_connection'],
 queued: ['Ожидается запуск', null], dispatched: ['Подготовка начата', null],
 sections_ready: ['Разделы подготовлены', 'check_status'], return_pending: ['Файл ожидает прикрепления', 'check_status'],
 file_prepared: ['Файл подготовлен', 'review_result'], reviewed: ['Работа проверена', 'deliver_result'],
 delivered: ['Работа передана', null], downloaded: ['Студент скачал работу', null],
 handed: ['Студент отметил сдачу', null], rework: ['Работа возвращена на доработку', 'open_feedback'],
 blocked: ['Подготовка недоступна', 'check_status'],
 kit_prepared: ['Комплект сохранён', 'prepare_work'], cancelled: ['Подготовка отменена', 'prepare_work']
};
function time(value) {
 if (value == null) return null;
 if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw Error('INVALID_TIMESTAMP');
 return value;
}
function after(a, b) { return !!a && (!b || Date.parse(a) > Date.parse(b)); }
function file(value, hashRequired = false) {
 if (value == null) return null;
 if (!value || typeof value !== 'object' || typeof value.name !== 'string' || !value.name.trim() ||
     !Number.isSafeInteger(value.size) || value.size < 1 || !value.at ||
     (hashRequired && !HASH.test(value.hash || ''))) throw Error('INVALID_FILE');
 return {name: value.name, size: value.size, at: time(value.at), ...(HASH.test(value.hash || '') ? {hash: value.hash} : {})};
}
export function adaptR3Work(work) {
 if (!work) return {takenAt: null, result: null, delivered: null, returnedAt: null, handedAt: null, downloadedAt: null};
 return {takenAt: time(work.takenAt), result: file(work.result, true), delivered: file(work.delivered),
 returnedAt: time(work.returnedAt), handedAt: time(work.handedAt), downloadedAt: time(work.downloadedAt)};
}
export function adaptClaudeState(claude) {
 if (!claude) return null;
 const value = {provider: 'claude', queuedAt: time(claude.queuedAt), startedAt: time(claude.startedAt),
 readyAt: time(claude.readyAt), attachedAt: time(claude.attachedAt), failed: !!claude.error};
 if ((value.startedAt && !value.queuedAt) || (value.readyAt && !value.startedAt) ||
     (value.attachedAt && !value.readyAt) || (value.startedAt && Date.parse(value.startedAt) < Date.parse(value.queuedAt)) ||
     (value.readyAt && Date.parse(value.readyAt) < Date.parse(value.startedAt)) ||
     (value.attachedAt && Date.parse(value.attachedAt) < Date.parse(value.readyAt))) throw Error('INCONSISTENT_CLAUDE');
 return value;
}
export function adaptGenerationState(generation) {
 if (!generation) return null;
 const job = generation.job;
 if (!job || typeof job.id !== 'string' || !job.id || !['queued', 'running', 'unknown', 'budget', 'complete'].includes(job.status)) throw Error('INVALID_GENERATION');
 const queuedAt = time(job.created_at);
 if (!queuedAt) throw Error('INVALID_GENERATION');
 const diagnostics = Array.isArray(generation.diagnostics) ? generation.diagnostics : [];
 const started = diagnostics.filter(d => ['sent', 'done', 'unknown'].includes(d.state) && d.startedAt).map(d => time(d.startedAt));
 const startedAt = started.sort((a,b) => Date.parse(a)-Date.parse(b))[0] || null;
 const parts = Array.isArray(generation.parts) ? generation.parts : [];
 if (startedAt && Date.parse(startedAt) < Date.parse(queuedAt)) throw Error('INCONSISTENT_GENERATION');
 if (job.status === 'complete' && (!parts.length || parts.some(p => p.state !== 'done' || typeof p.text !== 'string' || !p.text.trim()))) throw Error('INCOMPLETE_SECTIONS');
 return {provider: 'deepseek', queuedAt, startedAt, status: job.status,
 unknown: job.status === 'unknown' || parts.some(p => p.state === 'unknown') || diagnostics.some(d => d.state === 'unknown')};
}
/** Durable RPC studkab_assistant_state.job; acceptedAt proves saved snapshot only.
 * claimed is a lease before dispatch. bindingCurrent=false quarantines stale input.
 * Student RPC intentionally redacts provider/fingerprint/resultHash/reviewedAt.
 */
export function adaptDurableState(value) {
 if (!value) return null;
 const j = Object.hasOwn(value, 'job') ? value.job : value;
 if (!j) return null;
 if (typeof j.id !== 'string' || !j.id || !['prepared','queued','claimed','dispatched','completed','returning','returned','unknown','cancelled'].includes(j.state)) throw Error('INVALID_DURABLE_JOB');
 const d = {...j, acceptedAt: time(j.acceptedAt), queuedAt: time(j.queuedAt), startedAt: time(j.startedAt), returnedAt: time(j.returnedAt), reviewedAt: time(j.reviewedAt)};
 if (!d.acceptedAt || (d.queuedAt && Date.parse(d.queuedAt)<Date.parse(d.acceptedAt)) ||
 (d.startedAt && (!d.queuedAt || Date.parse(d.startedAt)<Date.parse(d.queuedAt))) ||
 (d.returnedAt && (!d.startedAt || Date.parse(d.returnedAt)<Date.parse(d.startedAt))) ||
 (d.reviewedAt && (!d.returnedAt || Date.parse(d.reviewedAt)<Date.parse(d.returnedAt)))) throw Error('INCONSISTENT_DURABLE_JOB');
 if (['queued','claimed','dispatched','completed','returning','returned'].includes(d.state) && !d.queuedAt) throw Error('MISSING_ACCEPTANCE');
 if (['dispatched','completed','returning','returned'].includes(d.state) && !d.startedAt) throw Error('MISSING_DISPATCH');
 if (d.state==='returned' && !d.returnedAt) throw Error('MISSING_RETURN_RECEIPT');
 return d;
}
function reviewed(reviewState, result) {
 if (!reviewState || reviewState.state !== 'reviewed') return false;
 const {receipt, review} = reviewState;
 return !!result && HASH.test(receipt?.fileHash || '') && receipt.fileHash === result.hash &&
 typeof receipt.versionId === 'string' && !!receipt.versionId && review?.versionId === receipt.versionId &&
 typeof review.reviewId === 'string' && !!review.reviewId && !!time(review.reviewedAt) &&
 Date.parse(review.reviewedAt) >= Date.parse(result.at);
}
/** Returns public, serializable facts only; no input objects/diagnostics are echoed.
 * observation.connected=false keeps the last known state as explicitly stale;
 * lastConfirmedAt is supplied by the caller after a successful server read.
 * connection={provider, available:false} is a checked capability observation,
 * not merely lack of a configured local preference.
 */
export function projectAssistantState(input = {}) {
 const role = input.role === 'student' ? 'student' : 'executor';
 let state = 'unknown', provider = null, visibleFile = null, reason = null;
 let confirmedAt = null, stale = input.observation?.connected === false;
 try {
  confirmedAt = time(input.observation?.lastConfirmedAt);
  if (!['student', 'executor'].includes(input.role)) throw Error('INVALID_ROLE');
  const observedWork=Object.hasOwn(input,'work')?input.work:input.durable?.work;
  if (observedWork===undefined) throw Error('MISSING_WORK_OBSERVATION');
  const d=adaptDurableState(input.durable);
  const w = adaptR3Work(observedWork), c = d?null:adaptClaudeState(input.claude), g = d?null:adaptGenerationState(input.generation);
  const returned = w.returnedAt;
  const delivered = w.delivered && after(w.delivered.at, returned) ? w.delivered : null;
  const result = w.result && after(w.result.at, returned) ? w.result : null;
  const currentC = c?.queuedAt && after(c.queuedAt, returned) ? c : null;
  const currentG = g?.queuedAt && after(g.queuedAt, returned) ? g : null;
  if ((w.handedAt || w.downloadedAt) && !w.delivered) throw Error('MISSING_DELIVERY');
  if (delivered && w.takenAt && Date.parse(delivered.at) < Date.parse(w.takenAt)) throw Error('INCONSISTENT_DELIVERY');
  if (delivered && ((w.downloadedAt && Date.parse(w.downloadedAt) < Date.parse(delivered.at)) ||
      (w.handedAt && Date.parse(w.handedAt) < Date.parse(delivered.at)))) throw Error('INCONSISTENT_DELIVERY');
  if (delivered) {
   state = 'delivered'; visibleFile = delivered;
   if (w.downloadedAt && Date.parse(w.downloadedAt) >= Date.parse(delivered.at)) state = 'downloaded';
   if (w.handedAt && Date.parse(w.handedAt) >= Date.parse(delivered.at)) state = 'handed';
  } else if (d?.bindingCurrent===false) {
   state='unknown';reason='MATERIALS_CHANGED';
  } else if (result) {
   if (!w.takenAt || Date.parse(result.at) < Date.parse(w.takenAt)) throw Error('INCONSISTENT_RESULT');
   if(d?.state==='returned' && d.resultHash && d.resultHash!==result.hash) throw Error('RESULT_BINDING_CHANGED');
   const durableReview=d?.state==='returned' && d.resultHash===result.hash && d.reviewedAt && Date.parse(d.reviewedAt)>=Date.parse(result.at);
   state = durableReview || reviewed(input.reviewState, result) ? 'reviewed' : 'file_prepared';
   if (role === 'executor') visibleFile = result;
  } else if (d && after(d.acceptedAt,returned)) {
   provider=PROVIDERS.has(d.provider)?d.provider:null;
   state={prepared:'kit_prepared',queued:'queued',claimed:'queued',dispatched:'dispatched',completed:'sections_ready',returning:'return_pending',returned:role==='student'?'file_prepared':'unknown',unknown:'unknown',cancelled:'cancelled'}[d.state];
   if(state==='unknown')reason='UNCONFIRMED_RETURN_OR_EXECUTION';
  } else if (currentC && currentG) {
   throw Error('CONFLICTING_JOBS');
  } else if (currentC) {
   provider = 'claude';
   state = currentC.failed ? 'unknown' : currentC.attachedAt ? 'unknown' : currentC.readyAt ? 'return_pending' : currentC.startedAt ? 'dispatched' : 'queued';
   if (state === 'unknown') reason = 'UNCONFIRMED_RETURN_OR_EXECUTION';
  } else if (currentG) {
   provider = 'deepseek';
   state = currentG.unknown ? 'unknown' : currentG.status === 'budget' ? 'blocked' : currentG.status === 'complete' ? 'sections_ready' : currentG.startedAt ? 'dispatched' : 'queued';
   if (state === 'unknown') reason = 'UNCONFIRMED_EXECUTION';
  } else if (returned) state = 'rework';
  else if (w.takenAt) state = 'manual_work';
  else if (input.connection?.available === false && PROVIDERS.has(input.connection.provider)) {
   state = 'unavailable'; provider = input.connection.provider;
  } else state = 'received';
 } catch { state = 'unknown'; provider = null; visibleFile = null; reason = 'INCONSISTENT_EVIDENCE'; }
 const [label, defaultAction] = STATES[state];
 // A saved kit proceeds to server preflight/planning; missing legacy plan is not a manual confirmation gate.
 const action=defaultAction;
 // A student never receives an undelivered file, worker diagnostics, or capability
 // remediation. A received file is represented without internal storage/hash data.
 const studentLabel = {manual_work: 'Задание у исполнителя', file_prepared: 'Работа у исполнителя', reviewed: 'Работа у исполнителя',
 kit_prepared: 'Задание у исполнителя', cancelled: 'Задание у исполнителя', sections_ready: 'Работа у исполнителя', return_pending: 'Работа у исполнителя', unavailable: 'Задание у исполнителя', blocked: 'Работа у исполнителя'}[state];
 const publicFile = visibleFile ? {name: visibleFile.name, size: visibleFile.size, at: visibleFile.at,
 ...(role === 'executor' && visibleFile.hash ? {hash: visibleFile.hash} : {})} : null;
 return {state, label: role === 'student' ? studentLabel || label : label,
 provider: role === 'executor' ? provider : null, file: publicFile,
 nextAction: stale ? 'check_status' : role === 'student' ? (['delivered','downloaded','handed'].includes(state) ? 'open_result' : state === 'rework' ? 'open_feedback' : state === 'unknown' ? 'check_status' : null) : action,
 reason: role === 'executor' ? reason : null, lastConfirmedAt: confirmedAt, stale};
}
