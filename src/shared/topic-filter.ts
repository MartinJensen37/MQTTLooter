/** MQTT topic filter syntax: `+` is one whole level, `#` is a final whole level. */
export function validTopicFilter(filter: unknown): filter is string {
  if (
    typeof filter !== 'string' ||
    !filter.length ||
    filter.length > 65535 ||
    filter.includes('\0')
  )
    return false;
  const levels = filter.split('/');
  return levels.every(
    (level, index) =>
      (!level.includes('+') || level === '+') &&
      (!level.includes('#') || (level === '#' && index === levels.length - 1)),
  );
}

/** MQTT matching, including `a/#` matching `a`; wildcards never match a leading `$` level. */
export function topicMatches(filter: string, topic: string): boolean {
  const filterLevels = filter.split('/');
  const topicLevels = topic.split('/');
  if (topic.startsWith('$') && (filterLevels[0] === '+' || filterLevels[0] === '#')) return false;
  for (let index = 0; index < filterLevels.length; index++) {
    const level = filterLevels[index];
    if (level === '#') return true;
    if (index >= topicLevels.length) return false;
    if (level !== '+' && level !== topicLevels[index]) return false;
  }
  return filterLevels.length === topicLevels.length;
}
