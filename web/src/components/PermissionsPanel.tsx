import { useEffect, useState } from "react";
import { useI18n } from "../lib/i18n";
import {
  getPermissions,
  putSettings,
  type Capability,
  type Effect,
  type PermissionModel,
} from "../lib/api";

// Owner's central permission settings: the global default per capability
// (allow / ask / deny, like Claude Code) plus a legend that spells out exactly
// what each trust tier grants — so tiers stop being opaque labels.
export function PermissionsPanel() {
  const { t } = useI18n();
  const [model, setModel] = useState<PermissionModel | null>(null);
  const [busy, setBusy] = useState<Capability | null>(null);

  useEffect(() => {
    let alive = true;
    void getPermissions().then((m) => {
      if (alive) setModel(m);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!model) return null;

  const capLabel = (c: Capability) => t(`perm.cap.${c}`);
  const capDesc = (c: Capability) => t(`perm.cap.${c}.desc`);
  const effLabel = (e: Effect) => t(`perm.effect.${e}`);

  async function setGlobal(cap: Capability, effect: Effect) {
    if (!model) return;
    setBusy(cap);
    try {
      const next = { ...model.globalDefaults, [cap]: effect };
      await putSettings({ permissions: next });
      setModel({ ...model, globalDefaults: next });
    } finally {
      setBusy(null);
    }
  }

  const tiers = Object.keys(model.tierPresets) as (keyof typeof model.tierPresets)[];

  return (
    <div>
      {/* Global defaults */}
      <div
        className="mb-2.5 mt-6 text-[10.5px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--text-muted)" }}
      >
        {t("perm.globalHeading")}
      </div>
      <p className="mb-3 text-[12px]" style={{ color: "var(--text-muted)" }}>
        {t("perm.globalIntro")}
      </p>
      <div className="flex flex-col gap-2.5">
        {model.capabilities.map((cap) => (
          <div
            key={cap}
            className="rounded-xl px-3.5 py-3"
            style={{ background: "var(--surface-card)", border: "1px solid var(--border)" }}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] font-medium" style={{ color: "var(--text)" }}>
                {capLabel(cap)}
              </span>
              <div className="flex shrink-0 items-center gap-1">
                {model.effects.map((e) => (
                  <EffectBtn
                    key={e}
                    active={model.globalDefaults[cap] === e}
                    disabled={busy === cap}
                    effect={e}
                    label={effLabel(e)}
                    onClick={() => void setGlobal(cap, e)}
                  />
                ))}
              </div>
            </div>
            <p className="mt-1.5 text-[12px]" style={{ color: "var(--text-muted)" }}>
              {capDesc(cap)}
            </p>
          </div>
        ))}
      </div>

      {/* Trust-tier legend — what each tier means, made explicit. */}
      <div
        className="mb-2.5 mt-6 text-[10.5px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--text-muted)" }}
      >
        {t("perm.tierHeading")}
      </div>
      <p className="mb-3 text-[12px]" style={{ color: "var(--text-muted)" }}>
        {t("perm.tierIntro")}
      </p>
      <div
        className="overflow-hidden rounded-xl"
        style={{ border: "1px solid var(--border)" }}
      >
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr style={{ background: "var(--surface-card)" }}>
              <th
                className="px-3 py-2 text-left font-semibold"
                style={{ color: "var(--text-secondary)", borderBottom: "1px solid var(--border)" }}
              >
                {t("perm.tierCol")}
              </th>
              {model.capabilities.map((cap) => (
                <th
                  key={cap}
                  className="px-2 py-2 text-center font-semibold"
                  style={{ color: "var(--text-secondary)", borderBottom: "1px solid var(--border)" }}
                >
                  {capLabel(cap)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tiers.map((tier) => (
              <tr key={tier}>
                <td
                  className="px-3 py-2"
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  <span className="font-medium" style={{ color: "var(--text)" }}>
                    {t(`trust.${tier}`)}
                  </span>
                </td>
                {model.capabilities.map((cap) => {
                  const eff = model.tierPresets[tier][cap];
                  return (
                    <td
                      key={cap}
                      className="px-2 py-2 text-center"
                      style={{ borderBottom: "1px solid var(--border)" }}
                    >
                      {eff ? (
                        <EffectChip effect={eff} label={effLabel(eff)} />
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>
                          {t("perm.inheritShort")}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11.5px]" style={{ color: "var(--text-muted)" }}>
        {t("perm.tierNote")}
      </p>
    </div>
  );
}

const EFFECT_COLOR: Record<Effect, string> = {
  allow: "var(--green)",
  ask: "var(--accent)",
  deny: "var(--red, #e5484d)",
};

function EffectBtn({
  active,
  disabled,
  effect,
  label,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  effect: Effect;
  label: string;
  onClick: () => void;
}) {
  const color = EFFECT_COLOR[effect];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors disabled:opacity-50"
      style={{
        color: active ? "#fff" : "var(--text-secondary)",
        background: active ? color : "var(--bg-sidebar)",
        border: `1px solid ${active ? color : "var(--border)"}`,
      }}
    >
      {label}
    </button>
  );
}

function EffectChip({ effect, label }: { effect: Effect; label: string }) {
  const color = EFFECT_COLOR[effect];
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ color, background: "color-mix(in srgb, " + color + " 14%, transparent)", border: `1px solid color-mix(in srgb, ${color} 35%, transparent)` }}
    >
      {label}
    </span>
  );
}
