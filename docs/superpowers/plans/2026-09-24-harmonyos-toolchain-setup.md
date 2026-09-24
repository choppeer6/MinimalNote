# 鸿蒙工具链部署 Implementation Plan(命令行版)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在当前开发机上装好可构建、可上真机的 HarmonyOS 工具链,使 `2026-09-24-minimalnote-m1-data-layer.md` 的 B 部分(ArkTS / RDB 存储层)可以执行。

**Architecture:** Huawei 提供**独立的 Command Line Tools** —— 不依赖 DevEco Studio IDE,内嵌完整 HarmonyOS SDK(含 hvigorw 构建、ohpm 包管理、hdc 设备连接)。下载 2.3 GB,解压后约 10 GB,其中工具本体仅约 100 MB,**体积几乎全部是 SDK**。因此本计划的主线是:装 JDK 17 → 解压命令行工具 → 配环境变量 → 配签名 → 上真机。

**Tech Stack:** HarmonyOS Command Line Tools / JDK 17 / hvigorw / OHPM / hdc

---

## 版本说明:本计划替代了此前的 IDE 版

本文件此前写的是「装 DevEco Studio IDE」,并断言这台机器磁盘不够、需要先腾 50 GB。**那个结论是错的。**

100 GB 是华为官方文档的**推荐配置**,里面含大量编译临时文件的余量,不是准入门槛。实测数字:

| 项 | 官方推荐 | 实测 |
|---|---|---|
| 磁盘可用 | 100 GB | **10–12 GB** |
| DevEco Studio 5.0.3 核心安装 | — | 11.7 GB(Mac 实测,含 SDK) |
| Command Line Tools 安装包 | — | 2.3 GB |
| ↑ 解压后 | — | **约 10 GB** |
| 模拟器镜像 | — | 3–4 GB/个 |

这台机器三盘合计可用约 40 GB(E: 21.7 GB)。**装得下,不需要大规模腾空间。**

因此本计划改为命令行路线,省掉 IDE 的 2.6 GB 安装包与解压、以及模拟器镜像。

### 命令行路线的代价(事先说清)

省下 10 GB 磁盘和 IDE 的内存开销,但要付出这些:

1. **没有工程创建向导。** IDE 的 New Project 会生成一整套脚手架(`build-profile.json5`、`hvigorfile.ts`、`oh-package.json5`、`module.json5`、`EntryAbility.ets` …)。命令行路线要手写或从官方示例工程拷贝。见 Task 7。
2. **没有代码补全、没有实时预览、没有可视化签名配置。** 改签名要直接编辑 `build-profile.json5`。
3. **没有本地模拟器。** 模拟器由 IDE 的 Device Manager 管理,命令行路线不带它。替代品是真机或云真机(Task 5)。
4. **没有环境诊断面板。** IDE 的 `Diagnose Development Environment` 会自动查环境,命令行路线靠本计划的验证步骤手工核对。

**若这些代价不可接受**,装 IDE 也完全可以 —— 磁盘是够的,把 Task 3 换成下载 DevEco Studio 即可,后续 Task 6/7 的签名步骤在 IDE 里都有图形入口。

### 关于模拟器:本计划不含

即便走 IDE 路线,这台机器也建议跳过模拟器 —— **「极简小记」的两个核心卖点(桌面服务卡片 `FormExtensionAbility`、代理提醒 `reminderAgentManager`)模拟器本来就验证不了**,必须在真机上测。装了只是多占 3–4 GB。

---

## Task 0: 确认磁盘余量

**目标:E 盘可用 ≥ 20 GB。** 当前实测 21.7 GB,已经够 —— 这一步主要是复核,不是大扫除。

**Files:** 不涉及仓库文件

- [ ] **Step 1: 复核三个盘的可用空间**

```powershell
Get-PSDrive C,D,E | Select-Object Name,@{n='FreeGB';e={[math]::Round($_.Free/1GB,1)}}
```

Expected: 三盘合计 **≥ 30 GB**,其中 **E: ≥ 20 GB**(工具链要装在 E:,与项目同盘)

> 写入目标:E: 装 ~10 GB,剩 ~11 GB 给构建临时文件和 ohpm 依赖。够用但不宽绰。

- [ ] **Step 2: 若 E: 不足 20 GB,先看清空间被谁占了**

不要靠猜。装个磁盘可视化工具:

