import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createDetection } from "./server/detection";
import { fileKeyStore } from "./server/keys";
import { dismissalSettings } from "./shared/dismissals";
import { judgeRpc, saveRpc, statusRpc, testRpc } from "./shared/rpc";

// The host keeps the dismissals and the model key, and makes the model calls. Finding which
// agents need you happens in the client, which can see every connected host.
export default function contribute(server: PluginServerContext) {
  server.registerSettings(dismissalSettings);
  const detection = createDetection({ keys: fileKeyStore() });
  server.handle(judgeRpc, (input) => detection.judge(input));
  server.handle(statusRpc, () => detection.status());
  server.handle(saveRpc, (input) => detection.save(input));
  server.handle(testRpc, () => detection.test());
  return () => {};
}
