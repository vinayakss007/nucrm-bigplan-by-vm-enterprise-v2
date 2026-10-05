#!/usr/bin/env node
// #2332 — minimal `docker` test double for scripts/check-running-config-drift.mjs.
// Reads FAKE_DOCKER_STATE (JSON) and answers exactly the subcommands the guard
// issues: `ps` (all / live / -a census), `inspect -f <template> <name>`,
// `exec <name> cat <dst>`, and `compose config --format json`.
// Anything unknown exits non-zero, which the guard treats as "unreadable".
const state = JSON.parse(process.env.FAKE_DOCKER_STATE || '{}');
const [cmd, ...rest] = process.argv.slice(2);

const say = (text) => process.stdout.write(text);
const out = (code) => { process.exit(code); };

switch (cmd) {
  case 'ps': {
    let names;
    if (rest.includes('-a')) {
      if (state.failCensus) out(1);
      names = state.created ?? state.live ?? [];
    } else {
      const wantsLive = rest.some((a) => a.includes('com.docker.compose.container-number'));
      names = wantsLive ? (state.live ?? []) : (state.all ?? state.live ?? []);
    }
    say(names.join('\n') + (names.length ? '\n' : ''));
    break;
  }
  case 'inspect': {
    const fmt = rest[1];
    const name = rest[2];
    const c = (state.containers || {})[name] || {};
    if (fmt.includes('.Mounts')) {
      say((c.mounts || []).map(([src, dst]) => `${src}\t${dst}\n`).join(''));
    } else if (fmt.includes('config_files')) {
      say((c.configFiles || '') + '\n');
    } else if (fmt.includes('com.docker.compose.service')) {
      say((c.service || '') + '\n');
    } else if (fmt.includes('StopTimeout')) {
      say(String(c.stopTimeout ?? '<nil>') + '\n');
    } else if (fmt.includes('.Config.Env')) {
      say((c.env || []).map((e) => e + '\n').join(''));
    } else {
      out(1);
    }
    break;
  }
  case 'exec': {
    const name = rest[0];
    const dst = rest[rest.length - 1];
    const content = (state.exec || {})[name]?.[dst];
    if (content === undefined) out(1);
    say(content);
    break;
  }
  case 'compose': {
    if (!rest.includes('config') || !state.compose) out(1);
    say(JSON.stringify({ services: state.compose }));
    break;
  }
  default:
    out(1);
}
