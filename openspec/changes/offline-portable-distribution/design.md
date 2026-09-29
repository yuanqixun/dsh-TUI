# Design

## Context

见 [proposal.md](proposal.md) 的动机与范围。代码勘察基于提交 `f2ca43a0`：

- `scripts/make-installer-bundle.mjs` 生成调用 winget/npm 的在线安装脚本，不能作为离线交付物。
- `scripts/make-standalone-bundle.mjs` 已将依赖压缩后嵌入可执行文件，但会重写版本、重新解析 lock，并依赖 registry 中的 TUI 包；当前发布流程在 Ubuntu 上统一生成多平台产物，未提供各目标平台断网验收证据。
- 根项目为 TUI 0.11.1，主验证 DSH 0.1.7-rc.2；`standalone/package.json` 仍记录 TUI 0.9.2、DSH 0.1.1-rc.2。构建器仅同步 TUI 版本，不应把旧 standalone 依赖表直接视为当前完整运行依赖。
- 依赖包含 sharp、PTY/FFI/子进程桥等平台组件；工作区还包含 dsh-auth 与 vendored dsh-std 本地包，必须实化，不能携带指向构建机的链接。
- `standalone/entry.mjs` 已有独立 DSH_HOME、缓存、profile 初始化的基础；当前初始化会复制 patch，因此不能原样复用为保留用户配置的离线升级入口。
- 配置文档已有自定义端点能力，`src/dsh-adapter/plugin.ts` 启动时调用更新检查；两者需纳入离线行为测试。

## Goals / Non-Goals

**Goals:**

在已确认的 Windows、Linux 目标上，以独立目录实现首次及后续离线启动，并通过既有 DSH provider 接缝访问内网模型。运行机器无需包管理器、编译工具或外网下载。

**Non-Goals:**

不制作 MSI/DEB/RPM，不要求单文件 EXE，不打包模型权重，不随附用户业务项目的全部语言 SDK、依赖、浏览器或任意 MCP 服务；不承诺所有 Linux 发行版、国产 CPU、musl 或旧版 Windows 都可运行。不改变现有在线用户的默认行为。

## Decisions

### 1. 使用目录式完整包

新增 `bundle:offline` 构建入口，独立于现有 `bundle:standalone`。Windows 交付 `dsh-tui-offline-<version>-win32-<arch>.zip`，Linux 交付 `dsh-tui-offline-<version>-linux-<arch>-<libc>.tar.gz`。版本、平台、架构与系统基线写入包内 manifest。

目录包含 `runtime/`（固定版本 Node.js）、`app/`（生产依赖和编译产物）、`tools/`（必要平台程序）、`config/`（无密钥示例）、启动脚本、`manifest.json`、文件摘要、许可证和说明书。Windows 使用 CMD 启动器，Linux 使用 SH 启动器；启动时显式调用包内 Node，子进程 PATH 优先指向包内 runtime/tools，保留调用者工作目录和参数、退出码。

采用目录式包是为了保留 ESM 动态加载和原生模块的普通文件语义，减少单可执行文件封装的兼容面；代价是文件数和体积增加。仅把 node_modules 复制到离线机或提供 npm 缓存都无法满足无需安装运行时的目标。

### 2. 平台矩阵与依赖闭包

任务 1 输出明确的目标清单：OS/版本、架构、libc/系统库、终端、可用 shell、权限和 API 协议。当前不将 x64 当成用户已确认需求。构建主体可先按上述通用目录协议设计；具体二进制选择和完整产物构建必须等待目标清单。

在匹配目标的构建环境准备平台原生模块和 Node.js，Linux 选择覆盖目标系统的构建基线；构建环境可联网，交付运行环境不可依赖公网。Windows 与 Linux 分别验证，不以交叉编译成功代替目标测试。

先构建当前 checkout 的 TUI、dsh-auth 与 dsh-std，生成可安装的本地包并纳入锁定的生产依赖。依赖升级和 lock 更新作为显式准备步骤审核；正式出包使用冻结锁，失败即停止，不能临时解析 latest。DSH 版本以当前 adapter 契约为依据；枚举最终 Cordis composition 的动态依赖、preset、资源与子进程入口，确认依赖闭包。

