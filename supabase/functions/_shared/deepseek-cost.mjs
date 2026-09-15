// https://api-docs.deepseek.com/quick_start/pricing/ checked 2026-09-15.
// DeepSeek-V4.1-Flash peak prices:
// cache-miss input USD 0.30 / 1M tokens, output USD 1.20 / 1M tokens.
// UTF-8 bytes are used as an intentionally conservative token upper bound,
// then a 25% safety margin covers message framing and price rounding.
export const MAX_OUTPUT_TOKENS=4000;
export function reserveMicrousd(system,prompt,maxOutputTokens=MAX_OUTPUT_TOKENS,extraInputBytes=0){
 if(typeof system!=='string'||typeof prompt!=='string'||!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<1||maxOutputTokens>8000)throw Error('COST_INPUT_INVALID');
 if(!Number.isSafeInteger(extraInputBytes)||extraInputBytes<0)throw Error('COST_INPUT_INVALID');
 const inputBytes=new TextEncoder().encode(system).byteLength+new TextEncoder().encode(prompt).byteLength+extraInputBytes+4096;
 return Math.ceil(inputBytes*0.375+maxOutputTokens*1.5);
}
