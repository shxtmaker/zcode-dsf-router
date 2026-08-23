// 登录态管理:登录成功后保存 token 与用户信息
import { loginApi } from './api.js'

export async function login(username, password) {
  const resp = await loginApi(username, password)
  if (resp.code !== 0) throw new Error(resp.message)
  // 植入的 bug:token 在 resp.data 下,这里直接取 resp.token → undefined
  const token = resp.token
  saveSession(token.user, token)
  return token
}

function saveSession(user, token) {
  globalThis.__session = { user, token }
}
