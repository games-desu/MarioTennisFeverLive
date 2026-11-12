"use client";

import { useEffect, useState } from "react";
import { useLang } from "./LocaleProvider";

const SITE_URL = "https://mario-tennis-fever-live.vercel.app";

// 配信者ページの「記録カード」。期間内の記録を1枚の画像（/api/card）にして、
// X への投稿・画像の保存・リンクのコピーができる。
// 画像の生成はサーバーの CPU を使うので、ボタンを押すまで読み込まない。
export default function RecordCard({
  platform,
  channelId,
  name,
  days,
}: {
  platform: "youtube" | "twitch";
  channelId: string;
  name: string;
  days: number;
}) {
  const { lang, t } = useLang();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  const src = `/api/card?platform=${platform}&id=${encodeURIComponent(channelId)}&days=${days}${
    lang === "en" ? "&lang=en" : ""
  }`;
  const pageUrl = `${SITE_URL}/streamers/${platform}/${encodeURIComponent(channelId)}`;
  const text =
    lang === "en"
      ? `Stream record of ${name} on FEVER LIVE\n#MarioTennisFever`
      : `${name} の配信記録（FEVER LIVE）\n#マリオテニスフィーバー`;
  const xUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(pageUrl)}`;

  // 期間や言語を変えたら画像を読み直す
  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [src]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pageUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* クリップボードが使えない環境では何もしない */
    }
  };

  const btn =
    "inline-flex items-center justify-center rounded-full border px-4 py-2 text-xs font-bold shadow-sm transition-colors";

  return (
    <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-black text-slate-700">{t("st.cardTitle")}</h2>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{t("st.cardLead")}</p>
        </div>
        {!open && (
          <button
            onClick={() => setOpen(true)}
            className={`${btn} shrink-0 border-brand bg-brand/10 text-brand hover:bg-brand/20`}
          >
            {t("st.cardMake")}
          </button>
        )}
      </div>

      {open && (
        <>
          <div
            className="relative mt-3 w-full overflow-hidden rounded-xl bg-slate-100"
            style={{ aspectRatio: "1200 / 630" }}
          >
            {!loaded && !failed && (
              <div className="absolute inset-0 grid place-items-center text-xs text-slate-400">
                {t("st.cardMaking")}
              </div>
            )}
            {failed ? (
              <div className="absolute inset-0 grid place-items-center px-4 text-center text-xs text-slate-400">
                {t("st.cardFailed")}
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={src}
                src={src}
                alt={t("st.cardTitle")}
                width={1200}
                height={630}
                onLoad={() => setLoaded(true)}
                onError={() => setFailed(true)}
                className={`h-full w-full transition-opacity ${loaded ? "opacity-100" : "opacity-0"}`}
              />
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={xUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`${btn} border-brand bg-brand/10 text-brand hover:bg-brand/20`}
            >
              {t("st.cardPostX")}
            </a>
            <a
              href={src}
              download={`fever-live-${channelId}-${days}d.png`}
              className={`${btn} border-slate-300 bg-white text-slate-600 hover:bg-slate-50`}
            >
              {t("st.cardSave")}
            </a>
            <button
              onClick={copy}
              className={`${btn} border-slate-300 bg-white text-slate-600 hover:bg-slate-50`}
            >
              {copied ? t("st.cardCopied") : t("st.cardCopy")}
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">{t("st.cardNote")}</p>
        </>
      )}
    </section>
  );
}
