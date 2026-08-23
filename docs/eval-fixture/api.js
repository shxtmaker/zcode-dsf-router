// 模拟登录后端接口:成功时返回 { code: 0, data: { token, user } }
export async function loginApi(username, password) {
  await new Promise(r => setTimeout(r, 20))
  if (username === 'demo' && password === 'demo123') {
    return { code: 0, data: { token: 'tk_demo_9f3a', user: { name: 'demo' } } }
  }
  return { code: 1, message: '用户名或密码错误' }
}
