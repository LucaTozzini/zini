// A log timestamp as a local time of day.
export const time = (iso: string) => new Date(iso).toLocaleTimeString();
