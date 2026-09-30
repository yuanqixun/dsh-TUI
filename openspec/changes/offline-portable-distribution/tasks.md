# Tasks

本文件跟踪未来实现；本次提案更新不代表实现完成。未确认目标系统镜像、版本与真实构建配置前，不得将未测平台列为已支持。

## 1. 固定构建输入和平台基线

- [ ] 1.1 确认 Windows 10 x64、麒麟 V10 Server x64/ARM64 的实际镜像/补丁级别、CPU、glibc 和 SSH/PowerShell 终端矩阵；按三种目标分别验证 Node、Git、Python 与依赖原生模块加载。
- [ ] 1.2 建立非敏感打包输入文件模板，字段含 npm registry、Python index、Nginx manifest URL、release notes 等；提供实际配置后验证缺字段/URL 错误时 fail-fast，敏感凭证不进入包和构建日志。
- [ ] 1.3 盘点当前 DSH Cordis composition 的运行时闭包和每个工具版本/许可，固定构建版本并生成可审阅 manifest；以依赖树、加载探针和许可报告验证。
- [ ] 1.4 为 Nginx v1 JSON 编写 JSON Schema 与示例，定义平台键、SemVer、静态相对资产 URL、字节数和 SHA-256；用有效/无效 fixture 验证契约。

## 2. 构建完整初装包与客户端更新包

- [ ] 2.1 新增独立初装和 client-update 构建入口，分别产出 Windows ZIP 与两个麒麟 TAR.GZ 目标；验证首次包包含 Git/Python/单套 DSH Node+客户端、更新包不含工具层。
- [ ] 2.2 从当前源码构建 dsh-TUI、dsh-auth、dsh-std 和冻结生产依赖，固定工具层 Node 版本并校验 DSH/原生依赖兼容；扫描归档无旧 standalone 版本、构建机链接、缓存和用户数据。
- [ ] 2.3 安装/配置包内 Git/Python/Node 的目标平台文件、Windows Git Bash、npm/pip 内网默认源；在每个平台用样例 Node/Python 项目从内部镜像安装依赖。
- [ ] 2.4 生成 manifest、平台版本清单、许可证、README、SHA-256 和给 Nginx 的 JSON；验证 SHA 对应实际下载字节、文件尺寸和架构键。

## 3. 启动器与状态隔离

- [ ] 3.1 实现 PowerShell 启动器和 Linux sh 启动器，支持任意可写路径及中文/空格路径；验证 cwd、参数、退出码、Git/Python/Node 环境对父 shell 无副作用。
- [ ] 3.2 新建 `DSH_TUI_OFFLINE_HOME` 用户数据根和统一 TUI 路径 resolver；盘点并测试所有 TUI-owned settings/preferences/session metadata/cache 与 DSH_HOME 隔离，不影响其他客户端状态。
- [ ] 3.3 首次只创建缺省 profile，不覆盖自定义值；验证模型端点/凭证由 provider 和 DSH store 持久化，重启和程序目录搬迁后可继续使用。
- [ ] 3.4 同步中英文用户文档，说明 TTY、SSH PTY、宿主 CA 信任、npm/Python 镜像预置、外置 JDK/Maven 与数据目录；按文档步骤在干净目标系统首启。

## 4. Nginx 更新客户端

- [ ] 4.1 更新启动自动检查、手动检查和 `dsh-tui update` 所有入口，改用打包时配置的 Nginx manifest；回归证明没有 GitHub/npm fallback，检查失败不阻塞会话。
- [ ] 4.2 实现 v1 schema/platform/version/HTTPS 同源 URL/size/SHA-256 校验及有界下载；构造超时、坏 JSON、无平台包、超限包和 checksum 错误 fixture，确认不改当前版本。
- [ ] 4.3 实现显式确认后下载至私有缓存、release staging、跨平台活跃版本切换和上一版本回退；验证拒绝时不下载、无写权限时提示手动替换、失败时保留工具层和用户数据。
- [ ] 4.4 交付 Nginx 静态目录发布说明（先上传包、最后替换 JSON）和发布 JSON 样例；用手动部署的 Nginx 静态 fixture 演练 Windows/Kylin 三平台版本发现、下载与升级。

## 5. 目标验收

- [ ] 5.1 在 Windows 10 x64 PowerShell、麒麟 V10 Server x64 和 ARM64 SSH PTY 实机上，移除全局 Node/npm/pnpm 并断开公网；验收首次启动、内网模型对话/工具调用、Git、Python/npm 项目镜像、数据隔离与恢复。
- [ ] 5.2 验收启动自动提示、手动更新、用户拒绝、SHA 错误、Nginx 离线、升级成功/回滚、工具链保留和程序目录只读等场景；保存版本、平台和测试报告。
- [ ] 5.3 按仓库贡献契约运行与改动面匹配的构建门禁、包校验及 CI 聚焦回归；终端路径分别演练 PowerShell 与三种麒麟 TTY，失败平台不发布支持声明。
- [ ] 5.4 完成用户内网 API/仓库验收，发布候选包与 SHA/Nginx JSON 样例；只有所有实现和验收项完成后归档 OpenSpec，生产 Nginx 上传和 Release 发布另行授权。
