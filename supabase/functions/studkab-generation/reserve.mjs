import {reserveMicrousd} from '../_shared/deepseek-cost.mjs';
export function checkReserve(claim){
 const maximum=claim.spec?.max_cost_microusd,needed=reserveMicrousd(claim.input?.system,claim.spec?.prompt,claim.spec?.max_output_tokens);
 if(!Number.isSafeInteger(maximum)||maximum<needed)throw Error('RESERVE_TOO_SMALL');
 return claim;
}
