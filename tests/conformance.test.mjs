// Docs: docs/sdk-schema-plan.md. Fixtures run without provider credentials or sends.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SESv2Client,
  SendEmailCommand,
  ServerClient,
  Resend,
  SendGridClient,
  SendHog,
  ValidationError,
  ProtocolError,
  ApiError,
} from "../src/index.js";
import { normalize, translate } from "../src/runtime.js";
import { manifest, validate } from "../src/validation.js";
import {signWebhook, verifyWebhook} from '../src/webhooks.js';
const fixtures = JSON.parse(
  readFileSync(new URL("../contract/cases.json", import.meta.url)),
);

test('bulk, events and webhook SDK methods use the canonical routes, scope and idempotency options', async()=>{
  const calls=[];
  const client=new SendHog({apiKey:'fixture',fetch:async(url,init)=>{
    calls.push({url,init});
    if(url.endsWith('/send/bulk')||url.endsWith('/send/bulk/bulk-id'))return Response.json({id:'bulk-id',results:[{to:'a@example.net',status:'accepted',id:'message-id'}]});
    if(url.includes('/events?'))return Response.json({data:[],has_more:false,next_cursor:null});
    if(init.method==='DELETE')return Response.json({id:'hook-id',deleted:true});
    if(init.method==='POST')return Response.json({webhook:{id:'hook-id',url:'https://example.com/hook',events:['email.delivered'],enabled:true,created_at:new Date().toISOString()},secret:'whsec_'+globalThis.btoa('s'.repeat(32))});
    return Response.json({data:[]});
  }});
  const bulk={from:'hello@example.com',template:{id:'welcome'},recipients:[{to:'a@example.net',variables:{name:'Alex'}}]};
  await assert.rejects(()=>client.sendBulk(bulk),ValidationError);
  await client.sendBulk(bulk,{idempotencyKey:'bulk-request'});
  assert.equal(calls[0].init.headers['Idempotency-Key'],'bulk-request');
  await client.bulk.get('bulk-id');
  await client.messages.events('a/b',{limit:5});
  assert(calls[2].url.endsWith('/v1/messages/a%2Fb/events?limit=5'));
  await client.webhooks.create({url:'https://example.com/hook',events:['email.delivered']});
  await client.webhooks.list();await client.webhooks.delete('hook-id');
  assert.equal(calls[5].init.method,'DELETE');
  assert.equal(calls[5].url,'https://app.sendhog.com/v1/webhooks/hook-id');
  await assert.rejects(()=>client.sendBulk({...bulk,queue:true},{idempotencyKey:'bad'}),ValidationError);
});
test('Standard Webhooks verification authenticates exact raw bodies and rejects stale/tampered events',async()=>{
  const id='evt_'+'a'.repeat(64),secret='whsec_'+globalThis.btoa('s'.repeat(32)),timestamp=String(Math.floor(Date.now()/1000));
  const event={id,type:'email.delivered',created_at:new Date().toISOString(),data:{message_id:'m',provider_id:'p',recipients:[],details:{}}};
  const body=JSON.stringify(event),headers={'webhook-id':id,'webhook-timestamp':timestamp,'webhook-signature':await signWebhook(secret,id,timestamp,body)};
  assert.deepEqual(await verifyWebhook(body,headers,secret),event);
  await assert.rejects(()=>verifyWebhook(body+' ',headers,secret));
  await assert.rejects(()=>verifyWebhook(body,{...headers,'webhook-timestamp':'1'},secret));
  const client=new SendHog({apiKey:'fixture',fetch:async()=>{throw Error('No HTTP expected');}});
  assert.deepEqual(await client.webhooks.verify(body,headers,secret),event);
});
test('unified received/bounce/delivery subscriptions and received signatures are supported in this release',async()=>{
 const events=['email.received','email.bounced','email.delivered'];let requests=0;
 const client=new SendHog({apiKey:'fixture',fetch:async(url,init)=>{requests++;assert.equal(url,'https://app.sendhog.com/v1/webhooks');assert.deepEqual(JSON.parse(init.body).events,events);return Response.json({webhook:{id:'unified-hook',url:'https://example.com/hook',events,enabled:true,created_at:new Date().toISOString()},secret:'whsec_'+globalThis.btoa('s'.repeat(32))});}});
 const registration=await client.webhooks.create({url:'https://example.com/hook',events});assert.deepEqual(registration.webhook.events,events);
 const id='evt_'+'b'.repeat(64),timestamp=String(Math.floor(Date.now()/1000)),event={id,type:'email.received',created_at:new Date().toISOString(),data:{message_id:'in_fixture',provider_id:'in_fixture',recipients:['hello@example.com'],details:{raw_path:'/v1/messages/in_fixture/raw'}}};
 const body=JSON.stringify(event),headers={'webhook-id':id,'webhook-timestamp':timestamp,'webhook-signature':await signWebhook(registration.secret,id,timestamp,body)};
 assert.deepEqual(await client.webhooks.verify(body,headers,registration.secret),event);assert.equal(requests,1);
});
const examples = JSON.parse(
  readFileSync(new URL("../contract/examples.json", import.meta.url)),
);
const classes = {
  sendhog: SendHog,
  ses: SESv2Client,
  postmark: ServerClient,
  resend: Resend,
  sendgrid: SendGridClient,
};
const call = (id, client, input) =>
  id === "sendhog"
    ? client.send(input)
    : id === "ses"
      ? client.send(new SendEmailCommand(input))
      : id === "postmark"
        ? client.sendEmail(input)
        : id === "resend"
          ? client.emails.send(input)
           : client.send(input);
