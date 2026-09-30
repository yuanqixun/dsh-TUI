# Spec Delta

## Purpose

使 dsh-TUI 在 Windows PowerShell 和麒麟 V10 SSH 交互终端中以普通用户身份运行，使用内网模型与项目依赖仓库，并通过用户目录隔离配置、凭证、偏好和会话。客户端升级从用户维护的 Nginx 静态清单读取，必须经用户确认。

## ADDED Requirements

### Requirement: 发行版专属用户数据与进程环境

离线版 SHALL 将 DSH profile/凭证、TUI 偏好/会话元数据和缓存放进本发行版专属用户目录，且 MUST NOT 修改其他 dsh 客户端状态、机器环境或用户全局 PATH。启动器仅对子进程设置 DSH_HOME、TUI 数据根、缓存根、包内工具 PATH、Python/Node 环境及 npm/pip 镜像配置。凭证由 DSH credential service 保存，不写入包、manifest、会话或日志。

#### Scenario: 两个客户端并存
- **WHEN** 用户机器已有其他 DSH/TUI 客户端，再启动离线发行版并更改 provider 或偏好
- **THEN** 变化只落在离线发行版数据目录，另一客户端的凭证、profile、偏好与会话不变

#### Scenario: 搬迁或升级客户端
- **WHEN** 用户升级或搬移程序目录并继续使用原数据目录
- **THEN** provider、凭证、偏好和会话仍可用；卸载程序不自动删除用户数据

### Requirement: 内网 OpenAI 兼容模型和仓库

用户 SHALL 能通过现有 provider 配置内网 TokenHub 网关提供的 OpenAI-compatible API、模型和凭证。每个构建 profile SHALL 为该发行环境预置模型 API base URL、npm registry 与 Python package index；运行包 SHALL 使用预置内网源。用户可在安装后编辑包内运行配置并重启生效。模型 API key MUST 由用户安装后配置，不得写入构建 profile 或包内运行配置。服务或镜像失败 MUST 给出明确诊断且 MUST NOT 自动回退到公网服务/仓库。JDK/Maven 项目在用户另装 JDK/Maven 后由其本地命令和项目配置管理。

#### Scenario: 对话和工具调用
- **WHEN** 用户配置有效 TokenHub OpenAI 兼容端点并发送需工具的请求
- **THEN** 流式响应、工具调用/结果回传与会话恢复成功，凭证值不显示在日志或 transcript

#### Scenario: 内网源不可用
- **WHEN** API、npm registry 或 Python index 不可达/鉴权失败
- **THEN** 相应功能报告配置或网络错误，不尝试公共端点

### Requirement: Nginx 更新检测不阻塞使用

启动后客户端 SHALL 在后台访问构建时预置的 HTTPS manifest 地址检查当前平台版本，并提供手动检查入口。manifest 暂不可达、证书错误或内容无效 MUST NOT 阻止本地 TUI 启动；启动检查不得访问 GitHub、公共 npm 或其他发布端点。

#### Scenario: 后台发现更新
- **WHEN** manifest 包含高于当前客户端的有效版本与匹配平台产物
- **THEN** 客户端显示版本和更新说明，并等待用户确认下载/升级

#### Scenario: 检查失败或无新版
- **WHEN** manifest 超时/无效/版本相同，或目标平台没有更新条目
- **THEN** 当前会话正常启动，手动检查可重试，且不会访问公网源

### Requirement: 确认、校验和应用客户端升级

升级器 MUST 在用户确认后下载目标平台客户端包，校验尺寸、版本与 SHA-256，再暂存并切换客户端 release；MUST NOT 覆盖用户数据或工具层。下载、解包或切换失败时 SHALL 保留/恢复当前 release。手动触发的更新入口 SHALL 执行检查并在升级前征得确认。

#### Scenario: 用户接受更新
- **WHEN** 用户确认有效更新且包目录可写
- **THEN** 更新器下载和校验客户端包，暂存为新版本，切换启动目标，保留前一版本和工具层

#### Scenario: 用户拒绝或安装不可写
- **WHEN** 用户拒绝更新或程序目录无写权限
- **THEN** 拒绝时不下载；不可写时不提权，提示将包手动解压/替换的步骤，当前版本继续可用

#### Scenario: 更新过程中失败
- **WHEN** 下载、校验、解压或新版本启动检查失败
- **THEN** 不损坏用户数据，恢复到先前可运行版本并说明失败原因

### Requirement: 终端前置条件与退出

离线 TUI SHALL 仅在受支持的交互式 PowerShell 或麒麟 SSH PTY 中运行；不得要求图形桌面或管理员权限。退出与启动失败 MUST 恢复终端状态。

#### Scenario: Linux SSH 未分配 PTY
- **WHEN** 用户无终端或通过未分配 PTY 的 SSH 执行
- **THEN** 命令提示使用交互 SSH/`ssh -t` 并以非零码退出，不污染输出流

#### Scenario: 正常或异常退出
- **WHEN** 用户退出、取消或 TUI 渲染失败
- **THEN** 终端 raw/cursor/屏幕状态按既有清理契约恢复
