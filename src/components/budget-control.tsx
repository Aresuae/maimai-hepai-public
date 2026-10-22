"use client";
import { useEffect, useState } from "react";
export function BudgetControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value / 100));
  const [error, setError] = useState("");
  useEffect(() => {
    setDraft(String(value / 100));
  }, [value]);
  function apply() {
    const amount = Number(draft);
    if (!/^\d+(\.\d{1,2})?$/.test(draft) || amount < 1 || amount > 1000) {
      setError("请输入 1—1000 元，最多两位小数。");
      return;
    }
    setError("");
    onChange(Math.round(amount * 100));
  }
  return (
    <div className="budget-block">
      <label htmlFor="budget">
        这顿最多花多少？<strong>¥{value / 100}</strong>
      </label>
      <input
        id="budget"
        aria-label="预算滑块"
        type="range"
        min="10"
        max="200"
        step="5"
        value={Math.min(200, Math.max(10, value / 100))}
        onChange={(e) => {
          setError("");
          onChange(Number(e.target.value) * 100);
        }}
      />
      <div className="range-labels">
        <span>¥10</span>
        <span>预算是上限</span>
        <span>¥200</span>
      </div>
      <div className="budget-presets">
        {[30, 50, 80, 100, 200].map((n) => (
          <button
            key={n}
            type="button"
            className={value === n * 100 ? "selected" : ""}
            onClick={() => {
              setError("");
              onChange(n * 100);
            }}
          >
            ¥{n}
          </button>
        ))}
      </div>
      <div className="budget-input">
        <input
          aria-label="自定义个人预算（元）"
          type="number"
          min="1"
          max="1000"
          step="0.01"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") apply();
          }}
        />
        <button className="text-button" onClick={apply}>
          应用预算
        </button>
      </div>
      <p className="setting-hint">支持手动输入，最高 ¥1,000。</p>
      {error && (
        <p role="alert" className="error-notice">
          {error}
        </p>
      )}
    </div>
  );
}
