import { useMemo, useState } from "react";
import Icon from "../../components/ui/Icon";
import { FreeBadge, Menu, MenuItem } from "../../components/ui/primitives";
import { formatWait } from "../../lib/format";
import type { ChainModel } from "../../lib/types";

interface ModelPickerProps {
  /** The models that may answer, in fallback order. */
  models: ChainModel[];
  /** Selected model id, or null for automatic. */
  value: string | null;
  onChange: (id: string | null) => void;
  /** Opens the model settings; omitted when the user may not change them. */
  onManage?: () => void;
}

const SEARCH_FROM = 9; // show the search box once the list is this long

/** Composer menu for choosing which model answers, grouped by provider. */
export default function ModelPicker({ models, value, onChange, onManage }: ModelPickerProps) {
  const [query, setQuery] = useState("");
  const selected = models.find((m) => m.id === value) ?? null;

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const byProvider = new Map<string, { name: string; models: ChainModel[] }>();
    for (const model of models) {
      if (needle && !`${model.label} ${model.model} ${model.provider_name}`.toLowerCase().includes(needle)) continue;
      const group = byProvider.get(model.provider) ?? { name: model.provider_name, models: [] };
      group.models.push(model);
      byProvider.set(model.provider, group);
    }
    return [...byProvider.values()];
  }, [models, query]);

  return (
    <Menu
      direction="up"
      trigger={(toggle) => (
        <button type="button" className="composer-model" onClick={toggle} title="Choose which model answers">
          <Icon name="cpu" size={15} />
          <span className="truncate">{selected ? selected.label : "Auto"}</span>
          <Icon name="chevronUp" size={13} />
        </button>
      )}
    >
      {(close) => {
        const pick = (id: string | null) => {
          onChange(id);
          setQuery("");
          close();
        };
        return (
          <div className="model-menu">
            {models.length >= SEARCH_FROM && (
              <div className="input-icon">
                <Icon name="search" size={15} />
                <input className="input" autoFocus placeholder="Search models" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
            )}
            <div className="model-menu-list">
              {!query.trim() && (
                <MenuItem icon="sparkles" label="Auto" hint="Best available model, with automatic fallback" active={!selected} onClick={() => pick(null)} />
              )}
              {groups.map((group) => (
                <div key={group.name}>
                  <div className="menu-label">{group.name}</div>
                  {group.models.map((model) => (
                    <button
                      key={model.id}
                      type="button"
                      role="menuitem"
                      className={`menu-item ${model.id === selected?.id ? "on" : ""} ${model.state === "cooldown" ? "resting" : ""}`}
                      onClick={() => pick(model.id)}
                    >
                      <span className="model-menu-name">
                        {model.label}
                        {model.state === "cooldown" && <small>Resting · back in {formatWait(model.cooldown_seconds)}</small>}
                      </span>
                      <FreeBadge free={model.free} />
                      {model.id === selected?.id && <Icon name="check" size={15} />}
                    </button>
                  ))}
                </div>
              ))}
              {groups.length === 0 && (
                <div className="panel-empty">{models.length ? "No models match." : "No model is available yet."}</div>
              )}
            </div>
            {onManage && (
              <button type="button" className="menu-item model-menu-foot" onClick={() => { close(); onManage(); }}>
                <Icon name="settings" size={16} />
                <span>Manage models</span>
              </button>
            )}
          </div>
        );
      }}
    </Menu>
  );
}
