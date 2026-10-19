// Docs: docs/sdk-schema-plan.md. Compile the generated public surface strictly.
import {
  SESv2Client,
  SendEmailCommand,
  ServerClient,
  Resend,
  SendGridClient,
  SendHog,
} from "../src/index.js";
const options = { apiKey: "fixture_not_a_real_key" };
async function supportedCalls() {
  const sendhog=new SendHog(options);
  const bulk=await sendhog.sendBulk({from:'hello@example.com',template:{id:'welcome'},recipients:[{to:'a@example.net',variables:{name:'Alex'}}]},{idempotencyKey:'bulk-request'});
  bulk.results[0].status.toLowerCase();
  await sendhog.bulk.get(bulk.id);
  await sendhog.messages.events('message-id',{limit:5});
  await sendhog.webhooks.create({url:'https://example.com/hooks',events:['email.delivered']});
  await sendhog.webhooks.list();await sendhog.webhooks.delete('hook-id');
  // @ts-expect-error Queued customer sending is deliberately deferred.
  await sendhog.send({from:'hello@example.com',to:'a@example.net',subject:'Hi',text:'Hi',queue:true});
  const native = {
    FromEmailAddress: "sender@example.com",
    Destination: { ToAddresses: ["r@example.net"] },
    Content: {
      Simple: { Subject: { Data: "Hello" }, Body: { Text: { Data: "Hi" } } },
    },
  };
  const ses = new SESv2Client(options);
  const sent = await ses.send(new SendEmailCommand(native));
  sent.MessageId.toUpperCase();
  const pm = new ServerClient(options);
  (
    await pm.sendEmail({
      From: "sender@example.com",
      To: "r@example.net",
      TextBody: "Hi",
    })
  ).MessageID.toUpperCase();
  const re = new Resend(options);
  const result = await re.emails.send({
    from: "sender@example.com",
    to: "r@example.net",
    subject: "Hi",
    text: "Hi",
  });
  if (result.data) result.data.id.toUpperCase();
  else result.error.message.toLowerCase();
  const sg = new SendGridClient(options);
  const [response, body] = await sg.send({
    from: { email: "sender@example.com" },
    to: "r@example.net",
    subject: "Hi",
    text: "Hi",
  });
  response.headers["x-message-id"].toUpperCase();
  body.toLowerCase();
  (
    await ses.messages.list({ direction: "received", limit: 20 })
  ).data[0]?.text?.toLowerCase();
  (
    await new SendHog(options).send({
      from: "sender@example.com",
      to: "r@example.net",
      subject: "Hello",
      text: "Hi",
      replyTo: "reply@example.com",
    })
  ).id.toUpperCase();
  // @ts-expect-error Native sending requires text or html.
  await new SendHog(options).send({
    from: "sender@example.com",
    to: "r@example.net",
    subject: "Hi",
  });
  // @ts-expect-error AWS nesting belongs only to the SES compatibility client.
  await new SendHog(options).send(native);
  await pm.sendEmail({
    From: "sender@example.com",
    To: "r@example.net",
    TextBody: "Hi",
    // @ts-expect-error Unsupported provider options must not enter the public types.
    TrackOpens: true,
  });
}
void supportedCalls;
