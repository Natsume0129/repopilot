import { db } from "@karakeep/db";
import logger from "@karakeep/shared/logger";
import { processNextResearch } from "@karakeep/shared-server/repopilot/runner";

export class RepoPilotWorker {
  private stopped = false;
  stop() {
    this.stopped = true;
  }
  async run() {
    logger.info("Starting RepoPilot durable research worker");
    while (!this.stopped) {
      try {
        if (await processNextResearch(db)) continue;
      } catch {
        logger.error(
          "RepoPilot database polling failed; retrying without logging payloads",
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
