export function checkReserve(claim){
 if(!Number.isSafeInteger(claim.spec?.max_cost_microusd)||claim.spec.max_cost_microusd<250000)throw Error('RESERVE_TOO_SMALL');
 return claim;
}
