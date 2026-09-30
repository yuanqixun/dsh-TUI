# dsh-TUI 离线发行版

在 Windows PowerShell 中运行 `launcher/dsh-tui.ps1`；麒麟 V10 SSH 会话先分配 PTY，再运行 `launcher/dsh-tui.sh`（例如 `ssh -t host` 后登录运行）。安装目录须可写，不需要桌面环境或管理员权限。

首次启动在发行版专属目录创建 DSH profile、凭证、TUI 偏好/会话和缓存；默认位于 `%LOCALAPPDATA%/dsh-tui-offline/<distributionId>` 或 `$XDG_DATA_HOME/dsh-tui-offline/<distributionId>`（未设置时 `$HOME/.local/share/dsh-tui-offline/<distributionId>`），因此 superbpm 与 hxfl 默认互相隔离。`DSH_TUI_OFFLINE_HOME` 可为该发行版进程指定另一个绝对路径。移动程序目录不会移动或删除用户数据；卸载时请按需自行备份/清理数据目录。

Git、Git Bash（Windows）、Python、Node、npm 与 pip 使用包内工具和预置内网源。项目依赖安装命令沿用 npm/pip；源来自本次构建配置。镜像不可用时安装会失败，不会切到公网。Java/JDK 与 Maven 按项目需要由用户另行安装、配置。企业 CA 与网络出站策略由宿主系统管理员提供。模型 API 地址从打包配置预置，并写入发行包的 `config/offline.json`；安装后可编辑，重启生效。API key 不打包，用户首次使用时通过 DSH provider 配置，凭证保存在本发行版 DSH credential store。

superbpm 与 hxfl 使用独立打包配置：从 [`offline/profiles/superbpm.example.json`](../../offline/profiles/superbpm.example.json) 或 [`offline/profiles/hxfl.example.json`](../../offline/profiles/hxfl.example.json) 复制为同目录下不入库的 `.json` 文件，再填写模型 API、更新 manifest、npm/Python 地址、工具版本和系统基线。真实配置已在 `.gitignore` 中排除，不能填凭证；两个环境的仓库可匿名读取。配置契约见 [`bundle-config.schema.json`](../../offline/bundle-config.schema.json)。按 [`toolchain-manifest.example.json`](../../offline/toolchain-manifest.example.json) 和 [`toolchain-manifest.schema.json`](../../offline/toolchain-manifest.schema.json) 为每环境的 Node、Git、Python 工具树记录版本、许可证标识、来源归档 SHA 和逐文件 SHA，命令为 `node --import tsx/esm scripts/offline/lock-toolchain.mjs <平台> <工具目录> <metadata.json>`。分别运行 `pnpm offline:validate:superbpm` 或 `pnpm offline:validate:hxfl`。先提交源码，再在各自匹配的目标系统和架构执行 `pnpm offline:build -- --profile <profile> --platform <平台> --out <空目录>`（`<profile>` 为 `superbpm` 或 `hxfl`）；两个 profile 的输出和构建记录分开，软件 SemVer 保持一致。发布机分别用 `node --import tsx/esm scripts/offline/merge-manifests.mjs --profile <profile> --out <空目录> <Windows目录> <麒麟x64目录> <麒麟ARM64目录>` 合并各环境产物。Nginx 清单和相对归档 URL 契约见 [`update-manifest.schema.json`](../../offline/update-manifest.schema.json) 与样例；构建产物先上传，再最后替换 JSON。未经过目标系统验收的系统不得标成受支持平台。发行包附带的 `config/offline.json` 可在安装后调整；若要把新的默认值交付给其他用户，重新构建完整发行包，不单独分发配置文件。

启动时 Nginx 检查在后台进行。使用 `/update`，或运行 Windows 的 `./launcher/dsh-tui.ps1 update`、麒麟的 `./launcher/dsh-tui.sh update` 手动重试；升级前会显示版本和说明，只有确认后下载。更新仅切换客户端 release，完整初装包里的工具层保持不变。更新失败保留旧版本，数据目录不在更新目标内。SHA-256 校验用于发现内容损坏；内网 HTTPS 服务的发布者身份由企业网络信任策略保证。

若程序目录只读，更新器会在下载前停止且不会提权，并提示将匹配的完整离线包解压到用户可写目录后再启动；沿用原 `DSH_TUI_OFFLINE_HOME` 可继续使用现有设置和会话。
