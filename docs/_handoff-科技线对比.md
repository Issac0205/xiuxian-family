# 科技线对比实验 · 交接记录

> 生成时间：2026-10-11
> 来源：会话 `43fcbfee-557e-4c67-bc7a-2e86f2ad878b`（GUI 侧栏显示「7 小时」）在长任务中被暂停时的现场分析。
> 目的：让「科技线值不值」这个问题**不必再重跑一次 7 小时**。

---

## 1. 结论先行：7 小时换到了什么

| | 结果 |
|---|---|
| **结论数据** | ❌ 几乎没有。6 个对照文件里只剩 2 个，且是**更早一次运行**的产物 |
| **可复用的东西** | ✅ 根因、精确耗时标定、6 路并行跑法、必须避开的编码坑（本文档） |

`docs/` 下产物现状：

- ✅ `_a-farm.txt`、`_a-trade.txt`（23.2 KB，15:53）——**不是**那次 7 小时运行的产物
- ❌ `_a-greedy.txt` —— 缺失
- ❌ `_b-*.txt`（改后组）—— 全部缺失

**实验矩阵是 3 策略 × 2 组别 = 6 组**，缺的正好包含全部「改后」组，因此**现在无法回答「科技线值不值」**。

---

## 2. 根因：为什么跑了 7 小时还没结果

按重要性排序，三个原因叠加：

### (1) 参数太大 —— 主因

`techcompare.mjs` 是**串行**跑多组模拟，耗时随 `HOURS` 线性增长。实测标定：

| HOURS | 实测耗时 | 推算 6 组串行总耗时 |
|---|---|---|
| 1 | **11.3 秒** | ~1 分钟 |
| 40 | **>150 秒仍未完成**（烧 158.7s CPU） | **约 2.5～5 小时** |

即约 **4 秒 / 游戏小时 / 组**。传 `40` 本身就需要数小时，这不是死循环，是**算得慢**。

### (2) 管道缓冲 —— 让它"看起来像卡死"

原来的调用是：

```powershell
node scripts/techcompare.mjs 40 2>&1 | Select-Object -Last 20
```

`Select-Object` 会缓冲，**进程结束前一行都拿不到**；配合 DSH 的 `run_in_background` + `job_output(wait, timeout_ms)`，超时后表现为「无输出 / exit code 1」。日志里连续多次 `job_output` 返回 `(no new output)` 就是这个现象。

### (3) 中文编码 —— 把已经算出来的结果毁了

早期并行版用了 `Out-File -Encoding utf8`，造成 **UTF-8 → UTF-16 → UTF-8 双编码**，产物出现 `鈺愨晲`、`\u0000` 乱码且 overview 段缺失。发现后该会话用 `Remove-Item docs\_b-*.txt, docs\_a-*.txt` **把全部产物删掉重跑**，于是彻底归零。

**避坑**：

- 写文件用 `Set-Content -Encoding utf8` 或 Node 的 `fs.writeFileSync`（UTF-8 原生）；**绝不要用 `Out-File -Encoding utf8`**。
- 读文件用 `[System.IO.File]::ReadAllText()`；PS 5.1 的 `Get-Content` 按 ANSI 读 UTF-8 会显示成乱码。
- **`.ps1` 必须存为 UTF-8 带 BOM**（`ef bb bf`）。PS 5.1 按 ANSI 读无 BOM 的 UTF-8 会把中文字符串拆坏并报「意外的标记」——本次实测踩到。`.mjs` 相反，不需要 BOM。

### (4) 附带发现：停止进程会留下孤儿 node

用 `Stop-Process` 停 `powershell.exe` wrapper 时，**node 子进程不会被带走**，会变成孤儿继续吃 CPU（本次先后抓到 PID 4268、13220、7640 三个孤儿）。停任务时必须连 node 一起杀：

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'techcompare' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

---

## 3. 恢复方案：拿到完整 6/6

### 方案 A（推荐）：6 路并行 —— 已实测跑通

`techcompare.mjs` 的**当前接口**（该脚本在长任务期间被迭代过，以下为实测确认的协议）：

