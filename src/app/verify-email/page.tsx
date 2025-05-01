"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "../firebase-config";
import { sendEmailVerification } from "firebase/auth";

export default function VerifyEmail() {
  const [timeUntilResend, setTimeUntilResend] = useState(60);
  const [canResend, setCanResend] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      router.push("/");
      return;
    }

    if (user.emailVerified) {
      router.push("/dashboard");
      return;
    }

    // Start countdown for resend button
    const timer = setInterval(() => {
      setTimeUntilResend((prev) => {
        if (prev <= 1) {
          setCanResend(true);
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [router]);

  const handleResendEmail = async () => {
    const user = auth.currentUser;
    if (!user) return;

    try {
      await sendEmailVerification(user);
      setCanResend(false);
      setTimeUntilResend(60);
    } catch (error) {
      console.error("Error resending verification email:", error);
    }
  };

  const checkVerification = async () => {
    const user = auth.currentUser;
    if (!user) return;

    await user.reload();
    if (user.emailVerified) {
      router.push("/dashboard");
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4">
      <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full">
        <h1 className="text-2xl font-bold text-center mb-6">Verify Your Email</h1>
        
        <div className="text-center mb-8">
          <p className="text-gray-600 mb-4">
            We've sent a verification email to your inbox. Please check your email and click the verification link.
          </p>
          <p className="text-sm text-gray-500">
            If you don't see the email, check your spam folder.
          </p>
        </div>

        <div className="space-y-4">
          <button
            onClick={checkVerification}
            className="w-full bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600 transition-colors"
          >
            I've Verified My Email
          </button>

          <button
            onClick={handleResendEmail}
            disabled={!canResend}
            className={`w-full py-2 px-4 rounded transition-colors ${
              canResend
                ? "bg-indigo-500 text-white hover:bg-indigo-600"
                : "bg-gray-300 text-gray-500 cursor-not-allowed"
            }`}
          >
            {canResend
              ? "Resend Verification Email"
              : `Resend available in ${timeUntilResend}s`}
          </button>

          <button
            onClick={() => {
              auth.signOut();
              router.push("/");
            }}
            className="w-full text-gray-600 hover:text-gray-800 text-sm"
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
} 