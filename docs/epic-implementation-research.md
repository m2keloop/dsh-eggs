# Epic 自动领取调研与验证边界

2026-11-20 调研结果。以下是候选方向和证据，不表示本项目已完成真实领取。

## 现有项目

- [Claim-Free-Games](https://github.com/KingHacker9000/Claim-Free-Games) 声称先查询账号权益，再尝试 Launcher 的 `quickPurchase`，最后重新查询权益；失败时由浏览器协助。它明确说明该接口不是公开的消费者 API。其 [实现](https://github.com/KingHacker9000/Claim-Free-Games/blob/f4bc6ebac823d771755f21dc23f535a4c388e48c/src/epic-api.ts) 中的调用没有证明最终总额恒为零，本项目不能据此直接启用下单；该仓库未发现许可文件，未复制其代码。
- [epicgames-freegames-node](https://github.com/claabs/epicgames-freegames-node) 当前通过设备授权等方式检查权益，但购买改为用户打开结算链接自行完成；其 [v5 说明](https://github.com/claabs/epicgames-freegames-node/releases) 指出自动化检测是调整原因。不能把它当前的自动发现视为全自动领取。
- Epic 商城曾在其 [促销页面](https://store.epicgames.com/news/massive-discounts-and-limitless-10-off-coupons-hit-the-epic-games-store?lang=zh-CN) 提及小黑盒领取活动，但这不公开小黑盒的账号授权、结算和后台实现，不能据此推断第三方项目能够复用相同权限。

## 到账核验

Epic 的 [权益数据说明](https://dev.epicgames.com/docs/api-ref/structs/eos-ecom-entitlement?lang=en-US&slug=api-ref%2Cinterfaces) 将权益关联到 `catalogItemId`；该 ID 与优惠的 `offerId` 语义不同。现在发现结果保留有效的商品 ID，新的实验纯函数只在每个商品都有同 namespace、`ACTIVE` 的权益时返回 `owned`；缺失、撤销或未知结构均返回 `unknown`。这是合成数据验证，尚未验证权益的有效期字段，也未接入真实账号接口，不证明该账号对所有游戏都有可用查询权限。

新增的实验查询函数使用账号令牌调用权益只读接口，限制页数、响应大小和重定向，只输出固定状态；它尚未连接到生产领取器。接口权限、分页完整性和字段含义仍需用真实授权验证，不能把实验结果当作生产能力。

## 还需验证

1. 在用户本机完成可撤销的授权，确认其客户端身份、权限、短期访问令牌和刷新流程；令牌不得进入模型或日志。第三方客户端的令牌不能假定一定有订单和权益权限。
2. 核实接口的零元订单预览及实际提交约束、地区与时间变化，不能把目录价格当作最终成交价。无法证明总价恒为零时不能使用一次性下单接口。
3. 以真实账号验证商品 ID、权益状态和新领取后数据；请求失败、权限不足、延迟到账和分页不完整都不能认定未持有。
4. 重新验证当前浏览器连接后，由用户在 Epic 官方页面处理验证或协议。自动化环境、身份验证与平台条款限制仍可能要求人工操作。

2026-11-20 的日常浏览器中，结算弹窗加载后显示《Mark of the Deep》为 `CN¥0.00`，并提供“Add to library”按钮。页面称点击按钮即确认年龄、支付方式使用资格并接受最终用户许可协议；经用户对该商品与条款明确同意后，在浏览器中完成了领取，商品页显示 `In Library`。这是商品页状态验证，尚未查询真实账号权益；也不能单独证明其他商品、地区或未来的最终金额，更不能用目录价格代替结算金额。

后续已切换到 Epic 的 IPv4 公开目录端点，当前环境下以中国和美国地区查询均成功发现当期游戏；该查询无需账号。Chrome 浏览器控制连接此前不可用，原生窗口可以检查结算页面。商品页还会跳转到带 `lang=en-US` 的本地化地址；只允许这一确定的查询参数，拒绝其他参数。

[Fab Free Claimer 的测试记录](https://github.com/basarersek/fab-tools/blob/d1a1d0cc90ee3947da8cfc428d5f9ba075d82301/claimer/TESTING.md)展示了 Epic 另一商城的结算预览中，检查单个目标商品、总价、实付、奖励抵扣和支付项目的思路。本项目新增仅用于合成测试的严格预览检查函数；这份 Fab 数据结构尚未在 Epic 游戏商城真实结算中验证，不能用来解除当前下单保护。