对每个必需原生模块执行真实加载和最小功能探针；sharp 图片能力纳入完整包。检查辅助程序是否由上游运行时下载，改为构建期准备并通过上游支持的路径配置消费。Windows 包含便携 Git/Git Bash 及许可；Linux 记录系统基本 shell/libc 前置条件，随附闭包需要且可分发的辅助程序。不随包分发内核或完整 Linux 用户空间。

### 3. 离线专用启动策略

新增离线启动标志 `DSH_TUI_OFFLINE=1`，由新启动器设置；不改变普通在线启动默认值。更新入口在发请求前识别离线模式，禁用自动检查，手动更新/在线安装指向离线包替换说明。网络相关 UI 文案走现有 i18n。

使用独立的离线 DSH_HOME（默认用户目录下 `.dsh-tui-offline`），继续使用 DSH 的配置、会话服务和既有 TUI 偏好位置。启动器只在首次初始化时写默认 profile，不覆盖已存在的用户 patch、凭证或会话；包目录与用户可写数据分离，支持已有 standalone home/cache 环境覆盖的兼容映射并在说明中明确。

复用并提取 standalone 的初始化能力，启动包内 DSH；不进入普通 launcher 的在线 bootstrap 分支。profile 的包解析始终指向当前本地完整包，不携带构建机绝对路径。升级切换本地解析目标时保留用户配置，并验证新版本所需默认配置与覆盖层能正确组合。

### 4. 内网模型及网络行为

通过现有 DSH provider 配置输入端点、协议、模型 ID 和凭证；提供 DeepSeek/OpenAI 兼容接口示例，实际协议以环境确认结果验收。密钥只在目标机配置，包、manifest 和日志不得包含真实凭证；内网 CA 通过支持的 CA 配置注入，不关闭 TLS 校验。

启动时不自动探测公共模型列表、不检查公网插件目录、不发送遥测；显式网络工具由部署配置按需求关闭或指向内网服务。离线标志约束产品内置自动网络行为，不作为任意 shell 命令的网络安全边界；强制出站限制由内网网络策略执行。

无 API 配置时可进入配置流程；端点不可达时提供明确诊断，不回退公网端点。模型调用测试覆盖流式响应和 tool calling，仅有文本响应不能算 agent 全功能通过。

### 5. 完整性与验收产物

manifest 记录源码提交、TUI/DSH/Node 精确版本、平台基线、依赖及辅助程序版本。构建产物附逐文件摘要和压缩包 SHA-256、第三方许可/NOTICE、构建验证报告；提供本地完整性检查命令。摘要用于检测损坏，不能替代可信分发或签名。

最终报告区分“构建成功”“目标断网冒烟通过”“用户内网 API 验收通过”。端点未提供时用本地兼容服务验证协议流程，但不得把模拟结果写成内网实测。所有档案不得含开发缓存、凭证、真实会话或构建机外部链接。

## Risks / Trade-offs

- 原生依赖或系统库不兼容 → 先锁平台基线，在干净目标机验证，未通过目标不发布。
- 包中遗漏动态加载插件或子进程程序 → 从最终 profile 组合枚举闭包，并验证完整工具流程，不能只测 --version。
- 旧 standalone 版本漂移 → 独立离线构建使用当前源码和契约验证版本，不自动沿用旧清单。
- 内网服务只兼容部分 OpenAI/DeepSeek 协议 → 以流式响应和工具调用验收记录支持能力，错误不能静默吞掉。
- 包较大、系统辅助程序有再分发要求 → 只保留生产闭包，记录尺寸与许可证；不能靠遗漏必需依赖减小体积。
- 现有共享 TUI 偏好位置影响多版本 → 不新增并行偏好真源，升级回退测试必须检查会话/偏好兼容性。

## Migration Plan

先完成任务 1 环境确认，再实现、验证独立离线通道，保留原在线分发通道。升级通过旁路解压新版本、校验、切换启动器完成，不覆盖旧程序目录；变更用户数据前备份。若 DSH 数据格式不可逆，不承诺直接降级，回退必须连同兼容的数据备份恢复。

本提案提交不执行发布。完成目标系统断网与内网验收后再单独决定产物分发；OpenSpec 仅在实施任务真实完成后归档。

## References

- [OpenSpec 官方 CLI 文档](https://github.com/Fission-AI/OpenSpec/blob/main/docs/cli.md)
- [Node.js 平台与构建约束](https://github.com/nodejs/node/blob/main/BUILDING.md)（实施时按选定 Node tag 复核）
- [node-pty 平台依赖](https://github.com/microsoft/node-pty)
