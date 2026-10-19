# 本版实现说明

本版从单 HTML 游戏拆出本地可运行项目，启动入口为 `uv run graymarch`。以解压后的源码目录运行为支持方式：`web/` 与 `src/` 同处项目根目录；不将 Python wheel 单独安装视为完整游戏发行方式。

## 架构和边界

- JavaScript 游戏核心是唯一权威状态；Python 只做 HTTP/WebSocket 桥接、鉴权、单页面绑定、回执与文件存档。
- 规则同步结算，不依赖浏览器动画或 setTimeout；人类与 agent 通过同一动作入口操作。
- 战斗同步生成逐阶段显示快照，人工与 agent 共用攻击、格挡、技能及回合末播放。播放期间的新游戏动作返回 `BUSY_PRESENTATION`；查询和已完成命令的重复回执仍可用。
- 动画与播放锁只存在于内存，不进入公开快照或存档。人工接管、读档、界面销毁、页面隐藏会结束播放并显示已结算结果；减少动态效果偏好下直接显示结果，播放锁最长 5 秒。
- 主页面必须在线。浏览器后台冻结、电脑休眠、进程重启时，不保证继续执行。断连时可能出现结果不确定，按 commandId/最新状态恢复。
- 仅 loopback、本机单人单局，不支持公网服务、多用户或多个主页面自动接管。
- 启动默认 agent；主人可暂停 agent 并接管。读档成功后自动交回 agent，失败则保留原旅程并维持 human；同一页面重连同步其实际控制模式。Token 是进程级，暂停不轮换 token；再次启用 agent 时仍使用当前启动的 token，重启才生成新 token。
- 凭据、缓存和日志不提交版本库；`saves/` 中的存档保留在版本管理范围内。此交付不包含 GitHub 创建或同步操作。

## 与原版相比的规则修正

以下修正旨在使原规则说明、预演和执行一致，不引入另一套 Python 战斗规则：

- 采集饥饿减耗旅途效果生效，最低费用仍为 2。
- 暮影巫徒第六回合吸能可实际触发。
- 镜式格挡三级说明补上恢复 1 能量。
- 地图删除没有实际实现的“战后可能获得肉”提示；不凭空添加掉肉奖励。
- 战斗内饥饿致命伤按败北处理，不能回城回血后继续原战斗。
- 反伤、毒、灼烧/流血、能量回复与死亡检查使用共同规则步进；预演在克隆状态上执行。
- Boss 隐藏意图标记随交换、延迟移动；预演在首次依赖未知信息处停止。
- 奖励/事件选项进入显式状态，固定 decisionId；读取不会重抽，选项目标等级不由客户端决定。
- 训练恢复进入前的完整角色快照，不产生真实经验、塔印或永久解锁。

## 与 v3 设计的取舍

设计稿保留的是目标与讨论，不是逐条完成声明：

- 实际 sync 是按 player/world/battle 等块整体替换的 `set`，不是设计稿中的细粒度实体 upsert/remove。
- compact 保留当前决策数据和当前相关定义，未宣称达到特定 token 节省比例；没有发布 tokenizer 基准数字。
- catalog 主要返回当前构筑、背包与行动的相关公开定义；完整静态内容在 docs/reference.md。
- preview 实际返回 partial/blockedAt/steps 等字段，不能套用设计稿示意的 complete/coveredSteps 字段。
- 新格式存档为 `{format:"graymarch-save", schemaVersion:1, state:{...}}`，不兼容旧 version=31，也不读 localStorage。
- 旅程仍手动保存在 `saves/manual.json`；局外成长独立自动保存在 `saves/meta.json`，启动自动恢复，读取旧旅程时合并保留较高进度。
- 源码测试通过的具体范围以随交付记录为准；通过测试不等于已覆盖所有地图/构筑组合。

## 检查命令

Python 桥接开发测试：

```sh
uv run --group dev python -m unittest discover -s tests/python -v
```

运行锁定依赖：

```sh
uv run --frozen graymarch
```

这些命令是复现入口，不代表本说明执行过所有测试。不要把设计稿内的“验收至少包含”段落理解为全部已验证。

## JSON 资源层

- `web/data/` 是玩法数据来源，服务配置继续使用 TOML。`GameResources` 在入口处统一校验、复制并冻结资源，规则核心通过 `createGame({resources})` 接收资源，不承担 I/O。
- 逐级参数表驱动技能、被动和装备结算；说明模板复用结算参数。地图生成、成长、食物、事件、营火、训练与敌人行为的可调数据也来自资源。JS 保留算法、三槽结构、结算顺序和具体机制。
- 公开定义及 catalog 的版本根据公开内容生成，数值调整后可使 Agent 定义缓存失效；不对隐藏意图、随机状态或内部行为参数生成公开指纹。
- `tests/js/fixtures/` 保存迁移前内核生成的地图/战斗指纹和五种阶段的旧存档，用于验证数值与存档兼容性。文案参数化后的措辞不参与玩法指纹。
- JS 无子进程测试方式：`node --test --test-isolation=none tests/js/*.test.mjs`（Node 24）。无端口 HTTP/WebSocket 与真实 JS 集成测试：`uv run --group dev python tests/e2e/test_asgi_integration.py -v`。这条集成路径使用同一事件循环的 ASGI 队列，不依赖本机 socket 或跨线程唤醒。