```powershell
winget install -e --id AntibodySoftware.WizTree
```

扫 E 盘,按大小排序。常见大户:E 盘上的虚拟机镜像(`.vhd`/`.vhdx`)、Steam 游戏库、旧项目 `node_modules`、Docker 镜像。

Expected: 一份按目录大小排序的清单,前 10 项通常就能解释掉大半空间

- [ ] **Step 3: 顺手回收 npm 缓存(纯下载缓存,删了会自动重建)**

```powershell
npm cache clean --force
```

Expected: 缓存目录体积归零

> **不需要**执行 `powercfg /h off`、`vssadmin delete shadows`、`Dism /ResetBase` 这类系统级清理 —— 那些是为了腾 50 GB 才需要的,现在用不上。C 盘空间也不必动,工具链不装在 C 盘。

---

## Task 1: 注册华为开发者账号

**上真机必须走这步**,且需实名认证。有等待期,先做。

- [ ] **Step 1: 注册账号**

访问 https://developer.huawei.com/consumer/cn/ ,用手机号注册。免费。

- [ ] **Step 2: 完成实名认证**

控制台 → 账号中心 → 实名认证。个人开发者选**个人认证**,需身份证 + 人脸识别。

Expected: 认证状态变为「已认证」。**未实名无法创建调试证书**,这一步不能跳

- [ ] **Step 3: 确认能进 AppGallery Connect**

访问 https://developer.huawei.com/consumer/cn/service/josp/agc/index.html ,用同一账号登录。

Expected: 能看到「我的项目」入口。这是后续申请调试证书和 Profile 的地方

> **只想先用云真机、暂时不想实名?** 云真机(Task 5)同样要求开发者账号。目前没有绕开账号的可行路径 —— 详见 Task 5 的说明。

---

## Task 2: 安装 JDK 17

**这是本计划唯一的新增前置。** HarmonyOS 构建工具链只支持 JDK 17(不支持 8、11、21)。

- [ ] **Step 1: 确认机器上没有 JDK,或版本不是 17**

```powershell
java -version 2>&1
```

Expected: 报「无法识别」或版本号不是 17。若是 21 / 8 等,**不要卸**,装 17 后用 `JAVA_HOME` 指向 17 即可

- [ ] **Step 2: 安装 JDK 17**

```powershell
winget install -e --id EclipseAdoptium.Temurin.17.JDK
```

Expected: 安装完成。若 winget 不可用,手动下载:https://adoptium.net/temurin/releases/?version=17 ,选 **Windows x64 .msi**

- [ ] **Step 3: 设置 JAVA_HOME 并验证**

装完后**重开 PowerShell**,然后(把路径换成实际安装位置):

```powershell
[Environment]::SetEnvironmentVariable('JAVA_HOME','C:\Program Files\Eclipse Adoptium\jdk-17.0.13.11-hotspot','User')

# 重开终端后再验证
$env:JAVA_HOME
java -version
```

Expected: `java -version` 输出 `openjdk version "17.0.x"`。**大版本必须是 17**

> **路径含空格没关系。** `C:\Program Files\...` 用于 `JAVA_HOME` 是安全的 —— 有问题的只是鸿蒙工程自身的路径。若发现构建报路径相关错误,再考虑改装到 `E:\jdk17`。

---

## Task 3: 下载并解压 Command Line Tools

- [ ] **Step 1: 打开官方下载页**

访问 https://developer.huawei.com/consumer/cn/download/ ,在页面中找到 **Command Line Tools**(与 DevEco Studio 并列,是独立的一项)。

- [ ] **Step 2: 选对版本**

| 项 | 选择 |
|---|---|
| 产品 | **Command Line Tools**(不是 DevEco Studio) |
| 版本 | 最新 Release 版 |
| 系统 | Windows 64 位 |
| 包类型 | 完整包 |

下载包约 **2.3 GB**。

> **版本号会变。** 以页面当下显示的最新 Release 为准。选 Release 而非 Beta —— Beta 版的 `reminderAgentManager` 等 API 行为可能变。

- [ ] **Step 3: 解压到 E 盘**

解压路径**必须纯 ASCII、无空格、无中文**。构建工具链内部有大量路径拼接,中文或空格路径会在某些环节静默失败,报错信息还常指向别处。

推荐 `E:\command-line-tools`。

