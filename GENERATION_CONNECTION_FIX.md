# Generation connection fix — 2026-09-11

## Confirmed evidence

FIN-UAT-01 export has complete inputs and nine empty document sections. Generation begins with chapter 1 by design. User screenshot reports a browser network failure, not a decoded provider error. A short DeepSeek connectivity test succeeded previously on the user's phone. These facts do not establish whether the failed request reached the provider or was billed.

Main checked at 8a3b779d67ff149feec246f50b3dcec77f7aff0d. Its proxy buffers the entire provider response before responding to the browser. Its frontend has no request deadline and collapses network failures into an instruction to check address/network, without durable technical metadata.

## Changes

Client opts into JSON whitespace heartbeat; proxy immediately responds after validation and sends whitespace every ten seconds until a complete result or safe error. Existing clients retain ordinary JSON/HTTP behavior. Heartbeat clients inspect the JSON error even with HTTP 200. This reduces silent waiting; it is not a background job and cannot guarantee survival of mobile suspension or connection loss.

Client deadline is 195 seconds, allowing the existing 180-second provider deadline to respond. Cancellation propagates upstream in the heartbeat path. No retry is automatic. Diagnostics retain the last 20 failures: timestamp, provider, connection/body phase, HTTP status, elapsed seconds and category. No prompts, answer content, URLs, tokens or credentials are logged. Diagnostics are included in the existing backup.

Incomplete provider output remains an error and never becomes a successful section. No existing request data, prompts, criteria or generated sections are migrated.

## Verification and limits

75 main-suite Node tests passed locally, including seven new transport/heartbeat tests. Tested delayed completion, network failure before headers, interrupted body, timeout, cancellation, incomplete output, backward-compatible JSON and sensitive-data exclusion. Main's cache regression test updated for the new cache version.

No real paid generation was executed. The deployed Cloudflare worker version, provider logs and exact historical failure cause remain unknown. Browser access was previously blocked; this change does not bypass that block. A working provider credential and authorized server access are required for production acceptance.

## Release / rollback

Deploy worker first using the existing worker identity and secrets, then frontend. GitHub Pages deployment alone does not update Cloudflare. Verify the complete synthetic coursework flow before declaring it functional. Keep PR draft until deployment access and real test are resolved. If needed revert frontend commit; non-heartbeat requests keep the old worker response protocol. Revert worker deployment separately if necessary. No database or user-data rollback is required by this code change.

References: https://developers.cloudflare.com/workers/platform/limits/ (HTTP duration depends on client connection; no universal short wall-time limit). Do not attribute this incident to a presumed free-plan timeout without logs.
