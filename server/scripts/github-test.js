#!/usr/bin/env node
// Sends a correctly signed fake GitHub event to your local server.
// usage: node scripts/github-test.js --id <integrationId> --secret <secret> --repo owner/name --task 42 --event pr-open
// events: ping | pr-open | pr-merge | pr-close | push | push-main
const crypto = require("crypto");

const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[i + 1];

const url = args.url || "http://localhost:5000";
const { id, secret, repo, task = "1", event = "ping" } = args;
if (!id || !secret || !repo) {
  console.log("Missing --id, --secret or --repo. Example:\n  node scripts/github-test.js --id 66f... --secret abc... --repo mycompany/website --task 42 --event pr-open");
  process.exit(1);
}

const now = new Date().toISOString();
const repository = { full_name: repo, default_branch: "main" };
const user = { login: "test-dev", avatar_url: "https://avatars.githubusercontent.com/u/1?v=4" };
const pr = (over) => ({
  number: 7,
  title: `Fix login bug (TASK-${task})`,
  body: "",
  state: "open",
  draft: false,
  merged: false,
  merged_at: null,
  html_url: `https://github.com/${repo}/pull/7`,
  user,
  head: { ref: `feature/TASK-${task}-login-fix` },
  base: { ref: "main" },
  created_at: now,
  updated_at: now,
  ...over,
});
const commit = (message) => ({
  id: crypto.randomBytes(20).toString("hex"),
  message,
  url: `https://github.com/${repo}/commit/${crypto.randomBytes(4).toString("hex")}`,
  timestamp: now,
  author: { username: "test-dev", name: "Test Dev" },
});

const events = {
  ping: ["ping", { zen: "Keep it logically awesome.", repository }],
  "pr-open": ["pull_request", { action: "opened", pull_request: pr({}), repository }],
  "pr-merge": ["pull_request", { action: "closed", pull_request: pr({ state: "closed", merged: true, merged_at: now }), repository }],
  "pr-close": ["pull_request", { action: "closed", pull_request: pr({ state: "closed" }), repository }],
  push: ["push", { ref: `refs/heads/feature/TASK-${task}-login-fix`, deleted: false, commits: [commit(`WIP login (TASK-${task})`)], repository }],
  "push-main": ["push", { ref: "refs/heads/main", deleted: false, commits: [commit(`fixes TASK-${task}`)], repository }],
};

if (!events[event]) { console.log("Unknown --event. Use:", Object.keys(events).join(", ")); process.exit(1); }
const [name, payload] = events[event];
const body = JSON.stringify(payload);
const signature = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");

fetch(`${url}/api/integrations/github/webhook/${id}`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-GitHub-Event": name,
    "X-GitHub-Delivery": crypto.randomUUID(),
    "X-Hub-Signature-256": signature,
  },
  body,
})
  .then(async (r) => console.log(r.status, await r.text()))
  .catch((e) => console.error("Request failed:", e.message));