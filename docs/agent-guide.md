# Agent 操作指南

先读 [README 通用规则](../README.md)。本 API 不是全知环境；通用规则存在文档中，游戏响应负责当下数据、选项、费用与结果。HTTP 在同一台运行游戏的机器上调用，不使用 MCP。

## 1. 启动、认证与控制权

```sh
uv run graymarch
# 可选：
uv run graymarch --no-browser --port 8765 --config config.example.toml
```

默认地址严格为 `http://127.0.0.1:8765`，不要改用 `localhost`；Host 和 Origin 必须匹配启动配置。端口冲突会明确失败，不会偷偷连接其他游戏。每个实例只绑定一个主页面，第二个页面不能抢占。

启动后自动打开一次性配对页面。使用 `--no-browser` 时，由玩家在本机打开 `.runtime/open-game.html` 并点击链接，五分钟内有效；过期重新启动。这个文件是凭据，不分享、不入库。页面成功连接后 `status.ready=true`。

外部 agent 使用 `.runtime/agent-token` 中的 Bearer token。令牌每次启动重新生成；暂停人工接管只阻止动作、不轮换令牌，再次开启 agent 时仍使用同一进程的令牌。令牌只能在本机读取使用，不写入文档、日志或命令仓库。游戏启动默认 `agent` 模式；页面资源与局外成长加载完成、桥接 ready 后即可提交动作。恢复人工模式会拒绝新 agent 动作；已受理动作可能完成，应先确认结果再人工操作。

最小读取示例（在项目根目录）：

```sh
BASE=http://127.0.0.1:8765
TOKEN=$(cat .runtime/agent-token)
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/status"
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/observation"
```

页面通过主人 Cookie 调用管理端点，agent token 不能替代主人权限：

- `POST /api/owner/control`，`{"mode":"human"}` 或 `{"mode":"agent"}`
- `POST /api/v1/saves/manual`：保存到固定 `saves/manual.json`
- `POST /api/v1/saves/manual/load`：读取固定文件，先暂停两端 agent；成功后自动恢复 agent，失败则保留原旅程和人工模式

管理端点要求同源 Origin 和页面登录态，不接受任意文件路径。普通玩法 agent 不应通过浏览器凭据绕过角色限制。

## 2. 推荐循环

### 常用命令工具

项目根目录的 `./gm` 是 [tools/agent/](../tools/agent/) 的短入口，内部使用 uv。每条命令完成一项明确操作，不提供自动决策或常驻会话：

```sh
./gm status
./gm observe
./gm observe --scope scene
./gm observe --scope build
./gm observe --scope inventory
./gm observe --scope map
./gm move west
./gm move east 5
./gm harvest
./gm eat roots
./gm camp
./gm choose OPTION_ID
./gm cancel
./gm preview basic_guard basic_attack wait
./gm plan basic_guard basic_attack wait
./gm fight basic_guard basic_attack wait
./gm train start
./gm train exit
./gm command COMMAND_ID
./gm information --scope player,scene
./gm map --limit 100
./gm catalog
./gm act world.move '{"direction":"west"}'
```

`preview` / `plan` / `fight` 恰好接收三槽，`wait` 转为 null。选项传当前 `optionId`；客户端补当前 `decisionId`，战斗操作补当前 `battleId` / `batchId`。地图后续页使用 `--snapshot-id` 和 `--cursor` 原样传入服务端返回值。通用 `act` 仍负责填写请求身份和版本，不需要手写请求外壳。

`move DIRECTION [STEPS]` 支持同方向连续移动，默认一格；Python 对应 `client.move("east", 5)`。连续移动仍逐格执行语义命令，只有首次需要查询基线，其余复用动作响应。到达战斗/事件/升级选择就停；下一格不可走、异常回城/移位、请求 pending/unknown 或被拒时也停止，已完成的移动不会回滚。沿途营火、聚落、遗迹按原规则处理，不自动进食、采集或选项决策。默认只报告整段净变化和 `movement`（requested、moved、stop）；stop=completed 表示走满，blocked 表示前方不可走，其他值说明中断阶段或错误。没有为多步移动新增游戏 API；`--raw` 输出最后一条回执及移动统计。

动作默认返回紧凑 JSON：`status`、`revision`、`changes`。工具比较本次提交前后的观察，值为结算后的绝对值，不是需再累加的差额。嵌套字段只列变动项，清除项为 null，数组变化时整体替换。玩家只报告决策相关属性；零库存仅在数量实际变为零时报告，不把战斗帧省略背包误认为物品清空。伤害计数和前一行动只在已有构筑需要它们时出现。

成功动作的原始回执在库存实际变化时附 `inventoryChanges`，只列变化物品的结算后数量（含归零）。工具将它并入 `changes.player.inventory`，因此采集后立即遇袭也会报告收获，例如 `{"berries":2}` 表示现有两份黑莓。战斗 compact 帧仍省略完整背包；重复回执中的数量仍是绝对值，不再累加。

