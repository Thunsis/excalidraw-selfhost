// 多类型 mermaid 回归测试：纯 Node 转换后检查元素质量
// 运行: cd cli && node tests/regression-official.js
const path = require("path");
process.chdir(path.join(__dirname, ".."));
const official = require(path.join(__dirname, "..", "src", "official"));

const CASES = {
  // 必须完全通过：元素完整、无零尺寸（与浏览器基准逐像素对齐）
  "flowchart-中文": {
    strict: true,
    mmd: `flowchart TD
    A[用户登录] --> B{验证通过?}
    B -->|是| C[进入主页]
    B -->|否| D[提示错误]`,
  },
  "flowchart-英文长文本": {
    strict: true,
    mmd: `flowchart LR
    A[Initialize payment gateway connection] --> B[Validate merchant credentials]
    B --> C{Retry policy enabled?}
    C -->|Yes| D[Apply exponential backoff with jitter]
    C -->|No| E[Fail immediately]`,
  },
  // 官方边界：m2e 转换器对 sequence 的 line points 本来就是 null（浏览器同样）
  "sequence-已知边界": {
    strict: false,
    mmd: `sequenceDiagram
    participant 用户
    participant 服务器
    participant 数据库
    用户->>服务器: 提交订单
    服务器->>数据库: 检查库存
    数据库-->>服务器: 库存充足
    服务器->>用户: 确认订单`,
  },
  // 官方边界：class/er/state/gantt 在浏览器里同样降级为 graphImage
  "class-官方降级": { strict: false, expectImage: true, mmd: `classDiagram
    class Animal {
      +String name
      +int age
      +makeSound() void
    }
    class Dog {
      +fetch() void
    }
    Animal <|-- Dog` },
  "er-官方降级": { strict: false, expectImage: true, mmd: `erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE_ITEM : contains` },
  "state-官方降级": { strict: false, expectImage: true, mmd: `stateDiagram-v2
    [*] --> Idle
    Idle --> Processing : submit
    Processing --> Success : complete
    Processing --> Failed : error
    Success --> [*]
    Failed --> Idle : retry` },
  "gantt-官方降级": { strict: false, expectImage: true, mmd: `gantt
    title 项目计划
    dateFormat YYYY-MM-DD
    section 设计
    需求分析: done, a1, 2026-08-01, 3d` },
};

(async () => {
  let fail = 0;
  for (const [name, c] of Object.entries(CASES)) {
    try {
      const t0 = Date.now();
      const els = await official.convertMermaid(c.mmd);
      const ms = Date.now() - t0;
      if (c.expectImage) {
        // 官方边界类型：应报"不支持"错误（降级保护）
        fail++;
        console.log(`❌ ${name.padEnd(18)} — 期望降级报错，实际转换出 ${els.length} 元素`);
        continue;
      }
      const bad = [];
      for (const e of els) {
        if (typeof e.x !== "number" || isNaN(e.x) || typeof e.y !== "number" || isNaN(e.y)) {
          bad.push(`coord NaN: ${e.type} ${e.id}`);
        }
        if (typeof e.width === "number" && (isNaN(e.width) || e.width < 0)) bad.push(`width bad: ${e.type} ${e.id} = ${e.width}`);
        if (typeof e.height === "number" && (isNaN(e.height) || e.height < 0)) bad.push(`height bad: ${e.type} ${e.id} = ${e.height}`);
      }
      const shapes = els.filter((e) => e.type !== "text" && e.type !== "arrow");
      const zeroShapes = shapes.filter((e) => (e.width || 0) < 2 || (e.height || 0) < 2);
      // 已知官方边界：sequence 的 line points 为 null（浏览器同样）→ 不算零尺寸
      const zeroReal = zeroShapes.filter((e) => e.type !== "line");
      const types = {};
      for (const e of els) types[e.type] = (types[e.type] || 0) + 1;
      const status = bad.length === 0 && zeroReal.length === 0 ? "✅" : "❌";
      if (bad.length || zeroReal.length) fail++;
      console.log(`${status} ${name.padEnd(18)} ${ms}ms  els=${els.length}  types=${JSON.stringify(types)}`);
      if (bad.length) console.log(`    bad: ${bad.slice(0, 5).join("; ")}`);
      if (zeroReal.length) console.log(`    zero-size shapes: ${zeroReal.slice(0, 5).map((e) => `${e.type} ${e.id}`).join(", ")}`);
      if (zeroShapes.length && zeroReal.length === 0) console.log(`    (${zeroShapes.length} zero-size line = known m2e sequence boundary, browser same)`);
      const xs = els.map((e) => e.x), ys = els.map((e) => e.y);
      console.log(`    bounds: x ${Math.min(...xs).toFixed(0)}..${Math.max(...xs).toFixed(0)}, y ${Math.min(...ys).toFixed(0)}..${Math.max(...ys).toFixed(0)}`);
    } catch (e) {
      if (c.expectImage) {
        const ok = /not natively supported/.test(e.message);
        if (!ok) fail++;
        console.log(`${ok ? "✅" : "❌"} ${name.padEnd(18)} — ${ok ? "降级保护生效" : "意外错误: " + e.message.slice(0, 100)}`);
      } else {
        fail++;
        console.log(`❌ ${name} — ${e.message.slice(0, 200)}`);
      }
    }
  }
  console.log(`\n${fail === 0 ? "ALL PASS ✅" : `${fail} FAILED ❌`}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
