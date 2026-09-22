// Storage REST returns a path relative to /storage/v1, not the project origin.
export function attachmentDownloadUrl(base, signed, storagePath, fileName) {
 if(typeof signed!=='string')throw Error('Storage unavailable');
 const expected='/object/sign/studkab-request-materials/'+storagePath;
 const relative=signed.startsWith('/storage/v1/')?signed.slice('/storage/v1'.length):signed;
 if(relative.split('?')[0]!==expected)throw Error('Storage unavailable');
 const url=new URL('/storage/v1'+relative,base);
 if(url.pathname!=='/storage/v1'+expected||!url.searchParams.get('token')||url.hash)throw Error('Storage unavailable');
 url.searchParams.set('download',fileName);
 return url.href;
}
