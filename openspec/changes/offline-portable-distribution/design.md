# Design

## Context

见 [proposal.md](proposal.md)。仓库已有 standalone 单文件运行时和 DSH profile 初始化，但当前版本清单落后于主仓库、依赖 registry 上的旧 TUI 包，自动更新会访问 GitHub/npm，且当前 updater 替换单个 executable。TUI 用户偏好默认使用 `~/.dsh-tui`，DSH profile 与凭证位于 `$DSH_HOME`；standalone 另有 profile/cache 根目录。离线发行版需隔离全部本产品状态并采用目录级安装/升级。

## Goals / Non-Goals

**Goals:**

- 让已确认的三个目标矩阵可以在普通用户权限下、交互式终端运行 dsh-TUI；初装包括工具依赖，升级只传客户端。
- 让客户端及其子进程使用私有 PATH、仓库配置和用户数据，不改变已有客户端或宿主机全局设置。
- 通过静态 HTTPS JSON 完成不阻塞启动的更新检查、用户确认、摘要校验、暂存与回滚。

**Non-Goals:**

不保证任意 Linux/麒麟发行版；不打包 JDK/Maven 或任意业务项目 SDK；不自动安装/配置企业 CA、防火墙、npm/Python 仓库或模型网关；不在后台自动下载/安装更新；不承诺没有交互 TTY 的服务模式。

## Decisions

### 1. 分层初装目录和客户端更新包

初装产物按 `win10-x64`、`kylin-v10-x64`、`kylin-v10-arm64` 分别构建。ZIP 用于 Windows，TAR.GZ 用于 Linux。目录含 `launcher/`、版本化 `app/releases/<version>/`、`tools/`、`config/` 和许可证/说明/manifest。客户端 release 含当前源码构建的 dsh-TUI、DSH 及完整生产依赖；工具层含目标平台 Git（Windows 版提供 Git Bash）、Python 和一套与当前 DSH 兼容的 Node 运行时。Node 主要供 DSH 使用，由 launcher 设置为 dsh-TUI 与其子进程的私有运行环境；不另附第二套项目 Node 版本。

首次安装包带客户端和工具层；更新包只带新的客户端 release，不带 Git、Python 或 DSH 使用的 Node。更新 JSON 附带兼容工具层标识；若客户端更新要求不同工具层版本，提示用户重新部署完整初装包。工具层随初装版本固定，不因 dsh-TUI 更新重复下载。JDK/Maven 不随包提供，由用户自行安装并配置。

构建当前源码与 dsh-auth、dsh-std 本地包，使用冻结生产依赖锁，不引用构建机路径或旧 standalone registry 包，不静默改写 lockfile。固定 TUI/DSH/Node/工具精确版本、源码提交和目标平台；初装与升级分开构建，Windows 与麒麟目标分别实测。

### 2. 打包时注入公开内网配置

使用本地 `offline-bundle.config.json` 作为构建输入，提供 npm registry、Python index URL、Nginx manifest URL 以及必要的非敏感发布说明等值。仓库只提交空值/示例模板，把实际配置文件列入 ignore；打包生成的 `config/` 将 npm 与 pip 默认索引配置为用户提供的内网地址，客户端更新器预置 manifest URL。内网仓库匿名可读，不在文件、日志、lock 或包元数据中嵌入凭证。Maven 配置不生成，沿用用户安装环境的设置。

包内单套 Node 与 Git 的可执行路径由启动器按平台设置；Python 环境通过包内 `PYTHONHOME`/PATH 指向；仅对 dsh-TUI 与继承其环境的工具进程生效，不写 Windows 注册表、PowerShell profile、shell rc 或机器级变量。Node 版本跟随 DSH 支持范围锁定；不承诺支持任意多版本 Node 项目。模型 API 按用户现有 provider 流程配置 OpenAI-compatible endpoint、模型和 key，密钥写入发行版私有 DSH credential store，不进入 manifest/会话/日志。企业 CA 由 IT 安装到系统信任库。

### 3. 隔离安装数据

程序目录可位于用户可写的任意位置。启动器仅为该发行版进程设置专属数据根（可由 `DSH_TUI_OFFLINE_HOME` 显式覆盖）：Windows 默认 `%LOCALAPPDATA%\\dsh-tui-offline`，Linux 默认 `$XDG_DATA_HOME/dsh-tui-offline`，未设置 XDG 时 `$HOME/.local/share/dsh-tui-offline`。其子目录分别承载 DSH profile/凭证、TUI 偏好与会话元数据、缓存；将 `$DSH_HOME`、TUI 自有状态目录变量和缓存变量映射至这些目录。实现前枚举 TUI 自有的所有 `homedir()` 路径访问点，经统一 helper 解析；导入其他客户端数据的来源路径仍指向真实用户 home。

首次运行只创建缺省状态，不覆盖已存在自定义设置。跨版本沿用私有数据根。升级只改活跃客户端 release 指针，保留前一 release；切换失败则恢复旧 release。卸载/更换程序目录不删除用户数据。对非交互或无 TTY 调用给出清楚错误；Linux 操作由 SSH 分配 PTY。

