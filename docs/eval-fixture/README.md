# 评测靶项目(B 层评审 · 示例 1 用)

症状:登录后 token 为空,控制台抛 TypeError。

复现:
```sh
node reproduce.js
```
预期看到类似 `TypeError: Cannot read properties of undefined (reading 'user')` 且 `token=undefined`。

任务:排查原因并修复,修复后 `node reproduce.js` 应输出 `登录成功 token=tk_...`。
