// 复现脚本:node reproduce.js
import { login } from './auth.js'

try {
  const token = await login('demo', 'demo123')
  console.log(`登录成功 token=${token}`)
} catch (e) {
  console.log(`登录后 token 为空,控制台抛 TypeError:`)
  console.log(`  ${e.constructor.name}: ${e.message}`)
  process.exit(1)
}
