# 鸿蒙工具链部署 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在当前开发机上装好可构建、可上真机的 HarmonyOS 工具链,使 `2026-09-24-minimalnote-m1-data-layer.md` 的 B 部分(ArkTS / RDB 存储层)可以执行。

**Architecture:** DevEco Studio 是**一体化的本地安装包** —— HarmonyOS SDK、Node.js、Hvigor(构建工具)、OHPM(包管理器)、模拟器平台全部内置于其中,不需要单独装任何一个。因此本计划只有一条主线:腾出磁盘 → 装 IDE → 诊断 → 配签名 → 上真机。

**Tech Stack:** DevEco Studio / HarmonyOS SDK / Hvigor / OHPM / hdc

---

## ⚠️ 先说清楚:这台机器现在装不了

我在写这份计划前实测了这台机器,结论是**磁盘不够**:

| 项 | 实测值 | 官方要求 / 实际需要 | 判定 |
|---|---|---|---|
| 内存 | 16 GB 总量,**仅 1.9 GB 可用** | 16 GB+ | 勉强达标,但可用量偏低 |
| CPU | i5-12500H,12 核 16 线程 | 无硬性要求 | ✅ 充裕 |
| 虚拟化 | 固件已启用 | 模拟器需要 | ✅ 已开 |
| Hyper-V | **查询失败**(需管理员权限,未能确认) | 模拟器需要 | ❓ 未确认 |
| C: 可用 | 15.4 GB | — | ❌ |
| D: 可用 | 2.9 GB | — | ❌ |
| E: 可用 | 21.7 GB | — | ❌ |
| **合计可用** | **约 40 GB** | **100 GB+** | ❌ **差 60 GB** |
| 已装 DevEco | 全盘扫描后确认:**未安装** | — | — |

**粗略的空间账**(数字为量级估计,实际随版本浮动):

- DevEco Studio 本体:约 3 GB
- 一个 API 版本的 HarmonyOS SDK:约 8–12 GB
- 模拟器镜像(每个):约 10–15 GB
- 构建缓存与 OHPM 依赖:随项目增长,预留 10 GB

**只装 IDE + 一个 SDK ≈ 15 GB;带模拟器 ≈ 30 GB。** 官方建议 100 GB 是把多版本 SDK、多个模拟器镜像、长期构建缓存都算进去的宽裕值。

**因此本计划推荐的路径是:**

> **腾 50 GB+ → 装 IDE + SDK → 跳过模拟器,直接用真机调试。**

跳过模拟器不是妥协,是这台机器上的正确选择:**「极简小记」的两个核心卖点 —— 桌面服务卡片(`FormExtensionAbility`)和代理提醒(`reminderAgentManager`)—— 模拟器本来就验证不了**,必须在真机上测。装了模拟器也只是多占 15 GB。

---

## Task 0: 腾出磁盘空间

**目标:把可用空间从约 40 GB 提到 90 GB 以上。** 这一步没有捷径,只能逐项清。

**Files:** 不涉及仓库文件

- [ ] **Step 1: 先看清空间到底被谁占了**

装一个磁盘可视化工具,不要靠猜:

```powershell
# 用 winget 装 WizTree(极快,直接读 MFT)
winget install -e --id AntibodySoftware.WizTree
```

装好后扫描 C:、D:、E: 三个盘,按大小排序。

Expected: 一份按目录大小排序的清单,前 10 项通常就能解释掉大半空间

- [ ] **Step 2: 关掉休眠,直接回收一个 hiberfil.sys**

休眠文件一般与物理内存等大。这台机器 16 GB 内存 —— 这一条可能直接回收 6 GB 左右。

```powershell
# 需要管理员权限的 PowerShell
powercfg /h off
```

Expected: 执行后 `C:\hiberfil.sys` 消失,`Get-PSDrive C` 的 Free 增加数 GB

> 副作用:失去休眠功能(合盖不再保存内存到磁盘),正常关机与睡眠不受影响。若在意,改用 `powercfg /h /size 40` 把文件压到 40% 内存大小。

- [ ] **Step 3: 清理系统更新残留与旧还原点**

