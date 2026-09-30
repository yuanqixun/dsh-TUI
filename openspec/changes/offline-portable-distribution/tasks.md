# Tasks

本文件跟踪实现和验收进度。未确认目标系统镜像、版本与真实构建配置前，不得将未测平台列为已支持。

代码、模板、双发行 profile、构建入口、隔离启动器、更新客户端和中英文操作文档已落地；本机契约/路由回归及 HTTPS Nginx 静态发布 fixture 已通过。复合任务已拆成“实现交付”和“真实输入/目标环境验收”，完成的部分单独勾选。superbpm/hxfl 的真实内网地址已配置在本机 Git 忽略文件中；仍需补齐三套目标工具树和系统基线，并在 Windows/麒麟实机完成验收。

## 1. 固定构建输入和平台基线

- [ ] 1.1 确认 Windows 10 x64、麒麟 V10 Server x64/ARM64 的实际镜像/补丁级别、CPU、glibc 和 SSH/PowerShell 终端矩阵；按三种目标分别验证 Node、Git、Python 与依赖原生模块加载。
- [x] 1.2a 建立非敏感打包输入模板和 Schema，包含 npm registry、Python index、Nginx manifest URL、工具链目录/版本与发布说明配置点。
- [x] 1.2c 建立 superbpm/hxfl 独立 profile，本机默认模型、更新、npm、Python 地址已写入被忽略的本地配置；API key 留到安装后配置。
- [x] 1.2b1 自动回归拒绝未知的 API key/token/password 配置字段，错误不回显哨兵值；superbpm/hxfl 本地 profile 不含凭证字段。
- [ ] 1.2b2 从目标网络确认 Nginx manifest、npm 和 Python index 匿名可读，并从真实镜像安装样例依赖；当前主机探测到部分地址 404/连接重置，待确认准确路由和目标网络。
- [x] 1.3a 工具链锁定清单现强制记录 Node/Git/Python 许可证标识，并把许可证、精确版本和来源/逐文件 SHA 纳入可审阅构建记录；锁定 fixture 已覆盖完整与缺失许可证输入。
- [ ] 1.3b 在真实目标工具树上核实 Node/Git/Python 及运行时依赖闭包、加载兼容性和许可证文件，并输出目标平台报告。
- [x] 1.4 为 Nginx v1 JSON 编写 JSON Schema 与示例，定义平台键、SemVer、静态相对资产 URL、字节数和 SHA-256；有效/无效 fixture 已覆盖契约。

## 2. 构建完整初装包与客户端更新包

- [x] 2.1a 新增独立初装包和 client-update 构建入口，支持按平台单独构建及合并三平台 manifest。
- [x] 2.1c 支持相同应用 SemVer 的 superbpm/hxfl 分开构建、记录、输出与更新 manifest；产品名和命令保持不变。
- [ ] 2.1b 在三种原生目标分别产出 ZIP/TAR.GZ 并检查首次包工具闭包、更新包不含工具层。
- [x] 2.2a 实现冻结生产依赖 deploy、工具链锁定/文件摘要校验、依赖链接物料化和归档链接/私有文件拒绝逻辑；本机 production deploy 闭包检查通过（578 个包，含目标平台 node-pty 预构建文件）。
- [ ] 2.2b 用真实目标工具链构建后验证 DSH/Node 原生模块兼容、依赖加载、许可证和归档内容。
- [x] 2.3a 启动器和配置契约已接通包内 Git/Python/Node、Windows Git Bash 及 npm/pip 内网源配置点。
- [ ] 2.3b 在每个平台用样例 Node/Python 项目从实际内部镜像安装依赖。
- [x] 2.4a 构建器已生成发行清单、许可证目录、版本/架构元数据、SHA-256 和供 Nginx 合并的 JSON。
- [ ] 2.4b 对三平台实际归档逐字节验证 SHA、尺寸、架构键和发布目录内容。

## 3. 启动器与状态隔离

