/* eslint-disable @typescript-eslint/explicit-function-return-type -- Plain JavaScript CI entry point. */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import yaml from 'js-yaml'

const read = (file) => readFileSync(file, 'utf8')
const pkg = JSON.parse(read('package.json'))
const lock = JSON.parse(read('package-lock.json'))
const builder = yaml.load(read('electron-builder.yml'))
const devFeed = yaml.load(read('dev-app-update.yml'))
assert.equal(pkg.name, 'webui-workbench')
assert.equal(pkg.version, lock.version)
assert.equal(pkg.name, lock.name)
assert.equal(pkg.version, lock.packages[''].version)
assert.equal(pkg.name, lock.packages[''].name)
assert.match(pkg.version, /^\d+\.\d+\.\d+-workbench\.\d+$/)
assert.equal(builder.appId, 'io.github.nicoegerer.webuiworkbench')
assert.equal(builder.productName, 'WebUI Workbench')
assert.equal(builder.win.executableName, pkg.name)
for (const feed of [builder.publish, devFeed]) {
  assert.equal(feed.owner, 'nicoegerer')
  assert.equal(feed.repo, pkg.name)
}
assert.ok(read('LICENSE').includes('GNU AFFERO GENERAL PUBLIC LICENSE'))
assert.ok(read('README.md').includes('unofficial'))
assert.ok(!read('README.md').includes('open-webui/desktop/releases/latest/download'))

const markdown = [
  'README.md',
  'README.de.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'SUPPORT.md',
  'FORK_NOTES.md'
]
const visit = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = resolve(dir, entry.name)
    if (entry.isDirectory()) visit(file)
    else if (entry.name.endsWith('.md')) markdown.push(file)
  }
}
visit('docs')
let checked = 0
for (const file of markdown) {
  for (const match of read(file).matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
    const link = match[1].split('#')[0]
    if (!link || /^[a-z]+:/i.test(link)) continue
    assert.ok(
      existsSync(resolve(dirname(file), decodeURIComponent(link))),
      `${file}: missing ${link}`
    )
    checked++
  }
}
console.log(
  `Public distribution checks passed: identity, feed, license and ${checked} local documentation links.`
)
