import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { Loading, ScrollView } from "@getpaseo/plugin/client/ui";
import { Pressable, Text, View } from "react-native";
import { PROVIDER_INFO } from "../shared/jev";
import { ago } from "./hosts";
import { useSnapshot, useSyncHosts } from "./row";
import type { Item, ItemKind, Store } from "./store";

type Colors = PluginScreenProps["theme"]["colors"];

const TAGS: Record<ItemKind, string> = {
  permission: "Approval",
  question: "Question",
  action: "Your turn",
  offer: "Offer",
  failed: "Failed",
};

// Every row is the same height whatever it says, so the preview's space is reserved even when
// the agent only wrote a few words.
const TITLE_LINE = 20;
const PREVIEW_LINE = 19;
const PREVIEW_LINES = 2;
const META_LINE = 16;

export interface ScreenOptions {
  openSettings(): void;
}

export function createScreen(store: Store, { openSettings }: ScreenOptions) {
  return function NeedsYouScreen({ theme, layout, navigation }: PluginScreenProps) {
    useSyncHosts(store);
    const { status, items, provider, problem } = useSnapshot(store);
    const colors = theme.colors;
    const manyHosts = new Set(items.map((item) => item.hostLabel)).size > 1;

    if (status === "loading") return <Loading />;
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.surface0 }}
        contentContainerStyle={{
          padding: layout.compact ? 16 : 24,
          gap: 8,
          width: "100%",
          maxWidth: 760,
          alignSelf: "center",
        }}
      >
        {problem ? (
          <Text style={{ color: colors.statusWarning, fontSize: 13, lineHeight: 19 }}>
            {problem} Using the text rules for now.
          </Text>
        ) : null}
        {items.length === 0 ? (
          <View style={{ paddingVertical: 48, alignItems: "center", gap: 6 }}>
            <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "500" }}>
              Nothing needs you
            </Text>
            <Text style={{ color: colors.foregroundMuted, fontSize: 13, textAlign: "center" }}>
              Agents appear here when they ask something, wait for approval or fail.
            </Text>
          </View>
        ) : (
          items.map((item) => (
            <Row
              key={item.key}
              item={item}
              colors={colors}
              showHost={manyHosts}
              onOpen={
                navigation
                  ? () => navigation.openAgent({ agentId: item.agentId, serverId: item.serverId })
                  : undefined
              }
              onDismiss={() => void store.dismiss(item)}
            />
          ))
        )}
        <Pressable
          accessibilityRole="button"
          onPress={openSettings}
          style={{ paddingVertical: 12, alignSelf: "flex-start" }}
        >
          <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
            {provider
              ? `Detecting with Jev through ${PROVIDER_INFO[provider].label}.`
              : "Detecting with text rules. Add a key for better accuracy."}{" "}
            <Text style={{ textDecorationLine: "underline" }}>Settings</Text>
          </Text>
        </Pressable>
      </ScrollView>
    );
  };
}

function Row(props: {
  item: Item;
  colors: Colors;
  showHost: boolean;
  onOpen?: () => void;
  onDismiss(): void;
}) {
  const { item, colors } = props;
  const tagColor =
    item.kind === "failed"
      ? colors.statusDanger
      : item.kind === "offer"
        ? colors.foregroundMuted
        : colors.statusWarning;
  const where = [item.project, props.showHost ? item.hostLabel : null, ago(item.at, Date.now())]
    .filter(Boolean)
    .join(" · ");
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 10,
        backgroundColor: colors.surface1,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${item.title}`}
        disabled={!props.onOpen}
        onPress={props.onOpen}
        style={({ pressed }) => ({
          flex: 1,
          minWidth: 0,
          padding: 12,
          gap: 4,
          borderRadius: 10,
          backgroundColor: pressed ? colors.surface2 : "transparent",
        })}
      >
        <Text
          numberOfLines={1}
          style={{
            color: colors.foreground,
            fontSize: 14,
            fontWeight: "500",
            lineHeight: TITLE_LINE,
            height: TITLE_LINE,
          }}
        >
          {item.title}
        </Text>
        <Text
          numberOfLines={PREVIEW_LINES}
          style={{
            color: colors.foreground,
            fontSize: 13,
            lineHeight: PREVIEW_LINE,
            height: PREVIEW_LINE * PREVIEW_LINES,
          }}
        >
          {item.excerpt}
        </Text>
        <Text
          numberOfLines={1}
          style={{
            color: colors.foregroundMuted,
            fontSize: 12,
            lineHeight: META_LINE,
            height: META_LINE,
          }}
        >
          <Text style={{ color: tagColor, fontWeight: "600" }}>{TAGS[item.kind]}</Text>
          {` · ${where}`}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Dismiss ${item.title}`}
        onPress={props.onDismiss}
        style={({ pressed }) => ({
          margin: 8,
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: 8,
          backgroundColor: pressed ? colors.surface2 : "transparent",
        })}
      >
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>Dismiss</Text>
      </Pressable>
    </View>
  );
}