下一步必需的新上下文直接随动作返回：`changes.world` 包含周边地形/动态费用、采集/营火机会和导航的变化，邻居用方向作键，坐标由当前位置推导，cost=null 表示不可通行。进入战斗带敌人数值、锁定三步、封印槽和技能能耗；同场后续只列变化，隐藏意图仅显示 hidden=true。选项出现或轮次更新带可选项 ID、说明和效果；不可用选项保留标签与原因，省略不可使用的配方效果。新增/升级的技能、被动、装备，以及新获得的食物才附相关定义。战斗结束仅报告本次 outcome，真实胜利加 grade，新永久解锁列入 unlocks；选项结束用 `choice: closed`。不重复输出稳定定义、整份观察、事件和旧战报。pending、unknown 和错误保留 commandId 及恢复信息。多步途中经过的营火、聚落、遗迹以 movement.sites 简记坐标、地形和是否已使用，避免省略终点之前的补给机会。

需要补充信息时使用查询命令：`observe` 默认输出角色及当前决策；`--scope scene` 只给周边/战斗/选项，`--scope build` 给构筑定义，`--scope inventory` 只给非零库存，`--scope player` 给角色属性，`--scope map` 只给当前中心半径 3 范围内的已发现地图（scope=local，不代表全局地图）。player/inventory 使用主动完整玩家查询，局部 map 使用主动场景查询，因此受宿主 full_info 限频约束。其他查询省略协议/身份字符串、零库存、地图正文和旧战报；`information --scope scene` 也使用相同精简场景视图。catalog 仅列定义及未在定义中重复的基础动作；preview 保留 partial/blockedAt、预测数值和实际覆盖的逐步结果，省略敌人美术与重复规则资料。

`map` 默认返回 `tiles` 紧凑行，columns 指定各列含义（position、terrain、cost、flags）；flags 的 v/s/h/c 分别表示已到访、已使用、已采集、已清理，空字符串表示均未发生。敌人资料单列为按坐标索引的 enemies；revision、snapshotId、total、hasMore、cursor 保留，未出现在当前页的地块不代表未发现。`command` 默认只显示命令状态和版本。共享客户端内部仍保存完整观察；这些显示简报不是原始 observation/sync delta。`--raw` 获取完整原始响应，适合精确协议字段或完整战报。公共参数可放在子命令前后：`--url`、`--token-file`、`--raw`、`--wait-timeout 30`。

独立动作先观察一次。pending 或提交超时只查询本次原 commandId；`BUSY_PRESENTATION` 等待后核对身份、版本、场景和选择/战斗批次，仍一致才以新 commandId 重试。等待期间状态变化、控制权丢失或结果 unknown 时停止，不重放动作。预算耗尽后保留 commandId；退出码 0 为成功、1 为错误/拒绝、2 为未确认（pending/unknown）。工具不请求主人 Cookie，不切换控制权、不保存或读取游戏存档。

脚本通过 `from tools.agent import GraymarchClient` 导入共享客户端。常用动作方法（例如 `move("west")`、`fight(["basic_guard", "basic_attack", None])`）和 `execute(type, payload)` 自动建立观察并等待自己的回执。低层 `act(type, payload)` 保持原行为：需要先 `observe()`，只提交一次，调用者自行处理 pending。客户端不写磁盘缓存；跨页面/旅程/epoch 清理旧定义，历史回执不能回退当前观察。

### 直接使用 API

1. 读 status，确认 connected、ready、controlMode；默认应为 agent；若玩家已人工接管，就等待其交回控制权，不替玩家切换。
2. 读默认 compact observation。记录 `sessionId`、`runId`、`epoch`、`revision`、`scene`、`phase`。
3. 按当前 phase 决策：世界移动/采集/补给，战斗规划/预演，选择阶段处理当前选项。
4. 每次生成全新的 `commandId`，带观察时的身份与 `expectedRevision` 提交一个动作。不要并发提交。
5. 成功时直接使用响应中的下一帧；无需每步再读 information。
6. 返回 pending/发生网络超时时，用原 commandId 查回执；确定结果前不要换 ID 重做。
7. 如果身份或场景变化，立即废弃旧场景的计划、选项与焦点。版本不一致先重读 compact，再重新决策。

以下为请求外壳示例，身份值须替换为当前观察值，不能照抄：

```json
{
  "sessionId":"从观察复制",
  "runId":"从观察复制",
  "epoch":1,
  "commandId":"本次唯一UUID",
  "expectedRevision":12,
  "type":"world.move",
  "payload":{"direction":"north"}
}
```