```powershell
# 需要管理员权限
# 先看还原点占了多少
vssadmin list shadowstorage

# 保留最近一个还原点,删掉更早的
vssadmin delete shadows /for=C: /oldest

# 清理 Windows 更新残留(WinSxS 组件库)
Dism.exe /online /Cleanup-Image /StartComponentCleanup /ResetBase
```

Expected: `vssadmin` 列出已删除的还原点;`Dism` 结束时报告操作成功。这两条在长期未清理的机器上合计可回收 5–20 GB

> `/ResetBase` 会让已安装的更新无法卸载。确认不需要回滚更新再执行。

- [ ] **Step 4: 清开发工具缓存**

```powershell
# npm 缓存(纯下载缓存,删了会自动重建)
npm cache clean --force

# 看还有哪些大缓存目录(按大小排序,单位 GB)
'{0}  {1}' -f `
  [math]::Round((Get-ChildItem $env:TEMP -Recurse -File -ErrorAction SilentlyContinue |
    Measure-Object Length -Sum).Sum / 1GB, 2), 'Temp'
'{0}  {1}' -f `
  [math]::Round((Get-ChildItem "$env:APPDATA\npm-cache" -Recurse -File -ErrorAction SilentlyContinue |
    Measure-Object Length -Sum).Sum / 1GB, 2), 'npm-cache'
```

Expected: npm 缓存目录体积归零。`Temp` 目录在长期未清理的机器上常有数 GB,可安全清空

> `du` 是 Unix 工具,PowerShell 里没有 —— 上面用的是 `Measure-Object Length -Sum` 的等价写法。(若你习惯用 Git Bash,`du -sh` 在那里可用。)

- [ ] **Step 5: 用系统磁盘清理收尾**

```powershell
cleanmgr /d C:
```

勾选:Windows 更新清理、临时文件、回收站、缩略图缓存、传递优化文件。

Expected: 对话框显示预计可释放的空间,确认后执行

- [ ] **Step 6: 复核可用空间**

```powershell
Get-PSDrive C,D,E | Select-Object Name,@{n='FreeGB';e={[math]::Round($_.Free/1GB,1)}}
```

Expected: 三盘合计 FreeGB **≥ 90**。若仍不足,回到 Step 1 继续找大户 —— 常见目标还有 WSL 的 `ext4.vhdx`、Docker 镜像、旧虚拟机镜像、Steam 游戏库

> **若腾不出 90 GB**:退一步的可行下限是 **50 GB**(只装 IDE + 一个 SDK,不留模拟器)。低于 50 GB 不建议开始 —— SDK 装到一半失败比不装更麻烦。

- [ ] **Step 7: 确认 Hyper-V 状态(为后续判断模拟器可行性)**

以**管理员身份**打开 PowerShell 后执行:

```powershell
Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All |
  Select-Object FeatureName, State
```

Expected: `State : Enabled` 或 `Disabled` —— 两种都可接受,记录下来即可。模拟器需要它;真机调试不需要

---

## Task 1: 注册华为开发者账号

真机调试和模拟器都需要它,且需**实名认证**。这一步有等待期,先做。

- [ ] **Step 1: 注册账号**

访问 https://developer.huawei.com/consumer/cn/ ,用手机号注册。免费。

- [ ] **Step 2: 完成实名认证**

控制台 → 账号中心 → 实名认证。个人开发者选**个人认证**,需身份证 + 人脸识别。

Expected: 认证状态变为「已认证」。**未实名无法创建调试证书**,这一步不能跳

- [ ] **Step 3: 确认能进 AppGallery Connect**

访问 https://developer.huawei.com/consumer/cn/service/josp/agc/index.html ,用同一账号登录。

Expected: 能看到「我的项目」入口。这是后续申请调试证书和 Profile 的地方

---

## Task 2: 下载 DevEco Studio

- [ ] **Step 1: 打开官方下载页**

https://developer.huawei.com/consumer/cn/download/

- [ ] **Step 2: 选对版本**

| 项 | 选择 |
|---|---|
| 产品 | DevEco Studio |
| 版本 | **最新 Release 版**(我调研时是 DevEco Studio 6.0.2 Release,对应 HarmonyOS 6.0.2 / API 22) |
| 系统 | Windows 64 位 |
| 包类型 | 完整包(不要下增量更新包) |

