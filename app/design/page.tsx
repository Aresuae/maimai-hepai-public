import { ArrowLeft, ArrowRight } from "lucide-react";

export default function DesignPage() {
  return (
    <main className="design-page">
      <header>
        <strong>麦麦合拍 · 产品与技术设计</strong>
        <a className="text-button" href="/">
          <ArrowLeft size={15} /> 返回交互演示
        </a>
      </header>
      <section className="design-intro">
        <span className="eyebrow">DESIGN REVIEW · 2026.10.19</span>
        <h1>
          先把这张餐桌，
          <br />
          一起设计好。
        </h1>
        <p>
          服务 2—6
          人的小聚餐，让每个人独立表达、看懂自己的费用，再共同确认。下面是设计概览；完整细节与可追加的功能讨论表已经保存在项目
          docs 目录。
        </p>
      </section>
      <div className="design-grid">
        <section className="design-card">
          <h2>01 / 首版解决什么</h2>
          <ul>
            <li>不用一个人在群里反复收集和追问。</li>
            <li>每个人的必选项与预算都被尊重。</li>
            <li>餐单变化后，所有人重新确认。</li>
            <li>共享费用有规则，分账合计精确到分。</li>
          </ul>
          <p>首版聚焦一个门店、一位付款人、到店自取。优惠属于实际付款账户。</p>
        </section>
        <section className="design-card">
          <h2>02 / 怎样完成一桌</h2>
          <div className="design-flow">
            {[
              "创建房间",
              "各自选偏好",
              "生成候选",
              "比较与修改",
              "全员确认",
              "重新核价",
              "付款人建单",
            ].map((item, index) => (
              <span key={item}>
                {index + 1}. {item}
              </span>
            ))}
          </div>
          <p style={{ marginTop: 16 }}>
            不能满足时，明确告诉你哪里有分歧；由本人决定要不要调整。
          </p>
        </section>
        <section className="design-card wide">
          <h2>03 / 已实现与下一步</h2>
          <table>
            <thead>
              <tr>
                <th>能力</th>
                <th>当前状态</th>
                <th>接下来</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>个人偏好、候选、分账</td>
                <td>
                  <span className="design-status">单机演示可用</span>
                </td>
                <td>真实菜单的自动组合规划</td>
              </tr>
              <tr>
                <td>版本与逐人确认</td>
                <td>
                  <span className="design-status">角色切换演示</span>
                </td>
                <td>成员认证、服务端事务</td>
              </tr>
              <tr>
                <td>人数、请客、投票、随便、小票、饭搭子</td>
                <td>
                  <span className="design-status">单机交互已实现</span>
                </td>
                <td>真实身份隔离、跨设备协作</td>
              </tr>
              <tr>
                <td>多人房间、持久化、同步</td>
                <td>已设计，未接入</td>
                <td>数据库、API、SSE</td>
              </tr>
              <tr>
                <td>麦当劳 MCP</td>
                <td>本机真实菜单、券与核价已接通</td>
                <td>多用户授权隔离、建单交接</td>
              </tr>
              <tr>
                <td>同城饭搭子匹配</td>
                <td>虚构饭局交互演示</td>
                <td>账号、真实饭局、双向申请与好友关系</td>
              </tr>
              <tr>
                <td>真实下单、AI 输入</td>
                <td>后续阶段</td>
                <td>核心闭环稳定后加入</td>
              </tr>
            </tbody>
          </table>
        </section>
        <section className="design-card">
          <h2>04 / 技术边界</h2>
          <p>React 页面 → 应用 API → 领域逻辑 → 数据仓库 / MCP 适配器。</p>
          <ul>
            <li>AI 将自然语言转成待确认偏好。</li>
            <li>确定性代码负责组合、预算与分账。</li>
            <li>官方 MCP 提供真实菜单和最终核价。</li>
            <li>每份方案有版本，旧确认不能用于新方案。</li>
          </ul>
          <p>
            当前使用 React + TypeScript + Vinext 本地脚手架。领域层不绑定框架。
          </p>
        </section>
        <section className="design-card">
          <h2>05 / 你的创意，已经加入</h2>
          <ul>
            <li>人数自选：2—6 人，昵称可编辑。</li>
            <li>「我请客」：选择请客人和整桌预算，区分餐品金额与应付。</li>
            <li>匿名投票：全员完成才揭晓汇总，平票显式选定。</li>
            <li>「随便」：在预算和排除项内代选主餐，保留其他心愿。</li>
            <li>默契小票：全员确认后复制文本或下载 SVG 图片。</li>
            <li>固定饭搭子：当前浏览器保存、载入、删除，重新开桌需再确认。</li>
            <li>
              同城搭子：按商圈、时间、预算、人数找饭局，双方同意后再一起选餐；当前为演示。
            </li>
          </ul>
          <p>
            当前投票是单机演示，真实匿名需要服务端会话隔离。详细规则见{" "}
            <code>docs/FEATURES_V02.md</code>。
          </p>
        </section>
        <section className="design-card wide">
          <h2>06 / 账户和支付，分清楚再接入</h2>
          <p>
            麦麦合拍账号负责找搭子与房间权限；麦当劳授权负责自己的券、权益和订单。新搭子默认各自下单，朋友局可协商一人代付。
          </p>
          <p>
            官方接口支持建单返回支付链接，目标流程为确认餐单 → 最终核价 →
            本人建单 → 官方支付页 →
            查询官方订单状态。当前只完成核价，尚未创建订单；第三方一键登录协议仍待官方确认。
          </p>
        </section>
        <section className="design-card wide">
          <h2>07 / 完整文档在这里</h2>
          <p>
            <code>docs/PRODUCT.md</code>{" "}
            产品定位、用户流程、功能、业务规则与验收。
          </p>
          <p>
            <code>docs/ARCHITECTURE.md</code>{" "}
            模型、分层、报价、并发、凭证与部署。
          </p>
          <p>
            <code>docs/API.md</code> API、事件与错误契约草案。
          </p>
          <p>
            <code>docs/ROADMAP.md</code> 实施顺序、Token 接入时点与验收。
          </p>
          <p>
            <code>MCP_INTEGRATION.md</code> 官方能力映射与真实接入状态。
          </p>
          <a className="text-button red" href="/" style={{ marginTop: 12 }}>
            用原型检验这些想法 <ArrowRight size={16} />
          </a>
        </section>
      </div>
    </main>
  );
}
