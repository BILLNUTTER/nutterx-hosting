# Deploy Nutterx Hosting to Heroku

Nutterx Hosting runs as one Heroku web process: Express serves the API and the
Vite-built frontend from the same origin. Heroku supplies the listening `PORT`.

## Requirements

- A Heroku app with the Node.js buildpack.
- A Heroku Postgres add-on attached to that app. It provides `DATABASE_URL`.
- The repository root pushed to Heroku; do not deploy an individual workspace
  package as the app root.

## Configure the app

The root `pnpm-lock.yaml` and `packageManager` field select the pinned pnpm
version. Heroku runs the targeted `heroku-build` script to compile the API,
build shared library declarations, and create the frontend assets. The root
`Procfile` starts the API, which also serves the frontend and handles SPA routes.

Set the runtime variables in Heroku:

- `NODE_ENV=production`
- `APPS_DIR=/tmp/nutterx-apps`
- `DATABASE_URL` (provided by Heroku Postgres)
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `ENCRYPTION_KEY`

Generate three independent secrets locally and set them with the Heroku CLI; do
not commit them to Git:

```sh
heroku config:set JWT_SECRET="$(openssl rand -hex 32)" --app YOUR_APP_NAME
heroku config:set JWT_REFRESH_SECRET="$(openssl rand -hex 32)" --app YOUR_APP_NAME
heroku config:set ENCRYPTION_KEY="$(openssl rand -hex 32)" --app YOUR_APP_NAME
heroku config:set NODE_ENV=production APPS_DIR=/tmp/nutterx-apps --app YOUR_APP_NAME
```

Keep `ENCRYPTION_KEY` stable. Existing encrypted environment values cannot be
read if this key changes.

`ADMIN_USERNAME` and `ADMIN_KEY` are optional. Set both if you need the admin
login; otherwise admin access remains disabled. User sign-up and deployment
management do not require them.

## Deploy

After creating the Heroku app and attaching Postgres, add its Git remote and
push the repository root:

```sh
heroku git:remote --app YOUR_APP_NAME
git push heroku HEAD:main
```

Check the build and startup logs with `heroku logs --tail --app YOUR_APP_NAME`.
The API health endpoint is `/api/healthz`.

The database schema is initialized by the API when it connects. Heroku's
filesystem is ephemeral, so repository clones under `APPS_DIR` are recreated
when the dyno restarts. This prepares the code for Heroku; it does not create a
Heroku app or copy data from the current Replit database.