用 `POST /api/v1/actions` 和 `Content-Type: application/json` 发送。响应 `status=completed` 表示已完成；HTTP 202 / `status=pending` 表示已受理尚待结果；`rejected` 是明确拒绝，`unknown` 不是失败证明。不要只看 HTTP 200 而忽略业务状态。

## 3. 场景、版本与计数

- `sessionId`：页面运行身份；`runId`：旅程；`epoch`：读档等受控替换的代次。三者任何一个变化都要重建当前基线。
- `revision`：成功业务提交版本。查询与预演不推进；计划编辑可推进。
- `decisionTurn`：真正推进游戏的一次成功决策计 1。三步战斗提交计 1，不是 3；全空计划推进敌人/状态也计 1。进食、有效选择、移动、采集计 1。
- `worldTurn`：游戏世界时间。一次三步战斗可能推进多次；训练不推进真实世界时间。它不是 API 限频计数。
- `scene.kind` 为 world/battle；`scene.id` 区分不同战斗。`phase` 才决定当前能做什么，UI 页签不是游戏状态。
- `choice.pending` 必须使用当前 `decisionId` 与选项的 `optionId`。相同名称的下一轮奖励也有新身份，不复用旧选项。
- 战斗计划编辑与提交的 payload 必须带当前 `battleId`、`batchId`（来自 `observation.battle`）。下一组三步即使敌人相同，也不能提交旧批次计划。

常见路径：world.ready → battle.planning → world中的choice.pending（升级）→ world.ready。Boss 胜利先显示胜利选择，再处理升级。不能假设所有选择结束后都回战斗。

## 4. 语义动作

所有参数只使用当前帧给出的 ID 和合法动作。下表为当前实现字段，身份与 expectedRevision 放请求顶层，表中的业务字段放 payload 内。

| type | payload 核心字段 | 注意 |
|---|---|---|
| world.move | direction: north/south/east/west | 只走一格；北 y−1，东 x+1 |
| world.harvest | {} | 当前格可采、未采；失败也耗机会 |
| inventory.eat | itemId | 当前持有，非战斗 |
| camp.open | {} | 当前未使用营火 |
| choice.select | decisionId, optionId | 只能当前明确可选的选项 |
| choice.cancel | decisionId | 仅显式允许取消的选择 |
| battle.plan.set | battleId, batchId, plan | 三槽技能 ID 或 null；只编辑，不执行 |
| battle.commit | battleId, batchId, plan | 三槽原子提交；不依赖先 plan.set |
| training.start | {} | 世界阶段进入训练 |
| training.exit | {} | 恢复训练前状态 |

主动撤退暂时禁用：`battle.retreat` 不在合法动作中，提交返回 `INVALID_PHASE`。真实战斗需结算胜败；`training.exit` 仅用于训练。

战斗计划使用 `basic_attack`、`basic_guard` 和已拥有主动技能 ID，不能传中文名、技能等级、伤害或敌人动作。封印槽传 null。技能效果及冷却长度见返回的技能描述；`player.cooldowns` 仅列仍在冷却的技能及剩余步数，跨批次延续。可预演 `POST /api/v1/preview`，请求正文为 `{ "expectedRevision": 当前版本, "battleId": 当前战斗ID, "batchId": 当前批次ID, "plan": ["basic_guard", "basic_attack", null] }`。只读预演不消耗能量、随机流、奖励或时间。实际返回 `partial`、`blockedAt`、`steps`、`outcome` 及公开可推演的结果。`partial=true` 时，只信任已覆盖步骤，不把缺失部分当作安全。当前步骤若能量不足或技能仍在冷却，技能失败但敌人仍行动；先看逐步预演，不能只验证计划结构。

## 5. compact、sync 与主动完整信息

### compact：默认推荐

`GET /api/v1/observation?format=compact` 是独立当前决策帧，提供身份、当前场景、角色关键值、动态费用、必要构筑、意图或完整选择。保持最新帧即可，不要求模型手工累加伤害。

不要将“没在本帧传入的旧地图”误认为“从未发现”。地图响应的 scope、coverage、hasMore 定义了覆盖范围。需要其他已知地点时查询 map，而不是读内部存档。

### sync：给可靠的程序缓存

`GET /api/v1/observation?format=sync&baseRevision=...` 用于缓存同步。客户端必须验证身份、版本、baseRevision 与 scope；不匹配时要求当前基线，不硬套 delta。

- 快照只替换明确声明的 scopes，不清空全张历史地图。
- 当前实现使用粗粒度 `set`：如 player/world/battle/pendingDecision，整块替换为新公开记录。没有实现设计稿的逐实体 upsert/remove 协议。
- delta 的数值是绝对结果值，不是再减一次的变化量。set 仅替换列出的块，省略块保持不变，null 明确清空。
- 数组三步意图、计划与选项整体替换，不按下标拼旧内容。
- events 是已经发生的事实，只用于解释，不再据此扣 HP。
- 重复或乱序包不得回退缓存。拿到历史命令回执可确认执行，但不能覆盖更新的当前帧。
- 无法构成可靠增量时可以收到新快照。不要假设 sync 每次必然返回 delta。

