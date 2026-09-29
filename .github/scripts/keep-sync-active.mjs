/* eslint-disable @typescript-eslint/explicit-function-return-type -- Plain JavaScript CI entry point. */
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

// Public repository schedules are disabled after 60 days without activity.
// One empty maintenance commit after 45 quiet days keeps the shared fork branches
// active without changing application files, bumping versions or triggering releases.
export function keepSyncActive(cwd, now = Date.now()) {
  if (!Number.isFinite(now) || now <= 0) throw new Error('Invalid maintenance timestamp')
  const git = (...args) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_COMMITTER_DATE: new Date(now).toISOString() }
    }).trim()
  if (git('status', '--porcelain')) throw new Error('Maintenance requires a clean checkout')
  const committedAt = Number(git('show', '-s', '--format=%ct', 'HEAD')) * 1000
  if (!Number.isFinite(committedAt) || committedAt <= 0) throw new Error('Invalid commit timestamp')
  if (now - committedAt < 45 * 24 * 60 * 60 * 1000) return false
  git('commit', '--allow-empty', '-m', 'chore: keep automatic upstream sync active')
  return true
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify({ maintenanceCommit: keepSyncActive(process.cwd()) }))
}
