"use client";

export function OfficialMenuCategories({ options, value, onChange, label }: {
  options: { value: string; label: string; count: number }[];
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return <div className="official-menu-categories">
    <p className="official-menu-categories-label">门店官方分类</p>
    <div className="catalog-categories" role="group" aria-label={label}>
      {options.map(option => <button key={option.value} type="button"
        aria-label={`${option.label}，${option.count}款`} aria-pressed={value === option.value}
        className={value === option.value ? "selected" : ""}
        onClick={() => onChange(option.value)}>
        {option.label}<span aria-hidden="true">{option.count}</span>
      </button>)}
    </div>
    <p className="setting-hint">{options.length > 1
      ? "按当前门店官方菜单分类，同一餐品可能出现在多个分类中。"
      : "当前菜单未提供官方分类，可在全部餐品中搜索。"}</p>
  </div>;
}
