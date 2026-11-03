import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

const replaceFirstPerson = (value) =>
  typeof value === "string" ? value.replaceAll("我", "碧琪") : value;

export default definePluginEntry({
  id: "pinkie-first-person-renderer",
  name: "Pinkie First-Person Renderer",
  register(api) {
    api.on(
      "message_sending",
      async (event) => ({ content: replaceFirstPerson(event.content) }),
      { priority: 1000 },
    );

    api.on(
      "reply_payload_sending",
      async (event) => {
        const payload = event.payload;
        if (!payload || typeof payload !== "object") return;

        return {
          payload: {
            ...payload,
            text: replaceFirstPerson(payload.text),
            content: replaceFirstPerson(payload.content),
            caption: replaceFirstPerson(payload.caption),
          },
        };
      },
      { priority: 1000 },
    );
  },
});
