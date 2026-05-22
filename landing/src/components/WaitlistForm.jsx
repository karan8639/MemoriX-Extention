import { useState, useRef, useEffect } from "react";
import { joinWaitlist } from "../lib/supabase";

// ─── Validation ──────────────────────────────────────────────────────────────

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validateEmail(email) {
  if (!email.trim()) return "Email address is required.";
  if (!EMAIL_REGEX.test(email.trim())) return "Enter a valid email address.";
  return null;
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ toast, onDismiss }) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onDismiss, 4500);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  if (!toast) return null;

  const isSuccess = toast.type === "success";

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`
        flex items-start gap-3 px-4 py-3 rounded-lg border text-sm font-mono
        shadow-lg shadow-black/40 backdrop-blur-sm
        animate-[slideUp_0.3s_cubic-bezier(0.16,1,0.3,1)_forwards]
        ${
          isSuccess
            ? "bg-emerald-950/80 border-emerald-500/40 text-emerald-300"
            : "bg-red-950/80 border-red-500/40 text-red-300"
        }
      `}
    >
      {/* Icon */}
      <span className="mt-0.5 shrink-0 text-base leading-none">
        {isSuccess ? "✦" : "⚠"}
      </span>

      {/* Message */}
      <p className="flex-1 leading-relaxed">{toast.message}</p>

      {/* Dismiss */}
      <button
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="shrink-0 opacity-50 hover:opacity-100 transition-opacity leading-none mt-0.5"
      >
        ✕
      </button>
    </div>
  );
}

// ─── Submission States ────────────────────────────────────────────────────────

const STATE = {
  IDLE: "idle",
  LOADING: "loading",
  SUCCESS: "success",
};

// ─── Main Component ───────────────────────────────────────────────────────────