- [x] 3.1a 实现 PowerShell/Linux sh 启动器、Node 启动入口、任意安装路径处理、TTY/平台预检及子进程环境隔离。
- [x] 3.1b1 POSIX shell 与直接 DSH wrapper fixture 验证安装目录/cwd 含中文与空格时的参数、cwd、私有用户数据/内网仓库环境、release/profile/toolchain 匹配及子进程退出码传递。
- [ ] 3.1b2 在 Windows PowerShell 与三种麒麟 SSH PTY 上验证含中文/空格路径、cwd、参数、退出码和父 shell 环境。
- [x] 3.2a 新建 `DSH_TUI_OFFLINE_HOME` 数据根，并让 TUI 路径 resolver、profile 配置、session 元数据和缓存采用发行版隔离目录。
- [x] 3.2b 盘点 27 个 `DATA_DIR` 消费模块；双 profile 子进程回归覆盖偏好/使用统计/会话 pin、DSH session/profile/凭证路径，并确认 `~/.dsh-tui` 与 `~/.dsh` 的其他客户端哨兵文件未变。
- [x] 3.3a 首次启动的默认 profile/偏好初始化已实现为仅创建缺失项，并将配置、凭证、会话、缓存与程序目录分离。
- [x] 3.3c 已将模型 API base URL 和更新/repository 配置写入发行包运行时配置；安装后可编辑并在重启后生效，不含模型 API key。
- [ ] 3.3b 在目标机验证自定义设置保留、模型凭证持久化、重启恢复及移动程序目录后继续使用。
- [x] 3.4a 中英文文档已说明 TTY/SSH PTY、CA 信任、内网 npm/Python 源、外置 JDK/Maven、数据目录与更新操作。
- [ ] 3.4b 按文档在干净的 Windows/麒麟目标环境完成首启验收。

## 4. Nginx 更新客户端

- [x] 4.1 启动自动检查、手动检查和 `dsh-tui update` 已接入配置的 Nginx manifest；回归覆盖有效与坏 JSON 情形，均只请求配置的 manifest 且无 GitHub/npm 回退。
- [x] 4.2a 实现 v1 schema/platform/version/HTTPS 同源 URL/size/SHA-256 校验、有界下载及 manifest 响应校验。
- [x] 4.2b 回归覆盖超时/服务失败、坏 JSON、无平台包、超限流、响应长度错误和 checksum 错误；失败不切换 active release。
- [x] 4.3a 实现显式确认、私有缓存下载、release staging、SHA 与文件清单验证、活跃版本切换和上一版本指针保留。
- [x] 4.3b1 用真实 TAR.GZ fixture 走下载、SHA、解包、release 校验与 active 指针切换；覆盖 SHA/解包失败、工具层/数据保留和只读安装目录预检，并提供可写目录手动迁移指引。
- [x] 4.3b2a 以交互输入 `no` 验证拒绝更新仅请求 manifest、不下载归档。
- [x] 4.3b2b1 实现并回归 previous release 指针恢复；覆盖正常回滚、previous 缺失与不安全路径，并确认工具和用户数据不变。
- [x] 4.3b2b2 用伪子进程回归启动 ready、spawn error、异常退出和启动超时；验证超时清理、previous release 恢复、子进程终止及退出码转发。
- [ ] 4.3b2b3 在 Windows/Kylin 目标启动器上验证新版本启动超时/失败后自动回滚 previous release。
- [x] 4.4a 提供 Nginx 静态目录发布步骤（先上传包、最后替换 JSON）和发布 JSON 样例。
- [x] 4.4b1 用实际 HTTPS Nginx 容器静态目录分别为 superbpm/hxfl fixture 完成 manifest 发现、相对归档下载、SHA 校验与 release 安装；可设置 `OFFLINE_NGINX_IMAGE`、`OFFLINE_NGINX_DISTRIBUTION_ID` 重跑。
- [ ] 4.4b2 用目标系统实包验收 Windows/Kylin 三平台 manifest 发现、下载与升级。

## 5. 目标验收

- [ ] 5.1 在 Windows 10 x64 PowerShell、麒麟 V10 Server x64 和 ARM64 SSH PTY 实机上，移除全局 Node/npm/pnpm 并断开公网；验收首次启动、内网模型对话/工具调用、Git、Python/npm 项目镜像、数据隔离与恢复。
- [ ] 5.2 验收启动自动提示、手动更新、用户拒绝、SHA 错误、Nginx 离线、升级成功/回滚、工具链保留和程序目录只读等场景；保存版本、平台和测试报告。
- [x] 5.3a `pnpm build` 完整编译通过；最新 `pnpm verify:build`、`pnpm verify:offline`（含直接 DSH wrapper 与隔离回归）、`node scripts/verify-update.mjs`、Node 脚本语法检查、OpenSpec 校验和 `git diff --check` 均通过。
- [x] 5.3b 修正 package smoke 对 `npm pack` 生命周期 stdout 的 JSON 定位，并通过 `pnpm verify:package`（2021 个归档文件、27 个入口目标）。
- [ ] 5.3c 在 PowerShell 与三种麒麟 TTY 手动演练发布/启动路径；目标系统暂不可用。
- [ ] 5.4 完成用户内网 API/仓库验收，交付候选包与 SHA/Nginx JSON 样例；所有实现和验收完成后归档 OpenSpec。生产 Nginx 上传和 Release 发布另行授权。
