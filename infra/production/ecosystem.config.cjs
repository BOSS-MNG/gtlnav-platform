/**
 * GTLNAV PM2 ecosystem template.
 *
 * Notes:
 * - `autorestart: true` keeps both the app and webhook listener alive after
 *   crashes or VPS reboots.
 * - `deploy.sh` only calls `pm2 reload <app-name>` after the new build
 *   succeeds, so failed deploys do not kill the running app.
 * - The webhook process stays separate from the Next.js app process so a
 *   deploy-listener failure never takes the app down with it.
 */

const appDir = process.env.GTLNAV_DEPLOY_APP_DIR || "/var/www/gtlnav";
const appName = process.env.GTLNAV_PM2_APP_NAME || "gtlnav-app";
const webhookName =
  process.env.GTLNAV_PM2_WEBHOOK_NAME || "gtlnav-deploy-webhook";
const port = process.env.PORT || "3000";

module.exports = {
  apps: [
    {
      name: appName,
      cwd: appDir,
      script: "node_modules/next/dist/bin/next",
      args: `start -p ${port}`,
      interpreter: "none",
      exec_mode: "cluster",
      instances: 1,
      autorestart: true,
      watch: false,
      min_uptime: "10s",
      max_restarts: 10,
      kill_timeout: 5000,
      listen_timeout: 10000,
      env: {
        NODE_ENV: "production",
        PORT: port,
      },
    },
    {
      name: webhookName,
      cwd: appDir,
      script: "infra/production/deploy-webhook-server.mjs",
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      min_uptime: "5s",
      max_restarts: 20,
      env: {
        NODE_ENV: "production",
        GTLNAV_DEPLOY_WEBHOOK_PORT:
          process.env.GTLNAV_DEPLOY_WEBHOOK_PORT || "9000",
        GTLNAV_DEPLOY_WEBHOOK_HOST:
          process.env.GTLNAV_DEPLOY_WEBHOOK_HOST || "0.0.0.0",
        GTLNAV_DEPLOY_WEBHOOK_PATH:
          process.env.GTLNAV_DEPLOY_WEBHOOK_PATH || "/hooks/gtlnav-deploy",
      },
    },
  ],
};
