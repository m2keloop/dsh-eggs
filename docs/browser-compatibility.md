# Epic 浏览器兼容性与后续验证

2026-11-19 的实际观察：用户日常浏览器能显示 Epic 登录页；通过 Playwright 启动的独立可见浏览器在登录时反复出现 Cloudflare 安全检查，真实登录与领取未完成。Cloudflare [不支持通过 Playwright 等自动化浏览器解决生产环境挑战](https://developers.cloudflare.com/cloudflare-challenges/reference/supported-browsers/)。这支持将自动化环境列为原因之一，但不能单凭页面断定具体触发原因。

现有可用的回退路径是在 DSH 福利页面按国家或地区查询 Epic 公开免费目录，再由用户在日常浏览器中打开商品页自行完成领取。此路径不读写账号或凭据；地区、价格和资格以 Epic 页面为准。

## 可研究方向：浏览器本地协作

一种待验证方向是由用户主动安装开源浏览器扩展，在日常浏览器中自行登录，由扩展只在获准的 Epic 页面工作；DSH 使用浏览器支持的本地消息协议与扩展交换限定格式的任务和结果。账号的 Cookie 和密码可以保留在浏览器内，不必复制到 DSH 或模型。Chrome 的 [Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging) 要求扩展声明权限，并通过 host 清单的 `allowed_origins` 限定扩展 ID。

仓库的 `experiments/browser-bridge/` 仅包含一个通信与页面状态实验：扩展声明 `nativeMessaging`、`activeTab`、`scripting` 权限，不申请持久站点权限或 Cookie 权限。用户主动点击「检查当前 Epic 页面」时，代码仅在当前标签属于 Epic 官方域名时读取登录标记、匹配按钮文本并检查安全验证是否存在；仅将固定布尔状态返回扩展弹窗，不返回原始按钮文本，也不读取账号详情、输入框、Cookie 或其他网站。在隔离的 Chrome for Testing profile 和隔离 DSH Web Host 中，已验证扩展经本地消息程序与 DSH 内实验插件的私有 Unix socket 互通，并验证错误的扩展来源被浏览器拒绝。该实验没有安装到日常浏览器，也没有集成到正式插件，更没有登录或领取能力。Socket 只用于合成测试，不对同一系统用户的恶意进程提供隔离。

另一个合成端到端测试已跑通 DSH 原生 Schedule → Agent → `egg_run` → 模拟领取器 → 本地桥接 → 隔离浏览器扩展 → 关联回执 → 模拟持有状态核验。模型和领取器使用合成数据；扩展的回执只代表收到测试任务，不代表真实网站操作成功。

页面状态桥接也已在合成页面中验证：用户主动点击扩展授权当前标签后，实验 Host 可请求固定的登录、按钮和安全验证状态。未授权标签时返回不可用；消息协议拒绝额外字段。实验并不传输 Cookie、表单输入或原始网页内容，也不能下单。

`experiments/epic-page-check/` 是独立的只读页面检测实验，只使用 `activeTab` 和 `scripting`，不具备本地消息能力；已在隔离浏览器的合成页面中验证点击行为。它可以帮助用户在自己允许的情况下检查正常浏览器中的 Epic 页面，但不能登录、领取或向 DSH 发送数据。实际 Chrome 权限会允许扩展在用户调用时访问当前标签页，因此必须审查源码并由用户决定是否安装。

2026-11-20 经用户主动安装只读实验扩展并自行登录，在正常 Chrome 的真实 Epic 商品页检测到：已登录、领取按钮可见、未发现安全验证。没有读取或保存账号凭据，也没有提交领取。此结果只证明用户主动点击的只读检查可用；`activeTab` 授权只针对用户调用时的标签页，导航到其他来源或关闭标签页后会失效，不能据此承诺无人值守领取。[Chrome activeTab 权限说明](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab/)

同次检查中，商品的领取入口先显示设备不受支持的提示；继续后出现结算框，但现有实验无法可靠识别最终订单总额，未提交订单。正式领取器因此在结算阶段固定停止并提示用户处理，合成页面中的零元标记不足以证明真实 Epic 的结算安全。

后续使用日常浏览器重新检查同一商品，结算框加载后显示 `CN¥0.00` 和接受最终用户许可协议的提示。经用户明确同意该次领取及条款后，浏览器完成领取，商品页显示 `In Library`。此验证不涉及本插件凭据或定时任务，也不代表已实现自动下单。

本机可选复现（需要 Chrome for Testing 146+，测试 profile 只在系统临时目录创建并删除）：

```sh
DSH_EGGS_TEST_CHROMIUM_CFT=/path/to/chrome-for-testing node --test tests/browser-bridge-chrome.test.js
DSH_EGGS_TEST_CHROMIUM_CFT=/path/to/chrome-for-testing node --test tests/host-schedule.test.js
```

浏览器协作不保证一定能领取：站点仍可能拦截扩展发起的自动操作，验证码、二次验证、地区限制及付费总额都必须交给用户或停止。不能隐藏自动化行为，也不能绕过站点的安全验证。

如果继续做原型，需要先满足：

1. 开发阶段在独立浏览器 profile 和合成页面验证；默认不读取日常浏览器的 Cookie、密码、其他网站页面或全部标签页。
2. 仅在用户明确安装并授权后运行；权限仅限实现所需的 Epic 域名，不申请 `<all_urls>`、`debugger`、通用 Cookie 导出或无关站点权限。具体权限仍需通过原型验证。
3. Native host 仅接受明确允许的扩展来源；所有本地通信采用有界消息、明确的命令白名单和用户级权限。页面或 content script 的输入按不可信数据处理；不传任意脚本、路径、网站地址或原始凭据。
4. 本地 Host 负责原生 Schedule、配置和去重；浏览器必须运行且扩展可用。运行和所有权验证结果必须区分成功、失败、未知、等待用户；不能把消息投递当成领取成功。
5. 真实站点验证由用户自行完成登录和验证，先检查最终订单金额为零，再由可核验的持有状态确认成功。无法验证金额、出现安全挑战或页面结构变化时停止。

Chrome 本地消息协议是连接机制，不能证明站点允许任何特定自动化行为。正式方案还需要在目标浏览器版本验证扩展生命周期、消息断线恢复、授权撤销和隐私边界。