### information：按需主动查询

`GET /api/v1/information?scope=current` 返回当前 revision 的完整玩家可见快照，不是全知模式。scope 用于当前角色/构筑/背包与场景；还支持 `player`、`scene`、`discovered_map`，可用逗号组合，例如 `scope=player,scene`。`current` 的实际帧位于响应的 `current` 字段。已发现大地图分页，后续页沿用同一 snapshotId、scope 和 revision；版本变化就重新查询，不能拼接不同时间的页。

优先复用最新动作响应和 compact 帧；需要核对构筑、已知地图或重新整理上下文才主动查询。默认 `full_info.min_turn_interval=0`，连续查询允许，节约 token 是建议，不是隐含限制。

```toml
[full_info]
min_turn_interval = 0
```

正整数 N 要求两次成功主动新快照之间至少推进 N 个 decisionTurn。跨 scope 共享限频；同快照的合法后续页不重复计数。查询、预演、计划编辑、错误、重复回执、无后果开关选择、保存和纯训练入口/退出不能刷回合。

限频返回 HTTP 429 / `FULL_INFO_RATE_LIMITED`，带 `retryAfterTurns`、`decisionTurn`、`nextAllowedDecisionTurn` 和最新 compact；单位是决策回合，不是秒。必要当前帧始终可取，不要求盲目行动解限。换 contextId、HTTP 连接或伪造旧版本不能获得无限全图恢复。

### 信息边界

只能观察人类玩家可见信息：已发现地图、公开敌人资料、自己构筑与背包、当前公开意图、实际事件与奖励。隐藏意图不含真实 ID/伤害/哈希；未来随机结果、RNG 内部状态和存档不公开。未知意图被交换后，未知身份随之移动。不要靠错误提示或 preview 推断本不该公开的数据。

## 6. 错误恢复

| 错误/状态 | 应对 |
|---|---|
| UNAUTHORIZED | 核对当前启动的 token 文件；不猜令牌、不打印令牌 |
| CONTROLLER_REQUIRED | 玩家当前未给 agent 控制权，停止提交并等待 |
| GAME_DISCONNECTED / ready=false | 主页面未连接/关闭；等待玩家恢复，再检查身份 |
| STALE_REVISION | 获取最新 compact，重新判断，使用新 commandId |
| SESSION_EXPIRED | 旧局/页面命令；丢弃旧计划，重建基线 |
| 场景/批次/decisionId 不匹配 | 重新读当前场景，不把旧动作强塞到新场景 |
| BUSY_COMMAND | 查询现有活动 commandId，等它结束 |
| BUSY_PRESENTATION | 战斗动画尚未结束；按 details.retryAfterMs 等待后重读，以新 commandId 提交，不并发抢跑 |
| pending / 请求超时 | 查询同一 commandId；不要新 ID 重复执行 |
| unknown / RESULT_UNKNOWN | 结果不确定；重读当前身份和状态，必要时请玩家确认；禁止盲重放 |
| IDEMPOTENCY_CONFLICT | 同一 commandId 用了不同正文；修正客户端，不复用 ID |
| INVALID_REQUEST / 不合法动作 | 修正请求或改选合法动作；无效请求不推进游戏 |
| SNAPSHOT_EXPIRED | 丢弃未完成分页，重取同范围快照 |
| FULL_INFO_RATE_LIMITED | 用附带 compact 继续有依据的决策；不要刷无效动作 |
| SAVE_INVALID / SAVE_FAILED | 告知玩家未成功读/写；不覆盖或篡改源存档 |

同一 commandId 重试必须保持原请求正文完全一致（包括 expectedRevision）；新策略才生成新 ID。服务重启后历史回执可能不可用，因此未知结果必须依据现局状态处理，不能当成幂等保证永久存在。

## 7. 当前实现与历史设计

[设计稿 v3](agent-api-design.md) 保留原文以解释目标，其中的模块拆分、协议 Schema、性能测试、仓库发布和完整验收均不能直接当作已完成清单。README 和代码反映实际交付。所有存档均为新格式，旧 `version=31` JSON 与浏览器 localStorage 不迁移、不导入。

当前实现 sync 使用整块 set，catalog 返回当前相关定义与行动，而不是全内容百科。未缓存的旧版本或场景切换返回当前快照。map 支持 `limit`（默认100、最大200）、`cursor` 与 `snapshotId`；先读第一页，再原样沿用返回的 snapshotId/cursor。长篇静态全内容见 reference.md。设计稿的客户端定义去重、token基准测试等不应视为已经实现。
