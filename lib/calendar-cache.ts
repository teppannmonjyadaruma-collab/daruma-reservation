import { get, ref } from "firebase/database";
import { db } from "./firebase";

export type CalendarStatus = "◎" | "△" | "×" | "休";
export type CalendarStatusMap = Record<string, CalendarStatus>;

export async function fetchCalendarStatus(): Promise<{
  calendarStatus: CalendarStatusMap;
  calendarStatusUpdatedAt: string | null;
}> {
  const snapshot = await get(ref(db, "calendarCache"));

  if (!snapshot.exists()) {
    return {
      calendarStatus: {},
      calendarStatusUpdatedAt: null,
    };
  }

  const value = snapshot.val();

  return {
    calendarStatus: value.calendarStatus ?? {},
    calendarStatusUpdatedAt: value.calendarStatusUpdatedAt ?? null,
  };
}