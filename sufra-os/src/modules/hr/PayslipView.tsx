/** Printable payslip (قسيمة المرتب), A4 or screen, Arabic or English. Tax/insurance lines carry the estimate label. */
import type { Payslip, Restaurant, StaffProfile } from "@/data/types";
import { formatMoney, type Currency } from "@/lib/money";
import { ESTIMATE_LABEL } from "./lib/settings";
import { PAY_METHOD } from "./labels";

const STAT_CODES = new Set(["si_employee", "income_tax", "gosi_employee", "si_employer", "gosi_employer", "eosb"]);

export function PayslipView({ slip, restaurant, profile, lang, currency }: { slip: Payslip; restaurant: Restaurant | null; profile?: StaffProfile | null; lang: "ar" | "en"; currency: Currency }) {
  const T = (ar: string, en: string) => (lang === "ar" ? ar : en);
  const m = (u: number) => formatMoney(u, { lang, currency });
  const month = new Date(`${slip.period}-15T12:00:00Z`).toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const qty = (q?: number, u?: string) => (q === undefined ? "" : `${q} ${u === "h" ? T("س", "h") : u === "d" ? T("يوم", "d") : u === "min" ? T("د", "min") : ""}`);
  const row = (l: Payslip["earnings"][number], i: number) => (
    <tr key={`${l.code}-${i}`} className="border-b border-[#e3e8e4]">
      <td className="py-1.5 pe-2">
        {l.label[lang]}
        {STAT_CODES.has(l.code) ? <span className="ms-1 text-[10px] text-[#8a6a2a]">*</span> : null}
      </td>
      <td className="num py-1.5 text-center text-[#5b6a64]">{qty(l.qty, l.unit)}</td>
      <td className="num py-1.5 text-end">{m(l.amount)}</td>
    </tr>
  );
  return (
    <article dir={lang === "ar" ? "rtl" : "ltr"} lang={lang} className="mx-auto w-full max-w-[720px] bg-white p-6 text-[13px] leading-relaxed text-[#16211e]" style={{ fontFamily: "'IBM Plex Sans Arabic', system-ui, sans-serif" }}>
      <header className="flex items-start justify-between gap-4 border-b-2 border-[#0d5a53] pb-3">
        <div>
          <p className="text-[18px] font-bold">{restaurant?.name[lang] ?? "Sufra"}</p>
          <p className="text-[#5b6a64]">{T("قسيمة مرتب", "Payslip")} · {month}</p>
        </div>
        <div className="text-end text-[12px] text-[#5b6a64]">
          <p className="text-[15px] font-bold text-[#16211e]">{slip.name}</p>
          <p>{slip.position}</p>
          {profile?.nationalId ? <p className="num">{T("رقم قومي", "National ID")}: {profile.nationalId}</p> : null}
          <p className="num">{T("أجر التأمين", "Insurable wage")}: {m(slip.insurableWage)}</p>
        </div>
      </header>
      <section className="mt-3 grid grid-cols-4 gap-2 text-center text-[12px]">
        {[
          [T("أيام شغل", "Days worked"), slip.workedDays],
          [T("غياب", "Absent"), slip.absentDays],
          [T("دقايق تأخير", "Late min"), slip.lateMinutes],
          [T("إضافي (د)", "Overtime min"), slip.overtimeMinutes],
        ].map(([k, v]) => (
          <div key={String(k)} className="rounded-lg bg-[#f4f7f4] p-2">
            <p className="text-[#5b6a64]">{k}</p>
            <p className="num text-[15px] font-bold">{v}</p>
          </div>
        ))}
      </section>
      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[#16211e] text-[12px]">
              <th className="py-1 text-start">{T("المستحقات", "Earnings")}</th>
              <th />
              <th className="py-1 text-end">{T("المبلغ", "Amount")}</th>
            </tr>
          </thead>
          <tbody>{slip.earnings.map(row)}</tbody>
          <tfoot>
            <tr className="font-bold">
              <td className="pt-2">{T("إجمالي المستحقات", "Gross")}</td>
              <td />
              <td className="num pt-2 text-end">{m(slip.gross)}</td>
            </tr>
          </tfoot>
        </table>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[#16211e] text-[12px]">
              <th className="py-1 text-start">{T("الاستقطاعات", "Deductions")}</th>
              <th />
              <th className="py-1 text-end">{T("المبلغ", "Amount")}</th>
            </tr>
          </thead>
          <tbody>{slip.deductions.length ? slip.deductions.map(row) : <tr><td className="py-1.5 text-[#5b6a64]" colSpan={3}>—</td></tr>}</tbody>
          <tfoot>
            <tr className="font-bold">
              <td className="pt-2">{T("إجمالي الاستقطاعات", "Total deductions")}</td>
              <td />
              <td className="num pt-2 text-end">{m(slip.totalDeductions)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="mt-5 flex items-center justify-between rounded-xl bg-[#0d5a53] px-4 py-3 text-white">
        <span className="text-[15px] font-bold">{T("صافي المرتب", "Net pay")}</span>
        <span className="num text-[22px] font-bold">{m(slip.net)}</span>
      </div>
      <p className="mt-1.5 text-[12px] text-[#5b6a64]">
        {T("طريقة الصرف", "Paid by")}: {PAY_METHOD[slip.payMethod][lang]}
        {slip.paidAt ? ` · ${new Date(slip.paidAt).toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB")}` : ""}
      </p>
      {slip.employer.length ? (
        <section className="mt-4 rounded-lg border border-[#e3e8e4] p-3 text-[12px]">
          <p className="mb-1 font-bold">{T("على حساب صاحب العمل (مش من مرتبك)", "Employer contributions (not deducted from you)")}</p>
          {slip.employer.map((l) => (
            <p key={l.code} className="flex justify-between">
              <span>{l.label[lang]} *</span>
              <span className="num">{m(l.amount)}</span>
            </p>
          ))}
        </section>
      ) : null}
      <p className="mt-3 rounded-md bg-[#f3e7cf] px-2 py-1 text-[11.5px] font-semibold text-[#6d4706]">* {ESTIMATE_LABEL[lang]}</p>
      <footer className="mt-8 grid grid-cols-2 gap-6 text-[12px] text-[#5b6a64]">
        <p className="border-t border-[#b9c5bd] pt-1">{T("توقيع الموظف", "Employee signature")}</p>
        <p className="border-t border-[#b9c5bd] pt-1">{T("الحسابات", "Accounts")}</p>
      </footer>
    </article>
  );
}
