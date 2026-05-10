"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import liff from "@line/liff";
import { fetchCalendarStatus, type CalendarStatusMap } from "@/lib/calendar-cache";
import { fetchDayAvailabilityDetail } from "@/lib/day-availability";
import { fetchCourseAvailabilityDetail } from "@/lib/course-availability";

type Course = "" | "席のみ" | "だるま満喫" | "鉄板満喫" | "特選だるま";
type Drink = "" | "なし" | "90" | "120";
type TeppanPref = "" | "鉄板あり" | "希望なし" | "指定不可";
type Step = 1 | 2 | 3 | 4 | 5;
type VisitType = "" | "lunch" | "dinner";

type ReservationFormData = {
    visitDate: string;
    visitType: VisitType;
    startTime: string;
    adult: number;
    child: number;
    course: Course;
    drink: Drink;
    teppanPref: TeppanPref;
    name: string;
    kana: string;
    phone: string;
    note: string;
};

type CalendarDay = {
    date: string;
    dayNumber: number;
    weekday: number;
    status: "◎" | "△" | "×" | "休" | "-" | "";
    disabled: boolean;
    isCurrentMonth: boolean;
};

type CourseState = Record<Exclude<Course, "">, { disabled: boolean; reason: string }>;

const LIFF_ID = "2009798529-5aHrd2K7";

const initialFormData: ReservationFormData = {
    visitDate: "",
    visitType: "",
    startTime: "",
    adult: 0,
    child: 0,
    course: "",
    drink: "",
    teppanPref: "",
    name: "",
    kana: "",
    phone: "",
    note: "",
};

const weekLabels = ["日", "月", "火", "水", "木", "金", "土"];

function getDrinkOptions(course: Course): Drink[] {
    switch (course) {
        case "席のみ":
            return ["なし"];
        case "だるま満喫":
            return ["なし", "90"];
        case "鉄板満喫":
        case "特選だるま":
            return ["なし", "120"];
        default:
            return [];
    }
}

function getTeppanOptions(adult: number, child: number): TeppanPref[] {
    const total = adult + child;
    if (total >= 2 && total <= 4) {
        return ["鉄板あり", "希望なし"];
    }
    return ["指定不可"];
}

function shouldSkipOptionStep(formData: ReservationFormData) {
    const teppanOptions = getTeppanOptions(formData.adult, formData.child);
    const drinkOptions = getDrinkOptions(formData.course);

    const canChooseTeppan = !(teppanOptions.length === 1 && teppanOptions[0] === "指定不可");
    const canChooseDrink = !(drinkOptions.length === 1 && drinkOptions[0] === "なし");

    return !canChooseTeppan && !canChooseDrink;
}

function getCourseState(params: {
    formData: ReservationFormData;
    courseAvailability: {
        seatOnlyAvailable: boolean;
        course120Available: boolean;
        course150Available: boolean;
    } | null;
}): CourseState {
    const { formData, courseAvailability } = params;

    const isLunch = formData.visitType === "lunch";
    const totalGuests = formData.adult + formData.child;
    const seatOnlyAvailable = courseAvailability?.seatOnlyAvailable ?? false;
    const course120Available = courseAvailability?.course120Available ?? false;
    const course150Available = courseAvailability?.course150Available ?? false;

    if (isLunch) {
        return {
            "席のみ": {
                disabled: !seatOnlyAvailable,
                reason: !seatOnlyAvailable
                    ? "この条件ではお席のみのご予約を承れません。"
                    : "",
            },
            "だるま満喫": {
                disabled: true,
                reason: "ディナーのみ選択可能です",
            },
            "鉄板満喫": {
                disabled: true,
                reason: "ディナーのみ選択可能です",
            },
            "特選だるま": {
                disabled: true,
                reason: "ディナーのみ選択可能です",
            },
        };
    }

    return {
        "席のみ": {
            disabled: !seatOnlyAvailable,
            reason: !seatOnlyAvailable
                ? "この条件ではお席のみのご予約を承れません。"
                : "",
        },
        "だるま満喫": {
            disabled: totalGuests < 2 || !course120Available,
            reason:
                totalGuests < 2
                    ? "2名様以上でご利用いただけます"
                    : !course120Available
                        ? "この時間帯ではお選びいただけません"
                        : "",
        },
        "鉄板満喫": {
            disabled: totalGuests < 2 || !course150Available,
            reason:
                totalGuests < 2
                    ? "2名様以上でご利用いただけます"
                    : !course150Available
                        ? "この時間帯ではお選びいただけません"
                        : "",
        },
        "特選だるま": {
            disabled: totalGuests < 2 || !course150Available,
            reason:
                totalGuests < 2
                    ? "2名様以上でご利用いただけます"
                    : !course150Available
                        ? "この時間帯ではお選びいただけません"
                        : "",
        },
    };
}

function buildCalendarDays(
    year: number,
    month: number,
    calendarStatusMap: Record<string, "◎" | "△" | "×" | "休">
): CalendarDay[] {
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const startWeekday = firstDay.getDay();
    const daysInMonth = lastDay.getDate();

    const today = new Date();
    const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const days: CalendarDay[] = [];

    for (let i = 0; i < startWeekday; i++) {
        days.push({
            date: "",
            dayNumber: 0,
            weekday: -1,
            status: "",
            disabled: true,
            isCurrentMonth: false,
        });
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dateObj = new Date(year, month - 1, day);
        const weekday = dateObj.getDay();
        const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

        const isPast = dateObj < todayOnly;
        const rawStatus = calendarStatusMap[date] ?? "";
        const status = isPast ? "-" : rawStatus;

        const disabled = isPast || status === "×" || status === "休";

        days.push({
            date,
            dayNumber: day,
            weekday,
            status,
            disabled,
            isCurrentMonth: true,
        });
    }

    while (days.length % 7 !== 0) {
        days.push({
            date: "",
            dayNumber: 0,
            weekday: -1,
            status: "",
            disabled: true,
            isCurrentMonth: false,
        });
    }

    return days;
}

function StepIndicator({ currentStep }: { currentStep: Step }) {
    const steps = [1, 2, 3, 4, 5] as const;

    return (
        <div className="mb-8 flex items-center justify-center gap-2 text-sm font-bold text-white">
            {steps.map((step, index) => (
                <div key={step} className="flex items-center gap-2">
                    <div
                        className={`flex h-9 w-9 items-center justify-center rounded-full border text-sm transition ${currentStep === step
                            ? "border-yellow-300 bg-yellow-400 text-black shadow-[0_0_12px_rgba(255,220,120,0.4)]"
                            : "border-white/25 bg-black/30 text-white"
                            }`}
                    >
                        {step}
                    </div>
                    {index !== steps.length - 1 && <div className="h-px w-7 bg-white/25" />}
                </div>
            ))}
        </div>
    );
}

