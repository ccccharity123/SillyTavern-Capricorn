// Foreground generation can cancel history work and obtains results asynchronously.
export function createVectorLane(clock = () => Date.now(), interval = 1000) {
  let active;
  let nextRequestAt = 0;

  function acquire(kind, cancel) {
    if (active) {
      if (kind !== 'foreground' || active.kind !== 'background' || !active.cancel) return null;
      const previous = active;
      active = undefined;
      previous.cancel();
    }
    const release = () => { if (active?.release === release) active = undefined; };
    active = { kind, cancel, release };
    return release;
  }

  function beginRequest(release) {
    const now = clock();
    if (active?.release !== release || now < nextRequestAt) return false;
    nextRequestAt = now + interval;
    return true;
  }

  return { acquire, beginRequest, busy: () => Boolean(active) };
}
