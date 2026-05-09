"use client";

import { useEffect, useMemo, useState } from "react";
import liff from "@line/liff";
import { fetchCalendarStatus, type CalendarStatusMap } from "@/lib/calendar-cache";
import { fetchDayAvailabilityDetail } from "@/lib/day-availability";

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

const mockLunchTimes = ["11:00", "11:15", "11:30", "12:00", "12:30", "13:00"];
const mockDinnerTimes = ["17:00", "17:15", "18:00", "18:30", "19:00", "19:30"];

function isLunchTime(startTime: string) {
    return !!startTime && startTime < "17:00";
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
    isLunch: boolean;
    available120: boolean;
    available150: boolean;
}): CourseState {
    const { isLunch, available120, available150 } = params;

    if (isLunch) {
        return {
            "席のみ": { disabled: false, reason: "" },
            "だるま満喫": { disabled: true, reason: "ディナーの時間帯のみ選択可能です" },
            "鉄板満喫": { disabled: true, reason: "ディナーの時間帯のみ選択可能です" },
            "特選だるま": { disabled: true, reason: "ディナーの時間帯のみ選択可能です" },
        };
    }

    return {
        "席のみ": { disabled: false, reason: "" },
        "だるま満喫": {
            disabled: !available120,
            reason: !available120
                ? "選択された時間帯ではこちらのコースはお席の都合上お選びいただけません。別のお時間帯をご選択ください"
                : "",
        },
        "鉄板満喫": {
            disabled: !available150,
            reason: !available150
                ? "選択された時間帯ではこちらのコースはお席の都合上お選びいただけません。別のお時間帯をご選択ください"
                : "",
        },
        "特選だるま": {
            disabled: !available150,
            reason: !available150
                ? "選択された時間帯ではこちらのコースはお席の都合上お選びいただけません。別のお時間帯をご選択ください"
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
    onSelectVisitDate,
    dayAvailabilityLoading,
    dayAvailabilityError,
    lunchAvailableTimes,
    dinnerAvailableTimes,
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
    onSelectVisitDate: (date: string) => void;
    dayAvailabilityLoading: boolean;
    dayAvailabilityError: string;
    lunchAvailableTimes: string[];
    dinnerAvailableTimes: string[];
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
                                    onClick={() => onSelectVisitDate(day.date)}
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
                            onChange={(e) =>
                                setFormData((prev) => ({
                                    ...prev,
                                    adult: Number(e.target.value),
                                    course: "",
                                    drink: "",
                                    teppanPref: "",
                                }))
                            }
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
                            onChange={(e) =>
                                setFormData((prev) => ({
                                    ...prev,
                                    child: Number(e.target.value),
                                    course: "",
                                    drink: "",
                                    teppanPref: "",
                                }))
                            }
                            className="w-full rounded-xl border border-yellow-600 bg-white px-4 py-3 text-black"
                        >
                            {Array.from({ length: 11 }, (_, i) => i).map((n) => (
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
                        onClick={() =>
                            setFormData((prev) => ({
                                ...prev,
                                visitType: "lunch",
                                startTime: "",
                                course: "",
                                drink: "",
                                teppanPref: "",
                            }))
                        }
                        className={`rounded-2xl border px-4 py-4 text-base font-black transition ${formData.visitType === "lunch"
                            ? "border-yellow-300 bg-yellow-400 text-black"
                            : "border-white/20 bg-white/5 text-white hover:bg-white/10"
                            }`}
                    >
                        ランチ
                    </button>

                    <button
                        type="button"
                        onClick={() =>
                            setFormData((prev) => ({
                                ...prev,
                                visitType: "dinner",
                                startTime: "",
                                course: "",
                                drink: "",
                                teppanPref: "",
                            }))
                        }
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

                {!formData.visitType ? (
                    <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-5 text-sm text-white/75">
                        先にランチかディナーを選択してください。
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <div className="flex min-w-max gap-2 rounded-2xl bg-black/25 p-3">
                            {displayTimes.map((time) => (
                                <button
                                    key={time}
                                    type="button"
                                    onClick={() =>
                                        setFormData((prev) => ({
                                            ...prev,
                                            startTime: time,
                                            course: "",
                                            drink: "",
                                            teppanPref: "",
                                        }))
                                    }
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
                )}

                <p className="mt-2 text-sm text-white/75">
                    {formData.visitType === "lunch" &&
                        "ランチは90分枠の席のみ予約が可能な時間帯を表示する想定です。"}
                    {formData.visitType === "dinner" &&
                        "ディナーは120分枠の席のみ予約が可能な時間帯を表示する想定です。"}
                    {!formData.visitType &&
                        "ランチまたはディナーを選ぶと、選択可能な時間帯が表示されます。"}
                </p>
            </section>
        </div>
    );
}

function Step2Course({
    formData,
    setFormData,
}: {
    formData: ReservationFormData;
    setFormData: React.Dispatch<React.SetStateAction<ReservationFormData>>;
}) {
    const isLunch = formData.visitType === "lunch";
    const courseState = getCourseState({
        isLunch,
        available120: true,
        available150: false,
    });

    const cards: Exclude<Course, "">[] = ["席のみ", "だるま満喫", "鉄板満喫", "特選だるま"];

    return (
        <div>
            <h2 className="mb-3 text-lg font-black text-yellow-300 md:text-xl">STEP4 コースを選ぶ</h2>
            <div className="grid gap-4 md:grid-cols-2">
                {cards.map((course) => {
                    const state = courseState[course];
                    return (
                        <div
                            key={course}
                            className={`rounded-2xl border p-4 ${state.disabled ? "border-white/10 bg-white/5 opacity-60" : "border-yellow-500 bg-black/25"}`}
                        >
                            <div className="mb-3 text-lg font-black text-white">{course}</div>
                            <div className="mb-4 text-sm text-white/75">{course === "席のみ" ? "お席のみのご予約です。" : "コース詳細ページへ遷移する導線を後で追加予定。"}</div>
                            {state.reason && <p className="mb-3 text-xs text-yellow-200">{state.reason}</p>}
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    disabled={state.disabled}
                                    onClick={() => setFormData((prev) => ({ ...prev, course, drink: "", teppanPref: "" }))}
                                    className={`rounded-xl px-4 py-2 text-sm font-bold ${state.disabled ? "bg-white/10 text-white/60" : formData.course === course ? "bg-yellow-400 text-black" : "bg-white text-black"
                                        }`}
                                >
                                    このコースを選ぶ
                                </button>
                                {course !== "席のみ" && (
                                    <button type="button" className="rounded-xl border border-white/20 px-4 py-2 text-sm font-bold text-white">
                                        詳細を見る
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
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

    const handleSelectVisitDate = async (date: string) => {
        setDayAvailabilityLoading(true);
        setDayAvailabilityError("");

        try {
            const result = await fetchDayAvailabilityDetail(date);

            setLunchAvailableTimes(result.lunchAvailableTimes ?? []);
            setDinnerAvailableTimes(result.dinnerAvailableTimes ?? []);

            setFormData((prev) => ({
                ...prev,
                visitDate: date,
                visitType: "",
                startTime: "",
                course: "",
                drink: "",
                teppanPref: "",
            }));
        } catch (error) {
            console.error(error);
            setDayAvailabilityError("この日の空き状況取得に失敗しました。");
            setLunchAvailableTimes([]);
            setDinnerAvailableTimes([]);
        } finally {
            setDayAvailabilityLoading(false);
        }
    };

    const handleNext = () => {
        setError("");

        if (currentStep === 1) {
            if (!formData.visitDate) return setError("来店日を選択してください。");
            if (totalGuests <= 0) return setError("人数を選択してください。");
            if (!formData.visitType) return setError("ランチかディナーを選択してください。");
            if (!formData.startTime) return setError("時間帯を選択してください。");
            setCurrentStep(2);
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
                        onSelectVisitDate={handleSelectVisitDate}
                        dayAvailabilityLoading={dayAvailabilityLoading}
                        dayAvailabilityError={dayAvailabilityError}
                        lunchAvailableTimes={lunchAvailableTimes}
                        dinnerAvailableTimes={dinnerAvailableTimes}
                    />
                )}
                {currentStep === 2 && <Step2Course formData={formData} setFormData={setFormData} />}
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