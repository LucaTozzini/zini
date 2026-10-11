import type { ConductorStatus } from "shared";

export class ConductorController {
  private enabled = false;
  private running = false;
  private lastRan: Date | null = null;
  private timeout: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly iteration: (isEnabled: () => boolean) => Promise<void>,
    private readonly onError: (error: unknown) => void = console.error,
  ) {}

  getStatus(): ConductorStatus {
    return { running: this.running, lastRan: this.lastRan };
  }

  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    } else {
      void this.run();
    }
  }

  private async run() {
    if (!this.enabled || this.running) return;
    this.running = true;
    this.lastRan = new Date();
    try { await this.iteration(() => this.enabled); }
    catch (error) { this.onError(error); }
    finally {
      this.running = false;
      if (this.enabled) {
        this.timeout = setTimeout(() => {
          this.timeout = undefined;
          void this.run();
        }, 5 * 60 * 1000);
        this.timeout.unref();
      }
    }
  }
}
