// A public project JWT identifies the gateway audience; cron_token remains the secret
// authorization capability checked by handler before any claim or provider operation.
export function machineAuthorization(request,{serviceKey,anonKey}) {
 const bearer=request.headers.get('Authorization');
 return !!bearer && ((!!serviceKey&&bearer==='Bearer '+serviceKey)
  || (!!anonKey&&bearer==='Bearer '+anonKey));
}