```
node scripts/techcompare.mjs [HOURS=40] [STRATEGY] [before|after]
```

- `STRATEGY` 省略 → 跑 `greedy,trade,farm` 三条；指定 → 只跑那条
- `MODE` 省略 → 改前改后都跑；`before` / `after` → 只跑其一
- **逐行打印**：每个策略算完一行立刻输出，进程被时限掐掉也留下已有结果 ← 这正是原来那次 7 小时最缺的性质
- `before` / `after` 单独跑**都不会崩**（末尾差额段有守卫，缺一侧时自动跳过）

配套运行器 `scripts/techcompare-parallel.ps1`：把 **3 策略 × 2 组别 = 6 组拆成 6 个独立进程**，每个只算自己那一组，无重复劳动；输出用 `-RedirectStandardOutput` 直接落文件。

```powershell
cd D:\harness\xiuxian-qi
# 本机执行策略禁止直接 & .\x.ps1（未签名），必须带 Bypass：
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\techcompare-parallel.ps1 -Hours 20
# 想前台等待并看到每组产出：加 -Wait
```

**实测结果**（`HOURS=1`）：6 个进程全部产出 `docs\_a-<策略>.txt`（改前）与 `docs\_b-<策略>.txt`（改后），**6/6 成功**、内容正确、中文零乱码，墙钟 8 秒。`HOURS=20` 时墙钟约几分钟，而非串行的十几分钟以上。

### 方案 B：不等仿真，先要"够用"的结论

```powershell
node scripts/techcompare.mjs 12            # 三条策略都跑，约几分钟
node scripts/techcompare.mjs 12 greedy     # 只跑一条，更快
```

`HOURS=12` 已足够看出「改前 vs 改后」的差值方向（科技数 / 灵石 / 卡点数），只是不如 40 小时贴近长局尾盘。

### 方案 C：要完整报告

```powershell
node scripts/balance.mjs      # 含境界驻留条形图、里程频、卡点明细，每次几分钟
```

`techcompare.mjs` 存在的意义就是**跳过 balance.mjs 的格式化开销**，只取能回答「值不值」的那几个数。

---

## 4. 脚本事实速查

| 文件 | 作用 | 关键协议 |
|---|---|---|
| `scripts/techcompare.mjs` | 紧凑对比表 | `node techcompare.mjs [HOURS] [STRATEGY] [before\|after]`；逐行打印 |
| `scripts/techcompare-parallel.ps1` | 6 路并行封装 | `-Hours N [-Wait]`；产物 `docs\_a-*.txt` / `docs\_b-*.txt` |
| `scripts/balance.mjs` | 完整报告 | 被 import 安全（`import.meta.main` 守卫）；直接跑则触发整轮 90 小时仿真 |
| `scripts/diagnose.mjs` | 诊断 | 复用 balance 核心 |
| `scripts/smoke.mjs` | 584 项自动化断言 | 改完必跑 |

`balance.mjs` 的导出面（可复用，别在 import 时白跑）：

```js
export { boot, run, auditTechs, auditBuildings, auditRealms, auditSilver };
export { B };                 // 活绑：boot() 之后才是桥对象
export const SIM = { run, boot, get bridge() { return B; } };
```

对照组原理：`immortal: false` 时 AI 不研习仙道科技，于是连城坊建筑也解锁不了——剩下的是「旧世界 + 新的凡人树」；与改后之差即仙道线的净贡献。（早期版本用环境变量 `XIUXIAN_NO_IMMORTAL=1`，已被 `immortal` 选项取代。）

---

## 5. 未提交的工作成果（务必别丢）

暂停时工作区有 **23 个已修改 + 11 个未跟踪文件，合计 +4119 / −392 行**未提交。最近一次提交：

```
a76493a feat(工具): 平衡仿真器 + __xiuxian.tick 无头推进出口
```

**建议**：在重跑长任务前先提交或建检查点分支——仿真的中间数据丢了可以重算，这几千行代码丢了才是真损失。
