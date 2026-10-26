import { settings } from '../services/Settings';

type Time = number | string | Date;

/** The time format chosen in Settings, for toLocale*String. */
function hourOptions(): Intl.DateTimeFormatOptions {
  const format = settings.snapshot().timeFormat;
  return format === '24h' ? { hour12: false } : format === '12h' ? { hour12: true } : {};
}

/** Time of day, e.g. 14:05:09, in the chosen format. */
export const clockTime = (time: Time): string =>
  new Date(time).toLocaleTimeString(undefined, hourOptions());

/** Date and time in the chosen format. */
export const dateTime = (time: Time): string =>
  new Date(time).toLocaleString(undefined, hourOptions());
