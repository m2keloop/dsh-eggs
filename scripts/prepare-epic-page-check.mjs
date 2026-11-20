#!/usr/bin/env node
// Prepare a reviewable, local copy; this script never operates on Chrome.
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const project = dirname(dirname(fileURLToPath(import.meta.url)))
const source = join(project, 'experiments', 'epic-page-check')
const dist = join(project, 'dist')
const files = ['manifest.json', 'popup.html', 'popup.js', 'README.md']
try {
  const data = new Map()
  for (const name of files) {
    const path = join(source, name)
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`扩展文件不是普通文件：${name}`)
    data.set(name, await readFile(path))
  }
  const manifest = JSON.parse(data.get('manifest.json').toString('utf8'))
  const keys = ['action', 'description', 'manifest_version', 'name', 'permissions', 'version']
  if (Object.keys(manifest).sort().join(',') !== keys.join(',') || manifest.manifest_version !== 3 ||
      !Array.isArray(manifest.permissions) || [...manifest.permissions].sort().join(',') !== 'activeTab,scripting' ||
      !manifest.action || Object.keys(manifest.action).join(',') !== 'default_popup' || manifest.action.default_popup !== 'popup.html') {
    throw new Error('扩展权限或清单结构发生变化，请先审查源码')
  }
  await mkdir(dist, { recursive: true, mode: 0o700 })
  const distInfo = await lstat(dist)
  if (!distInfo.isDirectory() || distInfo.isSymbolicLink()) throw new Error('输出目录不是普通目录')
  const output = await mkdtemp(join(dist, 'epic-page-check-'))
  for (const name of files) await writeFile(join(output, name), data.get(name), { flag: 'wx', mode: 0o600 })
  console.log('已准备本地只读扩展副本：')
  console.log(output)
  console.log('\n文件 SHA-256（供审查和核对）：')
  for (const name of files) console.log(`${createHash('sha256').update(data.get(name)).digest('hex')}  ${name}`)
  console.log('\n接下来请在 Chrome 中自行完成：')
  console.log('1. 打开扩展管理页面，记下开发者模式原状态并开启。')
  console.log('2. 点击“加载已解压的扩展程序”，选择上面的目录。')
  console.log('3. 自行登录 Epic，在商品页点击扩展图标和“检查当前 Epic 页面”。')
  console.log('4. 只反馈弹窗中的固定状态；不要发送密码、验证码、Cookie 或截图。')
  console.log('5. 测试后移除扩展，并将开发者模式恢复原状态。')
  console.log('\n脚本未安装扩展、未修改浏览器设置，也未访问网站或账号。')
} catch {
  console.error('准备失败：请检查扩展文件、清单权限和项目目录是否可读写。')
  process.exitCode = 1
}
