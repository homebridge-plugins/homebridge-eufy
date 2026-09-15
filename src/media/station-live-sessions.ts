import type { StationLiveClaim, StationLiveSessionRegistry } from './contracts.js';

/**
 * One decision this registry made about a station's own session.
 *
 * The four are the whole arbitration as it happened: `held` is a claim taking the station, `released` is a
 * claim giving it back, `yielded` is a still being asked to give it back early, and `refused` is a still
 * standing down because something else holds it. Without `released`, a hold that is still open cannot be told
 * from one that ended, which is the difference between a station this plugin is holding and a station
 * something outside it is.
 *
 * Carries claims alone. A station identity is a serial, and no retained record holds one.
 */
export type StationClaimDecision =
  | { readonly action: 'held'; readonly claim: StationLiveClaim }
  | { readonly action: 'released'; readonly claim: StationLiveClaim }
  | { readonly action: 'yielded'; readonly claim: StationLiveClaim; readonly to: StationLiveClaim }
  | { readonly action: 'refused'; readonly claim: StationLiveClaim; readonly by: StationLiveClaim };

/**
 * The claims served over a connection of their own, which therefore contend with nothing on the station.
 *
 * A live view and a recording each get their own connection to the station, so both run at full rate together.
 * A still opens none: it rides the station's own session and takes it from whatever that session carries, so it
 * is the one claim that stands aside and the one claim that is asked to.
 */
const CONTINUOUS: ReadonlySet<StationLiveClaim> = new Set<StationLiveClaim>(['live', 'recording']);

interface Session {
  readonly camera: string;
  readonly claim: StationLiveClaim;
  readonly abandon?: () => void;
  /** Whether this session has already been asked to yield, so a second continuous claim does not ask twice. */
  asked?: boolean;
}

/**
 * The one registry of the work each station's own session is carrying, keyed by station serial.
 *
 * Both sides of the question read it: HomeKit records a live view and a recording on their camera's station,
 * and snapshot acquisition asks whether a station is carrying anything before opening a burst on it.
 *
 * A still fills a tile that is off screen exactly while continuous work is running, re-running it costs nobody
 * anything, and the last good image stands in where it cannot run — so it defers and nothing defers to it. A
 * still asks a holder to yield rather than seizing the station: each holder registered how to abandon its own
 * work, and a holder that registered none is left alone.
 *
 * None of it applies WITHIN one camera. Every egress on a camera shares one pull, so a recording and a live
 * view of the same camera are served together and neither yields to the other.
 */
export class StationLiveSessions implements StationLiveSessionRegistry {
  private readonly sessions = new Map<string, Set<Session>>();

  constructor(private readonly decided: (decision: StationClaimDecision) => void = () => undefined) {}

  /** How many stations are currently holding at least one session. */
  get held(): number {
    return this.sessions.size;
  }

  /** The claim currently held on `stationSn`, preferring a continuous one, or `undefined` where nothing does. */
  heldFor(stationSn: string): StationLiveClaim | undefined {
    let holder: StationLiveClaim | undefined;
    for (const session of this.sessions.get(stationSn) ?? []) {
      if (CONTINUOUS.has(session.claim)) {
        return session.claim;
      }
      holder ??= session.claim;
    }
    return holder;
  }

  /**
   * Whether `claim` may take this station now.
   *
   * A continuous pull is never refused: it opens a connection of its own. A still is refused while any other
   * camera holds the station, including for another still, because a capture rides the station's own session.
   */
  admits(stationSn: string, camera: string, claim: StationLiveClaim): boolean {
    let holderElsewhere: StationLiveClaim | undefined;
    for (const session of this.sessions.get(stationSn) ?? []) {
      if (session.camera === camera) {
        return true;
      }
      if (holderElsewhere === undefined || CONTINUOUS.has(session.claim)) {
        holderElsewhere = session.claim;
      }
    }
    if (CONTINUOUS.has(claim) || holderElsewhere === undefined) {
      return true;
    }
    this.decided({ action: 'refused', claim, by: holderElsewhere });
    return false;
  }

  /**
   * Record one session on `stationSn`, asking any still on another camera to yield first, and answer the
   * release that ends it.
   *
   * `abandon` is how this session gives the station back before it would have finished. It is called at most
   * once, and never on the session that is taking the station.
   */
  hold(stationSn: string, camera: string, claim: StationLiveClaim, abandon?: () => void): () => void {
    const yielding = CONTINUOUS.has(claim)
      ? [...(this.sessions.get(stationSn) ?? [])].filter(
          (session) => session.camera !== camera && !CONTINUOUS.has(session.claim),
        )
      : [];
    const session: Session = abandon ? { camera, claim, abandon } : { camera, claim };
    const held = this.sessions.get(stationSn) ?? new Set<Session>();
    held.add(session);
    this.sessions.set(stationSn, held);
    this.decided({ action: 'held', claim });

    for (const standing of yielding) {
      if (standing.asked) {
        continue;
      }
      standing.asked = true;
      this.decided({ action: 'yielded', claim: standing.claim, to: claim });
      standing.abandon?.();
    }

    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.decided({ action: 'released', claim });
      const remaining = this.sessions.get(stationSn);
      remaining?.delete(session);
      if (remaining && remaining.size === 0) {
        this.sessions.delete(stationSn);
      }
    };
  }
}
