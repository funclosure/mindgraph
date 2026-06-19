// In-process broker for the deepen question round-trip. A runner calls
// ask(turnId) and awaits; the HTTP layer calls answer(turnId, answers) when the
// client POSTs, or cancel(turnId) on timeout/disconnect. Keyed by turnId so one
// channel instance serves every concurrent deepen stream.
export function createQuestionChannel() {
  const pending = new Map(); // turnId -> { resolve, reject }

  function settleExisting(turnId, rejectReason) {
    const entry = pending.get(turnId);
    if (!entry) return;
    pending.delete(turnId);
    entry.reject(new Error(rejectReason));
  }

  return {
    ask(turnId) {
      settleExisting(turnId, 'superseded by a newer question for this turn');
      return new Promise((resolve, reject) => {
        pending.set(turnId, { resolve, reject });
      });
    },
    answer(turnId, answers) {
      const entry = pending.get(turnId);
      if (!entry) return false;
      pending.delete(turnId);
      entry.resolve(answers);
      return true;
    },
    cancel(turnId, reason = 'cancelled') {
      const entry = pending.get(turnId);
      if (!entry) return false;
      pending.delete(turnId);
      entry.reject(new Error(reason));
      return true;
    },
    pendingCount() {
      return pending.size;
    },
  };
}
