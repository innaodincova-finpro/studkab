// Server-only execution core. Node 24; the database must live on persistent storage.
import {DatabaseSync} from 'node:sqlite';
import {createHash, randomUUID} from 'node:crypto';

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
function integer(n) { return Number.isSafeInteger(n) && n >= 0; }
export class Jobs {
  constructor(path, {now = Date.now, leaseMs = 240000} = {}) {
    this.now = now; this.leaseMs = leaseMs;
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, request TEXT NOT NULL,
        version TEXT NOT NULL, input TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
        budget INTEGER NOT NULL, reserved INTEGER NOT NULL DEFAULT 0,
        UNIQUE(owner,request,version));
      CREATE TABLE IF NOT EXISTS parts (
        job TEXT NOT NULL REFERENCES jobs(id), position INTEGER NOT NULL,
        spec TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', text TEXT,
        attempt INTEGER NOT NULL DEFAULT 0, claim TEXT, deadline INTEGER,
        request_id TEXT, reason TEXT, detail TEXT,
        PRIMARY KEY(job,position));
      PRAGMA foreign_keys=ON;`);
  }
  close() { this.db.close(); }
  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  // owner must be obtained by an authenticated server adapter, never trusted from a client.
  start(owner, request, input, specs, budget) {
    if (!owner || !request || !integer(budget) || !Array.isArray(specs) || !specs.length || specs.length > 100) throw Error('INVALID_JOB');
    if (specs.some(s => !s || typeof s.id !== 'string' || typeof s.prompt !== 'string' || !integer(s.maxCost) || s.maxCost < 1)) throw Error('INVALID_PART');
    if (new Set(specs.map(s => s.id)).size !== specs.length) throw Error('DUPLICATE_PART_ID');
    // Include the generation plan and its requirements, not merely material text.
    const snapshot = canonical({input, specs});
    const version = createHash('sha256').update(snapshot).digest('hex');
    return this.tx(() => {
      const prior = this.db.prepare('SELECT id FROM jobs WHERE owner=? AND request=? AND version=?').get(owner, request, version);
      if (prior) return prior.id;
      const id = randomUUID();
      this.db.prepare('INSERT INTO jobs(id,owner,request,version,input,budget) VALUES(?,?,?,?,?,?)').run(id, owner, request, version, snapshot, budget);
      specs.forEach((s, i) => this.db.prepare('INSERT INTO parts(job,position,spec) VALUES(?,?,?)').run(id, i, JSON.stringify(s)));
      return id;
    });
  }
  read(owner, id) {
    const job = this.db.prepare('SELECT * FROM jobs WHERE id=? AND owner=?').get(id, owner);
    if (!job) throw Error('NOT_FOUND');
    return {...job, parts: this.db.prepare('SELECT * FROM parts WHERE job=? ORDER BY position').all(id)};
  }
  recover() {
    return this.tx(() => {
      // A crash before dispatch is safe to retry. A crash after dispatch is ambiguous.
      this.db.prepare("UPDATE parts SET status='queued',claim=NULL,deadline=NULL WHERE status='claimed' AND deadline<=?").run(this.now());
      this.db.prepare("UPDATE parts SET status='unknown',reason='LEASE_EXPIRED_AFTER_DISPATCH' WHERE status='sent' AND deadline<=?").run(this.now());
      this.db.exec("UPDATE jobs SET status='unknown' WHERE EXISTS(SELECT 1 FROM parts WHERE parts.job=jobs.id AND parts.status='unknown')");
    });
  }
  claim() {
    this.recover();
    return this.tx(() => {
      const row = this.db.prepare(`SELECT p.*, j.input,j.version FROM parts p JOIN jobs j ON j.id=p.job
        WHERE j.status IN ('queued','running') AND p.status='queued'
        AND NOT EXISTS(SELECT 1 FROM parts earlier WHERE earlier.job=p.job AND earlier.position<p.position AND earlier.status!='done')
        ORDER BY j.rowid,p.position LIMIT 1`).get();
      if (!row) return null;
      const claim = randomUUID();
      this.db.prepare("UPDATE parts SET status='claimed',claim=?,deadline=? WHERE job=? AND position=?").run(claim, this.now() + this.leaseMs, row.job, row.position);
      this.db.prepare("UPDATE jobs SET status='running' WHERE id=?").run(row.job);
      return {...row, claim, spec: JSON.parse(row.spec), input: JSON.parse(row.input).input};
    });
  }
  dispatch(c) {
    return this.tx(() => {
      const p = this.db.prepare("SELECT * FROM parts WHERE job=? AND position=? AND claim=? AND status='claimed' AND deadline>?").get(c.job,c.position,c.claim,this.now());
      if (!p) throw Error('STALE_CLAIM');
      const spec = JSON.parse(p.spec);
      const j = this.db.prepare('SELECT * FROM jobs WHERE id=?').get(c.job);
      if (j.reserved + spec.maxCost > j.budget) {
        this.db.prepare("UPDATE jobs SET status='budget' WHERE id=?").run(c.job);
        this.db.prepare("UPDATE parts SET status='queued',claim=NULL WHERE job=? AND position=?").run(c.job,c.position);
        return null;
      }
      const requestId = randomUUID();
      // Commit intent and the worst-case charge BEFORE any network request.
      this.db.prepare('UPDATE jobs SET reserved=reserved+? WHERE id=?').run(spec.maxCost,c.job);
      this.db.prepare("UPDATE parts SET status='sent',attempt=attempt+1,request_id=? WHERE job=? AND position=?").run(requestId,c.job,c.position);
      return requestId;
    });
  }
  settle(c, {text, reason, detail = {}}) {
    return this.tx(() => {
      const p = this.db.prepare("SELECT * FROM parts WHERE job=? AND position=? AND claim=? AND status='sent' AND deadline>?").get(c.job,c.position,c.claim,this.now());
      if (!p) throw Error('STALE_RESULT');
      const done = typeof text === 'string' && text.trim().length > 0 && !reason;
      // No automatic repeats of dispatched requests, including provider failures.
      const status = done ? 'done' : 'unknown';
      const safe = {};
      for (const key of ['prompt_tokens','completion_tokens']) if(integer(detail[key])) safe[key]=detail[key];
      for (const key of ['finish_reason','request_id']) if(typeof detail[key]==='string' && /^[\w.-]{1,120}$/.test(detail[key])) safe[key]=detail[key];
      this.db.prepare('UPDATE parts SET status=?,text=?,reason=?,detail=? WHERE job=? AND position=?').run(status,done?text:null,done?null:'RESULT_UNKNOWN',JSON.stringify(safe),c.job,c.position);
      const remaining = this.db.prepare("SELECT count(*) AS n FROM parts WHERE job=? AND status!='done'").get(c.job).n;
      this.db.prepare('UPDATE jobs SET status=? WHERE id=?').run(done?(remaining?'running':'complete'):'unknown',c.job);
      return status;
    });
  }
}

// The scheduler calls this independently of the browser. Provider timeout must be < lease.
// provider must have transport retries disabled. No supplied adapter makes paid calls by default.
export async function tick(jobs, provider) {
  const c = jobs.claim();
  if (!c) return false;
  const requestId = jobs.dispatch(c);
  if (!requestId) return false;
  let result;
  try { result = await provider({...c, requestId}); }
  catch { result = {reason:'RESULT_UNKNOWN'}; }
  jobs.settle(c,result);
  return true;
}