```powershell
# 用下载的实际文件名替换
Expand-Archive -Path "$env:USERPROFILE\Downloads\commandline-tools-windows-*.zip" -DestinationPath "E:\command-line-tools"

# 看看解压出了什么
Get-ChildItem "E:\command-line-tools" | Select-Object Name
```

Expected: 出现 `commandline` 或 `command-line-tools` 目录(某些版本会再套一层同名目录)。记下真实层级 —— 后续环境变量要用

> **注意层级。** 有的版本解压出 `E:\command-line-tools\command-line-tools\...`,有的直接是 `E:\command-line-tools\...`。下面 Step 4 的路径要按实际层级调整。

- [ ] **Step 4: 定位四个关键目录**

不要照抄路径,先找到真实位置:

```powershell
$root = "E:\command-line-tools"
"--- hvigorw / ohpm ---"
Get-ChildItem $root -Recurse -Filter "hvigorw*" -ErrorAction SilentlyContinue | Select-Object -First 3 FullName
Get-ChildItem $root -Recurse -Filter "ohpm*"    -ErrorAction SilentlyContinue | Select-Object -First 3 FullName
"--- node ---"
Get-ChildItem $root -Recurse -Filter "node.exe" -ErrorAction SilentlyContinue | Select-Object -First 3 FullName
"--- hdc ---"
Get-ChildItem $root -Recurse -Filter "hdc.exe"  -ErrorAction SilentlyContinue | Select-Object -First 3 FullName
```

Expected: 四条各自打印出路径。Windows 上 `node.exe` 通常在 `<root>\command-line-tools\tool\node\`(Linux/macOS 才在 `node/bin/`)

- [ ] **Step 5: 复核磁盘余量**

```powershell
Get-PSDrive E | Select-Object Name,@{n='FreeGB';e={[math]::Round($_.Free/1GB,1)}}
```

Expected: E: 剩余 **≥ 8 GB**。低于此值后续构建会很吃力

---

## Task 4: 配置环境变量

上一步找到的四个目录,现在配进环境变量。

- [ ] **Step 1: 一次性配好(用上一步的真实路径替换)**

以**管理员身份**打开 PowerShell:

```powershell
$CLT = "E:\command-line-tools\command-line-tools"   # ← 换成 Task 3 Step 4 的实际层级

[Environment]::SetEnvironmentVariable('COMMANDLINE_TOOL_DIR', $CLT, 'Machine')
[Environment]::SetEnvironmentVariable('NODE_HOME', "$CLT\tool\node", 'Machine')
[Environment]::SetEnvironmentVariable('HDC_HOME',  "$CLT\sdk\default\openharmony\toolchains", 'Machine')

$old = [Environment]::GetEnvironmentVariable('Path','Machine')
$new = "$old;$CLT\bin;$CLT\tool\node;$CLT\sdk\default\openharmony\toolchains"
[Environment]::SetEnvironmentVariable('Path', $new, 'Machine')

"done"
```

Expected: 打印 `done`

> **`HDC_HOME` 的 `sdk\default\openharmony\toolchains` 是最常见的错处。** 不同版本可能没有 `default` 这一层,或叫别的名字。用 Task 3 Step 4 里 `hdc.exe` 的真实父目录覆盖它。

- [ ] **Step 2: 重开终端,验证四个工具都在 PATH 里**

环境变量的改动**不作用于已打开的进程**。关掉当前终端,重开一个(不需要管理员):

```powershell
hvigorw -v
ohpm -v
hdc -v
node -v
```

Expected: 四条命令各自打印版本号。

| 工具 | 作用 | 等价物 |
|---|---|---|
| `hvigorw` | 构建:HAP / HAR 打包 | npm scripts / gradle |
| `ohpm` | 鸿蒙包管理器 | npm |
| `hdc` | 设备连接与调试 | adb |
| `node` | 工具链内置,不要让系统的覆盖它 | — |

任何一条报「无法识别」,回 Step 1 检查路径,重点是**层级是否多/少了一层**。

- [ ] **Step 3: 配 ohpm 国内镜像(网络慢时必做)**

```powershell
ohpm config set registry https://ohpm.openharmony.cn/ohpm/
ohpm config get registry
```

Expected: 回显 `https://ohpm.openharmony.cn/ohpm/`

> 这一步与 npm 的 registry 是两套配置,**互不影响**。改 ohpm 的源不会动 npm 的。

