> 历史设计文档（v3），用于理解设计取舍，不是实现承诺。实际启动、配置和 API 请以 [README](../README.md)、[Agent 操作指南](agent-guide.md) 与当前代码为准。原稿的拟议目录、GitHub 发布、测试计划等不代表已完成；当前交付不包含仓库发布。

# 灰境战术：Agent API 与代码结构设计

版本：讨论稿 v3 · 2026-10-18  
状态：仅设计，未修改游戏、未启动服务。本文接口、目录与命令均为拟议方案。

## 1. 目标与已确认边界

- 保留现有游戏画面、玩法和人工操作入口；AI 玩的就是人看到的同一局。
- AI 直接读取结构化信息、调用语义操作，不截图、不模拟鼠标。
- 使用 uv 启动轻量 Python 程序，同时启动本地 API 并自动打开游戏。
- 不使用 MCP。比较 HTTP JSON 与 JSON-RPC，首版推荐 HTTP JSON。
- 拆分原单文件，游戏规则只保留一份，继续用 JavaScript；Python 不重写规则。
- 不另做观战网页或独立画面服务。Python 同进程提供原游戏静态文件，仅为打开页面和加载模块。

已确认：HTTP JSON + uv/Python 薄桥；玩家可见信息范围；允许人暂停接管；观看节奏；手动存档；首版一个服务实例对应一局游戏。已发现规则缺陷可在实现中修复，并逐项列出变更与验证结果。

新增边界：不兼容旧版存档；不使用 localStorage，存档写入游戏文件夹的 saves/；通用规则和调用指南直接写在 README，游戏响应只给当前决策所需信息；提供按需主动完整信息接口，其调用间隔可配置且默认不限制。项目要求用 gh 创建私有仓库，拟定为 Elflare/graymarch；本文不表示仓库已创建，实际结果另行核验。

## 2. 已阅读的源码与关键结论

依据上传包中的 README.md、使用说明.txt、graymarch.html（1,416 行，144,396 字节，存档 version=31）。以下行号均指原始 HTML。

游戏主要是世界探索与三步战斗规划。移动、采集和真实战斗消耗饥饿；升级三选一；精英提供塔印，三枚后挑战赤塔；最终胜利后仍可继续探索。战败/撤退不是永久死亡。

| 现状 | 位置 | 设计影响 |
| --- | --- | --- |
| 所有业务共用全局 state | 241–248 | 建立显式状态和统一命令入口 |
| 移动先找地图 DOM，再在动画定时器中改坐标 | 861–905 | API 不能直接调用现有 moveTo |
| 渲染会揭示地图、重算并改变资源/护甲 | 384、587、689–690、1043 | 查询与渲染必须只读 |
| 事件选项存于按钮闭包；奖励轮数存于 dataset | 771–786、1309–1310、1349 | 决策必须成为可序列化状态 |
| 预估与执行有两个结算循环 | 1183–1197、1223–1270 | 统一规则步进，避免预估与实战分叉 |
| 技能、奖励等部分验证靠按钮禁用 | 1214–1217、1310 | 引擎再次验证，不能信任传入等级/选项 |
| 地图种子固定，部分食物/奖励及音效用 Math.random | 239、365、527–530、558、566、1303 | 玩法随机流与表现随机流分离 |
| 旧档缺少完整战斗、待选项与随机流 | 1368–1369 | 新存档使用完整新 schema；不迁移或兼容旧档 |

因此，“多一个 API”在产品体验上很轻，但内部必须先分离规则、交互与动画。否则可能出现 API 返回时移动未完成、弹窗选择无法读取、后台标签让结算卡住等问题。

## 3. 推荐运行架构

```text
uv run graymarch
    └─ Python launcher（同一个进程）
        ├─ 启动 loopback HTTP API
        ├─ 提供现有游戏的 HTML/CSS/JS 静态文件
        ├─ 自动打开浏览器游戏页
        ├─ 接收页面主动建立的 WebSocket 连接
        └─ 受限读写游戏文件夹 saves/ 下的手动存档

外部 Agent ── HTTP JSON ── Python 薄桥 ── WebSocket ── 游戏页面
                                                        ├─ JS 游戏核：唯一权威状态
                                                        └─ 原 UI：渲染、动画、人工输入
```

