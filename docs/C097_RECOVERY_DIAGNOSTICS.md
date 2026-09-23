# Recovery diagnostics

The activation screen previously described every verification failure as an
expired or already used link. It now uses fixed messages for expired OTP/invite,
HTTP 429, retryable network/service failures and unknown errors. Unknown errors
are not presented as confirmed expiry. Raw error messages and credentials are
never included in diagnostic output.

Existing-session protection, email matching, local sign-out on mismatch and
password validation remain unchanged. Once verification succeeds, a failed
password save can be retried on the same page without verifying the link again.
This change does not issue links, change authentication policy or perform any
administrative account operation.

Validation: `node --test tests/activation-recovery.test.mjs` — 14 tests passed.
Tests execute the actual inline activation script in a VM with a mocked Auth
client: existing session, expiry, network and service failures, rate limiting,
unknown errors, password-save retry, invite/recovery success and mismatches.
No real account or Auth API is used. Browser acceptance and deployment are
separate steps; this report does not claim successful recovery of a live account.

Error taxonomy: https://supabase.com/docs/guides/auth/debugging/error-codes
Rollback: restore the prior activation page. No schema or stored data changes.
