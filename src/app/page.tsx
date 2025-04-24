"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { auth } from "../app/firebase-config";
import { signInWithEmailAndPassword } from "firebase/auth";
import { Eye, EyeOff } from "lucide-react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const router = useRouter();

  const validateEmail = (email: string) => {
    const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,4}$/;
    if (!email) return "Email is required";
    if (!emailPattern.test(email)) return "Please enter a valid email address";
    return "";
  };

  const validatePassword = (password: string) => {
    if (!password) return "Password is required";
    if (password.length < 8) return "Password must be at least 8 characters";
    return "";
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault(); //prevent page reload when enter key is pressed
    // setEmailError("");
    // setPasswordError("");

    const emailValidationError = validateEmail(email);
    const passwordValidationError = validatePassword(password);

    if (emailValidationError || passwordValidationError) {
      setEmailError(emailValidationError);
      setPasswordError(passwordValidationError);
      return;
    }

    try {
      console.log("Attempting login...");
      await signInWithEmailAndPassword(auth, email, password);
      console.log("Login successful! Redirecting...");
      router.push("/dashboard"); // Next.js redirection

      setEmailError("");
      setPasswordError("");
    } catch (error: any) {
      console.error("Login error:", error.code, error.message);
      if (error.code === "auth/user-not-found") {
        setEmailError("User not found");
      } else if (error.code === "auth/wrong-password") {
        setPasswordError("Invalid password");
      } else {
        setEmailError("Login failed. Please try again later");
      }
    }
  };

  return (
    <div className="fixed inset-0">
      <div className="absolute inset-0 grid grid-cols-2">
      <div className="bg-bg-yellow"></div>
      <div className="bg-bg-light-brown"></div>
      </div>
      <div className="relative z-10 h-full flex justify-center items-center">
        <div className="flex flex-col justify-center bg-white rounded-3xl p-8 shadow-2xl w-[400px]">
          <div className="flex flex-col gap-1">
            <h1 className="text-sm text-bg-brown">
              Welcome to
              <strong className="text-bg-light-brown font-bold"> BBNKA</strong>
            </h1>
            <h2 className="text-3xl font-black text-bg-brown">Sign In</h2>
            <h3 className="text-sm font-thin text-bg-brown">
              Enter your login details to continue
            </h3>
          </div>
          <form className="flex flex-col justify-center" onSubmit={handleLogin}>
            <div className="flex flex-col gap-1 pt-6 pb-3">
              <label className="text-xs font-extralight ml-3 text-bg-brown">Email Address</label>
              <input
                type="email"
                className={`w-full bg-white/80 placeholder:text-slate-400 text-slate-700 text-sm border ${
                  emailError ? "border-red-500" : "border-slate-200"
                } rounded-md px-3 py-2 transition duration-300 ease focus:outline-none focus:border-slate-400 hover:border-slate-300 shadow-sm focus:shadow`}
                placeholder="Enter your email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {emailError && <p className="text-red-500 text-xs mt-1 ml-3">{emailError}</p>}
            </div>

            <div className="flex flex-col gap-1 relative">
              <label className="text-xs font-extralight ml-3 text-bg-brown">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  className={`w-full bg-white/80 placeholder:text-slate-400 text-slate-700 text-sm border ${
                    passwordError ? "border-red-500" : "border-slate-200"
                  } rounded-md px-3 py-2 transition duration-300 ease focus:outline-none focus:border-slate-400 hover:border-slate-300 shadow-sm focus:shadow`}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />

                <button
                  type="button"
                  className="absolute inset-y-0 right-3 flex items-center text-slate-400 hover:text-slate-600"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {passwordError && <p className="text-red-500 text-xs mt-1 ml-3">{passwordError}</p>}
            </div>

            <div className="flex justify-end pt-2 pb-6">
              <button 
                type="button"
                className="text-xs font-bold underline text-bg-brown hover:text-bg-light-brown transition-colors"
              >
                Forgot Password?
              </button>
            </div>

            <button
              className="w-full rounded-md bg-bg-light-brown py-2 px-4 border border-transparent font-bold text-center text-sm text-white transition-all shadow-md hover:shadow-lg focus:shadow-none active:bg-hover-light-brown hover:bg-hover-light-brown active:shadow-none disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none"
              type="submit"
            >
              LOGIN
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}