# Spec Delta

## Purpose

为 Windows 10 x64 与麒麟 V10 Server x64/ARM64 提供可在普通用户权限下部署的 dsh-TUI 完整初装包，以及只更新 dsh-TUI 客户端的包。各包携带明确版本和摘要，首次安装及更新都不依赖公网软件源。

## ADDED Requirements

### Requirement: 平台对应的完整初装包

初装包 SHALL 分别覆盖 Windows 10 x64、麒麟 V10 Server x64、麒麟 V10 Server ARM64，并携带对应平台 dsh-TUI、DSH、一套供 DSH 使用的 Node 运行时、运行依赖、Git、Python、配置样例和许可。包 MUST 可由普通用户解压至可写目录运行，不要求管理员、系统级 Node/npm/pnpm 或在线下载客户端运行依赖。客户端版本与工具层版本 SHALL 独立锁定。JDK/Maven MUST NOT 列为初装包依赖。

#### Scenario: 首次部署
- **WHEN** 普通用户在匹配系统解压初装包并在 PowerShell 或 SSH 分配 PTY 的交互终端启动
- **THEN** dsh-TUI、包内 Git/Python/Node 可用，无需公网安装客户端依赖，并报告实际支持平台版本

#### Scenario: 目标平台或终端不匹配
- **WHEN** 在未声明支持的操作系统/架构运行，或进程无交互 TTY
- **THEN** 启动器在发出终端控制序列前给出清楚的不支持/终端分配指引并以非零状态退出

### Requirement: 内网项目依赖源预置

每次构建 SHALL 从本地非敏感配置输入预置 npm registry 与 Python package index，包内 npm/pip 命令默认使用这些公开内网源，不依赖目标机器既有的客户端仓库配置。输入配置 MUST 不要求凭证；打包日志、lock 和 manifest MUST NOT 包含仓库认证秘密。Maven/JDK 环境由用户自行安装配置。

#### Scenario: 安装项目依赖
- **WHEN** 用户运行 Python 或 npm 项目依赖安装命令
- **THEN** 包内工具解析预置内网源，命令在源不可达时明确失败，不自动切换公网源

#### Scenario: 缺少构建配置
- **WHEN** 构建时未提供必需的仓库或更新清单地址
- **THEN** 构建在生成归档前失败并指出缺失字段，避免产出未经配置的部署包

### Requirement: 静态更新 manifest 与摘要

构建 SHALL 生成适合人工上传至 Nginx 静态目录的 JSON manifest 和三种平台对应的客户端更新归档及 SHA-256。v1 manifest MUST 包含 schemaVersion、SemVer version、publishedAt、releaseNotes 和按平台键列出的包相对/HTTPS 同源 URL、sizeBytes、sha256、requiredToolchainId。更新归档只含 dsh-TUI/DSH 客户端 release 与运行依赖，不含工具层 Node、Git 或 Python。客户端 MUST 校验平台、版本、工具层兼容标识、内容长度、文件大小上限和 SHA-256；仅当平台条目的 `requiredToolchainId` 与本地 `toolchainId` 完全相同时升级，不兼容时提示重新部署完整初装包。

#### Scenario: 部署新版本
- **WHEN** 维护者先将每个平台更新归档放入 Nginx 目录，再发布新静态 JSON
- **THEN** 客户端可读取匹配自身平台的版本信息与包地址，manifest 中的摘要匹配归档内容

#### Scenario: Manifest 或归档无效
- **WHEN** JSON schema/版本/平台条目错误、地址不符合 HTTPS 同源约束、文件尺寸超限或摘要不匹配
- **THEN** 更新器拒绝下载/安装该更新，当前客户端版本仍可运行并报告原因

### Requirement: 版本和平台清单可追溯

每个初装和更新包 SHALL 记录源码提交、dsh-TUI/DSH/Node、Git/Python 工具版本、平台基线、依赖和许可信息，并 SHALL 附 SHA-256 清单。归档不得依赖构建机路径、开发缓存或用户配置。

#### Scenario: 搬运安装包
- **WHEN** 安装包复制到另一台相同平台机器或路径包含空格/中文
- **THEN** 所有运行文件能从包内解析，且清单版本、文件摘要和实际包内容相符

#### Scenario: 更新时工具层不变
- **WHEN** 从 dsh-TUI 版本 A 更新到 B
- **THEN** 活跃客户端变为 B，Node/Git/Python 工具层版本和路径保持不变