> **版本号会变。** 以页面当下显示的最新 Release 为准,不要照抄上面的数字。选 Release 而非 Beta —— Beta 版的 `reminderAgentManager` 等 API 行为可能有变。

- [ ] **Step 3: 确认文件完整**

下载完成后核对页面公布的 SHA-256。

```powershell
Get-FileHash -Algorithm SHA256 "$env:USERPROFILE\Downloads\deveco-studio-*.exe"
```

Expected: 哈希值与下载页公布的完全一致。不一致就重新下载,别装

---

## Task 3: 安装 DevEco Studio

**安装路径必须纯 ASCII、无空格、无中文。** 这不是洁癖 —— 构建工具链内部有大量路径拼接,中文或空格路径会在某些环节静默失败,且报错信息通常指向别处,极难排查。

- [ ] **Step 1: 确认安装路径合规**

推荐 `E:\DevEcoStudio`。

**不要用**:`C:\Program Files\...`(有空格)、任何含中文的路径、用户目录下带中文用户名的路径。

> 这台机器的用户目录是 `C:\Users\16276\`,是纯 ASCII,可以用。但为了和项目同盘(E:)且方便管理,仍推荐 `E:\DevEcoStudio`。

- [ ] **Step 2: 运行安装程序**

```powershell
# 用上一步下载的实际文件名替换
& "$env:USERPROFILE\Downloads\deveco-studio-*.exe"
```

安装向导中:

| 页面 | 操作 |
|---|---|
| 安装位置 | 改为 `E:\DevEcoStudio` |
| 组件选择 | 全选(含 Command Line Tools —— 后面要用 `hvigorw`) |
| 创建桌面快捷方式 | 勾选 |
| 环境变量 PATH | **勾选**「Add to PATH」 |

- [ ] **Step 3: 确认安装结果**

```powershell
Test-Path "E:\DevEcoStudio\bin\deveco-studio.exe"
```

Expected: `True`

- [ ] **Step 4: 重新打开 PowerShell,确认 PATH 生效**

```powershell
$env:Path -split ';' | Select-String DevEco
```

Expected: 输出包含 `E:\DevEcoStudio\...` 的路径。若为空,关掉当前终端重开(环境变量改动不作用于已打开的进程)

---

## Task 4: 首次启动与 SDK 安装

- [ ] **Step 1: 启动,不要导入旧设置**

```powershell
Start-Process "E:\DevEcoStudio\bin\deveco-studio.exe"
```

首次启动会问 `Import Settings` / `Do not import settings`。

**选 `Do not import settings`** —— 这台机器没装过 DevEco,任何导入选项都是误选。

- [ ] **Step 2: 接受许可协议并等待 SDK 下载**

向导会提示下载 HarmonyOS SDK。**把 SDK 路径也设到 E:** 例如 `E:\DevEcoStudio\sdk`。

Expected: 下载进度条走完。这一步体积最大(约 8–12 GB),**可能会跑几十分钟**,取决于网速

> 若卡住不动,先检查磁盘剩余空间 —— 空间不足时下载会静默停滞而不是报错。

- [ ] **Step 3: 配国内镜像加速(网络慢时必做)**

`File > Settings > Build, Execution, Deployment > Ohpm` —— 把 registry 指向华为官方源。

`File > Settings > Appearance & Behavior > System Settings > HTTP Proxy` —— 若身处需要代理的网络环境,在此配置;否则选 `No proxy`。

Expected: 后续 OHPM 拉包不再超时

- [ ] **Step 4: 跑官方环境诊断**

`Help > Diagnostic Tools > Diagnose Development Environment`

Expected: 所有检查项显示绿色 ✅。**红色项必须当场解决,不要绕过** —— 最常见的红项是 Node.js 路径与 SDK 路径,都可以在诊断界面里直接点「修复」

- [ ] **Step 5: 确认 SDK 已落地**

```powershell
Get-ChildItem "E:\DevEcoStudio\sdk" -Directory | Select-Object Name
```

Expected: 列出已安装的 API 版本目录(如 `default`、`HarmonyOS-NEXT-DB1` 等,名称随版本而变)

- [ ] **Step 6: 复核磁盘余量**

```powershell
Get-PSDrive C,D,E | Select-Object Name,@{n='FreeGB';e={[math]::Round($_.Free/1GB,1)}}
```

Expected: 合计仍 **≥ 35 GB**。低于此值后续构建会吃力

---

## Task 5: 命令行工具就位

B 部分的计划里有 `hvigorw assembleHap` 这类命令,需要在终端里能直接调用。

- [ ] **Step 1: 找到 hvigorw**

```powershell
Get-ChildItem "E:\DevEcoStudio" -Recurse -Filter "hvigorw*" -ErrorAction SilentlyContinue |
  Select-Object -First 5 FullName
