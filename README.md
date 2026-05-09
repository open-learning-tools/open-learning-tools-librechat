# LibreChat Local Development Assets

This folder contains LibreChat-specific local-dev assets for the OLT stack. Keep files here free of secrets; runtime secrets belong in the root `.env`.

## Files

- `librechat.yaml`: minimal custom config for the OLT AI Chat service. It enables only OpenID as the social login option and keeps the rest of the app close to LibreChat defaults.

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
docker compose up --build librechat mongodb redis nginx
docker compose logs librechat
```

Then open `http://chat.localhost` and confirm the Open Learning Tools OpenID button appears or the login page redirects to the Django wrapper, depending on the selected `OPENID_AUTO_REDIRECT` setting.
