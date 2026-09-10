export function registerTools(game, tap, restart) {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const tools = [
    {
      name: "read_puzzle",
      title: "Read puzzle",
      description:
        "Read the current trucks, blockers, loading slots and progress.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: () => game.snapshot(),
    },
    {
      name: "send_truck",
      title: "Send truck",
      description:
        "Tap a truck by its zero-based id. It moves to the first free loading bay only when its forward path is clear.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "integer", minimum: 0, maximum: 39 } },
        required: ["id"],
        additionalProperties: false,
      },
      execute: async (input) => {
        if (!Number.isInteger(input?.id) || input.id < 0 || input.id > 39)
          throw new Error("Truck id must be an integer from 0 to 39");
        const result = tap(input.id);
        if (!result?.ok) return result;
        await new Promise((resolve) => {
          const check = () =>
            game.cars[input.id].state === "exiting"
              ? setTimeout(check, 50)
              : resolve();
          check();
        });
        return { ...result, state: game.cars[input.id].state };
      },
    },
    {
      name: "restart_puzzle",
      title: "Restart puzzle",
      description:
        "Restart this single level with its original 40 trucks and fruit queues.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: () => {
        restart();
        return game.snapshot();
      },
    },
  ];
  for (const tool of tools)
    try {
      Promise.resolve(context.registerTool(tool)).catch(() => {});
    } catch {}
}
