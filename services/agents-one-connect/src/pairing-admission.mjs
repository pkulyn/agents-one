/** Fixed-window admission with bounded socket-source state. */
export function createPairingAttemptLimiter({
  now = () => Date.now(),
  windowMs = 60000,
  maxAttempts = 8,
  maxPeers = 1024,
} = {}) {
  const peers = new Map();
  return (key) => {
    const at = now();
    for (const [peer, budget] of peers) {
      if (at - budget.startedAt >= windowMs) peers.delete(peer);
    }
    let budget = peers.get(key);
    if (!budget) {
      if (peers.size >= maxPeers) return false;
      budget = { startedAt: at, count: 0 };
      peers.set(key, budget);
    }
    if (budget.count >= maxAttempts) return false;
    budget.count += 1;
    return true;
  };
}
