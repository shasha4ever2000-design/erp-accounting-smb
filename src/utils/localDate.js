// Today's date as the user sees it on their own calendar.
//
// `new Date().toISOString().slice(0, 10)` is the date in UTC. For a user in
// Riyadh (UTC+3) that is still yesterday until 3 am; for one in New York it is
// already tomorrow from 8 pm. Default document dates, due-date ageing and
// "as at today" reports all read the wall calendar, so they use this.

const pad = (n) => String(n).padStart(2, '0')

/** YYYY-MM-DD of `d` (default: now) in the local time zone. */
export function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
