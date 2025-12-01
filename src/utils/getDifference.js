function getDifference(before, after) {
  const diff = {};

  if (!before) {
    for (const key in after) {
      diff[key] = { before: null, after: after[key] };
    }
    return diff;
  }

  for (const key in after) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      diff[key] = { before: before[key], after: after[key] };
    }
  }

  return diff;
}

module.exports = { getDifference };
