// The user's current UTC offset in minutes, east positive (UTC+2 -> 120), as the
// server's timezoneOffsetMinutes parameters expect. Date#getTimezoneOffset has
// the opposite sign.
export const tzOffsetMinutes = (): number => -new Date().getTimezoneOffset();
