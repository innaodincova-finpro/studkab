// Supabase verify_jwt validates the bearer before the request reaches this function.
// The private cron_token remains the authorization capability checked by handler
// before any configuration read, claim or provider operation.
export function machineAuthorization(request) {
 const bearer=request.headers.get('Authorization');
 return typeof bearer==='string' && /^Bearer\s+\S+$/.test(bearer);
}
