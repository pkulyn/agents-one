import { EVENT_STREAM_PROTOCOL, eventStreamCapability } from "../src/event-stream.mjs";

console.log(JSON.stringify({
  protocol: EVENT_STREAM_PROTOCOL,
  capability: eventStreamCapability("poll"),
  status: "ok",
}, null, 2));
