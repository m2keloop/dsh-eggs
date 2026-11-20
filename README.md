# DSH Eggs

DSH Eggs 是一个运行在用户电脑上的 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 福利领取插件。它以福利为入口管理领取配置，计划复用 DSH 原生定时任务执行领取，并允许贡献者通过 Pull Request 增加领取器。

> **项目状态：实验阶段，尚不可用于真实账号自动领取。** 目前可以查询 Epic 公开限免目录，并已用合成数据验证 DSH 定时链路。本机浏览器的一次真实零元领取已人工验证，但插件自己的登录、自动结算和到账核验尚未打通；当前插件在结算阶段会停止，不会自动提交订单。请勿将实验功能接入日常 DSH profile。

## 目标与进度

| 能力 | 当前状态 |
| --- | --- |
| Epic 限免目录 | 可按国家或地区查询公开信息，并打开 Epic 商品页自行领取 |
| 福利配置 | 实验页面可创建、删除本地配置并查看最近一次执行结果 |
| DSH 定时任务 | 已用合成模型和模拟领取器验证原生 Schedule → Agent → `egg_run`；实际执行依赖 DSH 和模型正常运行 |
| 本地凭据 | 会话快照使用 AES-256-GCM 加密，密钥由系统凭据库管理；真实 Epic 登录及跨平台适配尚未完成验证 |
| Epic 自动领取 | 未完成。独立自动化浏览器曾遇到安全验证，真实账号接入、结算检查和到账核验仍需实现和验证 |
| 其他福利 | 尚未接入；欢迎贡献领取器 |

真实验证范围与限制见 [验证记录](docs/p0-validation.md) 和 [Epic 实现调研](docs/epic-implementation-research.md)。

## 工作方式

```text
DSH 设置页面 ──► 福利目录与配置 ──► 福利适配器 ──► 福利平台
                       ▲
DSH 原生 Schedule ──► 专用 Agent ──► egg_run
                       │
                 本机加密会话与记录
```

插件不另建定时调度器。DSH Schedule 向专用 Agent 投递任务，Agent 调用 `egg_run`，领取器发现机会、核验状态并执行平台操作。**任务投递成功不等于领取成功**；DSH 未运行、模型不可用或未调用工具时，领取不会发生。

每个福利负责自己的登录、领取和核验逻辑，公共运行层负责配置、凭据存储、并发控制及结果记录。当前只有 Epic 适配器，接口仍可能变化。

## 开发与本地体验

需要 Node.js **24.9.0 或更高版本**。体验 DSH 设置页面还需要已安装 DSH **0.2.2-rc.5** 和 pnpm。

```sh
git clone https://github.com/m2keloop/dsh-eggs.git
cd dsh-eggs
npm ci
npm test
```

使用临时 DSH 数据目录启动 Web profile，体验福利目录和公开游戏查询：

```sh
export DSH_HOME="$(mktemp -d)"
dsh plugin --profile web add "link:$PWD"
dsh --profile web
```

在 DSH 设置中打开「福利领取」，输入两位国家或地区代码，例如 `CN`，点击「查询」。查询结果来自 Epic 公开目录，不代表当前账号一定符合领取条件。`DSH_HOME` 只在当前终端会话生效；测试数据存放在命令创建的临时目录中。

可选的隔离浏览器和 macOS 临时钥匙串测试及复现条件见 [验证记录](docs/p0-validation.md)。这些测试使用合成数据，不应提供真实账号凭据。

## 隐私与安全

- 项目不提供集中式账号数据库、云同步或邮件服务。福利配置、会话快照和执行记录保存在运行 DSH Host 的本机；实际位置由 DSH 数据目录决定。
- 已实现的会话快照在本地加密，密钥使用系统凭据库。用户密码、Cookie 和 Token 不作为模型工具参数；平台登录和必要请求仍会连接对应平台。
- 浏览器自身的 profile 和临时文件不等同于插件的加密会话文件，异常退出后的残留处理尚未全面验证。系统凭据库适配器尚未完成各平台的真实端到端验证；Windows 写锁目前不支持。
- 本项目尚未经过独立安全审计。同一系统用户的其他进程、同进程插件以及 DSH 自身的日志和遥测配置不在本插件的隔离范围内。
- 验证码、账号验证、协议确认或无法核实的费用需要用户处理；项目不应绕过平台安全验证，也不会把未知结果当作领取成功。

更详细的存储设计、权限边界和已知限制见 [技术方案](docs/technical-design.md) 和 [验证记录](docs/p0-validation.md)。

## 贡献领取器

欢迎提交 Issue 和 Pull Request。新增福利时，请先阅读 [领取器开发说明](docs/adapter-development.md)：描述福利来源、地区条件、登录方式、所需域名、领取与到账核验方式，并提供使用合成数据的测试。不要提交真实账号、凭据、结算链接或包含个人信息的截图。

领取器由项目审查并注册，福利目录不会下载或执行远程代码。认证失效、平台验证、非零金额和无法判断的结果都应明确返回，不能报告虚假成功。

## 文档

- [技术方案](docs/technical-design.md)：架构、数据流和安全设计
- [领取器开发说明](docs/adapter-development.md)：适配器接口与 PR 要求
- [验证记录](docs/p0-validation.md)：已验证内容、复现方法和限制
- [Epic 浏览器兼容性](docs/browser-compatibility.md)：登录障碍与本地浏览器实验
- [Epic 实现调研](docs/epic-implementation-research.md)：结算与到账核验的候选方案

DSH Eggs 是社区项目，与 Epic Games 和 DeepSeek Harness 官方无隶属关系。

## 许可证

本项目使用 [MIT License](LICENSE)。
