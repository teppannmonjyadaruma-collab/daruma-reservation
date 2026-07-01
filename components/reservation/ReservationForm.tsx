"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import liff from "@line/liff";
import { fetchCalendarStatus, type CalendarStatusMap } from "@/lib/calendar-cache";
import { fetchDayAvailabilityDetail } from "@/lib/day-availability";
import { fetchCourseAvailabilityDetail } from "@/lib/course-availability";

type Course = "" | "席のみ" | "だるま満喫" | "鉄板満喫" | "特選だるま";
type Drink = "" | "なし" | "90" | "120";
type TeppanPref =
    | ""
    | "座敷"
    | "鉄板有(カ)"
    | "鉄板無(カ)"
    | "指定不可";
type Step = 1 | 2 | 3 | 4 | 5;
type VisitType = "" | "lunch" | "dinner";

type TimeSlotStatus = "available" | "full" | "closed";

type TimeSlotButton = {
    time: string;
    status: TimeSlotStatus;
    label: "空きあり" | "満席" | "受付終了";
    available: boolean;
};

type ReservationFormData = {
    visitDate: string;
    visitType: VisitType;
    startTime: string;
    adult: number;
    child: number;
    course: Course;
    drink: Drink;
    teppanPref: TeppanPref;
    lastName: string;
    firstName: string;
    lastNameKana: string;
    firstNameKana: string;
    phone: string;
    note: string;
};

type CourseAvailability = {
    seatOnlyAvailable: boolean;
    course120Available: boolean;
    course150Available: boolean;

    seatOnlyTeppanAvailable: boolean;
    course120TeppanAvailable: boolean;
    course150TeppanAvailable: boolean;

    seatOnlyZashikiAvailable: boolean;
    seatOnlyIronCounterAvailable: boolean;
    seatOnlyNoIronCounterAvailable: boolean;

    course120ZashikiAvailable: boolean;
    course120IronCounterAvailable: boolean;
    course120NoIronCounterAvailable: boolean;

    course150ZashikiAvailable: boolean;
    course150IronCounterAvailable: boolean;
    course150NoIronCounterAvailable: boolean;
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

const IS_RESERVATION_MAINTENANCE = false;

const MAINTENANCE_BYPASS_PASSWORD = "1791";



const initialFormData: ReservationFormData = {
    visitDate: "",
    visitType: "",
    startTime: "",
    adult: 0,
    child: 0,
    course: "",
    drink: "",
    teppanPref: "",
    lastName: "",
    firstName: "",
    lastNameKana: "",
    firstNameKana: "",
    phone: "",
    note: "",
};

const weekLabels = ["日", "月", "火", "水", "木", "金", "土"];

const STORE_PHONE_NUMBER = "0297340853";
const STORE_PHONE_LABEL = "0297-34-0853";

const SEAT_TYPE_PREFS = {
    ZASHIKI: "座敷",
    IRON_COUNTER: "鉄板有(カ)",
    NO_IRON_COUNTER: "鉄板無(カ)",
} as const;

const USE_TEMP_NO_NO_IRON_COUNTER_RULE = true;

const LUNCH_SUSPEND_START_DATE = "2026-07-18";

function isLunchSuspendedDate(dateString: string): boolean {
    if (!dateString) return false;

    return dateString >= LUNCH_SUSPEND_START_DATE;
}

function generateTimeRange(start: string, end: string, stepMinutes = 15): string[] {
    const toMinutes = (time: string) => {
        const [hour, minute] = time.split(":").map(Number);
        return hour * 60 + minute;
    };

    const toTime = (minutes: number) => {
        const hour = Math.floor(minutes / 60);
        const minute = minutes % 60;
        return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    };

    const result: string[] = [];
    let current = toMinutes(start);
    const endMinutes = toMinutes(end);

    while (current <= endMinutes) {
        result.push(toTime(current));
        current += stepMinutes;
    }

    return result;
}

function getCandidateTimesForVisitType(
    visitType: VisitType,
    businessType: string
): string[] {
    if (visitType === "lunch") {
        return generateTimeRange("11:00", "13:00", 15);
    }

    if (visitType === "dinner") {
        if (businessType === "23close") {
            return generateTimeRange("17:00", "21:00", 15);
        }

        return generateTimeRange("17:00", "20:00", 15);
    }

    return [];
}

function isPastTimeToday(dateString: string, time: string): boolean {
    if (!dateString || !time) return false;

    const targetDate = new Date(dateString);
    if (Number.isNaN(targetDate.getTime())) return false;

    const now = new Date();

    const targetDateOnly = new Date(
        targetDate.getFullYear(),
        targetDate.getMonth(),
        targetDate.getDate()
    );

    const todayOnly = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate()
    );

    if (targetDateOnly.getTime() !== todayOnly.getTime()) {
        return false;
    }

    const [hour, minute] = time.split(":").map(Number);
    const targetMinutes = hour * 60 + minute;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    return targetMinutes < nowMinutes;
}

function buildTimeSlotButtons(params: {
    visitDate: string;
    visitType: VisitType;
    businessType: string;
    availableTimes: string[];
    lunchDeadlinePassed: boolean;
    dinnerDeadlinePassed: boolean;
}): TimeSlotButton[] {
    const {
        visitDate,
        visitType,
        businessType,
        availableTimes,
        lunchDeadlinePassed,
        dinnerDeadlinePassed,
    } = params;

    const candidateTimes = getCandidateTimesForVisitType(visitType, businessType);
    const availableSet = new Set(availableTimes);

    const isDeadlinePassed =
        visitType === "lunch"
            ? lunchDeadlinePassed
            : visitType === "dinner"
                ? dinnerDeadlinePassed
                : false;

    return candidateTimes
        .filter((time) => !isPastTimeToday(visitDate, time))
        .map((time) => {
            if (isDeadlinePassed) {
                return {
                    time,
                    status: "closed",
                    label: "受付終了",
                    available: false,
                };
            }

            if (availableSet.has(time)) {
                return {
                    time,
                    status: "available",
                    label: "空きあり",
                    available: true,
                };
            }

            return {
                time,
                status: "full",
                label: "満席",
                available: false,
            };
        });
}

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

