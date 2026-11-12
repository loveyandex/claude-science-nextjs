export async function register() {
  // The Postgres World pulls queued workflow/step jobs with a background
  // worker that has to be started once per server process; on start it also
  // re-enqueues runs that were still active when the server last stopped.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getWorld } = await import("workflow/runtime");
    const world = await getWorld();
    await world.start?.();
  }
}
