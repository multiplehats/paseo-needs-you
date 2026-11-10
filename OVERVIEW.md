Needs you adds a sidebar row showing how many agents are waiting on you, and a list of them across every host the app is connected to. It catches agents that finished their turn and asked you something in plain text, which Paseo's own status does not show once you have looked at them.

## What it lists

Each entry shows the agent, what it wants and how long ago. Press one to open the agent.

- **Approval:** the agent is blocked on a permission or question prompt.
- **Question:** its last message asks you to answer or decide something.
- **Your turn:** its last message asks you to do something first.
- **Offer:** its last message offers more work you could take up.
- **Failed:** the agent stopped with an error.

An entry stays until you reply or press Dismiss. A dismissed agent comes back when it says something new, and dismissing on one device clears it on your others. Agents started by another agent are left out unless a permission prompt is blocking them.

## Detection

With no setup, text rules read each idle agent's last message and look for questions and requests, in English and Dutch. They lean towards listing too much, so you may dismiss the odd entry.

For better accuracy, open Settings, Needs you, choose OpenRouter, Vercel AI Gateway or TypeSafe, and add that provider's key. Jev, TypeSafe's decision model, then judges each finished turn. A long message costs around $0.0001 to judge, and each message is judged once. If a call fails, the text rules take over and the list says why.

## Setup

One copy on one host is enough, ideally one that stays on. It lists agents from every connected host, and a second copy would add a second row. Move the row in Settings, Sidebar, Header.

Requires Paseo 0.15 or later.

## Data and limits

The plugin reads the agent list and recent timeline of each connected host, using the app's own connection. Dismissals are stored in this host's plugin settings. A saved key is stored in a private file on this host and is never sent back to any app.

With text rules, nothing leaves your hosts. With a provider on, each idle agent's last message and your request before it are sent to that provider and on to TypeSafe. Message text is never written to the plugin log.

Hosts that are offline are left out of the list until they reconnect.