```

Expected: 找到 `hvigorw.bat` 与其所在目录,通常在 `E:\DevEcoStudio\tools\hvigor\bin\`

> 注意:`hvigorw` 通常是**在项目目录下执行**的(工程内会有 `hvigorw` 脚本),IDE 生成的工程自带。全局那份是兜底。

- [ ] **Step 2: 把工具目录加入 PATH**

```powershell
# 需要管理员权限;把 <hvigor-bin> 换成上一步找到的真实目录
[Environment]::SetEnvironmentVariable(
  'Path',
  [Environment]::GetEnvironmentVariable('Path','Machine') + ';<hvigor-bin>',
  'Machine'
)
```

- [ ] **Step 3: 重开终端验证**

```powershell
hvigorw --version
ohpm --version
hdc -v
```

Expected: 三条命令各自打印版本号。任何一条报「无法识别」,回到 Step 2 检查路径

| 工具 | 作用 |
|---|---|
| `hvigorw` | 构建:HAP / HAR 打包 |
| `ohpm` | 鸿蒙包管理器(等价于 npm) |
| `hdc` | 设备连接与调试(等价于 adb) |

---

## Task 6: 真机调试签名(推荐路径)

**推荐直接走这条,跳过模拟器。** 服务卡片与代理提醒只有真机能验证。

签名有一套固定流程:`本地生成密钥 → 导出 CSR → 在 AGC 换回证书和 Profile → 配进工程`。调试证书与发布证书不通用(调试证书不能发布,发布证书不能调试),M1 只需要调试证书。

- [ ] **Step 1: 手机开启开发者模式**

手机 `设置 > 关于本机 > 连续点击「版本号」7 次` → 返回 `设置 > 系统和更新 > 开发人员选项` → 打开 **USB 调试**。

Expected: 开发者选项菜单出现

- [ ] **Step 2: 在 DevEco 里生成密钥与 CSR**

`File > Project Structure > Signing Configs` → 勾选 `Automatically generate signature` 前,**先手动走一遍**:

`Build > Generate Key and CSR` → 新建密钥库:

| 字段 | 值 |
|---|---|
| Key store file | `E:\keys\minimalnote.p12`(**务必记住此路径与两个密码**) |
| Key alias | `minimalnote` |
| Validity | 25 年(默认) |

继续向导,生成 `.csr` 文件,存到 `E:\keys\`。

Expected: `E:\keys\` 下出现 `minimalnote.p12` 与 `minimalnote.csr`

> **`E:\keys\` 不要放在仓库目录内。** `.gitignore` 排除了 `*.hap` 但没排除 `*.p12` —— 密钥库泄漏等于他人可以签名你的应用。建议连同后面的 `.p7b` 一起放到仓库之外。

- [ ] **Step 3: 在 AGC 申请调试证书**

AppGallery Connect → 用户与访问 → 证书管理 → **新增证书** → 类型选「调试证书」→ 上传 `minimalnote.csr`。

Expected: 下载得到 `minimalnote-debug.cer`

- [ ] **Step 4: 在 AGC 创建应用并申请调试 Profile**

AGC → 我的项目 → 新建项目 → 添加应用:

| 字段 | 值 |
|---|---|
| 应用包名 | `com.choppeer6.minimalnote`(必须与 DevEco 工程的 Bundle name 完全一致) |
| 应用类型 | App |

然后:证书、Profile 与 App 管理 → Profile 管理 → **添加 Profile** → 类型选「调试」→ 绑定上一步的证书 → **绑定调试设备**(需先在「设备管理」里用手机的 UDID 注册)。

> 手机 UDID 获取:开发者选项里通常有入口,或用 `hdc shell bm get --udid`。

Expected: 下载得到 `minimalnote-debug.p7b`

- [ ] **Step 5: 配进工程**

DevEco → `File > Project Structure > Signing Configs` → 取消 `Automatically generate signature`,手动填入:

| 字段 | 值 |
|---|---|
| Store file | `E:\keys\minimalnote.p12` |
| Store password | 你设的密码 |
| Key alias | `minimalnote` |
| Key password | 你设的密码 |
| Profile file | `E:\keys\minimalnote-debug.p7b` |
| Certpath file | `E:\keys\minimalnote-debug.cer` |

Expected: 对话框下方不再有红色告警

- [ ] **Step 6: 连真机验证**

用 USB 线连手机,手机弹出「是否允许 USB 调试」→ 允许。

```powershell
hdc list targets
```

Expected: 打印出设备序列号。**这一步通了,就说明整条链路打通了** —— 后面可以回去执行 M1 的 B 部分

---

## Task 7: 模拟器(可选,本机建议跳过)

**只有在腾出 90 GB 以上、且需要在没有真机时写 UI 才做这一步。**

- [ ] **Step 1: 确认 Hyper-V 已启用**

回到 Task 0 Step 7 的记录。若为 `Disabled`,以管理员权限执行:

```powershell
Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All -All
```

然后**重启电脑**。

Expected: 重启后 `Get-WindowsOptionalFeature` 显示 `Enabled`

- [ ] **Step 2: 通过 Device Manager 下载镜像**

`Tools > Device Manager` → `Local Emulator` → `Install`。

需要华为账号授权。**首次申请通常需要约 8 小时生效** —— 不是卡住了,是审批队列。

Expected: 授权状态变为已授权;然后可下载模拟器镜像(约 10–15 GB/个)

- [ ] **Step 3: 创建并启动模拟器**

选中一个 Phone 类型的镜像 → `Next` → 命名 → 启动。

Expected: 模拟器窗口打开,显示鸿蒙桌面

> **别忘了它验证不了什么**:桌面服务卡片、代理提醒、语音识别(需真实麦克风)、图片选择器。这四项恰好覆盖了「极简小记」的功能 1、3、2b、2c。

---

## 完成标准

- [ ] 三盘合计可用空间 ≥ 35 GB(装完后)
- [ ] `E:\DevEcoStudio\bin\deveco-studio.exe` 存在
- [ ] `Help > Diagnostic Tools > Diagnose Development Environment` 全绿
- [ ] `hvigorw --version`、`ohpm --version`、`hdc -v` 三条命令均可执行
- [ ] `hdc list targets` 能列出手上的真机
- [ ] **下一步:回到 `2026-09-24-minimalnote-m1-data-layer.md` 执行 Task 6 起的 B 部分**

## 风险与坑

| 风险 | 表现 | 应对 |
|---|---|---|
| 磁盘不足 | SDK 下载中途静默停滞,不报错 | 提前腾到 90 GB;下载时开着资源管理器盯剩余空间 |
| 安装路径含中文或空格 | 构建报错指向别处,极难定位 | 严格用 `E:\DevEcoStudio`,项目路径同样保持纯 ASCII |
| 包名不一致 | 真机安装失败,提示签名与包名不匹配 | AGC 里的包名与工程的 Bundle name 必须逐字符相同 |
| 忘掉密钥库密码 | `.p12` 无法再用于签名,只能重新申请证书 | `E:\keys\` 的路径与两个密码记到密码管理器里 |
| 模拟器授权等待 | 点 Install 后长时间无响应 | 属正常审批流程,约 8 小时;且真机路径不依赖它 |
| 内存吃紧 | IDE + 构建 + 浏览器同时开时卡顿 | 这台机器 16 GB 且可用量低;构建时关掉不必要的大内存应用 |

## 本计划不含

- 鸿蒙应用本身的开发步骤 —— 见 `2026-09-24-minimalnote-m1-data-layer.md`
- 服务卡片与代理提醒的实现 —— 属 M5 / M4
- 发布上架流程(需发布证书,与调试证书是两套)
