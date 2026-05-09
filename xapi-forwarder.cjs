const http = require("node:http");
const { randomUUID } = require("node:crypto");

const internalIngestUrl = process.env.OLT_XAPI_INTERNAL_INGEST_URL || "";
const publicIngestUrl = process.env.OLT_XAPI_PUBLIC_INGEST_URL || "";
const ingestUrl = internalIngestUrl || publicIngestUrl;
const baseActivityPrefix = (process.env.OLT_XAPI_ACTIVITY_PREFIX || "http://olt.localhost/xapi/activities").replace(/\/$/, "");
const activityPrefix = baseActivityPrefix.endsWith("/librechat") ? baseActivityPrefix : `${baseActivityPrefix}/librechat`;
const sourceName = process.env.OLT_XAPI_SOURCE_NAME || "OLT AI Chat";

if (!ingestUrl) {
  console.info("OLT xAPI forwarding disabled: OLT_XAPI_INTERNAL_INGEST_URL is not set.");
  return;
}

const originalEnd = http.ServerResponse.prototype.end;

http.ServerResponse.prototype.end = function patchedEnd(chunk, encoding, callback) {
  const request = this.req;
  const statusCode = this.statusCode;
  const responseBody = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : typeof chunk === "string" ? chunk : "";

  const result = originalEnd.call(this, chunk, encoding, callback);

  if (request && shouldForward(request, statusCode)) {
    const statement = buildStatement(request, statusCode, responseBody);
    forwardStatement(statement);
  }

  return result;
};

console.info(`OLT xAPI forwarding enabled: ${ingestUrl}`);

function shouldForward(request, statusCode) {
  if (statusCode < 200 || statusCode >= 400) {
    return false;
  }

  const method = request.method || "";
  const path = getPath(request);

  return (
    (method === "POST" && /^\/api\/(ask|messages|agents|assistants)\b/.test(path)) ||
    (method === "POST" && /^\/api\/convos\b/.test(path)) ||
    (method === "PATCH" && /^\/api\/convos\/[^/]+\b/.test(path)) ||
    (method === "DELETE" && /^\/api\/convos\/[^/]+\b/.test(path)) ||
    (method === "GET" && /^\/oauth\/openid\/callback\b/.test(path))
  );
}

function buildStatement(request, statusCode, responseBody) {
  const path = getPath(request);
  const body = request.body && typeof request.body === "object" ? request.body : {};
  const responseJson = parseJson(responseBody);
  const conversationId = pickFirst(
    body.conversationId,
    body.conversation_id,
    body.conversation?.id,
    responseJson?.conversationId,
    responseJson?.conversation_id,
    responseJson?.conversation?.id,
    path.match(/^\/api\/convos\/([^/?#]+)/)?.[1],
  );
  const messageId = pickFirst(body.messageId, body.message_id, responseJson?.messageId, responseJson?.message_id);
  const user = getActor(request);
  const event = classifyEvent(request.method || "", path);
  const objectId = conversationId
    ? `${activityPrefix}/conversations/${encodeURIComponent(conversationId)}`
    : `${activityPrefix}${path}`;

  return {
    id: randomUUID(),
    actor: {
      account: {
        homePage: "http://chat.localhost",
        name: user,
      },
    },
    verb: {
      id: event.verbId,
      display: { "en-US": event.verb },
    },
    object: {
      id: objectId,
      definition: {
        type: event.objectType,
        name: { "en-US": event.objectName },
      },
    },
    context: {
      platform: sourceName,
      extensions: compactObject({
        [`${activityPrefix}/extensions/path`]: path,
        [`${activityPrefix}/extensions/method`]: request.method,
        [`${activityPrefix}/extensions/status-code`]: statusCode,
        [`${activityPrefix}/extensions/conversation-id`]: conversationId,
        [`${activityPrefix}/extensions/message-id`]: messageId,
        [`${activityPrefix}/extensions/endpoint`]: body.endpoint,
        [`${activityPrefix}/extensions/model`]: body.model,
      }),
    },
    timestamp: new Date().toISOString(),
  };
}

function classifyEvent(method, path) {
  if (path.startsWith("/oauth/openid/callback")) {
    return event("authenticated", "http://adlnet.gov/expapi/verbs/logged-in", "session", "LibreChat session");
  }

  if (method === "DELETE" && path.startsWith("/api/convos/")) {
    return event("deleted", "http://activitystrea.ms/schema/1.0/delete", "conversation", "LibreChat conversation");
  }

  if (method === "PATCH" && path.startsWith("/api/convos/")) {
    return event("updated", "http://activitystrea.ms/schema/1.0/update", "conversation", "LibreChat conversation");
  }

  if (path.startsWith("/api/convos")) {
    return event("created", "http://activitystrea.ms/schema/1.0/create", "conversation", "LibreChat conversation");
  }

  return event("sent", "http://activitystrea.ms/schema/1.0/post", "message", "LibreChat chat message");
}

function event(verb, verbId, objectKind, objectName) {
  return {
    verb,
    verbId,
    objectType: `${activityPrefix}/activity-types/${objectKind}`,
    objectName,
  };
}

function forwardStatement(statement) {
  const payload = JSON.stringify(statement);
  const url = new URL(ingestUrl);
  const transport = url.protocol === "https:" ? require("node:https") : require("node:http");

  const request = transport.request(
    url,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
      },
      timeout: 2000,
    },
    (response) => {
      response.resume();
      if (response.statusCode < 200 || response.statusCode >= 300) {
        console.warn(`OLT xAPI forwarding returned HTTP ${response.statusCode}`);
      }
    },
  );

  request.on("timeout", () => request.destroy(new Error("OLT xAPI forwarding timed out")));
  request.on("error", (error) => console.warn(`OLT xAPI forwarding failed: ${error.message}`));
  request.end(payload);
}

function getPath(request) {
  return (request.originalUrl || request.url || "").split("?")[0];
}

function getActor(request) {
  return pickFirst(
    request.user?.email,
    request.user?.username,
    request.user?.id,
    request.body?.user,
    request.body?.userId,
    request.headers["x-forwarded-user"],
    request.headers["x-user-id"],
    "local-librechat-user",
  );
}

function parseJson(text) {
  if (!text || !/^\s*[{[]/.test(text)) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function pickFirst(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== ""));
}