uv run graymarch 是拟议项目入口，需要未来在 pyproject.toml 中定义，目前不是现成命令。uv 负责 Python 环境和依赖，应用本身负责开端口、开浏览器。[uv 项目文档](https://docs.astral.sh/uv/guides/projects/)

浏览器主动连接本地桥接服务，agent 无须处理 WebSocket。[浏览器 WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)

选择此结构的原因：最贴近“打开游戏就能让 AI 玩”；继续使用现有 JS；没有第二份可变的权威游戏状态、第二套画面或 Python 战斗实现；Python 仅额外负责受限存档文件持久化与文件级校验。可用 FastAPI + Uvicorn 承载 HTTP 与 WebSocket，依赖在实现时锁定，不在本稿指定版本。[FastAPI WebSocket 文档](https://fastapi.tiangolo.com/advanced/websockets/)

### 启动与关闭

1. 启动器绑定固定的 loopback 端口；冲突则明确报错，不悄悄连接其他游戏。
2. 打开同源游戏页面，页面完成认证、加载和状态握手后标为 ready。
3. 页面显示 API 状态、控制模式和当前局标识；agent 查询状态后开始操作。
4. API 只能转发到当前已绑定页面。页面断开后拒绝新动作，缓存结果标为历史信息。
5. 刷新/读档/新周目改变 epoch 或 runId，旧请求不得落到新局。
6. 首版不承诺关页面、电脑睡眠、浏览器冻结后还能继续玩。后台页面可能受调度限制，即便保留连接也不能保证一直运行。[页面可见性与后台限制](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)

同一实例只绑定一个主页面，第二个页面不能自动夺取控制权。当前 API 默认供同机调用；远程 AI 的 localhost 指它自己的机器，需本机工具执行请求。公网暴露、隧道和多用户不属于首版。

## 4. RPC 与 HTTP 的比较和选择

RPC 是调用模型，HTTP 是传输协议，并非互斥。这里比较两种具体外部协议。

| 方面 | HTTP JSON API | JSON-RPC 2.0 over HTTP |
| --- | --- | --- |
| 表达方式 | GET 查询，POST 预演/动作 | 单端点，以 method + params 调用 |
| 游戏操作 | POST /api/v1/actions，正文带 type | game.act、game.observe、game.preview |
| 调试 | URL、状态码和 JSON 易读 | 方法名清晰，统一请求/结果外壳 |
| 额外约定 | 自定义统一错误结构 | 标准 result/error，但业务错误仍须定义 |
| 并发/重试 | 自行实现 revision、commandId | 同样自行实现；RPC id 不是幂等保证 |
| 适用性 | 当前少量接口足够直接 | 已有统一 RPC 客户端时更方便 |

推荐首版 HTTP JSON，内部接口仍采用 observe/preview/dispatch 等方法式组织。POST actions 本身也具有 RPC 风格，不必强行把“采集”“三步结算”包装成复杂资源 CRUD。首版不同时实现两套外部协议。

若选择 JSON-RPC，业务参数可保持相同，例如：

```json
{"jsonrpc":"2.0","id":"req-12","method":"game.act","params":{"sessionId":"s1","runId":"r1","commandId":"c12","expectedRevision":7,"type":"world.move","payload":{"direction":"north"}}}
```

JSON-RPC 的 id 仅用于关联响应；通知没有响应，不能用于需要确认结果的游戏动作；批处理不保证执行顺序，不能当“顺序走三步”的指令。[JSON-RPC 2.0 规范](https://www.jsonrpc.org/specification)

gRPC 首版不选：当前没有高吞吐跨服务需求，不值得引入额外服务定义与客户端生成流程。[gRPC 简介](https://grpc.io/docs/what-is-grpc/introduction/)

## 5. 目录结构与职责

```text
graymarch/
├─ pyproject.toml / uv.lock
├─ README.md               # 通用游戏规则、API 调用与启动/存档指南
├─ .gitignore              # saves/、凭据及运行产物
├─ saves/                  # 游戏文件夹内手动存档，不入库
├─ src/graymarch_bridge/
│  ├─ __init__.py
│  ├─ __main__.py          # 启动、端口、自动打开游戏
│  ├─ app.py               # HTTP/静态文件/WebSocket 路由装配
│  ├─ api.py               # 外部 JSON 请求与响应
│  ├─ sessions.py          # 主页面绑定、连接状态、命令回执
│  ├─ security.py          # loopback、认证、Host/Origin 检查
│  └─ persistence.py       # 固定 save ID、schema 校验、原子文件替换
├─ web/
│  ├─ index.html           # 保留现有页面结构
│  ├─ styles/              # 原 CSS，按布局/地图/战斗拆分
│  ├─ assets/              # SVG、音效及其他表现资源
│  └─ src/
│     ├─ main.js           # 装配游戏核、UI、桥接客户端
│     ├─ core/
│     │  ├─ state.js       # 初始化、阶段与不变量
│     │  ├─ engine.js      # validate/dispatch、事务、revision
│     │  ├─ world.js       # 移动、发现、采集、抵达效果
│     │  ├─ combat.js      # 三步计划及单步规则结算
│     │  ├─ progression.js # EXP、升级、奖励、永久解锁
│     │  ├─ decisions.js   # 事件、营火、奖励等待选决策
│     │  ├─ observation.js # 玩家可见投影、合法动作
│     │  ├─ preview.js     # 克隆状态调用同一规则核
│     │  └─ rng.js         # 坐标哈希与玩法随机流
│     ├─ content/
│     │  ├─ classes.js / terrain.js / enemies.js
│     │  └─ skills.js / items.js / events.js
│     ├─ ui/
│     │  ├─ world-view.js / battle-view.js / panels.js
│     │  ├─ input.js       # 人工输入也发语义命令
│     │  └─ presentation.js # 动画、音效、浮字、播放进度
│     ├─ bridge/client.js # 页面 WebSocket、请求分派、结果
│     └─ persistence/
│        ├─ saves.js      # 手动保存/读取/导入导出，经 Python 持久化
│        └─ validation.js # 新格式完整校验与候选状态构建，无旧档迁移
├─ protocol/              # 请求、响应、命令的 JSON Schema
├─ tests/
│  ├─ core/               # 规则、预估、信息边界
│  ├─ bridge/             # 断连、超时、重复请求、控制权
│  └─ integration/        # API 操作与页面同局一致性
└─ docs/                  # 架构、API、已知问题、操作说明
```

不按“每个函数一个文件”拆分。core 不引用 document/window/网络/音效；UI 不能直接写 state；Python 不计算 HP、掉落或战斗结果。protocol 定义跨语言数据形状，Python 校验输入格式与持久化文档 schema，JS 核最终校验玩法条件及状态不变量。保存的 JSON 是 JS 权威状态的持久化快照，不由 Python 演算或修补。

README 是通用规则与调用指南的入口：写清目标、四向移动、消耗、三步计划/空槽等待、胜败与继续探索、信息可见边界、保存行为、协议字段/调用顺序及完整信息工具的按需用法。协议响应可给文档路径与版本，不复制规则长文；当前动作费用/效果、事件正文、奖励选项、可用性和实际状态仍须直接返回。私有仓库须排除 saves/、凭据、日志、缓存、临时文件及构建运行产物；私有不等于可以提交秘密。

## 6. 状态与命令模型

### 权威状态

- sessionId：本次游戏页面运行身份。
- runId：当前旅程身份；新旅程必须变化。
- epoch：读档、重置等使旧命令失效的代次。
- revision：每次成功业务提交递增；查询、面板开关、音量不递增。
- decisionTurn：成功提交且实际推进玩法的决策计数，规则见第 14.10 节；不同于 worldTurn、revision 与战斗内部步数。
- worldTurn：原有世界时间计数，仍由游戏规则推进，不用于完整信息查询限频。
- phase：world.ready、battle.planning、choice.pending。
- pendingDecision：decisionId、kind、标题、正文、选项、剩余奖励轮次和后续流程。
- battle：敌人定义 ID、状态、锁定意图、延迟意图、计划、封印槽、统计；不保存 ai 函数。

推进玩法的命令从前一个稳定决策点推进到下一个决策点；编辑计划等辅助命令只更新对应业务字段。一次移动包括抵达事件；一次采集包括可能开战；一次战斗提交最多结算三步，胜负时提前停止。规则不得等待动画定时器。

决策排队显式化：事件产生升级时先结束该选择，再开启奖励；连续升级逐轮固化候选。读取 observation 不重新抽奖。

### 规则与动画

规则先产生结果及有序事件，如 moved、damageApplied、intentDelayed、rewardOffered；UI 依据事件展示原动画。事件携带各步必要显示值，不能只拿最终 HP 播全部步骤。

界面区分当前规则 revision 与已播放 revision。默认采用已确认的“观看节奏”：动画播放期间暂缓下一条 agent 动作；提供跳过动画/快速模式。返回 BUSY_PRESENTATION 时明确是展示节奏限制。动画不是事务正确性条件，也不能因一帧丢失永久锁死游戏；页面隐藏/超时采用跳到最终快照或明确暂停策略。

## 7. 最小 API

首版以单实例单局为范围；所有业务请求需要鉴权。

| 路由 | 用途 |
| --- | --- |
| GET /api/v1/status | 游戏标识、协议版本、页面连接/ready 状态、session/run/epoch |
| GET /api/v1/observation | compact 当前决策帧或 sync 同步更新；恢复规则见第 14 节 |
| GET /api/v1/information | 主动获取指定 scope 的完整玩家可见当前快照；默认不限频 |
| GET /api/v1/catalog | 当前公开技能/物品的结构化定义与参数；不提供通用规则长文 |
| GET /api/v1/map | 按区域/游标读取已发现地图，限制单次大小 |
| POST /api/v1/preview | 预演三步计划，不改状态 |
| POST /api/v1/actions | 提交一次语义命令 |
| GET /api/v1/commands/{commandId} | 查询 submitted/completed/rejected/unknown 等状态 |

WebSocket 是页面与桥接进程的内部通道，不要求外部 agent 实现。人看的是本页，无需额外 SSE 观战推送。

### observation 必须足以决策

返回身份与版本、phase、玩家 HP/能量/攻击/格挡/饥饿、经验门槛、技能/被动/装备及等级、背包和状态持续回合；当前位置、世界回合、已发现地形与资源消耗标记、公开敌人资料、塔印和目标线索；战斗中敌人属性、公开模式、三步意图或 unknown、封印槽、当前计划；待选事件/奖励及稳定 ID；战报、最近公开事件、legalActions 与不可用原因。

默认返回紧凑摘要和局部地图，历史已发现地图按需查询。无限地图不应每次全量返回。非玩家可见字段由页面内 core/observation.js 投影移除后再传给桥接层，不能仅在界面藏起来。

### 游戏命令清单

| type | payload | 主要限制 |
| --- | --- | --- |
| world.move | direction: north/south/east/west | 相邻一格、可通行、世界阶段 |
| world.harvest | 空 | 当前格可采且未采 |
| inventory.eat | itemId | 非战斗、持有物品 |
| camp.open | 空 | 当前可用营火 |
| choice.select | decisionId, optionId | 当前实例中存在且可选 |
| choice.cancel | decisionId | 仅显式允许离开的选择，如营火 |
| battle.plan.set | plan: 三槽 actionId/null | 已拥有技能，封印槽必须为空 |
| battle.commit | plan: 三槽 actionId/null | 原子校验并执行；不依赖先 set |
| battle.retreat | 空 | 战斗中；按原撤退后果结算 |
| training.start / training.exit | 空 | 遵循训练入口和恢复规则 |

奖励、事件、营火、胜利后继续探索均可用 choice.select；reward option 的目标等级由引擎决定，客户端不能传 to 修改等级。空战斗槽代表等待，不要求补满三格。

新旅程、读档、导出完整存档和控制权变更属于宿主管理能力，不默认开放给玩游戏的 agent。胜利后选项若会重开，须依宿主授权呈现为可用或需人工处理。

### 请求与返回示例（示意值）

```json
{
  "sessionId": "s1",
  "runId": "r1",
  "epoch": 1,
  "commandId": "move-001",
  "expectedRevision": 12,
  "type": "world.move",
  "payload": {"direction": "north"}
}
```

正常同步完成返回 completed、revisionBefore/After 和下一决策点 observation。默认使用第 14 节的 compact 决策帧；程序同步客户端可选 sync 增量，避免每步重复完整状态。若超出 HTTP 等待期限，返回已受理的 commandId/查询地址；这不是执行失败。

```json
{
  "commandId": "move-001",
  "status": "completed",
  "revisionBefore": 12,
  "revisionAfter": 13,
  "events": [{"type":"moved","from":{"x":0,"y":0},"to":{"x":0,"y":-1}}],
  "observation": {"phase":"world.ready","revision":13}
}
```

示例省略了完整 observation。正式实现由 Schema 明确字段、枚举、上限与可选性。

## 8. 预演、公平信息和验证

preview 接收 expectedRevision 与三步 plan，返回 valid、warnings、coveredSteps、complete、停止原因以及已知范围内各步变化。通过克隆状态使用同一个 stepCombat，不扣资源、不消耗正式 RNG、不改变待选项。

默认公开人类正常可知的信息：已发现区域、tooltip 的敌人属性、已公开技能效果、当前可见意图。塔印导航只给方向和大约距离，不能泄漏内部精确坐标；不暴露未知地块、未来掉落、RNG 状态或 Boss 隐藏第三步。

隐藏意图应带随意图移动的可见性标记。交换顺序后若未知意图进入前两步，精确预估在首次依赖未知信息处停止，不能仍按“前两格已知”计算。合法性错误信息也不能泄漏隐藏结果。

结构合法不等于战术一定成功：计划中的技能可能因敌方吸能在执行时失败。区分未知技能/非法槽位等拒绝条件，与能量风险等预估警告；费用、返能、状态衰减必须按真实步骤计算。

公平是 API 暴露范围约定。若 agent 还能任意读游戏源码/进程内存，不能宣称具备防作弊隔离；首版不把本地开发工具当竞技安全沙箱。

## 9. 并发、接管、超时与安全

- 人工输入与 API 都进入同一命令入口。默认 agent 控制时禁止人工玩法按钮写入，但允许看面板、调音量。
- 人点击暂停/接管后，在当前命令边界停止接收 agent 新动作，撤销旧控制凭据；已提交命令不回滚。
- 同一局只串行执行一个变更命令。revision/epoch 不匹配则拒绝，不把陈旧计划套到新状态。
- commandId 与请求摘要绑定：同 ID 同内容返回原回执；同 ID 不同内容报冲突。
- 网络超时不是未执行；先查询原 commandId，不换 ID 重发。页面核与桥接层均记录去重信息。
- 页面刷新丢失内存时，没有一致持久化的状态与回执就不能承诺跨刷新 exactly-once；应返回 unknown/session expired，人工决定恢复。
- 明确错误：INVALID_PHASE、STALE_REVISION、SESSION_EXPIRED、UNKNOWN_OPTION、LOCKED_SLOT、INSUFFICIENT_RESOURCE、IMPASSABLE、IDEMPOTENCY_CONFLICT、CONTROLLER_REQUIRED、GAME_DISCONNECTED。
- 无效命令没有业务副作用、不推进随机流。HTTP 4xx 表示输入/冲突或限频（429），503 表示页面不可用，202 表示受理但尚未确认完成；业务码放统一 JSON 字段。
- 只绑定 127.0.0.1；HTTP 随机凭据与页面桥接凭据分离；校验 Host/Origin、禁止通配 CORS、限制消息大小与队列长度；不提供任意 JS 执行接口。
- 凭据不放日志和普通 URL 查询参数。页面配对使用一次性引导凭据，消费后移除；WebSocket 握手和消息层均认证。不得仅凭 localhost 判定可信。[WebSocket 安全](https://datatracker.ietf.org/doc/html/rfc6455#section-10.2)

## 10. 手动存档与游戏文件夹持久化

保留“仅主动保存”和“导入 JSON 不自动覆盖保存”的语义。不为防崩溃而悄悄增加自动存档。不使用 localStorage，也不尝试迁移旧浏览器数据。新设计无需旧档兼容；旧版 v31 及其他不支持格式明确拒绝，不提供 migration.js 或宽松补字段兼容路径。

### 格式与稳定保存边界

新格式区分 saveVersion、rulesVersion、schemaVersion；包含玩家/世界状态、当前阶段、完整战斗规划与公开/隐藏内部状态、待选决策与已固化候选、玩法 RNG、decisionTurn 等恢复所需字段。完整存档属于宿主管理数据，不能作为玩家可见信息接口返回。首次格式版本在实现时确定；只接受明确支持的新格式版本，后续若升级需单独定义策略。

只允许在稳定决策边界保存：世界待操作、战斗规划、待选决策均可保存；正在执行规则事务时等待其结束。动画播放进度不入档，加载后直接呈现已提交的稳定状态。JS 负责序列化与完整 schema/状态不变量校验，Python 对收到的整个文档再次执行同版本 schema 校验（包括必需字段、类型、范围、枚举与拒绝未知字段），不能只检查版本号或 JSON 能否解析。

### 受限文件持久化

- 启动器确定并固定游戏根目录，存档只写该目录的 saves/，不能随请求或当前工作目录漂移；若不可写，明确报错，不回退 localStorage。
- 首版服务器固定安全存档 ID `manual`，映射到 saves/manual.json。客户端只提交该 ID 或使用固定手动槽；不接受文件路径、任意文件名、目录穿越、绝对路径或符号链接逃逸。未来多槽只能由服务端白名单或生成的安全 ID 扩展。
- 只有经宿主授权的保存/读取/导入导出流程能访问持久化能力；普通玩法 agent 不默认获得读写完整存档的权限。浏览器手动保存仍通过同一桥接服务完成。
- 保存时在同一 saves/ 目录创建独占临时文件，写入已校验的完整 JSON，刷新文件后原子替换目标；采用平台支持的目录同步提高落盘可靠性，并清理失败临时文件。禁止先清空旧档再写。成功回执只在替换成功后发出；替换是提交点，替换后耐久性确认失败须报告“提交已发生、持久性未确认”，不可误称旧档未变或盲目重试。
- 原子替换前任何验证/写入失败均不改变旧档；保存从不改变当前游戏局。读取/导入先在隔离候选中完整解析、校验格式与 JS 不变量，全部成功后才原子替换内存状态并更新 epoch；失败保留当前局和旧档。导入成功只加载内存，仍要主动保存才覆盖手动槽。
- 明确处理缺档、损坏、超大小、不支持版本、权限不足、磁盘满及并发保存。存档 I/O 串行化，绑定源 runId/epoch/revision；存的是哪个稳定版本必须可核对，不能混合多个版本。断连造成回执不明时查询原操作状态，不误报保存成功。

存档、临时文件、凭据和运行产物加入 .gitignore，不提交 GitHub。保存路径在 UI/README 明示；固定端口只用于服务定位，已不决定存档归属。

## 11. 已发现问题与已授权修复范围

本次只做静态审查，以下为代码依据与需复现的风险，并非已运行验证。

1. 预估没有完整复现实战 buff 衰减/重算，训练预估还可能扣饥饿（767–768、1182–1197、1260）。统一规则核后需要专门对照测试。
2. 战斗中饥饿归零可触发回起点回血，胜利又按当前坐标标记清除，存在清错地块风险（768–769、956、1260）。实现时固定战斗来源坐标与饥饿处理顺序，修复并记录行为变化。
3. 采集先推进时间，若因此回起点，后续掉落哈希使用新坐标但地形仍是旧坐标（791–823）。
4. Boss 隐藏图标、tooltip、图鉴可见性不一致；交换未来意图也可能让旧 preview 泄漏隐藏动作（685、699–720、1186–1193）。
5. 训练只恢复部分字段，是否满足“真实状态未改变”须回归（924、951–953）。
6. 读档校验宽松，hydrate 返回 false 未被调用方准确处理；延时奖励/战斗可能与重置穿插（1369、1385–1387、1406）。

已获准在实现时修复上述规则缺陷，并逐项给出“原行为/问题、修正后行为、影响范围、测试结果”的变更清单；不必为了结构重构继承旧异常。结构变更必须消除 DOM 决策和异步事务窗口；修复以一致结算、公平可见性和状态完整性为边界，不借机扩大为未约定的数值平衡或玩法重做。本稿只列修复方向，未声称已修复或验证。

## 12. 实施顺序与验收

1. 固定原始文件与行为案例，建立风险清单。
2. 提取 content、state、待选决策，保留原画面样式。
3. 提取无 DOM 引擎与同一战斗步进逻辑；人工 UI 接统一命令。
4. 完成 observation、preview、Schema 与玩家可见过滤。
5. 加 uv 启动入口、Python 薄桥、页面 WebSocket，贯通 HTTP。
6. 加控制模式、去重、断连恢复、游戏目录手动存档及 README；实现完整信息接口与可配置限频。
7. 按第 11 节修复并验证规则缺陷，给出变更清单；用 gh 创建私有仓库并核验可见性与忽略规则，仓库实际状态单独报告。

验收必须覆盖：
- 一条 uv 命令打开原游戏且 API 报 ready；无需另开观战页。
- 不看屏幕，仅 API 就能探索、采集、进食、营火、事件、升级选择、战斗与训练。
- 人能看到同一局的行动过程；画面跟随游戏事件，无另一份权威状态。
- 连续 observe/preview 不改状态或 RNG；公开信息范围内预估与真实结算一致。
- 隐藏意图换序、能量吸取、buff 到期、饥饿与连升均有测试。
- 同请求重试不重复走格/吃物品；旧 revision、旧 epoch、过期选项被拒绝。
- 暂停接管不会与 AI 交错写；断连/刷新/双标签有明确结果。
- 旧档明确拒绝；新存档涵盖战斗/待选项/RNG，保存与读取失败不破坏当前局或替换前旧档；存档在游戏文件夹而非 localStorage。
- 路径穿越/符号链接、损坏/截断档、磁盘满、并发 I/O 及原子替换边界有测试；导入不自动覆盖手动槽。
- README 包含通用规则；首次基线不塞规则长文，当前费用/效果、事件正文和奖励选项完整可见。
- 完整信息默认不限频；正数间隔按 decisionTurn 硬限制，不能通过空操作、改 contextId、重连或伪称恢复绕过；限频时仍可由 compact 继续决策。

## 13. 已确认决定与实现边界

原第 13 节的 1/2/3 已全部确认：

1. 采用 HTTP JSON + uv/Python 薄桥；JS 为唯一规则权威，Python 提供静态页面、桥接与受限文件持久化。
2. 默认玩家可见信息、可暂停接管、观看节奏与手动存档；单实例对应同一游戏页面与同一局。
3. 允许实现时修复已发现规则缺陷，并列出每项行为变更及测试结果。

补充确认：新设计无需旧档兼容；存档保存在游戏文件夹 saves/，不使用 localStorage；项目使用 gh 创建私有仓库；通用规则与调用指南直接放 README；新增按需主动完整信息接口，工具说明要求优先使用已有信息、少频繁调用；full_info.min_turn_interval 默认 0，未来配置正整数时可硬限制。

本文是已按决定更新的设计稿，不表示游戏改造、规则修复、测试或仓库创建已经完成。不得把规划命令写成执行结果。实现须遵守上述范围；框架版本、具体新 schema 版本及文件级实现细节在开发中落实并测试，不重新引入旧档迁移或另一个规则引擎。

## 14. Agent 信息协议与完整信息查询

本节细化并优先于第 7 节的全量 observation 示意。目标是让 agent 拿到足够的信息作决定，同时避免每步重复地图、物品说明、完整日志。

### 14.1 核心原则：两层信息，不把差分重建任务全交给模型

1. **程序同步层**：持有完整的玩家可见状态缓存。首次快照，随后按严格版本合并增量，场景切换替换场景快照。
2. **模型决策层**：每次收到“少量变化摘要 + 精简当前决策帧”。不要求模型从几十轮前的 HP、技能和地图自行累计状态。

两者是同一公开状态的不同输出格式，不是两套规则。默认 HTTP 返回 `compact`，外部 agent 不需要先实现缓存才能玩；需要精确同步的程序可选 `sync`。不得把 compact 和完整 sync 包都默认塞进模型上下文。

- `format=compact`：首轮 baseline；后续关键当前值、当前行动机会、尚未介绍过的新内容和简短结果。
- `format=sync`：首次 snapshot；以后 delta 或 scene_snapshot，供程序缓存应用。
- 恢复快照：由桥接/同步协议确认恢复条件并限定所需 scope；不得将客户端任意提交的 `snapshot=true` 当作不限频全量通行证。额外主动快照统一走 information 并受第 14.10 节约束。

每个成功动作的响应已带下一次决策信息，正常循环不必再额外调用 observation。preview 只回预测，不重复地图、背包或规则全文。

### 14.2 “首次全局信息”的确切含义

首次基线覆盖：
- 协议、规则与内容版本，以及 README 入口；目标只给当前进度/目标线索，不重复 README 的通用游戏规则长文。
- 当前旅程、职业、角色全部当前属性、背包、构筑、状态及解锁进度。
- 当前场景、可执行类型、当前待选项；如果连接时已经在战斗，应直接给战斗快照。
- 当前可见的局部地图、已知关键地点摘要、目标线索。
- 当前已拥有技能、物品与等级对应的准确效果/费用，以及当前决策会用到的条件；不附无关等级全集和通用规则教程。

这里不包括无限地图、未发现地点、未来随机结果、所有尚未获得的技能。加载已有大存档时，完整已探索地图按区域/游标查，不在首包强制灌给模型。必须明确 `mapScope`、覆盖范围和 `hasMore`，不能把未传来的已知地点冒充未知地点。

静态定义按 ID 和版本缓存：`rulesVersion`、`catalogVersion`。模型第一次遇到新技能、新等级效果、新敌人规则或新物品时附相应定义；以后用稳定 ID。`catalogVersion` 一样不表示模型一定还记得，context reset 后仍须补回当前相关定义。

### 14.3 场景身份与决策焦点

每包携带：`sessionId`、`runId`、`epoch`、`revision`、`scene`、`phase`。其中：

```json
{
  "scene": {"kind":"battle","id":"battle-3"},
  "phase":"battle.planning",
  "decisionId":null
}
```

- `scene.kind` 为 world 或 battle；`scene.id` 区分不同战斗，不能把上一场敌人状态带入下一场。
- `phase` 决定能执行什么；`choice.pending` 时，`decisionId` 标明当前唯一待选决策。
- 决策附 `kind`、`options`、`resumeScene` 或后续说明。UI 页签与弹窗开关不是业务场景身份。
- 世界地图可保存在缓存，但战斗中只能作为背景参考，不能继续 world.move。
- 结算结束显式 `sceneExited`；进入新场景显式 `sceneEntered`，并附目标场景快照。退出的战斗可归档，但立即失去可操作性。
- 奖励是显式决策，不一概“选完回战斗”。本作常规战胜后进入世界并发奖励；Boss 胜利先给胜利选项，选择继续后才处理待发奖励。

典型链路：世界移动 → 进入 battle-3 → 三步结算 → 战斗结束 → 世界中的 reward-8 选择 → 世界探索。每次转换都有明确标签和当前可执行命令。

### 14.4 日常发送策略

| 时机 | 发给模型的内容 | 不重复的内容 |
| --- | --- | --- |
| 首次/上下文重建 | 必需当前基线、相关内容定义、当前场景快照 | 通用规则长文、未知世界、无关全集 |
| 世界移动 | 当前位置/关键资源、邻接行动、新发现格、触发结果 | 旧地图、未变装备全文 |
| 采集/进食 | 最终资源、物品数量变化、新增/到期状态、结果摘要 | 食物说明全文（已介绍且未变时） |
| 进入战斗 | 双方完整战斗状态、三步意图、技能表、特殊规则 | 完整大地图、与战斗无关背包 |
| 提交三步计划 | 简短结算、双方当前战斗数值、下一批完整意图、限制 | 每帧动画、重复规则文字 |
| 事件/营火/奖励 | 完整本次选项、费用/效果/可用性、决策 ID | 其他事件全集 |
| 返回世界 | 退出战斗摘要、当前世界决策帧、局部地图快照、构筑变化 | 全部历史探索记录 |
| 无效操作 | 错误原因；若状态过期则给恢复提示或新帧 | 未变化时无须重发全部状态 |

世界关键当前值至少为坐标、HP/上限、饥饿/上限、能量、目标进度、影响本步的状态、当前格与邻接可走方向/成本。其他资源可差分或按需查询；临近升级等会影响决策的信息应进入当前帧。

选择帧还要附比较选项所需的当前构筑和资源，不能只有选项文案。战斗帧须包含会影响本批结算的被动、装备规则及训练标记；已缓存的长说明可引用 ID，但当前等级、动态数值和生效条件不能省略。

战斗当前帧至少包括双方 HP、护甲/攻击/格挡、玩家能量/上限与饥饿、有效状态及剩余回合、当前技能 ID/等级/费用、三步意图、封印槽与当前计划。HP 和意图等重复发送是有意的可靠性成本。

legalActions 不必重复 JSON Schema 全文。命令语法与调用顺序在 README/Schema 定义，首次给版本与入口；世界每步给四方向是否合法/成本和当前地块机会；战斗给技能短表与限制；选择阶段完整给选项。隐藏意图造成的不确定性不能通过 disabledReason 泄漏。

### 14.5 sync 增量的确定语义

同步包包含 `kind`、`baseRevision`、`revision` 与身份字段。只有缓存身份、版本、视图定义和 baseRevision 匹配时才能应用。

- 所有数值都是**变化后的绝对值**，例如 hp=12，而不是 hp-=3。重复包不会累计扣血。
- `set` 仅更新列出的标量字段；未列出表示不变，null 表示显式清空。
- ID 键控集合用 `upsert` / `remove`。upsert 里的实体为该实体的完整公开记录，不隐含多层递归合并。
- 物品耗尽明确写数量 0 或 remove，不能用省略代表耗尽。
- 数组如三步意图、计划、选项按完整数组替换；不发送大量路径式 JSON Patch。
- 地图格以绝对坐标为键，变化可 upsert；已离开当前视野不代表遗忘该格。`visible`、`discovered`、`inResponseScope` 分开。
- 快照带 `scope` 和 `replaceScopes`，局部地图快照仅替换声明区域/视图，不能清空整张探索记忆。
- `events` 只描述已发生事实，不参与状态累计。不能先应用 set.hp，再因 damage 事件重复扣血。

示意增量（不是原游戏实测轨迹）：

```json
{
  "kind":"delta",
  "sessionId":"s1","runId":"r1","epoch":1,
  "baseRevision":12,"revision":13,
  "scene":{"kind":"world","id":"world-r1"},
  "phase":"world.ready",
  "set":{"world.position":[0,-1],"world.worldTurn":8,"decisionTurn":9,"player.hunger":72},
  "upsert":{"map.cells":[{"x":0,"y":-3,"terrain":"forest","discovered":true,"visited":false}]},
  "remove":{"buffs":["rune_edge"]},
  "events":[{"id":"event-13-1","type":"moved","to":[0,-1]}]
}
```

字段路径是固定 Schema 中的有限白名单，不接受任意内存路径。正式 Schema 应明确每类集合键和数据范围。

大地图多页基线必须固定 snapshotId/revision；全部页组装完成后再应用后续增量。若该版本已不可用，明确失效重取，不拼接不同时间的分页。全图同步未完成时可以先给当前 compact 帧，但需标明历史地图覆盖不完整。

若跨越多个未接收动作，不能简单把最后一个包当 delta；服务有完整日志且可重建时才提供对应 base 的累计差分，否则返回新快照。若期间发生场景切换，至少返回当前场景快照与简短转换摘要。

### 14.6 compact：让模型不必手工重建状态

compact 当前帧是同步缓存的投影，或直接从页面权威状态生成。它应在当前场景内足够独立作下一次决定，省掉的是无关信息与长文本，不是关键条件。

示意战斗帧：

```json
{
  "kind":"decision_frame","sessionId":"s1","runId":"r1","epoch":1,"revision":29,
  "scene":{"kind":"battle","id":"battle-3"},"phase":"battle.planning",
  "batchId":"batch-2","battleStep":4,"decisionTurn":18,"worldTurn":21,
  "result":{"commandId":"commit-4","summary":"上一组三步已完成","outcome":"ongoing"},
  "player":{"hp":12,"maxHp":18,"energy":2,"maxEnergy":3,"block":0,"attack":4,"hunger":60,"statuses":[]},
  "enemy":{"id":"enemy-instance-3","hp":7,"maxHp":12,"armor":1,"block":0,"statuses":[]},
  "intents":[{"slot":0,"known":true,"type":"attack","damage":3},{"slot":1,"known":true,"type":"guard","block":2},{"slot":2,"known":false}],
  "plan":[null,null,null],"sealedSlot":null,
  "actions":[{"id":"basic_attack","cost":0},{"id":"basic_guard","cost":0}],
  "allowed":["battle.commit","battle.plan.set","battle.retreat"]
}
```

以上仅展示结构和字段语义，不表示该怪物在原版具有此意图组合。正式协议应提供当前敌人公开定义引用及必要规则。`known:false` 不携带真实动作 ID、费用、伤害或其哈希。

每步结果采用短的结构化摘要，细节通过 commandId 查询。首次遇到的内容附决策所需效果/条件，已知内容只报实际结果和动态变化；通用机制说明通过 README 查阅，不插入游戏响应教程。可选 agentReason 属于 agent 自愿提交的简短策略说明，不索取或保存模型内部推理。

### 14.7 如何确定对方“已知道”什么

不能因为服务器发过一次，就认定模型已经收到并长期记住。

- sync 客户端请求明确带 `baseRevision`，表示已成功应用到哪一版；服务器不能用“上次发送版本”代替。
- 静态定义去重依据客户端显式 `knownDefinitionVersions`；不提供则保守附当前相关定义。
- compact 客户端可带 `contextId`。模型对话新开、历史被裁剪/压缩、工具缓存丢失时由宿主改变 contextId，并重建必需的当前 baseline。协议无法自动可靠检测所有模型遗忘；单独更换 contextId 不重置完整信息限频，也不授权扩大到全量历史地图。
- 用户切换模型或另一 agent 接管时，也重新建立基线，不继承未经确认的知识缓存。
- 若没有宿主缓存能力，使用默认 compact；绝不强制“纯 delta”作为唯一玩法接口。

### 14.8 恢复与防混淆

以下情况需要重建所需范围快照：首次连接；服务端确认的 baseRevision 缺口；session/run/epoch 变化；协议/视图版本变化；命令结果 unknown；宿主通知的客户端缓存重建。场景切换自动带新场景快照，不等客户端发现不对才恢复。恢复范围由实际丢失的状态与当前决策需要决定，不是任意全量查询；第 14.10 节定义限频豁免与防绕过边界。

动作必须携带 expectedRevision；战斗操作再带 battleId/batchId，选择再带 decisionId。版本与实例不匹配直接拒绝，不能把旧攻击计划用于下一场，或把上次奖励的 optionId 用在这次奖励。

收到了旧 revision 的重试回执时：可确认该命令已完成，但不能把当前缓存倒退。返回包应区分“历史命令结果”和“当前状态”。合法增量没有新字段也可带版本推进；不能假设每条消息必有数值变化。

### 14.9 token 预算与测试方式

1. 优先级：身份/阶段 → 必要当前状态与全部可选项 → 新内容定义 → 变化摘要 → 可查询的细节。
2. 地图区域、历史日志、公开内容定义目录分页；返回明确 scope、hasMore、cursor，不静默截断。
3. 若核心状态或完整选项超预算，允许本次超目标预算，或明确要求拉取下一页；不能删掉关键费用/风险/选项后让模型立即行动。
4. 用稳定短字段名和 ID，不把可读协议压成无说明的字母/数字密文。坐标数组可用，但需在基线定义顺序。
5. 实测同一探索/采集/事件/普通战斗/Boss/多次升级轨迹：比较每步全量 JSON、sync 增量、compact 帧在目标模型 tokenizer 下的输入 token，中位数、尾部峰值、总量、额外查询次数及错误决策率。gzip 字节变少不等于模型 token 变少。
6. 不预先声称节省百分比。只有在不丢信息、恢复可靠、操作成功率不下降的测试条件下，再决定字段与预算。

验收新增项：snapshot + deltas 重建应等于同范围的新 snapshot；重复/乱序/缺包不会悄悄污染缓存；world→battle→reward→world 正确失效旧焦点；context reset 后补足相关定义；隐藏意图不得通过 delta/remove/预估/错误泄漏；agent 常规循环每个动作只需一次响应即可继续决策。

补充约束：先从内部状态生成玩家可见投影，再计算快照/差分和 compact 帧；不得先对内部状态差分再临时删隐藏字段。common 中的 HP、能量和饥饿只有一份权威值，战斗帧中的重复数值是只读投影。战斗期间 worldTurn 和 buffs 仍可变化，不能把大地图不显示误解为世界状态冻结。所有同次事务的分区更新原子应用，避免 focus 指向已删除的战斗。

### 14.10 主动完整信息接口与可配置调用间隔

独立接口为 `GET /api/v1/information`，工具名称可映射为 `get_full_information`。它返回当前 revision 下指定 scope 的完整**玩家可见**快照，不是内部 state 或全知模式。scope 可为 current（当前角色/构筑/背包、场景和待选决策）、player、scene、discovered_map，或这些范围的组合；默认 current，明确返回 scope、replaceScopes、snapshotId、revision、decisionTurn、worldTurn 与分页信息。完整已发现地图仍须分页且锁定同一 snapshotId/revision；未公开意图、未知地图、未来随机结果、随机流和完整存档不在任何 scope 内。

建议工具说明直接写明：“优先利用最近动作响应、compact 当前帧和已有缓存；仅在确实缺少信息、需要核对构筑/已知地图或重新整理上下文时主动获取完整信息，避免频繁重复查询。此接口只提供玩家可见信息；通用游戏规则与调用指南见 README。”默认不限频时该提示是节省 token 的建议，不应伪装成硬约束。

配置为 `full_info.min_turn_interval = 0`，只接受非负整数，由宿主配置，玩法 agent 不能修改。0 表示主动完整信息查询不受回合间隔限制；正整数 N 表示两次成功的额外主动快照之间至少推进 N 个 decisionTurn。首次额外主动查询可立即进行；以后以 `decisionTurn - lastFullInfoDecisionTurn >= N` 判断，拒绝时 `retryAfterTurns = N - (decisionTurn - lastFullInfoDecisionTurn)`。相同快照的后续分页/同请求重试是一次查询的延续，不重复计费；不能借旧 snapshotId 拉取新 revision 或新增 scope。新建快照、扩大 scope 都是新的主动查询，共享同一局/控制会话的限频记录，不能换工具、scope、contextId 或新建 HTTP 连接清零。

#### decisionTurn 的精确定义

一次成功提交且实际推进玩法的命令计 1：移动、实际采集、进食、实际产生游戏后果的选择、战斗撤退及 battle.commit 等。battle.commit 即使包含三步或提前胜负也只计 1；全空计划若确实推进敌人/时间/状态，属于真实等待回合，正常计 1。事务内部世界时间推进多次、连锁奖励或动画事件都不额外增加。人工与 agent 的同类玩法提交遵循同一计数。

查询、information、预演、编辑 battle.plan.set、校验错误、被拒请求、重复命令回执、面板/音量/动画操作、保存/导出不计。仅打开/关闭营火选择、取消无后果的弹窗、纯训练入口/退出切换等不推进玩法的操作不计；若训练中的真实结算推进模拟战局，则按一次提交计 1。无操作命令不能通过仅增加 revision、生成事件或更改 UI 来获得回合数。每种命令在引擎中声明是否及何种条件下推进玩法，以实际事务结果和测试确认，不信任客户端上传的 turn 或计数声明。

worldTurn 是游戏内部世界时间，可能随一次命令变动多次，也可能不变；battleStep 是战斗内步数；revision 还可因成功修改计划等业务状态变化而增加。三者均不能替代 decisionTurn。读档从已校验存档恢复 decisionTurn，并由宿主受控切换 epoch；同局重连不重置计数/限频记录。存档不载入可供普通 agent 操纵的“解限凭据”。

#### 恢复豁免与防绕过

首次接入所需基线、真正场景切换时自动附带的目标场景快照、协议断连/同步缺口恢复所需快照不受上述间隔限制，也不消耗主动查询额度。这些是服务端随状态机/同步协议发出的必需数据，不是客户端可自由声明的 request reason。限频记录在 Python 桥接层按当前局保留，HTTP 重新连接或更换 contextId 不产生“首次全量免费”资格；页面真的重新绑定或宿主加载存档时按新身份重建所需基线，不把旧命令带入新代次。

恢复仅覆盖可信协议事实所要求的范围。客户端伪造过期 baseRevision、主动断开连接、提交错误命令或称“上下文遗忘”，最多获得足够继续决策的 compact/当前场景基线；不能由此获得全部已发现地图等额外 scope。对确实需要恢复的 sync 缓存，使用已登记的同步范围与服务端回执/同步游标核验，必要时由宿主确认扩大恢复范围。不可把可见的 INVALID_PHASE、STALE_REVISION 等一般错误一律当成无限全量豁免；STALE_REVISION 可返回最新 compact，而非任意信息全集。

所有可返回等价主动全量快照的别名与参数（包括 observation 的强制 snapshot 模式）必须走同一限频闸门。map/catalog/commands 保留有界、目的明确的查询能力，不提供“换个端点导出整个当前状态”的旁路；动态决策所需数据始终不以限频为由扣留。恢复快照与主动完整查询在响应中明确标记用途及 scope，便于测试和审计。

#### 限频时仍能继续玩

正数配置触发硬限制时，information 返回 HTTP 429、业务码 `FULL_INFO_RATE_LIMITED`、`retryAfterTurns`、当前 `decisionTurn`、`nextAllowedDecisionTurn`，并附最新 compact 必要状态、完整当前选项及可用动作。这里的重试单位是决策回合，不伪造按秒的 Retry-After。拒绝不推进任何计数，也不改上次成功查询时点。

动作响应、紧凑 observation、当前决策所需动态费用/效果、事件正文、奖励选项及合法性提示始终可用；不得让 agent 因缺少当前必要信息而必须先执行盲目动作“刷回合”才能查询。若当前帧不足以决策，属于协议缺陷，应补足该帧或受限的必要恢复快照，不能要求绕过限频。若需查阅的是额外历史地图，则可以明确等待剩余 decisionTurn，但不能把尚未取到的历史覆盖谎报为未知世界。

验收至少包含 N=0 连续调用、N>0 临界值、三步提交计一次、空计划真实等待、重复/错误/编辑计划不计、跨 scope 共享额度、分页锁定版本、改 contextId/重连/伪造恢复不绕过、真实场景切换与断连恢复不受阻，以及限频响应足以继续当前决策。
