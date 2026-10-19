// Docs: docs/sdk-schema-plan.md. Shared transport/translation; generated classes are thin.
import { addressParser } from "postal-mime";
import { validate, manifest, ValidationError } from "./validation.js";
import { verifyWebhook } from './webhooks.js';
export { ValidationError };
export class ApiError extends Error {
  constructor(status, body) {
    super(body.error.message);
    this.name = body.error.code;
    this.statusCode = status;
    this.code = body.error.code;
    this.requestId = body.error.request_id;
  }
}
export class ProtocolError extends Error {
  constructor() {
    super("SendHog returned a response outside the public schema.");
    this.name = "ProtocolError";
  }
}
const list = (value) =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value];
function csv(value) {
  if (value === undefined) return undefined;
  if (/[\r\n]/.test(value))
    throw new ValidationError("AddressList", ["/addresses"]);
  if (!value.trim()) return [];
  const parsed = addressParser(value, { flatten: true });
  return parsed.map((a) => mailbox({ name: a.name, email: a.address }));
}
function mailbox(value) {
  return typeof value === "string"
    ? value
    : value.name
      ? `${JSON.stringify(value.name)} <${value.email}>`
      : value.email;
}
export function normalize(provider, input) {
  validate(provider.request, input);
  if (provider.format === "native") {
    const request = { ...input };
    for (const field of ["to", "cc", "bcc", "replyTo"])
      if (input[field] !== undefined) request[field] = list(input[field]);
    checkRecipients(request);
    return request;
  }
  if (provider.format === "ses") {
    const request = {
      from: input.FromEmailAddress,
      subject: input.Content.Simple.Subject.Data,
    };
    for (const [field, target] of [
      ["ToAddresses", "to"],
      ["CcAddresses", "cc"],
      ["BccAddresses", "bcc"],
    ])
      if (input.Destination[field]?.length)
        request[target] = input.Destination[field];
    for (const [field, target] of [
      ["Text", "text"],
      ["Html", "html"],
    ])
      if (input.Content.Simple.Body[field])
        request[target] = input.Content.Simple.Body[field].Data;
    if (input.ReplyToAddresses?.length)
      request.replyTo = input.ReplyToAddresses;
    validate("SendRequest", request);
    checkRecipients(request);
    return request;
  }
  const f = provider.fields;
  const addresses = (value) =>
    provider.format === "postmark"
      ? csv(value)
      : provider.format === "sendgrid"
        ? list(value)?.map(mailbox)
        : list(value);
  const request = {
    from:
      provider.format === "sendgrid" ? mailbox(input[f.from]) : input[f.from],
    subject: input[f.subject] ?? "",
  };
  if (input.template !== undefined) {
    request.template = input.template;
    if (input[f.subject] === undefined) delete request.subject;
  }
  for (const field of ["to", "cc", "bcc"]) {
    const values = addresses(input[f[field]]);
    if (values?.length) request[field] = values;
  }
  for (const field of ["text", "html"])
    if (input[f[field]] !== undefined) request[field] = input[f[field]];
  const reply = addresses(input[f.replyTo]);
  if (reply?.length) request.replyTo = reply;
  validate("SendRequest", request);
  checkRecipients(request);
  return request;
}
export function checkRecipients(input) {
  const total = ["to", "cc", "bcc"].reduce(
    (n, k) => n + (list(input[k])?.length ?? 0),
    0,
  );
  if (total < 1 || total > manifest.limits.recipients)
    throw new ValidationError("SendRequest", ["/to"]);
}
export function translate(provider, input, response, metadata) {
  validate("SendResponse", response);
  if (provider.format === "native") return response;
  let result;
  if (provider.format === "ses")
    result = {
      MessageId: response.id,
      $metadata: {
        httpStatusCode: metadata.status,
        ...(metadata.requestId ? { requestId: metadata.requestId } : {}),
        attempts: 1,
        totalRetryDelay: 0,
      },
    };
  else if (provider.format === "postmark")
    result = {
      To: input[provider.fields.to],
      SubmittedAt: response.created_at,
      MessageID: response.id,
      ErrorCode: 0,
      Message: "OK",
    };
  else if (provider.format === "resend") result = { id: response.id };
  else
    result = {
      statusCode: 202,
      headers: { "x-message-id": response.id },
      body: "",
    };
  validate(provider.response, result);
  return result;
}
export class BaseClient {
  constructor(keyOrOptions, options = {}) {
    const config =
      typeof keyOrOptions === "string"
        ? { ...options, apiKey: keyOrOptions }
        : keyOrOptions;
    if (!config || typeof config.apiKey !== "string" || !config.apiKey)
      throw new Error("A SendHog API key is required.");
    const url = new URL(config.origin ?? manifest.baseUrl);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        ))
    )
      throw new Error(
        "Use an HTTPS origin, or HTTP loopback for local development.",
      );
    this.origin = url.origin;
    this.apiKey = config.apiKey;
    this.fetch = config.fetch ?? ((...args) => globalThis.fetch(...args));
    this.messages = {
      list: (query) => this.listMessages(query),
      get: (id) => this.getMessage(id),
      events: async (id, query = {}) => (await this.request('messageEvents', undefined, { ...query, id })).value,
    };
    this.bulk = { get: async (id) => (await this.request('getBulk', undefined, { id })).value };
    this.webhooks = {
      create: async (input) => (await this.request('createWebhook', input)).value,
      list: async () => (await this.request('listWebhooks')).value,
      delete: async (id) => (await this.request('deleteWebhook', undefined, { id })).value,
      verify: verifyWebhook,
    };
  }
  async request(operation, body, params = {}, options = {}) {
    validate('SendOptions', options);
    if (!params || typeof params !== 'object' || Array.isArray(params)) throw new ValidationError('Query', ['/query']);
    const definition = manifest.methods.find((m) => m.name === operation);
    if (!definition) throw new Error("Unknown operation");
    let path = definition.http.path;
    if (path.includes("{id}")) {
      if (typeof params.id !== "string" || !params.id || params.id.length > 256)
        throw new ValidationError("MessageId", ["/id"]);
      path = path.replace("{id}", encodeURIComponent(params.id));
    }
    if (definition.query) {
      const queryParams = { ...params };
      delete queryParams.id;
      validate(definition.query, queryParams);
      const query = new URLSearchParams(
        Object.entries(queryParams).map(([k, v]) => [k, String(v)]),
      );
      if (query.size) path += "?" + query;
    }
    if (definition.request) {
      validate(definition.request, body);
      if (definition.request === "SendRequest") checkRecipients(body);
    }
    const response = await this.fetch(this.origin + path, {
      method: definition.http.method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(operation === 'sendBulk' ? 120000 : 30000),
    });
    if (response.status >= 300 && response.status < 400)
      throw new ProtocolError();
    let value;
    try {
      const reader = response.body?.getReader();
      const chunks = [];
      let size = 0;
      for (;;) {
        if (!reader) break;
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > 2097152) {
          await reader.cancel();
          throw new ProtocolError();
        }
        chunks.push(next.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.length;
      }
      value = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new ProtocolError();
    }
    if (!response.ok) {
      try {
        validate("ApiError", value);
      } catch {
        throw new ProtocolError();
      }
      const error = new ApiError(response.status, value);
      error.headers = response.headers;
      throw error;
    }
    try {
      validate(definition.response, value);
    } catch {
      throw new ProtocolError();
    }
    return {
      value,
      metadata: {
        status: response.status,
        requestId: response.headers.get("x-request-id") ?? undefined,
        headers: response.headers,
      },
    };
  }
  async listMessages(query = {}) {
    return (await this.request("listMessages", undefined, query)).value;
  }
  async getMessage(id) {
    return (await this.request("getMessage", undefined, { id })).value;
  }
  async sendVariant(provider, input, options = {}) {
    const canonical = normalize(provider, input);
    const result = await this.request("send", canonical, {}, options);
    return {
      data: translate(provider, input, result.value, result.metadata),
      metadata: result.metadata,
    };
  }
}