export default function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState(null);
  const [formState, setFormState] = useState(STATE.IDLE);
  const [toast, setToast] = useState(null);
  const [touched, setTouched] = useState(false);
  const inputRef = useRef(null);

  const isLoading = formState === STATE.LOADING;
  const isSuccess = formState === STATE.SUCCESS;

  // Live validation once user has interacted with the field
  useEffect(() => {
    if (touched) {
      setFieldError(validateEmail(email));
    }
  }, [email, touched]);

  function dismissToast() {
    setToast(null);
  }

  function showToast(type, message) {
    setToast({ type, message });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setTouched(true);

    const error = validateEmail(email);
    if (error) {
      setFieldError(error);
      inputRef.current?.focus();
      return;
    }

    setFieldError(null);
    setFormState(STATE.LOADING);

    try {
      const { error: supabaseError } = await joinWaitlist(email);

      if (supabaseError) {
        // Postgres unique constraint violation → duplicate email
        const isDuplicate =
          supabaseError.code === "23505" ||
          supabaseError.message?.toLowerCase().includes("duplicate") ||
          supabaseError.message?.toLowerCase().includes("unique");

        setFormState(STATE.IDLE);

        if (isDuplicate) {
          showToast(
            "error",
            "You're already on the list. We'll be in touch soon."
          );
        } else {
          showToast(
            "error",
            "Something went wrong on our end. Please try again shortly."
          );
          console.error("[MemoriX] Waitlist error:", supabaseError);
        }
        return;
      }

      // ✓ Success
      setFormState(STATE.SUCCESS);
      showToast(
        "success",
        "You're on the list. Early access incoming — stay sharp."
      );
    } catch (unexpectedError) {
      setFormState(STATE.IDLE);
      showToast("error", "A network error occurred. Check your connection.");
      console.error("[MemoriX] Network error:", unexpectedError);
    }
  }

  return (
    <>
      {/* Keyframe injection */}
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulseRing {
          0%, 100% { box-shadow: 0 0 0 0 rgba(99,232,172,0.25); }
          50%       { box-shadow: 0 0 0 6px rgba(99,232,172,0); }
        }
        .input-focus-ring:focus {
          animation: pulseRing 1.8s ease infinite;
        }
      `}</style>

      <section className="w-full max-w-xl mx-auto px-2">

        {/* Eyebrow label */}
        <p className="font-mono text-xs tracking-[0.2em] text-emerald-400 uppercase mb-3 select-none">
          ◈ &nbsp;Private early access
        </p>

        {/* Headline */}
        <h2 className="text-3xl sm:text-4xl font-bold text-white leading-tight tracking-tight mb-2">
          Claim your spot.<br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400">
            Ship faster, forget less.
          </span>
        </h2>

        {/* Sub-copy */}
        <p className="text-zinc-400 text-sm sm:text-base leading-relaxed mb-8 font-mono">
          MemoriX stays local. Zero cloud sync. Zero tracking.
          <br className="hidden sm:block" /> Just your memory, supercharged.
        </p>

        {/* ── Form ── */}
        {!isSuccess ? (
          <form
            onSubmit={handleSubmit}
            noValidate
            aria-label="Join the MemoriX waitlist"
          >
            {/* Input row */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 relative">
                <label htmlFor="waitlist-email" className="sr-only">
                  Email address
                </label>
                <input
                  ref={inputRef}
                  id="waitlist-email"
                  type="email"
                  autoComplete="email"
                  spellCheck={false}
                  placeholder="you@example.com"
                  value={email}
                  disabled={isLoading}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => setTouched(true)}
                  aria-invalid={!!fieldError}
                  aria-describedby={fieldError ? "email-error" : undefined}
                  className={`
                    input-focus-ring w-full bg-zinc-900 text-white placeholder-zinc-600
                    border rounded-lg px-4 py-3 text-sm font-mono
                    outline-none transition-colors duration-150
                    disabled:opacity-50 disabled:cursor-not-allowed
                    ${
                      fieldError
                        ? "border-red-500/70 focus:border-red-400"
                        : "border-zinc-700 focus:border-emerald-500/70"
                    }
                  `}
                />

                {/* Inline error */}
                {fieldError && (
                  <p
                    id="email-error"
                    role="alert"
                    className="absolute -bottom-5 left-0 text-xs text-red-400 font-mono"
                  >
                    {fieldError}
                  </p>
                )}
              </div>

              {/* Submit button */}
              <button
                type="submit"
                disabled={isLoading || !!fieldError}
                aria-disabled={isLoading || !!fieldError}
                className={`
                  relative shrink-0 sm:w-auto w-full
                  px-6 py-3 rounded-lg text-sm font-bold font-mono tracking-wide
                  transition-all duration-200 focus-visible:outline-none
                  focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2
                  focus-visible:ring-offset-zinc-950
                  ${
                    isLoading
                      ? "bg-emerald-800 cursor-not-allowed text-emerald-400"
                      : "bg-emerald-500 hover:bg-emerald-400 active:scale-[0.97] text-zinc-950 shadow-lg shadow-emerald-900/40"
                  }
                  disabled:opacity-60 disabled:cursor-not-allowed disabled:scale-100
                `}
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <SpinnerIcon />
                    Joining…
                  </span>
                ) : (
                  "Join Waitlist →"
                )}
              </button>
            </div>

            {/* Trust line */}
            <p className="mt-6 text-xs text-zinc-600 font-mono flex items-center gap-2">
              <span className="text-emerald-600">⬡</span>
              No spam. Unsubscribe any time. Your data never leaves your machine.
            </p>
          </form>
        ) : (
          /* ── Success State ── */
          <SuccessBanner email={email} />
        )}

        {/* Toast */}
        <div className="mt-5">
          <Toast toast={toast} onDismiss={dismissToast} />
        </div>
      </section>
    </>
  );
}

// ─── Success Banner ───────────────────────────────────────────────────────────

function SuccessBanner({ email }) {
  return (
    <div
      className="
        rounded-xl border border-emerald-500/25 bg-emerald-950/30
        px-6 py-5 backdrop-blur-sm
        animate-[slideUp_0.4s_cubic-bezier(0.16,1,0.3,1)_forwards]
      "
      role="status"
    >
      <div className="flex items-start gap-4">
        <span className="text-2xl text-emerald-400 mt-0.5 shrink-0">✦</span>
        <div>
          <p className="text-emerald-300 font-bold text-base font-mono mb-1">
            You're on the list.
          </p>
          <p className="text-zinc-400 text-sm font-mono leading-relaxed">
            We'll reach out to{" "}
            <span className="text-zinc-200">{email}</span> when early access
            opens. In the meantime — keep shipping.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Spinner Icon ─────────────────────────────────────────────────────────────

function SpinnerIcon() {
  return (
    <svg
      className="animate-spin h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
