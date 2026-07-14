import React, { useState, useEffect } from "react";
import { ArrowRight, Loader, Eye, EyeOff } from "lucide-react";
import { supabase } from "./supabase.js";

const INK = "#2D3748";
const FADE = "#718096";
const LINE = "#E2E8F0";

const inputStyle = {
  width: "100%", padding: "13px 15px", borderRadius: 14, border: `1.5px solid ${LINE}`,
  fontSize: 15.5, margin: "6px 0 16px", background: "#fff", color: INK, boxSizing: "border-box",
};

const Btn = ({ children, onClick, accent = INK, ghost, small, disabled, full, style }) => (
  <button onClick={onClick} disabled={disabled} className="f-body" style={{
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
    padding: small ? "8px 14px" : "13px 22px", borderRadius: 14, fontWeight: 600,
    fontSize: small ? 14 : 15.5, border: ghost ? `1.5px solid ${LINE}` : "none",
    background: ghost ? "#fff" : accent, color: ghost ? INK : "#fff",
    cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.45 : 1,
    width: full ? "100%" : undefined, transition: "transform .12s ease", ...style,
  }}
    onMouseDown={e => !disabled && (e.currentTarget.style.transform = "scale(.97)")}
    onMouseUp={e => (e.currentTarget.style.transform = "scale(1)")}
    onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
  >{children}</button>
);

const Orb = ({ accent, size = 64, active = true }) => (
  <div style={{ width: size, height: size, position: "relative", flexShrink: 0 }} aria-hidden="true">
    <div style={{
      position: "absolute", inset: 0, borderRadius: "50%",
      background: `radial-gradient(circle at 32% 30%, ${accent}, ${INK} 130%)`,
      animation: active ? "breathe 2.6s ease-in-out infinite" : "none",
    }} />
  </div>
);

export function PasswordResetPage() {
  const [step, setStep] = useState("loading"); // loading | reset | success | error
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        // Get the current session to verify we're in a recovery flow
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setErr("Reset link expired or invalid. Please request a new one.");
          setStep("error");
          return;
        }
        setStep("reset");
      } catch (e) {
        setErr(e.message || "Could not process reset link");
        setStep("error");
      }
    })();
  }, []);

  const handleReset = async () => {
    setErr("");
    if (newPassword.length < 6) return setErr("Password must be at least 6 characters");
    if (newPassword !== confirmPassword) return setErr("Passwords don't match");

    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setStep("success");
    } catch (e) {
      setErr(e.message || "Failed to reset password");
    }
    setBusy(false);
  };

  if (step === "loading") return (
    <div style={{ maxWidth: 440, margin: "0 auto", padding: "56px 22px", textAlign: "center" }}>
      <Loader size={22} className="animate-spin" style={{ color: FADE }} />
    </div>
  );

  if (step === "error") return (
    <div style={{ maxWidth: 440, margin: "0 auto", padding: "56px 22px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 30 }}>
        <Orb accent="#0E7C6B" size={44} active />
        <div className="f-display" style={{ fontWeight: 700, fontSize: 24, letterSpacing: -0.5 }}>Lingua</div>
      </div>
      <div style={{ fontSize: 44, marginBottom: 16, textAlign: "center" }}>⚠️</div>
      <h1 className="f-display" style={{ fontSize: 28, fontWeight: 600, marginBottom: 10 }}>Reset link expired</h1>
      <p className="f-body" style={{ color: FADE, fontSize: 14, marginBottom: 20 }}>
        {err}
      </p>
      <Btn full accent="#0E7C6B" onClick={() => window.location.href = "/auth"}>
        Request a new link
      </Btn>
    </div>
  );

  if (step === "success") return (
    <div style={{ maxWidth: 440, margin: "0 auto", padding: "56px 22px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 30 }}>
        <Orb accent="#0E7C6B" size={44} active />
        <div className="f-display" style={{ fontWeight: 700, fontSize: 24, letterSpacing: -0.5 }}>Lingua</div>
      </div>
      <div style={{ fontSize: 44, marginBottom: 16, textAlign: "center" }}>✅</div>
      <h1 className="f-display" style={{ fontSize: 28, fontWeight: 600, marginBottom: 10 }}>Password reset!</h1>
      <p className="f-body" style={{ color: FADE, fontSize: 14, marginBottom: 20 }}>
        Your password has been successfully changed. You can now sign in with your new password.
      </p>
      <Btn full accent="#0E7C6B" onClick={() => window.location.href = "/auth"}>
        Sign in to your account
      </Btn>
    </div>
  );

  return (
    <div style={{ maxWidth: 440, margin: "0 auto", padding: "56px 22px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 30 }}>
        <Orb accent="#0E7C6B" size={44} active />
        <div className="f-display" style={{ fontWeight: 700, fontSize: 24, letterSpacing: -0.5 }}>Lingua</div>
      </div>
      <h1 className="f-display" style={{ fontSize: 28, fontWeight: 600, marginBottom: 6 }}>Reset your password</h1>
      <p className="f-body" style={{ color: FADE, fontSize: 14, marginBottom: 24 }}>
        Enter your new password below.
      </p>

      <div>
        <label className="f-body" style={{ fontSize: 13.5, fontWeight: 600, color: FADE }}>New Password</label>
        <div style={{ position: "relative" }}>
          <input value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="6+ characters"
            type={show ? "text" : "password"} className="f-body" style={inputStyle} />
          <button onClick={() => setShow(!show)} aria-label="Show password"
            style={{ position: "absolute", right: 12, top: 18, background: "none", border: "none", cursor: "pointer" }}>
            {show ? <EyeOff size={17} color={FADE} /> : <Eye size={17} color={FADE} />}
          </button>
        </div>
      </div>

      <div>
        <label className="f-body" style={{ fontSize: 13.5, fontWeight: 600, color: FADE }}>Confirm Password</label>
        <div style={{ position: "relative" }}>
          <input value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Re-enter password"
            type={show ? "text" : "password"} className="f-body" style={inputStyle} />
        </div>
      </div>

      {err && <p className="f-body" style={{ color: "#A0453A", fontSize: 13.5, marginBottom: 12 }}>{err}</p>}

      <Btn full accent="#0E7C6B" disabled={busy} onClick={handleReset}>
        {busy ? <Loader size={16} className="animate-spin" /> : <>Reset Password <ArrowRight size={16} /></>}
      </Btn>
    </div>
  );
}
