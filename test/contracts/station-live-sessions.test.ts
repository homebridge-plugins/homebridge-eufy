import { describe, expect, it, vi } from 'vitest';

import { StationLiveSessions } from '../../src/media/station-live-sessions.js';

/**
 * What each station's own session is carrying, and which claim stands aside for which.
 *
 * A live view and a recording are each served over a connection of their own, so two of them on one base cost
 * each other nothing and neither is refused. A still opens no connection: it rides the station's own session and
 * takes it from whatever that session carries, so it is the one claim that defers, and the one asked to.
 *
 * A standalone camera is its own station and contends with nobody.
 */
const BASE = 'T8010P0000000000';
const STANDALONE = 'T8410P0000000002';
/** Two cameras of one base: the pair whose stills contend. */
const CAM_A = 'T8114P0000000000';
const CAM_B = 'T8210P0000000001';

describe('StationLiveSessions', () => {
  it('reports nothing holding a station to begin with', () => {
    expect(new StationLiveSessions().heldFor(BASE)).toBeUndefined();
  });

  it('reports what a held session holds the station for', () => {
    const sessions = new StationLiveSessions();
    sessions.hold(BASE, CAM_A, 'recording');
    expect(sessions.heldFor(BASE)).toBe('recording');
  });

  it('reports a continuous claim ahead of a still while several hold one station', () => {
    const sessions = new StationLiveSessions();
    sessions.hold(BASE, CAM_A, 'snapshot');
    sessions.hold(BASE, CAM_B, 'live');
    expect(sessions.heldFor(BASE)).toBe('live');
  });

  it('leaves another station alone', () => {
    const sessions = new StationLiveSessions();
    sessions.hold(BASE, CAM_A, 'live');
    expect(sessions.heldFor(STANDALONE)).toBeUndefined();
  });

  describe('admits', () => {
    it('admits anything to a station nothing holds', () => {
      const sessions = new StationLiveSessions();
      expect(sessions.admits(BASE, CAM_B, 'snapshot')).toBe(true);
    });

    /** The case a HomeKit Secure Video trigger produces while an operator is watching a sibling. */
    it('admits a recording while a sibling camera is being watched', () => {
      const sessions = new StationLiveSessions();
      sessions.hold(BASE, CAM_A, 'live');
      expect(sessions.admits(BASE, CAM_B, 'recording')).toBe(true);
    });

    it('admits a second live view, each served over a connection of its own', () => {
      const sessions = new StationLiveSessions();
      sessions.hold(BASE, CAM_A, 'live');
      expect(sessions.admits(BASE, CAM_B, 'live')).toBe(true);
    });

    it('refuses a still while a recording holds the station', () => {
      const sessions = new StationLiveSessions();
      sessions.hold(BASE, CAM_A, 'recording');
      expect(sessions.admits(BASE, CAM_B, 'snapshot')).toBe(false);
    });

    /** Two stills on one base take turns: a capture rides the station's own session, which serves one camera. */
    it('refuses a still while another camera is capturing one', () => {
      const sessions = new StationLiveSessions();
      sessions.hold(BASE, CAM_A, 'snapshot');
      expect(sessions.admits(BASE, CAM_B, 'snapshot')).toBe(false);
    });
  });

  describe('yielding', () => {
    it('asks a still to abandon, which is what frees the station', () => {
      const sessions = new StationLiveSessions();
      const abandon = vi.fn();
      sessions.hold(BASE, CAM_A, 'snapshot', abandon);

      sessions.hold(BASE, CAM_B, 'live');

      expect(abandon).toHaveBeenCalledOnce();
    });

    it('asks every still on the station, not merely one of them', () => {
      const sessions = new StationLiveSessions();
      const first = vi.fn();
      const second = vi.fn();
      sessions.hold(BASE, CAM_A, 'snapshot', first);
      sessions.hold(BASE, CAM_B, 'snapshot', second);

      sessions.hold(BASE, 'T8210P0000000003', 'recording');

      expect(first).toHaveBeenCalledOnce();
      expect(second).toHaveBeenCalledOnce();
    });

    it('never asks a continuous pull to abandon, because it holds a connection of its own', () => {
      const sessions = new StationLiveSessions();
      const recording = vi.fn();
      sessions.hold(BASE, CAM_A, 'recording', recording);

      sessions.hold(BASE, CAM_B, 'live');

      expect(recording).not.toHaveBeenCalled();
    });

    it('asks nothing on behalf of a still, which is the claim that defers', () => {
      const sessions = new StationLiveSessions();
      const abandon = vi.fn();
      sessions.hold(BASE, CAM_A, 'snapshot', abandon);

      sessions.hold(BASE, CAM_B, 'snapshot');

      expect(abandon).not.toHaveBeenCalled();
    });

    it('leaves a holder alone when it stated no way to be stopped cleanly', () => {
      const sessions = new StationLiveSessions();
      sessions.hold(BASE, CAM_A, 'snapshot');

      expect(() => sessions.hold(BASE, CAM_B, 'live')).not.toThrow();
      expect(sessions.heldFor(BASE)).toBe('live');
    });

    it('leaves a still on ANOTHER station untouched', () => {
      const sessions = new StationLiveSessions();
      const elsewhere = vi.fn();
      sessions.hold(STANDALONE, CAM_B, 'snapshot', elsewhere);

      sessions.hold(BASE, CAM_A, 'live');

      expect(elsewhere).not.toHaveBeenCalled();
    });
  });

  describe('releasing', () => {
    it('frees the station when the only session releases', () => {
      const sessions = new StationLiveSessions();
      sessions.hold(BASE, CAM_A, 'live')();
      expect(sessions.heldFor(BASE)).toBeUndefined();
    });

    it('keeps the station held while any session on it remains', () => {
      const sessions = new StationLiveSessions();
      const first = sessions.hold(BASE, CAM_A, 'live');
      sessions.hold(BASE, CAM_B, 'live');
      first();
      expect(sessions.heldFor(BASE)).toBe('live');
    });

    /** A release runs once: a session reporting its end twice must not free a peer's hold. */
    it('ignores a repeated release', () => {
      const sessions = new StationLiveSessions();
      const release = sessions.hold(BASE, CAM_A, 'live');
      sessions.hold(BASE, CAM_B, 'live');
      release();
      release();
      expect(sessions.heldFor(BASE)).toBe('live');
    });

    it('reports the still once every continuous pull has gone', () => {
      const sessions = new StationLiveSessions();
      sessions.hold(BASE, CAM_A, 'snapshot');
      const live = sessions.hold(BASE, CAM_B, 'live');
      live();
      expect(sessions.heldFor(BASE)).toBe('snapshot');
    });

    it('forgets a station once its last session has gone, so nothing accumulates', () => {
      const sessions = new StationLiveSessions();
      sessions.hold(BASE, CAM_A, 'live')();
      expect(sessions.held).toBe(0);
    });
  });

  /**
   * Every egress on one camera shares a single pull, so nothing there contends. This is what a motion
   * notification produces once the operator taps that camera's tile, and it is the common shape.
   */
  describe('within one camera', () => {
    it('admits any claim on a camera the station is already serving', () => {
      const sessions = new StationLiveSessions();
      sessions.hold(BASE, CAM_A, 'live');

      expect(sessions.admits(BASE, CAM_A, 'recording')).toBe(true);
      expect(sessions.admits(BASE, CAM_A, 'snapshot')).toBe(true);
      expect(sessions.admits(BASE, CAM_A, 'live')).toBe(true);
    });

    it('never asks a camera to yield to other work on itself', () => {
      const sessions = new StationLiveSessions();
      const still = vi.fn();
      sessions.hold(BASE, CAM_A, 'snapshot', still);

      sessions.hold(BASE, CAM_A, 'live');

      expect(still).not.toHaveBeenCalled();
    });
  });
});
/**
 * Every decision over a station's own session is stated, because a still that stood aside produced no picture
 * and no failure, and is otherwise indistinguishable afterwards from one nobody asked for.
 */