- [ ] **Step 4: 确认 JDK 17 对 hvigorw 可见**

```powershell
echo $env:JAVA_HOME
java -version
```

Expected: `JAVA_HOME` 非空,`java -version` 显示 17。

**若 `JAVA_HOME` 为空或版本不对,先修好再做下一步** —— hvigorw 对 JDK 版本很敏感,报错信息通常不指向 JDK。

---

## Task 5: 准备一台能装 App 的设备

三选一。**推荐真机。**

- [ ] **Step 1: 手机开启开发者模式(真机路线)**

手机 `设置 > 关于本机 > 连续点击「版本号」7 次` → 返回 `设置 > 系统和更新 > 开发人员选项` → 打开 **USB 调试**。

Expected: 开发者选项菜单出现

- [ ] **Step 2: 连接并确认 hdc 认得它**

用 USB 线连电脑,手机弹出「是否允许 USB 调试」→ 允许。

```powershell
hdc list targets
```

Expected: 打印出设备序列号。

- 打印出序列号 → **整条链路通了**,继续 Task 6 配签名
- 打印 `[Empty]` → 换一根**数据线**(很多线只能充电)、换 USB 口、或在手机上把 USB 模式改成「传输文件」
- 报 hdc 版本与服务端不匹配 → `hdc kill` 后重试

- [ ] **Step 3: 备选:云真机(没有实体设备时)**

华为开发者联盟提供**云调试**服务,浏览器里远程操作真机,每日 **300 分钟免费**,支持上传 HAP 安装、HDC 命令、实时日志、多机同屏。

访问 https://developer.huawei.com/consumer/cn/agconnect/cloud-adjust

Expected: 能选机型并进入投屏界面

> **云真机不省磁盘。** 你仍然要在本地构建出 HAP 再上传,所以它是 Task 5 的替代品,不是 Task 3 的替代品。
>
> **它也不解决卡片/提醒的验证。** 社区反馈远程投屏有卡顿;服务卡片需要在真机桌面上长按添加、代理提醒需要真实的系统通知栏 —— 这些在投屏窗口里手感失真。而这两个功能正是本次开发的理由,建议还是用实体真机。

- [ ] **Step 4: 备选:本地模拟器**

**本计划不含。** 模拟器由 DevEco Studio 的 Device Manager 管理,命令行工具不带它。需要的话得改走 IDE 路线。

即便装了也建议跳过 —— 桌面服务卡片、代理提醒、语音识别(需真实麦克风)、图片选择器这四项它都验证不了,而它们恰好覆盖「极简小记」的功能 1、3、2b、2c。

---

## Task 6: 真机调试签名

签名有一套固定流程:**本地生成密钥 → 导出 CSR → 在 AGC 换回证书和 Profile → 配进工程**。调试证书与发布证书不通用,M1 只需要调试证书。

**IDE 版是从菜单点,命令行版要用 `keytool`。** 这是两条路线差别最大的地方。

- [ ] **Step 1: 用 keytool 生成密钥库与 CSR**

`keytool` 随 JDK 17 一起来,已在 PATH 里。

```powershell
# 先建目录 —— 不要放在仓库内!
New-Item -ItemType Directory -Force E:\keys | Out-Null

keytool -genkeypair `
  -alias minimalnote `
  -keyalg EC -groupname secp256r1 -sigalg SHA256withECDSA `
  -dname "C=CN, O=MinimalNote, OU=Dev, CN=MinimalNote" `
  -keystore E:\keys\minimalnote.p12 `
  -storetype PKCS12 `
  -validity 9125 `
  -storepass "你的密码" `
  -keypass "你的密码"

keytool -certreq `
  -alias minimalnote `
  -keystore E:\keys\minimalnote.p12 `
  -storetype PKCS12 `
  -file E:\keys\minimalnote.csr `
  -storepass "你的密码" -keypass "你的密码"
