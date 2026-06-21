import { useEffect, useState } from "react";
import { useI18n } from "../lib/i18n";
import {
  getAgentPolicies,
  getPermissionsCached,
  setAgentPolicy,
  type Capability,
  type Effect,
  type PermissionModel,
} from "../lib/api";

// Per-contact permission control. For each capability it shows the effect in
// force for this agent (its override, or the owner global default) and lets you
// pin an override for just this agent: allow / ask / deny, or Default to follow
// the global setting.
export function PermissionsForAgent({ sessionId }: { sessionId: string }) {
  const { t } = useI18n();
  const [model, setModel] = useState<PermissionModel | null>(null);
  const [overrides, setOverrides] = useState<Partial<Record<Capability, Effect>>>({});
  const [busy, setBusy] = useState<Capability | null>(null);

  useEffect(() => {
    let alive = true;
    void getPermissionsCached().then((m) => alive && setModel(m));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void getAgentPolicies(sessionId).then((p) => alive && setOverrides(p));
    return () => {
      alive = false;
    };
  }, [sessionId]);

  if (!model) return null;

  // register_agent is decided once at admission, not per established contact.
  const caps = model.capabilities.filter((c) => c !== "register_agent");

  async function choose(cap: Capability, effect: Effect | null) {
    setBusy(cap);
    try {
      const next = await setAgentPolicy(sessionId, cap, effect);
      setOverrides(next);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      {caps.map((cap) => {
        const override = overrides[cap] ?? null;
        const effective = override ?? model.globalDefaults[cap];
        return (
          <div
            key={cap}
            className="rounded-lg px-3 py-2.5"
            style={{ background: "var(--surface-card)", border: "1px solid var(--border)" }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12.5px] font-medium" style={{ color: "var(--text)" }}>
                {t(`perm.cap.${cap}`)}
              </span>
              <EffectChip effect={effective} label={t(`perm.effect.${effective}`)} />
            </div>
            {/* Override control: Default | Allow | Ask | Deny */}
            <div className="mt-2 flex flex-wrap items-center gap-1">
              <OverrideBtn
                active={override === null}
                disabled={busy === cap}
                label={t("perm.override.default")}
                onClick={() => void choose(cap, null)}
              />
              {model.effects.map((e) => (
                <OverrideBtn
                  key={e}
                  active={override === e}
                  disabled={busy === cap}
                  label={t(`perm.effect.${e}`)}
                  effect={e}
                  onClick={() => void choose(cap, e)}
                />
              ))}
            </div>
          </div>
        );
      })}
      <p className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>
        {t("perm.override.note")}
      </p>
    </div>
  );
}

const EFFECT_COLOR: Record<Effect, string> = {
  allow: "var(--green)",
  ask: "var(--accent)",
  deny: "var(--red, #e5484d)",
};

function EffectChip({ effect, label }: { effect: Effect; label: string }) {
  const color = EFFECT_COLOR[effect];
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{
        color,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
      }}
    >
      {label}
    </span>
  );
}

function OverrideBtn({
  active,
  disabled,
  label,
  effect,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  label: string;
  effect?: Effect;
  onClick: () => void;
}) {
  const color = effect ? EFFECT_COLOR[effect] : "var(--text-secondary)";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-md px-2 py-0.5 text-[11.5px] font-medium transition-colors disabled:opacity-50"
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