function Step1DateGuestsTime({
    formData,
    setFormData,
    calendarYear,
    calendarMonth,
    onPrevMonth,
    onNextMonth,
    disablePrevMonth,
    disableNextMonth,
    calendarMessage,
    calendarStatusMap,
    calendarStatusLoading,
    calendarStatusError,
    onGuestChange,
    onDateChange,
    onStartTimeChange,
    onSelectVisitType,
    dayAvailabilityLoading,
    dayAvailabilityError,
    lunchAvailableTimes,
    dinnerAvailableTimes,
    lunchDeadlinePassed,
    dinnerDeadlinePassed,
}: {
    formData: ReservationFormData;
    setFormData: React.Dispatch<React.SetStateAction<ReservationFormData>>;
    calendarYear: number;
    calendarMonth: number;
    onPrevMonth: () => void;
    onNextMonth: () => void;
    disablePrevMonth: boolean;
    disableNextMonth: boolean;
    calendarMessage: string;
    calendarStatusMap: CalendarStatusMap;
    calendarStatusLoading: boolean;
    calendarStatusError: string;
    onGuestChange: (type: "adult" | "child", value: number) => void;
    onDateChange: (date: string) => void;
    onStartTimeChange: (time: string) => void;
    onSelectVisitType: (visitType: VisitType) => void;
    dayAvailabilityLoading: boolean;
    dayAvailabilityError: string;
    lunchAvailableTimes: string[];
    dinnerAvailableTimes: string[];
    lunchDeadlinePassed: boolean;
    dinnerDeadlinePassed: boolean;
}) {
    const displayTimes =
        formData.visitType === "lunch"
            ? lunchAvailableTimes
            : formData.visitType === "dinner"
                ? dinnerAvailableTimes
                : [];

    const calendarDays = buildCalendarDays(calendarYear, calendarMonth, calendarStatusMap);

    return (
        <div className="space-y-8">
            <section>
                <h2 className="mb-3 text-lg font-black text-yellow-300 md:text-xl">ステップ1 来店日を選ぶ</h2>

                <div className="rounded-2xl bg-black/25 p-3">
                    <div className="mb-3 flex items-center justify-between gap-3">
                        <button
                            type="button"
                            onClick={onPrevMonth}
                            className={`rounded-full border px-3 py-2 text-sm font-bold ${disablePrevMonth
                                ? "border-white/10 bg-white/5 text-white/30"
                                : "border-white/20 bg-white/5 text-white hover:bg-white/10"
                                }`}
                        >
                            ←
                        </button>

                        <div className="text-center text-base font-black text-white md:text-lg">
                            {calendarYear}年{calendarMonth}月
                        </div>

                        <button
                            type="button"
                            onClick={onNextMonth}
                            className={`rounded-full border px-3 py-2 text-sm font-bold ${disableNextMonth
                                ? "border-white/10 bg-white/5 text-white/30"
                                : "border-white/20 bg-white/5 text-white hover:bg-white/10"
                                }`}
                        >
                            →
                        </button>
                    </div>

                    {calendarStatusLoading && (
                        <p className="mb-3 text-center text-xs font-bold text-white/70 md:text-sm">
                            空き状況を読み込み中です...
                        </p>
                    )}

                    {calendarStatusError && (
                        <p className="mb-3 text-center text-xs font-bold text-red-300 md:text-sm">
                            {calendarStatusError}
                        </p>
                    )}

                    {calendarMessage && (
                        <p className="mb-3 text-center text-xs font-bold text-yellow-200 md:text-sm">
                            {calendarMessage}
                        </p>
                    )}

                    <div className="mb-2 grid grid-cols-7 gap-2 text-center text-sm font-bold">
                        {weekLabels.map((label, index) => {
                            const colorClass =
                                index === 0
                                    ? "text-red-400"
                                    : index === 6
                                        ? "text-sky-300"
                                        : "text-white/80";

                            return (
                                <div key={label} className={colorClass}>
                                    {label}
                                </div>
                            );
                        })}
                    </div>

                    <div className="grid grid-cols-7 gap-2">
                        {calendarDays.map((day, index) => {
                            if (!day.isCurrentMonth) {
                                return <div key={`blank-${index}`} className="aspect-square rounded-xl bg-transparent" />;
                            }

                            const isSelected = formData.visitDate === day.date;

                            const dayNumberColorClass =
                                day.weekday === 0
                                    ? "text-red-400"
                                    : day.weekday === 6
                                        ? "text-sky-300"
                                        : "text-white";

                            const statusColorClass =
                                day.status === "◎"
                                    ? "text-green-400"
                                    : day.status === "△"
                                        ? "text-yellow-300"
                                        : day.status === "×"
                                            ? "text-white/75"
                                            : day.status === "休"
                                                ? "text-red-300"
                                                : day.status === "-"
                                                    ? "text-white/30"
                                                    : "text-white/70";

                            return (
                                <button
                                    key={day.date}
                                    type="button"
                                    disabled={day.disabled}
                                    onClick={() => onDateChange(day.date)}
                                    className={`aspect-square rounded-xl border p-1 text-center transition ${isSelected
                                        ? "border-yellow-300 bg-yellow-400 text-black"
                                        : "border-white/20 bg-white/5 text-white"
                                        } ${day.disabled ? "cursor-not-allowed opacity-40" : "hover:bg-white/10"}`}
                                >
                                    <div
                                        className={`mt-1 text-sm font-black md:text-base ${isSelected ? "text-black" : dayNumberColorClass
                                            }`}
                                    >
                                        {day.dayNumber}
                                    </div>
                                    <div
                                        className={`mt-1 text-[11px] font-bold md:text-xs ${isSelected ? "text-black/80" : statusColorClass
                                            }`}
                                    >
                                        {day.status}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </section>

            <section>
                <h2 className="mb-3 text-lg font-black text-yellow-300 md:text-xl">STEP2 人数を選ぶ</h2>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="mb-2 block text-sm font-bold text-white">大人</label>
                        <select
                            value={formData.adult}
                            onChange={(e) => onGuestChange("adult", Number(e.target.value))}
                            className="w-full rounded-xl border border-yellow-600 bg-white px-4 py-3 text-black"
                        >
                            {Array.from({ length: 25 }, (_, i) => i).map((n) => (
                                <option key={n} value={n}>
                                    {n}名
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="mb-2 block text-sm font-bold text-white">子供</label>
                        <select
                            value={formData.child}
                            onChange={(e) => onGuestChange("child", Number(e.target.value))}
                            className="w-full rounded-xl border border-yellow-600 bg-white px-4 py-3 text-black"
                        >
                            {Array.from({ length: 25 }, (_, i) => i).map((n) => (
                                <option key={n} value={n}>
                                    {n}名
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
            </section>

            <section>
                <h2 className="mb-3 text-lg font-black text-yellow-300 md:text-xl">STEP3 ランチ / ディナーを選ぶ</h2>
                <div className="grid grid-cols-2 gap-3">
                    <button
                        type="button"
                        onClick={() => onSelectVisitType("lunch")}
                        className={`rounded-2xl border px-4 py-4 text-base font-black transition ${formData.visitType === "lunch"
                            ? "border-yellow-300 bg-yellow-400 text-black"
                            : "border-white/20 bg-white/5 text-white hover:bg-white/10"
                            }`}
                    >
                        ランチ
                    </button>

                    <button
                        type="button"
                        onClick={() => onSelectVisitType("dinner")}
                        className={`rounded-2xl border px-4 py-4 text-base font-black transition ${formData.visitType === "dinner"
                            ? "border-yellow-300 bg-yellow-400 text-black"
                            : "border-white/20 bg-white/5 text-white hover:bg-white/10"
                            }`}
                    >
                        ディナー
                    </button>
                </div>
            </section>

            <section>
                <h2 className="mb-3 text-lg font-black text-yellow-300 md:text-xl">STEP4 時間帯を選ぶ</h2>

                {dayAvailabilityLoading && (
                    <p className="mb-3 text-sm font-bold text-white/70">
                        選択日の空き時間を取得中です...
                    </p>
                )}

                {dayAvailabilityError && (
                    <p className="mb-3 text-sm font-bold text-red-300">
                        {dayAvailabilityError}
                    </p>
                )}

                {!dayAvailabilityLoading &&
                    !dayAvailabilityError &&
                    formData.visitType &&
                    displayTimes.length === 0 && (
                        <div className="mb-3 rounded-2xl border border-white/10 bg-black/25 px-4 py-5 text-sm text-white/75">
                            {formData.visitType === "lunch" && lunchDeadlinePassed
                                ? "本日のランチの受付は終了しました。日付・人数・ランチ / ディナーを変更してお試しください。"
                                : formData.visitType === "dinner" && dinnerDeadlinePassed
                                    ? "本日のディナーの受付は終了しました。日付・人数・ランチ / ディナーを変更してお試しください。"
                                    : "この条件で選択できる時間帯がありません。日付・人数・ランチ / ディナーを変更してお試しください。"}
                        </div>
                    )}

                {!formData.visitType ? (
                    <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-5 text-sm text-white/75">
                        先にランチかディナーを選択してください。
                    </div>
                ) : (
                    <div className="relative">
                        <div className="overflow-x-auto">
                            <div className="flex min-w-max gap-2 rounded-2xl bg-black/25 p-3">
                                {displayTimes.map((time) => (
                                    <button
                                        key={time}
                                        type="button"
                                        onClick={() => onStartTimeChange(time)}
                                        className={`shrink-0 rounded-full border px-5 py-3 text-sm font-bold transition ${formData.startTime === time
                                            ? "border-yellow-300 bg-yellow-400 text-black"
                                            : "border-white/20 bg-white/5 text-white hover:bg-white/10"
                                            }`}
                                    >
                                        {time}
                                    </button>
                                ))}
                            </div>
                        </div>
                        {displayTimes.length > 0 && (
                            <p className="mt-2 text-center text-xs font-bold text-white/50">
                                ← 左右にスクロールできます →
                            </p>
                        )}
                    </div>
                )}

                {!formData.visitType && (
                    <p className="mt-2 text-sm text-white/75">
                        ランチまたはディナーを選ぶと、選択可能な時間帯が表示されます。
                    </p>
                )}
            </section>
        </div>
    );
}

function Step2Course({
    formData,
    setFormData,
    courseAvailability,
    courseAvailabilityLoading,
    courseAvailabilityError,
}: {
    formData: ReservationFormData;
    setFormData: React.Dispatch<React.SetStateAction<ReservationFormData>>;
    courseAvailability: {
        seatOnlyAvailable: boolean;
        course120Available: boolean;
        course150Available: boolean;
    } | null;
    courseAvailabilityLoading: boolean;
    courseAvailabilityError: string;
}) {
    const [detailCourseKey, setDetailCourseKey] = useState<Exclude<Course, ""> | null>(null);
    const [detailImageIndex, setDetailImageIndex] = useState(0);

    const courseState = getCourseState({
        formData,
        courseAvailability,
    });

    const courseCards: {
        key: Exclude<Course, "">;
        title: string;
        badge?: string;
        price?: string;
        imageSrc: string;
        imageGallery: string[];
        seatTime: string;
        deadline: string;
        items: string;
        guests: string;
        description: string;
        highlightNote?: string;
        detailRows: { label: string; value: string }[];
        courseContent?: string;
    }[] = [
            {
                key: "席のみ",
                title: "お席のみのご予約",
                imageSrc: "/temp-photo.jpg",
                imageGallery: ["/temp-photo.jpg"],
                price: "",
                seatTime: "120分",
                deadline: "ランチ帯：ご利用当日13:00\nディナー帯：ご利用当日20:00",
                items: "-",
                guests: "1名様〜",
                description: "コースを指定せずにお席のみのご予約になります。",
                detailRows: [
                    { label: "ご利用人数", value: "1名様〜" },
                    { label: "席時間", value: "ランチ帯90分\nディナー帯120分" },
                    { label: "ランチ帯ご予約可能時間", value: "11:00〜13:00スタート" },
                    {
                        label: "ディナー帯ご予約可能時間",
                        value: "17:00〜20:00スタート (日〜火・木)\n 17:00〜21:00スタート (金・土・祝)",
                    },
                    { label: "ご予約可能日", value: "日〜火・木〜土・祝日・祝前日" },
                    { label: "ご予約締切", value: "ご利用当日20:00" },
                ],
            },
            {
                key: "だるま満喫",
                title: "だるま満喫コース",
                badge: "おすすめ",
                imageSrc: "/temp-photo.jpg",
                imageGallery: [
                    "/temp-photo.jpg",
                    "/temp-photo.jpg",
                    "/temp-photo.jpg",
                    "/temp-photo.jpg",
                    "/temp-photo.jpg",
                ],
                price: "2,980円（税込）／1名様",
                seatTime: "120分",
                deadline: "ご利用前日22:00",
                items: "9品",
                guests: "2名様〜",
                description:
                    "後ほど差し替えます。サンプルテキスト。サンプルテキスト。サンプルテキスト。サンプルテキスト。サンプルテキスト。サンプルテキスト。",
                highlightNote:
                    "お一人様＋1,500円（税込）で90分飲み放題がお選びいただけます！",
                detailRows: [
                    { label: "コース品数", value: "9品" },
                    { label: "ご利用人数", value: "2名様〜" },
                    { label: "席時間", value: "120分" },
                    {
                        label: "ご予約可能時間",
                        value: "17:00〜20:00スタート (日〜火・木)\n17:00〜21:00スタート (金・土・祝)",
                    },
                    { label: "ご予約可能日", value: "日〜火・木〜土・祝日・祝前日" },
                    { label: "ご予約締切", value: "ご利用前日22:00" },
                    { label: "飲み放題", value: "お一人様＋1,500円（税込）で90分飲み放題！" },
                ],
                courseContent: `〜前菜3種〜
枝豆
白菜キムチ
ポテトサラダ（小鉢）

〜鉄板焼き2品〜
ズーチーモ
とんぺい焼

〜焼きそば〜
豚焼きそば

〜お好み焼き〜
だるま焼

〜もんじゃ〜
明太もちチーズもんじゃ

〜甘味〜
アイス（バニラor抹茶）`,
            },
            {
                key: "鉄板満喫",
                title: "鉄板満喫コース",
                imageSrc: "/temp-photo.jpg",
                imageGallery: [
                    "/temp-photo.jpg",
                    "/temp-photo.jpg",
                    "/temp-photo.jpg",
                    "/temp-photo.jpg",
                    "/temp-photo.jpg",
                ],
                price: "3,980円（税込）／1名様",
                seatTime: "150分",
                deadline: "ご利用前日22:00",
                items: "10品",
                guests: "2名様〜",
                description:
                    "後ほど差し替えます。サンプルテキスト。サンプルテキスト。サンプルテキスト。サンプルテキスト。サンプルテキスト。サンプルテキスト。",
                highlightNote:
                    "お一人様＋2,000円（税込）で120分飲み放題がお選びいただけます！",
                detailRows: [
                    { label: "コース品数", value: "10品" },
                    { label: "ご利用人数", value: "2名様〜" },
                    { label: "席時間", value: "150分" },
                    {
                        label: "ご予約可能時間",
                        value: "17:00〜19:30スタート (日〜火・木)\n17:00〜20:30スタート (金・土・祝)",
                    },
                    { label: "ご予約可能日", value: "日〜火・木〜土・祝日・祝前日" },
                    { label: "ご予約締切", value: "ご利用前日22:00" },
                    { label: "飲み放題", value: "お一人様＋2,000円（税込）で120分飲み放題！" },
                ],
                courseContent: `〜前菜3種〜
枝豆
白菜キムチ
ポテトサラダ（小鉢）

〜鉄板焼き3品〜
ズーチーモ
ガーリックシュリンプ（変更可）
ホタテバター

〜焼きそば〜
ミックス焼きそば

〜お好み焼き〜
特だるま焼

〜もんじゃ〜
明太もちチーズもんじゃ

〜甘味〜
アイス（バニラor抹茶）`,
            },
            {
                key: "特選だるま",
                title: "特選だるまコース",
                imageSrc: "/temp-photo.jpg",
                imageGallery: [
                    "/temp-photo.jpg",
                    "/temp-photo.jpg",
                    "/temp-photo.jpg",
                    "/temp-photo.jpg",
                    "/temp-photo.jpg",
                ],
                price: "5,980円（税込）／1名様",
                seatTime: "150分",
                deadline: "ご利用前日22:00",
                items: "12品",
                guests: "2名様〜",
                description:
                    "後ほど差し替えます。サンプルテキスト。サンプルテキスト。サンプルテキスト。サンプルテキスト。サンプルテキスト。サンプルテキスト。",
                highlightNote:
                    "お一人様＋2,000円（税込）で120分飲み放題がお選びいただけます！",
                detailRows: [
                    { label: "コース品数", value: "12品" },
                    { label: "ご利用人数", value: "2名様〜" },
                    { label: "席時間", value: "150分" },
                    {
                        label: "ご予約可能時間",
                        value: "17:00〜19:30スタート (日〜火・木)\n17:00〜20:30スタート (金・土・祝)",
                    },
                    { label: "ご予約可能日", value: "日〜火・木〜土・祝日・祝前日" },
                    { label: "ご予約締切", value: "ご利用前日22:00" },
                    { label: "飲み放題", value: "お一人様＋2,000円（税込）で120分飲み放題！" },
                ],
                courseContent: `〜前菜3種〜
枝豆
チャンジャ
ポテトサラダ（小鉢）

〜鉄板焼き4品〜
ズーチーモ
牡蠣バター（変更可）
ホタテバター
ガーリックシュリンプ（変更可）

〜肉料理〜
サーロインステーキ

〜焼きそば〜
牡蠣焼きそば（変更可）

〜お好み焼き〜
特だるま焼

〜もんじゃ〜
明太もちチーズもんじゃ

〜甘味〜
アイス（バニラor抹茶）`,
            },
        ];

    const detailCourse =
        detailCourseKey ? courseCards.find((course) => course.key === detailCourseKey) ?? null : null;

    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    useEffect(() => {
        if (detailCourse) {
            const originalOverflow = document.body.style.overflow;
            document.body.style.overflow = "hidden";

            return () => {
                document.body.style.overflow = originalOverflow;
            };
        }

        return;
    }, [detailCourse]);

    const detailState = detailCourse ? courseState[detailCourse.key] : null;
    const detailMainImage =
        detailCourse && detailCourse.imageGallery[detailImageIndex]
            ? detailCourse.imageGallery[detailImageIndex]
            : detailCourse?.imageSrc;

    return (
        <div>
            <h2 className="mb-3 text-lg font-black text-yellow-300 md:text-xl">STEP4 コースを選ぶ</h2>

            {courseAvailabilityLoading && (
                <p className="mb-4 text-sm font-bold text-white/70">
                    コース選択可否を確認中です...
                </p>
            )}

            {courseAvailabilityError && (
                <p className="mb-4 text-sm font-bold text-red-300">
                    {courseAvailabilityError}
                </p>
            )}

            <div className="grid gap-5">
                {courseCards.map((course) => {
                    const state = courseState[course.key];
                    const isSelected = formData.course === course.key;

                    return (
                        <div
                            key={course.key}
                            className={`overflow-hidden rounded-[28px] border p-4 transition md:p-5 ${state.disabled
                                ? "border-white/10 bg-white/5 opacity-60"
                                : isSelected
                                    ? "border-yellow-300 bg-[rgba(255,220,90,0.08)] shadow-[0_0_0_1px_rgba(253,224,71,0.25)]"
                                    : "border-yellow-500/60 bg-black/25"
                                }`}
                        >
                            <div className="grid gap-4 md:grid-cols-[220px_1fr]">
                                <div>
                                    <div className="mb-3 flex items-center gap-2">
                                        <h3
                                            className="text-[22px] font-bold tracking-[0.06em] text-transparent bg-clip-text"
                                            style={{
                                                fontFamily:
                                                    '"Times New Roman", "Hiragino Mincho ProN", "Yu Mincho", serif',
                                                backgroundImage:
                                                    "linear-gradient(180deg, #fff7cc 0%, #f7d96b 22%, #d9a93a 52%, #fff1a8 78%, #b67a18 100%)",
                                                textShadow:
                                                    "0 1px 0 rgba(255,255,255,0.12), 0 2px 10px rgba(250,204,21,0.10)",
                                            }}
                                        >
                                            {course.title}
                                        </h3>

                                        {course.badge && (
                                            <span
                                                className="rounded-full px-3 py-1 text-[11px] font-black tracking-[0.12em] text-white"
                                                style={{
                                                    background:
                                                        "linear-gradient(135deg, #7f1d1d 0%, #dc2626 45%, #f59e0b 100%)",
                                                    boxShadow: "0 6px 18px rgba(239,68,68,0.35)",
                                                    border: "1px solid rgba(255,220,120,0.45)",
                                                }}
                                            >
                                                {course.badge}
                                            </span>
                                        )}
                                    </div>

                                    {state.reason && (
                                        <p className="mb-3 rounded-2xl border border-yellow-500/20 bg-yellow-500/10 px-4 py-3 text-center text-sm font-bold text-yellow-200">
                                            {state.reason}
                                        </p>
                                    )}

                                    <div className="aspect-square overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                                        <img
                                            src={course.imageSrc}
                                            alt={course.title}
                                            className="h-full w-full object-cover"
                                        />
                                    </div>
                                </div>

                                <div className="flex flex-col">
                                    {course.price ? (
                                        <p className="mb-3 text-lg font-black text-yellow-200">{course.price}</p>
                                    ) : (
                                        <div className="mb-3 h-[28px]" />
                                    )}

                                    <div className="mb-4 grid grid-cols-2 gap-2">
                                        <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-center">
                                            <div className="mb-1 text-[11px] font-bold text-white/60">席時間</div>
                                            <div className="text-sm font-black text-white">{course.seatTime}</div>
                                        </div>

                                        <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-center">
                                            <div className="mb-1 text-[11px] font-bold text-white/60">予約締切</div>
                                            <div className="text-sm font-black text-white">{course.deadline}</div>
                                        </div>

                                        <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-center">
                                            <div className="mb-1 text-[11px] font-bold text-white/60">コース品数</div>
                                            <div className="text-sm font-black text-white">{course.items}</div>
                                        </div>

                                        <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-center">
                                            <div className="mb-1 text-[11px] font-bold text-white/60">ご利用人数</div>
                                            <div className="text-sm font-black text-white">{course.guests}</div>
                                        </div>
                                    </div>

                                    <p className="mb-3 text-sm leading-7 text-white/85">
                                        {course.description}
                                    </p>

                                    {course.highlightNote && (
                                        <p className="mb-4 text-sm font-black leading-7 text-red-400">
                                            {course.highlightNote}
                                        </p>
                                    )}

                                    <div className="mt-auto flex flex-col gap-3 sm:flex-row">
                                        <button
                                            type="button"
                                            disabled={state.disabled}
                                            onClick={() =>
                                                setFormData((prev) => ({
                                                    ...prev,
                                                    course: course.key,
                                                    drink: "",
                                                    teppanPref: "",
                                                }))
                                            }
                                            className={`rounded-2xl px-5 py-3 text-sm font-black transition ${state.disabled
                                                ? "cursor-not-allowed bg-white/10 text-white/50"
                                                : isSelected
                                                    ? "bg-yellow-400 text-black shadow-[0_8px_20px_rgba(250,204,21,0.25)]"
                                                    : "bg-gradient-to-r from-yellow-300 via-yellow-400 to-yellow-500 text-black shadow-[0_8px_18px_rgba(234,179,8,0.22)] hover:brightness-105"
                                                }`}
                                        >
                                            このコースを選ぶ
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => {
                                                setDetailCourseKey(course.key);
                                                setDetailImageIndex(0);
                                            }}
                                            className="rounded-2xl border border-white/20 bg-white/5 px-5 py-3 text-sm font-black text-white transition hover:bg-white/10"
                                        >
                                            詳細を見る
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {isMounted && detailCourse &&
                createPortal(
                    <div className="fixed inset-0 z-[9999] bg-black/30 backdrop-blur-2xl">
                        <div className="absolute inset-0 overflow-y-auto">
                            <div className="flex min-h-full items-center justify-center p-4 md:p-6">
                                <div className="w-full max-w-4xl overflow-hidden rounded-[28px] border border-yellow-400/20 bg-[rgba(18,12,6,0.86)] shadow-2xl">
                                    <div className="border-b border-white/10 px-5 py-4 md:px-7">
                                        <div className="flex items-start justify-between gap-4">
                                            <div>
                                                <div>
                                                    <h3
                                                        className="text-2xl font-bold tracking-[0.06em] text-transparent bg-clip-text"
                                                        style={{
                                                            fontFamily:
                                                                '"Times New Roman", "Hiragino Mincho ProN", "Yu Mincho", serif',
                                                            backgroundImage:
                                                                "linear-gradient(180deg, #fff7cc 0%, #f7d96b 22%, #d9a93a 52%, #fff1a8 78%, #b67a18 100%)",
                                                        }}
                                                    >
                                                        {detailCourse.title}
                                                    </h3>

                                                    {detailCourse.badge && (
                                                        <div className="mt-3">
                                                            <span
                                                                className="inline-flex whitespace-nowrap rounded-full px-4 py-1 text-[11px] font-black tracking-[0.12em] text-white"
                                                                style={{
                                                                    background:
                                                                        "linear-gradient(135deg, #7f1d1d 0%, #dc2626 45%, #f59e0b 100%)",
                                                                    boxShadow: "0 6px 18px rgba(239,68,68,0.35)",
                                                                    border: "1px solid rgba(255,220,120,0.45)",
                                                                }}
                                                            >
                                                                {detailCourse.badge}
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>

                                                {detailState?.reason && (
                                                    <p className="rounded-2xl border border-yellow-500/20 bg-yellow-500/10 px-4 py-3 text-center text-sm font-bold text-yellow-200">
                                                        {detailState.reason}
                                                    </p>
                                                )}
                                            </div>

                                            <button
                                                type="button"
                                                onClick={() => setDetailCourseKey(null)}
                                                className="rounded-full border border-white/15 px-3 py-2 text-sm font-bold text-white/80 transition hover:bg-white/10"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    </div>

                                    <div className="max-h-[calc(92vh-88px)] overflow-y-auto px-5 py-5 md:px-7">
                                        <div className="mb-5 overflow-hidden rounded-[24px] border border-white/10 bg-black/5">
                                            <div className="aspect-[4/3] w-full overflow-hidden">
                                                <img
                                                    src={detailMainImage}
                                                    alt={detailCourse.title}
                                                    className="h-full w-full object-cover"
                                                />
                                            </div>
                                        </div>

                                        {detailCourse.imageGallery.length > 1 && (
                                            <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
                                                {detailCourse.imageGallery.map((src, index) => (
                                                    <button
                                                        key={`${detailCourse.key}-${index}`}
                                                        type="button"
                                                        onClick={() => setDetailImageIndex(index)}
                                                        className={`shrink-0 overflow-hidden rounded-2xl border transition ${detailImageIndex === index
                                                            ? "border-yellow-300"
                                                            : "border-white/10"
                                                            }`}
                                                    >
                                                        <img
                                                            src={src}
                                                            alt={`${detailCourse.title} ${index + 1}`}
                                                            className="h-20 w-20 object-cover"
                                                        />
                                                    </button>
                                                ))}
                                            </div>
                                        )}

                                        <p className="mb-5 text-sm leading-8 text-white/85">
                                            {detailCourse.description}
                                        </p>

                                        {detailCourse.price && (
                                            <p className="mb-5 text-xl font-black text-yellow-200">
                                                {detailCourse.price}
                                            </p>
                                        )}

                                        <div className="mb-6 overflow-hidden rounded-[24px] border border-white/10 bg-black/5">
                                            {detailCourse.detailRows.map((row, index) => (
                                                <div
                                                    key={`${detailCourse.key}-row-${index}`}
                                                    className="grid grid-cols-[130px_1fr] border-b border-white/10 last:border-b-0"
                                                >
                                                    <div className="bg-white/5 px-4 py-3 text-sm font-black text-yellow-200">
                                                        {row.label}
                                                    </div>
                                                    <div
                                                        className={`whitespace-pre-line px-4 py-3 text-sm leading-7 ${row.label === "飲み放題"
                                                            ? "font-black text-red-400"
                                                            : "text-white"
                                                            }`}
                                                    >
                                                        {row.value}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>

                                        {detailCourse.courseContent && (
                                            <div className="mb-6 rounded-[24px] border border-white/10 bg-black/5 px-5 py-5 text-center">
                                                <h4 className="mb-5 text-xl font-black tracking-[0.08em] text-yellow-100">
                                                    コース内容
                                                </h4>

                                                <div className="space-y-2 text-sm leading-8 text-white/90">
                                                    {detailCourse.courseContent.split("\n").map((line, index) => {
                                                        const trimmed = line.trim();
                                                        const isHeading =
                                                            trimmed.startsWith("〜") && trimmed.endsWith("〜");

                                                        if (!trimmed) {
                                                            return <div key={index} className="h-2" />;
                                                        }

                                                        return (
                                                            <p
                                                                key={index}
                                                                className={
                                                                    isHeading
                                                                        ? "pt-4 text-lg font-bold tracking-[0.04em] text-transparent bg-clip-text"
                                                                        : ""
                                                                }
                                                                style={
                                                                    isHeading
                                                                        ? {
                                                                            fontFamily:
                                                                                '"Times New Roman", "Hiragino Mincho ProN", "Yu Mincho", serif',
                                                                            backgroundImage:
                                                                                "linear-gradient(180deg, #fff7cc 0%, #f7d96b 22%, #d9a93a 52%, #fff1a8 78%, #b67a18 100%)",
                                                                        }
                                                                        : undefined
                                                                }
                                                            >
                                                                {trimmed}
                                                            </p>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}

                                        <div className="flex flex-col gap-3 sm:flex-row">
                                            <button
                                                type="button"
                                                disabled={detailState?.disabled}
                                                onClick={() => {
                                                    if (detailState?.disabled) return;

                                                    setFormData((prev) => ({
                                                        ...prev,
                                                        course: detailCourse.key,
                                                        drink: "",
                                                        teppanPref: "",
                                                    }));
                                                    setDetailCourseKey(null);
                                                }}
                                                className={`rounded-2xl px-5 py-3 text-sm font-black transition ${detailState?.disabled
                                                    ? "cursor-not-allowed bg-white/10 text-white/50"
                                                    : "bg-gradient-to-r from-yellow-300 via-yellow-400 to-yellow-500 text-black shadow-[0_8px_18px_rgba(234,179,8,0.22)] hover:brightness-105"
                                                    }`}
                                            >
                                                このコースを選ぶ
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => setDetailCourseKey(null)}
                                                className="rounded-2xl border border-white/20 bg-white/5 px-5 py-3 text-sm font-black text-white transition hover:bg-white/10"
                                            >
                                                閉じる
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>,
                    document.body
                )}
        </div>
    );
}

function Step3Options({
    formData,
    setFormData,
}: {
    formData: ReservationFormData;
    setFormData: React.Dispatch<React.SetStateAction<ReservationFormData>>;
}) {
    const drinkOptions = getDrinkOptions(formData.course);
    const teppanOptions = getTeppanOptions(formData.adult, formData.child);
    const showDrink = !(drinkOptions.length === 1 && drinkOptions[0] === "なし");
    const showTeppan = !(teppanOptions.length === 1 && teppanOptions[0] === "指定不可");

    return (
        <div className="space-y-8">
            <h2 className="mb-3 text-lg font-black text-yellow-300 md:text-xl">STEP5 オプションを選ぶ</h2>

            {showDrink && (
                <section>
                    <h3 className="mb-3 text-lg font-bold text-white">飲み放題</h3>
                    <div className="flex flex-wrap gap-2">
                        {drinkOptions.map((option) => (
                            <button
                                key={option}
                                type="button"
                                onClick={() => setFormData((prev) => ({ ...prev, drink: option }))}
                                className={`rounded-full border px-4 py-2 text-sm font-bold ${formData.drink === option ? "border-yellow-300 bg-yellow-400 text-black" : "border-white/20 bg-white/5 text-white"
                                    }`}
                            >
                                {option}
                            </button>
                        ))}
                    </div>
                </section>
            )}

            {showTeppan && (
                <section>
                    <h3 className="mb-3 text-lg font-bold text-white">鉄板希望</h3>
                    <div className="flex flex-wrap gap-2">
                        {teppanOptions.map((option) => (
                            <button
                                key={option}
                                type="button"
                                onClick={() => setFormData((prev) => ({ ...prev, teppanPref: option }))}
                                className={`rounded-full border px-4 py-2 text-sm font-bold ${formData.teppanPref === option ? "border-yellow-300 bg-yellow-400 text-black" : "border-white/20 bg-white/5 text-white"
                                    }`}
                            >
                                {option}
                            </button>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}

function Step4CustomerInfo({
    formData,
    setFormData,
}: {
    formData: ReservationFormData;
    setFormData: React.Dispatch<React.SetStateAction<ReservationFormData>>;
}) {
    const update = (key: keyof ReservationFormData, value: string) => {
        setFormData((prev) => ({ ...prev, [key]: value }));
    };

    return (
        <div className="space-y-5">
            <h2 className="mb-3 text-lg font-black text-yellow-300 md:text-xl">STEP6 お客様情報を入力</h2>
            <input value={formData.name} onChange={(e) => update("name", e.target.value)} placeholder="氏名" className="w-full rounded-xl border border-yellow-600 bg-white px-4 py-3 text-black" />
            <input value={formData.kana} onChange={(e) => update("kana", e.target.value)} placeholder="フリガナ" className="w-full rounded-xl border border-yellow-600 bg-white px-4 py-3 text-black" />
            <input value={formData.phone} onChange={(e) => update("phone", e.target.value)} placeholder="電話番号" className="w-full rounded-xl border border-yellow-600 bg-white px-4 py-3 text-black" />
            <textarea value={formData.note} onChange={(e) => update("note", e.target.value)} placeholder="備考" rows={4} className="w-full rounded-xl border border-yellow-600 bg-white px-4 py-3 text-black" />
        </div>
    );
}

function Step5Confirm({ formData }: { formData: ReservationFormData }) {
    return (
        <div className="space-y-4">
            <h2 className="mb-3 text-lg font-black text-yellow-300 md:text-xl">STEP7 内容確認</h2>
            <div className="rounded-2xl border border-yellow-500 bg-black/25 p-4 text-white">
                <dl className="grid gap-2 md:grid-cols-2">
                    <div><dt className="text-sm text-white/65">来店日</dt><dd>{formData.visitDate}</dd></div>
                    <div><dt className="text-sm text-white/65">来店区分</dt><dd>{formData.visitType === "lunch" ? "ランチ" : formData.visitType === "dinner" ? "ディナー" : ""}</dd></div>
                    <div><dt className="text-sm text-white/65">開始時間</dt><dd>{formData.startTime}</dd></div>
                    <div><dt className="text-sm text-white/65">人数</dt><dd>大人 {formData.adult} / 子供 {formData.child}</dd></div>
                    <div><dt className="text-sm text-white/65">コース</dt><dd>{formData.course}</dd></div>
                    <div><dt className="text-sm text-white/65">飲み放題</dt><dd>{formData.drink}</dd></div>
                    <div><dt className="text-sm text-white/65">鉄板希望</dt><dd>{formData.teppanPref}</dd></div>
                    <div><dt className="text-sm text-white/65">氏名</dt><dd>{formData.name}</dd></div>
                    <div><dt className="text-sm text-white/65">フリガナ</dt><dd>{formData.kana}</dd></div>
                    <div><dt className="text-sm text-white/65">電話番号</dt><dd>{formData.phone}</dd></div>
                    <div className="md:col-span-2"><dt className="text-sm text-white/65">備考</dt><dd>{formData.note || "なし"}</dd></div>
                </dl>
            </div>
            <button type="button" className="w-full rounded-2xl bg-yellow-400 px-6 py-4 text-lg font-black text-black">
                送信する
            </button>
        </div>
    );
}

export default function ReservationForm() {
    const [currentStep, setCurrentStep] = useState<Step>(1);
    const [formData, setFormData] = useState<ReservationFormData>(initialFormData);
    const [error, setError] = useState("");

    const [displayName, setDisplayName] = useState("");
    const [lineUserId, setLineUserId] = useState("");
    const [isLiffReady, setIsLiffReady] = useState(false);
    const [liffError, setLiffError] = useState("");

    const today = new Date();
    const minYear = today.getFullYear();
    const minMonth = today.getMonth() + 1;

    const maxBaseDate = new Date(today.getFullYear(), today.getMonth() + 3, 0);
    const maxYear = maxBaseDate.getFullYear();
    const maxMonth = maxBaseDate.getMonth() + 1;

    const [calendarYear, setCalendarYear] = useState(minYear);
    const [calendarMonth, setCalendarMonth] = useState(minMonth);

    const isAtMinMonth = calendarYear === minYear && calendarMonth === minMonth;
    const isAtMaxMonth = calendarYear === maxYear && calendarMonth === maxMonth;

    const [calendarMessage, setCalendarMessage] = useState("");

    const [calendarStatusMap, setCalendarStatusMap] = useState<CalendarStatusMap>({});
    const [calendarStatusLoading, setCalendarStatusLoading] = useState(true);
    const [calendarStatusError, setCalendarStatusError] = useState("");

    const [dayAvailabilityLoading, setDayAvailabilityLoading] = useState(false);
    const [dayAvailabilityError, setDayAvailabilityError] = useState("");
    const [lunchAvailableTimes, setLunchAvailableTimes] = useState<string[]>([]);
    const [dinnerAvailableTimes, setDinnerAvailableTimes] = useState<string[]>([]);

    const [courseAvailabilityLoading, setCourseAvailabilityLoading] = useState(false);
    const [courseAvailabilityError, setCourseAvailabilityError] = useState("");
    const [courseAvailability, setCourseAvailability] = useState<{
        seatOnlyAvailable: boolean;
        course120Available: boolean;
        course150Available: boolean;
    } | null>(null);

    const [lunchDeadlinePassed, setLunchDeadlinePassed] = useState(false);
    const [dinnerDeadlinePassed, setDinnerDeadlinePassed] = useState(false);

    const [isPageTransitionLoading, setIsPageTransitionLoading] = useState(false);

    useEffect(() => {
        const initLiff = async () => {
            try {
                await liff.init({ liffId: LIFF_ID });

                if (!liff.isLoggedIn()) {
                    liff.login({ redirectUri: window.location.href });
                    return;
                }

                const profile = await liff.getProfile();
                setDisplayName(profile.displayName || "");
                setLineUserId(profile.userId || "");
                setIsLiffReady(true);
            } catch (error) {
                console.error(error);
                setLiffError("LIFFの初期化に失敗しました。");
            }
        };

        initLiff();
    }, []);

    useEffect(() => {
        const loadCalendarStatus = async () => {
            try {
                setCalendarStatusLoading(true);
                setCalendarStatusError("");

                const result = await fetchCalendarStatus();
                console.log("Firebase calendarCache result:", result);
                console.log("calendarStatus keys:", Object.keys(result.calendarStatus || {}));

                setCalendarStatusMap(result.calendarStatus);
            } catch (error) {
                console.error("fetchCalendarStatus error:", error);
                setCalendarStatusError("カレンダー情報の取得に失敗しました。");
            } finally {
                setCalendarStatusLoading(false);
            }
        };

        loadCalendarStatus();
    }, []);

    useEffect(() => {
        window.scrollTo({ top: 0, behavior: "smooth" });
    }, [currentStep]);

    const totalGuests = formData.adult + formData.child;
    const skipOptionStep = useMemo(() => shouldSkipOptionStep(formData), [formData]);

    const normalizeBeforeNext = () => {
        if (formData.course) {
            const drinkOptions = getDrinkOptions(formData.course);
            const teppanOptions = getTeppanOptions(formData.adult, formData.child);

            setFormData((prev) => ({
                ...prev,
                drink: drinkOptions.includes(prev.drink) ? prev.drink : drinkOptions[0] ?? "",
                teppanPref: teppanOptions.includes(prev.teppanPref) ? prev.teppanPref : teppanOptions[0] ?? "",
            }));
        }
    };

    const handlePrevMonth = () => {
        if (isAtMinMonth) {
            setCalendarMessage("今月より前のご予約は表示できません。");
            return;
        }

        setCalendarMessage("");

        setCalendarMonth((prevMonth) => {
            if (prevMonth === 1) {
                setCalendarYear((prevYear) => prevYear - 1);
                return 12;
            }
            return prevMonth - 1;
        });
    };

    const handleNextMonth = () => {
        if (isAtMaxMonth) {
            setCalendarMessage("ご予約は2ヶ月先の月末まで可能です。");
            return;
        }

        setCalendarMessage("");

        setCalendarMonth((prevMonth) => {
            if (prevMonth === 12) {
                setCalendarYear((prevYear) => prevYear + 1);
                return 1;
            }
            return prevMonth + 1;
        });
    };

    const loadDayAvailability = async (
        visitType: VisitType,
        date: string,
        adult: number,
        child: number
    ) => {
        if (!date) {
            setDayAvailabilityError("先に来店日を選択してください。");
            return;
        }

        if (adult + child <= 0) {
            setDayAvailabilityError("先に人数を選択してください。");
            return;
        }

        setLunchDeadlinePassed(false);
        setDinnerDeadlinePassed(false);

        setCourseAvailability(null);
        setCourseAvailabilityError("");
        setCourseAvailabilityLoading(false);
        setError("");

        setFormData((prev) => ({
            ...prev,
            visitType,
            startTime: "",
            course: "",
            drink: "",
            teppanPref: "",
        }));

        setLunchAvailableTimes([]);
        setDinnerAvailableTimes([]);
        setDayAvailabilityLoading(true);
        setDayAvailabilityError("");

        try {
            const result = await fetchDayAvailabilityDetail(date, adult, child);

            setLunchAvailableTimes(result.lunchAvailableTimes ?? []);
            setDinnerAvailableTimes(result.dinnerAvailableTimes ?? []);
            setLunchDeadlinePassed(result.lunchDeadlinePassed ?? false);
            setDinnerDeadlinePassed(result.dinnerDeadlinePassed ?? false);
        } catch (error) {
            console.error("loadDayAvailability error:", error);
            setDayAvailabilityError("この日の空き時間取得に失敗しました。");
            setLunchAvailableTimes([]);
            setDinnerAvailableTimes([]);
            setLunchDeadlinePassed(false);
            setDinnerDeadlinePassed(false);
        } finally {
            setDayAvailabilityLoading(false);
        }
    };

    const handleGuestChange = (type: "adult" | "child", value: number) => {
        setLunchAvailableTimes([]);
        setDinnerAvailableTimes([]);
        setLunchDeadlinePassed(false);
        setDinnerDeadlinePassed(false);
        setDayAvailabilityError("");
        setDayAvailabilityLoading(false);

        setCourseAvailability(null);
        setCourseAvailabilityError("");
        setCourseAvailabilityLoading(false);
        setError("");

        setFormData((prev) => ({
            ...prev,
            [type]: value,
            visitType: "",
            startTime: "",
            course: "",
            drink: "",
            teppanPref: "",
        }));
    };

    const handleDateChange = (date: string) => {
        setLunchAvailableTimes([]);
        setDinnerAvailableTimes([]);
        setLunchDeadlinePassed(false);
        setDinnerDeadlinePassed(false);
        setDayAvailabilityError("");
        setDayAvailabilityLoading(false);

        setCourseAvailability(null);
        setCourseAvailabilityError("");
        setCourseAvailabilityLoading(false);
        setError("");

        setFormData((prev) => ({
            ...prev,
            visitDate: date,
            visitType: "",
            startTime: "",
            course: "",
            drink: "",
            teppanPref: "",
        }));
    };

    const handleStartTimeChange = (time: string) => {
        setCourseAvailability(null);
        setCourseAvailabilityError("");
        setCourseAvailabilityLoading(false);

        setLunchDeadlinePassed(false);
        setDinnerDeadlinePassed(false);

        setError("");

        setFormData((prev) => ({
            ...prev,
            startTime: time,
            course: "",
            drink: "",
            teppanPref: "",
        }));
    };

    const loadCourseAvailability = async () => {
        if (!formData.visitDate) {
            setCourseAvailabilityError("来店日が未選択です。");
            return false;
        }

        if (!formData.startTime) {
            setCourseAvailabilityError("開始時間が未選択です。");
            return false;
        }

        if (formData.adult + formData.child <= 0) {
            setCourseAvailabilityError("人数が未選択です。");
            return false;
        }

        setCourseAvailabilityLoading(true);
        setCourseAvailabilityError("");

        try {
            const result = await fetchCourseAvailabilityDetail(
                formData.visitDate,
                formData.adult,
                formData.child,
                formData.startTime
            );

            setCourseAvailability({
                seatOnlyAvailable: result.seatOnlyAvailable,
                course120Available: result.course120Available,
                course150Available: result.course150Available,
            });

            return true;
        } catch (error) {
            console.error("loadCourseAvailability error:", error);
            setCourseAvailabilityError("コースの選択可否取得に失敗しました。");
            setCourseAvailability(null);
            return false;
        } finally {
            setCourseAvailabilityLoading(false);
        }
    };

    const handleNext = () => {
        setError("");

        if (currentStep === 1) {
            if (!formData.visitDate) return setError("来店日を選択してください。");
            if (totalGuests <= 0) return setError("人数を選択してください。");
            if (!formData.visitType) return setError("ランチかディナーを選択してください。");
            if (!formData.startTime) return setError("時間帯を選択してください。");

            setIsPageTransitionLoading(true);

            loadCourseAvailability().then((ok) => {
                if (ok) {
                    setCurrentStep(2);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                } else {
                    setError("コースの選択可否取得に失敗しました。");
                }

                setIsPageTransitionLoading(false);
            });

            return;
        }

        if (currentStep === 2) {
            if (!formData.course) return setError("コースを選択してください。");
            normalizeBeforeNext();
            setCurrentStep(skipOptionStep ? 4 : 3);
            return;
        }

        if (currentStep === 3) {
            const drinkOptions = getDrinkOptions(formData.course);
            const teppanOptions = getTeppanOptions(formData.adult, formData.child);

            if (drinkOptions.length > 1 && !formData.drink) return setError("飲み放題を選択してください。");
            if (!(teppanOptions.length === 1 && teppanOptions[0] === "指定不可") && !formData.teppanPref) {
                return setError("鉄板希望を選択してください。");
            }
            setCurrentStep(4);
            return;
        }

        if (currentStep === 4) {
            if (!formData.name.trim()) return setError("氏名を入力してください。");
            if (!formData.kana.trim()) return setError("フリガナを入力してください。");
            if (!formData.phone.trim()) return setError("電話番号を入力してください。");
            setCurrentStep(5);
        }
    };

    const handleBack = () => {
        setError("");

        if (currentStep === 5) {
            setCurrentStep(4);
            return;
        }
        if (currentStep === 4) {
            setCurrentStep(skipOptionStep ? 2 : 3);
            return;
        }
        if (currentStep === 3) {
            setCurrentStep(2);
            return;
        }
        if (currentStep === 2) {
            setCurrentStep(1);
        }
    };

    return (
        <div
            className="mx-auto w-full rounded-[28px] p-[1.5px] shadow-[0_12px_30px_rgba(0,0,0,0.35)]"
            style={{
                background:
                    "linear-gradient(180deg, rgba(255,235,170,0.95) 0%, rgba(247,211,106,0.9) 40%, rgba(176,122,24,0.95) 100%)",
            }}
        >
            {isPageTransitionLoading && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 backdrop-blur-sm">
                    <div className="mx-6 w-full max-w-sm rounded-3xl border border-yellow-400/40 bg-[rgba(25,18,8,0.95)] px-6 py-7 text-center shadow-2xl">
                        <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-yellow-300/30 border-t-yellow-300" />
                        <p className="text-base font-black text-yellow-300">
                            選択可能なコースを確認しています
                        </p>
                        <p className="mt-2 text-sm text-white/70">
                            少々お待ちください...
                        </p>
                    </div>
                </div>
            )}

            <div className="rounded-[27px] bg-[rgba(0,0,0,0.58)] p-4 text-white backdrop-blur-[2px] md:p-8">
                <StepIndicator currentStep={currentStep} />

                {currentStep === 1 && (
                    <Step1DateGuestsTime
                        formData={formData}
                        setFormData={setFormData}
                        calendarYear={calendarYear}
                        calendarMonth={calendarMonth}
                        onPrevMonth={handlePrevMonth}
                        onNextMonth={handleNextMonth}
                        disablePrevMonth={isAtMinMonth}
                        disableNextMonth={isAtMaxMonth}
                        calendarMessage={calendarMessage}
                        calendarStatusMap={calendarStatusMap}
                        calendarStatusLoading={calendarStatusLoading}
                        calendarStatusError={calendarStatusError}
                        onGuestChange={handleGuestChange}
                        onDateChange={handleDateChange}
                        onStartTimeChange={handleStartTimeChange}
                        onSelectVisitType={(visitType) =>
                            loadDayAvailability(
                                visitType,
                                formData.visitDate,
                                formData.adult,
                                formData.child
                            )
                        }
                        dayAvailabilityLoading={dayAvailabilityLoading}
                        dayAvailabilityError={dayAvailabilityError}
                        lunchAvailableTimes={lunchAvailableTimes}
                        dinnerAvailableTimes={dinnerAvailableTimes}
                        lunchDeadlinePassed={lunchDeadlinePassed}
                        dinnerDeadlinePassed={dinnerDeadlinePassed}
                    />
                )}
                {currentStep === 2 && (
                    <Step2Course
                        formData={formData}
                        setFormData={setFormData}
                        courseAvailability={courseAvailability}
                        courseAvailabilityLoading={courseAvailabilityLoading}
                        courseAvailabilityError={courseAvailabilityError}
                    />
                )}
                {currentStep === 3 && <Step3Options formData={formData} setFormData={setFormData} />}
                {currentStep === 4 && <Step4CustomerInfo formData={formData} setFormData={setFormData} />}
                {currentStep === 5 && <Step5Confirm formData={formData} />}

                {error && <p className="mt-6 rounded-xl bg-red-950/70 px-4 py-3 text-sm font-bold text-red-200">{error}</p>}

                <div className="mt-8 flex items-center justify-between gap-3">
                    <button
                        type="button"
                        onClick={handleBack}
                        disabled={currentStep === 1}
                        className="rounded-2xl border border-white/20 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        戻る
                    </button>
                    {currentStep !== 5 && (
                        <button
                            type="button"
                            onClick={handleNext}
                            className="rounded-2xl bg-yellow-400 px-6 py-3 text-sm font-black text-black"
                        >
                            次へ
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}