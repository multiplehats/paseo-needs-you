import type { PluginClientContext, PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  ScrollView,
  SettingsAction,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
} from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Text } from "react-native";
import { type Provider, PROVIDER_INFO, PROVIDERS } from "../shared/jev";
import { type DetectionStatus, saveRpc, statusRpc, testRpc } from "../shared/rpc";
import type { Store } from "./store";

type Choice = Provider | "rules";

const OPTIONS: { label: string; value: Choice }[] = [
  { label: "Text rules (no key needed)", value: "rules" },
  ...PROVIDERS.map((value) => ({ label: `Jev via ${PROVIDER_INFO[value].label}`, value })),
];

function keyHint(status: DetectionStatus | null, choice: Provider) {
  if (status?.provider === choice && status.keySource === "saved")
    return "A key is saved on this host. Enter a new one to replace it.";
  if (status?.provider === choice && status.keySource === "environment")
    return `Using ${PROVIDER_INFO[choice].env} from this host's environment.`;
  return "Stored only on this host, and never sent back to any app.";
}

export function createSettingsScreen(store: Store, rpc: PluginClientContext["rpc"]) {
  return function DetectionSettings({ theme, layout }: PluginSurfaceProps) {
    const colors = theme.colors;
    const [status, setStatus] = useState<DetectionStatus | null>(null);
    const [choice, setChoice] = useState<Choice>("rules");
    const [key, setKey] = useState("");
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<{ text: string; bad: boolean } | null>(null);

    useEffect(() => {
      let live = true;
      rpc(statusRpc, {})
        .then((loaded) => {
          if (!live) return;
          setStatus(loaded);
          setChoice(loaded.provider ?? "rules");
        })
        .catch(() => {
          if (live) setResult({ text: "This host could not be reached.", bad: true });
        });
      return () => {
        live = false;
      };
    }, []);

    async function run(task: () => Promise<void>) {
      setBusy(true);
      setResult(null);
      try {
        await task();
      } catch (error) {
        setResult({
          text: error instanceof Error ? error.message : "That did not work.",
          bad: true,
        });
      } finally {
        setBusy(false);
      }
    }

    const save = () =>
      run(async () => {
        const provider = choice === "rules" ? null : choice;
        const saved = await rpc(saveRpc, { provider, ...(key.trim() ? { key: key.trim() } : {}) });
        setStatus(saved);
        setKey("");
        await store.detectionChanged();
        setResult(
          saved.provider && !saved.keySource
            ? { text: "Saved, but there is no key yet, so text rules stay on.", bad: true }
            : { text: "Saved.", bad: false },
        );
      });

    const test = () =>
      run(async () => {
        const answer = await rpc(testRpc, {});
        if (!answer.ok) setResult({ text: answer.error, bad: true });
        else if (answer.verdict === "question") setResult({ text: "Connected.", bad: false });
        else setResult({ text: "Connected, but the test answer was unexpected.", bad: true });
      });

    const provider = choice === "rules" ? null : choice;
    return (
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: layout.compact ? 16 : 24, gap: 16 }}
      >
        <SettingsSection title="Detection">
          <SettingsSelect
            label="How to spot agents waiting on you"
            hint="Text rules look for questions and requests in the agent's last message."
            value={choice}
            options={OPTIONS}
            disabled={busy || !status}
            onValueChange={(value) => {
              setChoice(value);
              setKey("");
              setResult(null);
            }}
          />
          {provider ? (
            // Remounted per provider, so one provider's typed key can't be saved under another.
            <SettingsInput
              key={provider}
              label={`${PROVIDER_INFO[provider].label} key`}
              hint={keyHint(status, provider)}
              placeholder="Paste a key"
              secureTextEntry
              disabled={busy}
              onChangeText={setKey}
            />
          ) : null}
          <SettingsAction
            label="Apply these settings"
            actionLabel="Save"
            disabled={busy}
            onPress={save}
          />
          {status?.provider ? (
            <SettingsAction
              label="Check the saved key works"
              actionLabel="Test"
              disabled={busy}
              onPress={test}
            />
          ) : null}
          {result ? (
            <SettingsRow label={result.text}>
              <Text style={{ color: result.bad ? colors.statusDanger : colors.statusSuccess }}>
                {result.bad ? "Problem" : "OK"}
              </Text>
            </SettingsRow>
          ) : null}
        </SettingsSection>
        <Text style={{ color: colors.foregroundMuted, fontSize: 13, lineHeight: 19 }}>
          With a provider on, each agent's last message and your request before it are sent to that
          provider, and on to TypeSafe, to judge whether the agent is waiting on you. With text
          rules, nothing leaves your hosts.
        </Text>
      </ScrollView>
    );
  };
}
