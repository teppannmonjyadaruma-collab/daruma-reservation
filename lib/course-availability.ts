export type CourseAvailabilityDetail = {
  date: string;
  adult: number;
  child: number;
  startTime: string;
  seatOnlyAvailable: boolean;
  course120Available: boolean;
  course150Available: boolean;
  holidayName: string;
  businessType: "22close" | "23close" | "closed";
};

export async function fetchCourseAvailabilityDetail(
  date: string,
  adult: number,
  child: number,
  startTime: string
): Promise<CourseAvailabilityDetail> {
  const baseUrl = process.env.NEXT_PUBLIC_GAS_API_URL;
  if (!baseUrl) {
    throw new Error("NEXT_PUBLIC_GAS_API_URL が未設定です。");
  }

  const url =
    `${baseUrl}?action=courseAvailability` +
    `&date=${encodeURIComponent(date)}` +
    `&adult=${encodeURIComponent(String(adult))}` +
    `&child=${encodeURIComponent(String(child))}` +
    `&startTime=${encodeURIComponent(startTime)}`;

  const res = await fetch(url, { method: "GET", cache: "no-store" });

  if (!res.ok) {
    throw new Error(`コース可否取得失敗: ${res.status}`);
  }

  const json = await res.json();

  if (!json.ok) {
    throw new Error(json.error || "コース可否取得に失敗しました。");
  }

  return json.data as CourseAvailabilityDetail;
}