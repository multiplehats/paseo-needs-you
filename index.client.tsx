import type { PluginClientContext } from "@getpaseo/plugin/client";
import { getPaseoClient } from "@getpaseo/plugin/client";
import { AppState, Platform } from "react-native";
import type { HostApi } from "./client/hosts";
import { revealInSidebar } from "./client/reveal";
import { createRow } from "./client/row";
import { createScreen } from "./client/screen";
import { createSettingsScreen } from "./client/settings";
import { createStore } from "./client/store";

const TITLE = "Needs you";
const ICON = "Inbox";
const web = Platform.OS === "web" && typeof document !== "undefined";

export default function contribute(client: PluginClientContext) {
  const store = createStore({
    rpc: client.rpc.bind(client),
    lookup: (serverId) => getPaseoClient(serverId) as unknown as HostApi,
  });
  // Back in the foreground (the phone app reopened, a laptop woken): catch up straight away.
  const foreground = AppState.addEventListener("change", (state) => {
    if (state === "active") void store.refresh();
  });
  const cleanups = [
    store.start(),
    client.addSidebarHeaderItem({ id: "row", title: TITLE, Component: createRow(store) }),
    client.addScreen({
      id: "list",
      title: TITLE,
      Component: createScreen(store, {
        openSettings: () => client.openSettings("detection"),
        reveal: web
          ? async (item) =>
              revealInSidebar(document, { ...item, projectKey: await store.sidebarKeyFor(item) })
          : undefined,
      }),
    }),
    client.addSettingsScreen({
      id: "detection",
      title: TITLE,
      icon: ICON,
      Component: createSettingsScreen(store, client.rpc.bind(client)),
    }),
    client.addCommandCenterItem({
      id: "open",
      context: "global",
      title: `Open ${TITLE}`,
      icon: ICON,
      keywords: ["questions", "waiting", "attention", "inbox"],
      onSelect: (context) => context.openScreen({ screenId: "list" }),
    }),
    () => foreground.remove(),
  ];
  return () => {
    for (const cleanup of cleanups.reverse()) void cleanup();
  };
}