```

Expected: `E:\keys\` 下出现 `minimalnote.p12` 与 `minimalnote.csr`

> **`E:\keys\` 不要放在仓库目录内。** `.gitignore` 排除了 `*.hap` 但没排除 `*.p12` —— 密钥库泄漏等于他人可以签名你的应用。后面拿到的 `.cer`、`.p7b` 同理。

> **算法参数以 AGC 证书申请页的当前要求为准。** 上面用的是 ECC P-256 + SHA256withECDSA,是 DevEco「Generate Key and CSR」的默认组合。若 AGC 页面另有要求(例如 RSA 2048),按页面的来。

- [ ] **Step 2: 在 AGC 申请调试证书**

AppGallery Connect → 用户与访问 → 证书管理 → **新增证书** → 类型选「调试证书」→ 上传 `minimalnote.csr`。

Expected: 下载得到 `minimalnote-debug.cer`,存到 `E:\keys\`

- [ ] **Step 3: 在 AGC 创建设备、应用与调试 Profile**

依次做三件事:

1. **注册调试设备** —— 设备管理 → 添加设备,填入手机 UDID

   ```powershell
   hdc shell bm get --udid
   ```

2. **创建应用** —— 我的项目 → 新建项目 → 添加应用

   | 字段 | 值 |
   |---|---|
   | 应用包名 | `com.choppeer6.minimalnote` |
   | 应用类型 | App |

3. **申请 Profile** —— 证书、Profile 与 App 管理 → Profile 管理 → 添加 Profile → 类型选「调试」→ 绑定上一步的证书 → **勾选刚注册的设备**

Expected: 下载得到 `minimalnote-debug.p7b`,存到 `E:\keys\`

> **包名必须与工程的 `AppScope/app.json5` 里的 bundleName 逐字符相同。** 对不上时真机安装会失败,提示签名与包名不匹配 —— 报错信息不会直说是包名问题。

- [ ] **Step 4: 确认三个文件齐了**

```powershell
Get-ChildItem E:\keys | Select-Object Name,@{n='KB';e={[math]::Round($_.Length/1KB,1)}}
```

Expected: 至少包含 `minimalnote.p12`、`minimalnote-debug.cer`、`minimalnote-debug.p7b`

**签名材料到此备齐。** 真正把它配进工程、从而让 `hvigorw assembleHap` 直接产出已签名 HAP,属于 Task 7 —— 要等工程脚手架存在之后。

---

## Task 7: 工程脚手架(命令行路线的前置)

**这一步在 IDE 路线里是不存在的** —— IDE 的 New Project 向导会自动生成。命令行路线必须自己弄出来,而且是 B 部分开工前的硬前置。

- [ ] **Step 1: 明确需要哪些文件**

HarmonyOS Stage 模型工程的最小骨架:

```
build-profile.json5          # 根:产品、SDK 版本、签名配置
hvigorfile.ts                # 根:构建入口
oh-package.json5             # 根:依赖声明
hvigor/hvigor-config.json5   # hvigor 版本与插件
AppScope/
  app.json5                  # 应用级配置(bundleName 在这里)
  resources/                 # 应用图标、名称
entry/
  build-profile.json5        # 模块级配置
  hvigorfile.ts
  oh-package.json5
  src/main/
    module.json5             # 模块声明、Ability 列表
    ets/entryability/EntryAbility.ets
    ets/pages/Index.ets
    resources/
