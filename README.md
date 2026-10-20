# SendHog JavaScript / TypeScript SDK

Version0.3.0 adds `email.received` to the existing signed webhook/event contract.
One endpoint can receive inbound mail, bounces, deliveries and the other email
events. Existing subscriptions are unchanged until you opt in. Enable domain
receiving/MX separately; details: https://sendhog.com/docs/receiving/.

Send transactional email through [SendHog](https://sendhog.com) with a domain-scoped
API key. Native API plus SES-, Postmark-, Resend- and SendGrid-shaped migration
clients, all using SendHog authentication and the same transport.

Requires Node.js 22+. MIT licensed. Available on
[npm as `@sendhog/sdk`](https://www.npmjs.com/package/@sendhog/sdk), starting with
version 0.1.0. See [GitHub Releases](https://github.com/SendHog/sdk-node/releases)
for release artifacts and provenance.

## Install

```sh
npm install @sendhog/sdk
```

JavaScript and TypeScript use the same package. All migration clients below are
included as package subpaths; do not install them as separate packages.

## Send

```ts
import { SendHog } from "@sendhog/sdk";

const client = new SendHog(process.env.SENDHOG_API_KEY!);
const message = await client.send({
  from: "hello@your-verified-domain.com",
  to: "recipient@example.com",
  subject: "Welcome",
  html: "<h1>Welcome</h1>",
  text: "Welcome",
});
console.log(message.id);
```

Your domain must be verified and approved for sending. Account allowances,
recipient suppressions and other server-side controls still apply. Keep API keys
on your server; never put one in browser code.

## Published templates

```ts
await client.send({
  from: "hello@your-verified-domain.com",
  to: "recipient@example.com",
  template: { id: "welcome", version: 1, variables: { name: "Alex" } },
});
```

Use an ID or slug from your sending domain. Omit `version` for latest published.
Template and inline `html`/`text` are mutually exclusive. Variables are bounded
strings/numbers/booleans, escaped in HTML; missing variables fail before dispatch.
Render React Email in your own application and pass HTML; React nodes are not HTTP
payloads and arbitrary JSX does not run on SendHog.

## Read retained mail

```ts
const page = await client.messages.list({ limit: 20 });
const detail = await client.messages.get(page.data[0].id);
```

Requires `email.read`. This is a SendHog extension, not provider inbox/API emulation.
No automatic send retries; inspect failures before resubmitting an email.

## Migration clients

| Import                  | Supported method                                |
| ----------------------- | ----------------------------------------------- |
| `@sendhog/sdk/ses`      | `SESv2Client.send(new SendEmailCommand(input))` |
| `@sendhog/sdk/postmark` | `ServerClient.sendEmail(input)`                 |
| `@sendhog/sdk/resend`   | `Resend.emails.send(input)`                     |
| `@sendhog/sdk/sendgrid` | `SendGridClient.send(input)`                    |

All use **SendHog** API keys/endpoints, not upstream credentials or SigV4. Only the
documented subset is supported: text/HTML, up to 50 total recipients, cc/bcc/reply-to;
native/Resend-style requests also support published SendHog templates. No raw MIME,
outbound attachments, provider batch APIs, scheduling, tracking or complete upstream
SDK compatibility. Native `sendBulk` is supported as described below.
[Documentation](https://sendhog.com/docs/sdks/) · [Migration](https://sendhog.com/docs/migration/).

## Source and development

This repository is a reproducible release mirror of SendHog's canonical SDK source.
`SOURCE.json` records the exact source revision, contract hash and exported file
digests. The public `contract/` snapshot and tests are synthetic and contain no
service implementation or credentials. Maintainers change the canonical generator
or language runtime and re-export; don't maintain a separate API fork here.

```sh
npm ci
npm run verify:source
npm test
npm run typecheck
npm pack --dry-run
```

CI runs on pushes/PRs. The manual `publish.yml` workflow publishes a matching `vX.Y.Z`
tag using npm trusted publishing after the registry publisher is configured. The
GitHub environment is `npm`. Initial npm authentication/namespace ownership must
be configured by an authorized maintainer; no registry token is stored here.
# Bulk sending and email events (0.2.0)

`client.sendBulk({from,template:{id,variables},recipients:[{to,variables}]},
{idempotencyKey:'stable-operation-id'})` sends one personalized message per recipient
(up to50), waits for SES acceptance and returns ordered individual results. Inspect
with `client.bulk.get(id)`. Repeating the same key never resends/resumes the batch.
`client.send(message,{idempotencyKey})` also supports safe single-send replays.

`client.messages.events(id,{limit,after})` reads30-day SES event history with an
email.read key. `client.webhooks.create({url,events})`, `.list()` and `.delete(id)`
require webhooks.manage. Creation returns `{webhook,secret}`; store the secret
securely. Verify exact raw request bodies with exported `verifyWebhook(body,
headers,secret)` or `client.webhooks.verify(...)` before trusting JSON.

Email acceptance is not recipient delivery. No customer email queue flag exists.
See https://sendhog.com/docs/templates/ and https://sendhog.com/docs/webhooks/.

## Unified received-email webhooks (0.3.0)

```ts
const { webhook, secret } = await client.webhooks.create({
  url: 'https://example.com/webhooks/sendhog',
  events: ['email.received', 'email.bounced', 'email.delivered'],
});
// Save secret securely; it is returned only once. Never log it.
```

Creation requires `webhooks.manage`. Verify the exact raw body with
`verifyWebhook(rawBody, headers, secret)` before parsing/processing and deduplicate
the returned event ID. All eleven types use the same signer, envelope and retry
policy. A received notification contains metadata, not body/attachment bytes;
`client.messages.get(event.data.message_id)` reads retained text with `email.read`.
Native HTTP `GET /v1/messages/{id}/raw` downloads the original MIME and attachments
with the same read scope; this binary route is not a provider SDK method.
Webhook retries never resend email. Older SDK0.2 validators reject email.received;
upgrade before selecting it. Normal sends and outgoing-event subscriptions remain
backward-compatible.