test("native and Resend templates normalize without an inline body and reject mixed modes",()=>{
  const message={from:"hello@example.com",to:"you@example.net",template:{id:"welcome",version:1,variables:{name:"Gabe",count:3}}};
  for(const id of ["sendhog","resend"]) {
    const provider=manifest.providers.find(p=>p.id===id),result=normalize(provider,message);
    assert.deepEqual(result.template,message.template);assert.deepEqual(result.to,[message.to]);assert.equal(Object.hasOwn(result,"subject"),false);
    assert.throws(()=>normalize(provider,{...message,html:"<p>ambiguous</p>"}),ValidationError);
    assert.throws(()=>normalize(provider,{...message,template:{id:"welcome",variables:{name:{bad:true}}}}),ValidationError);
  }
});
test("every generated JavaScript/TypeScript send and receive example executes against fixture transport", async () => {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  for (const provider of manifest.providers)
    for (const operation of ["send", "receive"]) {
      const Wrapped = class extends classes[provider.id] {
        constructor(options) {
          super({
            ...(typeof options === "string" ? { apiKey: options } : options),
            fetch: async () =>
              Response.json(
                operation === "send"
                  ? fixtures.sendResponse
                  : { data: [], has_more: false, next_cursor: null },
              ),
          });
        }
      };
      const source = examples[provider.id][operation].node
        .replace(/^import[^\n]*\n/, "")
        .replaceAll("console.log(", "capture(");
      const execute = new AsyncFunction(
        provider.jsClass,
        "SendEmailCommand",
        "process",
        "capture",
        source,
      );
      await execute(
        Wrapped,
        SendEmailCommand,
        { env: { SENDHOG_API_KEY: "fixture_not_real" } },
        () => {},
      );
      assert.equal(
        examples[provider.id][operation].typescript,
        examples[provider.id][operation].node,
      );
    }
});
for (const provider of manifest.providers) {
  test(`${provider.id}: generated method and canonical request/result validation`, async () => {
    let requests = 0;
    const client = new classes[provider.id]({
      apiKey: "sh_test",
      fetch: async (url, options) => {
        requests++;
        assert.equal(url, "https://app.sendhog.com/v1/send");
        assert.equal(options.headers.Authorization, "Bearer sh_test");
        assert.equal(options.redirect, "manual");
        assert.equal(options.method, "POST");
        assert.deepEqual(JSON.parse(options.body), fixtures.canonical);
        return Response.json(fixtures.sendResponse, {
          headers: { "x-request-id": "req_fixture" },
        });
      },
    });
    const result = await call(
      provider.id,
      client,
      fixtures.providers[provider.id].node,
    );
    assert.equal(requests, 1);
    const data =
      provider.id === "resend"
        ? result.data
        : provider.id === "sendgrid"
          ? result[0]
          : result;
    validate(provider.response, data);
    if (provider.id === "sendgrid") assert.equal(result[1], data.body);
    if (provider.id === "ses") assert.equal(result.$metadata.attempts, 1);
  });
  test(`${provider.id}: unsupported fields fail before HTTP`, async () => {
    const client = new classes[provider.id]({
      apiKey: "sh_test",
      fetch: () => {
        throw new Error("HTTP must not run");
      },
    });
    await assert.rejects(
      () =>
        call(provider.id, client, {
          ...fixtures.providers[provider.id].node,
          unsupportedOption: true,
        }),
      ValidationError,
    );
  });
  test(`${provider.id}: nonconforming success is not fabricated`, async () => {
    const client = new classes[provider.id]({
      apiKey: "sh_test",
      fetch: async () => Response.json({ id: "not_native" }),
    });
    await assert.rejects(
      () => call(provider.id, client, fixtures.providers[provider.id].node),
      ProtocolError,
    );
  });
}
test("canonical boundaries: counts, body variants, fields, UTF-8", () => {
  const provider = manifest.providers.find((p) => p.id === "ses");
  for (const mutate of [
    (v) => (v.Destination = {}),
    (v) => (v.Destination = { ToAddresses: Array(51).fill("a@example.com") }),
    (v) =>
      (v.Destination = {
        ToAddresses: Array(30).fill("a@example.com"),
        CcAddresses: Array(30).fill("a@example.com"),
      }),
    (v) => (v.Content.Simple.Body = {}),
    (v) => (v.Content.Simple.Subject.Charset = "ASCII"),
    (v) => (v.Content.Raw = {}),
    (v) => (v.FromEmailAddress = "bad"),
    (v) => (v.FromEmailAddress = "x@example.com\r\nBcc: a@example.com"),
  ]) {
    const payload = structuredClone(fixtures.providers.ses.node);
    mutate(payload);
    assert.throws(() => normalize(provider, payload), ValidationError);
  }
});
test("native SDK enforces the combined recipient cap before HTTP", async () => {
  const payload = structuredClone(fixtures.canonical);
  payload.cc = Array(50).fill("cc@example.net");
  const client = new SendHog({
    apiKey: "fixture",
    fetch: () => {
      throw new Error("HTTP must not run");
    },
  });
  await assert.rejects(() => client.send(payload), ValidationError);
});
test("native send is flat, preserves optional mail features, and returns id directly", async () => {
  let sent;
  const client = new SendHog({
    apiKey: "fixture",
    fetch: async (_url, options) => {
      sent = JSON.parse(options.body);
      return Response.json(fixtures.sendResponse);
    },
  });
  const result = await client.send({
    from: "sender@example.com",
    to: "to@example.net",
    cc: ["cc@example.net"],
    bcc: "bcc@example.net",
    replyTo: "reply@example.com",
    subject: "Hi",
    text: "Hello",
    html: "<p>Hello</p>",
  });
  assert.equal(result.id, "msg_fixture");
  assert.equal(result.created_at, fixtures.sendResponse.created_at);
  assert.deepEqual(sent, {
    from: "sender@example.com",
    to: ["to@example.net"],
    cc: ["cc@example.net"],
    bcc: ["bcc@example.net"],
    replyTo: ["reply@example.com"],
    subject: "Hi",
    text: "Hello",
    html: "<p>Hello</p>",
  });
  assert.equal("Destination" in sent, false);
  assert.equal("Content" in sent, false);
  assert.equal("data" in result, false);
});
test("native validation rejects missing content, empty recipients, oversized reply-to and SES payloads", async () => {
  const client = new SendHog({
    apiKey: "fixture",
    fetch: () => {
      throw new Error("HTTP must not run");
    },
  });
  for (const input of [
    { from: "sender@example.com", to: "to@example.net", subject: "Hi" },
    { ...fixtures.canonical, to: [] },
    { ...fixtures.canonical, replyTo: Array(11).fill("reply@example.com") },
    fixtures.providers.ses.node,
  ])
    await assert.rejects(() => client.send(input), ValidationError);
  await assert.rejects(()=>client.send(fixtures.canonical,{unsupported:true}),ValidationError);
});
test("Postmark display-name commas, cc/bcc/reply-to are preserved", () => {
  const p = manifest.providers.find((p) => p.id === "postmark");
  const input = {
    ...fixtures.providers.postmark.node,
    To: '"Smith, Jane" <jane@example.net>, other@example.net',
    Cc: "cc@example.net",
    Bcc: "bcc@example.net",
    ReplyTo: "reply@example.com",
  };
  const result = normalize(p, input);
  assert.equal(result.to.length, 2);
  assert.equal(result.to[0], '"Smith, Jane" <jane@example.net>');
  assert.match(result.to[0], /jane@example.net/);
  assert.deepEqual(result.cc, ["cc@example.net"]);
  assert.deepEqual(result.replyTo, ["reply@example.com"]);
});
test("SendGrid address objects and Resend scalar recipients normalize", () => {
  const sg = normalize(
    manifest.providers.find((p) => p.id === "sendgrid"),
    {
      ...fixtures.providers.sendgrid.node,
      from: { email: "sender@example.com", name: "Sender" },
      cc: [{ email: "cc@example.net" }],
      replyTo: { email: "reply@example.com" },
    },
  );
  assert.equal(sg.from, '"Sender" <sender@example.com>');
  assert.deepEqual(sg.replyTo, ["reply@example.com"]);
  assert.deepEqual(
    normalize(
      manifest.providers.find((p) => p.id === "resend"),
      {
        ...fixtures.providers.resend.node,
        to: "recipient@example.net",
      },
    ).to,
    fixtures.canonical.to,
  );
});
test("paused errors: one request, SendHog code; Resend uses error result", async () => {
  const body = {
    error: {
      code: "SendingPaused",
      message: "No message was sent.",
      request_id: "req_test",
    },
  };
  for (const provider of manifest.providers) {
    let count = 0;
    const client = new classes[provider.id]({
      apiKey: "sh_test",
      fetch: async () => {
        count++;
        return Response.json(body, { status: 503 });
      },
    });
    if (provider.id === "resend") {
      const result = await call(
        provider.id,
        client,
        fixtures.providers[provider.id].node,
      );
      assert.equal(result.data, null);
      assert.equal(result.error.name, "SendingPaused");
      assert.ok(result.headers instanceof Headers);
    } else
      await assert.rejects(
        () => call(provider.id, client, fixtures.providers[provider.id].node),
        (e) =>
          e instanceof ApiError &&
          e.statusCode === 503 &&
          e.code === "SendingPaused",
      );
    assert.equal(count, 1);
  }
});
test("reads encode IDs and query; reject malformed response and unknown query fields", async () => {
  const urls = [];
  const client = new SendHog({
    apiKey: "sh_test",
    fetch: async (url) => {
      urls.push(url);
      return Response.json({ data: [], has_more: false, next_cursor: null });
    },
  });
  assert.deepEqual(
    await client.messages.list({ limit: 2, direction: "received" }),
    { data: [], has_more: false, next_cursor: null },
  );
  assert.match(urls[0], /limit=2&direction=received/);
  await assert.rejects(
    () => client.messages.list({ unknown: 1 }),
    ValidationError,
  );
  await assert.rejects(() => client.messages.get("a/b?c"), ProtocolError);
  assert.ok(urls[1].endsWith("/a%2Fb%3Fc"));
});
test("credential transport safety: invalid origin, redirects and oversized responses", async () => {
  const redirecting = new SESv2Client({apiKey:"test",fetch:async (_url,options) => {
    assert.equal(options.redirect,"manual");
    return new Response(null,{status:302,headers:{Location:"https://foreign.example/"}});
  }});
  await assert.rejects(()=>redirecting.send(new SendEmailCommand(fixtures.providers.ses.node)),ProtocolError);
  for (const origin of [
    "http://example.com",
    "https://user:pass@example.com",
    "https://example.com/path",
    "https://example.com?x=y",
  ])
    assert.throws(() => new SESv2Client({ apiKey: "test", origin }));
  const client = new SESv2Client({
    apiKey: "test",
    fetch: async () => new Response("x".repeat(2097153)),
  });
  await assert.rejects(
    () => client.send(new SendEmailCommand(fixtures.providers.ses.node)),
    ProtocolError,
  );
});
test("all examples and translated results conform to schema", () => {
  for (const p of manifest.providers) {
    validate(p.request, fixtures.providers[p.id].node);
    translate(p, fixtures.providers[p.id].node, fixtures.sendResponse, {
      status: 200,
      requestId: "req",
    });
  }
});