function getCourseState(params: {
    formData: ReservationFormData;
    courseAvailability: CourseAvailability | null;
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
                reason: "ディナー時間帯のみ選択可能です",
            },
            "鉄板満喫": {
                disabled: true,
                reason: "ディナー時間帯のみ選択可能です",
            },
            "特選だるま": {
                disabled: true,
                reason: "ディナー時間帯のみ選択可能です",
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

function CourseDescriptionText() {
    return (
        <div className="text-sm font-bold leading-7 text-white/85">
            <p className="mb-2 text-base font-black leading-7 text-[#ff0000]">
                大人数の宴会もお任せください！
            </p>

            <p>
                ゆったり座れる掘りごたつ席は
                <br />
                最大24名様まで対応可能。
                <br />
                カウンター席を含めると、最大34名様までの
                <br />
                宴会にも対応できます。
                <br />
                歓送迎会・打ち上げ・ご家族でのお集まりなど、
                <br />
                各種宴会にぜひご利用ください。
            </p>
        </div>
    );
}

function SeatOnlyImageCarousel({
    images,
    title,
}: {
    images: string[];
    title: string;
}) {
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [hasAutoSlid, setHasAutoSlid] = useState(false);

    useEffect(() => {
        if (hasAutoSlid) return;
        if (images.length < 2) return;

        const timer = window.setTimeout(() => {
            const el = scrollRef.current;
            if (!el) return;

            el.scrollTo({
                left: el.clientWidth,
                behavior: "smooth",
            });

            setActiveIndex(1);
            setHasAutoSlid(true);
        }, 2000);

        return () => window.clearTimeout(timer);
    }, [hasAutoSlid, images.length]);

    const handleScroll = () => {
        const el = scrollRef.current;
        if (!el) return;

        const nextIndex = Math.round(el.scrollLeft / el.clientWidth);
        setActiveIndex(nextIndex);
        setHasAutoSlid(true);
    };

    return (
        <div className="space-y-2">
            <div
                ref={scrollRef}
                onScroll={handleScroll}
                className="aspect-square overflow-x-scroll overflow-y-hidden rounded-2xl border border-white/10 bg-black/20 snap-x snap-mandatory scroll-smooth overscroll-x-contain overscroll-y-none [touch-action:pan-x]"
                style={{
                    WebkitOverflowScrolling: "touch",
                }}
            >
                <div className="flex h-full">
                    {images.map((src, index) => (
                        <div
                            key={`${title}-carousel-${index}`}
                            className="h-full w-full shrink-0 snap-center"
                        >
                            <img
                                src={src}
                                alt={`${title} ${index + 1}`}
                                draggable={false}
                                className="h-full w-full select-none object-cover"
                            />
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex items-center justify-center gap-2">
                {images.map((_, index) => (
                    <button
                        key={`${title}-dot-${index}`}
                        type="button"
                        onClick={() => {
                            const el = scrollRef.current;
                            if (!el) return;

                            el.scrollTo({
                                left: el.clientWidth * index,
                                behavior: "smooth",
                            });

                            setActiveIndex(index);
                            setHasAutoSlid(true);
                        }}
                        className={`h-2 rounded-full transition-all ${activeIndex === index
                            ? "w-5 bg-yellow-300"
                            : "w-2 bg-white/35"
                            }`}
                        aria-label={`${index + 1}枚目の画像を表示`}
                    />
                ))}
            </div>
        </div>
    );
}

function SeatOnlyNoticeText() {
    return (
        <div className="space-y-4">
            <p className="text-sm font-bold leading-8 text-white/85">
                コースを指定せずにお席のみのご予約になります。
            </p>

            <div className="rounded-[22px] border border-red-500/40 bg-red-950/35 px-4 py-4 text-center shadow-[0_0_18px_rgba(220,38,38,0.16)]">
                <p className="mb-2 text-sm font-black tracking-[0.08em] text-red-300">
                    大切なお知らせ
                </p>

                <p className="text-lg font-black leading-8 text-yellow-200">
                    ランチ帯は
                    <br />
                    <span className="text-2xl text-white">
                        ランチ限定メニューのみ
                    </span>
                    <br />
                    の提供となっております
                </p>
            </div>

            <div className="rounded-[22px] border border-yellow-400/30 bg-black/25 px-4 py-4">
                <p className="mb-3 text-center text-sm font-black text-yellow-200">
                    割引キャンペーンについて
                </p>

                <p className="text-center text-sm font-bold leading-7 text-white/85">
                    割引キャンペーンは
                    <br />
                    <span className="text-base font-black text-white">
                        土日祝以外の21時までのオーダー
                    </span>
                    <br />
                    に限ります。
                </p>

                <p className="mt-3 text-center text-lg font-black leading-7 text-yellow-300">
                    土日祝は適応外となります
                </p>

                <p className="mt-3 rounded-xl bg-white/10 px-3 py-2 text-center text-xs font-black leading-5 text-red-200">
                    ※ご注文前に必ずご確認ください
                </p>
            </div>
        </div>
    );
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

    const reservationOpenDate = new Date(2026, 5, 13); // 2026/06/13

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
        const isBeforeReservationOpen = dateObj < reservationOpenDate;

        const rawStatus = calendarStatusMap[date] ?? "";
        const status = isPast || isBeforeReservationOpen ? "-" : rawStatus;

        const disabled =
            isPast ||
            isBeforeReservationOpen ||
            status === "×" ||
            status === "休";

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

function ReservationMaintenanceView({
    maintenancePassword,
    setMaintenancePassword,
    setIsMaintenanceBypassed,
    maintenancePasswordError,
    setMaintenancePasswordError,
}: {
    maintenancePassword: string;
    setMaintenancePassword: React.Dispatch<React.SetStateAction<string>>;
    setIsMaintenanceBypassed: React.Dispatch<React.SetStateAction<boolean>>;
    maintenancePasswordError: string;
    setMaintenancePasswordError: React.Dispatch<React.SetStateAction<string>>;
}) {
    return (
        <div
            className="mx-auto w-full rounded-[28px] p-[1.5px] shadow-[0_12px_30px_rgba(0,0,0,0.35)]"
            style={{
                background:
                    "linear-gradient(180deg, rgba(255,235,170,0.95) 0%, rgba(247,211,106,0.9) 40%, rgba(176,122,24,0.95) 100%)",
            }}
        >
            <div className="rounded-[27px] bg-[rgba(0,0,0,0.72)] px-5 py-10 text-center text-white backdrop-blur-[2px] md:px-8 md:py-14">
                <p className="mb-3 text-sm font-black tracking-[0.18em] text-yellow-300">
                    RESERVATION MAINTENANCE
                </p>

                <h2 className="mb-5 text-2xl font-black leading-10 text-yellow-100 md:text-3xl">
                    ただいま予約機能を
                    <br />
                    メンテナンス中です
                </h2>

                <p className="mx-auto mb-6 max-w-md text-sm font-bold leading-8 text-white/85 md:text-base">
                    現在、予約機能の調整を行っております。
                    <br />
                    恐れ入りますが、ご予約をご希望のお客様は
                    <br />
                    お電話にてお問い合わせください。
                </p>

                <a
                    href={`tel:${STORE_PHONE_NUMBER}`}
                    className="mx-auto block w-full max-w-sm rounded-2xl bg-gradient-to-r from-yellow-300 via-yellow-400 to-yellow-500 px-6 py-4 text-base font-black text-black shadow-[0_8px_18px_rgba(234,179,8,0.22)] transition hover:brightness-105"
                >
                    {STORE_PHONE_LABEL} に電話する
                </a>

                <p className="mt-5 text-xs font-bold leading-6 text-white/55">
                    ご不便をおかけいたしますが、
                    <br />
                    ご理解のほどよろしくお願いいたします。
                </p>

                <div className="mt-6 w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="mb-3 text-center text-xs font-bold leading-6 text-white/60">
                        テスト確認用パスワードをお持ちの方はこちら
                    </p>

                    <input
                        type="password"
                        value={maintenancePassword}
                        onChange={(e) => {
                            setMaintenancePassword(e.target.value);
                            setMaintenancePasswordError("");
                        }}
                        placeholder="パスワードを入力"
                        className="w-full rounded-xl border border-white/20 bg-black/40 px-4 py-3 text-center text-sm font-bold text-white outline-none placeholder:text-white/30 focus:border-yellow-400"
                    />

                    {maintenancePasswordError && (
                        <p className="mt-2 text-center text-xs font-bold text-red-400">
                            {maintenancePasswordError}
                        </p>
                    )}

                    <button
                        type="button"
                        onClick={() => {
                            if (maintenancePassword === MAINTENANCE_BYPASS_PASSWORD) {
                                setIsMaintenanceBypassed(true);
                                setMaintenancePasswordError("");

                                if (typeof window !== "undefined") {
                                    window.sessionStorage.setItem("maintenanceBypassed", "true");
                                }

                                return;
                            }

                            setMaintenancePasswordError("パスワードが違います。");
                        }}
                        className="mt-3 w-full rounded-xl bg-yellow-400 px-4 py-3 text-sm font-black text-black transition hover:bg-yellow-300"
                    >
                        テスト用に予約画面へ進む
                    </button>
                </div>
            </div>
        </div>
    );
}

function FloatingReservationSummary({
    formData,
    currentStep,
}: {
    formData: ReservationFormData;
    currentStep: Step;
}) {
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    if (!isMounted) return null;
    if (currentStep === 1 || currentStep === 5) return null;

    const visitTypeLabel =
        formData.visitType === "lunch"
            ? "ランチ"
            : formData.visitType === "dinner"
                ? "ディナー"
                : "";

    const mainLine = [
        formData.visitDate,
        `大人${formData.adult}名 子供${formData.child}名`,
        visitTypeLabel,
        formData.startTime ? `${formData.startTime}〜` : "",
    ]
        .filter(Boolean)
        .join(" / ");

    const courseLabel =
        formData.course === "席のみ"
            ? "お席のみのご予約"
            : formData.course === "だるま満喫"
                ? "だるま満喫コース"
                : formData.course === "鉄板満喫"
                    ? "鉄板満喫コース"
                    : formData.course === "特選だるま"
                        ? "特選だるまコース"
                        : "";

    const optionTexts: string[] = [];

    if (currentStep === 4 && formData.course !== "席のみ" && formData.drink) {
        optionTexts.push(
            `飲み放題：${formData.drink === "なし" ? "なし" : `${formData.drink}分`}`
        );
    }

    if (currentStep === 4 && formData.teppanPref) {
        const seatTypeLabel = getSeatTypeDisplayLabel(formData.teppanPref);

        if (seatTypeLabel) {
            optionTexts.push(`席タイプのご希望：${seatTypeLabel}`);
        }
    }

    return createPortal(
        <div className="fixed left-1/2 top-[10px] z-[9000] w-[calc(100%-24px)] max-w-3xl -translate-x-1/2 pointer-events-none">
            <div className="rounded-[22px] border border-yellow-400/20 bg-[rgba(20,14,8,0.35)] px-4 py-3 text-center text-white shadow-[0_10px_30px_rgba(0,0,0,0.28)] backdrop-blur-xl md:px-5">
                {(currentStep === 2 || currentStep === 3 || currentStep === 4) && (
                    <p className="mb-1 text-xs font-black tracking-[0.08em] text-yellow-200">
                        ご予約内容
                    </p>
                )}

                <p className="text-sm font-bold leading-5 text-white md:text-base">
                    {mainLine}
                </p>

                {(currentStep === 3 || currentStep === 4) && courseLabel && (
                    <p className="mt-1 text-sm font-bold leading-5 text-white md:text-base">
                        {courseLabel}
                    </p>
                )}

                {currentStep === 4 && optionTexts.length > 0 && (
                    <p className="mt-1 text-sm font-bold leading-5 text-white/85">
                        {optionTexts.join(" / ")}
                    </p>
                )}
            </div>
        </div>,
        document.body
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
    dayBusinessType,
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
    dayBusinessType: string;
}) {
    const availableTimes =
        formData.visitType === "lunch"
            ? lunchAvailableTimes
            : formData.visitType === "dinner"
                ? dinnerAvailableTimes
                : [];

    const displayTimeSlots = buildTimeSlotButtons({
        visitDate: formData.visitDate,
        visitType: formData.visitType,
        businessType: dayBusinessType,
        availableTimes,
        lunchDeadlinePassed,
        dinnerDeadlinePassed,
    });

    const hasAvailableTime = displayTimeSlots.some((slot) => slot.available);

    const totalGuests = formData.adult + formData.child;

    const isDinnerSingleGuestBlocked =
        USE_TEMP_NO_NO_IRON_COUNTER_RULE &&
        formData.visitType === "dinner" &&
        totalGuests === 1;

    const isLunchSuspended = isLunchSuspendedDate(formData.visitDate);

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
                <h2 className="mb-3 text-lg font-black text-yellow-300 md:text-xl">
                    STEP3 ランチ / ディナーを選ぶ
                </h2>

                <div className={`grid gap-3 ${isLunchSuspended ? "grid-cols-1" : "grid-cols-2"}`}>
                    {!isLunchSuspended && (
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
                    )}

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

            {!isLunchSuspended && (
                <p className="-mt-4 text-center text-sm font-black leading-6 text-red-300">
                    ※ランチの時間帯のフードの提供は
                    <br />
                    ランチ限定メニューになります。
                </p>
            )}

            <section>
                <h2 className="mb-3 text-lg font-black text-yellow-300 md:text-xl">STEP4 時間帯を選ぶ</h2>

                {dayAvailabilityLoading && (
                    <div className="mb-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                        <div className="flex items-center gap-3">
                            <div className="h-5 w-5 animate-spin rounded-full border-2 border-yellow-300/30 border-t-yellow-300" />
                            <div>
                                <p className="text-sm font-black text-white/85">
                                    選択日の空き時間を確認しています
                                </p>
                                <p className="text-xs font-bold text-white/50">
                                    少々お待ちください...
                                </p>
                            </div>
                        </div>

                        <div className="mt-4 flex gap-2 overflow-hidden">
                            <div className="h-11 w-24 animate-pulse rounded-full border border-white/10 bg-white/5" />
                            <div className="h-11 w-24 animate-pulse rounded-full border border-white/10 bg-white/5" />
                            <div className="h-11 w-24 animate-pulse rounded-full border border-white/10 bg-white/5" />
                        </div>
                    </div>
                )}

                {dayAvailabilityError && (
                    <p className="mb-3 text-sm font-bold text-red-300">
                        {dayAvailabilityError}
                    </p>
                )}

                {!dayAvailabilityLoading &&
                    !dayAvailabilityError &&
                    formData.visitType &&
                    (isDinnerSingleGuestBlocked || !hasAvailableTime) && (
                        <div className="mb-3 rounded-2xl border border-white/10 bg-black/25 px-4 py-5 text-sm font-bold leading-7 text-white/75">
                            {isDinnerSingleGuestBlocked
                                ? "大変申し訳ありませんが、ディナー時間帯の1名様でのご予約は承っておりません。2名様以上でご予約可能です。ランチ帯は1名様でもご予約いただけます。"
                                : formData.visitType === "lunch" && lunchDeadlinePassed
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
                ) : isDinnerSingleGuestBlocked ? null : dayAvailabilityLoading ? null : (
                    <div className="relative">
                        <div className="overflow-x-auto">
                            <div className="flex min-w-max gap-2 rounded-2xl bg-black/25 p-3">
                                {displayTimeSlots.map((slot) => (
                                    <button
                                        key={slot.time}
                                        type="button"
                                        disabled={!slot.available}
                                        onClick={() => {
                                            if (!slot.available) return;
                                            onStartTimeChange(slot.time);
                                        }}
                                        className={`shrink-0 rounded-2xl border px-5 py-3 text-center text-sm font-bold transition ${formData.startTime === slot.time
                                            ? "border-yellow-300 bg-yellow-400 text-black"
                                            : slot.available
                                                ? "border-white/20 bg-white/5 text-white hover:bg-white/10"
                                                : slot.status === "closed"
                                                    ? "cursor-not-allowed border-red-300/20 bg-red-950/25 text-red-200/60"
                                                    : "cursor-not-allowed border-white/10 bg-white/10 text-white/35"
                                            }`}
                                    >
                                        <span className="block text-[10px] font-black leading-4">
                                            {slot.label}
                                        </span>
                                        <span className="block text-sm font-black leading-5">
                                            {slot.time}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                        {displayTimeSlots.length > 0 && (
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
    setCurrentStep,
    courseAvailability,
    courseAvailabilityLoading,
    courseAvailabilityError,
}: {
    formData: ReservationFormData;
    setFormData: React.Dispatch<React.SetStateAction<ReservationFormData>>;
    setCurrentStep: React.Dispatch<React.SetStateAction<Step>>;
    courseAvailability: CourseAvailability | null;
    courseAvailabilityLoading: boolean;
    courseAvailabilityError: string;
}) {
    const [detailCourseKey, setDetailCourseKey] = useState<Exclude<Course, ""> | null>(null);

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
        cardImages?: string[];
        detailImages: string[];
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
                imageSrc: "/reservation/seat-only-1.jpg",
                cardImages: [
                    "/reservation/seat-only-1.jpg",
                    "/reservation/seat-only-4.png",
                    "/reservation/seat-only-5.png",
                ],
                detailImages: [
                    "/reservation/seat-only-1.jpg",
                    "/reservation/seat-only-2.jpg",
                    "/reservation/seat-only-3.jpg",
                    "/reservation/seat-only-4.png",
                    "/reservation/seat-only-5.png",
                ],
                price: "",
                seatTime: "昼：90分\n夜：120分",
                deadline: "昼：当日13:00\n夜：当日20:00",
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
                    { label: "ご予約締切", value: "昼：当日13:00\n夜：当日20:00" },
                ],
            },
            {
                key: "だるま満喫",
                title: "だるま満喫コース",
                badge: "おすすめ",
                imageSrc: "/reservation/daruma-course.png",
                detailImages: ["/reservation/daruma-course.png"],
                price: "2,980円（税込）／1名様",
                seatTime: "120分",
                deadline: "ご利用前日22:00",
                items: "9品",
                guests: "2名様〜",
                description: "",
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
                courseContent: `〜前菜3種 (人数分)〜
枝豆
白菜キムチ
ポテトサラダ（小鉢）
※小鉢または長皿で提供いたします。
※人数分の提供になります。

〜鉄板焼き2品 (シェア)〜
ズーチーモー
とんぺい焼
※通常単品1皿分を2名様でシェアしていただきます。

〜焼きそば (シェア)〜
豚焼きそば
※通常単品1皿分を2名様でシェアしていただきます。
[焼きそば味変更] コースの焼きそばは、基本ソース味でのご提供となります。塩味へ変更をご希望の場合は、この後の「ご要望・備考」欄に、「焼きそば塩味へ変更希望」の旨と変更希望の人数をあわせてご記入ください。

〜お好み焼き(シェア)〜
だるま焼
※通常単品1皿分を2名様でシェアしていただきます。

〜もんじゃ (シェア)〜
明太もちチーズもんじゃ
※通常単品1皿分を2名様でシェアしていただきます。

〜甘味 (人数分)〜
アイス（バニラ・抹茶・いちご・チョコ）
※人数分の提供になります。`,
            },
            {
                key: "鉄板満喫",
                title: "鉄板満喫コース",
                imageSrc: "/reservation/teppan-course.png",
                detailImages: ["/reservation/teppan-course.png"],
                price: "3,980円（税込）／1名様",
                seatTime: "150分",
                deadline: "ご利用前日22:00",
                items: "10品",
                guests: "2名様〜",
                description: "",
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
                courseContent: `〜前菜3種 (人数分)〜
枝豆
白菜キムチ
ポテトサラダ（小鉢）
※小鉢または長皿で提供いたします。
※人数分の提供になります。

〜鉄板焼き3品 (シェア)〜
ズーチーモー
[変更可料理]ガーリックシュリンプ
ホタテバター
※通常単品1皿分を2名様でシェアしていただきます。
[変更可まとめ]苦手な方は、イカバター・じゃがチーズ・一口餃子・ホルモン焼・鶏の柚子胡椒焼き・長芋ステーキの何れかに変更できます。変更をご希望の場合は、この後の「ご要望・備考」欄に、変更希望商品・変更希望人数をあわせてご記入ください。

〜焼きそば (シェア)〜
ミックス焼きそば
※通常単品1皿分を2名様でシェアしていただきます。
[焼きそば味変更] コースの焼きそばは、基本ソース味でのご提供となります。塩味へ変更をご希望の場合は、この後の「ご要望・備考」欄に、「焼きそば塩味へ変更希望」の旨と変更希望の人数をあわせてご記入ください。

〜お好み焼き (シェア)〜
特だるま焼
※通常単品1皿分を2名様でシェアしていただきます。

〜もんじゃ (シェア)〜
明太もちチーズもんじゃ
※通常単品1皿分を2名様でシェアしていただきます。

〜甘味 (人数分)〜
アイス（バニラ・抹茶・いちご・チョコ）
※人数分の提供になります。`,
            },
            {
                key: "特選だるま",
                title: "特選だるまコース",
                imageSrc: "/reservation/tokusen-course.png",
                detailImages: ["/reservation/tokusen-course.png"],
                price: "5,980円（税込）／1名様",
                seatTime: "150分",
                deadline: "ご利用前日22:00",
                items: "12品",
                guests: "2名様〜",
                description: "",
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
                courseContent: `〜前菜3種 (人数分)〜
枝豆
チャンジャ
ポテトサラダ（小鉢）
※小鉢または長皿で提供いたします。
※人数分の提供になります。

〜鉄板焼き4品 (シェア)〜
ズーチーモー
[変更可料理]牡蠣バター
ホタテバター
[変更可料理]ガーリックシュリンプ
※通常単品1皿分を2名様でシェアしていただきます。
[変更可まとめ]苦手な方は、イカバター・じゃがチーズ・一口餃子・ホルモン焼・鶏の柚子胡椒焼き・長芋ステーキの何れかに変更できます。変更をご希望の場合は、この後の「ご要望・備考」欄に、変更希望商品・変更希望人数をあわせてご記入ください。

〜肉料理 (シェア)〜
サーロインステーキ
※通常単品1皿分を2名様でシェアしていただきます。
※カットして提供いたします。

〜焼きそば (シェア)〜
[変更可料理]牡蠣焼きそば
※通常単品1皿分を2名様でシェアしていただきます。
[焼きそば変更可まとめ]苦手な方は、ミックス焼きそばに変更できます。変更をご希望の場合は、この後の「ご要望・備考」欄に、変更希望商品・変更希望人数をあわせてご記入ください。
[焼きそば味変更]コースの焼きそばは、基本ソース味でのご提供となります。塩味へ変更をご希望の場合は、この後の「ご要望・備考」欄に、「焼きそば塩味へ変更希望」の旨と変更希望の人数をあわせてご記入ください。

〜お好み焼き (シェア)〜
特だるま焼
※通常単品1皿分を2名様でシェアしていただきます。

〜もんじゃ (シェア)〜
明太もちチーズもんじゃ
※通常単品1皿分を2名様でシェアしていただきます。

〜甘味 (人数分)〜
アイス（バニラ・抹茶・いちご・チョコ）
※人数分の提供になります。`,
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

                                    {course.key === "席のみ" ? (
                                        <SeatOnlyImageCarousel
                                            images={course.cardImages ?? course.detailImages}
                                            title={course.title}
                                        />
                                    ) : (
                                        <div className="aspect-square overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                                            <img
                                                src={course.imageSrc}
                                                alt={course.title}
                                                className="h-full w-full object-cover"
                                            />
                                        </div>
                                    )}
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
                                            <div className="whitespace-pre-line text-sm font-black text-white">{course.seatTime}</div>
                                        </div>

                                        <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-center">
                                            <div className="mb-1 text-[11px] font-bold text-white/60">予約締切</div>
                                            <div className="whitespace-pre-line text-sm font-black text-white">
                                                {course.deadline}
                                            </div>
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

                                    <div className="mb-3">
                                        {course.key === "席のみ" ? (
                                            <p className="text-sm leading-7 text-white/85">
                                                コースを指定せずにお席のみのご予約になります。
                                            </p>
                                        ) : (
                                            <CourseDescriptionText />
                                        )}
                                    </div>

                                    {course.highlightNote && (
                                        <p className="mb-4 text-sm font-black leading-7 text-red-400">
                                            {course.highlightNote}
                                        </p>
                                    )}

                                    <div className="mt-auto flex flex-col gap-3 sm:flex-row">
                                        <button
                                            type="button"
                                            disabled={state.disabled}
                                            onClick={() => {
                                                if (state.disabled) return;

                                                setFormData((prev) => ({
                                                    ...prev,
                                                    course: course.key,
                                                    drink: course.key === "席のみ" ? "なし" : "",
                                                    teppanPref: "",
                                                }));

                                                setCurrentStep(3);
                                            }}
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
                                        <div className="mb-6 grid gap-4">
                                            {detailCourse.detailImages.map((src, index) => {
                                                const isSquareSeatOnlyImage =
                                                    detailCourse.key === "席のみ" && index >= 3;

                                                return (
                                                    <div
                                                        key={`${detailCourse.key}-detail-image-${index}`}
                                                        className="overflow-hidden rounded-[24px] border border-white/10 bg-black/20"
                                                    >
                                                        <div
                                                            className={`w-full overflow-hidden ${isSquareSeatOnlyImage
                                                                ? "aspect-square"
                                                                : "aspect-[4/3]"
                                                                }`}
                                                        >
                                                            <img
                                                                src={src}
                                                                alt={`${detailCourse.title} ${index + 1}`}
                                                                className={`h-full w-full ${isSquareSeatOnlyImage
                                                                    ? "object-contain"
                                                                    : "object-cover"
                                                                    }`}
                                                            />
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>

                                        <div className="mb-5">
                                            {detailCourse.key === "席のみ" ? (
                                                <SeatOnlyNoticeText />
                                            ) : (
                                                <CourseDescriptionText />
                                            )}
                                        </div>

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

                                                        const isNote = trimmed.startsWith("※");
                                                        const changeableDishMatch = trimmed.match(/^\[変更可料理\](.+)$/);
                                                        const changeSummaryMatch = trimmed.match(/^\[変更可まとめ\](.+)$/);
                                                        const yakisobaChangeSummaryMatch = trimmed.match(/^\[焼きそば変更可まとめ\](.+)$/);
                                                        const isChangeNote = trimmed.startsWith("[変更可]");
                                                        const isChangeRequestNote = trimmed.startsWith("[変更希望]");
                                                        const isYakisobaNote = trimmed.startsWith("[焼きそば注意]");
                                                        const yakisobaTasteMatch = trimmed.match(/^\[焼きそば味変更\]\s*(.+)$/);

                                                        if (!trimmed) {
                                                            return <div key={index} className="h-2" />;
                                                        }

                                                        if (changeableDishMatch) {
                                                            const dishName = changeableDishMatch[1].trim();

                                                            return (
                                                                <p key={index} className="text-sm leading-8 text-white/90">
                                                                    {dishName}
                                                                    <span className="ml-2 inline-flex align-middle rounded-full bg-yellow-400 px-2 py-0.5 text-[10px] font-black leading-none text-black">
                                                                        変更可
                                                                    </span>
                                                                </p>
                                                            );
                                                        }

                                                        if (changeSummaryMatch) {
                                                            const description = changeSummaryMatch[1].trim();
                                                            const splitKeyword = "変更をご希望の場合は";
                                                            const [mainText, requestText] = description.split(splitKeyword);

                                                            return (
                                                                <div
                                                                    key={index}
                                                                    className="mx-auto my-3 max-w-xl rounded-xl border border-yellow-400/15 bg-yellow-400/5 px-3 py-3 text-left"
                                                                >
                                                                    <div className="mb-2 flex items-center justify-center gap-2">
                                                                        <span className="inline-flex rounded-full bg-yellow-400 px-2.5 py-1 text-[10px] font-black leading-none text-black">
                                                                            変更可
                                                                        </span>

                                                                        <p className="text-[11px] font-black text-yellow-200">
                                                                            のお料理について
                                                                        </p>
                                                                    </div>

                                                                    <p className="text-[11px] font-bold leading-6 text-white/65">
                                                                        {mainText.trim()}
                                                                    </p>

                                                                    {requestText && (
                                                                        <p className="mt-2 text-[11px] font-bold leading-6 text-yellow-100/75">
                                                                            {splitKeyword}
                                                                            {requestText.trim()}
                                                                        </p>
                                                                    )}
                                                                </div>
                                                            );
                                                        }

                                                        if (yakisobaChangeSummaryMatch) {
                                                            const description = yakisobaChangeSummaryMatch[1].trim();
                                                            const splitKeyword = "変更をご希望の場合は";
                                                            const [mainText, requestText] = description.split(splitKeyword);

                                                            return (
                                                                <div
                                                                    key={index}
                                                                    className="mx-auto my-3 max-w-xl rounded-xl border border-yellow-400/15 bg-yellow-400/5 px-3 py-3 text-left"
                                                                >
                                                                    <div className="mb-2 flex items-center justify-center gap-2">
                                                                        <span className="inline-flex rounded-full bg-yellow-400 px-2.5 py-1 text-[10px] font-black leading-none text-black">
                                                                            変更可
                                                                        </span>

                                                                        <p className="text-[11px] font-black text-yellow-200">
                                                                            の焼きそばについて
                                                                        </p>
                                                                    </div>

                                                                    <p className="text-[11px] font-bold leading-6 text-white/65">
                                                                        {mainText.trim()}
                                                                    </p>

                                                                    {requestText && (
                                                                        <p className="mt-2 text-[11px] font-bold leading-6 text-yellow-100/75">
                                                                            {splitKeyword}
                                                                            {requestText.trim()}
                                                                        </p>
                                                                    )}
                                                                </div>
                                                            );
                                                        }


                                                        if (yakisobaTasteMatch) {
                                                            const description = yakisobaTasteMatch[1].trim();
                                                            const splitKeyword = "塩味へ変更をご希望の場合は";
                                                            const [mainText, requestText] = description.split(splitKeyword);

                                                            return (
                                                                <div
                                                                    key={index}
                                                                    className="mx-auto my-3 max-w-xl rounded-xl border border-yellow-400/15 bg-yellow-400/5 px-3 py-3 text-left"
                                                                >
                                                                    <p className="mb-2 text-center text-[11px] font-black text-yellow-200">
                                                                        焼きそばについて
                                                                    </p>

                                                                    <p className="text-[11px] font-bold leading-6 text-white/65">
                                                                        {mainText.trim()}
                                                                    </p>

                                                                    {requestText && (
                                                                        <p className="mt-2 text-[11px] font-bold leading-6 text-yellow-100/75">
                                                                            {splitKeyword}
                                                                            {requestText.trim()}
                                                                        </p>
                                                                    )}
                                                                </div>
                                                            );
                                                        }

                                                        if (isChangeNote || isChangeRequestNote || isYakisobaNote) {
                                                            const text = trimmed
                                                                .replace("[変更可]", "")
                                                                .replace("[変更希望]", "")
                                                                .replace("[焼きそば注意]", "")
                                                                .trim();

                                                            return (
                                                                <div
                                                                    key={index}
                                                                    className="mx-auto mt-2 max-w-xl rounded-2xl border border-yellow-400/20 bg-yellow-400/10 px-4 py-3 text-left"
                                                                >
                                                                    <p className="mb-1 text-xs font-black text-yellow-200">
                                                                        {isYakisobaNote ? "焼きそばについて" : isChangeNote ? "変更について" : "ご記入方法"}
                                                                    </p>
                                                                    <p className="text-xs font-bold leading-6 text-white/78">
                                                                        {text}
                                                                    </p>
                                                                </div>
                                                            );
                                                        }

                                                        return (
                                                            <p
                                                                key={index}
                                                                className={
                                                                    isHeading
                                                                        ? "pt-4 text-lg font-bold tracking-[0.04em] text-transparent bg-clip-text"
                                                                        : isNote
                                                                            ? "text-xs font-bold leading-4 text-white/60"
                                                                            : "text-sm leading-8 text-white/90"
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
                                                        drink: detailCourse.key === "席のみ" ? "なし" : "",
                                                        teppanPref: "",
                                                    }));

                                                    setDetailCourseKey(null);
                                                    setCurrentStep(3);
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

function getDrinkOptionDescription(course: Course, drink: Drink) {
    if (drink === "なし") {
        return "コース料金のみ";
    }

    if (course === "だるま満喫" && drink === "90") {
        return "お一人様 ＋1,500円（税込）";
    }

    if (
        (course === "鉄板満喫" || course === "特選だるま") &&
        drink === "120"
    ) {
        return "お一人様 ＋2,000円（税込）";
    }

    return "";
}

function getSeatTypeAvailability(
    course: Course,
    seatType: TeppanPref,
    availability: CourseAvailability | null
) {
    if (!availability) return false;
    if (!seatType || seatType === "指定不可") return false;

    if (course === "席のみ") {
        if (seatType === SEAT_TYPE_PREFS.ZASHIKI) {
            return availability.seatOnlyZashikiAvailable;
        }

        if (seatType === SEAT_TYPE_PREFS.IRON_COUNTER) {
            return availability.seatOnlyIronCounterAvailable;
        }

        if (seatType === SEAT_TYPE_PREFS.NO_IRON_COUNTER) {
            return availability.seatOnlyNoIronCounterAvailable;
        }
    }

    if (course === "だるま満喫") {
        if (seatType === SEAT_TYPE_PREFS.ZASHIKI) {
            return availability.course120ZashikiAvailable;
        }

        if (seatType === SEAT_TYPE_PREFS.IRON_COUNTER) {
            return availability.course120IronCounterAvailable;
        }

        if (seatType === SEAT_TYPE_PREFS.NO_IRON_COUNTER) {
            return availability.course120NoIronCounterAvailable;
        }
    }

    if (course === "鉄板満喫" || course === "特選だるま") {
        if (seatType === SEAT_TYPE_PREFS.ZASHIKI) {
            return availability.course150ZashikiAvailable;
        }

        if (seatType === SEAT_TYPE_PREFS.IRON_COUNTER) {
            return availability.course150IronCounterAvailable;
        }

        if (seatType === SEAT_TYPE_PREFS.NO_IRON_COUNTER) {
            return availability.course150NoIronCounterAvailable;
        }
    }

    return false;
}

function getSeatTypeOptions(adult: number, child: number, visitType: VisitType) {
    const total = adult + child;

    if (total <= 0) {
        return [];
    }

    if (USE_TEMP_NO_NO_IRON_COUNTER_RULE) {
        if (total === 1) {
            if (visitType === "lunch") {
                return [
                    {
                        value: SEAT_TYPE_PREFS.ZASHIKI as TeppanPref,
                        label: "座敷 (鉄板有り掘りごたつ)",
                        description: "掘りごたつ席でゆったりお過ごしいただけます。\nランチ帯は1名様でもお選びいただけます。",
                        selectableByGuestCount: true,
                    },
                    {
                        value: SEAT_TYPE_PREFS.IRON_COUNTER as TeppanPref,
                        label: "シェフ前カウンター (鉄板有り)",
                        description: "専用鉄板付きのシェフ前カウンター席です。\nランチ帯は1名様でもお選びいただけます。",
                        selectableByGuestCount: true,
                    },
                ];
            }

            return [
                {
                    value: SEAT_TYPE_PREFS.ZASHIKI as TeppanPref,
                    label: "座敷 (鉄板有り掘りごたつ)",
                    description: "ディナー時間帯の1名様予約は承っておりません。",
                    selectableByGuestCount: false,
                },
                {
                    value: SEAT_TYPE_PREFS.IRON_COUNTER as TeppanPref,
                    label: "シェフ前カウンター (鉄板有り)",
                    description: "ディナー時間帯の1名様予約は承っておりません。",
                    selectableByGuestCount: false,
                },
            ];
        }

        if (total >= 2 && total <= 4) {
            return [
                {
                    value: SEAT_TYPE_PREFS.ZASHIKI as TeppanPref,
                    label: "座敷 (鉄板有り掘りごたつ)",
                    description: "掘りごたつ席でゆったりお過ごしいただけます。",
                    selectableByGuestCount: true,
                },
                {
                    value: SEAT_TYPE_PREFS.IRON_COUNTER as TeppanPref,
                    label: "シェフ前カウンター (鉄板有り)",
                    description: "専用鉄板付きのシェフ前カウンター席です。",
                    selectableByGuestCount: true,
                },
            ];
        }

        return [
            {
                value: SEAT_TYPE_PREFS.ZASHIKI as TeppanPref,
                label: "座敷 (鉄板有り掘りごたつ)",
                description: "5名様以上は座敷席へのご案内となります。",
                selectableByGuestCount: true,
            },
            {
                value: SEAT_TYPE_PREFS.IRON_COUNTER as TeppanPref,
                label: "シェフ前カウンター (鉄板有り)",
                description: "5名様以上はカウンター席をお選びいただけません。",
                selectableByGuestCount: false,
            },
        ];
    }

    // ここから下は従来ルール
    if (total === 1) {
        return [
            {
                value: SEAT_TYPE_PREFS.ZASHIKI as TeppanPref,
                label: "座敷 (鉄板有り掘りごたつ)",
                description: "1名様はお選びいただけません。2名様以上でご案内可能です。",
                selectableByGuestCount: false,
            },
            {
                value: SEAT_TYPE_PREFS.IRON_COUNTER as TeppanPref,
                label: "シェフ前カウンター (鉄板有り)",
                description: "1名様はお選びいただけません。2名様以上でご案内可能です。",
                selectableByGuestCount: false,
            },
            {
                value: SEAT_TYPE_PREFS.NO_IRON_COUNTER as TeppanPref,
                label: "シェフ前カウンター (鉄板無し)",
                description: "専用鉄板無しのシェフ前カウンター席です。",
                note: "※もんじゃ等のご自身での鉄板調理メニューはご利用いただけません。",
                selectableByGuestCount: true,
            },
        ];
    }

    if (total >= 2 && total <= 4) {
        return [
            {
                value: SEAT_TYPE_PREFS.ZASHIKI as TeppanPref,
                label: "座敷 (鉄板有り掘りごたつ)",
                description: "掘りごたつ席でゆったりお過ごしいただけます。",
                selectableByGuestCount: true,
            },
            {
                value: SEAT_TYPE_PREFS.IRON_COUNTER as TeppanPref,
                label: "シェフ前カウンター (鉄板有り)",
                description: "専用鉄板付きのシェフ前カウンター席です。",
                selectableByGuestCount: true,
            },
            {
                value: SEAT_TYPE_PREFS.NO_IRON_COUNTER as TeppanPref,
                label: "シェフ前カウンター (鉄板無し)",
                description: "専用鉄板無しのシェフ前カウンター席です。",
                note: "※もんじゃ等のご自身での鉄板調理メニューはご利用いただけません。",
                selectableByGuestCount: true,
            },
        ];
    }

    return [
        {
            value: SEAT_TYPE_PREFS.ZASHIKI as TeppanPref,
            label: "座敷 (鉄板有り掘りごたつ)",
            description: "5名様以上は座敷席へのご案内となります。",
            selectableByGuestCount: true,
        },
        {
            value: SEAT_TYPE_PREFS.IRON_COUNTER as TeppanPref,
            label: "シェフ前カウンター (鉄板有り)",
            description: "5名様以上はカウンター席をお選びいただけません。",
            selectableByGuestCount: false,
        },
        {
            value: SEAT_TYPE_PREFS.NO_IRON_COUNTER as TeppanPref,
            label: "シェフ前カウンター (鉄板無し)",
            description: "5名様以上はカウンター席をお選びいただけません。",
            selectableByGuestCount: false,
        },
    ];
}

function Step3Options({
    formData,
    setFormData,
    courseAvailability,
}: {
    formData: ReservationFormData;
    setFormData: React.Dispatch<React.SetStateAction<ReservationFormData>>;
    courseAvailability: CourseAvailability | null;
}) {
    const drinkOptions = getDrinkOptions(formData.course);
    const isSeatOnly = formData.course === "席のみ";

    return (
        <div className="space-y-8">
            <h2 className="mb-3 text-lg font-black text-yellow-300 md:text-xl">STEP5 オプションを選ぶ</h2>

            {!isSeatOnly && (
                <section className="rounded-[28px] border border-yellow-500/40 bg-black/25 p-4 md:p-5">
                    <h3 className="mb-2 text-lg font-black text-white">飲み放題を選ぶ</h3>

                    <p className="mb-4 text-sm leading-7 text-white/70">
                        {formData.course === "だるま満喫"
                            ? "だるま満喫コースは、90分飲み放題を追加できます。"
                            : "このコースは、120分飲み放題を追加できます。"}
                    </p>

                    <div className="grid grid-cols-2 gap-3">
                        {drinkOptions.map((option) => {
                            const label =
                                option === "なし"
                                    ? "飲み放題なし"
                                    : option === "90"
                                        ? "90分飲み放題あり"
                                        : "120分飲み放題あり";

                            const description = getDrinkOptionDescription(formData.course, option);

                            return (
                                <button
                                    key={option}
                                    type="button"
                                    onClick={() => {
                                        setFormData((prev) => ({ ...prev, drink: option }));
                                    }}
                                    className={`rounded-2xl border px-4 py-4 text-center transition ${formData.drink === option
                                        ? "border-yellow-300 bg-yellow-400 text-black"
                                        : "border-white/20 bg-white/5 text-white hover:bg-white/10"
                                        }`}
                                >
                                    <span className="block text-sm font-black">
                                        {label}
                                    </span>

                                    {description && (
                                        <span
                                            className={`mt-1 block text-xs font-bold leading-5 ${formData.drink === option
                                                ? "text-black/70"
                                                : "text-white/65"
                                                }`}
                                        >
                                            {description}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </section>
            )}

            <section className="rounded-[28px] border border-yellow-500/40 bg-black/25 p-4 md:p-5">
                <h3 className="mb-2 text-lg font-black text-white">
                    席タイプのご希望
                </h3>

                <p className="mb-4 text-sm leading-7 text-white/70">
                    空き状況により、ご希望の席タイプをお選びいただけない場合があります。
                </p>

                <div className="grid gap-3">
                    {getSeatTypeOptions(formData.adult, formData.child, formData.visitType).map((option) => {
                        const availableBySeat = getSeatTypeAvailability(
                            formData.course,
                            option.value,
                            courseAvailability
                        );

                        const disabled = !option.selectableByGuestCount || !availableBySeat;

                        const statusLabel = !option.selectableByGuestCount
                            ? "この人数では選択できません"
                            : availableBySeat
                                ? "選択できます"
                                : "満席";

                        return (
                            <button
                                key={option.value}
                                type="button"
                                disabled={disabled}
                                onClick={() => {
                                    if (disabled) return;
                                    setFormData((prev) => ({
                                        ...prev,
                                        teppanPref: option.value,
                                    }));
                                }}
                                className={`rounded-2xl border px-4 py-4 text-left transition ${disabled
                                    ? "cursor-not-allowed border-white/10 bg-white/5 text-white/35"
                                    : formData.teppanPref === option.value
                                        ? "border-yellow-300 bg-yellow-400 text-black"
                                        : "border-white/20 bg-white/5 text-white hover:bg-white/10"
                                    }`}
                            >
                                <span className="block text-sm font-black">
                                    {option.label}
                                </span>

                                <span
                                    className={`mt-1 block whitespace-pre-line text-xs font-bold leading-5 ${disabled
                                        ? "text-white/30"
                                        : formData.teppanPref === option.value
                                            ? "text-black/70"
                                            : "text-white/65"
                                        }`}
                                >
                                    {option.description}
                                </span>

                                {"note" in option && option.note && (
                                    <span
                                        className={`mt-2 block rounded-xl px-2 py-1 text-[10px] font-black leading-5 ${disabled
                                            ? "bg-red-500/5 text-red-500/45"
                                            : formData.teppanPref === option.value
                                                ? "bg-red-600/15 text-red-700"
                                                : "bg-red-500/10 text-red-400"
                                            }`}
                                    >
                                        {option.note}
                                    </span>
                                )}

                                <span
                                    className={`mt-2 inline-block rounded-full px-3 py-1 text-[10px] font-black ${disabled
                                        ? "bg-white/10 text-white/35"
                                        : formData.teppanPref === option.value
                                            ? "bg-black/20 text-black"
                                            : availableBySeat
                                                ? "bg-yellow-400 text-black shadow-[0_0_14px_rgba(250,204,21,0.35)]"
                                                : "bg-white/10 text-white/70"
                                        }`}
                                >
                                    {statusLabel}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </section>
        </div>
    );
}

function FormSectionTitle({
    children,
    required = false,
}: {
    children: React.ReactNode;
    required?: boolean;
}) {
    return (
        <div className="mb-3">
            <p className="text-lg font-black tracking-[0.04em] text-yellow-100 md:text-xl">
                {children}
                {required && <span className="ml-1 text-red-400">*</span>}
            </p>
            <div className="mt-1 h-[3px] w-24 rounded-full bg-gradient-to-r from-yellow-200 via-yellow-400 to-yellow-700 shadow-[0_0_10px_rgba(250,204,21,0.25)]" />
        </div>
    );
}

function Step4CustomerInfo({
    formData,
    setFormData,
    customerInfoErrors,
    setCustomerInfoErrors,
}: {
    formData: ReservationFormData;
    setFormData: React.Dispatch<React.SetStateAction<ReservationFormData>>;
    customerInfoErrors: {
        lastName: boolean;
        firstName: boolean;
        lastNameKana: boolean;
        firstNameKana: boolean;
        phone: boolean;
    };
    setCustomerInfoErrors: React.Dispatch<
        React.SetStateAction<{
            lastName: boolean;
            firstName: boolean;
            lastNameKana: boolean;
            firstNameKana: boolean;
            phone: boolean;
        }>
    >;
}) {
    const update = (key: keyof ReservationFormData, value: string) => {
        setFormData((prev) => ({ ...prev, [key]: value }));

        if (
            key === "lastName" ||
            key === "firstName" ||
            key === "lastNameKana" ||
            key === "firstNameKana" ||
            key === "phone"
        ) {
            setCustomerInfoErrors((prev) => ({
                ...prev,
                [key]: false,
            }));
        }
    };

    return (
        <div className="space-y-6">
            <h2 className="mb-3 text-lg font-black text-yellow-300 md:text-xl">
                STEP6 お客様情報を入力
            </h2>

            <div className="rounded-[28px] border border-yellow-500/30 bg-black/25 p-4 md:p-6">
                <div className="mb-6">
                    <FormSectionTitle required={true}>代表者氏名</FormSectionTitle>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="mb-2 block text-sm font-bold text-white/80">
                                姓
                            </label>
                            <input
                                value={formData.lastName}
                                onChange={(e) => update("lastName", e.target.value)}
                                placeholder="鉄板"
                                className={`w-full rounded-xl border bg-white px-4 py-3 text-black placeholder:text-gray-400 ${customerInfoErrors.lastName
                                    ? "border-red-500 ring-2 ring-red-400/40"
                                    : "border-yellow-600"
                                    }`}
                            />
                        </div>

                        <div>
                            <label className="mb-2 block text-sm font-bold text-white/80">
                                名
                            </label>
                            <input
                                value={formData.firstName}
                                onChange={(e) => update("firstName", e.target.value)}
                                placeholder="達磨"
                                className={`w-full rounded-xl border bg-white px-4 py-3 text-black placeholder:text-gray-400 ${customerInfoErrors.firstName
                                    ? "border-red-500 ring-2 ring-red-400/40"
                                    : "border-yellow-600"
                                    }`}
                            />
                        </div>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3">
                        <div>
                            <label className="mb-2 block text-sm font-bold text-white/80">
                                姓（カタカナ）
                            </label>
                            <input
                                value={formData.lastNameKana}
                                onChange={(e) => update("lastNameKana", e.target.value)}
                                placeholder="テッパン"
                                className={`w-full rounded-xl border bg-white px-4 py-3 text-black placeholder:text-gray-400 ${customerInfoErrors.lastNameKana
                                    ? "border-red-500 ring-2 ring-red-400/40"
                                    : "border-yellow-600"
                                    }`}
                            />
                        </div>

                        <div>
                            <label className="mb-2 block text-sm font-bold text-white/80">
                                名（カタカナ）
                            </label>
                            <input
                                value={formData.firstNameKana}
                                onChange={(e) => update("firstNameKana", e.target.value)}
                                placeholder="ダルマ"
                                className={`w-full rounded-xl border bg-white px-4 py-3 text-black placeholder:text-gray-400 ${customerInfoErrors.firstNameKana
                                    ? "border-red-500 ring-2 ring-red-400/40"
                                    : "border-yellow-600"
                                    }`}
                            />
                        </div>
                    </div>
                </div>

                <div className="mb-6">
                    <FormSectionTitle required={true}>電話番号</FormSectionTitle>
                    <input
                        value={formData.phone}
                        onChange={(e) => update("phone", e.target.value)}
                        placeholder="08012345678"
                        inputMode="tel"
                        className={`w-full rounded-xl border bg-white px-4 py-3 text-black placeholder:text-gray-400 ${customerInfoErrors.phone
                            ? "border-red-500 ring-2 ring-red-400/40"
                            : "border-yellow-600"
                            }`}
                    />
                </div>

                <div>
                    <FormSectionTitle>ご要望・備考</FormSectionTitle>
                    <textarea
                        value={formData.note}
                        onChange={(e) => update("note", e.target.value)}
                        placeholder="例）マヨネーズが苦手なのでお好み焼きにかけないでほしいです。"
                        rows={5}
                        className="w-full rounded-xl border border-yellow-600 bg-white px-4 py-3 text-black placeholder:text-gray-400"
                    />
                    <p className="mt-2 text-xs font-bold text-white/60">
                        ※ご要望に添えぬ場合もございますのでご了承ください。
                    </p>
                </div>
            </div>

            <p className="text-sm font-black text-red-400">
                *のついている項目は必須項目です。
            </p>

        </div>
    );
}

function formatVisitDateJapanese(dateString: string) {
    if (!dateString) return "";

    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return dateString;

    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function getCourseLabel(course: Course) {
    switch (course) {
        case "席のみ":
            return "お席のみのご予約";
        case "だるま満喫":
            return "だるま満喫コース";
        case "鉄板満喫":
            return "鉄板満喫コース";
        case "特選だるま":
            return "特選だるまコース";
        default:
            return "";
    }
}

function getVisitTypeLabel(visitType: VisitType) {
    switch (visitType) {
        case "lunch":
            return "ランチ";
        case "dinner":
            return "ディナー";
        default:
            return "";
    }
}

function getDrinkLabel(drink: Drink) {
    switch (drink) {
        case "90":
            return "90分";
        case "120":
            return "120分";
        case "なし":
            return "なし";
        default:
            return "";
    }
}

function getTeppanPrefLabel(teppanPref: TeppanPref) {
    return getSeatTypeDisplayLabel(teppanPref);
}

function getSeatTypeDisplayLabel(teppanPref: TeppanPref) {
    switch (teppanPref) {
        case SEAT_TYPE_PREFS.ZASHIKI:
            return "座敷（鉄板有り掘りごたつ）";
        case SEAT_TYPE_PREFS.IRON_COUNTER:
            return "シェフ前カウンター（鉄板有り）";
        case SEAT_TYPE_PREFS.NO_IRON_COUNTER:
            return "シェフ前カウンター（鉄板無し）";
        default:
            return "";
    }
}

function ConfirmSectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <div className="mb-4">
            <p className="text-lg font-black tracking-[0.04em] text-yellow-100 md:text-xl">
                {children}
            </p>
            <div className="mt-1 h-[3px] w-28 rounded-full bg-gradient-to-r from-yellow-200 via-yellow-400 to-yellow-700 shadow-[0_0_10px_rgba(250,204,21,0.25)]" />
        </div>
    );
}

function ConfirmRow({
    label,
    value,
    multiline = false,
}: {
    label: React.ReactNode;
    value: React.ReactNode;
    multiline?: boolean;
}) {
    return (
        <div className="grid grid-cols-[120px_1fr] overflow-hidden border-b border-white/10 last:border-b-0">
            <div className="flex items-center border-r border-white/10 bg-black/18 px-4 py-4 text-sm font-bold leading-6 text-white/65">
                {label}
            </div>

            <div
                className={`flex items-center px-4 py-4 text-sm font-black text-white ${multiline ? "whitespace-pre-line leading-7" : ""
                    }`}
            >
                {value}
            </div>
        </div>
    );
}

function Step5Confirm({
    formData,
    onSubmit,
}: {
    formData: ReservationFormData;
    onSubmit: () => void;
}) {
    const courseLabel = getCourseLabel(formData.course);
    const visitTypeLabel = getVisitTypeLabel(formData.visitType);
    const drinkLabel = getDrinkLabel(formData.drink);
    const teppanPrefLabel = getTeppanPrefLabel(formData.teppanPref);

    const showTeppanPref = Boolean(teppanPrefLabel);

    return (
        <div className="space-y-6">
            <h2 className="mb-3 text-lg font-black text-yellow-300 md:text-xl">
                STEP7 内容確認
            </h2>

            <div className="rounded-[28px] border border-yellow-500/30 bg-black/25 p-4 md:p-6">
                <div className="mb-7">
                    <ConfirmSectionTitle>ご予約内容</ConfirmSectionTitle>
                    <div className="overflow-hidden rounded-[24px] border border-white/10 bg-black/10">
                        <ConfirmRow
                            label="ご来店日"
                            value={formatVisitDateJapanese(formData.visitDate)}
                        />
                        <ConfirmRow
                            label="ご来店人数"
                            value={`大人${formData.adult}名 / 子供${formData.child}名`}
                        />
                        <ConfirmRow
                            label="ご来店区分"
                            value={visitTypeLabel}
                        />
                        <ConfirmRow
                            label="ご来店時間"
                            value={formData.startTime}
                        />
                    </div>
                </div>

                <div className="mb-7">
                    <ConfirmSectionTitle>ご来店者情報</ConfirmSectionTitle>
                    <div className="overflow-hidden rounded-[24px] border border-white/10 bg-black/10">
                        <ConfirmRow
                            label="代表者名"
                            value={`${formData.lastName} ${formData.firstName}`}
                        />
                        <ConfirmRow
                            label={
                                <div className="leading-5">
                                    <div>代表者名</div>
                                    <div className="text-xs font-bold text-white/45">(カタカナ)</div>
                                </div>
                            }
                            value={`${formData.lastNameKana} ${formData.firstNameKana}`}
                        />
                        <ConfirmRow
                            label="電話番号"
                            value={formData.phone}
                        />
                    </div>
                </div>

                <div className="mb-7">
                    <ConfirmSectionTitle>コース・ご要望事項</ConfirmSectionTitle>
                    <div className="overflow-hidden rounded-[24px] border border-white/10 bg-black/10">
                        <ConfirmRow
                            label="コース"
                            value={courseLabel}
                        />

                        {formData.course !== "席のみ" && drinkLabel && (
                            <ConfirmRow
                                label="飲み放題"
                                value={drinkLabel}
                            />
                        )}

                        {showTeppanPref && (
                            <ConfirmRow
                                label="席タイプのご希望"
                                value={teppanPrefLabel}
                            />
                        )}

                        <ConfirmRow
                            label="ご要望"
                            value={formData.note.trim() ? formData.note : "なし"}
                            multiline={true}
                        />
                    </div>
                </div>

                <div className="rounded-[24px] border border-red-400/20 bg-red-950/20 px-4 py-4">
                    <p className="mb-2 text-sm font-black text-red-300">
                        ■キャンセルについて
                    </p>
                    <ul className="space-y-2 pl-5 text-sm font-bold leading-7 text-white/85 list-disc">
                        <li>ご予約のキャンセルはLINEトーク上で行えます。「キャンセル」と一言メッセージをお送りください。</li>
                        <li>当日のご予約キャンセルは料金の100%をいただきますのでご注意ください。</li>
                    </ul>
                </div>
            </div>

            <button
                type="button"
                onClick={onSubmit}
                className="w-full rounded-2xl bg-gradient-to-r from-red-700 via-red-600 to-red-700 px-6 py-4 text-lg font-black text-white shadow-[0_12px_24px_rgba(127,29,29,0.35)] transition hover:brightness-110"
            >
                ご予約を確定する
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

    const [calendarYear, setCalendarYear] = useState(() => new Date().getFullYear());
    const [calendarMonth, setCalendarMonth] = useState(() => new Date().getMonth() + 1);

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
    const [courseAvailability, setCourseAvailability] =
        useState<CourseAvailability | null>(null);

    const [lunchDeadlinePassed, setLunchDeadlinePassed] = useState(false);
    const [dinnerDeadlinePassed, setDinnerDeadlinePassed] = useState(false);

    const [dayBusinessType, setDayBusinessType] = useState("");

    const [isPageTransitionLoading, setIsPageTransitionLoading] = useState(false);

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitSuccess, setSubmitSuccess] = useState(false);
    const [submitErrorOpen, setSubmitErrorOpen] = useState(false);
    const [submitErrorMessage, setSubmitErrorMessage] = useState("");

    const [maintenancePassword, setMaintenancePassword] = useState("");
    const [isMaintenanceBypassed, setIsMaintenanceBypassed] = useState(false);
    const [maintenancePasswordError, setMaintenancePasswordError] = useState("");

    const [customerInfoErrors, setCustomerInfoErrors] = useState<{
        lastName: boolean;
        firstName: boolean;
        lastNameKana: boolean;
        firstNameKana: boolean;
        phone: boolean;
    }>({
        lastName: false,
        firstName: false,
        lastNameKana: false,
        firstNameKana: false,
        phone: false,
    });

    useEffect(() => {
        if (typeof window === "undefined") return;

        const bypassed = window.sessionStorage.getItem("maintenanceBypassed");

        if (bypassed === "true") {
            setIsMaintenanceBypassed(true);
        }
    }, []);

    useEffect(() => {
        if (IS_RESERVATION_MAINTENANCE && !isMaintenanceBypassed) return;

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
    }, [isMaintenanceBypassed]);

    useEffect(() => {
        if (IS_RESERVATION_MAINTENANCE && !isMaintenanceBypassed) return;

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
    }, [isMaintenanceBypassed]);

    useEffect(() => {
        if (IS_RESERVATION_MAINTENANCE && !isMaintenanceBypassed) return;

        window.scrollTo({ top: 0, behavior: "smooth" });
    }, [currentStep, isMaintenanceBypassed]);

    if (IS_RESERVATION_MAINTENANCE && !isMaintenanceBypassed) {
        return (
            <ReservationMaintenanceView
                maintenancePassword={maintenancePassword}
                setMaintenancePassword={setMaintenancePassword}
                setIsMaintenanceBypassed={setIsMaintenanceBypassed}
                maintenancePasswordError={maintenancePasswordError}
                setMaintenancePasswordError={setMaintenancePasswordError}
            />
        );
    }

    const totalGuests = formData.adult + formData.child;

    const normalizeBeforeNext = () => {
        if (formData.course) {
            const drinkOptions = getDrinkOptions(formData.course);

            setFormData((prev) => ({
                ...prev,
                drink: drinkOptions.includes(prev.drink) ? prev.drink : drinkOptions[0] ?? "",
                teppanPref: "",
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
            setDayBusinessType(result.businessType ?? "");
        } catch (error) {
            console.error("loadDayAvailability error:", error);
            setDayAvailabilityError("この日の空き時間取得に失敗しました。");
            setLunchAvailableTimes([]);
            setDinnerAvailableTimes([]);
            setLunchDeadlinePassed(false);
            setDinnerDeadlinePassed(false);
            setDayBusinessType("");
        } finally {
            setDayAvailabilityLoading(false);
        }
    };

    const handleGuestChange = (type: "adult" | "child", value: number) => {
        setLunchAvailableTimes([]);
        setDinnerAvailableTimes([]);
        setLunchDeadlinePassed(false);
        setDinnerDeadlinePassed(false);
        setDayBusinessType("");
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
        setDayBusinessType("");
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
                seatOnlyAvailable: Boolean(result.seatOnlyAvailable),
                course120Available: Boolean(result.course120Available),
                course150Available: Boolean(result.course150Available),

                seatOnlyTeppanAvailable: Boolean(result.seatOnlyTeppanAvailable),
                course120TeppanAvailable: Boolean(result.course120TeppanAvailable),
                course150TeppanAvailable: Boolean(result.course150TeppanAvailable),

                seatOnlyZashikiAvailable: Boolean(result.seatOnlyZashikiAvailable),
                seatOnlyIronCounterAvailable: Boolean(result.seatOnlyIronCounterAvailable),
                seatOnlyNoIronCounterAvailable: Boolean(result.seatOnlyNoIronCounterAvailable),

                course120ZashikiAvailable: Boolean(result.course120ZashikiAvailable),
                course120IronCounterAvailable: Boolean(result.course120IronCounterAvailable),
                course120NoIronCounterAvailable: Boolean(result.course120NoIronCounterAvailable),

                course150ZashikiAvailable: Boolean(result.course150ZashikiAvailable),
                course150IronCounterAvailable: Boolean(result.course150IronCounterAvailable),
                course150NoIronCounterAvailable: Boolean(result.course150NoIronCounterAvailable),
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

            if (
                isLunchSuspendedDate(formData.visitDate) &&
                formData.visitType === "lunch"
            ) {
                return setError("7月18日以降はランチ営業を休止しているため、ディナーのみご予約いただけます。");
            }
            if (
                USE_TEMP_NO_NO_IRON_COUNTER_RULE &&
                formData.visitType === "dinner" &&
                totalGuests === 1
            ) {
                return setError("ディナー時間帯の1名様でのご予約は承っておりません。");
            }

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
            setCurrentStep(3);
            return;
        }

        if (currentStep === 3) {
            const drinkOptions = getDrinkOptions(formData.course);

            const needsDrink =
                formData.course !== "席のみ" && drinkOptions.length > 1;

            if (needsDrink && !formData.drink) {
                return setError("飲み放題を選択してください。");
            }

            if (!formData.teppanPref) {
                return setError("席タイプのご希望を選択してください。");
            }

            setCurrentStep(4);
            return;
        }

        if (currentStep === 4) {
            const nextErrors = {
                lastName: !formData.lastName.trim(),
                firstName: !formData.firstName.trim(),
                lastNameKana: !formData.lastNameKana.trim(),
                firstNameKana: !formData.firstNameKana.trim(),
                phone: !formData.phone.trim(),
            };

            setCustomerInfoErrors(nextErrors);

            if (nextErrors.lastName) return setError("姓を入力してください。");
            if (nextErrors.firstName) return setError("名を入力してください。");
            if (nextErrors.lastNameKana) return setError("姓（カタカナ）を入力してください。");
            if (nextErrors.firstNameKana) return setError("名（カタカナ）を入力してください。");
            if (nextErrors.phone) return setError("電話番号を入力してください。");

            setCurrentStep(5);
            return;
        }
    };

    const handleSubmitReservation = async () => {
        setError("");
        setSubmitErrorMessage("");
        setSubmitErrorOpen(false);

        const payload = {
            visitDate: formData.visitDate,
            visitType: formData.visitType,
            startTime: formData.startTime,
            adult: formData.adult,
            child: formData.child,
            course: formData.course,
            drink: formData.drink,
            teppanPref: formData.teppanPref,
            name: `${formData.lastName} ${formData.firstName}`.trim(),
            kana: `${formData.lastNameKana} ${formData.firstNameKana}`.trim(),
            phone: formData.phone,
            note: formData.note,
            lineUserId,
            displayName,
        };

        try {
            setIsSubmitting(true);

            const response = await fetch("https://script.google.com/macros/s/AKfycbwEL5sSGosFYsP4X4AUatVjIiUb9ONhQNOKAa74rk5WW_hGRyWENwWvsVDy-KIFhkUfDw/exec", {
                method: "POST",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8",
                },
                body: JSON.stringify(payload),
            });

            const result = await response.json();

            if (!response.ok || !result.ok) {
                throw new Error(result?.error || "予約送信に失敗しました。");
            }

            setSubmitSuccess(true);
        } catch (error) {
            console.error("submit reservation error:", error);
            setSubmitErrorMessage(
                error instanceof Error
                    ? error.message
                    : "予約送信に失敗しました。お手数ですが店舗へお電話でお問い合わせください。"
            );
            setSubmitErrorOpen(true);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleBack = () => {
        setError("");

        if (currentStep === 5) {
            setCurrentStep(4);
            return;
        }
        if (currentStep === 4) {
            setCurrentStep(3);
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

            {isSubmitting && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 backdrop-blur-sm">
                    <div className="mx-6 w-full max-w-sm rounded-3xl border border-yellow-400/40 bg-[rgba(25,18,8,0.95)] px-6 py-7 text-center shadow-2xl">
                        <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-yellow-300/30 border-t-yellow-300" />
                        <p className="text-base font-black text-yellow-300">
                            ご予約内容を送信しています
                        </p>
                        <p className="mt-2 text-sm text-white/70">
                            画面を閉じずにお待ちください...
                        </p>
                    </div>
                </div>
            )}

            {submitSuccess && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="mx-6 w-full max-w-md rounded-3xl border border-yellow-400/30 bg-[rgba(25,18,8,0.96)] px-6 py-7 text-center shadow-2xl">
                        <p className="mb-3 text-2xl font-black text-yellow-300">
                            ご予約が完了しました
                        </p>
                        <p className="text-sm font-bold leading-7 text-white/85">
                            ご予約ありがとうございました。<br />
                            LINEトークに予約内容をお送りしました。
                        </p>

                        <button
                            type="button"
                            onClick={() => {
                                if (liff.isInClient()) {
                                    liff.closeWindow();
                                } else {
                                    setSubmitSuccess(false);
                                }
                            }}
                            className="mt-6 w-full rounded-2xl bg-gradient-to-r from-yellow-300 via-yellow-400 to-yellow-500 px-6 py-4 text-base font-black text-black shadow-[0_8px_18px_rgba(234,179,8,0.22)]"
                        >
                            閉じる
                        </button>
                    </div>
                </div>
            )}

            {submitErrorOpen && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="mx-6 w-full max-w-md rounded-3xl border border-red-400/30 bg-[rgba(35,12,12,0.96)] px-6 py-7 text-center shadow-2xl">
                        <p className="mb-3 text-2xl font-black text-red-300">
                            送信に失敗しました
                        </p>
                        <p className="whitespace-pre-line text-sm font-bold leading-7 text-white/85">
                            {submitErrorMessage || "お手数ですが店舗へお電話でお問い合わせください。"}
                        </p>

                        <a
                            href={`tel:${STORE_PHONE_NUMBER}`}
                            className="mt-6 block w-full rounded-2xl bg-gradient-to-r from-red-700 via-red-600 to-red-700 px-6 py-4 text-base font-black text-white shadow-[0_8px_18px_rgba(127,29,29,0.35)]"
                        >
                            {STORE_PHONE_LABEL} に電話する
                        </a>

                        <button
                            type="button"
                            onClick={() => setSubmitErrorOpen(false)}
                            className="mt-3 w-full rounded-2xl border border-white/20 bg-white/5 px-6 py-4 text-base font-black text-white"
                        >
                            閉じる
                        </button>
                    </div>
                </div>
            )}

            <div className="rounded-[27px] bg-[rgba(0,0,0,0.58)] p-4 text-white backdrop-blur-[2px] md:p-8">
                <StepIndicator currentStep={currentStep} />

                <FloatingReservationSummary
                    formData={formData}
                    currentStep={currentStep}
                />

                <div>
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
                            dayBusinessType={dayBusinessType}
                        />
                    )}

                    {currentStep === 2 && (
                        <Step2Course
                            formData={formData}
                            setFormData={setFormData}
                            setCurrentStep={setCurrentStep}
                            courseAvailability={courseAvailability}
                            courseAvailabilityLoading={courseAvailabilityLoading}
                            courseAvailabilityError={courseAvailabilityError}
                        />
                    )}

                    {currentStep === 3 && (
                        <Step3Options
                            formData={formData}
                            setFormData={setFormData}
                            courseAvailability={courseAvailability}
                        />
                    )}

                    {currentStep === 4 && (
                        <Step4CustomerInfo
                            formData={formData}
                            setFormData={setFormData}
                            customerInfoErrors={customerInfoErrors}
                            setCustomerInfoErrors={setCustomerInfoErrors}
                        />
                    )}

                    {currentStep === 5 && (
                        <Step5Confirm
                            formData={formData}
                            onSubmit={handleSubmitReservation}
                        />
                    )}
                </div>

                {error && <p className="mt-6 rounded-xl bg-red-950/70 px-4 py-3 text-sm font-bold text-red-200">{error}</p>}

                {!(currentStep === 1 && dayAvailabilityLoading) && (
                    <div className="mt-8 flex items-center justify-between gap-3">
                        <button
                            type="button"
                            onClick={handleBack}
                            disabled={currentStep === 1}
                            className="rounded-2xl border border-white/20 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            戻る
                        </button>
                        {currentStep !== 5 && currentStep !== 2 && (
                            <button
                                type="button"
                                onClick={handleNext}
                                className="rounded-2xl bg-yellow-400 px-6 py-3 text-sm font-black text-black"
                            >
                                次へ
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}