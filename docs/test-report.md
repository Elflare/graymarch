# 交付测试记录

2026-10-18，Linux 云工作环境。此记录对应首次源码包交付。

## 已完成

- `node --test tests/js/*.test.mjs`：129 项通过、0 失败。
- `uv run --frozen --group dev python -m unittest discover -s tests/python -q`：8 项通过。
- `uv run --frozen --group dev python -m unittest discover -s tests/e2e -q`：1 个跨语言集成场景通过。真实 JS 游戏核经 Python HTTP/WebSocket 路由执行移动、重复请求、完整信息限频、训练、三步预演/结算、退出、文件保存与加载；使用 ASGI TestClient 和无画面 Node peer，不是浏览器测试。
- 实际 CLI 子进程启动、loopback health、HTML/JS/CSS 静态文件访问通过；在临时项目目录验证，未将测试存档打入包。
- uv 锁定依赖安装及 `uv run graymarch --help` 通过。
- JS 语法检查与 Python 示例编译通过。
- UI 单元测试使用随项目附带的最小 DOM；另用 happy-dom 实际解析原 HTML 验证 209 格地图、训练提交、奖励显示与选择，通过。happy-dom 是额外检查工具，不是运行依赖。
- 额外探索压力检查运行 800 次迭代，覆盖战斗/事件与 80 次存档往返。不是所有玩法组合的穷举。

## 尚未完成

- 真实 Chromium 启动被当前环境的 socket 权限限制阻断，因此没有完成浏览器真实布局、动画、音频和人工连续点击验收。
- 未在 Windows/macOS 实机验证。
- 未测所有构筑/无限地图组合，未发布模型 tokenizer 的 token 节省比例。
- 无 GitHub 同步；此交付为可本地运行的源码 ZIP。

本地建议先 `uv run graymarch`，确认地图显示、方向键移动、训练三步计划、暂停接管和手动存读档，再按 Agent 操作指南调用 API。测试输出可能出现 Starlette 关于 httpx 的弃用提醒；上述测试仍通过。
