# LibreChat Local Development Assets

This folder contains LibreChat-specific local-dev assets for the OLT stack. Keep files here free of secrets; runtime secrets belong in the root `.env`.

## Files

- `librechat.yaml`: minimal custom config for the OLT AI Chat service. It enables only OpenID as the social login option and keeps the rest of the app close to LibreChat defaults.
- `xapi-forwarder.cjs`: optional local-dev preload that forwards successful LibreChat chat/session activity to the central xAPI ingest endpoint.
- `compose.xapi-forwarder.yml`: optional Compose overlay that mounts and enables the preload without baking secrets or custom code into the LibreChat image.

## Parent Compose Integration

The parent stack already provides the core runtime values:

- Public URL: `http://chat.localhost`
- Internal service port: `3080`
- MongoDB URI: `mongodb://mongodb:27017/${LIBRECHAT_MONGO_DB:-LibreChat}`
- Redis URI: `redis://redis:6379/1`
- OIDC issuer: `${OIDC_ISSUER_URL:-http://olt.localhost}`

The parent `librechat` service activates this YAML config with a bind mount:

```yaml
services:
  librechat:
    volumes:
      - ./docker/librechat/librechat.yaml:/app/librechat.yaml:ro
      - librechat_images:/app/client/public/images
      - librechat_uploads:/app/uploads
      - librechat_logs:/app/api/logs
```

LibreChat reads authentication settings from environment variables, not from `librechat.yaml`. Keep these in the root `.env`:

```dotenv
LIBRECHAT_MONGO_DB=LibreChat
LIBRECHAT_OIDC_CLIENT_ID=librechat-local
LIBRECHAT_OIDC_CLIENT_SECRET=replace-in-local-env
LIBRECHAT_OIDC_SCOPE=openid profile email
LIBRECHAT_JWT_SECRET=replace-in-local-env
LIBRECHAT_JWT_REFRESH_SECRET=replace-in-local-env
LIBRECHAT_CREDS_KEY=replace-in-local-env
LIBRECHAT_CREDS_IV=replace-in-local-env
LIBRECHAT_ALLOW_EMAIL_LOGIN=false
LIBRECHAT_ALLOW_REGISTRATION=false
LIBRECHAT_ENDPOINTS=openAI,agents
LIBRECHAT_PROVIDER_ENV_FILE=./.librechat-provider.env
```

The parent Compose service also loads `LIBRECHAT_PROVIDER_ENV_FILE` as an
optional `env_file` for local model provider keys. Keep `OPENAI_API_KEY` and
similar provider keys in an untracked local file instead of committing them to
this repo.

## xAPI Activity Forwarding

LibreChat does not expose a small config-only hook for local activity callbacks, so local-dev forwarding uses a Node preload mounted by the optional Compose overlay. The preload observes successful LibreChat backend responses and posts compact xAPI-like statements to the configured central ingest endpoint.

Expected environment values from the parent stack:

```dotenv
OLT_XAPI_INTERNAL_INGEST_URL=http://api:8000/xapi/ingest/
OLT_XAPI_PUBLIC_INGEST_URL=http://olt.localhost/xapi/ingest/
OLT_XAPI_ACTIVITY_PREFIX=http://olt.localhost/xapi/activities
```

Use the internal URL when it is available inside Docker. The public URL is only a fallback for local browser-facing configuration and manual tests.
LibreChat activity IDs are namespaced under `${OLT_XAPI_ACTIVITY_PREFIX}/librechat`.

Run LibreChat with forwarding enabled:

```bash
docker compose \
  --env-file .env \
  -f docker-compose.yml \
  -f docker/librechat/compose.xapi-forwarder.yml \
  up --build librechat mongodb redis xapi-ingest ralph nginx
```

Forwarded local-dev events include:

- successful OpenID callback sessions as `logged-in` events
- successful chat/message POSTs as `post` events
- successful conversation creates, updates, and deletes as conversation events

The forwarder sends no secrets. It includes only the request path, method, response status, conversation/message identifiers when available, and non-secret endpoint/model names when LibreChat exposes them on the request body.

Recommended additional LibreChat OpenID env vars for the parent service:

```dotenv
OPENID_CALLBACK_URL=/oauth/openid/callback
OPENID_BUTTON_LABEL=Open Learning Tools
OPENID_AUTO_REDIRECT=false
OPENID_USE_PKCE=true
OPENID_GENERATE_NONCE=true
OPENID_EMAIL_CLAIM=email
OPENID_USERNAME_CLAIM=preferred_username
OPENID_NAME_CLAIM=name
```

The Django OAuth client for AI Chat should use this redirect URI:

```txt
http://chat.localhost/oauth/openid/callback
```

## MongoDB Notes

LibreChat requires MongoDB. The parent stack's shared `mongodb` service is the expected local backend for AI Chat. If Docker Desktop is running on an Apple Silicon Mac and MongoDB 7 fails because of CPU instruction support, switch the parent MongoDB image to a compatible local image such as `mongo:4.4.18`.

## Verification

After the parent stack mounts this file and the Django OIDC client exists:

```bash
docker compose --env-file .env config
docker compose --env-file .env -f docker-compose.yml -f docker/librechat/compose.xapi-forwarder.yml config librechat
docker compose up --build librechat mongodb redis nginx
docker compose logs librechat
```

Then open `http://chat.localhost` and confirm the Open Learning Tools OpenID button appears or the login page redirects to the Django wrapper, depending on the selected `OPENID_AUTO_REDIRECT` setting.

With the xAPI overlay enabled, also confirm the LibreChat logs contain:

```txt
OLT xAPI forwarding enabled:
```