describe('what the registry states about its own decisions', () => {
  it('states a claim that took the station, and what it asked to yield', () => {
    const decided: unknown[] = [];
    const sessions = new StationLiveSessions((decision) => decided.push(decision));

    sessions.hold(BASE, 'camera-a', 'snapshot', () => undefined);
    sessions.hold(BASE, 'camera-b', 'live');

    expect(decided).toEqual([
      { action: 'held', claim: 'snapshot' },
      { action: 'held', claim: 'live' },
      { action: 'yielded', claim: 'snapshot', to: 'live' },
    ]);
  });

  it('states a hold ending, so an open hold is not read as one that finished', () => {
    const decided: unknown[] = [];
    const sessions = new StationLiveSessions((decision) => decided.push(decision));

    const release = sessions.hold(BASE, 'camera-a', 'live');
    release();
    release();

    expect(decided).toEqual([
      { action: 'held', claim: 'live' },
      { action: 'released', claim: 'live' },
    ]);
  });

  it('states a claim that stood down, and which claim held the station against it', () => {
    const decided: unknown[] = [];
    const sessions = new StationLiveSessions((decision) => decided.push(decision));

    sessions.hold(BASE, 'camera-a', 'live');
    expect(sessions.admits(BASE, 'camera-b', 'snapshot')).toBe(false);

    expect(decided).toContainEqual({ action: 'refused', claim: 'snapshot', by: 'live' });
  });
});
