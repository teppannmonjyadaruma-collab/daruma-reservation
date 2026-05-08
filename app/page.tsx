import Image from "next/image";
import ReservationForm from "@/components/reservation/ReservationForm";

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-x-hidden text-white">
      <div
        className="fixed inset-0 -z-10 bg-center bg-cover bg-no-repeat"
        style={{
          backgroundImage: "url('/reserve-bg.jpeg')",
          transform: "translateZ(0)",
          WebkitTransform: "translateZ(0)",
          willChange: "transform",
        }}
      />
      <div className="fixed inset-0 -z-10 bg-black/18" />

      <section className="relative mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-10">
        <div className="mb-5 flex justify-center">
          <Image
            src="/logo.png"
            alt="鉄板もんじゃ だるま"
            width={420}
            height={160}
            className="h-auto w-[180px] md:w-[240px]"
            priority
          />
        </div>

        <div className="mb-6 text-center">
          <h1
            className="text-[2rem] font-black leading-none md:text-[3rem]"
            style={{
              color: "#f7d36a",
              textShadow: "0 2px 6px rgba(0,0,0,0.85)",
            }}
          >
            〜ご予約〜
          </h1>
        </div>

        <ReservationForm />
      </section>
    </main>
  );
}