```

- [ ] **Step 2: 不要手写 —— 从官方示例拷一份改**

这些文件的内容**随 SDK / API 版本而变**(字段增删、必填项变化),照记忆手写几乎一定会卡在某个字段上,而且报错信息通常指向别处。

正确做法是拿一份**与所装 SDK 版本一致**的官方示例工程:

访问 https://developer.huawei.com/consumer/cn/doc/harmonyos-samples/ ,找一个最简单的 Stage 模型示例(如 Hello World 类),下载后:

1. 用 7-Zip 或 DevEco Studio 解开示例工程
2. 把整个工程目录拷到仓库的一个临时位置
3. 逐项改:`AppScope/app.json5` 的 `bundleName` 改为 `com.choppeer6.minimalnote`、`oh-package.json5` 里的包名、`build-profile.json5` 的 SDK 版本对齐本机所装版本
4. `hvigorw assembleHap` 跑通空工程 —— **先确认工具链本身是通的,再往里加业务代码**

Expected: 产出 `entry/build/default/outputs/default/entry-default-unsigned.hap`

> **这一步是本计划里最不确定的一环。** 我无法在没装工具链的前提下验证示例工程与 SDK 版本是否对得上。若卡住,可行退路是按「版本说明」一节装一次 DevEco Studio,用向导生成骨架、把签名配好,然后**继续用命令行构建** —— IDE 只用来生成一次骨架,不必长期开着。

- [ ] **Step 3: 把签名配置写进根 `build-profile.json5`**

签名材料在 Task 6 已备齐。在根 `build-profile.json5` 的 `app.signingConfigs` 里填入:

```json5
{
  "app": {
    "signingConfigs": [
      {
        "name": "default",
        "type": "HarmonyOS",
        "material": {
          "certpath": "E:/keys/minimalnote-debug.cer",
          "storePassword": "<加密后的密码>",
          "keyAlias": "minimalnote",
          "keyPassword": "<加密后的密码>",
          "profile": "E:/keys/minimalnote-debug.p7b",
          "signAlg": "SHA256withECDSA",
          "storeFile": "E:/keys/minimalnote.p12"
        }
      }
    ]
  }
}
```

> **两个密码字段是加密串,不是明文。** IDE 的 `Signing Configs` 界面会把明文密码加密后写入此文件;命令行路线没有这个界面。可行做法:先手工填明文试,不通再用 IDE 打开工程一次、在图形界面里重填密码(它会自动加密回写),之后继续用命令行。

- [ ] **Step 4: 构建并安装到真机**

```powershell
hvigorw clean --no-daemon
hvigorw assembleHap --mode module -p product=default -p buildMode=debug --no-daemon
hdc install entry\build\default\outputs\default\entry-default-signed.hap
```

Expected: `hdc` 输出 `install successful`。**这一步通了,就可以回到 M1 计划执行 B 部分了**

> 若产物是 `-unsigned.hap`,说明 Step 3 的签名配置没生效。退路是用 SDK 自带的签名工具手工签:
> `java -jar <CLT>\sdk\default\openharmony\toolchains\lib\hap-sign-tool.jar`
> 参数用 `--help` 查 —— 各版本 flag 名有出入,不要照抄网上的。

---

## 完成标准

- [ ] E: 盘装完后仍剩 **≥ 8 GB**
- [ ] `java -version` 显示 **17**
- [ ] `hvigorw -v`、`ohpm -v`、`hdc -v`、`node -v` 四条均可执行
- [ ] `ohpm config get registry` 指向国内源
- [ ] `hdc list targets` 能列出手上的真机(或已确认云真机可用)
- [ ] `E:\keys\` 下 `.p12` / `.cer` / `.p7b` 三件齐备
- [ ] **Task 7 跑通**:`hvigorw assembleHap` 产出 HAP 且 `hdc install` 成功
- [ ] **下一步:回到 `2026-09-24-minimalnote-m1-data-layer.md` 执行 Task 6 起的 B 部分**

## 风险与坑

| 风险 | 表现 | 应对 |
|---|---|---|
| JDK 版本不对 | hvigorw 报错但不提 JDK | 死守 17;`JAVA_HOME` 指向 17 |
| 解压层级多/少一层 | 四条命令全部「无法识别」 | Task 3 Step 4 先实测真实路径,别照抄 |
| `HDC_HOME` 猜错 | `hdc` 找不到,或找不到 toolchains 里的签名工具 | 用 `Get-ChildItem -Recurse -Filter hdc.exe` 实测 |
| 工程脚手架对不上 SDK 版本 | `assembleHap` 报缺少字段,报错位置莫名其妙 | 用与 SDK 同版本的官方示例;退路是装一次 IDE 生成骨架 |
| 签名密码字段是加密串 | 构建产物是 `-unsigned.hap` | 明文先试;不通就用 IDE 打开工程重填一次让它加密回写 |
| 包名不一致 | 真机安装失败,提示签名与包名不匹配 | AGC 包名与 `AppScope/app.json5` 的 bundleName 逐字符相同 |
| 忘掉密钥库密码 | `.p12` 无法再用于签名,只能重新申请证书 | `E:\keys\` 的路径与两个密码记到密码管理器 |
| 内存吃紧 | 构建时卡顿 | 构建时关掉不必要的大内存应用(这台机器 16 GB 且可用量偏低) |

## 本计划不含

- 鸿蒙应用本身的开发步骤 —— 见 `2026-09-24-minimalnote-m1-data-layer.md`
- 服务卡片与代理提醒的实现 —— 属 M5 / M4
- 本地模拟器 —— 需 IDE,且验不了本项目的核心功能
- 发布上架流程(需发布证书,与调试证书是两套)
