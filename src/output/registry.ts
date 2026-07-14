import type { OutputEventContext, OutputIntegration, ResponseEvent } from './types.js';

export class OutputIntegrationRegistry {
  private readonly integrations = new Map<string, OutputIntegration>();
  private readonly pending = new Map<string, Promise<void>>();

  constructor(private readonly onError?: (integrationId: string, error: string) => void) {}

  register(integration: OutputIntegration): this {
    if (this.integrations.has(integration.id)) {
      throw new Error(`duplicate output integration id: ${integration.id}`);
    }
    this.integrations.set(integration.id, integration);
    return this;
  }

  get size(): number {
    return this.integrations.size;
  }

  dispatch(event: ResponseEvent, context: OutputEventContext): void {
    for (const integration of this.integrations.values()) {
      const previous = this.pending.get(integration.id);
      if (previous) {
        this.track(
          integration.id,
          previous.then(() => this.invoke(integration, event, context)),
        );
        continue;
      }

      const result = this.invoke(integration, event, context);
      if (result) this.track(integration.id, result);
    }
  }

  async flush(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all(this.pending.values());
    }
  }

  private invoke(
    integration: OutputIntegration,
    event: ResponseEvent,
    context: OutputEventContext,
  ): Promise<void> | undefined {
    let result: void | Promise<void>;
    try {
      result = integration.onEvent(event, context);
    } catch {
      this.onError?.(integration.id, 'handler_failed');
      return undefined;
    }

    if (result == null) return undefined;
    return Promise.resolve(result).catch(() => {
      this.onError?.(integration.id, 'handler_failed');
    });
  }

  private track(integrationId: string, task: Promise<void>): void {
    const settled = task.catch(() => {
      this.onError?.(integrationId, 'handler_failed');
    });
    this.pending.set(integrationId, settled);
    void settled.then(() => {
      if (this.pending.get(integrationId) === settled) this.pending.delete(integrationId);
    });
  }

  list(): readonly OutputIntegration[] {
    return [...this.integrations.values()];
  }
}