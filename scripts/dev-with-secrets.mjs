// 開発サーバー起動: 秘密の鍵を Bitwarden Secrets Manager(プロジェクト FEVER-LIVE)から読み込んで next dev に渡す。
// 公開してよい値(NEXT_PUBLIC_* など)は従来どおり .env.local。トークンが無いときは鍵なしで起動する。
import { spawn, execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const PROJECT_ID = '7f063a6a-8178-4081-83b1-b4da004210d0'

// 起動中のアプリはユーザー環境変数の追加を知らないことがあるので、Windows ではレジストリも見る
function readToken() {
  if (process.env.BWS_ACCESS_TOKEN) return process.env.BWS_ACCESS_TOKEN
  if (process.platform !== 'win32') return null
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Environment', '/v', 'BWS_ACCESS_TOKEN'], { encoding: 'utf8' })
    return out.match(/BWS_ACCESS_TOKEN\s+REG_\w+\s+(\S+)/)?.[1] ?? null
  } catch {
    return null
  }
}

function bwsPath() {
  const winget = path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Packages',
    'Bitwarden.BWS_Microsoft.Winget.Source_8wekyb3d8bbwe', 'bws.exe')
  return existsSync(winget) ? winget : 'bws'
}

const env = { ...process.env }
const token = readToken()
if (token) {
  try {
    const out = execFileSync(bwsPath(), ['secret', 'list', PROJECT_ID, '--output', 'json'], {
      encoding: 'utf8',
      env: { ...process.env, BWS_ACCESS_TOKEN: token },
    })
    const secrets = JSON.parse(out)
    for (const s of secrets) env[s.key] = s.value
    console.log(`[secrets] Bitwarden から ${secrets.length} 件読み込み: ${secrets.map((s) => s.key).join(', ')}`)
  } catch (e) {
    console.warn(`[secrets] Bitwarden から読めなかったので鍵なしで起動します: ${e.message.split('\n')[0]}`)
  }
} else {
  console.warn('[secrets] BWS_ACCESS_TOKEN が無いので鍵なしで起動します')
}

const nextBin = path.join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next')
const child = spawn(process.execPath, [nextBin, 'dev', ...process.argv.slice(2)], { stdio: 'inherit', env })
child.on('exit', (code) => process.exit(code ?? 0))
