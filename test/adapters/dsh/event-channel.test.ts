import { describe, expect, it } from 'vitest';
import { EventChannel } from '../../../src/adapters/dsh/event-channel.js';

describe('EventChannel', () => {
  it('streams queued events in order', async () => {
    const channel = new EventChannel<number>();
    channel.push(1);
    channel.push(2);
    channel.close();
    const values: number[] = [];
    for await (const value of channel) values.push(value);
    expect(values).toEqual([1, 2]);
  });

  it('terminates cleanly when closed while a consumer is waiting', async () => {
    const channel = new EventChannel<string>();
    const consume = (async () => {
      const values: string[] = [];
      for await (const value of channel) values.push(value);
      return values;
    })();
    // Ensure the consumer is parked on a waiter before closing.
    await new Promise((resolve) => setTimeout(resolve, 10));
    channel.close();
    await expect(consume).resolves.toEqual([]);
  });

  it('drains queued events before termination', async () => {
    const channel = new EventChannel<number>();
    const consume = (async () => {
      const values: number[] = [];
      for await (const value of channel) values.push(value);
      return values;
    })();
    await new Promise((resolve) => setTimeout(resolve, 10));
    channel.push(7);
    channel.close();
    await expect(consume).resolves.toEqual([7]);
  });
});
