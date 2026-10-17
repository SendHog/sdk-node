# SendHog JavaScript / TypeScript SDK

Send transactional email through [SendHog](https://sendhog.com) with a domain-scoped
API key. Native API plus SES-, Postmark-, Resend- and SendGrid-shaped migration
clients, all using SendHog authentication and the same transport.

Requires Node.js 22+. MIT licensed. Registry publication status is recorded in
[GitHub Releases](https://github.com/SendHog/sdk-node/releases); do not assume a
version exists on npm until it is listed there as published.

## Install

```sh
npm install @sendhog/sdk
```

Before the first registry release, install the public source instead:
`npm install git+https://github.com/SendHog/sdk-node.git`.

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
attachments, batch, scheduling, tracking or complete upstream SDK compatibility.
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
