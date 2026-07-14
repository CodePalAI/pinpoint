# External integration examples

These modules live outside `src` and import only Pixroom's public package API.

- `redact-secrets.mjs`: a lossy, cache-invalidating policy integration. It demonstrates that the kernel can host useful non-compression behavior. Review and customize patterns before production use.
- `json-tool-minifier.mjs`: a deterministic, lossless JSON-value minifier for Anthropic tool results, OpenAI Chat tool messages, and OpenAI Responses function outputs.

**Security note:** `redact-secrets.mjs` is a deliberately lossy example that invalidates prompt-cache prefixes. It is not a substitute for secret management or input prevention. Review and constrain every pattern before using it on untrusted traffic.

```js
import { createRuntime } from 'pixroom';
import { createSecretRedactionIntegration } from './redact-secrets.mjs';
import { createJsonToolMinifierIntegration } from './json-tool-minifier.mjs';

const runtime = createRuntime({
  includeBuiltinIntegrations: false,
  integrations: [
    createSecretRedactionIntegration(),
    createJsonToolMinifierIntegration(),
  ],
});
```

Integrations must remain side-effect free during `propose`. External writes belong in the optional transaction `commit` hook.