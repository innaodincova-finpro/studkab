// Historical rows remain immutable and downloadable; only leaves feed preparation.
export function currentAttachments(rows) {
 const replaced=new Set(rows.map(row=>row.supersedes).filter(Boolean));
 return rows.filter(row=>!replaced.has(row.id));
}
