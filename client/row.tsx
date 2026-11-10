import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { useHosts } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useEffect, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import type { Store } from "./store";

export const useSnapshot = (store: Store) =>
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

/** Keep the store's hosts in step with the app's. Mounted wherever the plugin shows. */
export function useSyncHosts(store: Store) {
  const hosts = useHosts();
  const signature = JSON.stringify(hosts.map((host) => [host.serverId, host.label, host.status]));
  useEffect(() => {
    void store.setHosts(hosts);
    // The signature stands in for the hosts array, which is new on every render.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [store, signature]);
}

export function createRow(store: Store) {
  return function NeedsYouRow({ theme, currentScreen, openScreen }: PluginSidebarItemProps) {
    useSyncHosts(store);
    const count = useSnapshot(store).items.length;
    return (
      <SidebarRow
        icon="Inbox"
        label="Needs you"
        active={currentScreen?.screenId === "list"}
        onPress={() => openScreen({ screenId: "list" })}
        trailing={
          count > 0 ? (
            <View
              accessibilityLabel={`${count} waiting`}
              style={{
                minWidth: 20,
                paddingHorizontal: 6,
                paddingVertical: 1,
                borderRadius: 10,
                alignItems: "center",
                backgroundColor: theme.colors.accent,
              }}
            >
              <Text
                style={{
                  color: theme.colors.accentForeground,
                  fontSize: 11,
                  fontWeight: "600",
                  fontVariant: ["tabular-nums"],
                }}
              >
                {count}
              </Text>
            </View>
          ) : undefined
        }
      />
    );
  };
}
