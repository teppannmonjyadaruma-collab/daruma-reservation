export type DayAvailabilityDetail = {
  date: string;
  adult: number;
  child: number;
  lunchAvailableTimes: string[];
  dinnerAvailableTimes: string[];
  holidayName: string;
  businessType: "22close" | "23close" | "closed";
};

export async function fetchDayAvailabilityDetail(
  date: string,
  adult: number,
  child: number
): Promise<DayAvailabilityDetail> {
  const baseUrl = process.env.NEXT_PUBLIC_GAS_API_URL;
  if (!baseUrl) {
    throw new Error("NEXT_PUBLIC_GAS_API_URL が未設定です。");
  }

  const url =
    `${baseUrl}?action=dayAvailability` +
    `&date=${encodeURIComponent(date)}` +
    `&adult=${encodeURIComponent(String(adult))}` +
    `&child=${encodeURIComponent(String(child))}`;

  const res = await fetch(url, { method: "GET", cache: "no-store" });

  if (!res.ok) {
    throw new Error(`空き状況取得失敗: ${res.status}`);
  }

  const json = await res.json();

  if (!json.ok) {
    throw new Error(json.error || "空き状況取得に失敗しました。");
  }

  return json.data as DayAvailabilityDetail;
}