### 4. Nginx JSON 更新契约

打包时把 HTTPS manifest URL 写入客户端配置。由仓库维护者生成 JSON、人工上传到 Nginx 静态目录；推荐 v1 结构如下：

```json
{
  "schemaVersion": 1,
  "version": "0.11.2",
  "publishedAt": "2026-09-30T00:00:00Z",
  "releaseNotes": "修复与改进说明",
  "platforms": {
    "win10-x64": {
      "url": "./dsh-tui-0.11.2-win10-x64.zip",
      "sizeBytes": 123456789,
      "sha256": "<64 个十六进制字符>",
      "requiredToolchainId": "win-tools-1"
    },
    "kylin-v10-x64": {
      "url": "./dsh-tui-0.11.2-kylin-v10-x64.tar.gz",
      "sizeBytes": 123456789,
      "sha256": "<64 个十六进制字符>",
      "requiredToolchainId": "kylin-x64-tools-1"
    },
    "kylin-v10-arm64": {
      "url": "./dsh-tui-0.11.2-kylin-v10-arm64.tar.gz",
      "sizeBytes": 123456789,
      "sha256": "<64 个十六进制字符>",
      "requiredToolchainId": "kylin-arm64-tools-1"
    }
  }
}
```

版本严格使用 SemVer。客户端以当前平台键查找产物，且仅接受该平台条目 `requiredToolchainId` 与本地工具层 `toolchainId` 完全相同的更新；否则提示用户重新部署完整初装包。客户端接受同源 HTTPS 相对下载地址或同源 HTTPS 绝对地址；拒绝未知 schema、平台缺项、非 HTTPS、摘要格式错误、尺寸越界和无效版本。Nginx 同目录保存清单和包，部署者先上传包再原子替换 JSON，避免客户端读取到半发布状态。SHA-256 必须与实际包字节匹配；用户明确接受内网 SHA-256 校验，不引入代码签名要求。包大小限制以 manifest `sizeBytes` 和可配置上限验证，构建应给出产物体积。

启动后后台有界请求检查，不阻塞 TUI；服务错误/超时静默降级为可诊断的检查失败，不阻止会话。提供手动 `/update` 检查/重试。发现新版本只提示版本与 release notes；用户明确确认后才下载。下载到用户私有 cache，验证字节数与 SHA-256 后解压到 `app/releases/.staging-<version>`，验证必需路径/manifest，原子更新活跃 release 指针，再由 launcher 启动新版本。旧版保留用于本机回退；数据格式若不可逆，更新前告知且备份数据。检查、下载和解压失败均不替换当前 release，错误不泄露凭证或敏感 URL 参数。

覆盖所有当前更新入口：启动后台提示、手动 TUI 更新和 `dsh-tui update` CLI；离线发行版不得再走 GitHub/npm 更新。普通 npm/profile 在线安装行为不变。用户数据私有，更新包只覆盖程序目录，不能覆盖配置和会话。

### 5. 独立目标验收

在 Windows 10 x64 PowerShell 与麒麟 V10 Server x64、ARM64 的交互式 SSH PTY 分别验收；清理开发环境依赖、阻断公网，仅使用配置好的内网 API/包仓库/Nginx。逐项检查 archive 的平台原生依赖、动态插件与辅助程序闭包、Git/Python/Node 可运行、项目依赖能取自预配置镜像、模型流式与工具调用、各数据路径隔离、更新失败保护和升级保留工具层。

## Risks / Trade-offs

- 麒麟 V10 的具体补丁版本、发行版构建变体和底层系统库在实施时需实测 → 未实际通过的组合不进入支持清单。
- 原生 Git/Python/Node 体积增大，且各有许可证 → 压缩包按平台拆分、随包列出许可证并记录大小。
- 普通版本清单和文件使用同一 Nginx → SHA 校验可发现损坏，不提供发布者认证；此为用户确认的内网信任模型。
- 内网镜像地址误填 → 构建前校验配置完整且地址格式合理，首包在隔离目标环境做 pip/npm 取包验收。
- SSH 未分配 PTY → 启动时识别非交互终端并提示使用 `ssh -t`，不写终端控制序列。
- 两个用户目录真源容易混淆 → 统一 resolver 和路径清单测试，确保离线版不读写其他客户端状态。

## Migration Plan

首次由安装包解压到用户可写程序目录，创建新的私有用户数据根并逐步完成模型配置。用户若已有 DSH/TUI 状态，默认不导入、不覆盖；后续可另行提供显式迁移指引。升级前置包与用户数据分离，仅更换客户端 release；升级失败自动恢复前版。卸载只删除程序目录，数据由用户显式备份/清理。构建和验收通过后才上传 Nginx；此 OpenSpec 提案不授权或执行生产上传。

## 实施前置输入

- 用户提供 npm registry、Python index 和 Nginx manifest URL 的实际值；目标验收使用实际麒麟 V10 Server x64/ARM64 镜像。
- 工具版本选择官方仍受支持且兼容 DSH/目标系统的发行线，在构建 lock/manifest 中锁定具体版本；构建时核对官方支持状态和许可证。
