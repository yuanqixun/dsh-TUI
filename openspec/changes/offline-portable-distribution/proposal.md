# Proposal

## Why

部署环境默认不能访问互联网，且目标包括无桌面环境的麒麟 V10 服务器，需要 dsh-TUI、DSH 和常用项目工具能够从离线介质安装。运行环境可访问内网 OpenAI 兼容模型服务、npm 与 Python 仓库；后续 dsh-TUI 更新由用户上传静态包和 JSON 清单到内网 Nginx。

## What Changes

- 提供 Windows 10 x64、麒麟 V10 Server x64 和 ARM64 的 ZIP/TAR.GZ 初装包，免管理员权限解压运行。
- 初装包带 dsh-TUI/DSH 所需运行依赖、Git、Python 和客户端使用的 Node；项目依赖从打包时预置的内网 npm/Python 仓库获取。Java/JDK/Maven 由用户按项目需要另行安装和设置环境变量。
- 用不入库的打包配置预置 npm/Python 仓库地址及 Nginx 更新清单地址；仓库匿名内网可读，不打包凭证。配置与凭证、偏好、会话和缓存均保存在发行版专属用户目录。
- 约定 Nginx 静态 JSON 更新契约；启动时后台检测并提示更新，另提供手动检测。只有用户确认后才下载并以 SHA-256 校验、安装 dsh-TUI 更新包；更新包不重复携带 Git/Python 工具。
- 按 Windows PowerShell 和 Linux SSH 交互式 TTY 验收；Linux 用户通过 `ssh -t` 等方式分配终端。CA 信任与网络出站策略由宿主环境管理。
- 附平台及依赖版本清单、SHA-256、第三方许可、静态 JSON 模板、打包配置样例和中英文操作说明；仅声明实测通过的目标系统。

## Capabilities

### New Capabilities

- `offline-bundle`: 版本可追溯、平台明确且包含客户端和指定工具依赖的离线初装包与增量客户端更新包。
- `offline-runtime`: 用户目录隔离、内网服务配置、项目依赖安装及 Nginx 检查和确认式升级。

### Modified Capabilities

无；仓库此前没有 OpenSpec 基线。上述能力目前仅为本提案的增量规格。

## Impact

预计涉及独立离线构建、启动器、TUI 用户路径解析、现有 GitHub/npm 更新检测与下载入口、包清单模板、README 和聚焦回归。现有在线安装与 npm 分发保持现状，不改变公共插件 API，也不负责安装或配置模型服务、企业 CA、JDK/Maven、网络策略。

用户确认的范围：Windows 10 x64、麒麟 V10 Server x64/ARM64；普通用户权限、任意可写安装目录；PowerShell/SSH TTY；客户端节点可访问内网模型 API、npm、Python 仓库和 Nginx；内置 Git、Python 和 DSH 所用 Node；发行版专属用户数据；启动自动检查并提供手动更新；用户确认后升级；SHA-256 校验。实际具体版本号按构建时的官方支持版本选定并锁定。所有实现任务仍未完成；本次修改仅完善 OpenSpec 提案，不生成安装包或发布 Release。
